// Self-contained adapter workflow. The npm session context and every
// x-spiferack fetch stay inside the www.npmjs.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Organization name (e.g., \"babel\")"
      },
      "page": {
        "type": "integer",
        "minimum": 0,
        "description": "Page number for packages pagination (default 0)"
      }
    },
    "required": [
      "name"
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
    description: 'get_organization',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side npm runtime (translated from OpenTabs npm-api.ts and
          // tools/schemas.ts, MIT). Runs INSIDE the www.npmjs.com tab: the session
          // context (username + csrf token) never leaves page context, and every
          // registry call is a same-origin x-spiferack fetch with credentials.
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
          function getAuth() {
            // Re-read the page context on every call, never cache it: a user who
            // switches accounts in a still-loaded tab must not keep sending requests
            // with the previous account's csrf token.
            var username = getPageGlobal('__context__.context.user.name')
            var csrftoken = getPageGlobal('__context__.context.csrftoken')
            if (!username || !csrftoken) return null
            return { username: username, csrftoken: csrftoken }
          }
          function getUsername() {
            var auth = getAuth()
            return auth ? auth.username : null
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
          // The npmjs.com website returns JSON for any page when the x-spiferack
          // header is set. Mutation requests additionally need the page csrf token.
          async function spiferack(path, options) {
            options = options || {}
            var method = options.method || 'GET'
            var headers = { 'x-spiferack': '1' }
            if (method !== 'GET') {
              var auth = getAuth()
              if (!auth)
                return {
                  ok: false,
                  error_code: 'UNAUTHENTICATED',
                  message: 'Not authenticated — please log in to npm.',
                }
              headers['x-csrf-token'] = auth.csrftoken
            }
            var body
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(options.body)
            }
            var url = location.origin + path
            if (options.query) {
              var qs = buildQueryString(options.query)
              if (qs) url += '?' + qs
            }
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
            var response
            try {
              response = await fetch(url, {
                method: method,
                headers: headers,
                body: body,
                credentials: 'include',
                signal: abortController ? abortController.signal : undefined,
              })
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: 'NETWORK',
                message: aborted
                  ? 'npm registry request aborted after the 18s in-page deadline.'
                  : 'Network error calling the npm registry: ' + String(e),
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
                detail = parsed.error || parsed.message || parsed.reason || ''
              } catch (e) {}
              var errorCode = 'HTTP'
              if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
              else if (response.status === 404) errorCode = 'NOT_FOUND'
              else if (response.status === 429) errorCode = 'RATE_LIMITED'
              return {
                ok: false,
                error_code: errorCode,
                status: response.status,
                message:
                  'npm registry error (' +
                  response.status +
                  '): ' +
                  (detail || text.slice(0, 512)),
              }
            }
            try {
              var data = await response.json()
              if (abortTimer !== null) clearTimeout(abortTimer)
              return { ok: true, data: data }
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var abortedBody =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (abortedBody)
                return {
                  ok: false,
                  error_code: 'NETWORK',
                  message: 'npm registry response aborted after the 18s in-page deadline.',
                }
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'npm registry returned invalid JSON',
              }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapMaintainer(m) {
            return { name: (m && m.name) || '' }
          }
          function extractSearchDate(d) {
            if (!d) return ''
            if (typeof d === 'string') return d
            return d.rel || ''
          }
          function extractSearchMaintainers(m) {
            if (!m) return []
            var out = []
            for (var i = 0; i < m.length; i++) {
              var item = m[i]
              out.push(
                typeof item === 'string'
                  ? item
                  : (item && (item.username || item.name)) || '',
              )
            }
            return out
          }
          function extractUrl(v) {
            if (!v) return ''
            if (typeof v === 'string') return v
            return v.url || ''
          }
          function mapSearchPackage(o) {
            o = o || {}
            // Handles both the spiferack (flat) and the registry API (nested) shapes.
            var pkg = o.package
            var name = o.name || (pkg && pkg.name) || ''
            var maintainers = extractSearchMaintainers(o.maintainers)
            var publisher =
              (o.publisher && (o.publisher.name || o.publisher.username)) ||
              (pkg && pkg.publisher && pkg.publisher.username) ||
              ''
            var links = o.links || {}
            var pkgLinks = (pkg && pkg.links) || {}
            var score = o.score || {}
            var detail = score.detail || {}
            return {
              name: name,
              version: o.version || (pkg && pkg.version) || '',
              description: o.description || (pkg && pkg.description) || '',
              keywords: o.keywords || (pkg && pkg.keywords) || [],
              date: extractSearchDate(o.date) || (pkg && pkg.date) || '',
              publisher: publisher,
              maintainers:
                maintainers.length > 0
                  ? maintainers
                  : ((pkg && pkg.maintainers) || []).map(function (m) {
                      return (m && m.username) || ''
                    }),
              npm_url:
                links.npm ||
                pkgLinks.npm ||
                (name ? 'https://www.npmjs.com/package/' + name : ''),
              homepage: o.homepage || links.homepage || pkgLinks.homepage || '',
              repository:
                extractUrl(o.repository) || links.repository || pkgLinks.repository || '',
              bugs: extractUrl(o.bugs) || links.bugs || pkgLinks.bugs || '',
              score_final: score.final || 0,
              score_quality: detail.quality || 0,
              score_popularity: detail.popularity || 0,
              score_maintenance: detail.maintenance || 0,
              search_score: o.searchScore || 0,
            }
          }
          function mapPackage(p) {
            p = p || {}
            var pv = p.packageVersion || {}
            var capsule = p.capsule || {}
            var types = (capsule.types && capsule.types.typescript) || {}
            var lastPublish = capsule.lastPublish || {}
            var repository = pv.repository
            var repositoryUrl =
              typeof repository === 'string' ? repository : (repository && repository.url) || ''
            return {
              name: pv.name || capsule.name || '',
              version: pv.version || '',
              description: pv.description || capsule.description || '',
              license: pv.license || '',
              homepage: pv.homepage || '',
              repository_url: repositoryUrl,
              bugs_url: '',
              keywords: pv.keywords || [],
              author_name: (pv.author && pv.author.name) || '',
              maintainers: (pv.maintainers || []).map(mapMaintainer),
              dist_tags:
                capsule['dist-tags'] || (p.packument && p.packument['dist-tags']) || {},
              last_publish_time: lastPublish.time || '',
              last_publish_maintainer: lastPublish.maintainer || '',
              typescript_support: types.bundled ? 'bundled' : types.package || '',
              is_starred: p.isStarred === undefined ? false : !!p.isStarred,
              dependents_count:
                (p.dependents && p.dependents.dependentsCount) === undefined
                  ? '0'
                  : p.dependents.dependentsCount,
              funding_url: (pv.funding && pv.funding.url) || '',
              has_provenance:
                p.provenance && p.provenance.enabled !== undefined
                  ? !!p.provenance.enabled
                  : false,
            }
          }
          function mapDownloadStat(d) {
            d = d || {}
            return {
              downloads: typeof d.downloads === 'number' ? d.downloads : 0,
              label: d.label || '',
            }
          }
          function mapDependencies(deps) {
            if (!deps) return []
            var out = []
            var keys = Object.keys(deps)
            for (var i = 0; i < keys.length; i++)
              out.push({ name: keys[i], version: String(deps[keys[i]]) })
            return out
          }
          function mapUserProfile(p) {
            p = p || {}
            var scope = p.scope || {}
            var parent = scope.parent || {}
            var avatars = parent.avatars || {}
            return {
              name: parent.name || scope.name || '',
              avatar_url: avatars.large || '',
              packages_count:
                typeof (p.packages && p.packages.total) === 'number'
                  ? p.packages.total
                  : 0,
              orgs: ((p.orgs && p.orgs.objects) || []).map(function (o) {
                return (o && o.name) || ''
              }),
            }
          }
          function mapUserPackage(p) {
            p = p || {}
            return {
              name: p.name || '',
              version: p.version || '',
              description: p.description || '',
              date: (p.date && p.date.rel) || '',
            }
          }
          function mapOrganization(p) {
            p = p || {}
            var scope = p.scope || {}
            var parent = scope.parent || {}
            return {
              name: parent.name || '',
              description: parent.description || '',
              created: parent.created || '',
              packages_count:
                typeof (p.packages && p.packages.total) === 'number'
                  ? p.packages.total
                  : 0,
              tfa_enforced: parent.tfa_enforced === undefined ? false : !!parent.tfa_enforced,
            }
          }
          function mapToken(t) {
            t = t || {}
            return {
              token: t.token || '',
              readonly: t.readonly === undefined ? false : !!t.readonly,
              created: t.created || '',
              updated: t.updated || '',
            }
          }
          function extractReadme(readme) {
            if (!readme) return ''
            if (typeof readme === 'string') return readme
            return readme.data || ''
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
            if (location.hostname !== 'www.npmjs.com')
              return error('UNSUPPORTED_PAGE', 'Not on a www.npmjs.com page.')
            return null
          }
          function requireUsername() {
            var username = getUsername()
            if (!username) return null
            return username
          }

          var npmToolImplementations = {
      async get_organization(args) {
        var pageError = assertPage()
        if (pageError) return pageError
        var page = args.page === undefined ? 0 : args.page
        var response = await spiferack('/org/' + args.name, {
          query: { page: page },
        })
        if (!response.ok) return response
        var data = response.data || {}
        var packages = data.packages || {}
        return ok({
          organization: mapOrganization(data),
          packages: (packages.objects || []).map(mapUserPackage),
        })
      },
          }

          async function stdin_default(args) {
            return npmToolImplementations['get_organization'](args)
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
            'The www.npmjs.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'npm registry call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The www.npmjs.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
