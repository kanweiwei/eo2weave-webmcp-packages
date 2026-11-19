// Self-contained adapter workflow. The Jira page context and every
// /rest/api/3 fetch stay inside the *.atlassian.net tab.
//
// Ported from the OpenTabs jira plugin (plugins/jira/src, MIT): same endpoints,
// same ADF bodies, same error classification. Upstream caches the account/cloud
// ids in the extension auth cache; here they are re-read from the page meta tags
// on every call, which is fresher and needs no storage.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "issue_key": {
        "type": "string",
        "description": "Issue key (e.g. \"KAN-1\") or issue ID"
      }
    },
    "required": [
      "issue_key"
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
    description: 'get_issue',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Jira Cloud runtime (translated from OpenTabs jira-api.ts
          // and tools/schemas.ts, MIT). Runs INSIDE the *.atlassian.net tab: the
          // account/cloud ids come from the page's own meta tags, and every call
          // is a same-origin /rest/api/3 (or /rest/agile/1.0) fetch carrying the
          // browser session cookie — no token ever leaves the page.
          var AGILE_BASE = '/rest/agile/1.0'

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

          // Jira Cloud stamps the session identity onto every page as meta tags.
          // Re-read them on every call, never cache: switching accounts in a live
          // tab must not keep using the previous account's ids.
          function getAuth() {
            var accountId = getMetaContent('ajs-atlassian-account-id')
            var cloudId = getMetaContent('ajs-cloud-id')
            if (!accountId || !cloudId) return null
            return { accountId: accountId, cloudId: cloudId }
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

          // Faithful translation of the plugin's api(): relative REST paths, JSON
          // bodies only, the page cookie, and the same error classification
          // (401/403 auth, 404 not found, 400 validation, 429 rate limited).
          async function jiraApi(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to Jira.',
              }
            var base = options.basePath || '/rest/api/3'
            var url = base + endpoint
            if (options.query) {
              var qs = buildQueryString(options.query)
              if (qs) url += '?' + qs
            }
            var headers = {}
            var fetchBody
            if (options.rawBody !== undefined) {
              headers['Content-Type'] = 'application/json'
              fetchBody = options.rawBody
            } else if (options.body) {
              headers['Content-Type'] = 'application/json'
              fetchBody = JSON.stringify(options.body)
            }
            // Abort the in-page fetch before the 25s browser command deadline can
            // orphan it. Upstream uses AbortSignal.timeout(30s); 20s keeps the
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
                  }, 20000)
                : null
            var response
            try {
              response = await fetch(url, {
                method: options.method || 'GET',
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
                  ? 'Jira request aborted after the 20s in-page deadline: ' + endpoint
                  : 'Network error calling Jira: ' + String(e),
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
                if (parsed.errorMessages && parsed.errorMessages.length)
                  detail = parsed.errorMessages.join('; ')
                else detail = parsed.message || parsed.error || ''
              } catch (e) {}
              var errorCode = 'HTTP'
              if (response.status === 401 || response.status === 403) errorCode = 'AUTH'
              else if (response.status === 404) errorCode = 'NOT_FOUND'
              else if (response.status === 400) errorCode = 'VALIDATION'
              else if (response.status === 429) errorCode = 'RATE_LIMITED'
              return {
                ok: false,
                error_code: errorCode,
                status: response.status,
                message:
                  'Jira API error (' +
                  response.status +
                  '): ' +
                  endpoint +
                  ' — ' +
                  (detail || text.slice(0, 512)),
              }
            }
            try {
              var data = await response.json()
              if (abortTimer !== null) clearTimeout(abortTimer)
              return { ok: true, data: data }
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'Jira returned invalid JSON: ' + endpoint,
              }
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          var ISSUE_FIELDS = [
            'summary',
            'status',
            'assignee',
            'priority',
            'issuetype',
            'created',
            'updated',
            'project',
            'description',
            'labels',
            'reporter',
          ]

          // Jira stores rich text as Atlassian Document Format.
          function buildAdfText(text) {
            return {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: text }] }],
            }
          }

          function extractText(doc) {
            if (!doc || !doc.content) return ''
            return doc.content
              .map(function (block) {
                return (block.content || [])
                  .map(function (inline) {
                    return inline.text || ''
                  })
                  .join('')
              })
              .join('\n')
          }

          function mapIssue(issue) {
            issue = issue || {}
            var fields = issue.fields || {}
            var status = fields.status || {}
            var statusCategory = status.statusCategory || {}
            var assignee = fields.assignee || {}
            var reporter = fields.reporter || {}
            var project = fields.project || {}
            var issueType = fields.issuetype || {}
            var priority = fields.priority || {}
            return {
              id: issue.id || '',
              key: issue.key || '',
              summary: fields.summary || '',
              status: status.name || '',
              status_category: statusCategory.name || '',
              issue_type: issueType.name || '',
              priority: priority.name || '',
              assignee_id: assignee.accountId === undefined ? undefined : assignee.accountId,
              assignee_name: assignee.displayName === undefined ? undefined : assignee.displayName,
              reporter_id: reporter.accountId === undefined ? undefined : reporter.accountId,
              reporter_name: reporter.displayName === undefined ? undefined : reporter.displayName,
              project_key: project.key || '',
              project_name: project.name || '',
              labels: fields.labels || [],
              created: fields.created || '',
              updated: fields.updated || '',
              description_text: extractText(fields.description),
            }
          }

          function mapProject(p) {
            p = p || {}
            return {
              id: p.id || '',
              key: p.key || '',
              name: p.name || '',
              project_type: p.projectTypeKey || '',
              style: p.simplified ? 'next-gen' : p.style || 'classic',
            }
          }

          function mapComment(c) {
            c = c || {}
            var author = c.author || {}
            return {
              id: c.id || '',
              author_id: author.accountId || '',
              author_name: author.displayName || '',
              body_text: extractText(c.body),
              created: c.created || '',
              updated: c.updated || '',
            }
          }

          function mapTransition(t) {
            t = t || {}
            var to = t.to || {}
            var statusCategory = to.statusCategory || {}
            return {
              id: t.id || '',
              name: t.name || '',
              to_status: to.name || '',
              to_status_category: statusCategory.name || '',
            }
          }

          function mapUser(u) {
            u = u || {}
            return {
              account_id: u.accountId || '',
              display_name: u.displayName || '',
              email: u.emailAddress || '',
              active: u.active === undefined ? true : !!u.active,
              account_type: u.accountType || '',
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
            if (host === 'atlassian.net' || host.slice(-14) !== '.atlassian.net')
              return error('UNSUPPORTED_PAGE', 'Not on a Jira Cloud (*.atlassian.net) page.')
            if ((location.pathname || '').indexOf('/wiki/') === 0)
              return error('UNSUPPORTED_PAGE', 'This is a Confluence page, not Jira.')
            return null
          }

          var jiraToolImplementations = {
      async get_issue(args) {
        var pageError = assertPage()
        if (pageError) return pageError
        var res = await jiraApi('/issue/' + encodeURIComponent(args.issue_key), {
          query: { fields: ISSUE_FIELDS.join(',') },
        })
        if (!res.ok) return error(res.error_code, res.message)
        return ok({ issue: mapIssue(res.data || {}) })
      },
          }

          async function stdin_default(args) {
            return jiraToolImplementations['get_issue'](args)
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
            'The Jira tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Jira API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Jira tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
