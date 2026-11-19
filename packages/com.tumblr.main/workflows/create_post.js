// Self-contained adapter workflow for `create_post` (group: Posts).
//
// Ported from the OpenTabs tumblr plugin (plugins/tumblr/src, MIT): same
// /api/v2 paths, same bearer + x-csrf transport, same mappers, same error
// classification. The redpop session token is read from the tumblr.com page on
// every call and never returned to the caller.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "blog_name": {
        "type": "string",
        "description": "Blog name to post to"
      },
      "content": {
        "type": "string",
        "description": "Text content for the post"
      },
      "tags": {
        "description": "Comma-separated tags (e.g., \"art, photography, nature\")",
        "type": "string"
      },
      "state": {
        "description": "Post state (default \"published\")",
        "type": "string",
        "enum": [
          "published",
          "draft",
          "queue",
          "private"
        ]
      }
    },
    "required": [
      "blog_name",
      "content"
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
      },
      "retry_after_ms": {
        "type": "number"
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
    description: 'create_post',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Tumblr runtime (translated from the OpenTabs tumblr
          // plugin: tumblr-api.ts + tools/schemas.ts, MIT). Runs INSIDE the
          // tumblr.com tab: the redpop web client's credentials are read from
          // the page's own ___INITIAL_STATE___ blob on every call and never
          // leave page context.
          //
          // Transport: tumblr.com's web client calls its own backend same-origin
          // under /api/v2, authenticating with the page API token as a bearer
          // credential plus the redpop X-Version marker, asking for camelCase
          // JSON, and sending an x-csrf token on every write. Paths, headers and
          // bodies below are upstream's, nothing is invented.
          var API_BASE = '/api/v2'
          var ACCEPT = 'application/json;format=camelcase'
          var X_VERSION = 'redpop/3/0//redpop/'
          var REQUEST_TIMEOUT_MS = 18000

          var authCache = null

          // The web client embeds its session in
          // <script id="___INITIAL_STATE___">{apiFetchStore:{API_TOKEN}, csrfToken}</script>
          function parseInitialState() {
            if (typeof document === 'undefined') return null
            var el = null
            try {
              if (document.getElementById)
                el = document.getElementById('___INITIAL_STATE___')
              if (!el && document.querySelector)
                el = document.querySelector('#___INITIAL_STATE___')
            } catch (e) {
              el = null
            }
            var text = el && el.textContent
            if (!text) return null
            try {
              var state = JSON.parse(text)
              var store = state.apiFetchStore || {}
              var apiToken = store.API_TOKEN
              var csrfToken = state.csrfToken
              if (typeof apiToken === 'string' && apiToken.length > 0)
                return { apiToken: apiToken, csrfToken: csrfToken || '' }
            } catch (e) {
              // Ignore parse errors
            }
            return null
          }

          function getAuth() {
            if (authCache && authCache.apiToken) return authCache
            var parsed = parseInitialState()
            if (!parsed) return null
            authCache = parsed
            return parsed
          }

          function updateCsrf(newCsrf) {
            if (authCache) authCache.csrfToken = newCsrf
          }

          function clearAuth() {
            authCache = null
          }

          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query || {})
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value === undefined) continue
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++)
                  params.append(keys[i], String(value[j]))
              } else {
                params.append(keys[i], String(value))
              }
            }
            return params.toString()
          }

          function parseRetryAfterMs(value) {
            if (value === null || value === undefined) return undefined
            var text = String(value).trim()
            if (!text) return undefined
            var seconds = Number(text)
            if (!isNaN(seconds) && seconds >= 0) return Math.round(seconds * 1000)
            var at = Date.parse(text)
            if (!isNaN(at)) {
              var ms = at - Date.now()
              return ms > 0 ? ms : undefined
            }
            return undefined
          }

          // One same-origin request with the page's cookies, an 18s abort so a
          // hung call cannot outlive the browser command, and upstream's HTTP →
          // error-category mapping (fetchFromPage + httpStatusToToolError).
          async function send(url, init) {
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {
                controller = null
              }
            }
            var timer =
              controller !== null
                ? setTimeout(function () {
                    try {
                      controller.abort()
                    } catch (e) {}
                  }, REQUEST_TIMEOUT_MS)
                : null
            var response
            try {
              response = await fetch(url, {
                method: init.method,
                headers: init.headers,
                body: init.body,
                credentials: 'include',
                signal: controller ? controller.signal : undefined,
              })
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'Tumblr request timed out: ' + url
                  : 'Network error: ' + String(e),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (!response.ok) {
              var detail = ''
              try {
                detail = await response.text()
              } catch (e) {
                detail = ''
              }
              if (detail && detail.length > 512) detail = detail.slice(0, 512) + '…'
              var status = response.status
              var message =
                'Tumblr API error (' + status + '): ' + url + (detail ? ' — ' + detail : '')
              if (status === 401 || status === 403) {
                clearAuth()
                return { ok: false, error_code: 'AUTH', status: status, message: message }
              }
              if (status === 404)
                return { ok: false, error_code: 'NOT_FOUND', status: status, message: message }
              if (status === 429) {
                var retryAfter =
                  response.headers && response.headers.get
                    ? response.headers.get('Retry-After')
                    : null
                return {
                  ok: false,
                  error_code: 'RATE_LIMITED',
                  status: status,
                  retry_after_ms: parseRetryAfterMs(retryAfter),
                  message: message,
                }
              }
              if (status === 400 || status === 422)
                return { ok: false, error_code: 'VALIDATION', status: status, message: message }
              if (status === 408)
                return { ok: false, error_code: 'TIMEOUT', status: status, message: message }
              return { ok: false, error_code: 'HTTP', status: status, message: message }
            }
            return { ok: true, response: response }
          }

          // Every Tumblr v2 answer is { meta, response }; the tools work on the
          // `response` member. 204 (delete/unlike/block) carries no body.
          async function readEnvelope(response) {
            if (response.status === 204) return { ok: true, data: {} }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {
              return {
                ok: false,
                error_code: 'NETWORK',
                message: 'Network error reading the Tumblr response: ' + String(e),
              }
            }
            if (!text) return { ok: true, data: {} }
            var envelope
            try {
              envelope = JSON.parse(text)
            } catch (e) {
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Tumblr returned invalid JSON',
              }
            }
            var payload =
              envelope && typeof envelope === 'object' && 'response' in envelope
                ? envelope.response
                : envelope
            return { ok: true, data: payload === undefined || payload === null ? {} : payload }
          }

          // Tumblr's CSRF token expires after the initial page load: writes fetch
          // a fresh one from the x-csrf response header of a lightweight call.
          async function refreshCsrf(apiToken) {
            var res = await send(API_BASE + '/user/info', {
              method: 'GET',
              headers: {
                Accept: ACCEPT,
                Authorization: 'Bearer ' + apiToken,
                'X-Version': X_VERSION,
              },
            })
            if (!res.ok) return { ok: false, error: res }
            var csrf =
              res.response.headers && res.response.headers.get
                ? res.response.headers.get('x-csrf')
                : null
            if (csrf) updateCsrf(csrf)
            return { ok: true, csrf: csrf || '' }
          }

          async function api(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'Not authenticated — please log in to Tumblr.',
              }
            var qs = options.query ? buildQueryString(options.query) : ''
            var url = qs ? API_BASE + endpoint + '?' + qs : API_BASE + endpoint
            var method = options.method || 'GET'
            var headers = {
              Accept: ACCEPT,
              Authorization: 'Bearer ' + auth.apiToken,
              'X-Version': X_VERSION,
            }
            if (method !== 'GET') {
              var csrf = auth.csrfToken
              if (!csrf) {
                var refreshed = await refreshCsrf(auth.apiToken)
                if (!refreshed.ok) return refreshed.error
                csrf = refreshed.csrf
              }
              headers['X-Csrf'] = csrf
            }
            var init = { method: method, headers: headers }
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              init.body = JSON.stringify(options.body)
            }
            var res = await send(url, init)
            if (!res.ok) return res
            var responseCsrf =
              res.response.headers && res.response.headers.get
                ? res.response.headers.get('x-csrf')
                : null
            if (responseCsrf) updateCsrf(responseCsrf)
            return readEnvelope(res.response)
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapBlog(b) {
            b = b || {}
            var avatar = (b.avatar && b.avatar[0]) || {}
            return {
              name: b.name || '',
              title: b.title || '',
              description: b.description || '',
              url: b.url || b.blogViewUrl || '',
              posts: b.posts === undefined ? 0 : b.posts,
              followers: b.followers === undefined ? 0 : b.followers,
              is_adult: b.isAdult === undefined ? false : b.isAdult,
              ask: b.ask === undefined ? false : b.ask,
              followed: b.followed === undefined ? false : b.followed,
              avatar_url: avatar.url || '',
            }
          }

          function extractContentText(content) {
            if (!content || !content.length) return ''
            var out = []
            for (var i = 0; i < content.length; i++) {
              var block = content[i]
              if (block && block.type === 'text' && block.text) out.push(block.text)
            }
            return out.join('\n')
          }

          function mapPost(p) {
            p = p || {}
            return {
              id: p.idString !== undefined ? p.idString : String(p.id === undefined ? '' : p.id),
              type: p.type || p.originalType || '',
              blog_name: p.blogName || '',
              post_url: p.postUrl || '',
              short_url: p.shortUrl || '',
              timestamp: p.timestamp === undefined ? 0 : p.timestamp,
              date: p.date || '',
              state: p.state || 'published',
              tags: p.tags || [],
              summary: p.summary || '',
              note_count: p.noteCount === undefined ? 0 : p.noteCount,
              reblog_key: p.reblogKey || '',
              liked: p.liked === undefined ? false : p.liked,
              followed: p.followed === undefined ? false : p.followed,
              can_like: p.canLike === undefined ? false : p.canLike,
              can_reblog: p.canReblog === undefined ? false : p.canReblog,
              can_reply: p.canReply === undefined ? false : p.canReply,
              content_text: extractContentText(p.content),
            }
          }

          function mapNote(n) {
            n = n || {}
            var avatar = (n.avatar && n.avatar[0]) || {}
            return {
              type: n.type || '',
              blog_name: n.blogName || '',
              blog_url: n.blogUrl || '',
              avatar_url: avatar.url || '',
              timestamp: n.timestamp === undefined ? 0 : n.timestamp,
              reply_text: n.replyText || '',
              reblog_parent_blog_name: n.reblogParentBlogName || '',
              added_text: n.addedText || '',
            }
          }

          function mapNotification(n) {
            n = n || {}
            return {
              type: n.type || '',
              timestamp: n.timestamp === undefined ? 0 : n.timestamp,
              from_blog_name: n.fromTumblelogName || '',
              target_post_id:
                n.targetPostIdString !== undefined
                  ? n.targetPostIdString
                  : String(n.targetPostId === undefined ? '' : n.targetPostId),
              summary: n.targetPostSummary || n.addedText || '',
            }
          }

          function mapLimit(l) {
            l = l || {}
            return {
              description: l.description || '',
              limit: l.limit === undefined ? 0 : l.limit,
              remaining: l.remaining === undefined ? 0 : l.remaining,
              reset_at: l.resetAt === undefined ? 0 : l.resetAt,
            }
          }

          function mapFollower(f) {
            f = f || {}
            return {
              name: f.name || '',
              url: f.url || '',
              following: f.following === undefined ? false : f.following,
              updated: f.updated === undefined ? 0 : f.updated,
            }
          }

          function mapUser(u) {
            u = u || {}
            var blogs = []
            var raw = u.blogs || []
            for (var i = 0; i < raw.length; i++) blogs.push(mapBlog(raw[i]))
            return {
              name: u.name || '',
              following: u.following === undefined ? 0 : u.following,
              likes: u.likes === undefined ? 0 : u.likes,
              default_post_format: u.defaultPostFormat || 'html',
              blogs: blogs,
            }
          }

          function mapPosts(list) {
            var out = []
            var raw = list || []
            for (var i = 0; i < raw.length; i++) out.push(mapPost(raw[i]))
            return out
          }

          function mapBlogs(list) {
            var out = []
            var raw = list || []
            for (var i = 0; i < raw.length; i++) out.push(mapBlog(raw[i]))
            return out
          }

          // --- envelope helpers ---
          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }
          function failure(res) {
            var out = {
              status: 'error',
              data: null,
              error_code: res.error_code || 'UNKNOWN',
              message: res.message || 'Tumblr request failed',
            }
            if (res.retry_after_ms !== undefined) out.retry_after_ms = res.retry_after_ms
            return out
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message }
          }
          // Every tool is bound to a tumblr.com tab; refuse anything else before
          // touching the page session or the network.
          function assertPage() {
            var host = (typeof location !== 'undefined' && location.hostname) || ''
            if (host !== 'tumblr.com' && !/\.tumblr\.com$/.test(host))
              return error('UNSUPPORTED_PAGE', 'Not on a tumblr.com page.')
            return null
          }

          var tumblrToolImplementations = {
            async create_post(args) {
              const pageError = assertPage()
              if (pageError) return pageError
              const state = args.state === undefined ? 'published' : args.state
              const res = await api('/blog/' + args.blog_name + '/posts', {
                method: 'POST',
                body: {
                  content: [{ type: 'text', text: args.content }],
                  tags: args.tags,
                  state: state,
                },
              })
              if (!res.ok) return failure(res)
              const data = res.data || {}
              return ok({ id: String(data.id), state: state })
            },
          }

          async function stdin_default(args) {
            return tumblrToolImplementations['create_post'](args)
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
            'The tumblr.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Tumblr request failed',
          error_code: result.error_code || 'UNKNOWN',
          ...(result.retry_after_ms === undefined
            ? {}
            : { retry_after_ms: result.retry_after_ms }),
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The tumblr.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
