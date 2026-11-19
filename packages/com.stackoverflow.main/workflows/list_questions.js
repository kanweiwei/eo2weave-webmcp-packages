// Self-contained adapter workflow for list_questions. The Stack Exchange API
// calls and the page-side identity read stay inside the stackoverflow.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "sort": {
        "description": "Sort order (default: activity)",
        "type": "string",
        "enum": [
          "activity",
          "creation",
          "votes",
          "hot",
          "week",
          "month"
        ]
      },
      "order": {
        "description": "Sort direction (default: desc)",
        "type": "string",
        "enum": [
          "asc",
          "desc"
        ]
      },
      "tagged": {
        "description": "Semicolon-delimited tags to filter by (e.g., \"javascript;react\"). AND logic.",
        "type": "string"
      },
      "page": {
        "description": "Page number (default 1)",
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "pagesize": {
        "description": "Results per page (default 30, max 100)",
        "type": "integer",
        "minimum": 1,
        "maximum": 100
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
    description: 'list_questions',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Stack Exchange runtime (translated from OpenTabs
          // stackoverflow-api.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // stackoverflow.com tab: the logged-in identity is read from the page
          // (StackExchange.options.user) and never leaves page context. The API
          // calls are the public api.stackexchange.com endpoints used by the
          // upstream plugin — no cookies, no token, nothing lifted out.
          var API_BASE = 'https://api.stackexchange.com/2.3'
          var SITE = 'stackoverflow'
          var FILTER = 'withbody'

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

          // Re-read the page identity on every call: an account switch in a live
          // tab must not keep reporting the previous user.
          function getUserId() {
            var isRegistered = getPageGlobal('StackExchange.options.user.isRegistered')
            if (!isRegistered) return null
            var userId = getPageGlobal('StackExchange.options.user.userId')
            if (typeof userId !== 'number') return null
            return userId
          }

          // Mirrors the upstream query builder: site first, then the caller's
          // params in declaration order (skipping undefined and ''), then the
          // default withbody filter unless the caller supplied one.
          function buildQueryString(query) {
            var params = new URLSearchParams()
            params.append('site', SITE)
            if (query) {
              var keys = Object.keys(query)
              for (var i = 0; i < keys.length; i++) {
                var value = query[keys[i]]
                if (value !== undefined && value !== '') params.append(keys[i], String(value))
              }
            }
            if (!query || !query.filter) params.append('filter', FILTER)
            return params.toString()
          }

          async function seApi(endpoint, query) {
            var url = API_BASE + endpoint + '?' + buildQueryString(query)
            // Abort the in-page fetch before the 25s browser command deadline can
            // orphan it, so a timed-out call does not leave the request running.
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
            try {
              var response
              try {
                response = await fetch(url, {
                  method: 'GET',
                  headers: { accept: 'application/json' },
                  // api.stackexchange.com answers with Access-Control-Allow-Origin: *
                  // and Access-Control-Allow-Credentials: false, so a credentialed
                  // cross-origin fetch is rejected by the browser. The public API
                  // needs no session cookie; nothing is sent.
                  credentials: 'omit',
                  signal: abortController ? abortController.signal : undefined,
                })
              } catch (e) {
                var aborted =
                  e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
                return {
                  ok: false,
                  error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                  message: aborted
                    ? 'Stack Exchange API request aborted after the 18s in-page deadline.'
                    : 'Network error calling the Stack Exchange API: ' + String(e),
                }
              }
              var text = ''
              try {
                text = await response.text()
              } catch (e) {
                text = ''
              }
              var body = null
              try {
                body = JSON.parse(text)
              } catch (e) {
                body = null
              }
              // The API reports failures in the body with a numeric error_id.
              if (body && typeof body.error_id === 'number') {
                var detail = String(body.error_name) + ': ' + String(body.error_message)
                var code = 'INTERNAL'
                if (body.error_id === 502) code = 'RATE_LIMITED'
                else if (body.error_id === 401 || body.error_id === 403) code = 'AUTH'
                else if (body.error_id === 404) code = 'NOT_FOUND'
                else if (body.error_id === 400) code = 'VALIDATION'
                return {
                  ok: false,
                  error_code: code,
                  status: body.error_id,
                  message: 'Stack Exchange API error (' + body.error_id + '): ' + detail,
                }
              }
              if (!response.ok)
                return {
                  ok: false,
                  error_code: 'HTTP',
                  status: response.status,
                  message: 'Stack Exchange API error (HTTP ' + response.status + '): ' + endpoint,
                }
              if (!body)
                return {
                  ok: false,
                  error_code: 'INTERNAL',
                  message: 'Stack Exchange API returned invalid JSON from ' + endpoint,
                }
              if (typeof body.backoff === 'number')
                return {
                  ok: false,
                  error_code: 'RATE_LIMITED',
                  message:
                    'Stack Exchange API requested a backoff of ' + body.backoff + 's for ' + endpoint,
                }
              return { ok: true, data: body }
            } finally {
              if (abortTimer !== null) clearTimeout(abortTimer)
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function unixToIso(ts) {
            return ts ? new Date(ts * 1000).toISOString() : ''
          }
          function nested(v) {
            return typeof v === 'object' && v !== null ? v : undefined
          }
          function pick(obj, key, fallback) {
            return obj[key] === undefined || obj[key] === null ? fallback : obj[key]
          }
          function owner(q, key, fallback) {
            var o = nested(q.owner)
            return o && o[key] !== undefined && o[key] !== null ? o[key] : fallback
          }
          function mapQuestion(q) {
            q = q || {}
            return {
              question_id: pick(q, 'question_id', 0),
              title: pick(q, 'title', ''),
              body: pick(q, 'body', ''),
              tags: pick(q, 'tags', []),
              score: pick(q, 'score', 0),
              answer_count: pick(q, 'answer_count', 0),
              view_count: pick(q, 'view_count', 0),
              is_answered: pick(q, 'is_answered', false),
              accepted_answer_id: pick(q, 'accepted_answer_id', 0),
              creation_date: unixToIso(q.creation_date),
              last_activity_date: unixToIso(q.last_activity_date),
              link: pick(q, 'link', ''),
              owner_display_name: owner(q, 'display_name', ''),
              owner_reputation: owner(q, 'reputation', 0),
              owner_user_id: owner(q, 'user_id', 0),
              bounty_amount: pick(q, 'bounty_amount', 0),
              closed_reason: pick(q, 'closed_reason', ''),
            }
          }
          function mapAnswer(a) {
            a = a || {}
            return {
              answer_id: pick(a, 'answer_id', 0),
              question_id: pick(a, 'question_id', 0),
              body: pick(a, 'body', ''),
              score: pick(a, 'score', 0),
              is_accepted: pick(a, 'is_accepted', false),
              creation_date: unixToIso(a.creation_date),
              last_activity_date: unixToIso(a.last_activity_date),
              owner_display_name: owner(a, 'display_name', ''),
              owner_reputation: owner(a, 'reputation', 0),
              owner_user_id: owner(a, 'user_id', 0),
            }
          }
          function mapComment(c) {
            c = c || {}
            return {
              comment_id: pick(c, 'comment_id', 0),
              post_id: pick(c, 'post_id', 0),
              body: pick(c, 'body', ''),
              score: pick(c, 'score', 0),
              creation_date: unixToIso(c.creation_date),
              owner_display_name: owner(c, 'display_name', ''),
              owner_user_id: owner(c, 'user_id', 0),
            }
          }
          function mapUser(u) {
            u = u || {}
            var badges = nested(u.badge_counts) || {}
            return {
              user_id: pick(u, 'user_id', 0),
              display_name: pick(u, 'display_name', ''),
              reputation: pick(u, 'reputation', 0),
              profile_image: pick(u, 'profile_image', ''),
              link: pick(u, 'link', ''),
              accept_rate: pick(u, 'accept_rate', 0),
              question_count: pick(u, 'question_count', 0),
              answer_count: pick(u, 'answer_count', 0),
              creation_date: unixToIso(u.creation_date),
              last_access_date: unixToIso(u.last_access_date),
              location: pick(u, 'location', ''),
              website_url: pick(u, 'website_url', ''),
              badge_gold: pick(badges, 'gold', 0),
              badge_silver: pick(badges, 'silver', 0),
              badge_bronze: pick(badges, 'bronze', 0),
            }
          }
          function mapTag(t) {
            t = t || {}
            return {
              name: pick(t, 'name', ''),
              count: pick(t, 'count', 0),
              has_synonyms: pick(t, 'has_synonyms', false),
              is_moderator_only: pick(t, 'is_moderator_only', false),
              is_required: pick(t, 'is_required', false),
            }
          }
          function mapTagInfo(t, wiki) {
            var out = mapTag(t)
            out.excerpt = wiki && wiki.excerpt !== undefined && wiki.excerpt !== null ? wiki.excerpt : ''
            out.wiki_body = wiki && wiki.body !== undefined && wiki.body !== null ? wiki.body : ''
            return out
          }
          function mapSearchExcerpt(s) {
            s = s || {}
            return {
              question_id: pick(s, 'question_id', 0),
              answer_id: pick(s, 'answer_id', 0),
              title: pick(s, 'title', ''),
              excerpt: pick(s, 'excerpt', ''),
              item_type: pick(s, 'item_type', ''),
              tags: pick(s, 'tags', []),
              score: pick(s, 'score', 0),
              is_answered: pick(s, 'is_answered', false),
              creation_date: unixToIso(s.creation_date),
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
            if (!/(^|\.)stackoverflow\.com$/.test(location.hostname))
              return error('UNSUPPORTED_PAGE', 'Not on a stackoverflow.com page.')
            return null
          }
          // Envelope for a paged collection endpoint: items mapped, plus the
          // pagination and quota fields the upstream tools return.
          function collection(response, key, mapper) {
            var data = response.data || {}
            var out = {}
            out[key] = (data.items || []).map(mapper)
            out.has_more = pick(data, 'has_more', false)
            out.quota_remaining = pick(data, 'quota_remaining', 0)
            return ok(out)
          }

          var stackoverflowToolImplementations = {
      async list_questions(args) {
        var pageError = assertPage()
        if (pageError) return pageError
        var response = await seApi('/questions', {
          sort: args.sort === undefined ? 'activity' : args.sort,
          order: args.order === undefined ? 'desc' : args.order,
          tagged: args.tagged,
          page: args.page,
          pagesize: args.pagesize,
        })
        if (!response.ok) return response
        return collection(response, 'questions', mapQuestion)
      },
          }

          async function stdin_default(args) {
            return stackoverflowToolImplementations['list_questions'](args)
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
            'The stackoverflow.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Stack Exchange API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The stackoverflow.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
