// Self-contained adapter workflow. The CockroachDB Cloud session and every same-origin
// API call stay inside the CockroachDB Cloud tab.

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
    description: 'list_org_users',
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

          // CockroachDB Cloud uses gRPC-Web over HTTP/1.1 with protobuf encoding.
          // The page exposes a `window.proto` global containing compiled protobuf
          // message classes with serializeBinary() / deserializeBinary() methods.
          // Auth uses HttpOnly session cookies sent via credentials: 'include'.
          const SERVICE = 'console.ManagementConsole';
          const getProto = () => {
              const proto = getPageGlobal('proto');
              if (proto)
                  return proto;
              throw ToolError.internal('Protobuf library not available — page may not be fully loaded.');
          };
          // --- Auth detection ---
          // Auth state is inferred from the presence of initData (a base64-encoded protobuf
          // containing feature flags and session info injected by the server into the HTML).
          // The actual authentication uses HttpOnly session cookies.
          const isAuthenticated = () => {
              const initData = getPageGlobal('initData');
              return typeof initData === 'string' && initData.length > 0;
          };
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // --- gRPC-Web transport ---
          // gRPC-Web frames: [flag:1byte, length:4bytes big-endian, payload:N bytes]
          // flag=0 → data frame, flag=128 → trailer frame (contains grpc-status)
          const encodeGrpcFrame = (payload) => {
              const frame = new Uint8Array(5 + payload.length);
              frame[0] = 0;
              const view = new DataView(frame.buffer);
              view.setUint32(1, payload.length);
              frame.set(payload, 5);
              return frame.buffer;
          };
          const decodeGrpcFrames = (buffer) => {
              const bytes = new Uint8Array(buffer);
              const frames = [];
              let offset = 0;
              while (offset + 5 <= bytes.length) {
                  const flag = bytes[offset];
                  const view = new DataView(buffer, offset + 1, 4);
                  const len = view.getUint32(0);
                  const data = bytes.slice(offset + 5, offset + 5 + len);
                  frames.push({ flag, data });
                  offset += 5 + len;
              }
              return frames;
          };
          const parseGrpcTrailer = (data) => {
              const text = new TextDecoder().decode(data);
              let status = 0;
              let message = '';
              for (const line of text.split('\r\n')) {
                  const statusMatch = line.match(/^grpc-status:\s*(\d+)/);
                  if (statusMatch?.[1])
                      status = Number.parseInt(statusMatch[1], 10);
                  const messageMatch = line.match(/^grpc-message:\s*(.*)/);
                  if (messageMatch?.[1])
                      message = decodeURIComponent(messageMatch[1]);
              }
              return { status, message };
          };
          // gRPC status codes to ToolError mapping
          const grpcStatusToError = (status, message, method) => {
              switch (status) {
                  case 3:
                      return ToolError.validation(`Invalid argument: ${method} — ${message}`);
                  case 5:
                      return ToolError.notFound(`Not found: ${method} — ${message}`);
                  case 7:
                      return ToolError.auth(`Permission denied: ${method} — ${message}`);
                  case 8:
                      return ToolError.rateLimited(`Resource exhausted: ${method} — ${message}`);
                  case 16:
                      return ToolError.auth(`Unauthenticated: ${method} — ${message}`);
                  default:
                      return ToolError.internal(`gRPC error (${status}): ${method} — ${message}`);
              }
          };
          // --- Public API ---
          // Call a gRPC-Web method with a protobuf request, returning the decoded response object.
          // For methods that take no parameters, omit the setup callback.
          // The responseClass parameter accepts undefined to match Record indexing — throws if missing.
          const grpc = async (method, responseClass, setup) => {
              if (!responseClass)
                  throw ToolError.internal(`Missing proto class for ${method} — page may not be fully loaded.`);
              if (!isAuthenticated())
                  throw ToolError.auth('Not authenticated — please log in to CockroachDB Cloud.');
              const proto = getProto();
              let body;
              if (setup) {
                  const req = setup(proto);
                  body = encodeGrpcFrame(req.serializeBinary());
              }
              else {
                  body = encodeGrpcFrame(new Uint8Array(0));
              }
              let response;
              try {
                  response = await fetch(`https://cockroachlabs.cloud/${SERVICE}/${method}`, {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/grpc-web+proto',
                          Accept: 'application/grpc-web+proto',
                          'X-Grpc-Web': '1',
                      },
                      body,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError')
                      throw ToolError.timeout(`Timed out: ${method}`);
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              const buffer = await response.arrayBuffer();
              const frames = decodeGrpcFrames(buffer);
              // Check trailer for errors
              const trailerFrame = frames.find(f => f.flag === 128);
              if (trailerFrame) {
                  const trailer = parseGrpcTrailer(trailerFrame.data);
                  if (trailer.status !== 0)
                      throw grpcStatusToError(trailer.status, trailer.message, method);
              }
              // Decode data frame
              const dataFrame = frames.find(f => f.flag === 0);
              if (!dataFrame || dataFrame.data.length === 0)
                  return {};
              return responseClass.deserializeBinary(dataFrame.data).toObject();
          };
          // Convenience: get the proto.console namespace for building requests
          const getConsoleProto = () => getProto().console;
          const getCommonProto = () => getProto().common;
          // Create a new protobuf request message by class name.
          // Searches console namespace first, then common namespace.
          // Throws if the class is not found (page not fully loaded or wrong class name).
          const newRequest = (className) => {
              const proto = getProto();
              const cls = proto.console[className] ?? proto.common[className];
              if (!cls)
                  throw ToolError.internal(`Proto class ${className} not found — page may not be fully loaded.`);
              return new cls();
          };
          // Get a response class by name, searching console then common then top-level proto.
          const getResponseClass = (className) => {
              const proto = getProto();
              const cls = proto.console[className] ?? proto.common[className];
              if (cls)
                  return cls;
              // Some classes like Empty are on the top-level proto namespace
              const topLevel = getPageGlobal(`proto.${className}`);
              if (topLevel)
                  return topLevel;
              throw ToolError.internal(`Proto response class ${className} not found — page may not be fully loaded.`);
          };
          // Call a setter on a protobuf message. Protobuf messages have dynamically-generated
          // setter methods (setClusterId, setName, etc.) that cannot be typed statically.
          const setField = (msg, setter, value) => {
              const fn = msg[setter];
              if (typeof fn === 'function')
                  fn.call(msg, value);
          };

          // --- Shared output schemas ---
          const timestampSchema = z.string().describe('ISO 8601 timestamp');
          const mapTimestamp = (ts) => {
              if (!ts?.seconds)
                  return '';
              const ms = Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
              return new Date(ms).toISOString();
          };
          // --- Cloud provider / state enum maps ---
          const CLOUD_PROVIDERS = { 0: 'UNKNOWN', 1: 'AWS', 2: 'GCP', 3: 'AZURE' };
          const CLUSTER_STATES = {
              0: 'UNKNOWN',
              1: 'CREATED',
              2: 'CREATING',
              3: 'DELETED',
              4: 'DELETING',
              5: 'CREATE_FAILED',
              6: 'LOCKED',
          };
          const BILLING_PLANS = { 0: 'UNKNOWN', 1: 'DEDICATED', 2: 'FREE', 3: 'ADVANCED', 4: 'BASIC' };
          // --- Zod schemas ---
          const clusterRegionSchema = z.object({
              id: z.string().describe('Region ID'),
              cloud_region_code: z.string().describe('Cloud region code (e.g., us-west-2)'),
              cloud_region_name: z.string().describe('Human-readable region name (e.g., Oregon)'),
              is_primary: z.boolean().describe('Whether this is the primary region'),
              locality: z.string().describe('Locality string'),
              num_nodes: z.number().int().describe('Number of nodes in this region'),
              sql_dns: z.string().describe('SQL connection DNS endpoint'),
          });
          const clusterSchema = z.object({
              id: z.string().describe('Cluster UUID'),
              name: z.string().describe('Cluster name'),
              cockroach_version: z.string().describe('CockroachDB version'),
              cloud_provider: z.string().describe('Cloud provider (AWS, GCP, AZURE)'),
              state: z.string().describe('Cluster state (CREATED, CREATING, DELETED, etc.)'),
              billing_plan: z.string().describe('Billing plan (BASIC, ADVANCED, DEDICATED, FREE)'),
              sql_dns: z.string().describe('SQL connection DNS endpoint'),
              regions: z.array(clusterRegionSchema).describe('List of cluster regions'),
              created_at: timestampSchema,
              updated_at: timestampSchema,
              delete_protection: z.boolean().describe('Whether delete protection is enabled'),
          });
          const clusterDetailSchema = clusterSchema.extend({
              organization_id: z.string().describe('Organization UUID'),
              creator_id: z.string().describe('Creator user UUID'),
              usage_limits: z
                  .object({
                  monthly_request_unit_limit: z.number().describe('Monthly request unit limit'),
                  monthly_storage_mib_limit: z.number().describe('Monthly storage limit in MiB'),
                  provisioned_vcpus_limit: z.number().describe('Provisioned vCPU limit'),
              })
                  .describe('Usage limits for the cluster'),
          });
          const organizationSchema = z.object({
              id: z.string().describe('Organization UUID'),
              name: z.string().describe('Organization name'),
              label: z.string().describe('Organization label (slug)'),
              billing_plan: z.string().describe('Default billing plan'),
              created_at: timestampSchema,
          });
          const databaseUserSchema = z.object({
              name: z.string().describe('Database username'),
              is_internal: z.boolean().describe('Whether this is a system-internal user'),
          });
          const userSchema = z.object({
              id: z.string().describe('User UUID'),
              email: z.string().describe('User email address'),
              full_name: z.string().describe('User full name'),
              created_at: timestampSchema,
          });
          const memberSchema = z.object({
              user_id: z.string().describe('User UUID'),
              email: z.string().describe('User email address'),
              full_name: z.string().describe('User full name'),
              created_at: timestampSchema,
          });
          const invoiceSchema = z.object({
              id: z.string().describe('Invoice ID'),
              period_start: timestampSchema.describe('Billing period start'),
              period_end: timestampSchema.describe('Billing period end'),
              amount_due: z.number().describe('Amount due in cents'),
              amount_paid: z.number().describe('Amount paid in cents'),
          });
          const usageSchema = z.object({
              consumed_request_units: z.number().describe('Request units consumed in current period'),
              current_storage_gib: z.number().describe('Current storage usage in GiB'),
          });
          // --- Defensive mappers ---
          const mapClusterRegion = (r) => ({
              id: r.id ?? '',
              cloud_region_code: r.cloudRegion?.code ?? '',
              cloud_region_name: r.cloudRegion?.name ?? '',
              is_primary: r.isPrimary ?? false,
              locality: r.locality ?? '',
              num_nodes: r.numNodes ?? 0,
              sql_dns: r.sqlDns ?? '',
          });
          const mapCluster = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              cockroach_version: c.cockroachVersion ?? '',
              cloud_provider: CLOUD_PROVIDERS[c.cloudProvider ?? 0] ?? 'UNKNOWN',
              state: CLUSTER_STATES[c.state ?? 0] ?? 'UNKNOWN',
              billing_plan: BILLING_PLANS[c.billingPlan ?? 0] ?? 'UNKNOWN',
              sql_dns: c.sqlDns ?? '',
              regions: (c.regionsList ?? []).map(mapClusterRegion),
              created_at: mapTimestamp(c.createdAt),
              updated_at: mapTimestamp(c.updatedAt),
              delete_protection: c.deleteProtection === 1,
          });
          const mapClusterDetail = (c) => ({
              ...mapCluster(c),
              organization_id: c.organizationId ?? '',
              creator_id: c.creatorId ?? '',
              usage_limits: {
                  monthly_request_unit_limit: c.usageLimits?.monthlyRequestUnitLimit ?? 0,
                  monthly_storage_mib_limit: c.usageLimits?.monthlyStorageMibLimit ?? 0,
                  provisioned_vcpus_limit: c.usageLimits?.provisionedVcpusLimit ?? 0,
              },
          });
          const mapOrganization = (o) => ({
              id: o.id ?? '',
              name: o.name ?? '',
              label: o.label ?? '',
              billing_plan: BILLING_PLANS[o.defaultBillingPlan ?? 0] ?? 'UNKNOWN',
              created_at: mapTimestamp(o.createdAt),
          });
          const mapDatabaseUser = (u) => ({
              name: u.name ?? '',
              is_internal: u.isInternal ?? false,
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              email: u.email ?? '',
              full_name: u.fullName ?? '',
              created_at: mapTimestamp(u.createdAt),
          });
          const mapMember = (m) => ({
              user_id: m.userId ?? '',
              email: m.user?.email ?? '',
              full_name: m.user?.fullName ?? '',
              created_at: mapTimestamp(m.createdAt),
          });
          const mapInvoice = (i) => ({
              id: i.id ?? '',
              period_start: mapTimestamp(i.periodStart),
              period_end: mapTimestamp(i.periodEnd),
              amount_due: i.amountDue ?? 0,
              amount_paid: i.amountPaid ?? 0,
          });
          const listOrgUsers = defineTool({
              name: 'list_org_users',
              displayName: 'List Organization Members',
              description: 'List all members of the current CockroachDB Cloud organization with their email addresses and names.',
              summary: 'List organization members',
              icon: 'users',
              group: 'Organization',
              input: z.object({}),
              output: z.object({ members: z.array(memberSchema).describe('List of organization members') }),
              handle: async () => {
                  const p = getConsoleProto();
                  const data = await grpc('ListOrgUsers', p.ListOrgUsersResponse);
                  return { members: (data.usersList ?? []).map(mapMember) };
              },
          });


                    var pluginTool = listOrgUsers

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
                      var productProbe = PRODUCT_HOSTS['cockroachdb'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a CockroachDB Cloud page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)cockroachlabs\\.cloud$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a CockroachDB Cloud page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a CockroachDB Cloud page.')
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
            async list_org_users(args) {
              return runTool('list_org_users', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_org_users'](args)
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
            'The CockroachDB Cloud tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'CockroachDB Cloud API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The CockroachDB Cloud tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
