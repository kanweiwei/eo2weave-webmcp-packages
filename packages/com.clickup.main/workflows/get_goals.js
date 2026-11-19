// Self-contained adapter workflow. The ClickUp page context and every
// apiUrlBase request stay inside the app.clickup.com tab.
//
// Ported from the OpenTabs clickup plugin (plugins/clickup/src, MIT): same
// endpoints, same mappers, same error classification. Upstream caches the
// session JWT in the extension auth cache; here it is read from the page on
// every call (see the runtime below).

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "workspace_id": {
        "type": "string",
        "description": "Workspace ID. Defaults to the current workspace."
      }
    },
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
    description: 'get_goals',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

        // Page-side ClickUp runtime (translated from OpenTabs clickup-api.ts and
        // tools/schemas.ts, MIT). Runs INSIDE the app.clickup.com tab: the
        // session JWT is captured from ClickUp's own WebSocket auth frame and
        // every request goes to the apiUrlBase the page stored in its
        // cuHandshake localStorage entry, carrying that JWT — the same
        // transport the ClickUp web client uses. No token ever leaves the page.
        var CLICKUP_HOST = 'app.clickup.com'

        // ClickUp's SPA sends {method:"auth", token, teamId} on its WebSocket
        // right after it connects. Upstream installs this interceptor at
        // adapter load time; a workflow here is injected per call, so it is
        // installed on the first call and captures the next auth frame.
        function installWsInterceptor() {
          var g = globalThis
          if (g.__cu_ws_interceptor_installed) return true
          if (typeof WebSocket !== 'function' || !WebSocket.prototype) return false
          var OrigSend = WebSocket.prototype.send
          if (typeof OrigSend !== 'function') return false
          WebSocket.prototype.send = function (data) {
            if (typeof data === 'string') {
              try {
                var parsed = JSON.parse(data)
                if (parsed && parsed.method === 'auth' && parsed.token) {
                  g.__cu_captured_jwt = parsed.token
                  if (parsed.teamId) g.__cu_captured_team_id = parsed.teamId
                }
              } catch (e) {
                // not JSON — ignore
              }
            }
            return OrigSend.call(this, data)
          }
          g.__cu_ws_interceptor_installed = true
          return true
        }

        function readHandshake() {
          try {
            var raw = localStorage.getItem('cuHandshake')
            if (!raw) return null
            var parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object') return null
            return parsed
          } catch (e) {
            return null
          }
        }

        function getAuth() {
          installWsInterceptor()
          var g = globalThis
          var token = g.__cu_captured_jwt
          if (!token || typeof token !== 'string') return null
          var handshake = readHandshake()
          if (!handshake) return null
          var capturedTeamId = g.__cu_captured_team_id
          var workspaceId = capturedTeamId || Object.keys(handshake)[0]
          if (!workspaceId) return null
          var entry = handshake[workspaceId]
          if (!entry || !entry.appEnvironment || !entry.appEnvironment.apiUrlBase) return null
          return {
            token: token,
            apiUrlBase: String(entry.appEnvironment.apiUrlBase),
            workspaceId: String(workspaceId),
          }
        }

        // Mirrors the plugin's getWorkspaceId(): the default workspace is the
        // one the handshake entry (or the captured teamId) named.
        function resolveWorkspace(args) {
          if (args && args.workspace_id) return String(args.workspace_id)
          var auth = getAuth()
          return auth ? auth.workspaceId : null
        }

        function buildQueryString(query) {
          var params = new URLSearchParams()
          var keys = Object.keys(query)
          for (var i = 0; i < keys.length; i++) {
            var value = query[keys[i]]
            if (value !== undefined && value !== null)
              params.append(keys[i], String(value))
          }
          return params.toString()
        }

        // Faithful translation of the plugin's api(): apiUrlBase + endpoint,
        // Authorization: Bearer <session JWT>, JSON bodies only, and the same
        // failure classification (401/403 auth, 404 not found, 400/422
        // validation, 429 rate limited). One deviation: a trailing slash on
        // apiUrlBase is dropped so base + '/path' cannot double up.
        async function clickupApi(endpoint, options) {
          options = options || {}
          var auth = getAuth()
          if (!auth)
            return {
              ok: false,
              error_code: 'AUTH',
              message: 'Not authenticated — please log in to ClickUp.',
            }
          var url = auth.apiUrlBase.replace(/\/+$/, '') + endpoint
          if (options.query) {
            var qs = buildQueryString(options.query)
            if (qs) url += '?' + qs
          }
          var headers = { Authorization: 'Bearer ' + auth.token }
          var fetchBody
          if (options.body) {
            headers['Content-Type'] = 'application/json'
            fetchBody = JSON.stringify(options.body)
          }
          // Abort the in-page fetch before the 25s browser command deadline can
          // orphan it.
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
                }, 20000)
              : null
          var response
          try {
            response = await fetch(url, {
              method: options.method || 'GET',
              headers: headers,
              body: fetchBody,
              credentials: 'include',
              signal: abortController ? abortController.signal : undefined,
            })
          } catch (e) {
            if (abortTimer !== null) clearTimeout(abortTimer)
            var aborted =
              e &&
              (e.name === 'AbortError' ||
                e.name === 'TimeoutError' ||
                String(e).indexOf('abort') !== -1)
            return {
              ok: false,
              error_code: aborted ? 'TIMEOUT' : 'NETWORK',
              message: aborted
                ? 'ClickUp request aborted after the 20s in-page deadline: ' + endpoint
                : 'Network error calling ClickUp: ' + String(e),
            }
          }
          if (response.status === 204) {
            if (abortTimer !== null) clearTimeout(abortTimer)
            return { ok: true, data: {} }
          }
          if (!response.ok) {
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (abortTimer !== null) clearTimeout(abortTimer)
            var detail = ''
            try {
              var parsed = JSON.parse(text)
              // ClickUp internal API error shape: {err: "...", ecode: "..."}.
              detail = parsed.err || parsed.ECODE || parsed.message || parsed.error || ''
              if (typeof detail === 'object') detail = JSON.stringify(detail)
            } catch (e) {}
            var errorCode = 'HTTP'
            if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
            else if (response.status === 404) errorCode = 'NOT_FOUND'
            else if (response.status === 400 || response.status === 422) errorCode = 'VALIDATION'
            else if (response.status === 429) errorCode = 'RATE_LIMITED'
            return {
              ok: false,
              error_code: errorCode,
              status: response.status,
              message:
                'ClickUp API error (' +
                response.status +
                '): ' +
                endpoint +
                ' — ' +
                (detail || text.slice(0, 512)),
            }
          }
          try {
            var data = await response.json()
            if (abortTimer !== null) clearTimeout(abortTimer)
            return { ok: true, data: data }
          } catch (e) {
            if (abortTimer !== null) clearTimeout(abortTimer)
            return {
              ok: false,
              error_code: 'HTTP',
              message: 'ClickUp returned invalid JSON: ' + endpoint,
            }
          }
        }

        // --- mappers (OpenTabs tools/schemas.ts) ---
        function mapUser(u) {
          u = u || {}
          return {
            id: u.id === undefined ? 0 : u.id,
            username: u.username || '',
            email: u.email || '',
            color: u.color || '',
            initials: u.initials || '',
            profile_picture: u.profilePicture === undefined ? null : u.profilePicture,
            timezone: u.timezone || '',
          }
        }

        function mapMember(m) {
          m = m || {}
          var u = m.user || {}
          return {
            id: u.id === undefined ? 0 : u.id,
            username: u.username || '',
            email: u.email || '',
            color: u.color || '',
            initials: u.initials || '',
            profile_picture: u.profilePicture === undefined ? null : u.profilePicture,
            role: m.role === undefined ? 0 : m.role,
          }
        }

        function mapWorkspace(w) {
          w = w || {}
          var owner = w.owner || {}
          return {
            id: w.id || '',
            name: w.name || '',
            color: w.color || '',
            plan_id: w.plan_id === undefined ? '' : w.plan_id,
            member_count: w.billed_users_this_cycle === undefined ? 0 : w.billed_users_this_cycle,
            date_created: w.date_created === undefined ? '' : w.date_created,
            owner: {
              id: owner.id === undefined ? 0 : owner.id,
              username: owner.username || '',
              email: owner.email || '',
              color: owner.color || '',
              initials: owner.initials || '',
              profile_picture: owner.profilePicture === undefined ? null : owner.profilePicture,
            },
          }
        }

        function mapSpace(s) {
          s = s || {}
          return {
            id: s.id || '',
            name: s.name || '',
            color: s.color || '',
            private: s.private === undefined ? false : !!s.private,
            archived: s.archived === undefined ? false : !!s.archived,
            date_created: s.date_created === undefined ? '' : s.date_created,
            multiple_assignees: s.multiple_assignees === undefined ? false : !!s.multiple_assignees,
          }
        }

        function mapFolder(f) {
          f = f || {}
          return {
            id: f.id || '',
            name: f.name || '',
            orderindex: f.orderindex === undefined ? 0 : f.orderindex,
            archived: f.archived === undefined ? false : !!f.archived,
            hidden: f.hidden === undefined ? false : !!f.hidden,
            space_id: f.project_id || '',
            date_updated: f.date_updated === undefined ? '' : f.date_updated,
          }
        }

        function mapList(l) {
          l = l || {}
          var category = l.category || {}
          var project = l.project || {}
          return {
            id: l.id || '',
            name: l.name || '',
            orderindex: l.orderindex === undefined ? 0 : l.orderindex,
            archived: l.archived === undefined ? false : !!l.archived,
            due_date: l.due_date === undefined ? null : l.due_date,
            start_date: l.start_date === undefined ? null : l.start_date,
            folder_id: category.id || '',
            space_id: project.id || '',
            date_updated: l.date_updated === undefined ? '' : l.date_updated,
            task_count: l.task_count === undefined ? 0 : l.task_count,
          }
        }

        function mapGoal(g) {
          g = g || {}
          var keyResults = g.key_results || []
          return {
            id: g.id || '',
            name: g.name || '',
            description: g.description || '',
            color: g.color || '',
            date_created: g.date_created === undefined ? '' : g.date_created,
            due_date: g.due_date === undefined ? null : g.due_date,
            percent_completed: g.percent_completed === undefined ? 0 : g.percent_completed,
            owner_id: g.creator === undefined ? 0 : g.creator,
            folder_id: g.folder_id === undefined ? null : g.folder_id,
            multiple_owners: g.multiple_owners === undefined ? false : !!g.multiple_owners,
            key_result_count: keyResults.length,
          }
        }

        function mapCustomField(f) {
          f = f || {}
          return {
            id: f.id || '',
            name: f.name || '',
            type: f.type || '',
            required: f.required === undefined ? false : !!f.required,
          }
        }

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
        function assertPage() {
          var host = location.hostname || ''
          if (host !== CLICKUP_HOST)
            return error('UNSUPPORTED_PAGE', 'Not on an app.clickup.com page.')
          return null
        }
        var clickupToolImplementations = {
          async get_goals(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            var wsId = resolveWorkspace(args)
            if (!wsId) return error('AUTH', 'Not authenticated — please log in to ClickUp.')
            var res = await clickupApi('/v1/team/' + encodeURIComponent(wsId) + '/goal')
            if (!res.ok) return error(res.error_code, res.message)
            var goals = (res.data && res.data.goals) || []
            return ok({ goals: goals.map(mapGoal) })
          },
        }

          async function stdin_default(args) {
            return clickupToolImplementations['get_goals'](args)
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
            'The ClickUp tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'ClickUp API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The ClickUp tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
