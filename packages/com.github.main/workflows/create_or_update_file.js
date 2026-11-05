// Self-contained adapter workflow. Authenticates through the github.com web session (meta[user-login] + CSRF token); all page interaction stays inside the tab.

export default {
  inputSchema: {
      "type": "object",
      "properties": {
          "owner": {
              "type": "string",
              "description": "Repository owner (user or org)",
              "minLength": 1
          },
          "repo": {
              "type": "string",
              "description": "Repository name",
              "minLength": 1
          },
          "path": {
              "type": "string",
              "description": "File path relative to repository root",
              "minLength": 1
          },
          "content": {
              "type": "string",
              "description": "File content as a UTF-8 string",
              "minLength": 1
          },
          "message": {
              "type": "string",
              "description": "Commit message",
              "minLength": 1
          },
          "branch": {
              "type": "string",
              "description": "Branch to commit to (defaults to the default branch)"
          }
      },
      "required": [
          "owner",
          "repo",
          "path",
          "content",
          "message"
      ],
      "additionalProperties": false
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
      },
      data: {
        type: ['object', 'null'],
      },
      message: {
        type: ['string', 'null'],
      },
      error_code: {
        type: ['string', 'null'],
      },
    },
    required: ['status', 'data'],
    additionalProperties: false,
  },
  tree: {
    type: 'action',
    description: 'create_or_update_file',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      // Absolute deadline (epoch ms) for the WHOLE command, computed on the
      // adapter side before the eval is dispatched: the browser's 25s
      // timeout includes the tab-command queue wait, so the in-page fetch
      // must never outlive this instant (finding: an eval that starts late
      // could otherwise arm a full fresh deadline and complete after the
      // caller already received TAB_UNAVAILABLE).
      const commandDeadlineMs = Date.now() + options.timeout
      const execute = async (args) => {
        var workflow = (() => {


          // Page-side GitHub runtime (translated from OpenTabs github-api.ts, MIT).
          // Runs INSIDE the github.com tab: the web session and CSRF token never
          // leave page context.
          function requireLogin() {
            var meta = document.querySelector('meta[name="user-login"]')
            var login = meta ? meta.getAttribute('content') : null
            if (!login) return null
            return login
          }
          function getCsrfToken() {
            var graphqlInput = document.querySelector('form[action*="graphql"] input[name="authenticity_token"]')
            if (graphqlInput && graphqlInput.value) return graphqlInput.value
            var anyInput = document.querySelector('input[name="authenticity_token"]')
            return anyInput ? anyInput.value : null
          }
          var queryIdCache = {}
          var mutationsDiscovered = false
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

          // One absolute in-page deadline per request. The browser's 25s command
          // timeout includes the tab-command queue wait, so the fetch must never
          // outlive the command deadline: a request that outlives it could apply
          // a write after the caller already received TAB_UNAVAILABLE.
          var IN_PAGE_DEADLINE_MS = 18000
          function remainingBudgetMs() {
            var remaining = IN_PAGE_DEADLINE_MS
            try {
              var commandDeadline = args && args.__eo2CommandDeadlineMs
              if (typeof commandDeadline === 'number' && commandDeadline > 0) {
                var commandRemaining = commandDeadline - Date.now()
                if (commandRemaining < remaining) remaining = commandRemaining
              }
            } catch (e) {}
            return remaining
          }
          async function boundedFetch(url, init) {
            var remaining = remainingBudgetMs()
            if (remaining <= 0)
              return {
                ok: false,
                status: 0,
                text: '',
                error_code: 'NETWORK',
                message:
                  'Request not sent: the browser command deadline expired before the page eval started.',
              }
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var abortTimer =
              abortController !== null
                ? setTimeout(
                    function () {
                      try {
                        abortController.abort()
                      } catch (e) {}
                    },
                    Math.max(1, remaining),
                  )
                : null
            var response
            try {
              var requestInit = {}
              var initKeys = init ? Object.keys(init) : []
              for (var i = 0; i < initKeys.length; i++) requestInit[initKeys[i]] = init[initKeys[i]]
              requestInit.signal = abortController ? abortController.signal : undefined
              response = await fetch(url, requestInit)
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                status: 0,
                text: '',
                error_code: 'NETWORK',
                message: aborted
                  ? 'Request aborted after the in-page deadline.'
                  : 'Network error: ' + String(e),
              }
            }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (abortTimer !== null) clearTimeout(abortTimer)
            return {
              ok: response.ok,
              status: response.status,
              text: text,
              contentType: response.headers ? response.headers.get('content-type') || '' : '',
            }
          }
          async function fetchText(path, headers) {
            var response = await boundedFetch(path, {
              method: 'GET',
              headers: headers || {},
              credentials: 'include',
            })
            if (!response.ok && response.error_code)
              return {
                ok: false,
                status: response.status,
                text: response.text,
                error_code: response.error_code,
                message: response.message,
              }
            return { ok: response.ok, status: response.status, text: response.text }
          }
          async function fetchUrl(url, init) {
            return await boundedFetch(url, init)
          }
          async function pageJson(path, query) {
            if (!requireLogin())
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to GitHub.' }
            var url = path
            var qs = query ? buildQueryString(query) : ''
            if (qs) url = path + '?' + qs
            var response = await fetchUrl(url, {
              method: 'GET',
              headers: { Accept: 'application/json' },
              credentials: 'include',
            })
            if (!response.ok)
              return httpError(response)
            var data
            try {
              data = JSON.parse(response.text)
            } catch (e) {
              return { ok: false, error_code: 'HTTP', status: response.status, message: 'GitHub returned invalid JSON for ' + path }
            }
            return { ok: true, data: data.payload !== undefined ? data.payload : data }
          }
          function extractEmbeddedData(html, path) {
            var match = html.match(/<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/)
            if (!match || !match[1])
              return null
            try {
              var embedded = JSON.parse(match[1])
              return embedded.payload !== undefined ? embedded.payload : embedded
            } catch (e) {
              return null
            }
          }
          async function turboData(path, query) {
            if (!requireLogin())
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to GitHub.' }
            var url = path
            var qs = query ? buildQueryString(query) : ''
            if (qs) url = path + '?' + qs
            var response = await fetchText(url, {
              Accept: 'text/html',
              'Turbo-Frame': 'repo-content-turbo-frame',
            })
            if (!response.ok) return httpError(response)
            var embedded = extractEmbeddedData(response.text, path)
            if (!embedded)
              return { ok: false, error_code: 'API', status: response.status, message: 'No embedded data found in ' + path }
            var preloaded = embedded.preloadedQueries
            if (preloaded) {
              var first = null
              var keys = Object.keys(preloaded)
              for (var i = 0; i < keys.length; i++) {
                first = preloaded[keys[i]]
                break
              }
              if (first && first.result && first.result.data) {
                return {
                  ok: true,
                  data: first.result.data,
                  queryId: first.queryId,
                  queryName: first.queryName,
                }
              }
            }
            return { ok: true, data: embedded }
          }
          async function pageEmbeddedData(path) {
            if (!requireLogin())
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to GitHub.' }
            var response = await fetchText(path, {
              Accept: 'text/html',
              'X-Requested-With': 'XMLHttpRequest',
            })
            if (!response.ok) return httpError(response)
            var embedded = extractEmbeddedData(response.text, path)
            if (!embedded)
              return { ok: false, error_code: 'API', status: response.status, message: 'No embedded data found in ' + path }
            return { ok: true, data: embedded }
          }
          async function discoverMutationIds() {
            if (mutationsDiscovered) return
            var response = await fetchText(window.location.href, {
              Accept: 'text/html',
              'X-Requested-With': 'XMLHttpRequest',
            })
            if (!response.ok) return
            var jsUrls = []
            var re = /src="(https:\/\/github\.githubassets\.com\/assets\/[^"]+\.js)"/g
            var m
            while ((m = re.exec(response.text)) !== null) jsUrls.push(m[1])
            for (var i = 0; i < jsUrls.length; i++) {
              try {
                var jsResponse = await fetchUrl(jsUrls[i], { credentials: 'omit' })
                if (!jsResponse.ok) continue
                var code = jsResponse.text
                if (code.indexOf('operationKind:"mutation"') === -1) continue
                var pattern = /name:"([^"]*)",operationKind:"mutation"/g
                var match
                while ((match = pattern.exec(code)) !== null) {
                  var name = match[1]
                  var before = code.substring(Math.max(0, match.index - 300), match.index)
                  var idMatch = before.match(/id:"([a-f0-9]{32,64})"/)
                  if (idMatch && name) queryIdCache[name] = idMatch[1]
                }
              } catch (e) {}
            }
            mutationsDiscovered = true
          }
          async function getMutationId(mutationName) {
            if (queryIdCache[mutationName]) return queryIdCache[mutationName]
            await discoverMutationIds()
            if (queryIdCache[mutationName]) return queryIdCache[mutationName]
            return null
          }
          async function discoverQueryId(queryName, discoveryPath, discoveryQuery) {
            if (queryIdCache[queryName]) return queryIdCache[queryName]
            var result = await turboData(discoveryPath, discoveryQuery)
            if (!result.ok) return null
            if (result.queryName && result.queryId) queryIdCache[result.queryName] = result.queryId
            return queryIdCache[queryName] || null
          }
          async function graphql(queryId, variables) {
            if (!requireLogin())
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to GitHub.' }
            var csrf = getCsrfToken()
            if (!csrf)
              return { ok: false, error_code: 'AUTH', message: 'CSRF token not found — refresh the GitHub page.' }
            var response = await fetchUrl('/_graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'GitHub-Verified-Fetch': 'true',
                'X-CSRF-Token': csrf,
              },
              credentials: 'include',
              body: JSON.stringify({ query: queryId, variables: variables }),
            })
            if (!response.ok) return httpError(response)
            var result
            try {
              result = JSON.parse(response.text)
            } catch (e) {
              return { ok: false, error_code: 'HTTP', message: 'GitHub /_graphql returned invalid JSON' }
            }
            if (result.errors && result.errors.length && !result.data) {
              var err = result.errors[0]
              if (err && err.type === 'unknownQuery') {
                queryIdCache = {}
                mutationsDiscovered = false
                return { ok: false, error_code: 'API', message: 'GraphQL persisted query expired — GitHub may have deployed a new version. Please retry.' }
              }
              return { ok: false, error_code: 'API', message: 'GraphQL error: ' + ((err && err.message) || JSON.stringify(result.errors)) }
            }
            return { ok: true, data: result.data }
          }
          async function submitPageForm(pagePath, formSelector, fields) {
            if (!requireLogin())
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to GitHub.' }
            var response = await fetchText(pagePath, {
              Accept: 'text/html',
              'X-Requested-With': 'XMLHttpRequest',
            })
            if (!response.ok) return httpError(response)
            var doc = new DOMParser().parseFromString(response.text, 'text/html')
            var form = doc.querySelector(formSelector)
            if (!form)
              return { ok: false, error_code: 'API', status: response.status, message: 'Form not found: ' + formSelector + ' on ' + pagePath }
            var action = form.getAttribute('action') || pagePath
            var csrf = doc.querySelector('input[name="authenticity_token"]')
            var formData = new URLSearchParams()
            if (csrf && csrf.value) formData.set('authenticity_token', csrf.value)
            var keys = Object.keys(fields)
            for (var i = 0; i < keys.length; i++) formData.set(keys[i], String(fields[keys[i]]))
            var postResponse = await fetchUrl(action, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
              credentials: 'include',
              body: formData.toString(),
            })
            if (!postResponse.ok) return httpError(postResponse)
            var ct = postResponse.contentType || '' 
            if (ct.indexOf('json') !== -1) {
              try {
                return { ok: true, data: JSON.parse(postResponse.text) }
              } catch (e) {
                return { ok: true, data: {} }
              }
            }
            return { ok: true, data: {} }
          }
          function httpError(response) {
            var text = (response.text || '').slice(0, 512)
            if (response.status === 401 || response.status === 403)
              return { ok: false, error_code: 'AUTH', status: response.status, message: 'GitHub auth error (' + response.status + '): ' + text }
            if (response.status === 404)
              return { ok: false, error_code: 'NOT_FOUND', status: response.status, message: 'Not found: ' + text }
            if (response.status === 429)
              return { ok: false, error_code: 'RATE_LIMITED', status: response.status, message: 'GitHub rate limited: ' + text }
            return { ok: false, error_code: 'HTTP', status: response.status, message: 'GitHub API error (' + response.status + '): ' + text }
          }
          function mapRepository(r) {
            r = r || {}
            var repo = r.repo && r.repo.repository ? r.repo.repository : {}
            return {
              id: r.id !== undefined ? r.id : (repo.id !== undefined ? repo.id : 0),
              name: r.name || repo.name || '',
              full_name: r.full_name || (r.hl_name ? r.hl_name.replace(/<\/?em>/g, '') : '') || '',
              description: r.description || r.hl_trunc_description || '',
              private: r.private !== undefined ? r.private : r.public === false,
              html_url: r.html_url || (repo.owner_login ? 'https://github.com/' + repo.owner_login + '/' + repo.name : ''),
              default_branch: r.default_branch || '',
              language: r.language || '',
              stargazers_count: r.stargazers_count !== undefined ? r.stargazers_count : (typeof r.followers === 'number' ? r.followers : 0),
              forks_count: typeof r.forks_count === 'number' ? r.forks_count : 0,
              open_issues_count: typeof r.open_issues_count === 'number' ? r.open_issues_count : 0,
              archived: !!r.archived,
              updated_at: r.updated_at || repo.updated_at || '',
            }
          }
          function mapIssue(i, repoContext) {
            i = i || {}
            var owner = repoContext && repoContext.owner ? repoContext.owner : (i.repository && i.repository.owner && i.repository.owner.login) || ''
            var repo = repoContext && repoContext.repo ? repoContext.repo : (i.repository && i.repository.name) || ''
            var num = i.number !== undefined ? i.number : 0
            var isRelay = !!i.__typename
            var isClosed = isRelay ? (i.closed === true) : i.state === 'closed'
            var state = isClosed ? 'closed' : 'open'
            var isPR = isRelay ? i.__typename === 'PullRequest' : i.pull_request !== undefined && i.pull_request !== null
            var labels = []
            if (i.relayLabels && i.relayLabels.edges) {
              for (var li = 0; li < i.relayLabels.edges.length; li++) {
                var ln = i.relayLabels.edges[li].node && i.relayLabels.edges[li].node.name
                if (ln) labels.push(ln)
              }
            } else if (Array.isArray(i.labels)) {
              for (var lj = 0; lj < i.labels.length; lj++) labels.push((i.labels[lj] && i.labels[lj].name) || '')
            }
            var assignees = []
            if (Array.isArray(i.assignees)) {
              for (var la = 0; la < i.assignees.length; la++) assignees.push((i.assignees[la] && i.assignees[la].login) || '')
            }
            return {
              number: num,
              title: i.title || '',
              state: state,
              body: i.body || '',
              html_url: i.html_url || (owner && repo && num ? 'https://github.com/' + owner + '/' + repo + '/issues/' + num : ''),
              user_login: (i.user && i.user.login) || (i.author && i.author.login) || '',
              labels: labels,
              assignees: assignees,
              comments: typeof i.comments === 'number' ? i.comments : 0,
              created_at: i.created_at || i.createdAt || '',
              updated_at: i.updated_at || i.updatedAt || '',
              closed_at: i.closed_at || i.closedAt || '',
              is_pull_request: isPR,
            }
          }
          function mapPullRequest(pr, repoContext) {
            pr = pr || {}
            var owner = repoContext && repoContext.owner ? repoContext.owner : (pr.repository && pr.repository.owner && pr.repository.owner.login) || ''
            var repo = repoContext && repoContext.repo ? repoContext.repo : (pr.repository && pr.repository.name) || ''
            var num = pr.number !== undefined ? pr.number : 0
            var isRelay = !!pr.__typename
            var relayState = pr.pullRequestState ? String(pr.pullRequestState).toLowerCase() : undefined
            var mergedByRelay = relayState === 'merged'
            var mergedByRest = pr.merged === true
            var mergedByPage = pr.mergedTime !== undefined && pr.mergedTime !== null
            var isMerged = mergedByRelay || mergedByRest || mergedByPage
            var state
            if (isMerged) state = 'merged'
            else if (isRelay) state = relayState || (pr.closed ? 'closed' : 'open')
            else state = pr.state || 'open'
            var labels = []
            if (pr.relayLabels && pr.relayLabels.edges) {
              for (var li = 0; li < pr.relayLabels.edges.length; li++) {
                var ln = pr.relayLabels.edges[li].node && pr.relayLabels.edges[li].node.name
                if (ln) labels.push(ln)
              }
            } else if (Array.isArray(pr.labels)) {
              for (var lj = 0; lj < pr.labels.length; lj++) labels.push((pr.labels[lj] && pr.labels[lj].name) || '')
            }
            var additions = typeof pr.additions === 'number' ? pr.additions : 0
            var deletions = typeof pr.deletions === 'number' ? pr.deletions : 0
            var changedFiles = typeof pr.changed_files === 'number' ? pr.changed_files : 0
            if (Array.isArray(pr.diffSummaries) && pr.diffSummaries.length) {
              additions = 0
              deletions = 0
              for (var d = 0; d < pr.diffSummaries.length; d++) {
                additions += (pr.diffSummaries[d] && pr.diffSummaries[d].linesAdded) || 0
                deletions += (pr.diffSummaries[d] && pr.diffSummaries[d].linesDeleted) || 0
              }
              changedFiles = pr.diffSummaries.length
            }
            return {
              number: num,
              title: pr.title || '',
              state: state,
              body: pr.body || '',
              html_url: pr.html_url || (owner && repo && num ? 'https://github.com/' + owner + '/' + repo + '/pull/' + num : ''),
              user_login: (pr.user && pr.user.login) || (pr.author && pr.author.login) || '',
              head_ref: (pr.head && pr.head.ref) || pr.headBranch || '',
              base_ref: (pr.base && pr.base.ref) || pr.baseBranch || '',
              labels: labels,
              draft: pr.draft !== undefined ? pr.draft : (pr.isDraft === true),
              merged: isMerged,
              mergeable: pr.mergeable === true,
              comments: typeof pr.comments === 'number' ? pr.comments : 0,
              commits: typeof pr.commits === 'number' ? pr.commits : (typeof pr.commitsCount === 'number' ? pr.commitsCount : 0),
              additions: additions,
              deletions: deletions,
              changed_files: changedFiles,
              created_at: pr.created_at || pr.createdAt || '',
              updated_at: pr.updated_at || pr.updatedAt || '',
            }
          }
          function mapComment(c) {
            c = c || {}
            return {
              id: c.id !== undefined ? c.id : 0,
              body: c.body || '',
              user_login: (c.user && c.user.login) || '',
              html_url: c.html_url || '',
              created_at: c.created_at || '',
              updated_at: c.updated_at || '',
            }
          }
          function mapUser(u) {
            u = u || {}
            return {
              login: u.login || '',
              id: typeof u.id === 'number' ? u.id : 0,
              name: u.name || '',
              bio: u.bio || '',
              company: u.company || '',
              location: u.location || '',
              email: u.email || '',
              html_url: u.html_url || '',
              avatar_url: u.avatar_url || '',
              public_repos: typeof u.public_repos === 'number' ? u.public_repos : 0,
              followers: typeof u.followers === 'number' ? u.followers : 0,
              following: typeof u.following === 'number' ? u.following : 0,
              created_at: u.created_at || '',
            }
          }
          function mapBranch(b) {
            b = b || {}
            return {
              name: b.name || '',
              protected: b.protected !== undefined ? b.protected : (b.isProtected === true),
              sha: (b.commit && b.commit.sha) || b.oid || '',
            }
          }
          function mapNotification(n) {
            n = n || {}
            return {
              id: n.id || '',
              reason: n.reason || '',
              unread: n.unread !== undefined ? n.unread : false,
              subject_title: (n.subject && n.subject.title) || '',
              subject_type: (n.subject && n.subject.type) || '',
              subject_url: (n.subject && n.subject.url) || '',
              repository_full_name: (n.repository && n.repository.full_name) || '',
              updated_at: n.updated_at || '',
            }
          }
          function mapLabel(l) {
            l = l || {}
            return {
              id: l.id !== undefined ? l.id : 0,
              name: l.name || '',
              color: l.color || '',
              description: l.description || '',
            }
          }
          function mapWorkflowRun(r) {
            r = r || {}
            return {
              id: r.id !== undefined ? r.id : 0,
              name: r.name || '',
              status: r.status || '',
              conclusion: r.conclusion || '',
              head_branch: r.head_branch || '',
              head_sha: r.head_sha || '',
              html_url: r.html_url || '',
              created_at: r.created_at || '',
              updated_at: r.updated_at || '',
            }
          }
          function mapRelease(r) {
            r = r || {}
            return {
              id: r.id !== undefined ? r.id : 0,
              tag_name: r.tag_name || '',
              name: r.name || '',
              body: r.body || '',
              draft: !!r.draft,
              prerelease: !!r.prerelease,
              created_at: r.created_at || '',
              published_at: r.published_at || '',
              html_url: r.html_url || '',
              author_login: (r.author && r.author.login) || '',
            }
          }
          function mapCommit(c) {
            c = c || {}
            return {
              sha: c.sha || c.oid || '',
              message: (c.commit && c.commit.message) || c.shortMessage || '',
              author_name: (c.commit && c.commit.author && c.commit.author.name) || (c.authors && c.authors[0] && c.authors[0].displayName) || '',
              author_email: (c.commit && c.commit.author && c.commit.author.email) || (c.authors && c.authors[0] && c.authors[0].email) || '',
              date: (c.commit && c.commit.author && c.commit.author.date) || c.authoredDate || c.committedDate || '',
              url: c.html_url || c.url || '',
            }
          }
          function mapFileDiff(f) {
            f = f || {}
            var changes = f.changes !== undefined ? f.changes : ((f.linesAdded || 0) + (f.linesDeleted || 0))
            return {
              filename: f.filename || f.path || '',
              status: f.status || (f.changeType ? String(f.changeType).toLowerCase() : ''),
              additions: f.additions !== undefined ? f.additions : (f.linesAdded || 0),
              deletions: f.deletions !== undefined ? f.deletions : (f.linesDeleted || 0),
              changes: typeof changes === 'number' ? changes : 0,
            }
          }
          function extractRelayLabels(labels) {
            if (!labels || typeof labels !== 'object') return undefined
            return labels.edges ? { edges: labels.edges } : undefined
          }
          function relayNodeToRaw(node) {
            node = node || {}
            return {
              __typename: node.__typename,
              number: node.number,
              title: node.title,
              author: node.author,
              createdAt: node.createdAt,
              updatedAt: node.updatedAt,
              closed: node.closed,
              closedAt: node.closedAt,
              isDraft: node.isDraft,
              pullRequestState: node.pullRequestState,
              relayLabels: extractRelayLabels(node.labels),
              repository: node.repository,
            }
          }
          function ok(data) {
            return {
              status: 'ok',
              data,
              message: null,
              page_url: location.href,
            }
          }
          function error(code, message) {
            return {
              status: 'error',
              data: null,
              error_code: code,
              message,
              page_url: location.href,
            }
          }
          var toolImplementations = {


            async create_or_update_file(args) {
              if (location.hostname !== 'github.com')
                return error('UNSUPPORTED_PAGE', 'Not on a github.com page.')
              var branch = args.branch !== undefined ? args.branch : 'main'
              var fields = {
                value: args.content,
                message: args.message,
                placeholder_message: args.message,
                'commit-choice': 'direct',
                target_branch: branch,
                quick_pull: '',
                filename: args.path.split('/').pop() || '',
              }
              var editResponse = await submitPageForm('/' + encodeURIComponent(args.owner) + '/' + encodeURIComponent(args.repo) + '/edit/' + encodeURIComponent(branch) + '/' + args.path, 'form.js-blob-form', fields)
              if (editResponse.ok) return ok({ success: true })
              var newResponse = await submitPageForm('/' + encodeURIComponent(args.owner) + '/' + encodeURIComponent(args.repo) + '/new/' + encodeURIComponent(branch), 'form.js-blob-form', fields)
              if (!newResponse.ok) return newResponse
              return ok({ success: true })
            },
          }

          async function stdin_default(args) {
            return toolImplementations['create_or_update_file'](args)
          }
          return stdin_default
        })()

        return workflow(args)
      }
      let response
      try {
        // The command deadline rides into the page via __args so the
        // in-page abort timer can clamp its remaining budget to it (the
        // browser's 25s timeout includes the tab-command queue wait).
        const inputWithDeadline = {
          ...input,
          __eo2CommandDeadlineMs: commandDeadlineMs,
        }
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(inputWithDeadline) + ')',
          options,
        )
      } catch (error) {
        // An eval rejection whose error name carries the source marker
        // means the eval HARNESS itself faulted (page-side runtime error)
        // while the tab is still alive — TAB_UNAVAILABLE would mislead the
        // caller into reopening a healthy tab, so it gets EVAL_FAILED.
        if (error instanceof Error && error.name === '__eo2EvalSourceMarker__') {
          state.result = {
            status: 'error',
            data: null,
            message: 'The github.com tab failed to run the tool (internal eval error): ' +
              String(error),
            error_code: 'EVAL_FAILED',
          }
          return 'success'
        }
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The github.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'github.com API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The github.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
