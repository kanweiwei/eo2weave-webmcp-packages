// Self-contained adapter workflow. The Confluence page context and every
// /wiki/api/v2 (and /wiki/rest/api) fetch stay inside the *.atlassian.net/wiki
// tab.
//
// Ported from the OpenTabs confluence plugin (plugins/confluence/src, MIT):
// same endpoints, same request bodies, same error classification. Upstream
// caches the account id and wiki base URL in the extension auth cache; here
// they are re-read from the page meta tags on every call.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "account_id": {
        "description": "Atlassian account ID — omit to get the current user profile",
        "type": "string"
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
    description: "get_user_profile",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Confluence Cloud runtime (translated from OpenTabs
          // confluence-api.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // *.atlassian.net/wiki tab: the account id and the REST base come from
          // the page's own meta tags, and every call is a same-origin
          // /wiki/api/v2 (or /wiki/rest/api) fetch carrying the browser session
          // cookie — no token ever leaves the page.

          function getMetaContent(name) {
            try {
              var el = document.querySelector('meta[name="' + name + '"]')
              if (!el) return null
              var value = el.getAttribute('content')
              return value && value.trim() ? value.trim() : null
            } catch (e) {
              return null
            }
          }

          // Confluence Cloud stamps the session identity and the wiki base path
          // onto every page as meta tags. Upstream caches them in the extension's
          // auth cache; this port re-reads them on every call, so an account
          // switch in a live tab cannot reuse the previous identity.
          function getAuth() {
            var accountId =
              getMetaContent('ajs-atlassian-account-id') || getMetaContent('ajs-remote-user')
            var baseUrl = getMetaContent('ajs-base-url')
            var cloudId = getMetaContent('ajs-cloud-id')
            if (!accountId || !baseUrl) return null
            return { accountId: accountId, baseUrl: baseUrl, cloudId: cloudId || '' }
          }

          function getAccountId() {
            var auth = getAuth()
            return auth ? auth.accountId : null
          }

          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value !== undefined && value !== null) params.append(keys[i], String(value))
            }
            return params.toString()
          }

          // Faithful translation of the plugin's apiV2()/apiV1(): REST paths
          // under the page's ajs-base-url (…/wiki), JSON bodies only, the page
          // cookie, and the same status classification (401/403 auth, 404 not
          // found, 400/422 validation, 429 rate limited).
          async function confluenceApi(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to Confluence.',
              }
            var apiBase = options.api === 'v1' ? '/rest/api' : '/api/v2'
            var baseUrl = String(auth.baseUrl).replace(/\/+$/, '')
            var url = baseUrl + apiBase + endpoint
            if (options.query) {
              var qs = buildQueryString(options.query)
              if (qs) url += '?' + qs
            }
            var method = options.method || 'GET'
            var headers = { Accept: 'application/json' }
            var fetchBody
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              fetchBody = JSON.stringify(options.body)
            }
            // Confluence's XSRF check rejects a cookie-authenticated write
            // (POST/PUT/DELETE) that does not opt out with this header.
            if (method !== 'GET') headers['X-Atlassian-Token'] = 'no-check'
            // Abort the in-page fetch before the 25s browser command deadline can
            // orphan it. Upstream uses AbortSignal.timeout(30s); 18s keeps the
            // request inside the adapter's window.
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
              response = await fetch(url, {
                method: method,
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
                  ? 'Confluence request aborted after the 18s in-page deadline: ' + endpoint
                  : 'Network error calling Confluence: ' + String(e),
              }
            }
            if (abortTimer !== null) clearTimeout(abortTimer)
            if (response.status === 204) return { ok: true, data: {} }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              var detail = ''
              try {
                var parsed = JSON.parse(text)
                if (parsed && typeof parsed.message === 'string' && parsed.message)
                  detail = parsed.message
                else if (parsed && Array.isArray(parsed.errors) && parsed.errors.length)
                  detail = parsed.errors
                    .map(function (err) {
                      return (err && err.message) || String(err)
                    })
                    .join('; ')
              } catch (e) {}
              var errorCode = 'HTTP'
              if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
              else if (response.status === 404) errorCode = 'NOT_FOUND'
              else if (response.status === 400 || response.status === 422) errorCode = 'VALIDATION'
              else if (response.status === 429) errorCode = 'RATE_LIMITED'
              var retryHint = ''
              if (response.status === 429) {
                try {
                  var retryAfter =
                    response.headers && response.headers.get
                      ? response.headers.get('Retry-After')
                      : null
                  if (retryAfter) retryHint = ' (Retry-After: ' + retryAfter + ')'
                } catch (e) {}
              }
              return {
                ok: false,
                error_code: errorCode,
                status: response.status,
                message:
                  'Confluence API error (' +
                  response.status +
                  '): ' +
                  endpoint +
                  retryHint +
                  ' — ' +
                  (detail || text.slice(0, 512)),
              }
            }
            try {
              var data = await response.json()
              return { ok: true, data: data }
            } catch (e) {
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Confluence returned invalid JSON: ' + endpoint,
              }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          // Cursor out of the pagination _links.next URL. Parsed by hand rather
          // than with new URL(): the relative next link needs no base URL and
          // URLSearchParams is the only parser the page context is guaranteed.
          function extractCursor(nextUrl) {
            if (!nextUrl) return null
            var href = String(nextUrl)
            var query = href.indexOf('?') === -1 ? '' : href.slice(href.indexOf('?') + 1)
            var hash = query.indexOf('#')
            if (hash !== -1) query = query.slice(0, hash)
            if (!query) return null
            try {
              return new URLSearchParams(query).get('cursor')
            } catch (e) {
              return null
            }
          }

          function mapSpace(s) {
            s = s || {}
            return {
              id: s.id || '',
              key: s.key || '',
              name: s.name || '',
              type: s.type || '',
              status: s.status || '',
              description: typeof s.description === 'string' ? s.description : null,
              homepage_id: s.homepageId === undefined ? null : s.homepageId,
            }
          }

          function mapPage(p) {
            p = p || {}
            var version = p.version || {}
            return {
              id: p.id || '',
              title: p.title || '',
              space_id: p.spaceId || '',
              status: p.status || '',
              parent_id: p.parentId === undefined ? null : p.parentId,
              author_id: p.authorId || '',
              created_at: p.createdAt || '',
              version: {
                number: version.number === undefined ? 0 : version.number,
                author_id: version.authorId || '',
                created_at: version.createdAt || '',
                message: version.message || '',
              },
              web_url: (p._links && p._links.webui) || '',
            }
          }

          function mapComment(c) {
            c = c || {}
            var version = c.version || {}
            var body = c.body || {}
            var storage = body.storage || {}
            return {
              id: c.id || '',
              page_id: c.pageId || '',
              status: c.status || '',
              title: c.title || '',
              author_id: version.authorId || '',
              created_at: version.createdAt || '',
              body: storage.value || '',
            }
          }

          function mapInlineComment(c) {
            c = c || {}
            var mapped = mapComment(c)
            var props = c.properties || {}
            var selection =
              props.inlineOriginalSelection === undefined
                ? props['inline-original-selection']
                : props.inlineOriginalSelection
            var markerRef =
              props.inlineMarkerRef === undefined ? props['inline-marker-ref'] : props.inlineMarkerRef
            mapped.resolution_status = c.resolutionStatus || ''
            mapped.text_selection = selection === undefined ? null : selection
            mapped.inline_marker_ref = markerRef || ''
            return mapped
          }

          function mapLabel(l) {
            l = l || {}
            return { id: l.id || '', name: l.name || '', prefix: l.prefix || '' }
          }

          function mapSearchResult(r) {
            r = r || {}
            var content = r.content || {}
            var container = r.resultGlobalContainer || {}
            return {
              id: content.id || '',
              title: content.title || r.title || '',
              type: content.type || '',
              status: content.status || '',
              excerpt: r.excerpt || '',
              url: r.url || '',
              last_modified: r.lastModified || '',
              space_title: container.title || '',
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
          // The path comes from href rather than location.pathname: the adapter
          // hands the page a minimal location object, and href is always there.
          function currentPath() {
            var href = String(location.href || '')
            var match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/.exec(href)
            if (!match) return '/'
            return match[1] || '/'
          }

          function assertPage() {
            var host = location.hostname || ''
            if (host.slice(-14) !== '.atlassian.net')
              return error(
                'UNSUPPORTED_PAGE',
                'Not on a Confluence Cloud (*.atlassian.net/wiki) page.',
              )
            if (currentPath().indexOf('/wiki/') !== 0)
              return error('UNSUPPORTED_PAGE', 'This is not a Confluence page (missing /wiki/ path).')
            return null
          }

          var confluenceToolImplementations = {
      async get_user_profile(args) {
        var pageError = assertPage()
        if (pageError) return pageError
        var accountId = args.account_id === undefined ? getAccountId() : args.account_id
        if (!accountId)
          return error('UNAUTHENTICATED', 'Not authenticated — please log in to Confluence.')
        var res = await confluenceApi('/user', { api: 'v1', query: { accountId: accountId } })
        if (!res.ok) return error(res.error_code, res.message)
        var data = res.data || {}
        var picture = data.profilePicture || {}
        return ok({
          user: {
            account_id: data.accountId || '',
            display_name: data.displayName || '',
            public_name: data.publicName || '',
            email: data.email || '',
            account_type: data.accountType || '',
            account_status: data.accountStatus || '',
            avatar_url: picture.path || '',
          },
        })
      },
          }

          async function stdin_default(args) {
            return confluenceToolImplementations["get_user_profile"](args)
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
            'The Confluence tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Confluence API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Confluence tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
