// Self-contained adapter workflow. The Snowflake session and every same-origin
// API call stay inside the Snowflake tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "database": {
        "type": "string",
        "description": "Database name to list schemas for"
      }
    },
    "required": [
      "database"
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
    description: 'list_schemas',
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

          // --- Auth ---
          const getRequestContext = () => {
              const fn = getPageGlobal('numeracy.api.backendHttp.getRequestContext');
              if (typeof fn !== 'function')
                  return null;
              try {
                  return fn();
              }
              catch {
                  return null;
              }
          };
          const isAuthenticated = () => {
              const user = getPageGlobal('numeracy.pageState.user');
              return !!user?.id && getRequestContext() !== null;
          };
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const requireContext = () => {
              const ctx = getRequestContext();
              if (!ctx)
                  throw ToolError.auth('Not authenticated — please log in to Snowflake.');
              return ctx;
          };
          // --- Session info ---
          const getSessionInfo = () => {
              const ctx = requireContext();
              const user = getPageGlobal('numeracy.pageState.user');
              const org = getPageGlobal('numeracy.stores.organization.activeOrg');
              return {
                  role: ctx.role,
                  appServerUrl: ctx.appServerUrl,
                  userEmail: user?.email ?? '',
                  orgId: org?.id ?? '',
                  orgShortName: org?.shortName ?? '',
              };
          };
          // --- Error extraction ---
          const deepFind = (obj, key, maxDepth = 4) => {
              if (maxDepth <= 0 || !obj || typeof obj !== 'object')
                  return undefined;
              const record = obj;
              if (key in record)
                  return record[key];
              for (const v of Object.values(record)) {
                  const found = deepFind(v, key, maxDepth - 1);
                  if (found !== undefined)
                      return found;
              }
              return undefined;
          };
          const extractErrorMessage = (body) => {
              const sqlMessage = deepFind(body, 'errorMessage') ?? deepFind(body, 'sqlMessage');
              if (typeof sqlMessage === 'string' && sqlMessage) {
                  const sqlState = deepFind(body, 'sqlState');
                  const errorCode = deepFind(body, 'errorCode');
                  const parts = [sqlMessage];
                  if (typeof sqlState === 'string')
                      parts.push(`(sqlState: ${sqlState})`);
                  if (errorCode !== undefined && errorCode !== null)
                      parts.push(`(errorCode: ${errorCode})`);
                  return parts.join(' ');
              }
              const data = body.data;
              if (typeof data?.message === 'string' && data.message)
                  return data.message;
              if (typeof body.message === 'string' && body.message)
                  return body.message;
              return JSON.stringify(body).substring(0, 500);
          };
          // Compute total row count across all chunks from chunk metadata.
          // firstChunkRowCount only counts the first chunk — for multi-chunk results,
          // we need to sum rowCount from all chunkFileMetadatas.
          const computeTotalRows = (r) => {
              if (!r)
                  return 0;
              const metadatas = r.chunkFileMetadatas;
              if (metadatas && metadatas.length > 0) {
                  return metadatas.reduce((sum, m) => sum + (m.rowCount ?? 0), 0);
              }
              return r.firstChunkRowCount ?? 0;
          };
          const runQuery = async (sqlText, options) => {
              const ctx = requireContext();
              const body = {
                  sqlText,
                  asyncExec: false,
                  sequenceId: 0,
                  querySubmissionTime: Date.now(),
              };
              if (options?.database)
                  body.database = options.database;
              if (options?.schema)
                  body.schema = options.schema;
              if (options?.warehouse)
                  body.warehouse = options.warehouse;
              if (options?.role)
                  body.role = options.role;
              // Use raw fetch instead of fetchFromPage because Snowflake returns HTTP 422
              // for SQL compilation errors. fetchFromPage would throw a generic ToolError
              // before we can extract the descriptive SQL error message from the response body.
              const response = await fetch(`${ctx.appServerUrl}/v1/queries`, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                      'x-snowflake-context': ctx.decodedUserKey,
                  },
                  credentials: 'include',
                  body: JSON.stringify(body),
                  signal: AbortSignal.timeout(300_000), // 5 minute timeout for long queries
              });
              if (!response.ok) {
                  let errorDetail;
                  try {
                      const errorBody = (await response.json());
                      errorDetail = extractErrorMessage(errorBody);
                  }
                  catch {
                      errorDetail = response.statusText;
                  }
                  if (response.status === 401 || response.status === 403) {
                      throw ToolError.auth(`Snowflake auth error: ${errorDetail}`);
                  }
                  if (response.status === 429) {
                      throw ToolError.rateLimited(`Snowflake rate limited: ${errorDetail}`);
                  }
                  if (response.status === 422) {
                      throw ToolError.validation(errorDetail);
                  }
                  throw ToolError.internal(`Snowflake API ${response.status}: ${errorDetail}`);
              }
              const data = (await response.json());
              if (data.status?.summary !== 'SUCCESS') {
                  const errorMsg = data.status?.errorMessage ?? 'Query execution failed';
                  throw ToolError.validation(errorMsg);
              }
              const r = data.result;
              const columns = (r?.resultColumnMetadata ?? []).map(c => ({
                  name: c.name ?? '',
                  typeName: c.typeName ?? '',
                  nullable: c.nullable ?? true,
                  precision: c.precision ?? 0,
                  scale: c.scale ?? 0,
              }));
              const rows = r?.firstChunkData ? JSON.parse(r.firstChunkData) : [];
              return {
                  queryId: data.queryId ?? '',
                  success: true,
                  error: null,
                  columns,
                  rows,
                  totalRows: computeTotalRows(r),
                  chunkFileCount: r?.chunkFileCount ?? 0,
                  durationMs: data.status?.totalDuration ?? 0,
                  warehouseName: data.status?.warehouseName ?? '',
                  statementType: r?.statementType ?? '',
              };
          };
          // --- Chunk fetching ---
          const fetchChunk = async (queryId, chunkIndex) => {
              const ctx = requireContext();
              const response = await fetchFromPage(`${ctx.appServerUrl}/v1/queries/${queryId}/chunks/${chunkIndex}`, {
                  method: 'GET',
                  headers: {
                      Accept: 'application/json',
                      'x-snowflake-context': ctx.decodedUserKey,
                  },
              });
              const text = await response.text();
              if (!text || text.length === 0)
                  return [];
              return JSON.parse(`[${text}]`);
          };
          const getEntityApi = () => {
              const entityApi = getPageGlobal('numeracy.stores.entity.api');
              if (typeof entityApi?.post !== 'function') {
                  throw ToolError.internal('Snowflake entity API not available — refresh the page.');
              }
              return { post: entityApi.post.bind(entityApi) };
          };
          const getOrgId = () => {
              const org = getPageGlobal('numeracy.stores.organization.activeOrg');
              if (!org?.id)
                  throw ToolError.internal('Snowflake organization ID not available.');
              return org.id;
          };
          const listEntities = async (options) => {
              requireContext();
              const orgId = getOrgId();
              const api = getEntityApi();
              const filterOptions = {
                  sort: { col: 'modified', dir: 'desc' },
                  limit: options.limit ?? 50,
                  owner: options.owner ?? null,
                  types: options.types ?? ['query', 'folder'],
                  showNeverViewed: 'if-invited',
                  excludeModels: true,
              };
              if (options.cursor)
                  filterOptions.from = options.cursor;
              try {
                  const result = await api.post({
                      path: `/organizations/${orgId}/entities/list`,
                      data: {
                          options: JSON.stringify(filterOptions),
                          location: options.location ?? 'worksheets',
                      },
                  });
                  return {
                      entities: result.entities ?? [],
                      next: result.next ?? '',
                  };
              }
              catch (err) {
                  if (err instanceof ToolError)
                      throw err;
                  const msg = err instanceof Error ? err.message : String(err);
                  throw ToolError.internal(`Snowflake entity API error: ${msg}`);
              }
          };

          // --- Column schema (shared across query tools) ---
          const columnSchema = z.object({
              name: z.string().describe('Column name'),
              typeName: z.string().describe('Snowflake data type (e.g., NUMBER, VARCHAR, TIMESTAMP_NTZ)'),
              nullable: z.boolean().describe('Whether the column allows NULL values'),
          });
          const mapColumn = (c) => ({
              name: c.name ?? '',
              typeName: c.typeName ?? '',
              nullable: c.nullable ?? true,
          });
          // --- Query execution result ---
          const executionSchema = z.object({
              queryId: z.string().describe('Unique query ID for fetching additional chunks'),
              status: z.string().describe('Query execution status (SUCCESS or error)'),
              durationMs: z.number().describe('Total execution time in milliseconds'),
              warehouseName: z.string().describe('Warehouse used for execution'),
              statementType: z.string().describe('Statement type (SELECT, SHOW, DESCRIBE, etc.)'),
              error: z.string().nullable().describe('Error message if query failed, null on success'),
          });
          // --- Row data (all values are strings per Snowflake JSON format) ---
          const rowSchema = z
              .record(z.string(), z.string().nullable())
              .describe('Row data as column-name to value mapping. All values are strings or null per Snowflake JSON format.');
          // --- Worksheet entity ---
          const worksheetSchema = z.object({
              entityId: z.string().describe('Worksheet entity ID'),
              name: z.string().describe('Worksheet name'),
              created: z.string().describe('Creation timestamp (ISO 8601)'),
              modified: z.string().describe('Last modified timestamp (ISO 8601)'),
              queryLanguage: z.string().describe('Query language (sql or python)'),
              role: z.string().describe('Role used by the worksheet'),
              url: z.string().describe('Relative URL path to the worksheet'),
              visibility: z.string().describe('Visibility (private, organization)'),
              folderId: z.string().nullable().describe('Parent folder ID, null if at root'),
          });
          const mapWorksheet = (entityId, info) => ({
              entityId,
              name: info.name ?? '',
              created: info.created ?? '',
              modified: info.modified ?? '',
              queryLanguage: info.queryLanguage ?? 'sql',
              role: info.role ?? '',
              url: info.url ?? '',
              visibility: info.visibility ?? '',
              folderId: info.folderId ?? null,
          });
          // --- Folder entity ---
          const folderSchema = z.object({
              entityId: z.string().describe('Folder entity ID'),
              name: z.string().describe('Folder name'),
              created: z.string().describe('Creation timestamp (ISO 8601)'),
              modified: z.string().describe('Last modified timestamp (ISO 8601)'),
              url: z.string().describe('Relative URL path to the folder'),
              visibility: z.string().describe('Visibility (private, organization)'),
          });
          const mapFolder = (entityId, info) => ({
              entityId,
              name: info.name ?? '',
              created: info.created ?? '',
              modified: info.modified ?? '',
              url: info.url ?? '',
              visibility: info.visibility ?? '',
          });
          // --- Database/schema/table from SHOW commands ---
          const databaseSchema = z.object({
              name: z.string().describe('Database name'),
              owner: z.string().describe('Database owner role'),
              kind: z.string().describe('Database kind (STANDARD or APPLICATION)'),
              created_on: z.string().describe('Creation timestamp'),
              comment: z.string().describe('Database comment'),
          });
          const mapDatabase = (row) => ({
              name: row[1] ?? '',
              owner: row[5] ?? '',
              kind: row[9] ?? 'STANDARD',
              created_on: row[0] ?? '',
              comment: row[6] ?? '',
          });
          const schemaInfoSchema = z.object({
              name: z.string().describe('Schema name'),
              database_name: z.string().describe('Parent database name'),
              owner: z.string().describe('Schema owner role'),
              created_on: z.string().describe('Creation timestamp'),
              comment: z.string().describe('Schema comment'),
          });
          const mapSchemaInfo = (row) => ({
              name: row[1] ?? '',
              database_name: row[4] ?? '',
              owner: row[5] ?? '',
              created_on: row[0] ?? '',
              comment: row[6] ?? '',
          });
          const tableColumnSchema = z.object({
              name: z.string().describe('Column name'),
              type: z.string().describe('Column data type'),
              kind: z.string().describe('Column kind (COLUMN)'),
              nullable: z.string().describe('Y if nullable, N if not'),
              default: z.string().nullable().describe('Default value expression, null if none'),
              primaryKey: z.string().describe('Y if part of primary key'),
              uniqueKey: z.string().describe('Y if part of unique key'),
              comment: z.string().nullable().describe('Column comment'),
          });
          const mapTableColumn = (row) => ({
              name: row[0] ?? '',
              type: row[1] ?? '',
              kind: row[2] ?? 'COLUMN',
              nullable: row[3] ?? 'Y',
              default: row[4] || null,
              primaryKey: row[5] ?? 'N',
              uniqueKey: row[6] ?? 'N',
              comment: row[7] || null,
          });
          // --- Warehouse ---
          const warehouseSchema = z.object({
              name: z.string().describe('Warehouse name'),
              state: z.string().describe('Current state (STARTED, SUSPENDED, RESIZING)'),
              type: z.string().describe('Warehouse type (STANDARD, SNOWPARK_OPTIMIZED)'),
              size: z.string().describe('Warehouse size (X-Small, Small, Medium, etc.)'),
              auto_suspend: z.string().describe('Auto-suspend timeout in seconds'),
              auto_resume: z.string().describe('Whether auto-resume is enabled'),
              owner: z.string().describe('Owner role'),
              running: z.string().describe('Number of running queries'),
              queued: z.string().describe('Number of queued queries'),
          });
          const mapWarehouse = (row) => ({
              name: row[0] ?? '',
              state: row[1] ?? '',
              type: row[2] ?? '',
              size: row[3] ?? '',
              auto_suspend: row[11] ?? '',
              auto_resume: row[12] ?? '',
              owner: row[20] ?? '',
              running: row[7] ?? '0',
              queued: row[8] ?? '0',
          });
          const listSchemas = defineTool({
              name: 'list_schemas',
              displayName: 'List Schemas',
              description: 'List schemas in a Snowflake database. Returns schema names, owners, and creation timestamps. Use browse_data to find available database names first.',
              summary: 'List schemas in a database',
              icon: 'folder-tree',
              group: 'Schema',
              input: z.object({
                  database: z.string().describe('Database name to list schemas for'),
              }),
              output: z.object({
                  schemas: z.array(schemaInfoSchema).describe('List of schemas in the database'),
              }),
              handle: async (params) => {
                  const result = await runQuery(`SHOW SCHEMAS IN DATABASE ${params.database}`);
                  const schemas = result.rows.map(mapSchemaInfo);
                  return { schemas };
              },
          });


                    var pluginTool = listSchemas

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
                      var productProbe = PRODUCT_HOSTS['snowflake'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Snowflake page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)app\\.snowflake\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Snowflake page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Snowflake page.')
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
            async list_schemas(args) {
              return runTool('list_schemas', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_schemas'](args)
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
            'The Snowflake tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Snowflake API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Snowflake tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
