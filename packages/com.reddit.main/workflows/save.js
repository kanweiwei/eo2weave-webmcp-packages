// Self-contained adapter workflow. The Reddit session (modhash, bearer token)
// and every reddit.com fetch stay inside the reddit.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1,
        "description": "Fullname of the thing to save (e.g., \"t3_abc123\" for post, \"t1_xyz\" for comment)"
      },
      "unsave": {
        "description": "Set to true to unsave instead of save (default: false)",
        "type": "boolean"
      }
    },
    "required": [
      "id"
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
    description: "save",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Reddit runtime (translated from OpenTabs reddit-api.ts and
          // tools/*.ts, MIT). Runs INSIDE the reddit.com tab: the modhash and the
          // bearer token never leave page context, and every request is a
          // same-site fetch with the session cookies.
          var REDDIT_ORIGIN = 'https://www.reddit.com'
          var OAUTH_ORIGIN = 'https://oauth.reddit.com'
          var IN_PAGE_DEADLINE_MS = 18000
          var modhashCache = null
          var bearerCache = null
          var bearerExpiry = 0
          function clearSessionCache() {
            modhashCache = null
            bearerCache = null
            bearerExpiry = 0
          }
          function getCookie(name) {
            var parts = String(document.cookie || '').split(';')
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i].trim()
              if (part.indexOf(name + '=') === 0)
                return decodeURIComponent(part.slice(name.length + 1))
            }
            return ''
          }
          function buildQuery(params) {
            var query = new URLSearchParams()
            var keys = Object.keys(params || {})
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value !== undefined && value !== null && value !== '')
                query.append(keys[i], String(value))
            }
            var text = query.toString()
            return text ? '?' + text : ''
          }
          function buildForm(body) {
            var form = new URLSearchParams()
            var keys = Object.keys(body || {})
            for (var i = 0; i < keys.length; i++) {
              var value = body[keys[i]]
              if (value !== undefined && value !== null && value !== '')
                form.append(keys[i], String(value))
            }
            return form
          }
          // Abort the in-page request before the 25s browser command deadline can
          // orphan it, so a timed-out call does not leave the request running.
          async function requestJson(url, init) {
            var controller = null
            var timer = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
                timer = setTimeout(function () {
                  try { controller.abort() } catch (e) {}
                }, IN_PAGE_DEADLINE_MS)
              } catch (e) { controller = null }
            }
            var response
            try {
              var options = {}
              var keys = Object.keys(init || {})
              for (var i = 0; i < keys.length; i++) options[keys[i]] = init[keys[i]]
              if (controller) options.signal = controller.signal
              response = await fetch(url, options)
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'Reddit API request aborted after the 18s in-page deadline.'
                  : 'Reddit API network error: ' + String(e),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (response.status === 429) {
              var reset = response.headers ? response.headers.get('x-ratelimit-reset') : null
              var retry = reset ? parseInt(reset, 10) * 1000 : NaN
              return {
                ok: false,
                error_code: 'RATE_LIMITED',
                message:
                  'Reddit API rate limited (429)' +
                  (isNaN(retry) ? '' : ' — retry after ' + retry + 'ms'),
              }
            }
            if (!response.ok) {
              var text = ''
              try { text = await response.text() } catch (e) {}
              var errorCode = 'HTTP'
              if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
              else if (response.status === 404) errorCode = 'NOT_FOUND'
              return {
                ok: false,
                error_code: errorCode,
                status: response.status,
                message:
                  'Reddit API HTTP ' + response.status + ': ' + String(text || '').slice(0, 512),
              }
            }
            try {
              return { ok: true, data: await response.json() }
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'Failed to parse Reddit API response' }
            }
          }
          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message }
          }
          function assertPage() {
            var host = location.hostname
            if (host !== 'www.reddit.com' && host !== 'old.reddit.com' && host !== 'new.reddit.com')
              return error('UNSUPPORTED_PAGE', 'Not on a reddit.com page.')
            return null
          }
          /**
           * Modhash token required for write operations (vote, comment, submit,
           * etc.). Fetched once from /api/me.json and cached for this call.
           */
          async function getModhash() {
            if (modhashCache) return { ok: true, data: modhashCache }
            var result = await requestJson(REDDIT_ORIGIN + '/api/me.json', {
              credentials: 'include',
            })
            if (!result.ok) {
              if (result.error_code === 'AUTH')
                return {
                  ok: false,
                  error_code: 'AUTH',
                  message: 'Failed to fetch modhash — user may not be logged in (' + result.message + ')',
                }
              return result
            }
            var token = result.data && result.data.data && result.data.data.modhash
            if (!token)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'No modhash found — user may not be logged in',
              }
            modhashCache = token
            return { ok: true, data: token }
          }
          /**
           * OAuth bearer token for endpoints that reject cookie auth on
           * www.reddit.com (e.g. /api/compose) and require oauth.reddit.com.
           * The shreddit token endpoint exchanges the CSRF cookie for it.
           */
          async function getBearerToken() {
            if (bearerCache && Date.now() < bearerExpiry) return { ok: true, data: bearerCache }
            var csrfToken = getCookie('csrf_token')
            var result = await requestJson(REDDIT_ORIGIN + '/svc/shreddit/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ csrf_token: csrfToken }),
              credentials: 'include',
            })
            if (!result.ok) {
              if (result.error_code === 'AUTH')
                return {
                  ok: false,
                  error_code: 'AUTH',
                  message: 'Failed to fetch bearer token — user may not be logged in (' + result.message + ')',
                }
              return result
            }
            var token = result.data && result.data.token
            if (!token)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'No bearer token returned — user may not be logged in',
              }
            bearerCache = token
            var expires = result.data.expires
            bearerExpiry = expires ? new Date(expires).getTime() - 30000 : Date.now() + 600000
            return { ok: true, data: token }
          }
          async function redditGet(path, params) {
            return requestJson(REDDIT_ORIGIN + path + buildQuery(params), {
              credentials: 'include',
            })
          }
          async function redditPost(path, body) {
            var modhash = await getModhash()
            if (!modhash.ok) return modhash
            var form = buildForm(body)
            form.append('uh', modhash.data)
            form.append('api_type', 'json')
            var result = await requestJson(REDDIT_ORIGIN + path, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Modhash': modhash.data,
              },
              body: form.toString(),
              credentials: 'include',
            })
            // A 401/403 means the cached modhash is stale; drop it so the next
            // call re-reads the session instead of replaying a dead token.
            if (!result.ok && result.error_code === 'AUTH') clearSessionCache()
            return result
          }
          async function redditOAuthPost(path, body) {
            var bearer = await getBearerToken()
            if (!bearer.ok) return bearer
            var form = buildForm(body)
            form.append('api_type', 'json')
            var result = await requestJson(OAUTH_ORIGIN + path, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Bearer ' + bearer.data,
              },
              body: form.toString(),
            })
            if (!result.ok && result.error_code === 'AUTH') clearSessionCache()
            return result
          }
          /** Collect the human-readable half of Reddit's [[kind, message, field]] errors. */
          function apiErrors(json) {
            var errors = (json && json.json && json.json.errors) || []
            var messages = []
            for (var i = 0; i < errors.length; i++) messages.push(errors[i] && errors[i][1])
            return messages.join('; ')
          }
          /** Flatten a nested comment tree, preserving each comment's depth. */
          function flattenComments(children, maxDepth) {
            var result = []
            children = children || []
            for (var i = 0; i < children.length; i++) {
              var child = children[i]
              if (!child || child.kind !== 't1' || !child.data) continue
              result.push(child.data)
              var replies = child.data.replies
              if (replies && typeof replies === 'object' && child.data.depth < maxDepth)
                result = result.concat(flattenComments(replies.data && replies.data.children, maxDepth))
            }
            return result
          }
          function mapComment(c) {
            return {
              id: c.id,
              name: c.name,
              author: c.author,
              body: c.body,
              score: c.score,
              created_utc: c.created_utc,
              parent_id: c.parent_id,
              depth: c.depth,
              is_submitter: c.is_submitter,
            }
          }

          var redditToolImplementations = {
      async save(args) {
        var data = await redditPost(args.unsave ? '/api/unsave' : '/api/save', { id: args.id })
        if (!data.ok) return data
        return ok({ success: true })
      },
          }
          async function stdin_default(args) {
            return redditToolImplementations["save"](args)
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
            'The reddit.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Reddit API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The reddit.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
