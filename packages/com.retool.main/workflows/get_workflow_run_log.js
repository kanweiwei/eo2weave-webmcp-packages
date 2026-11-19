// Self-contained adapter workflow. Every Retool call stays inside the retool.com tab:
// the HttpOnly session cookies ride along (credentials: 'include'), the CSRF token is the
// page's own `xsrfToken` cookie sent as X-Xsrf-Token, and every request is a same-origin
// /api/... fetch — no token ever leaves the page.
//
// Ported from the OpenTabs retool plugin (plugins/retool/src, MIT): same endpoint, same
// query/body, same defensive mappers, same error classification.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "run_id": {
        "type": "string",
        "description": "Workflow run ID"
      }
    },
    "required": [
      "run_id"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "description": "Overall run status"
      },
      "logs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "message": {
              "type": "string",
              "description": "Log message"
            },
            "timestamp": {
              "type": "number",
              "description": "Unix timestamp in milliseconds"
            }
          },
          "required": [
            "message",
            "timestamp"
          ],
          "additionalProperties": false
        },
        "description": "Execution log entries"
      }
    },
    "required": [
      "status",
      "logs"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'get_workflow_run_log',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
          // --- Page-side Retool runtime (translated from OpenTabs plugins/retool/src/retool-api.ts,
          // --- src/toolscript.ts, src/tools/schemas.ts and the 50 tool handlers, MIT).
          // --- Runs INSIDE the retool.com tab: the HttpOnly session cookies ride along via
          // --- credentials: 'include', the CSRF token is the page's own `xsrfToken` cookie, and
          // --- every call is a same-origin /api/... fetch — no token ever leaves the page.

          var XSRF_COOKIE = 'xsrfToken'
          var ZIP_MIME_TYPE = 'application/zip'

          function pick(value, fallback) {
            return value === undefined || value === null ? fallback : value
          }

          function getCookie(name) {
            var raw = ''
            try {
              raw = String(document.cookie || '')
            } catch (e) {
              raw = ''
            }
            var parts = raw.split(';')
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i]
              var eq = part.indexOf('=')
              if (eq === -1) continue
              var key = part.slice(0, eq).replace(/^\s+|\s+$/g, '')
              if (key !== name) continue
              var value = part.slice(eq + 1).replace(/^\s+|\s+$/g, '')
              try {
                return decodeURIComponent(value)
              } catch (e) {
                return value
              }
            }
            return null
          }

          // Upstream's isAuthenticated(): Retool keeps the session cookie HttpOnly and exposes
          // readiness through the non-HttpOnly `xsrfToken` cookie.
          function isAuthenticated() {
            return getCookie(XSRF_COOKIE) !== null
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }

          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }

          function pagePathname() {
            try {
              return String((location && location.pathname) || '')
            } catch (e) {
              return ''
            }
          }

          function assertPage() {
            var host = ''
            try {
              host = String((location && location.hostname) || '')
            } catch (e) {
              host = ''
            }
            if (!host) return error('UNSUPPORTED_PAGE', 'Not on a Retool page.')
            if (host === 'retool.com') return null
            if (host.length > 11 && host.slice(-11) === '.retool.com') return null
            return error('UNSUPPORTED_PAGE', 'Not on a Retool instance (retool.com).')
          }

          // Upstream's buildQueryString(): absent keys are dropped, everything else is
          // stringified. `branch`/`branchName` are undefined when the tab carries no branch.
          function buildQuery(query) {
            if (!query) return ''
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value === undefined || value === null) continue
              params.append(keys[i], String(value))
            }
            return params.toString()
          }

          // OpenTabs' httpStatusToToolError(), mapped onto the adapter's error_code vocabulary.
          function classifyStatus(status) {
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP'
          }

          function retryAfter(response) {
            try {
              var value = response.headers && response.headers.get ? response.headers.get('Retry-After') : null
              if (value === null || value === undefined) return null
              var text = String(value).replace(/^\s+|\s+$/g, '')
              return text || null
            } catch (e) {
              return null
            }
          }

          function describeHttpError(response, endpoint, body) {
            var detail = body ? ' — ' + body : ''
            var code = classifyStatus(response.status)
            if (code === 'AUTH') return 'Auth error (' + response.status + '): ' + endpoint + detail
            if (code === 'NOT_FOUND') return 'Not found: ' + endpoint + detail
            if (code === 'RATE_LIMITED') {
              var wait = retryAfter(response)
              return 'Rate limited: ' + endpoint + (wait ? ' (retry after ' + wait + ')' : '') + detail
            }
            if (code === 'VALIDATION') return 'Validation error (' + response.status + '): ' + endpoint + detail
            if (code === 'TIMEOUT') return 'Request timed out (' + response.status + '): ' + endpoint + detail
            return 'Retool API error (' + response.status + '): ' + endpoint + detail
          }

          // One same-origin fetch: page cookies, JSON in, JSON out, aborted after 18s so it always
          // settles inside the adapter's 25s window. Error bodies are truncated at 512 chars.
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
                  ? 'Retool request aborted after the 18s in-page deadline: ' + endpoint
                  : 'Network error calling Retool: ' + String(err),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (response.status === 204) return { ok: true, data: {} }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              return {
                ok: false,
                error_code: classifyStatus(response.status),
                status: response.status,
                message: describeHttpError(response, endpoint, String(text).substring(0, 512)),
              }
            }
            var raw = ''
            try {
              raw = await response.text()
            } catch (e) {
              return { ok: false, error_code: 'PARSE', message: 'Retool returned an unreadable body: ' + endpoint }
            }
            // Retool answers some endpoints with an empty body; the SDK treats that as "no data".
            if (!raw) return { ok: true, data: {} }
            try {
              return { ok: true, data: JSON.parse(raw) }
            } catch (e) {
              return { ok: false, error_code: 'PARSE', message: 'Retool returned invalid JSON: ' + endpoint }
            }
          }

          // Faithful translation of OpenTabs api(): every request carries the JSON content type
          // and the page's `xsrfToken` in X-Xsrf-Token, exactly as the Retool editor does.
          async function api(endpoint, options) {
            options = options || {}
            // Every call is same-origin, so an off-host tab is refused before any request.
            var pageError = assertPage()
            if (pageError) return pageError
            var xsrf = getCookie(XSRF_COOKIE)
            if (!xsrf) {
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to Retool (the xsrfToken cookie is missing).',
              }
            }
            var qs = options.query ? buildQuery(options.query) : ''
            var url = qs ? endpoint + '?' + qs : endpoint
            var headers = { 'Content-Type': 'application/json', 'X-Xsrf-Token': xsrf }
            var init = { method: options.method || 'GET', headers: headers }
            if (options.body) init.body = JSON.stringify(options.body)
            return request(url, endpoint, init)
          }

          // Upstream's fetchFromPage() path used by get_app_docs: the endpoint answers plain text,
          // JSON with a `documentation` field, or nothing at all.
          async function fetchPageText(endpoint) {
            var pageError = assertPage()
            if (pageError) return pageError
            var xsrf = getCookie(XSRF_COOKIE)
            if (!xsrf) {
              return {
                ok: false,
                error_code: 'UNAUTHENTICATED',
                message: 'Not authenticated — please log in to Retool (the xsrfToken cookie is missing).',
              }
            }
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
              response = await fetch(endpoint, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Xsrf-Token': xsrf },
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
                  ? 'Retool request aborted after the 18s in-page deadline: ' + endpoint
                  : 'Network error calling Retool: ' + String(err),
              }
            }
            if (timer !== null) clearTimeout(timer)
            if (!response.ok) {
              var body = ''
              try {
                body = await response.text()
              } catch (e) {}
              return {
                ok: false,
                error_code: classifyStatus(response.status),
                message: describeHttpError(response, endpoint, String(body).substring(0, 512)),
              }
            }
            try {
              return { ok: true, text: await response.text() }
            } catch (e) {
              return { ok: false, error_code: 'PARSE', message: 'Retool returned an unreadable body: ' + endpoint }
            }
          }

          // Shared shape of the app-save body used by add_component / add_query / save_page.
          function saveResponseId(data) {
            return data && data.save && typeof data.save.id === 'number' ? data.save.id : 0
          }

          function pageRecord(data) {
            return data && data.page ? data.page : {}
          }

          // The source-control branch (if any) the targeted tab is editing.
          // Upstream reads the source-control branch out of an editor URL: /tree/<branch>/editor/...
          function getCurrentSourceControlBranchName() {
            var match = pagePathname().match(/(?:^|\/)tree\/([^/]+)\/(?:editor|apps)\//)
            if (!match || !match[1]) return null
            var raw = match[1]
            try {
              return decodeURIComponent(raw)
            } catch (e) {
              return raw
            }
          }

          // --- mappers (OpenTabs src/tools/schemas.ts) --------------------------------

          function mapApp(a) {
            a = a || {}
            return {
              id: pick(a.id, 0),
              name: pick(a.name, ''),
              uuid: pick(a.uuid, ''),
              folder_id: pick(a.folderId, 0),
              organization_id: pick(a.organizationId, 0),
              description: pick(a.description, ''),
              is_mobile_app: pick(a.isMobileApp, false),
              is_global_widget: pick(a.isGlobalWidget, false),
              is_form_app: pick(a.isFormApp, false),
              protected: pick(a.protected, false),
              synced: pick(a.synced, false),
              access_level: pick(a.accessLevel, ''),
              created_at: pick(a.createdAt, ''),
              updated_at: pick(a.updatedAt, ''),
            }
          }

          function mapFolder(f) {
            f = f || {}
            return {
              id: pick(f.id, 0),
              name: pick(f.name, ''),
              display_name: pick(f.displayName, ''),
              system_folder: pick(f.systemFolder, false),
              folder_type: pick(f.folderType, ''),
              parent_folder_id: pick(f.parentFolderId, null),
              organization_id: pick(f.organizationId, 0),
              access_level: pick(f.accessLevel, ''),
              created_at: pick(f.createdAt, ''),
              updated_at: pick(f.updatedAt, ''),
            }
          }

          function mapUser(u) {
            u = u || {}
            return {
              id: pick(u.id, 0),
              email: pick(u.email, ''),
              first_name: pick(u.firstName, ''),
              last_name: pick(u.lastName, ''),
              profile_photo_url: pick(u.profilePhotoUrl, ''),
              organization_id: pick(u.organizationId, 0),
              sid: pick(u.sid, ''),
              enabled: pick(u.enabled, false),
              user_type: pick(u.userType, ''),
              seat_type: pick(u.seatType, ''),
              email_is_verified: pick(u.emailIsVerified, false),
              last_logged_in: pick(u.lastLoggedIn, ''),
              created_at: pick(u.createdAt, ''),
            }
          }

          function mapOrganization(o) {
            o = o || {}
            return {
              id: pick(o.id, 0),
              name: pick(o.name, ''),
              subdomain: pick(o.subdomain, ''),
              sid: pick(o.sid, ''),
              plan_id: pick(o.planId, 0),
              release_management_enabled: pick(o.releaseManagementEnabled, false),
              enabled: pick(o.enabled, false),
              created_at: pick(o.createdAt, ''),
            }
          }

          function mapResource(r) {
            r = r || {}
            return {
              id: pick(r.id, 0),
              uuid: pick(r.uuid, ''),
              type: pick(r.type, ''),
              name: pick(r.name, ''),
              display_name: pick(r.displayName, ''),
              protected: pick(r.protected, false),
              synced: pick(r.synced, false),
              access_level: pick(r.accessLevel, ''),
              editor_type: pick(r.editorType, ''),
              created_at: pick((r.production || {}).createdAt, ''),
              updated_at: pick((r.production || {}).updatedAt, ''),
            }
          }

          function mapResourceFolder(f) {
            f = f || {}
            return {
              id: pick(f.id, 0),
              name: pick(f.name, ''),
              parent_folder_id: pick(f.parentFolderId, null),
              organization_id: pick(f.organizationId, 0),
              system_folder: pick(f.systemFolder, false),
              access_level: pick(f.accessLevel, ''),
              created_at: pick(f.createdAt, ''),
              updated_at: pick(f.updatedAt, ''),
            }
          }

          function mapWorkflow(w) {
            w = w || {}
            return {
              id: String(pick(w.id, '')),
              name: pick(w.name, ''),
              folder_id: pick(w.folderId, 0),
              is_enabled: pick(w.isEnabled, false),
              access_level: pick(w.accessLevel, ''),
              created_at: pick(w.createdAt, ''),
              updated_at: pick(w.updatedAt, ''),
            }
          }

          function mapWorkflowRun(r) {
            r = r || {}
            return {
              id: pick(r.id, ''),
              status: pick(r.status, ''),
              trigger_type: pick(r.triggerType, ''),
              created_at: pick(r.createdAt, ''),
              execution_time_ms: Number(pick(r.timeTakenToExecuteWorkflow, 0)),
              input_data_size_bytes: Number(pick(r.inputDataSizeBytes, 0)),
              output_data_size_bytes: Number(pick(r.outputDataSizeBytes, 0)),
            }
          }

          function mapWorkflowTrigger(t) {
            t = t || {}
            var options = t.triggerOptions || {}
            return {
              id: pick(t.id, ''),
              trigger_type: pick(t.triggerType, ''),
              crontab: pick(options.crontab, ''),
              timezone: pick(options.timezone, ''),
              environment_id: pick(t.environmentId, ''),
            }
          }

          function mapWorkflowRelease(r) {
            r = r || {}
            return {
              version: pick(r.version, 0),
              deployer: pick(r.deployer, ''),
              created_at: pick(r.createdAt, ''),
            }
          }

          function mapEnvironment(e) {
            e = e || {}
            return {
              id: pick(e.id, ''),
              name: pick(e.name, ''),
              description: pick(e.description, ''),
              display_color: pick(e.displayColor, ''),
              is_default: pick(e.isDefault, false),
              organization_id: pick(e.organizationId, 0),
              created_at: pick(e.createdAt, ''),
              updated_at: pick(e.updatedAt, ''),
            }
          }

          function mapBranch(b) {
            b = b || {}
            return { name: pick(b.name, ''), created_at: pick(b.createdAt, ''), updated_at: pick(b.updatedAt, '') }
          }

          function mapSourceControlSettings(s) {
            s = s || {}
            return {
              enable_auto_branch_naming: pick(s.enableAutoBranchNaming, false),
              enable_custom_pull_request_template: pick(s.enableCustomPullRequestTemplate, false),
              version_control_locked: pick(s.versionControlLocked, false),
              enable_auto_cleanup_branches: pick(s.enableAutoCleanupBranches, false),
              disable_auto_catch_up_commits: pick(s.disableAutoCatchUpCommits, false),
            }
          }

          function mapUserSpace(s) {
            s = s || {}
            return {
              user_id: pick(s.userId, 0),
              org_id: pick(s.orgId, 0),
              space_name: pick(s.spaceName, ''),
              domain: pick(s.domain, ''),
              is_parent_org: pick(s.isParentOrg, false),
            }
          }

          function mapPlaygroundQuery(q) {
            q = q || {}
            return {
              id: pick(q.id, 0),
              name: pick(q.name, ''),
              uuid: pick(q.uuid, ''),
              query: pick(q.query, ''),
              resource_id: pick(q.resourceId, 0),
              resource_uuid: pick(q.resourceUuid, ''),
              shared: pick(q.shared, false),
              editor_name: pick(q.editorName, ''),
              created_at: pick(q.createdAt, ''),
              updated_at: pick(q.updatedAt, ''),
            }
          }

          function mapAgent(a) {
            a = a || {}
            return {
              id: pick(a.id, 0),
              name: pick(a.name, ''),
              uuid: pick(a.uuid, ''),
              description: pick(a.description, ''),
              created_at: pick(a.createdAt, ''),
              updated_at: pick(a.updatedAt, ''),
            }
          }

          function mapPageSave(s) {
            s = s || {}
            return {
              id: pick(s.id, 0),
              user_email: pick((s.user || {}).email, ''),
              commit_message: pick(s.commitMessage, ''),
              is_released: pick(s.isReleased, false),
              created_at: pick(s.createdAt, ''),
            }
          }

          function mapAppTag(t) {
            t = t || {}
            return { id: pick(t.id, 0), name: pick(t.name, ''), created_at: pick(t.createdAt, '') }
          }

          function mapGrid(g) {
            g = g || {}
            return {
              id: pick(g.id, ''),
              name: pick(g.name, ''),
              created_at: pick(g.createdAt, ''),
              updated_at: pick(g.updatedAt, ''),
            }
          }

          // Upstream handler for get_workflow_run_log (plugins/retool/src/tools/get-workflow-run-log.ts).
          var retoolToolImplementations = {
            async get_workflow_run_log(args) {
              var res = await api('/api/workflowRun/getLog?runId=' + args.run_id)
              if (!res.ok) return error(res.error_code, res.message)
              var data = res.data || {}
              return ok({
                status: pick(data.status, ''),
                logs: (data.logs || []).map(function (l) {
                  l = l || {}
                  return { message: pick(l.message, ''), timestamp: Number(pick(l.timestamp, 0)) }
                }),
              })
            },
          }
          async function stdin_default(args) {
            return retoolToolImplementations['get_workflow_run_log'](args)
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
            'The Retool tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Retool API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Retool tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
