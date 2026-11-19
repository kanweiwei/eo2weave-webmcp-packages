// Self-contained adapter workflow. The Airtable session (window.initData
// sessionUserId + csrfToken) and every /v0.3 fetch stay inside the airtable.com
// tab; the CSRF token never leaves page context.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "base_id": {
        "type": "string",
        "description": "Base ID (app prefix)"
      },
      "table_id": {
        "type": "string",
        "description": "Table ID (tbl prefix)"
      },
      "field_id": {
        "type": "string",
        "description": "Field/column ID (fld prefix) \u2014 must be a select or multiSelect type"
      }
    },
    "required": [
      "base_id",
      "table_id",
      "field_id"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "status": { "type": "string" },
      "data": { "type": ["object", "null"] },
      "message": { "type": ["string", "null"] },
      "error_code": { "type": ["string", "null"] }
    },
    "required": ["status", "data"],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'get_field_choices',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Airtable web-client runtime (translated from OpenTabs
          // airtable-api.ts, tools/*.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // airtable.com tab: window.initData (sessionUserId + csrfToken) is read
          // from page context on every call and never leaves the tab.
          var IN_PAGE_DEADLINE_MS = 18000
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
          // Airtable keeps the session in HttpOnly cookies; the web client learns
          // who it is from window.initData. Re-read it on every call so an account
          // switch in a live tab cannot replay the previous user's csrf token.
          function getAuth() {
            var sessionUserId = getPageGlobal('initData.sessionUserId')
            var csrfToken = getPageGlobal('initData.csrfToken')
            if (typeof sessionUserId !== 'string' || typeof csrfToken !== 'string')
              return null
            // Public share-context visitors get usrPAGESHARE ids and are not users.
            if (sessionUserId.indexOf('usrPAGESHARE') === 0) return null
            return { userId: sessionUserId, csrfToken: csrfToken }
          }
          function getUserId() {
            var auth = getAuth()
            return auth ? auth.userId : null
          }
          function getTimezone() {
            try {
              return Intl.DateTimeFormat().resolvedOptions().timeZone
            } catch (e) {
              return 'UTC'
            }
          }
          // The headers the Airtable web client itself sends with /v0.3 calls.
          function baseHeaders() {
            return {
              'x-airtable-inter-service-client': 'webClient',
              'x-requested-with': 'XMLHttpRequest',
              'x-time-zone': getTimezone(),
            }
          }
          function newRequestId() {
            return 'req' + Math.random().toString(36).slice(2, 10)
          }
          function parseRetryAfterMs(value) {
            var text = String(value === null || value === undefined ? '' : value).trim()
            if (!text) return null
            var seconds = Number(text)
            if (!isNaN(seconds)) return Math.max(0, Math.round(seconds * 1000))
            var when = Date.parse(text)
            return isNaN(when) ? null : Math.max(0, when - Date.now())
          }
          async function handleResponse(response, endpoint) {
            if (!response.ok) {
              var errorBody = ''
              try {
                errorBody = String((await response.text()) || '').slice(0, 512)
              } catch (e) {}
              if (response.status === 429) {
                var retryAfter =
                  response.headers && response.headers.get
                    ? response.headers.get('Retry-After')
                    : null
                var retryMs = parseRetryAfterMs(retryAfter)
                return {
                  ok: false,
                  error_code: 'RATE_LIMITED',
                  message:
                    'Rate limited: ' +
                    endpoint +
                    ' — ' +
                    errorBody +
                    (retryMs === null ? '' : ' (retry after ' + retryMs + 'ms)'),
                }
              }
              if (response.status === 401)
                return {
                  ok: false,
                  error_code: 'AUTH',
                  message: 'Auth error (' + response.status + '): ' + errorBody,
                }
              if (response.status === 403) {
                // Airtable uses 403 for auth and for permission errors alike; the
                // body is the only tell.
                if (errorBody.indexOf('INVALID_PERMISSIONS') !== -1)
                  return {
                    ok: false,
                    error_code: 'VALIDATION',
                    message: 'Permission denied: ' + endpoint + ' — ' + errorBody,
                  }
                return {
                  ok: false,
                  error_code: 'AUTH',
                  message: 'Auth error (' + response.status + '): ' + errorBody,
                }
              }
              if (response.status === 404)
                return {
                  ok: false,
                  error_code: 'NOT_FOUND',
                  message: 'Not found: ' + endpoint + ' — ' + errorBody,
                }
              if (response.status === 422)
                return {
                  ok: false,
                  error_code: 'VALIDATION',
                  message: 'Invalid request: ' + endpoint + ' — ' + errorBody,
                }
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: 'API error (' + response.status + '): ' + endpoint + ' — ' + errorBody,
              }
            }
            if (response.status === 204) return { ok: true, data: {} }
            var json
            try {
              json = await response.json()
            } catch (e) {
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: 'Airtable returned invalid JSON: ' + endpoint,
              }
            }
            if (json && json.error) {
              var errMsg =
                json.error.message !== undefined && json.error.message !== null
                  ? json.error.message
                  : json.error.type !== undefined && json.error.type !== null
                    ? json.error.type
                    : 'Unknown error'
              if (json.error.type === 'NOT_FOUND' || json.error.type === 'MODEL_ID_NOT_FOUND')
                return {
                  ok: false,
                  error_code: 'NOT_FOUND',
                  message: 'Not found: ' + endpoint + ' — ' + errMsg,
                }
              if (json.error.type === 'INVALID_REQUEST' || json.error.type === 'INVALID_MODEL_ID')
                return {
                  ok: false,
                  error_code: 'VALIDATION',
                  message: 'Invalid request: ' + endpoint + ' — ' + errMsg,
                }
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: 'API error: ' + endpoint + ' — ' + errMsg,
              }
            }
            return {
              ok: true,
              data: json && json.data !== undefined && json.data !== null ? json.data : json,
            }
          }
          /**
           * GET /v0.3/<endpoint> with the upstream stringifiedObjectParams query,
           * a fresh requestId, the web-client headers and an optional
           * x-airtable-application-id.
           */
          async function apiGet(endpoint, params, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to Airtable.' }
            var headers = baseHeaders()
            if (options.appId) headers['x-airtable-application-id'] = options.appId
            var query = new URLSearchParams({
              stringifiedObjectParams: JSON.stringify(params || {}),
              requestId: newRequestId(),
            })
            var url = location.origin + '/v0.3/' + endpoint + '?' + query.toString()
            return sendRequest('GET', url, headers, undefined, endpoint)
          }
          /** POST /v0.3/<endpoint>: stringifiedObjectParams + requestId + _csrf. */
          async function apiPost(endpoint, params, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to Airtable.' }
            var headers = baseHeaders()
            headers['Content-Type'] = 'application/json'
            if (options.appId) headers['x-airtable-application-id'] = options.appId
            var body = JSON.stringify({
              stringifiedObjectParams: JSON.stringify(params || {}),
              requestId: newRequestId(),
              _csrf: auth.csrfToken,
            })
            return sendRequest(
              'POST',
              location.origin + '/v0.3/' + endpoint,
              headers,
              body,
              endpoint,
            )
          }
          async function sendRequest(method, url, headers, body, endpoint) {
            // Abort before the 25s browser command deadline can orphan the fetch, so
            // a timed-out call does not leave the request running in the tab.
            var controller = null
            var timer = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
                timer = setTimeout(function () {
                  try {
                    controller.abort()
                  } catch (e) {}
                }, IN_PAGE_DEADLINE_MS)
              } catch (e) {
                controller = null
              }
            }
            var initial = {
              method: method,
              headers: headers,
              body: body,
              credentials: 'include',
            }
            if (controller) initial.signal = controller.signal
            var response
            try {
              response = await fetch(url, initial)
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'API request timed out: ' + endpoint
                  : 'Network error: ' + (e && e.message ? e.message : String(e)),
              }
            }
            if (timer !== null) clearTimeout(timer)
            return handleResponse(response, endpoint)
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapValues(dict, mapper) {
            var out = []
            if (!dict) return out
            var keys = Object.keys(dict)
            for (var i = 0; i < keys.length; i++) out.push(mapper(dict[keys[i]]))
            return out
          }
          function mapList(list, mapper) {
            var out = []
            if (!list) return out
            for (var i = 0; i < list.length; i++) out.push(mapper(list[i]))
            return out
          }
          function text(value) {
            return value === undefined || value === null ? '' : value
          }
          function mapWorkspace(w) {
            w = w || {}
            var shared = w.sharedWithCurrentUser || {}
            var order = w.visibleApplicationOrder
            return {
              id: text(w.id),
              name: text(w.name),
              permission_level: text(shared.directPermissionLevel),
              base_count: order && typeof order.length === 'number' ? order.length : 0,
            }
          }
          function mapBase(b) {
            b = b || {}
            return {
              id: text(b.id),
              name: text(b.name),
              color: text(b.color),
              permission_level: text(b.currentUserEffectivePermissionLevel),
            }
          }
          function mapField(f) {
            f = f || {}
            return {
              id: text(f.id),
              name: text(f.name),
              type: text(f.type),
              description: text(f.description),
            }
          }
          function mapView(v) {
            v = v || {}
            return { id: text(v.id), name: text(v.name), type: text(v.type) }
          }
          function mapTable(t) {
            t = t || {}
            return {
              id: text(t.id),
              name: text(t.name),
              fields: mapList(t.columns, mapField),
              views: mapList(t.views, mapView),
            }
          }
          function mapRecord(r) {
            r = r || {}
            return {
              id: text(r.id),
              created_time: text(r.createdTime),
              cell_values: r.cellValuesByColumnId || {},
            }
          }
          function mapChoice(c) {
            c = c || {}
            return { id: text(c.id), name: text(c.name), color: text(c.color) }
          }
          function findTableData(tableDatas, tableId) {
            if (!tableDatas) return null
            for (var i = 0; i < tableDatas.length; i++) {
              var td = tableDatas[i]
              if (!td) continue
              if (td.id === tableId || td.tableId === tableId) return td
            }
            return null
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message }
          }
          function assertPage() {
            var host = location.hostname || ''
            if (host !== 'airtable.com' && host.slice(-13) !== '.airtable.com')
              return error('UNSUPPORTED_PAGE', 'Not on an airtable.com page.')
            return null
          }
          var airtableToolImplementations = {
      async get_field_choices(args) {
        var pageError = assertPage()
        if (pageError) return pageError
        var response = await apiGet(
          'application/' + args.base_id + '/read',
          {
          includeDataForTableIds: [],
          shouldIncludeSchemaChecksum: false,
          mayOnlyIncludeRowAndCellDataForIncludedViews: true,
          allowMsgpackOfResult: false,
        },
          { appId: args.base_id },
        )
        if (!response.ok) return response
        var data = response.data || {}
        var schemas = data.tableSchemas || []
        var table = null
        for (var i = 0; i < schemas.length; i++) {
          if (schemas[i] && schemas[i].id === args.table_id) {
            table = schemas[i]
            break
          }
        }
        if (!table) return error('NOT_FOUND', 'Table ' + args.table_id + ' not found')
        var columns = table.columns || []
        var field = null
        for (var j = 0; j < columns.length; j++) {
          if (columns[j] && columns[j].id === args.field_id) {
            field = columns[j]
            break
          }
        }
        if (!field)
          return error(
            'NOT_FOUND',
            'Field ' + args.field_id + ' not found in table ' + args.table_id,
          )
        if (field.type !== 'select' && field.type !== 'multiSelect')
          return error(
            'VALIDATION',
            'Field ' + args.field_id + ' is type "' + text(field.type) + '", not a select field',
          )
        var typeOptions = field.typeOptions || {}
        var choicesMap = typeOptions.choices || {}
        var choiceOrder = typeOptions.choiceOrder || Object.keys(choicesMap)
        var choices = []
        for (var k = 0; k < choiceOrder.length; k++) {
          var choiceId = choiceOrder[k]
          var choice = choicesMap[choiceId] || { id: choiceId }
          choices.push(mapChoice(choice))
        }
        return ok({ choices: choices })
      },
          }
          async function stdin_default(args) {
            return airtableToolImplementations['get_field_choices'](args)
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
            'The airtable.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Airtable API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The airtable.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
