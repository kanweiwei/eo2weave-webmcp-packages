// Self-contained adapter workflow for `update_list` (group: Lists).
//
// Ported from the OpenTabs x plugin (plugins/x, MIT): same GraphQL
// operations, same variables, same mappers, same error classification. The
// X session is the tab's own (ct0 cookie + static web client bearer) and is
// re-read on every call; nothing is cached between calls.
//
// Update a list's name, description, or privacy setting.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "list_id": {
        "type": "string",
        "minLength": 1,
        "description": "List ID"
      },
      "name": {
        "description": "New name",
        "type": "string",
        "minLength": 1,
        "maxLength": 25
      },
      "description": {
        "description": "New description",
        "type": "string",
        "maxLength": 100
      },
      "is_private": {
        "description": "New privacy setting",
        "type": "boolean"
      }
    },
    "required": [
      "list_id"
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
    description: 'update_list',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side X runtime, translated from the OpenTabs x plugin (x-api.ts +
          // tools/schemas.ts, MIT). Runs INSIDE the x.com tab: the session csrf token
          // (ct0 cookie) and the web client's GraphQL operation hashes are read from the
          // page on every call and never leave page context.
          //
          // Transport: GraphQL only, exactly as the X web client speaks it —
          // https://x.com/i/api/graphql/<queryId>/<operationName>, GET for queries and
          // POST for mutations, credentials included (same-origin x.com). The request is
          // authorised by the page's own ct0 cookie (x-csrf-token) plus the static web
          // client bearer token, and query hashes are discovered at runtime from the
          // page's webpack chunk registry because X rotates them with every bundle.
          var BEARER_TOKEN =
            'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
          var GRAPHQL_BASE = 'https://x.com/i/api/graphql'
          var REQUEST_TIMEOUT_MS = 18000
          // Feature flags required by most GraphQL operations (upstream DEFAULT_FEATURES).
          var DEFAULT_FEATURES = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: true,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: true,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false,
          }
          // Feature flags for user profile queries (upstream USER_FEATURES).
          var USER_FEATURES = {
            hidden_profile_subscriptions_enabled: true,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            subscriptions_verification_info_is_identity_verified_enabled: true,
            subscriptions_verification_info_verified_since_enabled: true,
            highlights_tweets_tab_ui_enabled: true,
            responsive_web_twitter_article_notes_tab_enabled: true,
            subscriptions_feature_can_gift_premium: true,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
          }

          // --- page session ---------------------------------------------------------
          // The X session is the tab's own cookies: auth_token (the login) and ct0 (the
          // CSRF token every GraphQL call must repeat in x-csrf-token). cm9sdc is only
          // read by the SDK's authentication probe; the tools need ct0.
          function readCookie(name) {
            var raw = ''
            try {
              raw = document && document.cookie ? String(document.cookie) : ''
            } catch (e) {
              raw = ''
            }
            if (!raw) return null
            var parts = raw.split(';')
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i].replace(/^\s+/, '')
              var eq = part.indexOf('=')
              if (eq === -1) continue
              if (part.slice(0, eq) === name) return part.slice(eq + 1)
            }
            return null
          }

          function metaDataLoggedIn() {
            try {
              if (typeof __META_DATA__ === 'undefined' || !__META_DATA__) return false
              return Boolean(__META_DATA__.isLoggedIn)
            } catch (e) {
              return false
            }
          }

          // Upstream isAuthenticated(): __META_DATA__.isLoggedIn OR a ct0 cookie.
          function isLoggedIn() {
            if (metaDataLoggedIn()) return true
            return readCookie('ct0') !== null
          }

          function getCsrfToken() {
            return readCookie('ct0')
          }

          // --- GraphQL operation discovery -----------------------------------------
          // X rotates query hashes with every web bundle, so they are extracted from the
          // page's webpack chunk registry instead of being pinned here.
          var OPS = {}

          function chunkRegistry() {
            try {
              var chunks = globalThis.webpackChunk_twitter_responsive_web
              if (!chunks || !Array.isArray(chunks)) return null
              return chunks
            } catch (e) {
              return null
            }
          }

          function extractOps() {
            var chunks = chunkRegistry()
            if (!chunks) return
            for (var c = 0; c < chunks.length; c++) {
              var modules = chunks[c] ? chunks[c][1] : null
              if (!modules || typeof modules !== 'object') continue
              var ids = Object.keys(modules)
              for (var i = 0; i < ids.length; i++) {
                var src
                try {
                  src = modules[ids[i]].toString()
                } catch (e) {
                  continue
                }
                var regex = /queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/g
                var match = regex.exec(src)
                while (match) {
                  if (match[2] && match[1]) OPS[match[2]] = match[1]
                  match = regex.exec(src)
                }
              }
            }
          }

          function getOpHash(name) {
            if (!OPS[name]) extractOps()
            var hash = OPS[name]
            if (!hash) throw new Error('GraphQL operation "' + name + '" not found in X client bundle')
            return hash
          }

          // --- transaction-id signing ----------------------------------------------
          // SearchTimeline (and a few other surfaces) additionally require the signed
          // x-client-transaction-id header. X exposes the signer as the `jJ` export of an
          // internal module whose id is not stable, so the module is located by its
          // `jJ:()=>` marker. When the signer cannot be found the header is omitted —
          // exactly what upstream does (the request then fails on X's side, not ours).
          var probeCounter = 0
          var cachedSignFn = null

          function findSigningModuleId(chunks) {
            for (var c = 0; c < chunks.length; c++) {
              var modules = chunks[c] ? chunks[c][1] : null
              if (!modules || typeof modules !== 'object') continue
              var ids = Object.keys(modules)
              for (var i = 0; i < ids.length; i++) {
                var src
                try {
                  src = modules[ids[i]].toString()
                } catch (e) {
                  continue
                }
                if (/jJ:\s*\(\s*\)\s*=>/.test(src)) {
                  var numericId = Number(ids[i])
                  if (isFinite(numericId)) return numericId
                }
              }
            }
            return null
          }

          function getSignFn() {
            if (cachedSignFn) return cachedSignFn
            var chunks = chunkRegistry()
            if (!chunks) return null
            var moduleId = findSigningModuleId(chunks)
            if (moduleId === null) return null
            var requireFn = null
            try {
              chunks.push([
                ['__ot_sign_' + ++probeCounter],
                {},
                function (req) {
                  requireFn = req
                },
              ])
            } catch (e) {
              return null
            }
            if (!requireFn) return null
            var mod
            try {
              mod = requireFn(moduleId)
            } catch (e) {
              return null
            }
            if (mod && typeof mod.jJ === 'function') {
              cachedSignFn = mod.jJ
              return cachedSignFn
            }
            return null
          }

          async function getTransactionId(path, method) {
            var signFn = getSignFn()
            if (!signFn) return null
            try {
              return await signFn('x.com', path, method)
            } catch (e) {
              return null
            }
          }

          // --- request plumbing ----------------------------------------------------
          function getHeaders() {
            var ct0 = getCsrfToken()
            if (!ct0) return null
            return {
              authorization: 'Bearer ' + BEARER_TOKEN,
              'x-csrf-token': ct0,
              'x-twitter-auth-type': 'OAuth2Session',
              'x-twitter-active-user': 'yes',
              'x-twitter-client-language': 'en',
              'content-type': 'application/json',
            }
          }

          function parseRetryAfterMs(value) {
            if (value === null || value === undefined) return undefined
            var text = String(value).replace(/^\s+|\s+$/g, '')
            if (!text) return undefined
            var seconds = Number(text)
            if (!isNaN(seconds)) return Math.max(0, Math.round(seconds * 1000))
            var at = Date.parse(text)
            if (!isNaN(at)) return Math.max(0, at - Date.now())
            return undefined
          }

          // Upstream classifyError: 429 (x-rate-limit-reset → retry_after_ms), 401/403
          // AUTH, 404 NOT_FOUND, everything else INTERNAL.
          function classifyError(response, body, operation) {
            var detail = body ? String(body).substring(0, 512) : ''
            if (response.status === 429) {
              var reset =
                response.headers && response.headers.get
                  ? response.headers.get('x-rate-limit-reset')
                  : null
              var resetMs = reset ? Number(reset) * 1000 - Date.now() : NaN
              var retryMs = isFinite(resetMs) ? Math.max(0, resetMs) : parseRetryAfterMs('60')
              return {
                ok: false,
                error_code: 'RATE_LIMITED',
                status: 429,
                retry_after_ms: retryMs,
                message: 'Rate limited: ' + operation,
              }
            }
            if (response.status === 401 || response.status === 403) {
              return {
                ok: false,
                error_code: 'AUTH',
                status: response.status,
                message: 'Auth error (' + response.status + '): ' + detail,
              }
            }
            if (response.status === 404) {
              return {
                ok: false,
                error_code: 'NOT_FOUND',
                status: 404,
                message: 'Not found: ' + operation,
              }
            }
            return {
              ok: false,
              error_code: 'INTERNAL',
              status: response.status,
              message: 'API error (' + response.status + '): ' + operation + ' — ' + detail,
            }
          }

          // In-page fetch with an abort well before the 25s browser command deadline, so
          // a timed-out call cannot leave the request running against the account.
          async function xFetch(url, init, operation) {
            var controller = null
            try {
              if (typeof AbortController === 'function') controller = new AbortController()
            } catch (e) {
              controller = null
            }
            var timer = null
            if (controller !== null) {
              timer = setTimeout(function () {
                try {
                  controller.abort()
                } catch (e) {}
              }, REQUEST_TIMEOUT_MS)
            }
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
              var name = e && e.name ? String(e.name) : ''
              var aborted =
                name === 'AbortError' ||
                name === 'TimeoutError' ||
                String(e).toLowerCase().indexOf('abort') !== -1
              if (aborted)
                return { ok: false, error_code: 'TIMEOUT', message: 'Timed out: ' + operation }
              return {
                ok: false,
                error_code: 'NETWORK',
                message: 'Network error: ' + (e && e.message ? e.message : String(e)),
              }
            }
            if (timer !== null) clearTimeout(timer)
            return { ok: true, response: response }
          }

          // Upstream graphqlQuery (GET) / graphqlMutation (POST): same URL shape, same
          // query string, same JSON body envelope, same error classification.
          async function graphqlRequest(operation, variables, options) {
            options = options || {}
            var host = ''
            try {
              host = String(location.hostname || '')
            } catch (e) {
              host = ''
            }
            if (host !== 'x.com' && host.substring(host.length - 6) !== '.x.com')
              return {
                ok: false,
                error_code: 'UNSUPPORTED_PAGE',
                message: 'Not on an x.com page.',
              }
            if (!isLoggedIn())
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'Not authenticated — please log in to X.',
              }
            var headers = getHeaders()
            if (!headers)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'Not authenticated — please log in to X.',
              }
            var hash
            try {
              hash = getOpHash(operation)
            } catch (e) {
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: e && e.message ? e.message : String(e),
              }
            }
            var features = options.features || DEFAULT_FEATURES
            var method = options.method || 'GET'
            var path = GRAPHQL_BASE + '/' + hash + '/' + operation
            var url = path
            var init = { method: method, headers: headers }
            if (method === 'GET') {
              var params = new URLSearchParams()
              params.set('variables', JSON.stringify(variables))
              params.set('features', JSON.stringify(features))
              if (options.fieldToggles) params.set('fieldToggles', JSON.stringify(options.fieldToggles))
              url = path + '?' + params.toString()
              if (options.signed) {
                var txId = await getTransactionId('/i/api/graphql/' + hash + '/' + operation, 'GET')
                if (txId) headers['x-client-transaction-id'] = txId
              }
            } else {
              init.body = JSON.stringify({ variables: variables, features: features, queryId: hash })
              if (options.signed) {
                var postTxId = await getTransactionId('/i/api/graphql/' + hash + '/' + operation, 'POST')
                if (postTxId) headers['x-client-transaction-id'] = postTxId
              }
            }
            var sent = await xFetch(url, init, operation)
            if (!sent.ok) return sent
            var response = sent.response
            if (!response.ok) {
              var body = ''
              try {
                body = await response.text()
              } catch (e) {
                body = ''
              }
              return classifyError(response, body, operation)
            }
            if (response.status === 204) return { ok: true, data: {} }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {
              return {
                ok: false,
                error_code: 'NETWORK',
                message: 'Network error reading ' + operation + ': ' + (e && e.message ? e.message : String(e)),
              }
            }
            if (!text) return { ok: true, data: {} }
            try {
              return { ok: true, data: JSON.parse(text) }
            } catch (e) {
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: 'X returned invalid JSON for ' + operation,
              }
            }
          }

          function query(operation, variables, options) {
            var merged = { method: 'GET' }
            var keys = Object.keys(options || {})
            for (var i = 0; i < keys.length; i++) merged[keys[i]] = options[keys[i]]
            return graphqlRequest(operation, variables, merged)
          }

          function mutation(operation, variables, options) {
            var merged = { method: 'POST' }
            var keys = Object.keys(options || {})
            for (var i = 0; i < keys.length; i++) merged[keys[i]] = options[keys[i]]
            return graphqlRequest(operation, variables, merged)
          }

          // --- response envelope ---------------------------------------------------
          function ok(data) {
            return { status: 'ok', data: data, message: null }
          }

          function failure(res) {
            var out = {
              status: 'error',
              data: null,
              error_code: res.error_code || 'UNKNOWN',
              message: res.message || 'X request failed',
            }
            if (res.retry_after_ms !== undefined) out.retry_after_ms = res.retry_after_ms
            return out
          }

          function toolFailure(code, message) {
            return failure({ error_code: code, message: message })
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---------------------------------
          function mapUser(u) {
            u = u || {}
            var core = u.core || {}
            var legacy = u.legacy || {}
            var bio = u.profile_bio || {}
            var avatar = u.avatar || {}
            var locationField = typeof u.location === 'object' && u.location ? u.location.location : undefined
            return {
              id: u.rest_id === undefined || u.rest_id === null ? '' : String(u.rest_id),
              name: core.name === undefined ? legacy.name === undefined ? '' : legacy.name : core.name,
              screen_name:
                core.screen_name === undefined
                  ? legacy.screen_name === undefined
                    ? ''
                    : legacy.screen_name
                  : core.screen_name,
              description:
                bio.description === undefined
                  ? legacy.description === undefined
                    ? ''
                    : legacy.description
                  : bio.description,
              followers_count: legacy.followers_count === undefined ? 0 : legacy.followers_count,
              following_count: legacy.friends_count === undefined ? 0 : legacy.friends_count,
              tweet_count: legacy.statuses_count === undefined ? 0 : legacy.statuses_count,
              verified: u.is_blue_verified === undefined ? false : !!u.is_blue_verified,
              profile_image_url:
                avatar.image_url === undefined
                  ? legacy.profile_image_url_https === undefined
                    ? ''
                    : legacy.profile_image_url_https
                  : avatar.image_url,
              profile_banner_url: legacy.profile_banner_url === undefined ? '' : legacy.profile_banner_url,
              created_at:
                core.created_at === undefined
                  ? legacy.created_at === undefined
                    ? ''
                    : legacy.created_at
                  : core.created_at,
              location:
                locationField === undefined
                  ? legacy.location === undefined
                    ? ''
                    : legacy.location
                  : locationField,
              url: legacy.url === undefined ? '' : legacy.url,
            }
          }

          function mapTweet(t) {
            t = t || {}
            var core = t.core || {}
            var legacy = t.legacy || {}
            var author = core.user_results ? core.user_results.result : null
            author = author || {}
            var authorCore = author.core || {}
            var authorLegacy = author.legacy || {}
            var views = t.views || {}
            return {
              id: t.rest_id === undefined || t.rest_id === null ? '' : String(t.rest_id),
              text: legacy.full_text === undefined ? '' : legacy.full_text,
              author_id:
                author.rest_id === undefined || author.rest_id === null ? '' : String(author.rest_id),
              author_name:
                authorCore.name === undefined
                  ? authorLegacy.name === undefined
                    ? ''
                    : authorLegacy.name
                  : authorCore.name,
              author_screen_name:
                authorCore.screen_name === undefined
                  ? authorLegacy.screen_name === undefined
                    ? ''
                    : authorLegacy.screen_name
                  : authorCore.screen_name,
              created_at: legacy.created_at === undefined ? '' : legacy.created_at,
              reply_count: legacy.reply_count === undefined ? 0 : legacy.reply_count,
              retweet_count: legacy.retweet_count === undefined ? 0 : legacy.retweet_count,
              like_count: legacy.favorite_count === undefined ? 0 : legacy.favorite_count,
              quote_count: legacy.quote_count === undefined ? 0 : legacy.quote_count,
              bookmark_count: legacy.bookmark_count === undefined ? 0 : legacy.bookmark_count,
              view_count: views.count === undefined ? '' : String(views.count),
              lang: legacy.lang === undefined ? '' : legacy.lang,
              is_reply: Boolean(legacy.in_reply_to_status_id_str),
              in_reply_to_user_id:
                legacy.in_reply_to_user_id_str === undefined ? '' : String(legacy.in_reply_to_user_id_str),
              conversation_id:
                legacy.conversation_id_str === undefined ? '' : String(legacy.conversation_id_str),
            }
          }

          function mapTrend(t) {
            t = t || {}
            var content = t.item ? t.item.itemContent : null
            content = content || {}
            var trendUrl = content.trend_url || {}
            var trendMeta = content.trend_metadata || {}
            var metaUrl = trendMeta.url || {}
            var rawUrl = trendUrl.url !== undefined ? trendUrl.url : metaUrl.url !== undefined ? metaUrl.url : ''
            var match = String(rawUrl || '').match(/query=([^&]+)/)
            var searchQuery = match ? match[1] : null
            return {
              name: content.name === undefined ? '' : content.name,
              domain_context: trendMeta.domain_context === undefined ? '' : trendMeta.domain_context,
              url: searchQuery ? 'https://x.com/search?q=' + searchQuery : '',
            }
          }

          function mapList(l) {
            l = l || {}
            var legacy = l.legacy || {}
            return {
              id: l.id_str === undefined ? '' : String(l.id_str),
              name: legacy.name === undefined ? '' : legacy.name,
              description: legacy.description === undefined ? '' : legacy.description,
              member_count: legacy.member_count === undefined ? 0 : legacy.member_count,
              subscriber_count: legacy.subscriber_count === undefined ? 0 : legacy.subscriber_count,
              is_private: legacy.mode === 'Private',
              created_at: legacy.created_at === undefined ? '' : legacy.created_at,
            }
          }

          // --- timeline extraction (URT) -------------------------------------------
          function nodeAt(data, path) {
            var current = data
            for (var i = 0; i < path.length; i++) {
              if (current === null || current === undefined) return undefined
              current = current[path[i]]
            }
            return current
          }

          // Unwrap TweetWithVisibilityResults / TweetTombstone wrappers.
          function unwrapTweet(result) {
            if (!result) return null
            if (result.__typename === 'TweetWithVisibilityResults') return result.tweet || null
            return result
          }

          function extractTweetsFromTimeline(data, path) {
            var current = nodeAt(data, path)
            var instructions = current ? current.instructions : null
            if (!Array.isArray(instructions)) return []
            var tweets = []
            for (var i = 0; i < instructions.length; i++) {
              var entries = instructions[i] ? instructions[i].entries : null
              if (!Array.isArray(entries)) continue
              for (var j = 0; j < entries.length; j++) {
                var content = entries[j] ? entries[j].content : null
                if (!content) continue
                var itemContent = content.itemContent
                var tweetResult = itemContent && itemContent.tweet_results ? itemContent.tweet_results.result : null
                if (tweetResult && tweetResult.legacy) {
                  var inner = unwrapTweet(tweetResult)
                  if (inner) tweets.push(inner)
                }
                var items = content.items
                if (Array.isArray(items)) {
                  for (var k = 0; k < items.length; k++) {
                    var innerItem = items[k] && items[k].item ? items[k].item.itemContent : null
                    var innerTweet =
                      innerItem && innerItem.tweet_results ? innerItem.tweet_results.result : null
                    if (innerTweet && innerTweet.legacy) {
                      var unwrapped = unwrapTweet(innerTweet)
                      if (unwrapped) tweets.push(unwrapped)
                    }
                  }
                }
              }
            }
            return tweets
          }

          function extractCursor(data, path, direction) {
            var want = direction || 'Bottom'
            var current = nodeAt(data, path)
            var instructions = current ? current.instructions : null
            if (!Array.isArray(instructions)) return undefined
            for (var i = 0; i < instructions.length; i++) {
              var entries = instructions[i] ? instructions[i].entries : null
              if (!Array.isArray(entries)) continue
              for (var j = 0; j < entries.length; j++) {
                var content = entries[j] ? entries[j].content : null
                if (content && content.cursorType === want) return content.value
              }
            }
            return undefined
          }

          function extractUsersFromTimeline(data, path) {
            var current = nodeAt(data, path)
            var instructions = current ? current.instructions : null
            if (!Array.isArray(instructions)) return []
            var users = []
            for (var i = 0; i < instructions.length; i++) {
              var entries = instructions[i] ? instructions[i].entries : null
              if (!Array.isArray(entries)) continue
              for (var j = 0; j < entries.length; j++) {
                var content = entries[j] ? entries[j].content : null
                var itemContent = content ? content.itemContent : null
                var userResults = itemContent ? itemContent.user_results : null
                var result = userResults ? userResults.result : null
                if (result && result.rest_id) users.push(result)
              }
            }
            return users
          }

          function countOr(value, fallback) {
            return value === undefined ? fallback : value
          }

          // Shared CreateTweet path (create_tweet and quote_tweet). Upstream surfaces
          // three distinct outcomes and each one is kept verbatim:
          //  - GraphQL errors present  -> INTERNAL with the messages joined
          //  - tweet_results === {}    -> EMPTY_RESULT_AMBIGUOUS (non-retryable: the post
          //                               may have landed, so a retry could double-post)
          //  - anything else           -> INTERNAL with the truncated response
          async function submitTweet(variables, noun) {
            var res = await mutation('CreateTweet', variables)
            if (!res.ok) return failure(res)
            var data = res.data || {}
            var createResult = data.data ? data.data.create_tweet : null
            var tweetResult =
              createResult && createResult.tweet_results ? createResult.tweet_results.result : null
            if (!tweetResult) {
              var errors = data.errors
              if (Array.isArray(errors) && errors.length > 0) {
                var messages = []
                for (var i = 0; i < errors.length; i++) {
                  messages.push(errors[i] && errors[i].message ? errors[i].message : String(errors[i]))
                }
                return toolFailure('INTERNAL', messages.join('; '))
              }
              if (createResult && createResult.tweet_results !== undefined) {
                return failure({
                  error_code: 'EMPTY_RESULT_AMBIGUOUS',
                  message:
                    'CreateTweet returned an empty tweet_results object — X accepted the request but returned no ' +
                    noun +
                    '. The post may or may not have landed; verify on the timeline before retrying to avoid a double-post.',
                })
              }
              return toolFailure(
                'INTERNAL',
                'CreateTweet returned unexpected response: ' + JSON.stringify(data).slice(0, 500),
              )
            }
            return ok({ tweet: mapTweet(tweetResult) })
          }
          var xToolImplementations = {

          async update_list(args) {
            var variables = { listId: args.list_id }
            if (args.name !== undefined) variables.name = args.name
            if (args.description !== undefined) variables.description = args.description
            if (args.is_private !== undefined) variables.isPrivate = args.is_private
            var res = await mutation('UpdateList', variables)
            if (!res.ok) return failure(res)
            var data = res.data || {}
            var payload = data.data ? data.data.list_update : null
            var raw = payload ? payload.list : null
            if (!raw) return toolFailure('INTERNAL', 'UpdateList returned no list')
            return ok({ list: mapList(raw) })
          },
          }

          async function stdin_default(args) {
            try {
              return await xToolImplementations['update_list'](args)
            } catch (e) {
              // A page-side throw (unexpected response shape) must not escape as
              // a TAB_UNAVAILABLE: classify it like upstream's internal error.
              return failure({
                error_code: 'INTERNAL',
                message: e && e.message ? e.message : String(e),
              })
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
        // Tab closed/navigated or the eval timed out: surface a stable workflow
        // error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The x.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'X request failed',
          error_code: result.error_code || 'UNKNOWN',
          ...(result.retry_after_ms === undefined
            ? {}
            : { retry_after_ms: result.retry_after_ms }),
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The x.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
