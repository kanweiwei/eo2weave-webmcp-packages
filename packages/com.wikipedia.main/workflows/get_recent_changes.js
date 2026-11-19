// Self-contained adapter workflow. The MediaWiki session and every
// *.wikipedia.org fetch stay inside the wikipedia.org tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "limit": {
        "description": "Maximum number of recent changes to return (default 20, max 50)",
        "type": "integer",
        "minimum": 1,
        "maximum": 50
      }
    },
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
    description: 'get_recent_changes',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side Wikipedia runtime (translated from OpenTabs wikipedia-api.ts and
          // tools/schemas.ts, MIT). Runs INSIDE the *.wikipedia.org tab: every MediaWiki
          // call is a same-origin fetch carrying the session cookies, and the login
          // identity is read from mw.config without ever leaving page context.
          var WIKI_SUFFIX = '.wikipedia.org'
          var API_PATH = '/w/api.php'
          var IN_PAGE_DEADLINE_MS = 18000

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

          // --- auth ---
          // Wikipedia authenticates the API with the session cookies; the identity is
          // only ever read from the page (mw.config.values.wgUserName / wgUserId). It is
          // re-read on every call instead of cached: an account switch in a still-loaded
          // tab must not keep answering with the previous session's identity.
          function getAuth() {
            var username = getPageGlobal('mw.config.values.wgUserName')
            var userId = getPageGlobal('mw.config.values.wgUserId')
            if (!username || !userId) return null
            return { username: username, userId: userId }
          }
          function isAuthenticated() {
            return getAuth() !== null
          }
          function isPageReady() {
            return getPageGlobal('mw.config.values.wgSiteName') !== undefined
          }
          // Upstream gates the plugin on isReady(); the port only needs that gate where
          // mw.config actually matters (the login identity), so the wait is best-effort
          // and the public API tools run even while the page bundle is still loading.
          async function ensureReady() {
            if (isPageReady()) return true
            var deadline = Date.now() + 5000
            while (!isPageReady() && Date.now() < deadline) {
              await new Promise(function (resolve) {
                setTimeout(resolve, 300)
              })
            }
            return isPageReady()
          }

          // --- transport ---
          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value !== undefined && value !== null) params.append(keys[i], String(value))
            }
            return params.toString()
          }

          function absoluteUrl(url) {
            if (/^https?:\/\//.test(url)) return url
            return location.origin + url
          }

          // One JSON fetch with the tab's cookies. Returns a classified result instead of
          // throwing, so a failed call always ends as an envelope the adapter can map.
          async function httpJSON(url, init, timeoutMs) {
            var target = absoluteUrl(url)
            // Session cookies ride along unless the caller asks for an anonymous call.
            var request = Object.assign({ credentials: 'include' }, init || {})
            var limit = timeoutMs || IN_PAGE_DEADLINE_MS
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
                  }, limit)
                : null
            if (controller) request.signal = controller.signal
            var response
            try {
              response = await fetch(target, request)
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'Wikipedia request aborted after the ' + Math.round(limit / 1000) + 's in-page deadline.'
                  : 'Network error calling the Wikipedia API: ' + String(e),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (response.status === 204) return { ok: true, data: {} }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {
              text = ''
            }
            if (!response.ok) {
              var detail = ''
              try {
                var parsed = JSON.parse(text)
                detail =
                  parsed.message ||
                  (parsed.error && (parsed.error.info || parsed.error.code)) ||
                  (parsed.title === undefined ? '' : String(parsed.title))
              } catch (e) {}
              var errorCode = 'HTTP'
              if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
              else if (response.status === 404) errorCode = 'NOT_FOUND'
              else if (response.status === 429) errorCode = 'RATE_LIMITED'
              return {
                ok: false,
                error_code: errorCode,
                status: response.status,
                message: 'Wikipedia API error (' + response.status + '): ' + (detail || text.slice(0, 512)),
              }
            }
            try {
              return { ok: true, data: JSON.parse(text) }
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'Wikipedia API returned invalid JSON' }
            }
          }

          // MediaWiki action API: /w/api.php, format=json, formatversion=2. Application
          // level failures arrive with HTTP 200 and are classified like upstream does.
          async function api(params, options) {
            options = options || {}
            var method = options.method || 'GET'
            if (options.requireAuth && !isAuthenticated())
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not logged in to Wikipedia — please log in first.',
              }
            var all = {}
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) all[keys[i]] = params[keys[i]]
            all.format = 'json'
            all.formatversion = 2
            var qs = buildQueryString(all)
            var init = {}
            var url = API_PATH
            if (method === 'GET') {
              url = API_PATH + '?' + qs
            } else {
              init.method = 'POST'
              init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
              init.body = qs
            }
            var result = await httpJSON(url, init)
            if (!result.ok) return result
            var data = result.data
            if (data && typeof data === 'object' && data.error) {
              var code = data.error.code || 'unknown'
              var info = data.error.info || 'Unknown MediaWiki error'
              if (code === 'badtoken' || code === 'assertuserfailed')
                return { ok: false, error_code: 'AUTH', message: info, api_code: code }
              if (code === 'missingtitle' || code === 'nosuchpageid')
                return { ok: false, error_code: 'NOT_FOUND', message: info, api_code: code }
              if (code === 'ratelimited')
                return { ok: false, error_code: 'RATE_LIMITED', message: info, api_code: code }
              return {
                ok: false,
                error_code: 'INTERNAL',
                message: 'MediaWiki error [' + code + ']: ' + info,
                api_code: code,
              }
            }
            return { ok: true, data: data }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function stripHtmlTags(html) {
            // Loop until stable so nested / malformed markup cannot leak a partial tag.
            var result = html
            var prev
            do {
              prev = result
              result = result.replace(/<[^>]+>/g, '')
            } while (result !== prev)
            return result
          }

          function mapSearchResult(r) {
            r = r || {}
            return {
              pageid: r.pageid === undefined ? 0 : r.pageid,
              title: r.title === undefined ? '' : r.title,
              snippet: stripHtmlTags(r.snippet === undefined ? '' : r.snippet),
              size: r.size === undefined ? 0 : r.size,
              wordcount: r.wordcount === undefined ? 0 : r.wordcount,
              timestamp: r.timestamp === undefined ? '' : r.timestamp,
            }
          }

          function mapPageSummary(p) {
            p = p || {}
            var pageprops = p.pageprops || {}
            return {
              pageid: p.pageid === undefined ? 0 : p.pageid,
              title: p.title === undefined ? '' : p.title,
              extract: p.extract === undefined ? '' : p.extract,
              description:
                pageprops['wikibase-shortdesc'] === undefined ? '' : pageprops['wikibase-shortdesc'],
              url: p.fullurl === undefined ? '' : p.fullurl,
              thumbnail: p.thumbnail && p.thumbnail.source ? p.thumbnail.source : '',
              length: p.length === undefined ? 0 : p.length,
              last_edited: p.touched === undefined ? '' : p.touched,
              protection: (p.protection || []).map(function (pr) {
                return {
                  type: pr && pr.type !== undefined ? pr.type : '',
                  level: pr && pr.level !== undefined ? pr.level : '',
                }
              }),
            }
          }

          function mapRevision(r) {
            r = r || {}
            return {
              revid: r.revid === undefined ? 0 : r.revid,
              parentid: r.parentid === undefined ? 0 : r.parentid,
              user: r.user === undefined ? '' : r.user,
              timestamp: r.timestamp === undefined ? '' : r.timestamp,
              comment: r.comment === undefined ? '' : r.comment,
              size: r.size === undefined ? 0 : r.size,
            }
          }

          function mapSection(s) {
            s = s || {}
            return {
              index: s.index === undefined ? '' : s.index,
              level: s.level === undefined ? '' : s.level,
              line: s.line === undefined ? '' : s.line,
              number: s.number === undefined ? '' : s.number,
              anchor: s.anchor === undefined ? '' : s.anchor,
            }
          }

          function mapCategory(c) {
            c = c || {}
            return { title: c.title === undefined ? '' : c.title }
          }

          function mapLangLink(l) {
            l = l || {}
            var title = l.title === undefined ? l['*'] : l.title
            return {
              lang: l.lang === undefined ? '' : l.lang,
              title: title === undefined ? '' : title,
              url: l.url === undefined ? '' : l.url,
            }
          }

          function mapRecentChange(rc) {
            rc = rc || {}
            return {
              title: rc.title === undefined ? '' : rc.title,
              user: rc.user === undefined ? '' : rc.user,
              timestamp: rc.timestamp === undefined ? '' : rc.timestamp,
              comment: rc.comment === undefined ? '' : rc.comment,
              old_size: rc.oldlen === undefined ? 0 : rc.oldlen,
              new_size: rc.newlen === undefined ? 0 : rc.newlen,
            }
          }

          function mapUserInfo(u) {
            u = u || {}
            return {
              id: u.userid === undefined ? 0 : u.userid,
              name: u.name === undefined ? '' : u.name,
              editcount: u.editcount === undefined ? 0 : u.editcount,
              registration: u.registration === undefined ? '' : u.registration,
              groups: u.groups === undefined ? [] : u.groups,
            }
          }

          function mapUserContrib(c) {
            c = c || {}
            return {
              title: c.title === undefined ? '' : c.title,
              revid: c.revid === undefined ? 0 : c.revid,
              timestamp: c.timestamp === undefined ? '' : c.timestamp,
              comment: c.comment === undefined ? '' : c.comment,
              size: c.size === undefined ? 0 : c.size,
            }
          }

          function mapRandomPage(p) {
            p = p || {}
            return {
              id: p.id === undefined ? 0 : p.id,
              title: p.title === undefined ? '' : p.title,
            }
          }

          // --- envelope helpers ---
          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }
          function assertPage() {
            var host = String(location.hostname || '')
            if (host !== 'wikipedia.org' && host.slice(-WIKI_SUFFIX.length) !== WIKI_SUFFIX)
              return error('UNSUPPORTED_PAGE', 'Not on a *.wikipedia.org page.')
            return null
          }
          function firstPage(data) {
            var query = (data && data.query) || {}
            var pages = query.pages || []
            return pages.length > 0 ? pages[0] : null
          }
          function stripHtml(html) {
            return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          }
          function stripDiffHtml(html) {
            var result = String(html)
              .replace(/<td class="diff-deletedline"[^>]*>(.*?)<\/td>/gs, '- $1\n')
              .replace(/<td class="diff-addedline"[^>]*>(.*?)<\/td>/gs, '+ $1\n')
              .replace(/<td class="diff-context"[^>]*>(.*?)<\/td>/gs, '  $1\n')
            // Decode entities before the tag-stripping pass so encoded angle brackets in
            // the diff text are decoded first and only real markup is removed.
            result = result
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
            var prev
            do {
              prev = result
              result = result.replace(/<[^>]+>/g, '')
            } while (result !== prev)
            return result.trim()
          }

          var wikipediaToolImplementations = {
            async get_recent_changes(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api({
                action: 'query',
                list: 'recentchanges',
                rclimit: args.limit === undefined ? 20 : args.limit,
                rcprop: 'user|timestamp|title|comment|sizes',
                rctype: 'edit',
                rcnamespace: 0,
              })
              if (!res.ok) return res
              var query = res.data.query || {}
              return ok({ changes: (query.recentchanges || []).map(mapRecentChange) })
            }
          }

          async function stdin_default(args) {
            return wikipediaToolImplementations['get_recent_changes'](args)
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
            'The *.wikipedia.org tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Wikipedia API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The *.wikipedia.org tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
