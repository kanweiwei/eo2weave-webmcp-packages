// Self-contained adapter workflow for create_variable_set. The HCP Terraform session cookie
// and every /api/v2 call stay inside the app.terraform.io tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "organization": {
        "type": "string",
        "description": "Organization name"
      },
      "name": {
        "type": "string",
        "description": "Variable set name"
      },
      "description": {
        "description": "Variable set description",
        "type": "string"
      },
      "global": {
        "description": "Whether to apply to all workspaces (default false)",
        "type": "boolean"
      },
      "priority": {
        "description": "Whether this set takes priority over workspace variables (default false)",
        "type": "boolean"
      }
    },
    "required": [
      "organization",
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
    description: 'create_variable_set',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // --- HCP Terraform page runtime -------------------------------------------
          // Translated from OpenTabs terraform-cloud-api.js, tools/schemas.js and
          // index.js (MIT). Runs INSIDE the app.terraform.io tab: the HttpOnly session
          // cookie stays in the page, and writes carry the page's own CSRF token.
          var API_BASE = '/api/v2'

          // Upstream isLoggedIn(): the signed-in app renders the global sidebar menu.
          // The bare #tfe-app shell also exists for logged-out visitors, so it is not a
          // login signal.
          function isAuthenticated() {
            try {
              return !!document.querySelector('[data-test-sidebar-menu-global]')
            } catch (e) {
              return false
            }
          }

          // Writes need the CSRF token from the shell's hidden authenticity input.
          function getCsrfToken() {
            try {
              var input = document.querySelector('input[name="authenticity_token"]')
              return input && input.value ? input.value : null
            } catch (e) {
              return null
            }
          }

          // SDK buildQueryString(): skips undefined, repeats array values, stringifies.
          function buildQueryString(params) {
            var search = new URLSearchParams()
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined) continue
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++) search.append(keys[i], String(value[j]))
              } else {
                search.append(keys[i], String(value))
              }
            }
            return search.toString()
          }

          // SDK stripUndefined(): keeps null, 0, false and '' (only undefined is dropped).
          function stripUndefined(obj) {
            var out = {}
            var keys = Object.keys(obj)
            for (var i = 0; i < keys.length; i++) {
              if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]]
            }
            return out
          }

          // SDK httpStatusToToolError() categories.
          function httpErrorCode(status) {
            if (status === 401 || status === 403) return 'AUTH_ERROR'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION_ERROR'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP_ERROR'
          }

          // HCP Terraform answers JSON:API errors: { errors: [{ status, title, detail }] }.
          function errorDetail(text) {
            try {
              var parsed = JSON.parse(text)
              var first = parsed && parsed.errors && parsed.errors[0]
              if (first) return first.detail || first.title || ''
              if (parsed && parsed.message) return parsed.message
            } catch (e) {}
            return text.slice(0, 512)
          }

          // Upstream api(): same-origin /api/v2 with JSON:API content type, CSRF on
          // non-GET, credentials from the tab, and {} for a 204 DELETE.
          async function api(endpoint, options) {
            options = options || {}
            if (!isAuthenticated())
              return {
                ok: false,
                error_code: 'AUTH_ERROR',
                message: 'Not authenticated — please log in to HCP Terraform.',
              }
            var qs = options.query ? buildQueryString(options.query) : ''
            var url = qs ? API_BASE + endpoint + '?' + qs : API_BASE + endpoint
            var method = options.method || 'GET'
            var headers = { 'Content-Type': 'application/vnd.api+json' }
            if (method !== 'GET') {
              var csrf = getCsrfToken()
              if (csrf) headers['X-CSRF-Token'] = csrf
            }
            var init = { method: method, headers: headers, credentials: 'include' }
            if (options.body !== undefined) init.body = JSON.stringify(options.body)

            // Arm an in-page abort before the 25s browser command deadline so a slow
            // response cannot outlive the adapter call.
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {}
            }
            var timer =
              controller !== null
                ? setTimeout(function () {
                    try {
                      controller.abort()
                    } catch (e) {}
                  }, 18000)
                : null
            function clearTimer() {
              if (timer !== null) clearTimeout(timer)
            }

            var response
            try {
              init.signal = controller ? controller.signal : undefined
              response = await fetch(url, init)
            } catch (e) {
              clearTimer()
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'HCP Terraform request aborted after the 18s in-page deadline.'
                  : 'Network error calling HCP Terraform: ' + String(e),
              }
            }

            // DELETE returns 204 with no body — upstream maps it to {}.
            if (response.status === 204) {
              clearTimer()
              return { ok: true, data: {} }
            }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              clearTimer()
              return {
                ok: false,
                error_code: httpErrorCode(response.status),
                status: response.status,
                message:
                  'HCP Terraform API error (' + response.status + '): ' + errorDetail(text),
              }
            }
            try {
              var data = await response.json()
              clearTimer()
              return { ok: true, data: data }
            } catch (e) {
              clearTimer()
              var bodyAborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: bodyAborted ? 'TIMEOUT' : 'INVALID_RESPONSE',
                message: bodyAborted
                  ? 'HCP Terraform response aborted after the 18s in-page deadline.'
                  : 'HCP Terraform returned invalid JSON',
              }
            }
          }

          // --- Mappers (OpenTabs tools/schemas.ts) — defensive, JSON:API attributes ---
          function mapPagination(p) {
            return {
              current_page: (p && p['current-page']) != null ? p['current-page'] : 1,
              total_pages: (p && p['total-pages']) != null ? p['total-pages'] : 0,
              total_count: (p && p['total-count']) != null ? p['total-count'] : 0,
            }
          }
          function mapUser(id, u) {
            u = u || {}
            return {
              id: id,
              username: u.username != null ? u.username : '',
              email: u.email != null ? u.email : '',
              avatar_url: u['avatar-url'] != null ? u['avatar-url'] : '',
              is_confirmed: u['is-confirmed'] != null ? u['is-confirmed'] : false,
              two_factor_enabled: (u['two-factor'] && u['two-factor'].enabled) != null ? u['two-factor'].enabled : false,
              auth_method: u['auth-method'] != null ? u['auth-method'] : '',
            }
          }
          function mapOrganization(id, o) {
            o = o || {}
            return {
              id: id,
              external_id: o['external-id'] != null ? o['external-id'] : '',
              name: o.name != null ? o.name : '',
              email: o.email != null ? o.email : '',
              created_at: o['created-at'] != null ? o['created-at'] : '',
              plan: o['plan-identifier'] != null ? o['plan-identifier'] : '',
              execution_mode: o['default-execution-mode'] != null ? o['default-execution-mode'] : '',
              managed_resource_count: o['managed-resource-count'] != null ? o['managed-resource-count'] : 0,
              cost_estimation_enabled:
                o['cost-estimation-enabled'] != null ? o['cost-estimation-enabled'] : false,
              saml_enabled: o['saml-enabled'] != null ? o['saml-enabled'] : false,
            }
          }
          function mapWorkspace(id, w) {
            w = w || {}
            return {
              id: id,
              name: w.name != null ? w.name : '',
              description: w.description != null ? w.description : '',
              auto_apply: w['auto-apply'] != null ? w['auto-apply'] : false,
              created_at: w['created-at'] != null ? w['created-at'] : '',
              updated_at: w['updated-at'] != null ? w['updated-at'] : '',
              execution_mode: w['execution-mode'] != null ? w['execution-mode'] : '',
              locked: w.locked != null ? w.locked : false,
              resource_count: w['resource-count'] != null ? w['resource-count'] : 0,
              terraform_version: w['terraform-version'] != null ? w['terraform-version'] : '',
              working_directory: w['working-directory'] != null ? w['working-directory'] : '',
              vcs_repo: (w['vcs-repo'] && w['vcs-repo'].identifier) != null ? w['vcs-repo'].identifier : '',
            }
          }
          function mapProject(id, p) {
            p = p || {}
            return {
              id: id,
              name: p.name != null ? p.name : '',
              description: p.description != null ? p.description : '',
              created_at: p['created-at'] != null ? p['created-at'] : '',
              workspace_count: p['workspace-count'] != null ? p['workspace-count'] : 0,
              team_count: p['team-count'] != null ? p['team-count'] : 0,
            }
          }
          function mapRun(id, r) {
            r = r || {}
            var actions = r.actions || {}
            return {
              id: id,
              status: r.status != null ? r.status : '',
              message: r.message != null ? r.message : '',
              source: r.source != null ? r.source : '',
              created_at: r['created-at'] != null ? r['created-at'] : '',
              is_destroy: r['is-destroy'] != null ? r['is-destroy'] : false,
              has_changes: r['has-changes'] != null ? r['has-changes'] : false,
              auto_apply: r['auto-apply'] != null ? r['auto-apply'] : false,
              plan_only: r['plan-only'] != null ? r['plan-only'] : false,
              terraform_version: r['terraform-version'] != null ? r['terraform-version'] : '',
              confirmable: actions['is-confirmable'] != null ? actions['is-confirmable'] : false,
              cancelable: actions['is-cancelable'] != null ? actions['is-cancelable'] : false,
              discardable: actions['is-discardable'] != null ? actions['is-discardable'] : false,
            }
          }
          function mapPlan(id, p) {
            p = p || {}
            return {
              id: id,
              status: p.status != null ? p.status : '',
              has_changes: p['has-changes'] != null ? p['has-changes'] : false,
              resource_additions: p['resource-additions'] != null ? p['resource-additions'] : 0,
              resource_changes: p['resource-changes'] != null ? p['resource-changes'] : 0,
              resource_destructions: p['resource-destructions'] != null ? p['resource-destructions'] : 0,
              resource_imports: p['resource-imports'] != null ? p['resource-imports'] : 0,
              log_read_url: p['log-read-url'] != null ? p['log-read-url'] : '',
            }
          }
          function mapApply(id, a) {
            a = a || {}
            return {
              id: id,
              status: a.status != null ? a.status : '',
              resource_additions: a['resource-additions'] != null ? a['resource-additions'] : 0,
              resource_changes: a['resource-changes'] != null ? a['resource-changes'] : 0,
              resource_destructions: a['resource-destructions'] != null ? a['resource-destructions'] : 0,
              resource_imports: a['resource-imports'] != null ? a['resource-imports'] : 0,
              log_read_url: a['log-read-url'] != null ? a['log-read-url'] : '',
            }
          }
          function mapStateVersion(id, s) {
            s = s || {}
            return {
              id: id,
              created_at: s['created-at'] != null ? s['created-at'] : '',
              serial: s.serial != null ? s.serial : 0,
              status: s.status != null ? s.status : '',
              terraform_version: s['terraform-version'] != null ? s['terraform-version'] : '',
              size: s.size != null ? s.size : 0,
              resources_processed: s['resources-processed'] != null ? s['resources-processed'] : false,
            }
          }
          function mapVariable(id, v) {
            v = v || {}
            return {
              id: id,
              key: v.key != null ? v.key : '',
              value: v.value != null ? v.value : '',
              sensitive: v.sensitive != null ? v.sensitive : false,
              category: v.category != null ? v.category : '',
              hcl: v.hcl != null ? v.hcl : false,
              description: v.description != null ? v.description : '',
            }
          }
          function mapVariableSet(id, vs) {
            vs = vs || {}
            return {
              id: id,
              name: vs.name != null ? vs.name : '',
              description: vs.description != null ? vs.description : '',
              global: vs.global != null ? vs.global : false,
              priority: vs.priority != null ? vs.priority : false,
              created_at: vs['created-at'] != null ? vs['created-at'] : '',
              workspace_count: vs['workspace-count'] != null ? vs['workspace-count'] : 0,
              project_count: vs['project-count'] != null ? vs['project-count'] : 0,
              var_count: vs['var-count'] != null ? vs['var-count'] : 0,
            }
          }
          function mapTeam(id, t) {
            t = t || {}
            return {
              id: id,
              name: t.name != null ? t.name : '',
              users_count: t['users-count'] != null ? t['users-count'] : 0,
              visibility: t.visibility != null ? t.visibility : '',
              sso_team_id: t['sso-team-id'] != null ? t['sso-team-id'] : '',
            }
          }
          function mapTeamAccess(id, a, teamId, workspaceId) {
            a = a || {}
            return {
              id: id,
              team_id: teamId,
              workspace_id: workspaceId,
              access: a.access != null ? a.access : '',
              runs: a.runs != null ? a.runs : '',
              variables: a.variables != null ? a.variables : '',
              state_versions: a['state-versions'] != null ? a['state-versions'] : '',
            }
          }
          function mapOrganizationMembership(id, m, userId) {
            m = m || {}
            return {
              id: id,
              status: m.status != null ? m.status : '',
              email: m.email != null ? m.email : '',
              user_id: userId,
              created_at: m['created-at'] != null ? m['created-at'] : '',
            }
          }

          // --- Envelope (adapter contract) ---
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
            if (location.hostname !== 'app.terraform.io')
              return error('UNSUPPORTED_PAGE', 'Not on an app.terraform.io page.')
            return null
          }
          function enc(value) {
            return encodeURIComponent(value)
          }
          function pagedQuery(params) {
            return {
              'page[number]': params.page != null ? params.page : 1,
              'page[size]': params.page_size != null ? params.page_size : 20,
            }
          }

          var terraformToolImplementations = {
            async create_variable_set(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/organizations/' + enc(args.organization) + '/varsets', {
                method: 'POST',
                body: {
                  data: {
                    type: 'varsets',
                    attributes: {
                      name: args.name,
                      description: args.description,
                      global: args.global,
                      priority: args.priority,
                    },
                  },
                },
              })
              if (!res.ok) return error(res.error_code, res.message)
              return ok({ variable_set: mapVariableSet(res.data.data.id, res.data.data.attributes) })
            },
          }

          async function stdin_default(args) {
            return terraformToolImplementations['create_variable_set'](args)
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
            'The app.terraform.io tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'HCP Terraform call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The app.terraform.io tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
