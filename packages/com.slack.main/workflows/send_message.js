// Self-contained adapter workflow. The xoxc- Slack session token and every
// slack.com API call stay inside the *.slack.com tab.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "channel": {
        "type": "string",
        "minLength": 1,
        "description": "Channel ID to send the message to (e.g., C01234567)"
      },
      "text": {
        "type": "string",
        "minLength": 1,
        "description": "Message text to send — supports Slack mrkdwn formatting"
      },
      "thread_ts": {
        "type": "string",
        "description": "Thread timestamp to reply in a thread — pass the ts of the parent message"
      }
    },
    "required": [
      "channel",
      "text"
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
    description: 'send_message',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Slack runtime (translated from OpenTabs slack-api.ts, MIT).
          // Runs INSIDE the *.slack.com tab: the xoxc- session token is read from the
          // page's own runtime state and never leaves page context.
          var API_DEADLINE_MS = 18000
          var SLACK_AUTH_ERRORS = ['not_authed', 'invalid_auth', 'account_inactive', 'token_revoked', 'token_expired', 'missing_scope']
          var SLACK_NOT_FOUND_ERRORS = ['channel_not_found', 'user_not_found', 'message_not_found', 'not_in_channel']
          var SLACK_VALIDATION_ERRORS = ['invalid_arguments', 'too_many_attachments', 'msg_too_long', 'no_text', 'invalid_blocks']

          function orEmpty(value) {
            return value === undefined || value === null ? '' : value
          }
          function orDefault(value, fallback) {
            return value === undefined || value === null ? fallback : value
          }
          function toolError(code, message) {
            var error = new Error(message)
            error.__toolError = code
            return error
          }
          // Upstream's ToolError is thrown; here the same categories travel as codes so
          // the adapter can report them without letting a page-side rejection escape.
          function classifySlackError(code) {
            if (SLACK_AUTH_ERRORS.indexOf(code) !== -1) return 'AUTH'
            if (SLACK_NOT_FOUND_ERRORS.indexOf(code) !== -1) return 'NOT_FOUND'
            if (code === 'ratelimited') return 'RATE_LIMITED'
            if (SLACK_VALIDATION_ERRORS.indexOf(code) !== -1) return 'VALIDATION'
            return 'API'
          }
          function parseRetryAfterMs(value) {
            if (value === null || value === undefined) return undefined
            var text = String(value).trim()
            if (/^\d+$/.test(text)) return parseInt(text, 10) * 1000
            var when = Date.parse(text)
            if (isNaN(when)) return undefined
            var delta = when - Date.now()
            return delta > 0 ? delta : 0
          }
          function getPageGlobal(path) {
            try {
              var parts = String(path).split('.')
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
          function getLocalStorageValue(key) {
            try {
              if (typeof localStorage === 'undefined' || !localStorage) return null
              var value = localStorage.getItem(key)
              return typeof value === 'string' ? value : null
            } catch (e) {
              return null
            }
          }
          // localStorage is walked through its own key()/length API so a page that has
          // removed the storage object cannot make the auth probe throw.
          function findLocalStorageEntry(predicate) {
            try {
              if (typeof localStorage === 'undefined' || !localStorage) return null
              var length = localStorage.length
              for (var i = 0; i < length; i++) {
                var key = localStorage.key(i)
                if (key === null || key === undefined) continue
                if (!predicate(key)) continue
                var value = localStorage.getItem(key)
                if (typeof value !== 'string') continue
                return { key: key, value: value }
              }
              return null
            } catch (e) {
              return null
            }
          }
          // The workspace URL must be https before a token is ever attached to it:
          // an http team_url would put the xoxc- token on the wire in clear text.
          function buildAuth(token, teamId, teamUrl) {
            var url = String(teamUrl || '').replace(/\/$/, '') || location.origin
            url = url.replace(/^http:\/\//i, 'https://')
            return { token: token, workspaceUrl: url, teamId: teamId || '' }
          }
          function extractAuthFromObject(obj, depth) {
            depth = depth || 0
            if (depth > 3 || typeof obj !== 'object' || obj === null) return null
            if (Array.isArray(obj)) {
              for (var i = 0; i < obj.length; i++) {
                var fromItem = extractAuthFromObject(obj[i], depth + 1)
                if (fromItem) return fromItem
              }
              return null
            }
            var tokenCandidate = obj.api_token
            if (tokenCandidate === undefined) tokenCandidate = obj.token
            if (typeof tokenCandidate === 'string' && tokenCandidate.indexOf('xoxc-') === 0) {
              return buildAuth(
                tokenCandidate,
                typeof obj.team_id === 'string' ? obj.team_id : undefined,
                typeof obj.team_url === 'string' ? obj.team_url : undefined,
              )
            }
            var values = Object.keys(obj)
            for (var k = 0; k < values.length; k++) {
              var value = obj[values[k]]
              if (typeof value === 'object' && value !== null) {
                var nested = extractAuthFromObject(value, depth + 1)
                if (nested) return nested
              }
            }
            return null
          }
          function authFromBootData(bootData) {
            if (!bootData || typeof bootData.api_token !== 'string') return null
            if (bootData.api_token.indexOf('xoxc-') !== 0) return null
            return buildAuth(
              bootData.api_token,
              typeof bootData.team_id === 'string' ? bootData.team_id : undefined,
              typeof bootData.team_url === 'string' ? bootData.team_url : undefined,
            )
          }
          // Legacy client (WORKSPACE.slack.com): workspace config in localConfig_v2/v3.
          function getAuthFromLocalStorage() {
            try {
              var candidates = ['localConfig_v2', 'localConfig_v3']
              var raw = null
              for (var i = 0; i < candidates.length; i++) {
                raw = getLocalStorageValue(candidates[i])
                if (raw) break
              }
              if (!raw) return null
              var config = JSON.parse(raw)
              if (!config || !config.teams) return null
              var teamId = config.lastActiveTeamId
              if (teamId === undefined || teamId === null) {
                var ids = Object.keys(config.teams)
                teamId = ids.length > 0 ? ids[0] : undefined
              }
              if (!teamId) return null
              var team = config.teams[teamId]
              if (!team || !team.token) return null
              return buildAuth(team.token, teamId, undefined)
            } catch (e) {
              return null
            }
          }
          // window.boot_data (SSR), window.TS.boot_data / .model / .redux (classic client).
          function getAuthFromBootData() {
            try {
              var direct = authFromBootData(getPageGlobal('boot_data'))
              if (direct) return direct
              var ts = getPageGlobal('TS')
              if (!ts) return null
              var tsBoot = authFromBootData(ts.boot_data)
              if (tsBoot) return tsBoot
              if (ts.model && typeof ts.model.api_token === 'string' && ts.model.api_token.indexOf('xoxc-') === 0) {
                var team = ts.model.team || {}
                return buildAuth(
                  ts.model.api_token,
                  team.id,
                  team.url || (team.domain ? 'https://' + team.domain + '.slack.com' : undefined),
                )
              }
              if (ts.redux && typeof ts.redux.getState === 'function') {
                var state = ts.redux.getState()
                var reduxBoot = authFromBootData(state && state.boot)
                if (reduxBoot) return reduxBoot
              }
              return null
            } catch (e) {
              return null
            }
          }
          function extractAuthFromScriptText(text) {
            var tokenMatch = /["']?api_token["']?\s*:\s*["'](xoxc-[a-zA-Z0-9_-]+)["']/.exec(text)
            if (!tokenMatch || !tokenMatch[1]) return null
            var teamIdMatch = /["']?team_id["']?\s*:\s*["'](T[A-Z0-9]+)["']/.exec(text)
            var teamUrlMatch = /["']?team_url["']?\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(text)
            return buildAuth(
              tokenMatch[1],
              teamIdMatch && teamIdMatch[1] ? teamIdMatch[1] : undefined,
              teamUrlMatch && teamUrlMatch[1] ? teamUrlMatch[1].replace(/\/$/, '') : undefined,
            )
          }
          // Server-rendered config: inline <script> blocks and a data-boot attribute.
          function getAuthFromPageScripts() {
            try {
              var scripts = (document && document.querySelectorAll) ? document.querySelectorAll('script:not([src])') : []
              for (var i = 0; i < scripts.length; i++) {
                var script = scripts[i]
                var text = script && script.textContent
                if (!text || text.indexOf('xoxc-') === -1) continue
                var type = script.type || ''
                if (type === 'application/json' || type === 'application/ld+json') {
                  try {
                    var parsed = extractAuthFromObject(JSON.parse(text))
                    if (parsed) return parsed
                  } catch (e) {
                    // Not valid JSON — fall through to the regex extraction below.
                  }
                }
                var fromText = extractAuthFromScriptText(text)
                if (fromText) return fromText
              }
              var htmlEl = document ? document.documentElement : null
              var bootAttr = htmlEl && htmlEl.getAttribute ? htmlEl.getAttribute('data-boot') : null
              if (bootAttr && bootAttr.indexOf('xoxc-') !== -1) {
                try {
                  var fromAttr = extractAuthFromObject(JSON.parse(bootAttr))
                  if (fromAttr) return fromAttr
                } catch (e) {
                  var fromAttrText = extractAuthFromScriptText(bootAttr)
                  if (fromAttrText) return fromAttrText
                }
              }
              return null
            } catch (e) {
              return null
            }
          }
          // Last resort: any localStorage key carrying an xoxc- token. The two config
          // keys are skipped because getAuthFromLocalStorage already handled them.
          function getAuthFromLocalStorageScan() {
            try {
              var tried = {}
              for (;;) {
                var entry = findLocalStorageEntry(function (key) {
                  if (tried[key]) return false
                  if (key === 'localConfig_v2' || key === 'localConfig_v3') return false
                  return true
                })
                if (!entry) return null
                tried[entry.key] = true
                if (entry.value.indexOf('xoxc-') === -1) continue
                try {
                  var fromJson = extractAuthFromObject(JSON.parse(entry.value))
                  if (fromJson) return fromJson
                } catch (e) {
                  var tokenMatch = /(xoxc-[a-zA-Z0-9_-]+)/.exec(entry.value)
                  if (tokenMatch && tokenMatch[1]) return buildAuth(tokenMatch[1])
                }
              }
            } catch (e) {
              return null
            }
          }
          // Enterprise Grid workspaces belong to the upstream slack-enterprise plugin.
          function isEnterpriseWorkspace() {
            var path = (location && location.pathname) || ''
            if (/\/client\/E[A-Z0-9]+/.test(path)) return true
            try {
              var keys = ['localConfig_v2', 'localConfig_v3']
              for (var i = 0; i < keys.length; i++) {
                var raw = getLocalStorageValue(keys[i])
                if (!raw) continue
                var config = JSON.parse(raw)
                if (config && typeof config.lastActiveTeamId === 'string' && config.lastActiveTeamId.charAt(0) === 'E')
                  return true
              }
            } catch (e) {
              // A config parse failure is not an enterprise signal.
            }
            var bootData = getPageGlobal('boot_data')
            if (bootData && bootData.is_enterprise_install === true) return true
            return false
          }
          // Re-read on every call, never cached: an account switch in a still-loaded tab
          // must not keep sending requests with the previous account's token.
          function getAuth() {
            if (isEnterpriseWorkspace()) return null
            return (
              getAuthFromLocalStorage() ||
              getAuthFromBootData() ||
              getAuthFromPageScripts() ||
              getAuthFromLocalStorageScan()
            )
          }
          function requireAuth() {
            var auth = getAuth()
            if (auth) return auth
            if (isEnterpriseWorkspace())
              throw toolError(
                'ENTERPRISE_WORKSPACE',
                'This tab is an Enterprise Grid workspace; com.slack.main covers standard workspaces only.',
              )
            throw toolError('AUTH', 'Not authenticated — no Slack session token found')
          }
          function isSlackHost() {
            var host = (location && location.hostname) || ''
            return host === 'slack.com' || host.slice(-10) === '.slack.com'
          }
          // Shared response handling: rate limits, HTTP status, Slack's {ok:false,error}
          // envelope. `validationOn400` is the file-upload path, which reports 400 as a
          // validation failure.
          async function readSlackResponse(response, label, validationOn400) {
            if (response.status === 429) {
              var retryAfter = null
              try {
                retryAfter = response.headers && response.headers.get ? response.headers.get('Retry-After') : null
              } catch (e) {}
              var retryMs = parseRetryAfterMs(retryAfter)
              var hint =
                retryMs !== undefined
                  ? '. Retry after ' + Math.ceil(retryMs / 1000) + 's'
                  : retryAfter
                    ? '. Retry after ' + retryAfter + ' seconds'
                    : ''
              throw toolError('RATE_LIMITED', 'Slack API rate limited (429)' + hint + ' [' + label + ']')
            }
            if (!response.ok) {
              var errorText = ''
              try {
                errorText = await response.text()
              } catch (e) {}
              var httpMessage = label + ': Slack API HTTP ' + response.status + ': ' + errorText
              if (response.status === 401 || response.status === 403) throw toolError('AUTH', httpMessage)
              if (response.status === 404) throw toolError('NOT_FOUND', httpMessage)
              if (response.status === 400 && validationOn400) throw toolError('VALIDATION', httpMessage)
              throw toolError('HTTP', httpMessage)
            }
            var data
            try {
              data = await response.json()
            } catch (e) {
              throw toolError('HTTP', label + ': failed to parse Slack API response')
            }
            if (typeof data !== 'object' || data === null) throw toolError('HTTP', label + ': invalid API response format')
            if (data.ok !== true) {
              var slackError = typeof data.error === 'string' ? data.error : 'unknown_error'
              throw toolError(classifySlackError(slackError), label + ': Slack API error: ' + slackError)
            }
            return data
          }
          // One absolute in-page deadline so a stalled request is aborted before the 25s
          // browser-eval timeout orphans it. The timer is cleared only after the body is
          // consumed (upstream relies on AbortSignal.timeout(30000), longer than the
          // adapter allows).
          async function slackRequest(url, init, label, validationOn400) {
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {}
            }
            var timer =
              controller !== null
                ? setTimeout(function () {
                    try {
                      controller.abort()
                    } catch (e) {}
                  }, API_DEADLINE_MS)
                : null
            var response
            try {
              response = await fetch(url, {
                method: init.method || 'GET',
                headers: init.headers,
                body: init.body,
                credentials: 'include',
                signal: controller ? controller.signal : undefined,
              })
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (aborted) throw toolError('TIMEOUT', label + ': request aborted after the 18s in-page deadline')
              throw toolError('NETWORK', label + ': network error: ' + String(e))
            }
            try {
              return await readSlackResponse(response, label, validationOn400)
            } finally {
              if (timer !== null) clearTimeout(timer)
            }
          }
          // Slack Web API call: form-encoded POST to the workspace host, with the
          // client's internal _x_* metadata headers Slack expects from its web client.
          async function slackApi(method, params) {
            var auth = requireAuth()
            var form = new URLSearchParams()
            form.append('token', auth.token)
            var keys = Object.keys(params || {})
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined || value === null) continue
              form.append(keys[i], typeof value === 'object' ? JSON.stringify(value) : String(value))
            }
            form.append('_x_reason', 'api_call')
            form.append('_x_mode', 'online')
            form.append('_x_sonic', 'true')
            form.append('_x_app_name', 'client')
            if (auth.teamId) form.append('_x_team_id', auth.teamId)
            if (String(auth.workspaceUrl).indexOf('https://') !== 0)
              throw toolError('VALIDATION', 'HTTPS required for Slack API calls')
            return await slackRequest(
              auth.workspaceUrl + '/api/' + method,
              { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
              'slackApi:' + method,
              false,
            )
          }
          // --- mappers (OpenTabs tools/channel-schema.ts) ---
          function mapChannel(c) {
            c = c || {}
            var topic = c.topic || {}
            var purpose = c.purpose || {}
            return {
              id: orEmpty(c.id),
              name: orEmpty(c.name),
              is_channel: c.is_channel === undefined || c.is_channel === null ? false : !!c.is_channel,
              is_private: c.is_private === undefined || c.is_private === null ? false : !!c.is_private,
              num_members: typeof c.num_members === 'number' ? c.num_members : 0,
              topic: { value: orEmpty(topic.value) },
              purpose: { value: orEmpty(purpose.value) },
            }
          }
          function mapMessage(m) {
            m = m || {}
            var message = {
              type: m.type === undefined || m.type === null ? 'message' : m.type,
              text: orEmpty(m.text),
              ts: orEmpty(m.ts),
            }
            if (m.user !== undefined && m.user !== null) message.user = m.user
            return message
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

          var slackToolImplementations = {
            async send_message(args) {
              var data = await slackApi('chat.postMessage', {
                channel: args.channel,
                text: args.text,
                thread_ts: args.thread_ts,
              })
              return { channel: orEmpty(data.channel), ts: orEmpty(data.ts) }
            },
          }

          async function stdin_default(args) {
            try {
              if (!isSlackHost())
                return error('UNSUPPORTED_PAGE', 'Not on a *.slack.com page.')
              var data = await slackToolImplementations['send_message'](args)
              return ok(data)
            } catch (e) {
              return error(
                e && e.__toolError ? e.__toolError : 'UNKNOWN',
                e && e.message ? e.message : String(e),
              )
            }
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
            'The slack.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Slack API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The slack.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
