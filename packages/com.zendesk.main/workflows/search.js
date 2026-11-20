// Self-contained adapter workflow. The Zendesk session and every same-origin
// API call stay inside the Zendesk tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "description": "Zendesk search query string. Supports syntax like \"type:ticket status:open\", \"assignee:me\", \"priority:high\""
      },
      "page": {
        "description": "Page number for pagination (default 1)",
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "per_page": {
        "description": "Number of results per page (default 25, max 100)",
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "sort_by": {
        "description": "Field to sort results by (e.g. \"created_at\", \"updated_at\", \"priority\", \"status\", \"ticket_type\")",
        "type": "string"
      },
      "sort_order": {
        "description": "Sort direction",
        "type": "string",
        "enum": [
          "asc",
          "desc"
        ]
      }
    },
    "required": [
      "query"
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
    description: 'search',
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

          const getAuth = () => {
              const cached = getAuthCache('zendesk');
              if (cached)
                  return cached;
              // Zendesk agent UI stores current user info in __app_config__
              const userId = getPageGlobal('__app_config__.currentUser.id');
              if (!userId)
                  return null;
              const auth = { userId };
              setAuthCache('zendesk', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), {
                      interval: 500,
                      timeout: 5000,
                  });
                  return true;
              }
              catch {
                  return false;
              }
          };
          // --- CSRF ---
          const getCsrfToken = () => getMetaContent('csrf-token') ?? getCookie('_zendesk_csrf');
          // --- API caller ---
          const api = async (endpoint, options = {}) => {
              if (!getAuth()) {
                  clearAuthCache('zendesk');
                  throw ToolError.auth('Not authenticated — please log in to Zendesk.');
              }
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `/api/v2${endpoint}?${qs}` : `/api/v2${endpoint}`;
              const method = options.method ?? 'GET';
              const headers = {};
              if (method !== 'GET') {
                  const csrf = getCsrfToken();
                  if (csrf)
                      headers['X-CSRF-Token'] = csrf;
              }
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
              }
              const init = {
                  method,
                  headers,
                  body: options.body ? JSON.stringify(options.body) : undefined,
              };
              try {
                  const data = await fetchJSON(url, init);
                  return data;
              }
              catch (error) {
                  if (error instanceof ToolError && error.category === 'auth') {
                      clearAuthCache('zendesk');
                  }
                  throw error;
              }
          };
          // For endpoints that return non-JSON responses (e.g., exports)
          const apiRaw = async (endpoint, options = {}) => {
              if (!getAuth()) {
                  clearAuthCache('zendesk');
                  throw ToolError.auth('Not authenticated — please log in to Zendesk.');
              }
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `/api/v2${endpoint}?${qs}` : `/api/v2${endpoint}`;
              const method = options.method ?? 'GET';
              const headers = {};
              if (method !== 'GET') {
                  const csrf = getCsrfToken();
                  if (csrf)
                      headers['X-CSRF-Token'] = csrf;
              }
              return fetchFromPage(url, { method, headers });
          };

          // --- Ticket ---
          const ticketSchema = z.object({
              id: z.number().describe('Ticket ID'),
              subject: z.string().describe('Ticket subject'),
              description: z.string().describe('First comment body (ticket description)'),
              status: z.string().describe('Ticket status (new, open, pending, hold, solved, closed)'),
              priority: z.string().describe('Ticket priority (low, normal, high, urgent)'),
              type: z.string().describe('Ticket type (problem, incident, question, task)'),
              requester_id: z.number().describe('Requester user ID'),
              submitter_id: z.number().describe('Submitter user ID'),
              assignee_id: z.number().describe('Assignee user ID'),
              group_id: z.number().describe('Assigned group ID'),
              organization_id: z.number().describe('Organization ID'),
              tags: z.array(z.string()).describe('Tags applied to the ticket'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
              due_at: z.string().describe('ISO 8601 due date for task tickets'),
              url: z.string().describe('API URL of the ticket'),
          });
          const mapTicket = (t) => ({
              id: t.id ?? 0,
              subject: t.subject ?? '',
              description: t.description ?? '',
              status: t.status ?? '',
              priority: t.priority ?? '',
              type: t.type ?? '',
              requester_id: t.requester_id ?? 0,
              submitter_id: t.submitter_id ?? 0,
              assignee_id: t.assignee_id ?? 0,
              group_id: t.group_id ?? 0,
              organization_id: t.organization_id ?? 0,
              tags: t.tags ?? [],
              created_at: t.created_at ?? '',
              updated_at: t.updated_at ?? '',
              due_at: t.due_at ?? '',
              url: t.url ?? '',
          });
          // --- Comment ---
          const commentSchema = z.object({
              id: z.number().describe('Comment ID'),
              body: z.string().describe('Comment body text'),
              author_id: z.number().describe('Author user ID'),
              public: z.boolean().describe('Whether the comment is public (visible to requester)'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapComment = (c) => ({
              id: c.id ?? 0,
              body: c.body ?? '',
              author_id: c.author_id ?? 0,
              public: c.public ?? true,
              created_at: c.created_at ?? '',
          });
          // --- User ---
          const userSchema = z.object({
              id: z.number().describe('User ID'),
              name: z.string().describe('Full name'),
              email: z.string().describe('Primary email address'),
              role: z.string().describe('User role (end-user, agent, admin)'),
              active: z.boolean().describe('Whether the user is active'),
              phone: z.string().describe('Phone number'),
              organization_id: z.number().describe('Default organization ID'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapUser = (u) => ({
              id: u.id ?? 0,
              name: u.name ?? '',
              email: u.email ?? '',
              role: u.role ?? '',
              active: u.active ?? false,
              phone: u.phone ?? '',
              organization_id: u.organization_id ?? 0,
              created_at: u.created_at ?? '',
              updated_at: u.updated_at ?? '',
          });
          // --- Organization ---
          const organizationSchema = z.object({
              id: z.number().describe('Organization ID'),
              name: z.string().describe('Organization name'),
              domain_names: z.array(z.string()).describe('Associated domain names'),
              details: z.string().describe('Details about the organization'),
              notes: z.string().describe('Notes about the organization'),
              tags: z.array(z.string()).describe('Tags applied to the organization'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapOrganization = (o) => ({
              id: o.id ?? 0,
              name: o.name ?? '',
              domain_names: o.domain_names ?? [],
              details: o.details ?? '',
              notes: o.notes ?? '',
              tags: o.tags ?? [],
              created_at: o.created_at ?? '',
              updated_at: o.updated_at ?? '',
          });
          // --- Group ---
          const groupSchema = z.object({
              id: z.number().describe('Group ID'),
              name: z.string().describe('Group name'),
              description: z.string().describe('Group description'),
              default: z.boolean().describe('Whether this is the default group'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapGroup = (g) => ({
              id: g.id ?? 0,
              name: g.name ?? '',
              description: g.description ?? '',
              default: g.default ?? false,
              created_at: g.created_at ?? '',
              updated_at: g.updated_at ?? '',
          });
          // --- View ---
          const viewSchema = z.object({
              id: z.number().describe('View ID'),
              title: z.string().describe('View title'),
              active: z.boolean().describe('Whether the view is active'),
              description: z.string().describe('View description'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapView = (v) => ({
              id: v.id ?? 0,
              title: v.title ?? '',
              active: v.active ?? false,
              description: v.description ?? '',
              created_at: v.created_at ?? '',
              updated_at: v.updated_at ?? '',
          });
          // --- Search Result ---
          const searchResultSchema = z.object({
              id: z.number().describe('Result ID'),
              result_type: z.string().describe('Result type (ticket, user, organization, group)'),
              subject: z.string().describe('Subject or name of the result'),
              status: z.string().describe('Status (for tickets)'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapSearchResult = (r) => ({
              id: r.id ?? 0,
              result_type: r.result_type ?? '',
              subject: r.subject ?? r.name ?? '',
              status: r.status ?? '',
              created_at: r.created_at ?? '',
              updated_at: r.updated_at ?? '',
          });
          const search = defineTool({
              name: 'search',
              displayName: 'Search',
              description: 'Search across tickets, users, and organizations using Zendesk search syntax. ' +
                  "Examples: 'type:ticket status:open', 'type:user role:agent', " +
                  "'type:organization name:Acme', 'assignee:me priority:high'",
              summary: 'Search tickets, users, and organizations',
              icon: 'search',
              group: 'Search',
              input: z.object({
                  query: z
                      .string()
                      .min(1)
                      .describe('Zendesk search query string. Supports syntax like "type:ticket status:open", "assignee:me", "priority:high"'),
                  page: z.number().int().min(1).optional().describe('Page number for pagination (default 1)'),
                  per_page: z.number().int().min(1).max(100).optional().describe('Number of results per page (default 25, max 100)'),
                  sort_by: z
                      .string()
                      .optional()
                      .describe('Field to sort results by (e.g. "created_at", "updated_at", "priority", "status", "ticket_type")'),
                  sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
              }),
              output: z.object({
                  results: z.array(searchResultSchema).describe('List of search results'),
                  count: z.number().int().describe('Total number of matching results'),
              }),
              handle: async (params) => {
                  const data = await api('/search.json', {
                      query: {
                          query: params.query,
                          page: params.page,
                          per_page: params.per_page,
                          sort_by: params.sort_by,
                          sort_order: params.sort_order,
                      },
                  });
                  return {
                      results: (data.results ?? []).map(mapSearchResult),
                      count: data.count ?? 0,
                  };
              },
          });


                    var pluginTool = search

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Zendesk page.')
                      }
                      if (!/\.zendesk\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Zendesk page.')
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
            async search(args) {
              return runTool('search', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['search'](args)
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
            'The Zendesk tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Zendesk API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Zendesk tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
