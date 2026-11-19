// Self-contained adapter workflow: POST /tasks/:gid/addFollowers — {data:{followers:[...]}}. All traffic stays
// inside the app.asana.com tab (same-origin /api/1.0, credentials: 'include');
// the session cookie never leaves page context.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "task_gid": {
        "type": "string",
        "minLength": 1,
        "description": "Task GID to add followers to"
      },
      "followers": {
        "minItems": 1,
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "description": "Array of user GIDs to add as followers"
      }
    },
    "required": [
      "task_gid",
      "followers"
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
    description: 'add_followers',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Asana runtime, translated from the OpenTabs asana plugin
          // (plugins/asana/src/asana-api.ts and tools/*.ts, MIT). Runs INSIDE
          // the app.asana.com tab: the session is the tab's own HttpOnly
          // auth_token cookie (never readable from JS), so every call is a
          // same-origin fetch with credentials: 'include'.
          var API_BASE = '/api/1.0'
          var AUTH_MESSAGE = 'Not authenticated — please log in to Asana.'

          // Upstream opt-in field lists (tools/schemas.ts). They are the only
          // fields the mappers read, so they travel on every request.
          var TASK_OPT_FIELDS =
            'name,completed,assignee.gid,assignee.name,due_on,due_at,start_on,notes,html_notes,projects.gid,projects.name,tags.gid,tags.name,parent.gid,num_subtasks,created_at,modified_at,permalink_url,resource_subtype'
          var PROJECT_OPT_FIELDS =
            'name,archived,color,notes,owner.gid,owner.name,team.gid,team.name,created_at,modified_at,due_on,start_on,permalink_url,public'
          var SECTION_OPT_FIELDS = 'name,created_at,project.gid'
          var STORY_OPT_FIELDS = 'text,created_by.gid,created_by.name,created_at,resource_subtype,type'
          var USER_OPT_FIELDS = 'name,email'

          // Asana's web client does not expose its cookie to JS. It publishes
          // the signed-in user id as a numeric global instead: window.env._user_id
          // on the app shell, page_load_globals.user_id on server-rendered pages.
          function getUserId() {
            var root = typeof window !== 'undefined' ? window : {}
            var env = root.env
            if (env && typeof env._user_id === 'number') return env._user_id
            var globals = root.page_load_globals
            if (globals && typeof globals.user_id === 'number') return globals.user_id
            return null
          }

          function isAuthenticated() {
            return getUserId() !== null
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

          // HTTP status -> this package's error codes, mirroring the upstream
          // httpStatusToToolError mapping (401/403 AUTH, 404 NOT_FOUND,
          // 429 RATE_LIMITED, 400/422 VALIDATION).
          function classifyStatus(status) {
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP'
          }

          // Asana reports failures as {"errors":[{"message":...}]}; keep the
          // first message and fall back to the raw (truncated) body.
          function errorDetail(text) {
            if (!text) return ''
            try {
              var parsed = JSON.parse(text)
              if (parsed && Array.isArray(parsed.errors) && parsed.errors.length) {
                var first = parsed.errors[0]
                if (first && first.message) return String(first.message)
              }
              if (parsed && parsed.error) return String(parsed.error)
              if (parsed && parsed.message) return String(parsed.message)
            } catch (e) {}
            return String(text).slice(0, 512)
          }

          async function asanaApi(endpoint, options) {
            options = options || {}
            if (!isAuthenticated())
              return { ok: false, error_code: 'AUTH', message: AUTH_MESSAGE }
            var method = options.method || 'GET'
            var path = API_BASE + endpoint
            if (options.query) {
              var qs = buildQuery(options.query)
              if (qs) path += '?' + qs
            }
            var headers = { Accept: 'application/json' }
            // Asana's own web client marks write requests with this header; the
            // API rejects cookie-authenticated mutations without it.
            if (method !== 'GET') headers['X-Allow-Asana-Client'] = '1'
            var body
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(options.body)
            }
            // Abort before the 25s browser command deadline can orphan the
            // request, so a stalled call does not keep running in the tab.
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var abortTimer =
              abortController !== null
                ? setTimeout(function () {
                    try {
                      abortController.abort()
                    } catch (e) {}
                  }, 18000)
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
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'Asana API request aborted after the 18s in-page deadline.'
                  : 'Network error calling the Asana API: ' + String(e),
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
                retry_after: response.headers && response.headers.get ? response.headers.get('Retry-After') : null,
                message:
                  'Asana API error (' +
                  response.status +
                  '): ' +
                  (errorDetail(text) || 'no response body'),
              }
            }
            if (abortTimer !== null) clearTimeout(abortTimer)
            // DELETE answers 204 No Content; the upstream api() returns {}.
            if (response.status === 204) return { ok: true, data: {} }
            try {
              return { ok: true, data: await response.json() }
            } catch (e) {
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Asana API returned invalid JSON',
              }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function text(value, fallback) {
            if (value === undefined || value === null) return fallback === undefined ? '' : fallback
            return String(value)
          }
          var MAX_HTML_NOTES = 2000
          function pairArray(list, name) {
            var out = []
            if (!Array.isArray(list)) return out
            for (var i = 0; i < list.length; i++) {
              var item = list[i] || {}
              out.push({ gid: text(item.gid), name: text(item.name) })
            }
            return out
          }
          function mapTask(t) {
            t = t || {}
            return {
              gid: text(t.gid),
              name: text(t.name),
              completed: t.completed === true,
              assignee_gid: text(t.assignee && t.assignee.gid),
              assignee_name: text(t.assignee && t.assignee.name),
              due_on: text(t.due_on),
              due_at: text(t.due_at),
              start_on: text(t.start_on),
              notes: text(t.notes),
              html_notes: text(t.html_notes).slice(0, MAX_HTML_NOTES),
              projects: pairArray(t.projects),
              tags: pairArray(t.tags),
              parent_gid: text(t.parent && t.parent.gid),
              num_subtasks: typeof t.num_subtasks === 'number' ? t.num_subtasks : 0,
              created_at: text(t.created_at),
              modified_at: text(t.modified_at),
              permalink_url: text(t.permalink_url),
              resource_subtype: text(t.resource_subtype, 'default_task'),
            }
          }
          function mapProject(p) {
            p = p || {}
            return {
              gid: text(p.gid),
              name: text(p.name),
              archived: p.archived === true,
              color: text(p.color),
              notes: text(p.notes),
              owner_gid: text(p.owner && p.owner.gid),
              owner_name: text(p.owner && p.owner.name),
              team_gid: text(p.team && p.team.gid),
              team_name: text(p.team && p.team.name),
              created_at: text(p.created_at),
              modified_at: text(p.modified_at),
              due_on: text(p.due_on),
              start_on: text(p.start_on),
              permalink_url: text(p.permalink_url),
              public: p.public === true,
            }
          }
          function mapSection(s) {
            s = s || {}
            return {
              gid: text(s.gid),
              name: text(s.name),
              created_at: text(s.created_at),
              project_gid: text(s.project && s.project.gid),
            }
          }
          function mapStory(s) {
            s = s || {}
            return {
              gid: text(s.gid),
              text: text(s.text),
              created_by_gid: text(s.created_by && s.created_by.gid),
              created_by_name: text(s.created_by && s.created_by.name),
              created_at: text(s.created_at),
              resource_subtype: text(s.resource_subtype),
              type: text(s.type),
            }
          }
          function mapUser(u) {
            u = u || {}
            return { gid: text(u.gid), name: text(u.name), email: text(u.email) }
          }
          function mapWorkspace(w) {
            w = w || {}
            return { gid: text(w.gid), name: text(w.name) }
          }
          function mapTag(t) {
            t = t || {}
            return { gid: text(t.gid), name: text(t.name), color: text(t.color) }
          }
          function mapTeam(t) {
            t = t || {}
            return {
              gid: text(t.gid),
              name: text(t.name),
              description: text(t.description),
            }
          }
          function mapList(list, mapper) {
            if (!Array.isArray(list)) return []
            var out = []
            for (var i = 0; i < list.length; i++) out.push(mapper(list[i]))
            return out
          }
          function nextPage(data) {
            if (data && data.next_page && data.next_page.offset) return data.next_page.offset
            return null
          }

          // --- result envelope ---
          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message }
          }
          function failure(response) {
            return error(response.error_code || 'UNKNOWN', response.message || 'Asana API call failed')
          }
          function assertPage() {
            if (location.hostname !== 'app.asana.com')
              return error('UNSUPPORTED_PAGE', 'Not on an app.asana.com page.')
            return null
          }

          var asanaToolImplementations = {
            async add_followers(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var response = await asanaApi('/tasks/' + args.task_gid + '/addFollowers', {
                method: 'POST',
                body: { data: { followers: args.followers } },
                query: { opt_fields: TASK_OPT_FIELDS },
              })
              if (!response.ok) return failure(response)
              return ok({ task: mapTask(response.data.data) })
            },
          }

          async function stdin_default(args) {
            return asanaToolImplementations['add_followers'](args)
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
            'The app.asana.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Asana API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The app.asana.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
