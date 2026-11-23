// Self-contained adapter workflow. The Supabase session and every same-origin
// API call stay inside the Supabase tab.

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
    description: 'list_sql_snippets',
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

          const TOKEN_KEY = 'supabase.dashboard.auth.token';
          const NAMESPACE = 'supabase';
          const getAuth = () => {
              const persisted = getAuthCache(NAMESPACE);
              if (persisted)
                  return persisted;
              try {
                  const raw = getLocalStorage(TOKEN_KEY);
                  if (!raw)
                      return null;
                  const parsed = JSON.parse(raw);
                  const token = parsed.access_token;
                  if (!token)
                      return null;
                  const auth = { accessToken: token };
                  setAuthCache(NAMESPACE, auth);
                  return auth;
              }
              catch {
                  return null;
              }
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          const api = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Supabase.');
              let url = `https://api.supabase.com/v1${endpoint}`;
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
                  Authorization: `Bearer ${auth.accessToken}`,
              };
              let fetchBody;
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
              }
              let response;
              try {
                  response = await fetch(url, {
                      method: options.method ?? 'GET',
                      headers,
                      body: fetchBody,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError')
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  if (err instanceof DOMException && err.name === 'AbortError')
                      throw ToolError.timeout('Request was aborted');
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (!response.ok) {
                  const errorBody = (await response.text().catch(() => '')).substring(0, 512);
                  if (response.status === 401 || response.status === 403) {
                      clearAuthCache(NAMESPACE);
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 429) {
                      const retryAfter = response.headers.get('Retry-After');
                      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 404)
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              const text = await response.text();
              if (!text)
                  return {};
              return JSON.parse(text);
          };

          const projectSchema = z.object({
              id: z.string().describe('Project reference ID'),
              name: z.string().describe('Project name'),
              organization_id: z.string().describe('Organization ID the project belongs to'),
              region: z.string().describe('Project region (e.g., us-east-1)'),
              status: z.string().describe('Project status (e.g., ACTIVE_HEALTHY, INACTIVE, COMING_UP)'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapProject = (p) => ({
              id: p?.id ?? '',
              name: p?.name ?? '',
              organization_id: p?.organization_id ?? '',
              region: p?.region ?? '',
              status: p?.status ?? '',
              created_at: p?.created_at ?? '',
          });
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID'),
              name: z.string().describe('Organization name'),
              slug: z.string().describe('Organization slug used in URLs'),
          });
          const mapOrganization = (o) => ({
              id: o?.id ?? '',
              name: o?.name ?? '',
              slug: o?.slug || (o?.id ?? ''),
          });
          const functionSchema = z.object({
              id: z.string().describe('Function UUID'),
              slug: z.string().describe('Function slug (URL-friendly name)'),
              name: z.string().describe('Function display name'),
              status: z.string().describe('Function status (e.g., ACTIVE, REMOVED)'),
              version: z.number().describe('Function version number'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
              verify_jwt: z.boolean().describe('Whether the function verifies JWT tokens'),
          });
          const mapFunction = (f) => ({
              id: f?.id ?? '',
              slug: f?.slug ?? '',
              name: f?.name ?? '',
              status: f?.status ?? '',
              version: f?.version ?? 0,
              created_at: f?.created_at ?? '',
              updated_at: f?.updated_at ?? '',
              verify_jwt: f?.verify_jwt ?? true,
          });
          const secretSchema = z.object({
              name: z.string().describe('Secret name'),
              value: z.string().describe('Secret value (masked in responses)'),
          });
          const mapSecret = (s) => ({
              name: s?.name ?? '',
              value: s?.value ?? '',
          });
          const bucketSchema = z.object({
              id: z.string().describe('Bucket ID'),
              name: z.string().describe('Bucket name'),
              public: z.boolean().describe('Whether the bucket is publicly accessible'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapBucket = (b) => ({
              id: b?.id ?? '',
              name: b?.name ?? '',
              public: b?.public ?? false,
              created_at: b?.created_at ?? '',
              updated_at: b?.updated_at ?? '',
          });
          const memberSchema = z.object({
              user_id: z.string().describe('User UUID'),
              user_name: z.string().describe('Username'),
              email: z.string().describe('User email address'),
              role_name: z.string().describe('Role in the organization (e.g., Owner, Developer)'),
          });
          const mapMember = (m) => ({
              user_id: m?.user_id ?? m?.gotrue_id ?? '',
              user_name: m?.user_name ?? m?.username ?? '',
              email: m?.email ?? m?.primary_email ?? '',
              role_name: m?.role_name ?? '',
          });
          const migrationSchema = z.object({
              version: z.string().describe('Migration version string'),
              name: z.string().describe('Migration name or description'),
              statements: z.array(z.string()).optional().describe('SQL statements in the migration'),
          });
          const mapMigration = (m) => ({
              version: m?.version ?? '',
              name: m?.name ?? '',
              statements: Array.isArray(m?.statements) ? m.statements : undefined,
          });
          const snippetSchema = z.object({
              id: z.string().describe('Snippet UUID'),
              name: z.string().describe('Snippet name'),
              description: z.string().describe('Snippet description'),
              visibility: z.string().describe('Visibility (e.g., "user", "project", "org")'),
              project_id: z.string().describe('Project ID the snippet belongs to'),
          });
          const listSqlSnippets = defineTool({
              name: 'list_sql_snippets',
              displayName: 'List SQL Snippets',
              description: 'List saved SQL snippets for the authenticated user.',
              summary: 'List saved SQL snippets',
              icon: 'code',
              group: 'Database',
              input: z.object({}),
              output: z.object({
                  snippets: z.array(snippetSchema).describe('List of SQL snippets'),
              }),
              handle: async () => {
                  const data = await api('/snippets');
                  const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
                  return {
                      snippets: items.map(s => ({
                          id: s.id ?? '',
                          name: s.name ?? '',
                          description: s.description ?? '',
                          visibility: s.visibility ?? '',
                          project_id: s.project_id ?? s.project?.id ?? '',
                      })),
                  };
              },
          });


                    var pluginTool = listSqlSnippets

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
                      var productProbe = PRODUCT_HOSTS['supabase'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Supabase page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)supabase\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Supabase page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Supabase page.')
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
            async list_sql_snippets(args) {
              return runTool('list_sql_snippets', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_sql_snippets'](args)
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
            'The Supabase tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Supabase API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Supabase tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
