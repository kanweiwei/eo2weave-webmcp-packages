// Self-contained adapter workflow. The Google Analytics session and every same-origin
// API call stay inside the Google Analytics tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "property_id": {
        "type": "string",
        "description": "GA4 property ID (numeric string)"
      },
      "dimensions": {
        "description": "Realtime dimension API names (e.g., [\"country\", \"unifiedScreenName\"])",
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "metrics": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Realtime metric API names (e.g., [\"activeUsers\", \"eventCount\"]). At least 1 required."
      },
      "dimension_filter": {
        "description": "JSON string of a dimension filter object for realtime data",
        "type": "string"
      },
      "metric_filter": {
        "description": "JSON string of a metric filter object for realtime data",
        "type": "string"
      },
      "limit": {
        "description": "Max rows to return (default 100)",
        "type": "integer",
        "minimum": 1,
        "maximum": 10000
      }
    },
    "required": [
      "property_id",
      "metrics"
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
    description: 'run_realtime_report',
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

                    function getCurrentUrl() {
                      return typeof location !== 'undefined' ? location.href : ''
                    }

                    var __authCache = {}
                    function getAuthCache(ns) { return __authCache[ns] || null }
                    function setAuthCache(ns, value) { __authCache[ns] = value }
                    function clearAuthCache(ns) { delete __authCache[ns] }

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

          // --- Auth detection ---
          const getAuth = () => {
              const cached = getAuthCache('google-analytics');
              if (cached)
                  return cached;
              const apiKey = getPageGlobal('preload.globals.gmsSuiteApiKey');
              const authuser = getPageGlobal('preload.globals.authuser') ?? '0';
              const sapisid = getCookie('SAPISID');
              if (!apiKey || !sapisid)
                  return null;
              const auth = { apiKey, authuser, sapisid };
              setAuthCache('google-analytics', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          const getGapiClient = () => {
              const gapi = getPageGlobal('gapi');
              return gapi?.client ?? null;
          };
          // --- API callers ---
          const gapiRequest = async (opts) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Google Analytics.');
              const client = getGapiClient();
              if (!client)
                  throw ToolError.internal('Google API client (gapi.client) not available on page.');
              const params = { key: auth.apiKey };
              if (opts.params) {
                  for (const [k, v] of Object.entries(opts.params)) {
                      if (v !== undefined)
                          params[k] = String(v);
                  }
              }
              const headers = {};
              if (opts.body) {
                  headers['Content-Type'] = 'application/json';
              }
              return new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => {
                      reject(ToolError.timeout('Google Analytics API request timed out after 30 seconds.'));
                  }, 30_000);
                  client
                      .request({
                      path: opts.path,
                      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
                      params,
                      body: opts.body ? JSON.stringify(opts.body) : undefined,
                      headers,
                  })
                      .then((resp) => {
                      clearTimeout(timeout);
                      resolve(resp.result);
                  }, (err) => {
                      clearTimeout(timeout);
                      const gapiErr = err;
                      const status = gapiErr?.status ?? gapiErr?.result?.error?.code;
                      const message = gapiErr?.result?.error?.message ?? 'Google Analytics API error';
                      if (status === 401) {
                          clearAuthCache('google-analytics');
                          reject(ToolError.auth(message));
                          return;
                      }
                      if (status === 403) {
                          reject(ToolError.auth(message));
                          return;
                      }
                      if (status === 404) {
                          reject(ToolError.notFound(message));
                          return;
                      }
                      if (status === 429) {
                          reject(ToolError.rateLimited(message));
                          return;
                      }
                      if (status === 400) {
                          reject(ToolError.validation(message));
                          return;
                      }
                      reject(ToolError.internal(message));
                  });
              });
          };
          // Suite Frontend API (accounts, entities)
          const SUITE_BASE = 'https://analyticssuitefrontend-pa.clients6.google.com';
          const suiteApi = async (endpoint, body) => {
              return gapiRequest({
                  path: `${SUITE_BASE}${endpoint}`,
                  body,
              });
          };
          // Data API (reports, metadata)
          const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';
          const dataApi = async (endpoint, body) => {
              return gapiRequest({
                  path: `${DATA_BASE}${endpoint}`,
                  body,
              });
          };
          // --- Preload data accessors ---
          const getPreloadAccountTree = () => getPageGlobal('preload.accountTree');
          const getObfuscatedUserId = () => getPageGlobal('preload.obfuscatedUserId') ?? '';
          const getActivePropertyId = () => {
              const hash = typeof window !== 'undefined' ? window.location.hash : '';
              // URL format: #/p<propertyId>/... or #/a<accountId>p<propertyId>/...
              const match = hash.match(/p(\d+)/);
              const propertyId = match?.[1];
              if (propertyId && propertyId !== '0')
                  return propertyId;
              return null;
          };

          // --- Account / Property schemas ---
          const accountSchema = z.object({
              id: z.string().describe('GA account ID (numeric string)'),
              name: z.string().describe('Account display name'),
              entity_id: z.string().describe('Internal entity ID'),
              status: z.string().describe('Account status (e.g., ACTIVE)'),
          });
          const mapAccount = (h) => ({
              id: h.id ?? '',
              name: h.name ?? '',
              entity_id: h.entityId ?? '',
              status: h.accountMeta?.accountStatus ?? '',
          });
          const propertySchema = z.object({
              id: z.string().describe('GA account-level property ID'),
              name: z.string().describe('Property display name'),
              property_id: z.string().describe('GA4 property ID (numeric, used in API calls)'),
              account_id: z.string().describe('Parent account ID'),
              service_level: z.string().describe('Service level (e.g., STANDARD, PREMIUM)'),
          });
          const mapProperty = (h) => ({
              id: h.id ?? '',
              name: h.name ?? '',
              property_id: h.propertyMeta?.propertyId ?? '',
              account_id: h.parentId ?? '',
              service_level: h.propertyMeta?.serviceLevel ?? '',
          });
          // --- Metadata schemas ---
          const dimensionMetadataSchema = z.object({
              api_name: z.string().describe('API field name (e.g., "country", "sessionSource")'),
              ui_name: z.string().describe('Human-readable name shown in GA4 UI'),
              description: z.string().describe('What this dimension represents'),
              category: z.string().describe('Grouping category (e.g., "User", "Traffic source", "Event")'),
          });
          const mapDimensionMetadata = (d) => ({
              api_name: d.apiName ?? '',
              ui_name: d.uiName ?? '',
              description: d.description ?? '',
              category: d.category ?? '',
          });
          const metricMetadataSchema = z.object({
              api_name: z.string().describe('API field name (e.g., "activeUsers", "sessions")'),
              ui_name: z.string().describe('Human-readable name shown in GA4 UI'),
              description: z.string().describe('What this metric measures'),
              category: z.string().describe('Grouping category (e.g., "User", "Session", "Event")'),
              type: z.string().describe('Data type (e.g., TYPE_INTEGER, TYPE_FLOAT, TYPE_CURRENCY)'),
          });
          const mapMetricMetadata = (m) => ({
              api_name: m.apiName ?? '',
              ui_name: m.uiName ?? '',
              description: m.description ?? '',
              category: m.category ?? '',
              type: m.type ?? '',
          });
          // --- Report schemas ---
          const reportRowSchema = z.object({
              dimensions: z.array(z.string()).describe('Dimension values for this row'),
              metrics: z.array(z.string()).describe('Metric values for this row'),
          });
          const mapReportRow = (r) => ({
              dimensions: (r.dimensionValues ?? []).map(d => d.value ?? ''),
              metrics: (r.metricValues ?? []).map(m => m.value ?? ''),
          });
          const reportHeaderSchema = z.object({
              name: z.string().describe('Dimension or metric API name'),
          });
          const mapReportHeader = (h) => ({
              name: h.name ?? '',
          });
          // --- Compatibility schemas ---
          const compatibilityResultSchema = z.object({
              compatible: z.boolean().describe('Whether the dimension/metric is compatible with the query'),
              api_name: z.string().describe('API field name'),
          });
          const mapDimensionCompatibility = (c) => ({
              compatible: c.compatibility === 'COMPATIBLE',
              api_name: c.dimensionMetadata?.apiName ?? '',
          });
          const mapMetricCompatibility = (c) => ({
              compatible: c.compatibility === 'COMPATIBLE',
              api_name: c.metricMetadata?.apiName ?? '',
          });
          const runRealtimeReport = defineTool({
              name: 'run_realtime_report',
              displayName: 'Run Realtime Report',
              description: 'Run a realtime analytics report showing data from the last 30 minutes. Useful for monitoring live traffic, active users, current page views, and event activity. Common realtime dimensions: "country", "city", "unifiedScreenName", "eventName", "platform", "deviceCategory". Common realtime metrics: "activeUsers", "eventCount", "screenPageViews", "conversions". Not all standard dimensions/metrics are available in realtime — use get_metadata with the property ID to check availability.',
              summary: 'Get realtime analytics data (last 30 minutes)',
              icon: 'activity',
              group: 'Reporting',
              input: z.object({
                  property_id: z.string().describe('GA4 property ID (numeric string)'),
                  dimensions: z
                      .array(z.string())
                      .optional()
                      .describe('Realtime dimension API names (e.g., ["country", "unifiedScreenName"])'),
                  metrics: z
                      .array(z.string())
                      .describe('Realtime metric API names (e.g., ["activeUsers", "eventCount"]). At least 1 required.'),
                  dimension_filter: z.string().optional().describe('JSON string of a dimension filter object for realtime data'),
                  metric_filter: z.string().optional().describe('JSON string of a metric filter object for realtime data'),
                  limit: z.number().int().min(1).max(10000).optional().describe('Max rows to return (default 100)'),
              }),
              output: z.object({
                  dimension_headers: z.array(reportHeaderSchema).describe('Names of dimensions in result rows'),
                  metric_headers: z.array(reportHeaderSchema).describe('Names of metrics in result rows'),
                  rows: z.array(reportRowSchema).describe('Realtime data rows'),
                  row_count: z.number().describe('Total number of rows'),
              }),
              handle: async (params) => {
                  const body = {
                      metrics: params.metrics.map(name => ({ name })),
                      limit: String(params.limit ?? 100),
                  };
                  if (params.dimensions?.length) {
                      body.dimensions = params.dimensions.map(name => ({ name }));
                  }
                  if (params.dimension_filter) {
                      try {
                          body.dimensionFilter = JSON.parse(params.dimension_filter);
                      }
                      catch {
                          throw ToolError.validation('dimension_filter must be valid JSON');
                      }
                  }
                  if (params.metric_filter) {
                      try {
                          body.metricFilter = JSON.parse(params.metric_filter);
                      }
                      catch {
                          throw ToolError.validation('metric_filter must be valid JSON');
                      }
                  }
                  const data = await dataApi(`/properties/${params.property_id}:runRealtimeReport`, body);
                  return {
                      dimension_headers: (data.dimensionHeaders ?? []).map(mapReportHeader),
                      metric_headers: (data.metricHeaders ?? []).map(mapReportHeader),
                      rows: (data.rows ?? []).map(mapReportRow),
                      row_count: data.rowCount ?? 0,
                  };
              },
          });


                    var pluginTool = runRealtimeReport

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Analytics page.')
                      }
                      if (!/(^|\.)analytics\.google\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Analytics page.')
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
            async run_realtime_report(args) {
              return runTool('run_realtime_report', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['run_realtime_report'](args)
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
            'The Google Analytics tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Analytics API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Google Analytics tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
