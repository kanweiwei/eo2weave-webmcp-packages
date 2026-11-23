// Self-contained adapter workflow. The Google Cloud session and every same-origin
// API call stay inside the Google Cloud tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "service_name": {
        "type": "string",
        "description": "Service API name (e.g., \"compute.googleapis.com\")"
      },
      "project_id": {
        "description": "Project ID (defaults to currently active project)",
        "type": "string"
      }
    },
    "required": [
      "service_name"
    ],
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
    description: 'disable_service',
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

          // ---------------------------------------------------------------------------
          // Auth detection
          // ---------------------------------------------------------------------------
          const getGapi = () => {
              const gapi = getPageGlobal('gapi');
              return gapi?.client ?? null;
          };
          const isAuthenticated = () => {
              // gapi.client must be loaded AND user must have a session cookie
              return getGapi() !== null && !!getCookie('SAPISID');
          };
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), {
                      interval: 500,
                      timeout: 8000,
                  });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const getProjectFromUrl = () => {
              const url = getCurrentUrl();
              const match = url.match(/[?&]project=([^&#]+)/);
              return match?.[1] ?? null;
          };
          const getProjectContext = () => {
              const cached = getAuthCache('google-cloud');
              const urlProject = getProjectFromUrl();
              if (urlProject) {
                  if (!cached || cached.projectId !== urlProject) {
                      setAuthCache('google-cloud', { projectId: urlProject });
                  }
                  return { projectId: urlProject };
              }
              return cached;
          };
          const resolveProjectId = (explicit) => {
              if (explicit)
                  return explicit;
              const ctx = getProjectContext();
              if (ctx?.projectId)
                  return ctx.projectId;
              throw ToolError.validation('No project ID found — provide a project_id parameter or navigate to a project in the console.');
          };
          // ---------------------------------------------------------------------------
          // API caller
          // ---------------------------------------------------------------------------
          const classifyGapiError = (err) => {
              const code = err.result?.error?.code ?? err.status;
              const message = err.result?.error?.message ?? `GCP API error (HTTP ${err.status})`;
              switch (code) {
                  case 401:
                  case 403:
                      clearAuthCache('google-cloud');
                      throw ToolError.auth(message);
                  case 404:
                      throw ToolError.notFound(message);
                  case 429:
                      throw ToolError.rateLimited(message);
                  case 400:
                      throw ToolError.validation(message);
                  case 0:
                      throw ToolError.timeout(message);
                  default:
                      throw ToolError.internal(message);
              }
          };
          /**
           * Call a GCP REST API via gapi.client.request().
           * Auth (SAPISIDHASH + cookies) is handled automatically by the gapi proxy.
           */
          const gcpApi = async (path, options = {}) => {
              const client = getGapi();
              if (!client)
                  throw ToolError.auth('Not authenticated — please log in to Google Cloud Console.');
              const method = options.method ?? 'GET';
              // Filter out undefined params
              const params = {};
              if (options.params) {
                  for (const [k, v] of Object.entries(options.params)) {
                      if (v !== undefined)
                          params[k] = v;
                  }
              }
              const result = await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject({ status: 0, result: { error: { code: 0, message: 'Request timed out after 25 seconds' } } }), 25000);
                  client
                      .request({
                      path,
                      method,
                      params: Object.keys(params).length > 0 ? params : undefined,
                      body: options.body,
                  })
                      .then(response => {
                      clearTimeout(timeout);
                      resolve(response.result);
                  }, err => {
                      clearTimeout(timeout);
                      reject(err);
                  });
              }).catch(err => classifyGapiError(err));
              return result;
          };

          // ---------------------------------------------------------------------------
          // Projects
          // ---------------------------------------------------------------------------
          const projectSchema = z.object({
              project_id: z.string().describe('Project ID (e.g., "my-project")'),
              project_number: z.string().describe('Numeric project number'),
              name: z.string().describe('Project display name'),
              state: z.string().describe('Lifecycle state (e.g., ACTIVE, DELETE_REQUESTED)'),
              create_time: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapProjectV1 = (p) => ({
              project_id: p.projectId ?? '',
              project_number: p.projectNumber ?? '',
              name: p.name ?? '',
              state: p.lifecycleState ?? '',
              create_time: p.createTime ?? '',
          });
          const mapProjectV3 = (p) => ({
              project_id: p.projectId ?? '',
              project_number: p.name?.replace('projects/', '') ?? '',
              name: p.displayName ?? '',
              state: p.state ?? '',
              create_time: p.createTime ?? '',
          });
          // ---------------------------------------------------------------------------
          // Compute — Instances
          // ---------------------------------------------------------------------------
          const instanceSchema = z.object({
              id: z.string().describe('Instance numeric ID'),
              name: z.string().describe('Instance name'),
              zone: z.string().describe('Zone (e.g., "us-central1-a")'),
              machine_type: z.string().describe('Machine type (e.g., "e2-medium")'),
              status: z.string().describe('Instance status (e.g., RUNNING, TERMINATED, STOPPED)'),
              internal_ip: z.string().describe('Primary internal IP address'),
              external_ip: z.string().describe('Primary external IP address (empty if none)'),
              creation_timestamp: z.string().describe('ISO 8601 creation timestamp'),
          });
          const shortZone = (z) => z?.split('/').pop() ?? '';
          const shortMachineType = (m) => m?.split('/').pop() ?? '';
          const mapInstance = (i) => ({
              id: i.id ?? '',
              name: i.name ?? '',
              zone: shortZone(i.zone),
              machine_type: shortMachineType(i.machineType),
              status: i.status ?? '',
              internal_ip: i.networkInterfaces?.[0]?.networkIP ?? '',
              external_ip: i.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? '',
              creation_timestamp: i.creationTimestamp ?? '',
          });
          // ---------------------------------------------------------------------------
          // Compute — Disks
          // ---------------------------------------------------------------------------
          const diskSchema = z.object({
              id: z.string().describe('Disk numeric ID'),
              name: z.string().describe('Disk name'),
              zone: z.string().describe('Zone'),
              size_gb: z.string().describe('Disk size in GB'),
              type: z.string().describe('Disk type (e.g., pd-standard, pd-ssd)'),
              status: z.string().describe('Disk status (e.g., READY)'),
              creation_timestamp: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapDisk = (d) => ({
              id: d.id ?? '',
              name: d.name ?? '',
              zone: shortZone(d.zone),
              size_gb: d.sizeGb ?? '',
              type: d.type?.split('/').pop() ?? '',
              status: d.status ?? '',
              creation_timestamp: d.creationTimestamp ?? '',
          });
          // ---------------------------------------------------------------------------
          // Compute — Networks
          // ---------------------------------------------------------------------------
          const networkSchema = z.object({
              id: z.string().describe('Network numeric ID'),
              name: z.string().describe('Network name'),
              auto_create_subnetworks: z.boolean().describe('Whether subnets are auto-created'),
              routing_mode: z.string().describe('Routing mode (REGIONAL or GLOBAL)'),
              creation_timestamp: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapNetwork = (n) => ({
              id: n.id ?? '',
              name: n.name ?? '',
              auto_create_subnetworks: n.autoCreateSubnetworks ?? false,
              routing_mode: n.routingConfig?.routingMode ?? '',
              creation_timestamp: n.creationTimestamp ?? '',
          });
          // ---------------------------------------------------------------------------
          // Compute — Firewalls
          // ---------------------------------------------------------------------------
          const firewallSchema = z.object({
              id: z.string().describe('Firewall numeric ID'),
              name: z.string().describe('Firewall rule name'),
              network: z.string().describe('Network name the rule applies to'),
              direction: z.string().describe('Direction (INGRESS or EGRESS)'),
              priority: z.number().describe('Rule priority (0-65535, lower = higher priority)'),
              disabled: z.boolean().describe('Whether the rule is disabled'),
              creation_timestamp: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapFirewall = (f) => ({
              id: f.id ?? '',
              name: f.name ?? '',
              network: f.network?.split('/').pop() ?? '',
              direction: f.direction ?? '',
              priority: f.priority ?? 0,
              disabled: f.disabled ?? false,
              creation_timestamp: f.creationTimestamp ?? '',
          });
          // ---------------------------------------------------------------------------
          // Storage — Buckets
          // ---------------------------------------------------------------------------
          const bucketSchema = z.object({
              name: z.string().describe('Bucket name'),
              location: z.string().describe('Location (e.g., US, US-CENTRAL1)'),
              storage_class: z.string().describe('Default storage class (e.g., STANDARD, NEARLINE)'),
              creation_time: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapBucket = (b) => ({
              name: b.name ?? '',
              location: b.location ?? '',
              storage_class: b.storageClass ?? '',
              creation_time: b.timeCreated ?? '',
          });
          // ---------------------------------------------------------------------------
          // Storage — Objects
          // ---------------------------------------------------------------------------
          const objectSchema = z.object({
              name: z.string().describe('Object name (key/path)'),
              size: z.string().describe('Object size in bytes'),
              content_type: z.string().describe('MIME content type'),
              updated: z.string().describe('ISO 8601 last-modified timestamp'),
          });
          const mapObject = (o) => ({
              name: o.name ?? '',
              size: o.size ?? '0',
              content_type: o.contentType ?? '',
              updated: o.updated ?? '',
          });
          // ---------------------------------------------------------------------------
          // IAM — Service Accounts
          // ---------------------------------------------------------------------------
          const serviceAccountSchema = z.object({
              email: z.string().describe('Service account email'),
              name: z.string().describe('Resource name'),
              display_name: z.string().describe('Display name'),
              disabled: z.boolean().describe('Whether the service account is disabled'),
          });
          const mapServiceAccount = (sa) => ({
              email: sa.email ?? '',
              name: sa.name ?? '',
              display_name: sa.displayName ?? '',
              disabled: sa.disabled ?? false,
          });
          // ---------------------------------------------------------------------------
          // IAM — Roles
          // ---------------------------------------------------------------------------
          const roleSchema = z.object({
              name: z.string().describe('Role resource name'),
              title: z.string().describe('Role title'),
              description: z.string().describe('Role description'),
              stage: z.string().describe('Launch stage (e.g., GA, BETA)'),
          });
          const mapRole = (r) => ({
              name: r.name ?? '',
              title: r.title ?? '',
              description: r.description ?? '',
              stage: r.stage ?? '',
          });
          // ---------------------------------------------------------------------------
          // IAM — Policy Binding
          // ---------------------------------------------------------------------------
          const bindingSchema = z.object({
              role: z.string().describe('IAM role'),
              members: z.array(z.string()).describe('List of member identities'),
          });
          const mapBinding = (b) => ({
              role: b.role ?? '',
              members: b.members ?? [],
          });
          // ---------------------------------------------------------------------------
          // Services
          // ---------------------------------------------------------------------------
          const serviceSchema = z.object({
              name: z.string().describe('Service resource name'),
              service_name: z.string().describe('Service API name (e.g., compute.googleapis.com)'),
              title: z.string().describe('Service display title'),
              state: z.string().describe('State (ENABLED or DISABLED)'),
          });
          const mapService = (s) => ({
              name: s.name ?? '',
              service_name: s.config?.name ?? '',
              title: s.config?.title ?? '',
              state: s.state ?? '',
          });
          // ---------------------------------------------------------------------------
          // Cloud Functions
          // ---------------------------------------------------------------------------
          const cloudFunctionSchema = z.object({
              name: z.string().describe('Function resource name'),
              state: z.string().describe('State (e.g., ACTIVE, DEPLOYING)'),
              environment: z.string().describe('Environment (GEN_1 or GEN_2)'),
              runtime: z.string().describe('Runtime (e.g., nodejs20, python312)'),
              entry_point: z.string().describe('Function entry point'),
              url: z.string().describe('HTTPS trigger URL (empty if not HTTP-triggered)'),
              update_time: z.string().describe('ISO 8601 last-update timestamp'),
          });
          const mapCloudFunction = (f) => ({
              name: f.name ?? '',
              state: f.state ?? '',
              environment: f.environment ?? '',
              runtime: f.buildConfig?.runtime ?? '',
              entry_point: f.buildConfig?.entryPoint ?? '',
              url: f.serviceConfig?.uri ?? '',
              update_time: f.updateTime ?? '',
          });
          // ---------------------------------------------------------------------------
          // Cloud Run — Services
          // ---------------------------------------------------------------------------
          const cloudRunServiceSchema = z.object({
              name: z.string().describe('Service resource name'),
              uri: z.string().describe('Service URL'),
              creator: z.string().describe('Creator email'),
              last_modifier: z.string().describe('Last modifier email'),
              ingress: z.string().describe('Ingress setting (e.g., INGRESS_TRAFFIC_ALL)'),
              launch_stage: z.string().describe('Launch stage (e.g., GA, BETA)'),
              create_time: z.string().describe('ISO 8601 creation timestamp'),
              update_time: z.string().describe('ISO 8601 last-update timestamp'),
          });
          const mapCloudRunService = (s) => ({
              name: s.name ?? '',
              uri: s.uri ?? '',
              creator: s.creator ?? '',
              last_modifier: s.lastModifier ?? '',
              ingress: s.ingress ?? '',
              launch_stage: s.launchStage ?? '',
              create_time: s.createTime ?? '',
              update_time: s.updateTime ?? '',
          });
          // ---------------------------------------------------------------------------
          // Logging
          // ---------------------------------------------------------------------------
          const logEntrySchema = z.object({
              log_name: z.string().describe('Log resource name'),
              severity: z.string().describe('Severity (e.g., INFO, WARNING, ERROR)'),
              timestamp: z.string().describe('ISO 8601 timestamp'),
              text: z.string().describe('Log message text'),
              resource_type: z.string().describe('Monitored resource type'),
          });
          const mapLogEntry = (e) => {
              let text = e.textPayload ?? '';
              if (!text && e.jsonPayload)
                  text = JSON.stringify(e.jsonPayload);
              if (!text && e.protoPayload)
                  text = JSON.stringify(e.protoPayload);
              return {
                  log_name: e.logName ?? '',
                  severity: e.severity ?? 'DEFAULT',
                  timestamp: e.timestamp ?? '',
                  text,
                  resource_type: e.resource?.type ?? '',
              };
          };
          // ---------------------------------------------------------------------------
          // Billing
          // ---------------------------------------------------------------------------
          const billingAccountSchema = z.object({
              name: z.string().describe('Billing account resource name'),
              display_name: z.string().describe('Display name'),
              open: z.boolean().describe('Whether the account is open'),
          });
          const mapBillingAccount = (b) => ({
              name: b.name ?? '',
              display_name: b.displayName ?? '',
              open: b.open ?? false,
          });
          const billingInfoSchema = z.object({
              project_id: z.string().describe('Project ID'),
              billing_account_name: z.string().describe('Associated billing account resource name'),
              billing_enabled: z.boolean().describe('Whether billing is enabled'),
          });
          const mapBillingInfo = (b) => ({
              project_id: b.projectId ?? '',
              billing_account_name: b.billingAccountName ?? '',
              billing_enabled: b.billingEnabled ?? false,
          });
          // ---------------------------------------------------------------------------
          // Kubernetes (GKE)
          // ---------------------------------------------------------------------------
          const clusterSchema = z.object({
              name: z.string().describe('Cluster name'),
              location: z.string().describe('Cluster location (zone or region)'),
              status: z.string().describe('Cluster status (e.g., RUNNING, PROVISIONING)'),
              node_count: z.number().describe('Total node count'),
              cluster_version: z.string().describe('Kubernetes master version'),
              endpoint: z.string().describe('Cluster API server endpoint'),
              create_time: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapCluster = (c) => ({
              name: c.name ?? '',
              location: c.location ?? '',
              status: c.status ?? '',
              node_count: c.currentNodeCount ?? 0,
              cluster_version: c.currentMasterVersion ?? '',
              endpoint: c.endpoint ?? '',
              create_time: c.createTime ?? '',
          });
          // ---------------------------------------------------------------------------
          // Cloud SQL
          // ---------------------------------------------------------------------------
          const sqlInstanceSchema = z.object({
              name: z.string().describe('Instance name'),
              database_version: z.string().describe('Database version (e.g., POSTGRES_15, MYSQL_8_0)'),
              state: z.string().describe('Instance state (e.g., RUNNABLE, SUSPENDED)'),
              region: z.string().describe('Region (e.g., us-central1)'),
              tier: z.string().describe('Machine tier (e.g., db-f1-micro)'),
              ip_address: z.string().describe('Primary IP address'),
              create_time: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapSqlInstance = (s) => ({
              name: s.name ?? '',
              database_version: s.databaseVersion ?? '',
              state: s.state ?? '',
              region: s.region ?? '',
              tier: s.settings?.tier ?? '',
              ip_address: s.ipAddresses?.find(ip => ip.type === 'PRIMARY')?.ipAddress ?? '',
              create_time: s.createTime ?? '',
          });
          const disableService = defineTool({
              name: 'disable_service',
              displayName: 'Disable Service',
              description: 'Disable a GCP API service in the project. WARNING: This may break resources that depend on this service.',
              summary: 'Disable a GCP API service',
              icon: 'toggle-left',
              group: 'Services',
              input: z.object({
                  service_name: z.string().describe('Service API name (e.g., "compute.googleapis.com")'),
                  project_id: z.string().optional().describe('Project ID (defaults to currently active project)'),
              }),
              output: z.object({ success: z.boolean().describe('Whether the operation was initiated') }),
              handle: async (params) => {
                  const projectId = resolveProjectId(params.project_id);
                  await gcpApi(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${params.service_name}:disable`, { method: 'POST', body: {} });
                  return { success: true };
              },
          });


                    var pluginTool = disableService

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
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Cloud page.')
                      }
                      if (!/(^|\.)cloud\.google\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Cloud page.')
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
            async disable_service(args) {
              return runTool('disable_service', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['disable_service'](args)
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
            'The Google Cloud tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Cloud API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Google Cloud tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
