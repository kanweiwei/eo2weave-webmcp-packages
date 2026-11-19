// Self-contained adapter workflow. The bitbucket.org page context and every
// /!api/2.0 fetch stay inside the tab.
//
// Ported from the OpenTabs bitbucket plugin (plugins/bitbucket/src, MIT): same
// endpoints, same CSRF handling, same error classification, same mappers.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "workspace": {
        "type": "string",
        "description": "Workspace slug or UUID"
      },
      "repo_slug": {
        "type": "string",
        "description": "Repository slug"
      },
      "pull_request_id": {
        "type": "integer",
        "description": "Pull request ID"
      }
    },
    "required": [
      "workspace",
      "repo_slug",
      "pull_request_id"
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
    description: 'get_pull_request',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Bitbucket runtime (translated from OpenTabs
          // bitbucket-api.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // bitbucket.org tab: the session identity is the page's own
          // __app_data__ global, a mutation carries the csrftoken cookie as
          // X-CSRFToken, and every call is a same-origin /!api/2.0 fetch with
          // the browser session cookie. No token ever leaves the page.
          var API_BASE = '/!api/2.0'

          function getAuth() {
            var uuid = null
            try {
              if (typeof __app_data__ !== 'undefined' && __app_data__ && __app_data__.user)
                uuid = __app_data__.user.uuid || null
            } catch (e) {
              uuid = null
            }
            return uuid ? { uuid: uuid } : null
          }

          function getCookie(name) {
            var raw = ''
            try {
              raw = (document && document.cookie) || ''
            } catch (e) {
              raw = ''
            }
            var parts = raw.split(';')
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i].replace(/^\s+/, '')
              if (part.indexOf(name + '=') === 0) {
                var value = part.slice(name.length + 1)
                try {
                  return decodeURIComponent(value)
                } catch (e) {
                  return value
                }
              }
            }
            return null
          }

          function buildUrl(endpoint, query) {
            var url = API_BASE + endpoint
            if (query) {
              var params = new URLSearchParams()
              var keys = Object.keys(query)
              for (var i = 0; i < keys.length; i++) {
                var value = query[keys[i]]
                if (value !== undefined && value !== null) params.append(keys[i], String(value))
              }
              var qs = params.toString()
              if (qs) url += '?' + qs
            }
            return url
          }

          // Abort the in-page fetch before the 25s browser command deadline can
          // orphan it. Upstream uses AbortSignal.timeout(30s); 20s keeps the
          // request inside the adapter's window.
          async function bitbucketFetch(url, endpoint, init) {
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
            try {
              var response = await fetch(
                url,
                Object.assign({}, init, {
                  credentials: 'include',
                  signal: abortController ? abortController.signal : undefined,
                }),
              )
              return { response: response }
            } catch (e) {
              var aborted =
                e && (e.name === 'AbortError' || e.name === 'TimeoutError' || String(e).indexOf('abort') !== -1)
              return {
                error: {
                  error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                  message: aborted
                    ? 'Bitbucket request aborted after the 20s in-page deadline: ' + endpoint
                    : 'Network error calling Bitbucket: ' + String(e),
                },
              }
            } finally {
              if (abortTimer !== null) clearTimeout(abortTimer)
            }
          }

          // Same status classification as the plugin: 401/403 auth, 404 not
          // found, 400/422 validation, 429 rate limited, everything else HTTP.
          async function classifyHttpError(response, endpoint) {
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            var code = 'HTTP'
            if (response.status === 401 || response.status === 403) code = 'AUTH'
            else if (response.status === 404) code = 'NOT_FOUND'
            else if (response.status === 400 || response.status === 422) code = 'VALIDATION'
            else if (response.status === 429) code = 'RATE_LIMITED'
            var detail = ''
            try {
              var parsed = JSON.parse(text)
              detail =
                (parsed && parsed.error && (parsed.error.message || parsed.error.detail)) ||
                (parsed && parsed.message) ||
                ''
            } catch (e) {}
            return {
              ok: false,
              error_code: code,
              status: response.status,
              message:
                'Bitbucket API error (' +
                response.status +
                '): ' +
                endpoint +
                ' — ' +
                (detail || text.slice(0, 512)),
            }
          }

          function unauthenticated() {
            return {
              ok: false,
              error_code: 'UNAUTHENTICATED',
              message: 'Not authenticated — please log in to Bitbucket.',
            }
          }

          async function api(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth) return unauthenticated()
            var url = buildUrl(endpoint, options.query)
            var headers = { Accept: 'application/json' }
            var fetchBody
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              fetchBody = JSON.stringify(options.body)
            }
            // Bitbucket requires a CSRF token for mutating requests when using
            // session cookies; it is the page's own csrftoken cookie.
            var method = options.method || 'GET'
            if (method !== 'GET') {
              var csrf = getCookie('csrftoken')
              if (csrf) headers['X-CSRFToken'] = csrf
            }
            var outcome = await bitbucketFetch(url, endpoint, {
              method: method,
              headers: headers,
              body: fetchBody,
            })
            if (outcome.error) {
              return { ok: false, error_code: outcome.error.error_code, message: outcome.error.message }
            }
            var response = outcome.response
            if (!response.ok) return await classifyHttpError(response, endpoint)
            if (response.status === 204) return { ok: true, data: {} }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'Bitbucket returned an unreadable body: ' + endpoint }
            }
            if (!text || !text.trim()) return { ok: true, data: {} }
            try {
              return { ok: true, data: JSON.parse(text) }
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'Bitbucket returned invalid JSON: ' + endpoint }
            }
          }

          // Variant that returns raw text (file content, diffs).
          async function apiRaw(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth) return unauthenticated()
            var url = buildUrl(endpoint, options.query)
            var outcome = await bitbucketFetch(url, endpoint, { method: options.method || 'GET' })
            if (outcome.error) {
              return { ok: false, error_code: outcome.error.error_code, message: outcome.error.message }
            }
            var response = outcome.response
            if (!response.ok) return await classifyHttpError(response, endpoint)
            try {
              return { ok: true, data: await response.text() }
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'Bitbucket returned an unreadable body: ' + endpoint }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapRepository(r) {
            r = r || {}
            return {
              uuid: r.uuid || '',
              slug: r.slug || '',
              full_name: r.full_name || '',
              name: r.name || r.slug || '',
              description: r.description || '',
              is_private: r.is_private === undefined ? false : !!r.is_private,
              scm: r.scm || '',
              language: r.language || '',
              default_branch: (r.mainbranch && r.mainbranch.name) || '',
              web_url: (r.links && r.links.html && r.links.html.href) || '',
              created_on: r.created_on || '',
              updated_on: r.updated_on || '',
            }
          }

          function mapPullRequest(pr) {
            pr = pr || {}
            return {
              id: pr.id || 0,
              title: pr.title || '',
              description: pr.description || '',
              state: pr.state || '',
              source_branch: (pr.source && pr.source.branch && pr.source.branch.name) || '',
              destination_branch: (pr.destination && pr.destination.branch && pr.destination.branch.name) || '',
              author: (pr.author && pr.author.display_name) || '',
              close_source_branch: pr.close_source_branch === undefined ? false : !!pr.close_source_branch,
              comment_count: pr.comment_count || 0,
              web_url: (pr.links && pr.links.html && pr.links.html.href) || '',
              created_on: pr.created_on || '',
              updated_on: pr.updated_on || '',
            }
          }

          function mapBranch(b) {
            b = b || {}
            var target = b.target || {}
            return {
              name: b.name || '',
              target_hash: target.hash || '',
              target_date: target.date || '',
              target_message: (target.message || '').replace(/\s+$/, ''),
              target_author: (target.author && target.author.raw) || '',
            }
          }

          function mapCommit(c) {
            c = c || {}
            return {
              hash: c.hash || '',
              message: (c.message || '').replace(/\s+$/, ''),
              author_raw: (c.author && c.author.raw) || '',
              date: c.date || '',
              web_url: (c.links && c.links.html && c.links.html.href) || '',
            }
          }

          function mapTag(t) {
            t = t || {}
            var target = t.target || {}
            return {
              name: t.name || '',
              target_hash: target.hash || '',
              target_date: target.date || '',
              message: (t.message || '').replace(/\s+$/, ''),
            }
          }

          function mapPipeline(p) {
            p = p || {}
            var state = p.state || {}
            var target = p.target || {}
            var commit = target.commit || {}
            return {
              uuid: p.uuid || '',
              build_number: p.build_number || 0,
              state_name: state.name || '',
              result_name: (state.result && state.result.name) || '',
              target_branch: target.ref_name || '',
              target_hash: commit.hash || '',
              creator: (p.creator && p.creator.display_name) || '',
              duration_seconds: p.duration_in_seconds || 0,
              created_on: p.created_on || '',
              completed_on: p.completed_on || '',
            }
          }

          function mapPipelineStep(s) {
            s = s || {}
            var state = s.state || {}
            return {
              uuid: s.uuid || '',
              name: s.name || '',
              state_name: state.name || '',
              result_name: (state.result && state.result.name) || '',
              duration_seconds: s.duration_in_seconds || 0,
              started_on: s.started_on || '',
              completed_on: s.completed_on || '',
            }
          }

          function mapComment(c) {
            c = c || {}
            return {
              id: c.id || 0,
              content: (c.content && c.content.raw) || '',
              author: (c.user && c.user.display_name) || '',
              created_on: c.created_on || '',
              updated_on: c.updated_on || '',
            }
          }

          function mapUser(u) {
            u = u || {}
            return {
              uuid: u.uuid || '',
              username: u.username || '',
              display_name: u.display_name || '',
              type: u.type || '',
              web_url: (u.links && u.links.html && u.links.html.href) || '',
            }
          }

          function mapWorkspace(w) {
            w = w || {}
            return {
              uuid: w.uuid || '',
              slug: w.slug || '',
              name: w.name || '',
              type: w.type || '',
            }
          }

          function mapMember(m) {
            m = m || {}
            var user = m.user || {}
            return {
              display_name: user.display_name || '',
              uuid: user.uuid || '',
              type: user.type || '',
              permission: m.permission || '',
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
            if (host !== 'bitbucket.org' && host.slice(-14) !== '.bitbucket.org')
              return error('UNSUPPORTED_PAGE', 'Not on a bitbucket.org page.')
            return null
          }

          var bitbucketToolImplementations = {
      async get_pull_request(args) {
        var pageError = assertPage()
        if (pageError) return pageError

        var res = await api('/repositories/' + args.workspace + '/' + args.repo_slug + '/pullrequests/' + args.pull_request_id)
        if (!res.ok) return error(res.error_code, res.message)
        return ok(mapPullRequest(res.data || {}))
      },
          }

          async function stdin_default(args) {
            return bitbucketToolImplementations['get_pull_request'](args)
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
            'The Bitbucket tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Bitbucket API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Bitbucket tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
