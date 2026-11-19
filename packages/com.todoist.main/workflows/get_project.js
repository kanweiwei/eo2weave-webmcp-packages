// Self-contained adapter workflow. The Todoist bearer token is read from the
// app.todoist.com tab's own localStorage and every API call stays inside that
// tab (same-origin /api/v1, credentials: 'include').

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "project_id": {
        "type": "string",
        "description": "The ID of the project to retrieve"
      }
    },
    "required": [
      "project_id"
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
    description: 'get_project',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Todoist runtime (translated from OpenTabs
          // plugins/todoist/src/todoist-api.ts and tools/schemas.ts, MIT). Runs
          // INSIDE the app.todoist.com tab: the bearer token is read from the
          // page's own localStorage, never leaves page context, and every call
          // is a same-origin fetch with credentials.
          var API_BASE = '/api/v1'
          var AUTH_MESSAGE = 'Not authenticated — please log in to Todoist.'

          function readToken() {
            // Re-read the page credential on every call, never cache it: a user
            // who signs out or switches accounts in a still-loaded tab must not
            // keep sending the previous account's token.
            var raw = null
            try {
              raw = window.localStorage.getItem('User')
            } catch (e) {
              return null
            }
            if (!raw) return null
            try {
              var user = JSON.parse(raw)
              if (!user || typeof user.token !== 'string' || !user.token) return null
              return user.token
            } catch (e) {
              return null
            }
          }

          // Filters undefined and repeats array values, like the SDK's
          // buildQueryString: an unset filter must not be sent as "undefined".
          function buildQuery(params) {
            var search = new URLSearchParams()
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined) continue
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++)
                  search.append(keys[i], String(value[j]))
              } else {
                search.append(keys[i], String(value))
              }
            }
            return search.toString()
          }

          // HTTP status -> error code, mirroring the SDK's
          // httpStatusToToolError mapping used by the upstream plugin.
          function classifyStatus(status) {
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP'
          }

          function errorDetail(text) {
            if (!text) return ''
            try {
              var parsed = JSON.parse(text)
              return parsed.error || parsed.error_tag || parsed.message || parsed.error_code || ''
            } catch (e) {
              return ''
            }
          }

          // Single page-side request helper: the upstream `api()` (JSON) and
          // `apiVoid()` (no body) differ only in whether the response is parsed.
          async function todoistRequest(endpoint, options) {
            options = options || {}
            var token = readToken()
            if (!token)
              return { ok: false, error_code: 'UNAUTHENTICATED', message: AUTH_MESSAGE }
            // `api()` defaults to GET; `apiVoid()` (close/reopen/delete/archive
            // and the shared-label moves) defaults to POST like upstream.
            var method = options.method || (options.void === true ? 'POST' : 'GET')
            var path = API_BASE + endpoint
            if (options.query) {
              var qs = buildQuery(options.query)
              if (qs) path += '?' + qs
            }
            var headers = { Authorization: 'Bearer ' + token }
            var body
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(options.body)
            }
            // Abort the in-page fetch before the 25s browser command deadline
            // can orphan it, so a timed-out call does not leave the request
            // running against the user's quota.
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var deadlineMs = 18000
            var startedAt = Date.now()
            var abortTimer =
              abortController !== null
                ? setTimeout(function () {
                    try {
                      abortController.abort()
                    } catch (e) {}
                  }, deadlineMs)
                : null
            var response
            try {
              response = await fetch(location.origin + path, {
                method: method,
                headers: headers,
                body: body,
                credentials: 'include',
                signal: abortController ? abortController.signal : undefined,
              })
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'Todoist API request aborted after the 18s in-page deadline.'
                  : 'Network error calling the Todoist API: ' + String(e),
              }
            }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              if (abortTimer !== null) clearTimeout(abortTimer)
              return {
                ok: false,
                error_code: classifyStatus(response.status),
                status: response.status,
                message:
                  'Todoist API error (' +
                  response.status +
                  '): ' +
                  (errorDetail(text) || text.slice(0, 512)),
              }
            }
            if (abortTimer !== null) clearTimeout(abortTimer)
            // close/reopen/delete/archive answer 204 No Content: never parse a
            // body for them (upstream `apiVoid` ignores it entirely).
            if (options.void === true) return { ok: true, data: {} }
            if (response.status === 204) return { ok: true, data: undefined }
            var contentLength = null
            try {
              contentLength =
                response.headers && response.headers.get
                  ? response.headers.get('content-length')
                  : null
            } catch (e) {}
            if (contentLength === '0') return { ok: true, data: undefined }
            try {
              return { ok: true, data: await response.json() }
            } catch (e) {
              var abortedBody =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (abortedBody)
                return {
                  ok: false,
                  error_code: 'NETWORK',
                  message: 'Todoist API response aborted after the 18s in-page deadline.',
                }
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Todoist API returned invalid JSON',
              }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapDue(d) {
            d = d || {}
            return {
              string: d.string === undefined || d.string === null ? '' : d.string,
              date: d.date === undefined || d.date === null ? '' : d.date,
              is_recurring: d.is_recurring === undefined ? false : !!d.is_recurring,
              datetime: d.datetime === undefined ? null : d.datetime,
              timezone: d.timezone === undefined ? null : d.timezone,
            }
          }
          function mapDuration(d) {
            d = d || {}
            return {
              amount: typeof d.amount === 'number' ? d.amount : 0,
              unit: d.unit === undefined || d.unit === null ? 'minute' : d.unit,
            }
          }
          function mapProject(p) {
            p = p || {}
            return {
              id: p.id === undefined || p.id === null ? '' : p.id,
              name: p.name === undefined || p.name === null ? '' : p.name,
              color: p.color === undefined || p.color === null ? '' : p.color,
              description:
                p.description === undefined || p.description === null ? '' : p.description,
              parent_id: p.parent_id === undefined ? null : p.parent_id,
              child_order: typeof p.child_order === 'number' ? p.child_order : 0,
              is_favorite: !!p.is_favorite,
              is_archived: !!p.is_archived,
              is_shared: !!p.is_shared,
              view_style:
                p.view_style === undefined || p.view_style === null ? 'list' : p.view_style,
              created_at: p.created_at === undefined || p.created_at === null ? '' : p.created_at,
              updated_at: p.updated_at === undefined || p.updated_at === null ? '' : p.updated_at,
              inbox_project: !!p.inbox_project,
            }
          }
          function mapTask(t) {
            t = t || {}
            return {
              id: t.id === undefined || t.id === null ? '' : t.id,
              content: t.content === undefined || t.content === null ? '' : t.content,
              description:
                t.description === undefined || t.description === null ? '' : t.description,
              project_id: t.project_id === undefined || t.project_id === null ? '' : t.project_id,
              section_id: t.section_id === undefined ? null : t.section_id,
              parent_id: t.parent_id === undefined ? null : t.parent_id,
              labels: Array.isArray(t.labels) ? t.labels : [],
              priority: typeof t.priority === 'number' ? t.priority : 1,
              due: t.due ? mapDue(t.due) : null,
              deadline: t.deadline && t.deadline.date ? { date: t.deadline.date } : null,
              duration: t.duration ? mapDuration(t.duration) : null,
              is_completed: !!t.checked,
              order: typeof t.child_order === 'number' ? t.child_order : 0,
              created_at: t.added_at === undefined || t.added_at === null ? '' : t.added_at,
              creator_id: t.user_id === undefined || t.user_id === null ? '' : t.user_id,
              assignee_id: t.responsible_uid === undefined ? null : t.responsible_uid,
              comment_count: typeof t.note_count === 'number' ? t.note_count : 0,
              url: t.id ? 'https://app.todoist.com/app/task/' + t.id : '',
            }
          }
          function mapSection(s) {
            s = s || {}
            return {
              id: s.id === undefined || s.id === null ? '' : s.id,
              name: s.name === undefined || s.name === null ? '' : s.name,
              project_id: s.project_id === undefined || s.project_id === null ? '' : s.project_id,
              order: typeof s.section_order === 'number' ? s.section_order : 0,
              is_archived: !!s.is_archived,
              created_at: s.added_at === undefined || s.added_at === null ? '' : s.added_at,
              updated_at: s.updated_at === undefined || s.updated_at === null ? '' : s.updated_at,
            }
          }
          function mapComment(c) {
            c = c || {}
            return {
              id: c.id === undefined || c.id === null ? '' : c.id,
              content: c.content === undefined || c.content === null ? '' : c.content,
              task_id: c.item_id === undefined || c.item_id === null ? '' : c.item_id,
              posted_at: c.posted_at === undefined || c.posted_at === null ? '' : c.posted_at,
              poster_id: c.posted_uid === undefined || c.posted_uid === null ? '' : c.posted_uid,
            }
          }
          function mapLabel(l) {
            l = l || {}
            return {
              id: l.id === undefined || l.id === null ? '' : l.id,
              name: l.name === undefined || l.name === null ? '' : l.name,
              color: l.color === undefined || l.color === null ? '' : l.color,
              order: typeof l.order === 'number' ? l.order : 0,
              is_favorite: !!l.is_favorite,
            }
          }
          function mapCollaborator(c) {
            c = c || {}
            return {
              id: c.id === undefined || c.id === null ? '' : c.id,
              name: c.name === undefined || c.name === null ? '' : c.name,
              email: c.email === undefined || c.email === null ? '' : c.email,
            }
          }

          // --- result envelope ---
          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return {
              status: 'error',
              data: null,
              error_code: code,
              message: message,
              page_url: location.href,
            }
          }
          function failure(response) {
            return error(response.error_code || 'UNKNOWN', response.message || 'Todoist API call failed')
          }
          function assertPage() {
            if (location.hostname !== 'app.todoist.com')
              return error('UNSUPPORTED_PAGE', 'Not on an app.todoist.com page.')
            return null
          }
          // `results`-shaped list envelope: missing results degrade to an empty
          // list instead of a TypeError, matching this repo's other ports.
          function listResults(response) {
            var data = response.data || {}
            return Array.isArray(data.results) ? data.results : []
          }
          // Copy every supplied key: the upstream handlers that forward the
          // validated input as the request body (`body: params`).
          function copyDefined(args) {
            var body = {}
            var keys = Object.keys(args || {})
            for (var i = 0; i < keys.length; i++) {
              if (args[keys[i]] === undefined) continue
              body[keys[i]] = args[keys[i]]
            }
            return body
          }
          // Copy every supplied key except the path id — the upstream
          // `const { id, ...body } = params` pattern.
          function omitKey(args, key) {
            var body = {}
            var keys = Object.keys(args || {})
            for (var i = 0; i < keys.length; i++) {
              if (keys[i] === key) continue
              if (args[keys[i]] === undefined) continue
              body[keys[i]] = args[keys[i]]
            }
            return body
          }

          var todoistToolImplementations = {
            async get_project(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var response = await todoistRequest('/projects/' + args.project_id)
              if (!response.ok) return failure(response)
              return ok({ project: mapProject(response.data) })
            },
          }

          async function stdin_default(args) {
            return todoistToolImplementations['get_project'](args)
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
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The app.todoist.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Todoist API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The app.todoist.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
