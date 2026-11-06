// Self-contained adapter workflow. Authenticates through the notion.so cookie session (notion_user_id cookie + workspace spaceId); all API calls stay inside the tab.

export default {
  inputSchema: {
      "type": "object",
      "properties": {
          "query": {
              "type": "string",
              "description": "Search query text",
              "minLength": 1
          },
          "limit": {
              "type": "number",
              "description": "Maximum number of results to return (default 10, max 100)"
          }
      },
      "required": [
          "query"
      ],
      "additionalProperties": false
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
      },
      data: {
        type: ['object', 'null'],
      },
      message: {
        type: ['string', 'null'],
      },
      error_code: {
        type: ['string', 'null'],
      },
    },
    required: ['status', 'data'],
    additionalProperties: false,
  },
  tree: {
    type: 'action',
    description: 'search',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      // Absolute deadline (epoch ms) for the WHOLE command, computed on the
      // adapter side before the eval is dispatched: the browser's 25s
      // timeout includes the tab-command queue wait, so the in-page fetch
      // must never outlive this instant (finding: an eval that starts late
      // could otherwise arm a full fresh deadline and complete after the
      // caller already received TAB_UNAVAILABLE).
      const commandDeadlineMs = Date.now() + options.timeout
      const execute = async (args) => {
        var workflow = (() => {


          // Page-side Notion runtime (translated from OpenTabs notion-api.ts, MIT).
          // Runs INSIDE the notion.so tab: the cookie session never leaves page context.
          // The API caller adds the x-notion-active-user-header / x-notion-space-id
          // headers Notion's own web app sends, and clears the cached auth on 401.
          function getCookie(name) {
            var parts = document.cookie.split(';')
            for (var i = 0; i < parts.length; i++) {
              var kv = parts[i].trim()
              var eq = kv.indexOf('=')
              if (eq === -1) continue
              if (kv.slice(0, eq) === name) return kv.slice(eq + 1)
            }
            return null
          }
          function getLocalStorageValue(key) {
            try {
              return window.localStorage.getItem(key)
            } catch (e) {
              return null
            }
          }
          function getAuth() {
            var cached = null
            try {
              cached = JSON.parse(window.sessionStorage.getItem('__eo2NotionAuth') || 'null')
            } catch (e) {}
            if (cached && cached.userId) return cached
            var userId = getCookie('notion_user_id')
            if (!userId) return null
            var spaceId = getSpaceIdFromLocalStorage() || ''
            var auth = { userId: userId, spaceId: spaceId }
            try {
              window.sessionStorage.setItem('__eo2NotionAuth', JSON.stringify(auth))
            } catch (e) {}
            return auth
          }
          function setAuthCache(auth) {
            try {
              window.sessionStorage.setItem('__eo2NotionAuth', JSON.stringify(auth))
            } catch (e) {}
          }
          function clearAuthCache() {
            try {
              window.sessionStorage.removeItem('__eo2NotionAuth')
            } catch (e) {}
          }
          function getSpaceIdFromLocalStorage() {
            try {
              var lastVisitedRoute = getLocalStorageValue('LRU:KeyValueStore2:lastVisitedRouteSpaceId')
              if (lastVisitedRoute) {
                var parsed = JSON.parse(lastVisitedRoute)
                if (parsed && parsed.value) return parsed.value
              }
            } catch (e) {}
            try {
              for (var i = 0; i < window.localStorage.length; i++) {
                var key = window.localStorage.key(i)
                if (key && key.indexOf('spaceId') !== -1) {
                  var value = window.localStorage.getItem(key)
                  try {
                    var parsedEntry = JSON.parse(value)
                    if (parsedEntry && parsedEntry.value && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(parsedEntry.value))
                      return parsedEntry.value
                  } catch (e2) {
                    if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return value
                  }
                }
              }
            } catch (e3) {}
            return null
          }
          async function resolveSpaceId(auth) {
            if (auth.spaceId) return auth.spaceId
            var data = await notionApi('getSpaces', {})
            if (!data.ok) return null
            var userSpaces = data.data[auth.userId]
            if (userSpaces && userSpaces.space) {
              var keys = Object.keys(userSpaces.space)
              var firstSpaceId = keys[0]
              if (firstSpaceId) {
                auth.spaceId = firstSpaceId
                setAuthCache(auth)
                return firstSpaceId
              }
            }
            return null
          }
          async function getSpaceId() {
            var auth = getAuth()
            if (!auth) return null
            return resolveSpaceId(auth)
          }
          function getUserId() {
            var auth = getAuth()
            return auth ? auth.userId : null
          }
          // One absolute in-page deadline per request. The browser's 25s command
          // timeout includes the tab-command queue wait, so the fetch must never
          // outlive the command deadline: a request that outlives it could apply
          // a write after the caller already received TAB_UNAVAILABLE.
          var IN_PAGE_DEADLINE_MS = 18000
          function remainingBudgetMs() {
            var remaining = IN_PAGE_DEADLINE_MS
            try {
              var commandDeadline = args && args.__eo2CommandDeadlineMs
              if (typeof commandDeadline === 'number' && commandDeadline > 0) {
                var commandRemaining = commandDeadline - Date.now()
                if (commandRemaining < remaining) remaining = commandRemaining
              }
            } catch (e) {}
            return remaining
          }
          async function boundedFetch(url, init) {
            var remaining = remainingBudgetMs()
            if (remaining <= 0)
              return {
                ok: false,
                status: 0,
                text: '',
                error_code: 'NETWORK',
                message:
                  'Request not sent: the browser command deadline expired before the page eval started.',
              }
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var abortTimer =
              abortController !== null
                ? setTimeout(
                    function () {
                      try {
                        abortController.abort()
                      } catch (e) {}
                    },
                    Math.max(1, remaining),
                  )
                : null
            var response
            try {
              var requestInit = {}
              var initKeys = init ? Object.keys(init) : []
              for (var i = 0; i < initKeys.length; i++) requestInit[initKeys[i]] = init[initKeys[i]]
              requestInit.signal = abortController ? abortController.signal : undefined
              response = await fetch(url, requestInit)
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                status: 0,
                text: '',
                error_code: 'NETWORK',
                message: aborted
                  ? 'Request aborted after the in-page deadline.'
                  : 'Network error: ' + String(e),
              }
            }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (abortTimer !== null) clearTimeout(abortTimer)
            return {
              ok: response.ok,
              status: response.status,
              text: text,
              contentType: response.headers ? response.headers.get('content-type') || '' : '',
            }
          }
          async function notionApi(endpoint, body) {
            var auth = getAuth()
            if (!auth)
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to Notion.' }
            var url = location.origin + '/api/v3/' + endpoint
            var headers = { 'Content-Type': 'application/json' }
            if (auth.userId) headers['x-notion-active-user-header'] = auth.userId
            if (auth.spaceId) headers['x-notion-space-id'] = auth.spaceId
            var response = await boundedFetch(url, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(body),
              credentials: 'include',
            })
            if (!response.ok && response.error_code)
              return { ok: false, error_code: response.error_code, message: response.message }
            if (!response.ok) {
              var errorText = (response.text || '').substring(0, 512)
              if (response.status === 401) clearAuthCache()
              if (response.status === 429)
                return { ok: false, error_code: 'RATE_LIMITED', status: 429, message: 'Rate limited: ' + endpoint + ' — ' + errorText }
              if (response.status === 401 || response.status === 403)
                return { ok: false, error_code: 'AUTH', status: response.status, message: 'Auth error (' + response.status + '): ' + errorText }
              if (response.status === 404)
                return { ok: false, error_code: 'NOT_FOUND', status: 404, message: 'Not found: ' + endpoint + ' — ' + errorText }
              try {
                var parsed = JSON.parse(errorText)
                if (parsed.name === 'ValidationError')
                  return { ok: false, error_code: 'VALIDATION', message: 'Validation error: ' + (parsed.debugMessage || parsed.message || errorText) }
              } catch (e3) {}
              return { ok: false, error_code: 'HTTP', status: response.status, message: 'API error (' + response.status + '): ' + endpoint + ' — ' + errorText }
            }
            if (response.status === 204) return { ok: true, data: {} }
            var contentType = response.contentType || ''
            if (contentType.indexOf('application/json') === -1)
              return { ok: false, error_code: 'HTTP', message: 'Unexpected response type (' + contentType + ') from ' + endpoint }
            try {
              return { ok: true, data: JSON.parse(response.text) }
            } catch (e5) {
              return { ok: false, error_code: 'HTTP', message: 'Notion API returned invalid JSON' }
            }
          }
          function richTextToPlain(richText) {
            if (!Array.isArray(richText)) return ''
            var out = []
            for (var i = 0; i < richText.length; i++) {
              var segment = richText[i]
              if (Array.isArray(segment) && typeof segment[0] === 'string') out.push(segment[0])
              else if (typeof segment === 'string') out.push(segment)
            }
            return out.join('')
          }
          function formatTimestamp(ts) {
            if (typeof ts === 'number') return new Date(ts).toISOString()
            if (typeof ts === 'string') return ts
            return ''
          }
          function mapBlock(b) {
            b = b || {}
            var text = richTextToPlain(b.properties && b.properties.title)
            var content = b.content
            return {
              id: b.id || '',
              type: b.type || '',
              text: text,
              has_children: Array.isArray(content) && content.length > 0,
              created_time: formatTimestamp(b.created_time),
              last_edited_time: formatTimestamp(b.last_edited_time),
              parent_id: b.parent_id || '',
            }
          }
          function mapPage(b) {
            b = b || {}
            var format = b.format || {}
            var id = b.id || ''
            return {
              id: id,
              title: richTextToPlain(b.properties && b.properties.title),
              type: b.type || '',
              icon: format.page_icon || '',
              cover: format.page_cover || '',
              parent_id: b.parent_id || '',
              parent_type: b.parent_table || '',
              created_time: formatTimestamp(b.created_time),
              last_edited_time: formatTimestamp(b.last_edited_time),
              created_by: b.created_by_id || '',
              last_edited_by: b.last_edited_by_id || '',
              url: id ? location.origin + '/' + id.replace(/-/g, '') : '',
            }
          }
          function mapUser(u) {
            u = u || {}
            return {
              id: u.id || '',
              name: u.name || '',
              email: u.email || '',
              profile_photo: u.profile_photo || '',
            }
          }
          function mapDatabase(c) {
            c = c || {}
            var schema = c.schema || {}
            var properties = []
            var keys = Object.keys(schema)
            for (var i = 0; i < keys.length; i++) {
              var prop = schema[keys[i]] || {}
              var options = []
              if (Array.isArray(prop.options)) {
                for (var j = 0; j < prop.options.length; j++) {
                  var o = prop.options[j] || {}
                  options.push({ id: o.id || '', value: o.value || '', color: o.color || '' })
                }
              }
              properties.push({ id: keys[i], name: prop.name || '', type: prop.type || '', options: options })
            }
            return {
              id: c.id || '',
              name: richTextToPlain(c.name),
              icon: c.icon || '',
              properties: properties,
              parent_id: c.parent_id || '',
            }
          }
          function mapDatabaseItem(b, schema) {
            b = b || {}
            var props = b.properties
            var id = b.id || ''
            var propertyValues = {}
            if (props && schema) {
              var keys = Object.keys(schema)
              for (var i = 0; i < keys.length; i++) {
                var key = keys[i]
                var name = (schema[key] && schema[key].name) || key
                var value = props[key]
                if (value !== undefined) propertyValues[name] = richTextToPlain(value)
              }
            }
            return {
              id: id,
              title: richTextToPlain(props && props.title),
              properties: propertyValues,
              url: id ? location.origin + '/' + id.replace(/-/g, '') : '',
              created_time: formatTimestamp(b.created_time),
              last_edited_time: formatTimestamp(b.last_edited_time),
            }
          }
          function uuid() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
              var r = (Math.random() * 16) | 0
              var v = c === 'x' ? r : (r & 0x3) | 0x8
              return v.toString(16)
            })
          }
          function nowMs() {
            return Date.now()
          }
          function ok(data) {
            return {
              status: 'ok',
              data,
              message: null,
              page_url: location.href,
            }
          }
          function error(code, message) {
            return {
              status: 'error',
              data: null,
              error_code: code,
              message,
              page_url: location.href,
            }
          }
          var toolImplementations = {


            async search(args) {
              if (location.hostname !== 'app.notion.com')
                return error('UNSUPPORTED_PAGE', 'Not on an app.notion.com page.')
              var spaceId = await getSpaceId()
              if (!spaceId)
                return error('AUTH', 'Could not determine workspace — please reload the page.')
              var response = await notionApi('search', {
                type: 'BlocksInSpace',
                query: args.query,
                spaceId: spaceId,
                limit: args.limit !== undefined ? args.limit : 10,
                filters: {
                  isDeletedOnly: false,
                  excludeTemplates: true,
                  navigableBlockContentOnly: true,
                  requireEditPermissions: false,
                  ancestors: [],
                  createdBy: [],
                  editedBy: [],
                  lastEditedTime: {},
                  createdTime: {},
                  inTeams: [],
                },
                sort: { field: 'relevance', direction: 'desc' },
                source: 'quick_find',
              })
              if (!response.ok) return response
              var results = Array.isArray(response.data.results) ? response.data.results : []
              var pages = []
              for (var i = 0; i < results.length; i++) {
                var entry = response.data.recordMap && response.data.recordMap.block && response.data.recordMap.block[results[i].id]
                pages.push(mapPage(entry && entry.value))
              }
              return ok({ total: response.data.total !== undefined ? response.data.total : 0, pages: pages })
            },
          }

          async function stdin_default(args) {
            return toolImplementations['search'](args)
          }
          return stdin_default
        })()

        return workflow(args)
      }
      let response
      try {
        // The command deadline rides into the page via __args so the
        // in-page abort timer can clamp its remaining budget to it (the
        // browser's 25s timeout includes the tab-command queue wait).
        const inputWithDeadline = {
          ...input,
          __eo2CommandDeadlineMs: commandDeadlineMs,
        }
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(inputWithDeadline) + ')',
          options,
        )
      } catch (error) {
        // An eval rejection whose error name carries the source marker
        // means the eval HARNESS itself faulted (page-side runtime error)
        // while the tab is still alive — TAB_UNAVAILABLE would mislead the
        // caller into reopening a healthy tab, so it gets EVAL_FAILED.
        if (error instanceof Error && error.name === '__eo2EvalSourceMarker__') {
          state.result = {
            status: 'error',
            data: null,
            message: 'The notion.so tab failed to run the tool (internal eval error): ' +
              String(error),
            error_code: 'EVAL_FAILED',
          }
          return 'success'
        }
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The notion.so tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'notion.so API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The notion.so tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
