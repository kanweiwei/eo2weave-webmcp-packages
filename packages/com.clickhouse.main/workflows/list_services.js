// Self-contained adapter workflow. The ClickHouse Cloud session and every same-origin
// API call stay inside the ClickHouse Cloud tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "status": {
        "type": "string"
      },
      "data": {
        "type": [
          "object",
          "null"
        ]
      },
      "message": {
        "type": [
          "string",
          "null"
        ]
      },
      "error_code": {
        "type": [
          "string",
          "null"
        ]
      }
    },
    "required": [
      "status",
      "data"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_services',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
                    // ─── Page-side SDK-compat layer ─────────────────────────────────
                    // Reimplements the subset of @opentabs-dev/plugin-sdk that the
                    // pasted upstream transport calls: credentials:'include' fetches with
                    // a bounded abort and the SDK's HTTP -> ToolError classification,
                    // page readers (meta / cookie / localStorage / globals), the auth
                    // cache and waitUntil. Logging/timing behaviour is not reproduced;
                    // the upstream modules below run unmodified.
                    class ToolError extends Error {
                      constructor(message, code, opts) {
                        super(message)
                        this.name = 'ToolError'
                        this.code = code || 'TOOL_ERROR'
                        this.category = (opts && opts.category) || undefined
                        this.retryable = !!(opts && opts.retryable)
                      }
                      static auth(m, c) { return new ToolError(m, c || 'AUTH_ERROR', { category: 'auth' }) }
                      static notFound(m, c) { return new ToolError(m, c || 'NOT_FOUND', { category: 'not_found' }) }
                      static validation(m, c) { return new ToolError(m, c || 'VALIDATION_ERROR', { category: 'validation' }) }
                      static rateLimited(m, ms, c) { return new ToolError(m, c || 'RATE_LIMITED', { category: 'rate_limit', retryable: true }) }
                      static timeout(m, c) { return new ToolError(m, c || 'TIMEOUT', { category: 'timeout', retryable: true }) }
                      static internal(m, c) { return new ToolError(m, c || 'INTERNAL_ERROR', { category: 'internal' }) }
                    }

                    function defineTool(definition) { return definition }

                    // Zod is only used to declare schemas at module scope; the package
                    // carries its schemas as JSON, so every z.* chain can resolve to this
                    // inert stub.
                    var z = new Proxy(function () {}, {
                      get: function () { return z },
                      apply: function () { return z },
                    })

                    function getPageGlobal(path) {
                      try {
                        var parts = path.split('.')
                        var node = globalThis
                        for (var i = 0; i < parts.length; i++) {
                          if (node === null || node === undefined) return undefined
                          node = node[parts[i]]
                        }
                        return node
                      } catch (e) {
                        return undefined
                      }
                    }

                    function getMetaContent(name) {
                      try {
                        var el = document.querySelector('meta[name="' + name + '"]')
                        if (!el) return null
                        var value = el.getAttribute('content')
                        return value || null
                      } catch (e) {
                        return null
                      }
                    }

                    function getCookie(name) {
                      try {
                        var prefix = name + '='
                        var parts = String(document.cookie || '').split(';')
                        for (var i = 0; i < parts.length; i++) {
                          var part = parts[i].trim()
                          if (part.indexOf(prefix) === 0) return decodeURIComponent(part.slice(prefix.length))
                        }
                        return null
                      } catch (e) {
                        return null
                      }
                    }

                    function getLocalStorage(key) {
                      try {
                        return localStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    function getSessionStorage(key) {
                      try {
                        return sessionStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    // Upstream SDK export (temporal-cloud): scan localStorage keys with a
                    // predicate and return the first hit as { key, value }.
                    function findLocalStorageEntry(predicate) {
                      try {
                        var count = localStorage.length
                        for (var i = 0; i < count; i++) {
                          var key = localStorage.key(i)
                          if (key === null) continue
                          if (!predicate(key)) continue
                          var value = localStorage.getItem(key)
                          if (value === null) continue
                          return { key: key, value: value }
                        }
                      } catch (e) {}
                      return null
                    }

                    function getCurrentUrl() {
                      return typeof location !== 'undefined' ? location.href : ''
                    }

                    var __authCache = (globalThis.__opentabsAuthCache =
                      globalThis.__opentabsAuthCache || {})
                    function getAuthCache(ns) { return __authCache[ns] || null }
                    function setAuthCache(ns, value) { __authCache[ns] = value }
                    function clearAuthCache(ns) { delete __authCache[ns] }

                    // Upstream SDK export: structured logging. The adapter drops log
                    // output, but the pasted transport calls log.debug on auth paths, so
                    // the surface must exist.
                    var log = { debug: function () {}, info: function () {}, warn: function () {}, error: function () {} }

                    function buildQueryString(params) {
                      var search = new URLSearchParams()
                      var keys = Object.keys(params || {})
                      for (var i = 0; i < keys.length; i++) {
                        var value = params[keys[i]]
                        if (value === undefined) continue
                        if (Array.isArray(value)) {
                          for (var j = 0; j < value.length; j++) search.append(keys[i], String(value[j]))
                        } else {
                          search.append(keys[i], String(value))
                        }
                      }
                      return search.toString()
                    }

                    function stripUndefined(obj) {
                      var out = {}
                      var keys = Object.keys(obj || {})
                      for (var i = 0; i < keys.length; i++) {
                        if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]]
                      }
                      return out
                    }

                    function parseRetryAfterMs(value) {
                      var seconds = Number(value)
                      if (!isNaN(seconds) && seconds >= 0) return seconds * 1000
                      var date = Date.parse(value)
                      if (!isNaN(date)) {
                        var ms = date - Date.now()
                        return ms > 0 ? ms : undefined
                      }
                      return undefined
                    }

                    function parseRateLimitHeader(headers) {
                      var names = ['Retry-After', 'x-rate-limit-reset', 'x-ratelimit-reset', 'RateLimit-Reset']
                      for (var i = 0; i < names.length; i++) {
                        var raw = null
                        try { raw = headers.get(names[i]) } catch (e) {}
                        if (raw === null || raw === undefined) continue
                        var ms = parseRetryAfterMs(raw)
                        if (ms !== undefined) return ms
                      }
                      return undefined
                    }

                    function sleep(ms) {
                      return new Promise(function (resolve) { setTimeout(resolve, ms) })
                    }

                    // Upstream SDK export (sqlpad): plain sleep with progress reporting.
                    async function delay(ms) {
                      return sleep(ms)
                    }

                    async function waitUntil(predicate, options) {
                      var interval = (options && options.interval) || 500
                      var timeout = (options && options.timeout) || 5000
                      var deadline = Date.now() + timeout
                      while (Date.now() <= deadline) {
                        if (await predicate()) return
                        await sleep(interval)
                      }
                      throw ToolError.timeout('waitUntil timed out after ' + timeout + 'ms')
                    }

                    function httpStatusToToolError(status, message, headers) {
                      if (status === 401 || status === 403) return ToolError.auth(message)
                      if (status === 404) return ToolError.notFound(message)
                      if (status === 429) {
                        var retryAfterMs = headers ? parseRateLimitHeader(headers) : undefined
                        return ToolError.rateLimited(message, retryAfterMs)
                      }
                      if (status === 400 || status === 422) return ToolError.validation(message)
                      if (status === 408) return ToolError.timeout(message)
                      if (status >= 500) return new ToolError(message, 'HTTP_ERROR', { category: 'internal', retryable: true })
                      return new ToolError(message, 'HTTP_ERROR', { retryable: false })
                    }

                    var FETCH_TIMEOUT_MS = 18000

                    async function fetchFromPage(url, init) {
                      init = init || {}
                      var timeout = init.timeout || 30000
                      var controller = null
                      if (typeof AbortController === 'function') {
                        try { controller = new AbortController() } catch (e) {}
                      }
                      var budget = Math.min(timeout, FETCH_TIMEOUT_MS)
                      var timer = controller
                        ? setTimeout(function () { try { controller.abort() } catch (e) {} }, budget)
                        : null
                      var response
                      try {
                        response = await fetch(url, {
                          credentials: 'include',
                          ...init,
                          signal: controller ? controller.signal : undefined,
                          timeout: undefined,
                        })
                      } catch (error) {
                        if (timer !== null) clearTimeout(timer)
                        var aborted = error && (error.name === 'AbortError' || String(error).indexOf('abort') !== -1)
                        if (aborted) {
                          return { __fetchError: ToolError.timeout('request timed out after ' + budget + 'ms for ' + url) }
                        }
                        return {
                          __fetchError: new ToolError('network error for ' + url + ': ' + String(error), 'NETWORK_ERROR', {
                            category: 'internal',
                            retryable: true,
                          }),
                        }
                      }
                      if (timer !== null) clearTimeout(timer)
                      if (response && response.__fetchError) throw response.__fetchError
                      if (!response.ok) {
                        var rawText = ''
                        try { rawText = await response.text() } catch (e) { rawText = '' }
                        var text = String(rawText || '')
                        var body = text.length > 512 ? text.slice(0, 512) + '…' : text
                        throw httpStatusToToolError(
                          response.status,
                          'HTTP ' + response.status + ' for ' + url + ': ' + body,
                          response.headers
                        )
                      }
                      return response
                    }

                    async function fetchJSON(url, init, schema) {
                      var response = await fetchFromPage(url, init)
                      if (response.status === 204) return undefined
                      var data
                      try {
                        data = await response.json()
                      } catch (e) {
                        throw ToolError.validation('failed to parse JSON from ' + url)
                      }
                      return data
                    }

                    // Upstream SDK export (sqlpad): same transport, raw text body.
                    async function fetchText(url, init) {
                      var response = await fetchFromPage(url, init)
                      try {
                        return await response.text()
                      } catch (e) {
                        throw ToolError.validation('failed to read text from ' + url)
                      }
                    }

          // Auth0 SPA SDK stores the token in localStorage under this key.
          // The token object has { body: { access_token, ... }, expiresAt }.
          const AUTH0_STORAGE_KEY = '@@auth0spajs@@::IPpH4RND0qNXHVayepffgsGpbXQmFikr::control-plane-web::openid profile email';
          // ClickHouse Cloud stores organization/instance data in localStorage
          // under keys prefixed with __uc_cache__:
          const UC_CACHE_PREFIX = '__uc_cache__:';
          // --- Auth extraction ---
          const getAuth = () => {
              try {
                  const raw = getLocalStorage(AUTH0_STORAGE_KEY);
                  if (!raw)
                      return null;
                  const entry = JSON.parse(raw);
                  const accessToken = entry.body?.access_token;
                  if (!accessToken)
                      return null;
                  // Check expiration — expiresAt is unix seconds
                  const expiresAt = entry.expiresAt ?? 0;
                  if (expiresAt > 0 && expiresAt < Date.now() / 1000) {
                      // Token expired. Auth0 SPA SDK auto-refreshes in the background,
                      // so a subsequent check may find a valid token.
                      return null;
                  }
                  return { accessToken };
              }
              catch {
                  return null;
              }
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // --- Organization ID extraction ---
          // The ClickHouse Cloud console caches organization and instance data in
          // localStorage under __uc_cache__:organizations:<userId> etc. The org ID
          // is also available in the URL path (/services/<orgId>/...).
          const getFromCache = (cacheKey) => {
              try {
                  const prefix = `${UC_CACHE_PREFIX}${cacheKey}:`;
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key?.startsWith(prefix))
                          continue;
                      const raw = getLocalStorage(key);
                      if (!raw)
                          continue;
                      return JSON.parse(raw);
                  }
              }
              catch {
                  /* ignore */
              }
              return null;
          };
          const getOrgId = () => {
              // Strategy 1: Read from localStorage org ID preference
              try {
                  const orgId = getLocalStorage('currentOrganizationId');
                  if (orgId)
                      return orgId;
              }
              catch {
                  // Ignore
              }
              // Strategy 2: Read from __uc_cache__:organizations:<userId> — stored as a JSON array
              try {
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key?.startsWith(`${UC_CACHE_PREFIX}organizations:`))
                          continue;
                      const raw = getLocalStorage(key);
                      if (!raw)
                          continue;
                      const orgs = JSON.parse(raw);
                      if (Array.isArray(orgs) && orgs[0]?.id)
                          return orgs[0].id;
                  }
              }
              catch {
                  // Ignore
              }
              return null;
          };
          // --- API base URL ---
          const getApiBase = () => {
              try {
                  const apiHost = getPageGlobal('consoleConfig.controlPlane.apiHost');
                  if (typeof apiHost === 'string')
                      return apiHost;
              }
              catch {
                  // Ignore
              }
              return 'https://control-plane-internal.clickhouse.cloud';
          };
          // --- API caller ---
          const api = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to ClickHouse Cloud.');
              const base = getApiBase();
              let url = `${base}${endpoint}`;
              if (options.query) {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(options.query)) {
                      if (value !== undefined)
                          params.append(key, String(value));
                  }
                  const qs = params.toString();
                  if (qs)
                      url += `?${qs}`;
              }
              const headers = {
                  Accept: 'application/json',
                  Authorization: `Bearer ${auth.accessToken}`,
              };
              let fetchBody;
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = JSON.stringify(options.body);
              }
              let response;
              try {
                  response = await fetch(url, {
                      method: options.method ?? (options.body ? 'POST' : 'GET'),
                      headers,
                      body: fetchBody,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  }
                  if (err instanceof DOMException && err.name === 'AbortError') {
                      throw new ToolError('Request was aborted', 'aborted');
                  }
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (!response.ok) {
                  const errorBody = (await response.text().catch(() => '')).substring(0, 512);
                  if (response.status === 429) {
                      const retryAfter = response.headers.get('Retry-After');
                      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 401 || response.status === 403) {
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404) {
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  }
                  if (response.status === 422) {
                      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
                  }
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              return (await response.json());
          };

          // --- Zod schemas ---
          const organizationSchema = z.object({
              id: z.string().describe('Organization UUID'),
              name: z.string().describe('Organization name'),
              billing_status: z.string().describe('Billing status (e.g., "IN_TRIAL", "active", "suspended")'),
              tier: z.string().describe('Organization tier (e.g., "BASIC", "SCALE", "ENTERPRISE")'),
              created_at: z.string().describe('Created ISO 8601 timestamp'),
              trial_remaining_days: z.number().describe('Days remaining in trial period, or 0 if not on trial'),
              trial_amount_remaining: z.number().describe('Trial credit remaining in dollars, or 0 if not on trial'),
          });
          const endpointSchema = z.object({
              protocol: z.string().describe('Endpoint protocol (e.g., "nativesecure", "https")'),
              hostname: z.string().describe('Endpoint hostname'),
              port: z.number().describe('Endpoint port number'),
          });
          const ipAccessEntrySchema = z.object({
              source: z.string().describe('IP address or CIDR range'),
              description: z.string().describe('Description of this IP access entry'),
          });
          const serviceSchema = z.object({
              id: z.string().describe('Service UUID'),
              name: z.string().describe('Service name'),
              state: z.string().describe('Service state (e.g., "running", "idle", "stopped", "provisioning")'),
              region: z.string().describe('Cloud region ID (e.g., "gcp-us-east1", "aws-us-east-1")'),
              cloud_provider: z.string().describe('Cloud provider (e.g., "aws", "gcp", "azure")'),
              clickhouse_version: z.string().describe('ClickHouse server version'),
              endpoints: z.array(endpointSchema).describe('Connection endpoints'),
              min_replica_memory_gb: z.number().describe('Minimum replica memory in GB'),
              max_replica_memory_gb: z.number().describe('Maximum replica memory in GB'),
              num_replicas: z.number().describe('Number of replicas (minReplicas..maxReplicas)'),
              idle_scaling: z.boolean().describe('Whether idle scaling (auto-suspend) is enabled'),
              idle_timeout_minutes: z.number().describe('Minutes of inactivity before idle suspension'),
              created_at: z.string().describe('Created ISO 8601 timestamp'),
              data_warehouse_id: z.string().describe('Data warehouse UUID, or empty string if not linked'),
              is_primary: z.boolean().describe('Whether this is the primary service in the warehouse'),
              is_readonly: z.boolean().describe('Whether this is a read-only replica'),
              release_channel: z.string().describe('Release channel (e.g., "regular", "fast")'),
              ip_access_list: z.array(ipAccessEntrySchema).describe('IP access list entries'),
          });
          const memberSchema = z.object({
              user_id: z.string().describe('Member user ID'),
              name: z.string().describe('Member display name'),
              email: z.string().describe('Member email address'),
              role: z.string().describe('Organization role (e.g., "ADMIN", "DEVELOPER")'),
              joined_at: z.string().describe('Joined ISO 8601 timestamp'),
          });
          const backupSchema = z.object({
              id: z.string().describe('Backup UUID'),
              status: z.string().describe('Backup status (e.g., "done", "in_progress", "error")'),
              started_at: z.string().describe('Backup started ISO 8601 timestamp'),
              finished_at: z.string().describe('Backup finished ISO 8601 timestamp, or empty string if in progress'),
              size_bytes: z.number().describe('Backup size in bytes'),
              duration_seconds: z.number().describe('Backup duration in seconds'),
              type: z.string().describe('Backup type (e.g., "full", "incremental")'),
          });
          const metricDataPointSchema = z.object({
              timestamp: z.number().describe('Data point Unix timestamp in milliseconds'),
              value: z.number().describe('Metric value at this timestamp'),
          });
          const statusSummarySchema = z.object({
              status: z
                  .string()
                  .describe('Overall platform status (e.g., "operational", "degraded_performance", "partial_outage")'),
              active_incidents: z.number().describe('Number of currently active incidents'),
              active_maintenances: z.number().describe('Number of currently active maintenances'),
          });
          // --- Defensive mappers ---
          const toISOString = (val) => {
              if (!val)
                  return '';
              if (typeof val === 'number')
                  return new Date(val).toISOString();
              return val;
          };
          const mapOrganization = (o) => ({
              id: o.id ?? '',
              name: o.name ?? '',
              billing_status: o.billingStatus ?? '',
              tier: o.tier ?? '',
              created_at: toISOString(o.createdAt),
              trial_remaining_days: o.cachedCommitmentState?.TRIAL?.timeRemainingInDays ?? 0,
              trial_amount_remaining: o.cachedCommitmentState?.TRIAL?.amountRemaining ?? 0,
          });
          const mapEndpoint = (protocol, e) => ({
              protocol,
              hostname: e.hostname ?? '',
              port: e.port ?? 0,
          });
          const mapIpAccessEntry = (e) => ({
              source: e.source ?? '',
              description: e.description ?? '',
          });
          const mapService = (s) => {
              const endpoints = s.endpoints ? Object.entries(s.endpoints).map(([protocol, ep]) => mapEndpoint(protocol, ep)) : [];
              return {
                  id: s.id ?? '',
                  name: s.name ?? '',
                  state: s.state ?? '',
                  region: s.regionId ?? '',
                  cloud_provider: s.cloudProvider ?? '',
                  clickhouse_version: s.clickhouseVersion ?? '',
                  endpoints,
                  min_replica_memory_gb: s.minAutoScalingReplicaMemory ?? 0,
                  max_replica_memory_gb: s.maxAutoScalingReplicaMemory ?? 0,
                  num_replicas: s.maxReplicas ?? s.minReplicas ?? 0,
                  idle_scaling: s.enableIdleScaling ?? false,
                  idle_timeout_minutes: s.idleTimeoutMinutes ?? 0,
                  created_at: toISOString(s.creationDate),
                  data_warehouse_id: s.dataWarehouseId ?? '',
                  is_primary: s.isPrimary ?? false,
                  is_readonly: s.isReadonly ?? false,
                  release_channel: s.releaseChannel ?? '',
                  ip_access_list: (s.ipAccessList ?? []).map(mapIpAccessEntry),
              };
          };
          const mapMember = (m) => ({
              user_id: m.userId ?? '',
              name: m.name ?? '',
              email: m.email ?? '',
              role: m.role ?? '',
              joined_at: toISOString(m.joinedAt),
          });
          const mapBackup = (b) => ({
              id: b.id ?? '',
              status: b.status ?? '',
              started_at: b.startedAt ?? '',
              finished_at: b.finishedAt ?? '',
              size_bytes: b.sizeInBytes ?? 0,
              duration_seconds: b.durationInSeconds ?? 0,
              type: b.type ?? '',
          });
          const mapMetricDataPoint = (p) => ({
              timestamp: p[0] ?? 0,
              value: p[1] ?? 0,
          });
          const mapStatusSummary = (s) => ({
              status: s.status?.indicator ?? '',
              active_incidents: s.ongoing_incidents?.length ?? 0,
              active_maintenances: s.in_progress_maintenances?.length ?? 0,
          });
          const listServices = defineTool({
              name: 'list_services',
              displayName: 'List Services',
              description: 'List all ClickHouse Cloud services in the current organization. Returns service details including state, endpoints, scaling configuration, and version.',
              summary: 'List all services',
              icon: 'server',
              group: 'Services',
              input: z.object({}),
              output: z.object({
                  services: z.array(serviceSchema),
              }),
              handle: async () => {
                  const orgId = getOrgId();
                  if (!orgId)
                      throw ToolError.auth('No organization selected — please open ClickHouse Cloud console.');
                  const instances = getFromCache('instances');
                  if (!instances)
                      throw ToolError.notFound('Service data not found in cache — please reload the console.');
                  const filtered = instances.filter(i => i.organizationId === orgId);
                  return { services: filtered.map(mapService) };
              },
          });


                    var pluginTool = listServices

                    function mapThrown(error) {
                      if (error && error.name === 'ToolError') {
                        var code = error.code || 'TOOL_ERROR'
                        if (error.category === 'auth') code = 'AUTH'
                        else if (error.category === 'not_found') code = 'NOT_FOUND'
                        else if (error.category === 'rate_limit') code = 'RATE_LIMITED'
                        else if (error.category === 'validation') code = 'VALIDATION'
                        else if (error.category === 'timeout') code = 'TIMEOUT'
                        else if (error.category === 'internal') code = 'INTERNAL'
                        return errorEnvelope(code, error.message || 'Tool failed')
                      }
                      return errorEnvelope('UNKNOWN', error && error.message ? error.message : String(error))
                    }

                    function errorEnvelope(code, message) {
                      return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
                    }

                    function okEnvelope(data) {
                      return { status: 'ok', data: data, message: null, page_url: location.href }
                    }

                    function assertPage() {
                      var PRODUCT_HOSTS = {
                        'sqlpad': /(^|\.)(sqlpad\.[a-z0-9.-]+|localhost|127\.0\.0\.1)$/,
                      }
                      var productProbe = PRODUCT_HOSTS['clickhouse'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a ClickHouse Cloud page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)console\\.clickhouse\\.cloud$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a ClickHouse Cloud page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a ClickHouse Cloud page.')
                        }
                      }
                      return null
                    }

                    // Some upstream plugins cache a session token that tools read
                    // synchronously (docker-hub's getUsername()). Upstream primes it in
                    // its activation hook, which a WebMCP package does not have: prime it
                    // once here, or every tool that needs the username reports AUTH.
                    var __authPrimed = false
                    async function __primeAuth() {
                      if (__authPrimed) return
                      __authPrimed = true
                      try {
                        if (typeof refreshAuth === 'function') await refreshAuth()
                        else if (typeof waitForAuth === 'function') await waitForAuth()
                      } catch (e) {
                        // The tool's own auth check reports the failure with its code.
                      }
                    }

                    async function runTool(name, args) {
                      var pageError = assertPage()
                      if (pageError) return pageError
                      try {
                        await __primeAuth()
                        var data = await pluginTool.handle(args || {})
                        return okEnvelope(data === undefined ? {} : data)
                      } catch (error) {
                        return mapThrown(error)
                      }
                    }


          var toolEntry = {
            async list_services(args) {
              return runTool('list_services', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_services'](args)
          }
          return stdin_default
        })()

        return workflow(args)
      }
      let response
      try {
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(input) + ')',
          options,
        )
      } catch (error) {
        // Tab closed/navigated or the eval timed out: surface a stable workflow
        // error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The ClickHouse Cloud tab could not run the tool (it may have closed or navigated away): ' +
            String(error),
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      if (response.tabId !== target.tabId) {
        state.result = {
          status: 'error',
          data: null,
          message: 'Browser returned another tab',
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      const result = response.result
      if (result && result.status === 'ok')
        state.result = { status: 'ok', data: result.data, message: null }
      else if (result)
        state.result = {
          status: 'error',
          data: null,
          message: result.message || 'ClickHouse Cloud API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The ClickHouse Cloud tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
