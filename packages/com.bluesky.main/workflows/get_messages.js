// Self-contained adapter workflow for `get_messages` (group: Chat).
//
// Ported from the OpenTabs bluesky plugin (plugins/bluesky/src, MIT): same
// XRPC names, same query/body, same mappers, same error classification. The
// AT Protocol session is read from the bsky.app page on every call; nothing
// is cached between calls and no token is ever returned to the caller.

export default {
  inputSchema: {
      "type": "object",
      "properties": {
        "convo_id": {
          "type": "string",
          "description": "Conversation ID"
        },
        "cursor": {
          "description": "Pagination cursor from a previous response",
          "type": "string"
        },
        "limit": {
          "description": "Maximum number of messages to return (default 25, max 100)",
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        }
      },
      "required": [
        "convo_id"
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
    description: 'get_messages',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Bluesky runtime (translated from the OpenTabs bluesky
          // plugin: bluesky-api.ts + tools/schemas.ts, MIT). Runs INSIDE the
          // bsky.app tab: the AT Protocol session (accessJwt, pdsUrl, did) is
          // read from the page's own localStorage on every call and never
          // leaves page context.
          //
          // Transport: bsky.app talks to two origins. AppView queries
          // (`app.bsky.*`) go to the public AppView the web client uses,
          // https://public.api.bsky.app; repository writes
          // (`com.atproto.repo.*`) and chat (`chat.bsky.convo.*`, proxied with
          // the `atproto-proxy` header) go to the session's PDS. Both answer
          // `access-control-allow-origin: *`, so the browser rejects
          // `credentials: 'include'` on these cross-origin requests; the
          // session travels as the page's Bearer access token instead, which
          // is exactly what upstream does.
          var APPVIEW_ORIGIN = 'https://public.api.bsky.app'
          var CHAT_PROXY = 'did:web:api.bsky.chat#bsky_chat'
          var AUTH_ERRORS = ['ExpiredToken', 'InvalidToken', 'AuthMissing']

          function getSession() {
            var raw = null
            try {
              raw = localStorage.getItem('BSKY_STORAGE')
            } catch (e) {
              raw = null
            }
            if (!raw) return null
            var data
            try {
              data = JSON.parse(raw)
            } catch (e) {
              return null
            }
            var account = data && data.session && data.session.currentAccount
            if (!account) return null
            if (!account.accessJwt || !account.pdsUrl || !account.did) return null
            if (!account.active) return null
            return account
          }

          function did() {
            var session = getSession()
            return session ? session.did : ''
          }

          function parseRetryAfterMs(value) {
            if (value === null || value === undefined) return undefined
            var text = String(value).trim()
            if (!text) return undefined
            var seconds = Number(text)
            if (!isNaN(seconds)) return Math.max(0, Math.round(seconds * 1000))
            var at = Date.parse(text)
            if (!isNaN(at)) return Math.max(0, at - Date.now())
            return undefined
          }

          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query || {})
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value === undefined) continue
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++) params.append(keys[i], value[j])
              } else {
                params.append(keys[i], String(value))
              }
            }
            return params.toString()
          }

          // Reads (`app.bsky.*` GETs) belong to the AppView; writes and chat
          // belong to the account's PDS, even when the nsid is `app.bsky.*`
          // (muteActor, updateSeen) because those records live in the repo.
          function xrpcUrl(session, nsid, query, method) {
            var base
            if (nsid.indexOf('app.bsky.') === 0 && method === 'GET') {
              base = APPVIEW_ORIGIN + '/'
            } else {
              var pds = session.pdsUrl
              base = pds.charAt(pds.length - 1) === '/' ? pds : pds + '/'
            }
            var qs = buildQueryString(query)
            return base + 'xrpc/' + nsid + (qs ? '?' + qs : '')
          }

          function handleResponseError(response, body, nsid) {
            var detail = body ? body.substring(0, 512) : ''
            var parsed = null
            try {
              parsed = body ? JSON.parse(body) : null
            } catch (e) {
              parsed = null
            }
            var atError = parsed && parsed.error ? String(parsed.error) : ''
            // AT Protocol reports expired/invalid tokens as 400 {error:...},
            // which a generic status mapping would call a validation error.
            if (response.status === 400 && AUTH_ERRORS.indexOf(atError) !== -1) {
              return {
                ok: false,
                error_code: 'AUTH',
                status: 400,
                message:
                  'Token expired — please refresh the Bluesky page: ' + detail,
              }
            }
            if (response.status === 429) {
              var retryAfter =
                response.headers && response.headers.get
                  ? response.headers.get('Retry-After')
                  : null
              var retryMs = parseRetryAfterMs(retryAfter)
              return {
                ok: false,
                error_code: 'RATE_LIMITED',
                status: 429,
                retry_after_ms: retryMs,
                message: 'Rate limited: ' + nsid + ' — ' + detail,
              }
            }
            if (response.status === 401 || response.status === 403)
              return {
                ok: false,
                error_code: 'AUTH',
                status: response.status,
                message: 'Auth error (' + response.status + '): ' + detail,
              }
            if (response.status === 404)
              return {
                ok: false,
                error_code: 'NOT_FOUND',
                status: 404,
                message: 'Not found: ' + nsid + ' — ' + detail,
              }
            if (response.status === 400 || response.status === 422)
              return {
                ok: false,
                error_code: 'VALIDATION',
                status: response.status,
                message: 'Validation error: ' + nsid + ' — ' + detail,
              }
            return {
              ok: false,
              error_code: 'HTTP',
              status: response.status,
              message:
                'API error (' + response.status + '): ' + nsid + ' — ' + detail,
            }
          }

          async function xrpc(nsid, options) {
            options = options || {}
            // Every tool is bound to a bsky.app tab; refuse anything else
            // before touching the session or the network.
            var host = location.hostname
            if (host !== 'bsky.app' && host !== 'www.bsky.app')
              return {
                ok: false,
                error_code: 'UNSUPPORTED_PAGE',
                message: 'Not on a bsky.app page.',
              }
            var session = getSession()
            if (!session)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'Not authenticated — please log in to Bluesky.',
              }
            var method = options.method || 'GET'
            var url = xrpcUrl(session, nsid, options.query, method)
            var headers = {
              Authorization: 'Bearer ' + session.accessJwt,
              Accept: 'application/json',
            }
            var extra = options.extraHeaders || {}
            var extraKeys = Object.keys(extra)
            for (var i = 0; i < extraKeys.length; i++)
              headers[extraKeys[i]] = extra[extraKeys[i]]
            var fetchBody
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              fetchBody = JSON.stringify(options.body)
            }
            // Abort the in-page fetch before the 25s browser command deadline
            // can orphan it, so a timed-out call does not leave the request
            // running against the account.
            var controller = null
            if (typeof AbortController === 'function')
              try {
                controller = new AbortController()
              } catch (e) {
                controller = null
              }
            var timer =
              controller !== null
                ? setTimeout(function () {
                    try {
                      controller.abort()
                    } catch (e) {}
                  }, 18000)
                : null
            var response
            try {
              response = await fetch(url, {
                method: method,
                headers: headers,
                body: fetchBody,
                credentials: 'omit',
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
                  ? 'API request timed out: ' + nsid
                  : 'Network error: ' + String(e),
              }
            }
            if (!response.ok) {
              var errText = ''
              try {
                errText = await response.text()
              } catch (e) {
                errText = ''
              }
              if (timer !== null) clearTimeout(timer)
              return handleResponseError(response, errText, nsid)
            }
            if (response.status === 204) {
              if (timer !== null) clearTimeout(timer)
              return { ok: true, data: {} }
            }
            var text
            try {
              text = await response.text()
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: 'Network error reading ' + nsid + ': ' + String(e),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (!text) return { ok: true, data: {} }
            try {
              return { ok: true, data: JSON.parse(text) }
            } catch (e) {
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Bluesky returned invalid JSON for ' + nsid,
              }
            }
          }

          function api(nsid, options) {
            return xrpc(nsid, options)
          }

          function chatApi(nsid, options) {
            var merged = {}
            var keys = Object.keys(options || {})
            for (var i = 0; i < keys.length; i++) merged[keys[i]] = options[keys[i]]
            merged.extraHeaders = { 'atproto-proxy': CHAT_PROXY }
            return xrpc(nsid, merged)
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function hasMedia(embed) {
            if (!embed) return false
            var type = embed.$type || ''
            if (type.indexOf('images') !== -1 || type.indexOf('video') !== -1)
              return true
            if (type.indexOf('recordWithMedia') !== -1) return true
            if (embed.images && Array.isArray(embed.images) && embed.images.length > 0)
              return true
            if (embed.media) return true
            return false
          }
          function mapPost(p) {
            p = p || {}
            var author = p.author || {}
            var record = p.record || {}
            return {
              uri: p.uri || '',
              cid: p.cid || '',
              author_did: author.did || '',
              author_handle: author.handle || '',
              author_display_name: author.displayName || '',
              text: record.text || '',
              created_at: record.createdAt || '',
              reply_count: p.replyCount === undefined ? 0 : p.replyCount,
              repost_count: p.repostCount === undefined ? 0 : p.repostCount,
              like_count: p.likeCount === undefined ? 0 : p.likeCount,
              quote_count: p.quoteCount === undefined ? 0 : p.quoteCount,
              indexed_at: p.indexedAt || '',
              has_media: hasMedia(p.embed),
              is_reply: record.reply !== undefined && record.reply !== null,
            }
          }
          function mapThreadPost(p) {
            p = p || {}
            var base = mapPost(p)
            var record = p.record || {}
            var reply = record.reply || {}
            var parent = reply.parent || {}
            var root = reply.root || {}
            base.reply_parent_uri = parent.uri || ''
            base.reply_root_uri = root.uri || ''
            return base
          }
          function mapProfile(p) {
            p = p || {}
            var viewer = p.viewer || {}
            return {
              did: p.did || '',
              handle: p.handle || '',
              display_name: p.displayName || '',
              description: p.description || '',
              avatar: p.avatar || '',
              banner: p.banner || '',
              followers_count: p.followersCount === undefined ? 0 : p.followersCount,
              follows_count: p.followsCount === undefined ? 0 : p.followsCount,
              posts_count: p.postsCount === undefined ? 0 : p.postsCount,
              indexed_at: p.indexedAt || '',
              is_following: (viewer.following || '') !== '',
              is_followed_by: (viewer.followedBy || '') !== '',
              is_muted: viewer.muted === undefined ? false : !!viewer.muted,
              is_blocked:
                (viewer.blocking || '') !== '' ||
                (viewer.blockedBy === undefined ? false : !!viewer.blockedBy),
            }
          }
          function mapProfileBasic(p) {
            p = p || {}
            return {
              did: p.did || '',
              handle: p.handle || '',
              display_name: p.displayName || '',
              avatar: p.avatar || '',
            }
          }
          function mapNotification(n) {
            n = n || {}
            var author = n.author || {}
            return {
              uri: n.uri || '',
              cid: n.cid || '',
              author_did: author.did || '',
              author_handle: author.handle || '',
              author_display_name: author.displayName || '',
              reason: n.reason || '',
              is_read: n.isRead === undefined ? false : !!n.isRead,
              indexed_at: n.indexedAt || '',
            }
          }
          function mapConversation(c) {
            c = c || {}
            var last = c.lastMessage || {}
            return {
              id: c.id || '',
              unread_count: c.unreadCount === undefined ? 0 : c.unreadCount,
              last_message_text: last.text || '',
              last_message_sent_at: last.sentAt || '',
              members: (c.members || []).map(mapProfileBasic),
              muted: c.muted === undefined ? false : !!c.muted,
            }
          }
          function mapMessage(m) {
            m = m || {}
            var sender = m.sender || {}
            return {
              id: m.id || '',
              text: m.text || '',
              sender_did: sender.did || '',
              sent_at: m.sentAt || '',
              revision: m.rev || '',
            }
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }
          function failure(res) {
            var out = {
              status: 'error',
              data: null,
              error_code: res.error_code || 'UNKNOWN',
              message: res.message || 'Bluesky request failed',
            }
            if (res.retry_after_ms !== undefined) out.retry_after_ms = res.retry_after_ms
            return out
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message }
          }
          function requireDid() {
            var session = getSession()
            if (!session)
              return error(
                'AUTH',
                'Not authenticated — please log in to Bluesky.',
              )
            return null
          }
          function limitOr(value, fallback) {
            return value === undefined ? fallback : value
          }
          function rkeyOf(uri) {
            var parts = String(uri || '').split('/')
            return parts.pop() || ''
          }
          function flattenThread(node) {
            var out = []
            if (!node) return out
            if (node.post) out.push(node.post)
            if (node.replies) {
              for (var i = 0; i < node.replies.length; i++) {
                var nested = flattenThread(node.replies[i])
                for (var j = 0; j < nested.length; j++) out.push(nested[j])
              }
            }
            return out
          }
          // Note on the credential mode: bsky.app's XRPC calls are cross-origin
          // (public.api.bsky.app, the user's PDS, api.bsky.chat via the PDS
          // proxy) and those hosts answer `access-control-allow-origin: *`.
          // A credentialed (`credentials: 'include'`) fetch is therefore
          // rejected by the browser on this origin; the session is carried by
          // the page's Bearer access token in the Authorization header, which
          // is what upstream does.

          var blueskyToolImplementations = {

          async get_messages(args) {
            var res = await chatApi('chat.bsky.convo.getMessages', {
              query: {
                convoId: args.convo_id,
                cursor: args.cursor,
                limit: limitOr(args.limit, 25),
              },
            })
            if (!res.ok) return failure(res)
            var messages = res.data.messages || []
            return ok({
              messages: messages.map(mapMessage),
              cursor: res.data.cursor || '',
            })
          },
          }

          async function stdin_default(args) {
            return blueskyToolImplementations['get_messages'](args)
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
            'The bsky.app tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Bluesky request failed',
          error_code: result.error_code || 'UNKNOWN',
          ...(result.retry_after_ms === undefined
            ? {}
            : { retry_after_ms: result.retry_after_ms }),
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The bsky.app tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
