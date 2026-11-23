// Self-contained adapter workflow. The New Relic session and every same-origin
// API call stay inside the New Relic tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991,
        "description": "Account ID"
      },
      "cursor": {
        "description": "Pagination cursor from a previous response",
        "type": "string"
      }
    },
    "required": [
      "account_id"
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
    description: 'list_alert_policies',
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

          const GRAPHQL_URL = 'https://one.newrelic.com/graphql';
          /**
           * Auth detection via `window.__nr.userId` page global.
           * New Relic uses HttpOnly session cookies — no visible bearer token.
           * The `newrelic-requesting-services` header identifies the request as first-party.
           */
          const isAuth = () => {
              const userId = getPageGlobal('__nr.userId');
              return userId !== undefined && userId !== null;
          };
          const isAuthenticated = () => isAuth();
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          /**
           * Execute a NerdGraph GraphQL query against the same-origin proxy.
           * Auth is handled via HttpOnly session cookies (`credentials: 'include'`).
           * The `newrelic-requesting-services` and `x-requested-with` headers are required.
           */
          const graphql = async (query, variables = {}) => {
              if (!isAuth())
                  throw ToolError.auth('Not authenticated — please log in to New Relic.');
              const response = await fetchFromPage(GRAPHQL_URL, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json; charset=utf-8',
                      'newrelic-requesting-services': 'platform|nr1-ui',
                      'x-requested-with': 'XMLHttpRequest',
                  },
                  body: JSON.stringify({ query, variables }),
              });
              const json = (await response.json());
              if (json.errors?.length) {
                  const msg = json.errors.map(e => e.message).join('; ');
                  if (!json.data) {
                      if (msg.includes('NOT_FOUND'))
                          throw ToolError.notFound(msg);
                      if (msg.includes('FORBIDDEN') || msg.includes('Api-Key'))
                          throw ToolError.auth(msg);
                      throw ToolError.internal(msg);
                  }
                  log.warn('GraphQL partial errors', { errors: json.errors.map(e => e.message) });
              }
              return json.data;
          };

          // --- Account & User ---
          const userSchema = z.object({
              id: z.number().describe('User ID'),
              name: z.string().describe('Display name'),
              email: z.string().describe('Email address'),
          });
          const mapUser = (u) => ({
              id: u.id ?? 0,
              name: u.name ?? '',
              email: u.email ?? '',
          });
          const accountSchema = z.object({
              id: z.number().describe('Account ID'),
              name: z.string().describe('Account name'),
          });
          const mapAccount = (a) => ({
              id: a.id ?? 0,
              name: a.name ?? '',
          });
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID (UUID)'),
              name: z.string().describe('Organization name'),
          });
          const mapOrganization = (o) => ({
              id: o.id ?? '',
              name: o.name ?? '',
          });
          // --- Entity ---
          const tagSchema = z.object({
              key: z.string().describe('Tag key'),
              values: z.array(z.string()).describe('Tag values'),
          });
          const mapTag = (t) => ({
              key: t.key ?? '',
              values: t.values ?? [],
          });
          const entitySchema = z.object({
              guid: z.string().describe('Entity GUID (globally unique identifier)'),
              name: z.string().describe('Entity name'),
              type: z.string().describe('Entity type (e.g., APPLICATION, HOST, DASHBOARD)'),
              domain: z.string().describe('Entity domain (e.g., APM, INFRA, BROWSER, SYNTH, VIZ)'),
              entity_type: z.string().describe('Full entity type string'),
              alert_severity: z.string().describe('Alert severity or empty if none'),
              reporting: z.boolean().describe('Whether the entity is currently reporting'),
              permalink: z.string().describe('URL to the entity in New Relic'),
              tags: z.array(tagSchema).describe('Entity tags'),
          });
          const mapEntity = (e) => ({
              guid: e.guid ?? '',
              name: e.name ?? '',
              type: e.type ?? '',
              domain: e.domain ?? '',
              entity_type: e.entityType ?? '',
              alert_severity: e.alertSeverity ?? '',
              reporting: e.reporting ?? false,
              permalink: e.permalink ?? '',
              tags: (e.tags ?? []).map(mapTag),
          });
          // --- Dashboard ---
          const dashboardWidgetSchema = z.object({
              id: z.string().describe('Widget ID'),
              title: z.string().describe('Widget title'),
              visualization_id: z.string().describe('Visualization type ID'),
          });
          const mapDashboardWidget = (w) => ({
              id: w.id ?? '',
              title: w.title ?? '',
              visualization_id: w.visualization?.id ?? '',
          });
          const dashboardPageSchema = z.object({
              guid: z.string().describe('Page GUID'),
              name: z.string().describe('Page name'),
              widgets: z.array(dashboardWidgetSchema).describe('Widgets on this page'),
          });
          const mapDashboardPage = (p) => ({
              guid: p.guid ?? '',
              name: p.name ?? '',
              widgets: (p.widgets ?? []).map(mapDashboardWidget),
          });
          const dashboardSchema = z.object({
              guid: z.string().describe('Dashboard GUID'),
              name: z.string().describe('Dashboard name'),
              description: z.string().describe('Dashboard description'),
              permissions: z.string().describe('Permission level: PUBLIC_READ_WRITE, PUBLIC_READ_ONLY, PRIVATE'),
              owner_email: z.string().describe('Email of the dashboard owner'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last updated timestamp'),
              pages: z.array(dashboardPageSchema).describe('Dashboard pages'),
          });
          const mapDashboard = (d) => ({
              guid: d.guid ?? '',
              name: d.name ?? '',
              description: d.description ?? '',
              permissions: d.permissions ?? '',
              owner_email: d.owner?.email ?? '',
              created_at: d.createdAt ?? '',
              updated_at: d.updatedAt ?? '',
              pages: (d.pages ?? []).map(mapDashboardPage),
          });
          // --- Alert Policy ---
          const alertPolicySchema = z.object({
              id: z.string().describe('Alert policy ID'),
              name: z.string().describe('Alert policy name'),
              incident_preference: z
                  .string()
                  .describe('Incident preference: PER_POLICY, PER_CONDITION, or PER_CONDITION_AND_TARGET'),
          });
          const mapAlertPolicy = (p) => ({
              id: p.id ?? '',
              name: p.name ?? '',
              incident_preference: p.incidentPreference ?? '',
          });
          // --- Dashboard Input (shared between create and update) ---
          const widgetInputSchema = z.object({
              title: z.string().describe('Widget title'),
              nrql_query: z
                  .string()
                  .optional()
                  .describe('NRQL query for data-driven widgets (e.g., "SELECT count(*) FROM Transaction SINCE 1 hour ago")'),
              markdown: z.string().optional().describe('Markdown text for markdown widgets'),
              visualization: z
                  .enum(['viz.billboard', 'viz.line', 'viz.table', 'viz.bar', 'viz.pie', 'viz.area', 'viz.markdown'])
                  .optional()
                  .describe('Visualization type (default viz.line for NRQL, viz.markdown for markdown)'),
              row: z.number().int().optional().describe('Row position (default 1)'),
              column: z.number().int().optional().describe('Column position (default 1)'),
              width: z.number().int().optional().describe('Width in columns 1-12 (default 4)'),
              height: z.number().int().optional().describe('Height in rows (default 3)'),
          });
          const pageInputSchema = z.object({
              name: z.string().describe('Page name'),
              widgets: z.array(widgetInputSchema).min(1).describe('Widgets for this page'),
          });
          /** Map a widget input to the NerdGraph DashboardWidgetInput shape */
          const mapWidgetToInput = (w, accountId) => {
              const layout = {
                  row: w.row ?? 1,
                  column: w.column ?? 1,
                  width: w.width ?? 4,
                  height: w.height ?? 3,
              };
              if (w.markdown !== undefined) {
                  return {
                      title: w.title,
                      configuration: { markdown: { text: w.markdown } },
                      rawConfiguration: { text: w.markdown },
                      layout,
                  };
              }
              return {
                  title: w.title,
                  visualization: {
                      id: w.visualization ?? 'viz.line',
                  },
                  rawConfiguration: {
                      nrqlQueries: [{ accountId, query: w.nrql_query ?? '' }],
                  },
                  layout,
              };
          };
          // --- NRQL Condition ---
          const nrqlConditionSchema = z.object({
              id: z.string().describe('Condition ID'),
              name: z.string().describe('Condition name'),
              enabled: z.boolean().describe('Whether the condition is enabled'),
              nrql_query: z.string().describe('NRQL query for the condition'),
              policy_id: z.string().describe('Parent alert policy ID'),
              signal_aggregation_window: z.number().describe('Aggregation window in seconds'),
          });
          const mapNrqlCondition = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              enabled: c.enabled ?? false,
              nrql_query: c.nrql?.query ?? '',
              policy_id: c.policyId ?? '',
              signal_aggregation_window: c.signal?.aggregationWindow ?? 0,
          });
          const listAlertPolicies = defineTool({
              name: 'list_alert_policies',
              displayName: 'List Alert Policies',
              description: 'List alert policies for a New Relic account. Policies group related alert conditions together and define the incident preference (per-policy, per-condition, or per-condition-and-target).',
              summary: 'List alert policies',
              icon: 'bell',
              group: 'Alerts',
              input: z.object({
                  account_id: z.number().int().describe('Account ID'),
                  cursor: z.string().optional().describe('Pagination cursor from a previous response'),
              }),
              output: z.object({
                  policies: z.array(alertPolicySchema).describe('Alert policies'),
                  total_count: z.number().describe('Total number of policies'),
                  next_cursor: z.string().describe('Cursor for next page, empty if no more results'),
              }),
              handle: async (params) => {
                  const data = await graphql(`query ListPolicies($accountId: Int!, $cursor: String) {
                  actor {
                    account(id: $accountId) {
                      alerts {
                        policiesSearch(cursor: $cursor) {
                          policies { id name incidentPreference }
                          totalCount
                          nextCursor
                        }
                      }
                    }
                  }
                }`, { accountId: params.account_id, cursor: params.cursor });
                  const search = data.actor.account.alerts.policiesSearch;
                  return {
                      policies: (search?.policies ?? []).map(mapAlertPolicy),
                      total_count: search?.totalCount ?? 0,
                      next_cursor: search?.nextCursor ?? '',
                  };
              },
          });


                    var pluginTool = listAlertPolicies

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a New Relic page.')
                      }
                      if (!/(^|\.)newrelic\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a New Relic page.')
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
            async list_alert_policies(args) {
              return runTool('list_alert_policies', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_alert_policies'](args)
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
            'The New Relic tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'New Relic API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The New Relic tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
