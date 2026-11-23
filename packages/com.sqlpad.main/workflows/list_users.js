// Self-contained adapter workflow. The SQLPad session and every same-origin
// API call stay inside the SQLPad tab.

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
    description: 'list_users',
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

          let cachedAuth = null;
          const clearAuth = () => {
              cachedAuth = null;
          };
          const isAuthenticated = () => {
              // On first load, we don't have cached auth yet — isReady() will poll via waitForAuth
              return cachedAuth !== null;
          };
          const waitForAuth = async () => {
              try {
                  await waitUntil(async () => {
                      try {
                          const data = await fetchJSON('/api/app');
                          if (data?.currentUser?.id) {
                              cachedAuth = { userId: data.currentUser.id };
                              return true;
                          }
                          return false;
                      }
                      catch {
                          return false;
                      }
                  }, { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const ensureAuth = () => {
              if (!cachedAuth) {
                  throw ToolError.auth('Not authenticated — please log in to SQLPad.');
              }
          };
          const api = async (endpoint, options = {}) => {
              ensureAuth();
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `/api${endpoint}?${qs}` : `/api${endpoint}`;
              const method = options.method ?? 'GET';
              const headers = {
                  Accept: 'application/json',
              };
              const init = { method, headers };
              if (options.body !== undefined) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
              }
              try {
                  return (await fetchJSON(url, init));
              }
              catch (error) {
                  if (error instanceof ToolError && error.category === 'auth') {
                      clearAuth();
                  }
                  throw error;
              }
          };
          const apiText = async (endpoint) => {
              ensureAuth();
              try {
                  return await fetchText(`/api${endpoint}`);
              }
              catch (error) {
                  if (error instanceof ToolError && error.category === 'auth') {
                      clearAuth();
                  }
                  throw error;
              }
          };
          const POLL_INTERVAL_MS = 500;
          const MAX_POLL_DURATION_MS = 300_000; // 5 minutes
          const runQuery = async (connectionId, queryText, maxRows, reportProgress) => {
              ensureAuth();
              // Step 1: Submit batch
              reportProgress?.('Submitting query...');
              const batch = await api('/batches', {
                  method: 'POST',
                  body: {
                      connectionId,
                      batchText: queryText,
                      selectedText: queryText,
                  },
              });
              if (!batch.id) {
                  throw ToolError.internal('Failed to submit query batch — no batch ID returned.');
              }
              // Step 2: Poll until finished or error
              reportProgress?.('Executing query...');
              let result = null;
              const start = Date.now();
              while (Date.now() - start < MAX_POLL_DURATION_MS) {
                  result = await api(`/batches/${batch.id}`);
                  if (result.status === 'finished' || result.status === 'error')
                      break;
                  await sleep(POLL_INTERVAL_MS);
              }
              if (!result || (result.status !== 'finished' && result.status !== 'error')) {
                  throw ToolError.timeout('Query timed out after 5 minutes.');
              }
              const statement = result.statements?.[0];
              if (!statement) {
                  throw ToolError.internal('No statement found in batch response.');
              }
              if (statement.status === 'error' || statement.error) {
                  const errorMsg = statement.error?.message ?? statement.error?.title ?? 'Unknown query error';
                  throw ToolError.validation(errorMsg);
              }
              if (!statement.id) {
                  throw ToolError.internal('Statement has no ID.');
              }
              // Step 3: Fetch results (raw 2D array)
              reportProgress?.('Fetching results...');
              const rawText = await apiText(`/statements/${statement.id}/results`);
              const rawRows = JSON.parse(rawText);
              const columns = (statement.columns ?? []).map(c => ({
                  name: c.name ?? '',
                  type: c.datatype ?? 'string',
              }));
              // Transform raw arrays into objects keyed by column name
              const truncated = rawRows.length > maxRows;
              const limitedRows = rawRows.slice(0, maxRows);
              const rows = limitedRows.map(row => {
                  const obj = {};
                  for (let i = 0; i < columns.length; i++) {
                      const col = columns[i];
                      if (col) {
                          obj[col.name] = row[i] ?? null;
                      }
                  }
                  return obj;
              });
              return {
                  columns,
                  rows,
                  rowCount: rawRows.length,
                  executionTimeMs: statement.durationMs ?? 0,
                  truncated,
              };
          };

          // --- Connection ---
          const connectionSchema = z.object({
              id: z.string().describe('Connection ID used to reference this database connection'),
              name: z.string().describe('Human-readable connection name'),
              driver: z.string().describe('Database driver type (e.g., postgres, mysql, sqlserver)'),
              host: z.string().describe('Database host address'),
              port: z.string().describe('Database port'),
              database: z.string().describe('Database name'),
              maxRows: z.number().describe('Maximum rows returned per query for this connection'),
              supportsConnectionClient: z.boolean().describe('Whether the connection supports persistent clients'),
          });
          const mapConnection = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              driver: c.driver ?? '',
              host: c.host ?? '',
              port: String(c.port ?? ''),
              database: c.database ?? '',
              maxRows: c.maxRows ?? 0,
              supportsConnectionClient: c.supportsConnectionClient ?? false,
          });
          // --- Schema (database structure) ---
          const columnSchema = z.object({
              name: z.string().describe('Column name'),
              dataType: z.string().describe('Column data type (e.g., varchar, int4, timestamp)'),
          });
          const tableSchema = z.object({
              name: z.string().describe('Table name'),
              columns: z.array(columnSchema).describe('Columns in this table'),
          });
          const dbSchemaSchema = z.object({
              name: z.string().describe('Schema name (e.g., public)'),
              tables: z.array(tableSchema).describe('Tables in this schema'),
          });
          const mapColumn = (c) => ({
              name: c.name ?? '',
              dataType: c.dataType ?? '',
          });
          const mapTable = (t) => ({
              name: t.name ?? '',
              columns: (t.columns ?? []).map(mapColumn),
          });
          const mapDbSchema = (s) => ({
              name: s.name ?? '',
              tables: (s.tables ?? []).map(mapTable),
          });
          // --- Saved Query ---
          const savedQuerySchema = z.object({
              id: z.string().describe('Saved query ID'),
              name: z.string().describe('Query name'),
              connectionId: z.string().describe('Connection ID the query targets'),
              queryText: z.string().describe('SQL query text'),
              tags: z.array(z.string()).describe('Tags assigned to this query'),
              createdBy: z.string().describe('User ID who created the query'),
              createdAt: z.string().describe('ISO 8601 timestamp when the query was created'),
              updatedAt: z.string().describe('ISO 8601 timestamp when the query was last updated'),
              canRead: z.boolean().describe('Whether the current user can read this query'),
              canWrite: z.boolean().describe('Whether the current user can edit this query'),
              canDelete: z.boolean().describe('Whether the current user can delete this query'),
          });
          const mapSavedQuery = (q) => ({
              id: q.id ?? '',
              name: q.name ?? '',
              connectionId: q.connectionId ?? '',
              queryText: q.queryText ?? '',
              tags: q.tags ?? [],
              createdBy: q.createdBy ?? '',
              createdAt: q.createdAt ?? '',
              updatedAt: q.updatedAt ?? '',
              canRead: q.canRead ?? false,
              canWrite: q.canWrite ?? false,
              canDelete: q.canDelete ?? false,
          });
          // --- Query History ---
          const queryHistorySchema = z.object({
              id: z.string().describe('History entry ID'),
              connectionId: z.string().describe('Connection ID used for the query'),
              connectionName: z.string().describe('Connection name'),
              userEmail: z.string().describe('Email of the user who ran the query'),
              status: z.string().describe('Execution status (finished, error)'),
              startTime: z.string().describe('ISO 8601 timestamp when the query started'),
              stopTime: z.string().describe('ISO 8601 timestamp when the query finished'),
              durationMs: z.number().describe('Query execution time in milliseconds'),
              queryText: z.string().describe('SQL query text that was executed'),
              rowCount: z.number().describe('Number of rows returned'),
              incomplete: z.boolean().describe('Whether results were truncated'),
          });
          const mapQueryHistory = (h) => ({
              id: h.id ?? '',
              connectionId: h.connectionId ?? '',
              connectionName: h.connectionName ?? '',
              userEmail: h.userEmail ?? '',
              status: h.status ?? '',
              startTime: h.startTime ?? '',
              stopTime: h.stopTime ?? '',
              durationMs: h.durationMs ?? 0,
              queryText: h.queryText ?? '',
              rowCount: typeof h.rowCount === 'string' ? Number(h.rowCount) : (h.rowCount ?? 0),
              incomplete: h.incomplete ?? false,
          });
          // --- Current User ---
          const currentUserSchema = z.object({
              id: z.string().describe('User ID'),
              email: z.string().describe('User email address'),
              role: z.string().describe('User role (admin, editor, viewer)'),
          });
          const mapCurrentUser = (u) => ({
              id: u.id ?? '',
              email: u.email ?? '',
              role: u.role ?? '',
          });
          // --- Query Result ---
          const queryResultColumnSchema = z.object({
              name: z.string().describe('Column name'),
              type: z.string().describe('Column data type'),
          });
          const queryResultSchema = z.object({
              columns: z.array(queryResultColumnSchema).describe('Column definitions'),
              rows: z.array(z.record(z.string(), z.unknown())).describe('Result rows as objects keyed by column name'),
              rowCount: z.number().describe('Total number of rows returned by the query'),
              executionTimeMs: z.number().describe('Query execution time in milliseconds'),
              truncated: z.boolean().describe('Whether results were truncated to maxRows limit'),
          });
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              name: z.string().describe('User display name'),
              email: z.string().describe('User email address'),
              role: z.string().describe('User role (admin, editor, viewer)'),
              createdAt: z.string().describe('ISO 8601 timestamp when the user was created'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              name: u.name ?? '',
              email: u.email ?? '',
              role: u.role ?? '',
              createdAt: u.createdAt ?? '',
          });
          const listUsers = defineTool({
              name: 'list_users',
              displayName: 'List Users',
              description: 'List all users in the SQLPad instance with their roles and email addresses.',
              summary: 'List all users',
              icon: 'users',
              group: 'Account',
              input: z.object({}),
              output: z.object({
                  users: z.array(userSchema).describe('Users in the instance'),
              }),
              handle: async () => {
                  const data = await api('/users');
                  return { users: data.map(mapUser) };
              },
          });


                    var pluginTool = listUsers

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
                      var productProbe = PRODUCT_HOSTS['sqlpad'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a SQLPad page.')
                      }
                      if (false) {
                        if (!null.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a SQLPad page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a SQLPad page.')
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
            async list_users(args) {
              return runTool('list_users', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_users'](args)
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
            'The SQLPad tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'SQLPad API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The SQLPad tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
