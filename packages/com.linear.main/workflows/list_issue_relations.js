// Self-contained adapter workflow. Authenticates through the linear.app session: cookies travel to Linear's client-api GraphQL endpoint with credentials: 'include', identity headers come from the page's ApplicationStore. All API calls stay inside the tab.

export default {
  inputSchema: {
      "type": "object",
      "properties": {
          "issue_id": {
              "type": "string",
              "description": "Issue UUID or human-readable identifier (e.g. \"ENG-123\")"
          }
      },
      "required": [
          "issue_id"
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
    description: 'list_issue_relations',
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


          // Page-side Linear runtime (translated from OpenTabs linear-api.ts, MIT).
          // Runs INSIDE the linear.app tab: the HttpOnly session cookie travels with
          // credentials: 'include' to client-api.linear.app (CORS allows the web app
          // origin with credentials). userAccountId/userId/organizationId/clientId
          // come from the ApplicationStore localStorage the Linear web app maintains.
          var GRAPHQL_ENDPOINT = 'https://client-api.linear.app/graphql'
          function getCookie(name) {
            var parts = document.cookie.split(';')
            for (var i = 0; i < parts.length; i++) {
              var kv = parts[i].trim()
              var eq = kv.indexOf('=')
              if (eq === -1) continue
              if (kv.slice(0, eq) === name) return kv.slice(eq + 1)
            }
            return null
          }
          function getAuth() {
            var cached = null
            try {
              cached = JSON.parse(window.sessionStorage.getItem('__eo2LinearAuth') || 'null')
            } catch (e) {}
            if (cached && cached.userAccountId && cached.userId) return cached
            var loggedIn = getCookie('loggedIn')
            if (loggedIn !== '1') return null
            try {
              var raw = window.localStorage.getItem('ApplicationStore')
              if (!raw) return null
              var appStore = JSON.parse(raw)
              var userAccountId = appStore.currentUserAccountId
              var userId = appStore.currentUserId
              if (!userAccountId || !userId) return null
              var organizationId = ''
              var userAccounts = appStore.userAccounts
              if (userAccounts) {
                var account = userAccounts[userAccountId]
                var firstUser = account && account.users && account.users[0]
                organizationId = (firstUser && firstUser.organization && firstUser.organization.id) || ''
              }
              var clientId = ''
              try {
                clientId = window.localStorage.getItem('clientId') || ''
              } catch (e2) {}
              var auth = { userAccountId: userAccountId, userId: userId, organizationId: organizationId, clientId: clientId }
              try {
                window.sessionStorage.setItem('__eo2LinearAuth', JSON.stringify(auth))
              } catch (e3) {}
              return auth
            } catch (e4) {
              return null
            }
          }
          function clearAuthCache() {
            try {
              window.sessionStorage.removeItem('__eo2LinearAuth')
            } catch (e) {}
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
          async function graphql(query, variables) {
            var auth = getAuth()
            if (!auth)
              return { ok: false, error_code: 'AUTH', message: 'Not authenticated — please log in to Linear.' }
            var headers = {
              'Content-Type': 'application/json',
              useraccount: auth.userAccountId,
              user: auth.userId,
            }
            if (auth.organizationId) headers.organization = auth.organizationId
            if (auth.clientId) headers['linear-client-id'] = auth.clientId
            var response = await boundedFetch(GRAPHQL_ENDPOINT, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({ query: query, variables: variables }),
              credentials: 'include',
            })
            if (!response.ok && response.error_code)
              return { ok: false, error_code: response.error_code, message: response.message }
            if (!response.ok) {
              var errorBody = (response.text || '').substring(0, 512)
              if (response.status === 429)
                return { ok: false, error_code: 'RATE_LIMITED', status: 429, message: 'Rate limited — ' + errorBody }
              if (response.status === 401 || response.status === 403) {
                clearAuthCache()
                return { ok: false, error_code: 'AUTH', status: response.status, message: 'Auth error (' + response.status + '): ' + errorBody }
              }
              if (response.status === 404)
                return { ok: false, error_code: 'NOT_FOUND', status: 404, message: 'Not found: ' + errorBody }
              return { ok: false, error_code: 'HTTP', status: response.status, message: 'API error (' + response.status + '): ' + errorBody }
            }
            var result
            try {
              result = JSON.parse(response.text)
            } catch (e3) {
              return { ok: false, error_code: 'HTTP', message: 'Linear API returned non-JSON response' }
            }
            if (result.errors && result.errors.length > 0) {
              var firstError = result.errors[0]
              var message = firstError.message
              var extensions = firstError.extensions || {}
              var code = extensions.code
              var displayMessage = extensions.userPresentableMessage || message
              if (code === 'AUTHENTICATION_ERROR' || code === 'FORBIDDEN') {
                clearAuthCache()
                return { ok: false, error_code: 'AUTH', message: displayMessage }
              }
              if (code === 'RATELIMITED')
                return { ok: false, error_code: 'RATE_LIMITED', message: displayMessage }
              if (code === 'BAD_USER_INPUT' || code === 'GRAPHQL_VALIDATION_FAILED')
                return { ok: false, error_code: 'VALIDATION', message: displayMessage }
              var lower = String(message).toLowerCase()
              if (lower.indexOf('not found') !== -1 || lower.indexOf('does not exist') !== -1)
                return { ok: false, error_code: 'NOT_FOUND', message: displayMessage }
              return { ok: false, error_code: 'API', message: displayMessage }
            }
            if (!result.data)
              return { ok: false, error_code: 'API', message: 'Linear API returned empty response' }
            return { ok: true, data: result.data }
          }

          function mapIssue(i) {
            i = i || {}
            var labelNames = []
            var labelNodes = i.labels && i.labels.nodes ? i.labels.nodes : []
            for (var li = 0; li < labelNodes.length; li++) {
              var n = labelNodes[li] && labelNodes[li].name
              if (n) labelNames.push(n)
            }
            return {
              id: i.id || '',
              identifier: i.identifier || '',
              title: i.title || '',
              description: i.description || '',
              priority: typeof i.priority === 'number' ? i.priority : 0,
              priority_label: i.priorityLabel || '',
              state_name: (i.state && i.state.name) || '',
              state_type: (i.state && i.state.type) || '',
              assignee_name: (i.assignee && (i.assignee.displayName || i.assignee.name)) || '',
              team_key: (i.team && i.team.key) || '',
              team_name: (i.team && i.team.name) || '',
              label_names: labelNames,
              project_name: (i.project && i.project.name) || '',
              cycle_number: i.cycle && typeof i.cycle.number === 'number' ? i.cycle.number : 0,
              due_date: i.dueDate || '',
              estimate: typeof i.estimate === 'number' ? i.estimate : 0,
              url: i.url || '',
              created_at: i.createdAt || '',
              updated_at: i.updatedAt || '',
            }
          }
          function mapComment(c) {
            c = c || {}
            return {
              id: c.id || '',
              body: c.body || '',
              user_name: (c.user && (c.user.displayName || c.user.name)) || '',
              created_at: c.createdAt || '',
              updated_at: c.updatedAt || '',
              edited_at: c.editedAt || '',
            }
          }
          function mapProject(p) {
            p = p || {}
            return {
              id: p.id || '',
              name: p.name || '',
              description: p.description || '',
              state: (p.status && p.status.name) || '',
              lead_name: (p.lead && (p.lead.displayName || p.lead.name)) || '',
              target_date: p.targetDate || '',
              start_date: p.startDate || '',
              url: p.url || '',
              created_at: p.createdAt || '',
              updated_at: p.updatedAt || '',
            }
          }
          function mapTeam(t) {
            t = t || {}
            return { id: t.id || '', key: t.key || '', name: t.name || '', description: t.description || '' }
          }
          function mapWorkflowState(s) {
            s = s || {}
            return { id: s.id || '', name: s.name || '', type: s.type || '', color: s.color || '', position: typeof s.position === 'number' ? s.position : 0 }
          }
          function mapLabel(l) {
            l = l || {}
            return {
              id: l.id || '',
              name: l.name || '',
              color: l.color || '',
              description: l.description || '',
              is_group: l.isGroup === true,
              parent_name: (l.parent && l.parent.name) || '',
            }
          }
          function mapUser(u) {
            u = u || {}
            return {
              id: u.id || '',
              name: u.name || '',
              email: u.email || '',
              display_name: u.displayName || u.name || '',
              active: u.active === true,
              admin: u.admin === true,
            }
          }
          function mapCycle(c) {
            c = c || {}
            return {
              id: c.id || '',
              number: typeof c.number === 'number' ? c.number : 0,
              name: c.name || '',
              starts_at: c.startsAt || '',
              ends_at: c.endsAt || '',
              is_active: c.isActive === true,
              completed_at: c.completedAt || '',
            }
          }
          function mapAttachment(a) {
            a = a || {}
            return {
              id: a.id || '',
              title: a.title || '',
              subtitle: a.subtitle || '',
              url: a.url || '',
              source_type: a.sourceType || '',
              creator_name: (a.creator && (a.creator.displayName || a.creator.name)) || '',
              created_at: a.createdAt || '',
              updated_at: a.updatedAt || '',
            }
          }
          function mapInitiative(i) {
            i = i || {}
            return {
              id: i.id || '',
              name: i.name || '',
              description: i.description || '',
              status: i.status || '',
              color: i.color || '',
              icon: i.icon || '',
              owner_name: (i.owner && (i.owner.displayName || i.owner.name)) || '',
              url: i.url || '',
              created_at: i.createdAt || '',
              updated_at: i.updatedAt || '',
            }
          }
          function mapDocument(d) {
            d = d || {}
            return {
              id: d.id || '',
              title: d.title || '',
              content: d.content || '',
              slug_id: d.slugId || '',
              icon: d.icon || '',
              creator_name: (d.creator && (d.creator.displayName || d.creator.name)) || '',
              project_name: (d.project && d.project.name) || '',
              url: d.url || '',
              created_at: d.createdAt || '',
              updated_at: d.updatedAt || '',
            }
          }
          function mapMilestone(m) {
            m = m || {}
            return {
              id: m.id || '',
              name: m.name || '',
              description: m.description || '',
              target_date: m.targetDate || '',
              sort_order: typeof m.sortOrder === 'number' ? m.sortOrder : 0,
            }
          }
          function mapStatusUpdate(s) {
            s = s || {}
            return {
              id: s.id || '',
              body: s.body || '',
              health: s.health || '',
              user_name: (s.user && (s.user.displayName || s.user.name)) || '',
              created_at: s.createdAt || '',
              updated_at: s.updatedAt || '',
            }
          }
          function mapIssueHistory(h) {
            h = h || {}
            return {
              id: h.id || '',
              actor_name: (h.actor && (h.actor.displayName || h.actor.name)) || '',
              from_state_name: (h.fromState && h.fromState.name) || '',
              to_state_name: (h.toState && h.toState.name) || '',
              from_assignee_name: (h.fromAssignee && (h.fromAssignee.displayName || h.fromAssignee.name)) || '',
              to_assignee_name: (h.toAssignee && (h.toAssignee.displayName || h.toAssignee.name)) || '',
              from_priority: typeof h.fromPriority === 'number' ? h.fromPriority : 0,
              to_priority: typeof h.toPriority === 'number' ? h.toPriority : 0,
              created_at: h.createdAt || '',
            }
          }
          function mapRelation(r) {
            r = r || {}
            return {
              id: r.id || '',
              type: r.type || '',
              related_issue: {
                id: (r.relatedIssue && r.relatedIssue.id) || '',
                identifier: (r.relatedIssue && r.relatedIssue.identifier) || '',
                title: (r.relatedIssue && r.relatedIssue.title) || '',
                state: (r.relatedIssue && r.relatedIssue.state && r.relatedIssue.state.name) || '',
              },
            }
          }
          var ISSUE_FIELDS = '\n  id identifier title description priority priorityLabel url\n  createdAt updatedAt dueDate estimate\n  state { name type }\n  assignee { name displayName }\n  team { key name }\n  labels { nodes { name } }\n  project { name }\n  cycle { number }\n'
          function pagination(result) {
            var info = result && result.pageInfo
            return {
              has_next_page: !!(info && info.hasNextPage),
              end_cursor: (info && info.endCursor) || '',
            }
          }
          function requirePage(value, message) {
            if (!value) return null
            return value
          }
          var RELATION_FIELDS = '\n  relations {\n    nodes {\n      id type\n      relatedIssue {\n        id identifier title\n        state { name }\n      }\n    }\n  }\n'
          // gql() mirrors OpenTabs' graphql(): resolves to result.data or throws an
          // {eo2Error:true, eo2Code, message} error converted by stdin_default.
          async function gql(query, variables) {
            var response = await graphql(query, variables)
            if (!response.ok) {
              var err = new Error(response.message || 'Linear API call failed')
              err.eo2Code = response.error_code || 'API'
              err.eo2Error = true
              throw err
            }
            return response.data
          }
          function returnError(code, message) {
            return { eo2Return: { code: code, message: message } }
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
            async list_issue_relations(args) {

        const isIdentifier = /^[A-Z]+-\d+$/i.test(args.issue_id);
        if (isIdentifier) {
            const data = await gql(`query ListIssueRelationsByIdentifier($identifier: String!) {
          searchIssues(term: $identifier, first: 1) {
            nodes {
              ${RELATION_FIELDS}
            }
          }
        }`, { identifier: args.issue_id });
            const node = data.searchIssues?.nodes?.[0];
            if (!node)
                return returnError('NOT_FOUND', `Issue not found: ${args.issue_id}`);
            return ok({
                relations: (node.relations?.nodes ?? []).map(mapRelation),
            });
        }
        const data = await gql(`query ListIssueRelations($id: String!) {
        issue(id: $id) {
          ${RELATION_FIELDS}
        }
      }`, { id: args.issue_id });
        if (!data.issue)
            return returnError('NOT_FOUND', 'Issue not found');
        return ok({
            relations: (data.issue.relations?.nodes ?? []).map(mapRelation),
        });
            },
          }

          async function stdin_default(args) {
            try {
              var result = await toolImplementations['list_issue_relations'](args)
            } catch (e) {
              if (e && e.eo2Error) return error(e.eo2Code || 'API', e.message || String(e))
              return error('EVAL_FAILED', 'Tool implementation failed: ' + String(e))
            }
            if (result && result.eo2Return) return error(result.eo2Return.code, result.eo2Return.message)
            return result
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
            message: 'The linear.app tab failed to run the tool (internal eval error): ' +
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
            'The linear.app tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'linear.app API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The linear.app tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
