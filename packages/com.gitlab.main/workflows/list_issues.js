// Self-contained adapter workflow. The GitLab page context and every /api/v4
// fetch stay inside the GitLab tab: the session identity comes from the page's
// own `gon` global, the CSRF token from <meta name="csrf-token">, and the API
// base from gon.gitlab_url (gitlab.com or your self-hosted instance).
//
// Ported from the OpenTabs gitlab plugin (plugins/gitlab/src, MIT): same
// endpoint for list_issues, same body, same error classification.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "project": {
        "type": "string",
        "minLength": 1,
        "description": "Project path (e.g., \"group/project\") or numeric project ID"
      },
      "state": {
        "description": "Issue state filter (default: opened)",
        "type": "string",
        "enum": [
          "opened",
          "closed",
          "all"
        ]
      },
      "labels": {
        "description": "Comma-separated list of label names to filter by",
        "type": "string"
      },
      "assignee_username": {
        "description": "Filter by assignee username",
        "type": "string"
      },
      "milestone": {
        "description": "Milestone title to filter by, or \"None\" / \"Any\"",
        "type": "string"
      },
      "search": {
        "description": "Search in title and description",
        "type": "string"
      },
      "order_by": {
        "description": "Sort field (default: created_at)",
        "type": "string",
        "enum": [
          "created_at",
          "updated_at"
        ]
      },
      "sort": {
        "description": "Sort direction (default: desc)",
        "type": "string",
        "enum": [
          "asc",
          "desc"
        ]
      },
      "per_page": {
        "description": "Results per page (default 20, max 100)",
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "page": {
        "description": "Page number (default 1)",
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      }
    },
    "required": [
      "project"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "issues": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "iid": {
              "type": "number",
              "description": "Issue IID (project-scoped ID)"
            },
            "title": {
              "type": "string",
              "description": "Issue title"
            },
            "state": {
              "type": "string",
              "description": "Issue state: opened or closed"
            },
            "description": {
              "type": "string",
              "description": "Issue description in Markdown"
            },
            "web_url": {
              "type": "string",
              "description": "URL to the issue on GitLab"
            },
            "author_username": {
              "type": "string",
              "description": "Username of the author"
            },
            "labels": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Label names"
            },
            "assignees": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Assignee usernames"
            },
            "milestone_title": {
              "type": "string",
              "description": "Milestone title or empty string"
            },
            "confidential": {
              "type": "boolean",
              "description": "Whether the issue is confidential"
            },
            "created_at": {
              "type": "string",
              "description": "Created ISO 8601 timestamp"
            },
            "updated_at": {
              "type": "string",
              "description": "Updated ISO 8601 timestamp"
            },
            "closed_at": {
              "type": "string",
              "description": "Closed ISO 8601 timestamp or empty string"
            }
          },
          "required": [
            "iid",
            "title",
            "state",
            "description",
            "web_url",
            "author_username",
            "labels",
            "assignees",
            "milestone_title",
            "confidential",
            "created_at",
            "updated_at",
            "closed_at"
          ],
          "additionalProperties": false
        },
        "description": "List of issues"
      }
    },
    "required": [
      "issues"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_issues',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // Page-side GitLab runtime (translated from OpenTabs plugins/gitlab/src/gitlab-api.ts
          // and src/tools/schemas.ts, MIT). Runs INSIDE the GitLab tab: the session
          // identity comes from the page's own `gon` global, the CSRF token from the
          // page's <meta name="csrf-token">, and every call is a same-origin /api/v4
          // fetch carrying the browser session cookie — no token ever leaves the page.

          function pick(value, fallback) {
            return value === undefined || value === null ? fallback : value
          }

          function getPageGlobal(path) {
            var parts = String(path).split('.')
            var cursor = null
            try {
              cursor = typeof window !== 'undefined' ? window : null
            } catch (e) {
              cursor = null
            }
            for (var i = 0; i < parts.length; i++) {
              if (cursor === null || cursor === undefined) return null
              cursor = cursor[parts[i]]
            }
            return cursor === undefined ? null : cursor
          }

          function getGon() {
            var gon = getPageGlobal('gon')
            return gon && typeof gon === 'object' ? gon : null
          }

          // GitLab's Rails app publishes the logged-in account on window.gon
          // (gon.current_username). A missing/empty value means logged out — the same
          // signal OpenTabs' getAuth() reads.
          function getAuth() {
            var username = getPageGlobal('gon.current_username')
            if (typeof username !== 'string' || !username) return null
            return { username: username }
          }

          function getUsername() {
            var auth = getAuth()
            return auth ? auth.username : null
          }

          function getMetaContent(name) {
            try {
              var el = document.querySelector('meta[name="' + name + '"]')
              if (!el) return null
              var value = typeof el.getAttribute === 'function' ? el.getAttribute('content') : null
              if (value === null || value === undefined) value = el.value
              if (typeof value !== 'string') return null
              value = value.trim()
              return value ? value : null
            } catch (e) {
              return null
            }
          }

          // The page's own anti-CSRF token. Rails renders it as <meta name="csrf-token">
          // and, on HTML forms, as a hidden input[name="authenticity_token"].
          function getCsrfToken() {
            var token = getMetaContent('csrf-token')
            if (token) return token
            try {
              var input = document.querySelector('input[name="authenticity_token"]')
              if (input) {
                var value = input.value
                if (!value && typeof input.getAttribute === 'function') value = input.getAttribute('value')
                if (typeof value === 'string' && value.trim()) return value.trim()
              }
            } catch (e) {}
            return null
          }

          function isGitlabHost(host) {
            if (!host) return false
            if (host === 'gitlab.com') return true
            if (host.indexOf('gitlab.') === 0) return true
            return host.indexOf('.gitlab.') !== -1
          }

          function assertPage() {
            var host = location.hostname || ''
            if (!host) return error('UNSUPPORTED_PAGE', 'Not on a GitLab page.')
            if (isGitlabHost(host)) return null
            // A self-hosted instance can live on any host: its own gon.gitlab_url says so.
            var gon = getGon()
            if (gon && typeof gon.gitlab_url === 'string' && gon.gitlab_url) {
              var match = /^https?:\/\/([^/]+)/.exec(gon.gitlab_url)
              if (match && match[1].split(':')[0] === host) return null
            }
            return error('UNSUPPORTED_PAGE', 'Not on a GitLab page.')
          }

          // OpenTabs resolves the API base from its instanceUrl config and otherwise
          // hardcodes https://gitlab.com/api/v4. Here the same value comes from the page
          // GitLab itself renders: gon.gitlab_url (the instance URL), its
          // relative_url_root for subpath installs, and location.origin as the fallback.
          function getApiBase() {
            var gon = getGon() || {}
            var root
            if (typeof gon.gitlab_url === 'string' && gon.gitlab_url) {
              root = gon.gitlab_url.replace(/\/+$/, '')
            } else {
              root = String(location.origin || '').replace(/\/+$/, '')
            }
            var relative = ''
            if (typeof gon.relative_url_root === 'string' && gon.relative_url_root) {
              relative = gon.relative_url_root.replace(/\/+$/, '')
            }
            return root + relative + '/api/v4'
          }

          function buildUrl(endpoint, query) {
            var url = getApiBase() + endpoint
            if (query) {
              var params = new URLSearchParams()
              var keys = Object.keys(query)
              for (var i = 0; i < keys.length; i++) {
                var value = query[keys[i]]
                if (value !== undefined) params.append(keys[i], String(value))
              }
              var qs = params.toString()
              if (qs) url += '?' + qs
            }
            return url
          }

          // Upstream's ToolError codes, mapped onto the adapter's error_code vocabulary.
          function classifyStatus(status) {
            if (status === 429) return 'RATE_LIMITED'
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 422) return 'VALIDATION'
            return 'HTTP'
          }

          function describeHttpError(response, endpoint, body) {
            var detail = body || ''
            var code = classifyStatus(response.status)
            var prefix
            if (code === 'RATE_LIMITED') {
              prefix = 'Rate limited: ' + endpoint
              var retryAfter = null
              try {
                retryAfter = response.headers && response.headers.get ? response.headers.get('Retry-After') : null
              } catch (e) {
                retryAfter = null
              }
              if (retryAfter !== null && retryAfter !== undefined && String(retryAfter).trim() !== '') {
                prefix += ' (retry after ' + String(retryAfter).trim() + ')'
              }
              return prefix + (detail ? ' — ' + detail : '')
            }
            if (code === 'AUTH') return 'Auth error (' + response.status + '): ' + detail
            if (code === 'NOT_FOUND') return 'Not found: ' + endpoint + (detail ? ' — ' + detail : '')
            if (code === 'VALIDATION') return 'Validation error: ' + endpoint + (detail ? ' — ' + detail : '')
            return 'API error (' + response.status + '): ' + endpoint + (detail ? ' — ' + detail : '')
          }

          function errorCodeForMessage(status) {
            return classifyStatus(status)
          }

          // One same-origin fetch: the page's cookie, JSON in, JSON (or raw text) out,
          // aborted after 18s so it always settles inside the adapter's 25s window.
          // Upstream uses AbortSignal.timeout(30_000); the shorter deadline keeps the
          // in-page request from being orphaned by the browser command timeout.
          async function request(url, endpoint, init) {
            init = init || {}
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {
                controller = null
              }
            }
            var timer = null
            if (controller) {
              timer = setTimeout(function () {
                try {
                  controller.abort()
                } catch (e) {}
              }, 18000)
            }
            var response
            try {
              response = await fetch(url, {
                method: init.method || 'GET',
                headers: init.headers || {},
                body: init.body,
                credentials: 'include',
                signal: controller ? controller.signal : undefined,
              })
            } catch (err) {
              if (timer !== null) clearTimeout(timer)
              var aborted =
                err && (err.name === 'AbortError' || err.name === 'TimeoutError' || String(err).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'GitLab request aborted after the 18s in-page deadline: ' + endpoint
                  : 'Network error calling GitLab: ' + String(err),
              }
            }
            if (timer !== null) clearTimeout(timer)
            // GitLab answers several writes with an empty body.
            if (response.status === 204) return { ok: true, data: {} }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              return {
                ok: false,
                error_code: errorCodeForMessage(response.status),
                status: response.status,
                message: describeHttpError(response, endpoint, String(text).substring(0, 512)),
              }
            }
            if (init.raw) {
              try {
                return { ok: true, data: await response.text() }
              } catch (e) {
                return { ok: false, error_code: 'HTTP', message: 'GitLab returned an unreadable body: ' + endpoint }
              }
            }
            try {
              return { ok: true, data: await response.json() }
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'GitLab returned invalid JSON: ' + endpoint }
            }
          }

          // Faithful translation of OpenTabs api(): auth gate, Accept: application/json,
          // JSON body, and the page CSRF token on every non-GET request.
          async function api(endpoint, options) {
            options = options || {}
            if (!getAuth())
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to GitLab.',
              }
            var url = buildUrl(endpoint, options.query)
            var headers = { Accept: 'application/json' }
            var body
            if (options.body) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(options.body)
            }
            var method = options.method || 'GET'
            if (method !== 'GET') {
              var csrf = getCsrfToken()
              if (csrf) headers['X-CSRF-Token'] = csrf
            }
            return request(url, endpoint, { method: method, headers: headers, body: body })
          }

          // Same path, raw text response (job traces, etc.).
          async function apiRaw(endpoint, options) {
            options = options || {}
            if (!getAuth())
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to GitLab.',
              }
            var url = buildUrl(endpoint, options.query)
            var headers = { Accept: 'application/json' }
            var method = options.method || 'GET'
            if (method !== 'GET') {
              var csrf = getCsrfToken()
              if (csrf) headers['X-CSRF-Token'] = csrf
            }
            return request(url, endpoint, { method: method, headers: headers, raw: true })
          }

          // --- mappers (OpenTabs src/tools/schemas.ts) ---

          function mapProject(p) {
            p = p || {}
            return {
              id: pick(p.id, 0),
              name: pick(p.name, ''),
              path_with_namespace: pick(p.path_with_namespace, ''),
              description: pick(p.description, ''),
              visibility: pick(p.visibility, ''),
              web_url: pick(p.web_url, ''),
              default_branch: pick(p.default_branch, ''),
              star_count: pick(p.star_count, 0),
              forks_count: pick(p.forks_count, 0),
              open_issues_count: pick(p.open_issues_count, 0),
              archived: pick(p.archived, false),
              created_at: pick(p.created_at, ''),
              last_activity_at: pick(p.last_activity_at, ''),
            }
          }

          function mapIssue(i) {
            i = i || {}
            var author = i.author || {}
            var milestone = i.milestone || {}
            var assignees = pick(i.assignees, [])
            var names = []
            for (var index = 0; index < assignees.length; index++) {
              var assignee = assignees[index]
              names.push(pick(assignee ? assignee.username : undefined, ''))
            }
            return {
              iid: pick(i.iid, 0),
              title: pick(i.title, ''),
              state: pick(i.state, ''),
              description: pick(i.description, ''),
              web_url: pick(i.web_url, ''),
              author_username: pick(author.username, ''),
              labels: pick(i.labels, []),
              assignees: names,
              milestone_title: pick(milestone.title, ''),
              confidential: pick(i.confidential, false),
              created_at: pick(i.created_at, ''),
              updated_at: pick(i.updated_at, ''),
              closed_at: pick(i.closed_at, ''),
            }
          }

          function mapMergeRequest(mr) {
            mr = mr || {}
            var author = mr.author || {}
            var mergedBy = mr.merged_by || {}
            return {
              iid: pick(mr.iid, 0),
              title: pick(mr.title, ''),
              state: pick(mr.state, ''),
              description: pick(mr.description, ''),
              web_url: pick(mr.web_url, ''),
              author_username: pick(author.username, ''),
              source_branch: pick(mr.source_branch, ''),
              target_branch: pick(mr.target_branch, ''),
              labels: pick(mr.labels, []),
              draft: pick(mr.draft, false),
              merged_by_username: pick(mergedBy.username, ''),
              merge_status: pick(mr.merge_status, ''),
              has_conflicts: pick(mr.has_conflicts, false),
              created_at: pick(mr.created_at, ''),
              updated_at: pick(mr.updated_at, ''),
            }
          }

          function mapNote(n) {
            n = n || {}
            var author = n.author || {}
            return {
              id: pick(n.id, 0),
              body: pick(n.body, ''),
              author_username: pick(author.username, ''),
              system: pick(n.system, false),
              created_at: pick(n.created_at, ''),
              updated_at: pick(n.updated_at, ''),
            }
          }

          function mapUser(u) {
            u = u || {}
            return {
              id: pick(u.id, 0),
              username: pick(u.username, ''),
              name: pick(u.name, ''),
              state: pick(u.state, ''),
              avatar_url: pick(u.avatar_url, ''),
              web_url: pick(u.web_url, ''),
              bio: pick(u.bio, ''),
              location: pick(u.location, ''),
              public_email: pick(u.public_email, ''),
            }
          }

          function mapBranch(b) {
            b = b || {}
            var commit = b.commit || {}
            return {
              name: pick(b.name, ''),
              protected: pick(b.protected, false),
              default: pick(b.default, false),
              sha: pick(commit.id, ''),
              web_url: pick(b.web_url, ''),
            }
          }

          function mapPipeline(p) {
            p = p || {}
            return {
              id: pick(p.id, 0),
              iid: pick(p.iid, 0),
              status: pick(p.status, ''),
              ref: pick(p.ref, ''),
              sha: pick(p.sha, ''),
              source: pick(p.source, ''),
              web_url: pick(p.web_url, ''),
              created_at: pick(p.created_at, ''),
              updated_at: pick(p.updated_at, ''),
            }
          }

          function mapJob(j) {
            j = j || {}
            return {
              id: pick(j.id, 0),
              name: pick(j.name, ''),
              stage: pick(j.stage, ''),
              status: pick(j.status, ''),
              ref: pick(j.ref, ''),
              web_url: pick(j.web_url, ''),
              duration: pick(j.duration, 0),
              created_at: pick(j.created_at, ''),
              finished_at: pick(j.finished_at, ''),
            }
          }

          function mapCommit(c) {
            c = c || {}
            return {
              id: pick(c.id, ''),
              short_id: pick(c.short_id, ''),
              title: pick(c.title, ''),
              message: pick(c.message, ''),
              author_name: pick(c.author_name, ''),
              author_email: pick(c.author_email, ''),
              authored_date: pick(c.authored_date, ''),
              web_url: pick(c.web_url, ''),
            }
          }

          function listOf(data) {
            return Array.isArray(data) ? data : []
          }

          function encodeProject(project) {
            return encodeURIComponent(project)
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }

          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }
          var gitlabToolImplementations = {
            async list_issues(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var query = {
                state: args.state === undefined ? 'opened' : args.state,
                per_page: args.per_page === undefined ? 20 : args.per_page,
                page: args.page,
                order_by: args.order_by,
                sort: args.sort,
              }
              if (args.labels) query.labels = args.labels
              if (args.assignee_username) query.assignee_username = args.assignee_username
              if (args.milestone) query.milestone = args.milestone
              if (args.search) query.search = args.search
              var res = await api('/projects/' + encodeProject(args.project) + '/issues', { query: query })
              if (!res.ok) return error(res.error_code, res.message)
              return ok({ issues: listOf(res.data).map(mapIssue) })
            }
          }
          async function stdin_default(args) {
            return gitlabToolImplementations['list_issues'](args)
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
            'The GitLab tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'GitLab API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The GitLab tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
