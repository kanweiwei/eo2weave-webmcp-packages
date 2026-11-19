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
      "page_uuid": {
        "type": "string",
        "description": "UUID of the existing Retool app to overwrite"
      },
      "base64_zip": {
        "type": "string",
        "description": "Base64-encoded Toolscript ZIP archive"
      },
      "file_name": {
        "description": "Optional archive file name used for Retool parser diagnostics",
        "type": "string"
      },
      "branch_name": {
        "description": "Optional source-control branch name for direct saves. Defaults to the branch in the targeted editor URL, if present.",
        "type": "string"
      }
    },
    "required": [
      "page_uuid",
      "base64_zip"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "save_id": {
        "type": "number",
        "description": "ID of the new save record"
      },
      "success": {
        "type": "boolean",
        "description": "Whether the save succeeded"
      },
      "warnings": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Warning about Retool Toolscript import behavior"
        },
        "description": "Warnings about Retool Toolscript import limitations"
      }
    },
    "required": [
      "save_id",
      "success",
      "warnings"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'update_app_from_toolscript_archive',
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

          // --- Toolscript helpers (upstream src/toolscript.ts) ------------------------
          //
          // Retool compiles/parses Toolscript archives in the browser: the helper and codec
          // modules are the app's own hashed /assets_vjs/* chunks, discovered from loaded
          // scripts and the served bundles. The hashes below are upstream's fallbacks and
          // rotate with every Retool deploy — discovery normally wins.

          var KNOWN_TOOLSCRIPT_HELPER_PATH = '/assets_vjs/toolscriptHelpers-CViOCr-a.js'
          var KNOWN_MAIN_MODULE_PATH = '/assets_vjs/main-DNKK9RAp.js'
          var KNOWN_SEND_SAVE_MODULE_PATH = '/assets_vjs/sendSave-CM0VM8H0.js'
          var TOOLSCRIPT_HELPER_RE = /(?:\/assets_vjs\/|assets_vjs\/|\.\/)toolscriptHelpers-[A-Za-z0-9_-]+\.js/g
          var MAIN_MODULE_RE = /(?:\/assets_vjs\/|assets_vjs\/|\.\/)main-[A-Za-z0-9_-]+\.js/g
          var SEND_SAVE_MODULE_RE = /(?:\/assets_vjs\/|assets_vjs\/|\.\/)sendSave-[A-Za-z0-9_-]+\.js/g
          var SEND_SAVE_TYPE_PREFIX = 'changesRecordV2/sendSave'

          var TOOLSCRIPT_IMPORT_WARNINGS = [
            'Retool compiles Toolscript archives in the browser before saving. Some editor-only server state can still require opening the app in the editor, touching the affected property, and saving.',
            'Known affected state includes some query bodies/run modes, resource type changes, top-level modal or drawer reconciliation, table pagination add-ons, and drawer width.',
          ]

          function isRecord(value) {
            return typeof value === 'object' && value !== null
          }

          function hasGetMethod(value) {
            return isRecord(value) && typeof value.get === 'function'
          }

          function readProperty(value, key) {
            if (hasGetMethod(value)) return value.get(key)
            if (isRecord(value)) return value[key]
            return undefined
          }

          function readStringProperty(value, key) {
            var property = readProperty(value, key)
            return typeof property === 'string' ? property : null
          }

          function readNumberProperty(value, key) {
            var property = readProperty(value, key)
            return typeof property === 'number' ? property : undefined
          }

          function readTemplateFlag(template, key) {
            if (hasGetMethod(template)) return template.get(key) === true
            if (isRecord(template)) return template[key] === true
            return false
          }

          function toAbsoluteAssetUrl(assetSpecifier, baseUrl) {
            if (assetSpecifier.startsWith('./')) return new URL(assetSpecifier, baseUrl).href
            if (assetSpecifier.startsWith('assets_vjs/')) return new URL('/' + assetSpecifier, location.origin).href
            return new URL(assetSpecifier, location.origin).href
          }

          function isSameOriginAssetScript(url) {
            try {
              var parsed = new URL(url, location.href)
              return (
                parsed.origin === location.origin &&
                parsed.pathname.startsWith('/assets_vjs/') &&
                parsed.pathname.endsWith('.js')
              )
            } catch (e) {
              return false
            }
          }

          function getLoadedAssetScriptUrls() {
            var urls = []
            var seen = {}
            function add(href) {
              if (!href || seen[href]) return
              seen[href] = true
              urls.push(href)
            }
            if (typeof performance !== 'undefined' && performance && typeof performance.getEntriesByType === 'function') {
              var entries = performance.getEntriesByType('resource') || []
              for (var i = 0; i < entries.length; i++) {
                if (isSameOriginAssetScript(entries[i].name)) add(new URL(entries[i].name, location.href).href)
              }
            }
            var scripts = []
            try {
              scripts = Array.prototype.slice.call(document.querySelectorAll('script[src]') || [])
            } catch (e) {
              scripts = []
            }
            for (var s = 0; s < scripts.length; s++) {
              if (isSameOriginAssetScript(scripts[s].src)) add(new URL(scripts[s].src, location.href).href)
            }
            var links = []
            try {
              links = Array.prototype.slice.call(document.querySelectorAll('link[href]') || [])
            } catch (e) {
              links = []
            }
            for (var l = 0; l < links.length; l++) {
              if (isSameOriginAssetScript(links[l].href)) add(new URL(links[l].href, location.href).href)
            }
            return urls
          }

          function extractFirstAssetUrl(sourceText, sourceUrl, pattern) {
            var matches = String(sourceText).match(pattern)
            if (!matches) return null
            for (var i = 0; i < matches.length; i++) {
              if (matches[i]) return toAbsoluteAssetUrl(matches[i], sourceUrl)
            }
            return null
          }

          async function fetchAssetText(url) {
            try {
              var response = await fetch(url, { credentials: 'include' })
              if (!response.ok) return null
              return await response.text()
            } catch (e) {
              return null
            }
          }

          function orderDiscoveryCandidates(urls) {
            var priority = []
            var rest = []
            for (var i = 0; i < urls.length; i++) {
              if (/\/(sendSave|AppContainer|ImportAppModal)-/.test(urls[i])) priority.push(urls[i])
              else rest.push(urls[i])
            }
            return priority.concat(rest)
          }

          async function discoverToolscriptHelperUrl() {
            var loadedUrls = getLoadedAssetScriptUrls()
            var loadedHelperUrl = null
            for (var i = 0; i < loadedUrls.length; i++) {
              if (/\/toolscriptHelpers-[A-Za-z0-9_-]+\.js$/.test(loadedUrls[i])) {
                loadedHelperUrl = loadedUrls[i]
                break
              }
            }
            if (loadedHelperUrl) return loadedHelperUrl
            var candidates = orderDiscoveryCandidates(loadedUrls)
            for (var c = 0; c < candidates.length; c++) {
              var sourceText = await fetchAssetText(candidates[c])
              if (!sourceText) continue
              var discoveredUrl = extractFirstAssetUrl(sourceText, candidates[c], TOOLSCRIPT_HELPER_RE)
              if (discoveredUrl) return discoveredUrl
            }
            return new URL(KNOWN_TOOLSCRIPT_HELPER_PATH, location.origin).href
          }

          async function discoverMainModuleUrl(helperUrl) {
            var helperText = await fetchAssetText(helperUrl)
            if (helperText) {
              var discoveredUrl = extractFirstAssetUrl(helperText, helperUrl, MAIN_MODULE_RE)
              if (discoveredUrl) return discoveredUrl
            }
            var loadedUrls = getLoadedAssetScriptUrls()
            for (var i = 0; i < loadedUrls.length; i++) {
              if (/\/main-[A-Za-z0-9_-]+\.js$/.test(loadedUrls[i])) return loadedUrls[i]
            }
            return new URL(KNOWN_MAIN_MODULE_PATH, location.origin).href
          }

          async function discoverSendSaveModuleUrl() {
            var loadedUrls = getLoadedAssetScriptUrls()
            for (var i = 0; i < loadedUrls.length; i++) {
              if (/\/sendSave-[A-Za-z0-9_-]+\.js$/.test(loadedUrls[i])) return loadedUrls[i]
            }
            var candidates = orderDiscoveryCandidates(loadedUrls)
            for (var c = 0; c < candidates.length; c++) {
              var sourceText = await fetchAssetText(candidates[c])
              if (!sourceText) continue
              var discoveredUrl = extractFirstAssetUrl(sourceText, candidates[c], SEND_SAVE_MODULE_RE)
              if (discoveredUrl) return discoveredUrl
            }
            return new URL(KNOWN_SEND_SAVE_MODULE_PATH, location.origin).href
          }

          async function loadToolscriptRuntime() {
            var helperUrl = await discoverToolscriptHelperUrl()
            var helperModule = await import(helperUrl)
            if (
              typeof helperModule.deserializeToolscriptArchive !== 'function' ||
              typeof helperModule.serializeToolscriptArchive !== 'function'
            ) {
              throw new Error('Retool Toolscript helper module did not expose the expected archive functions.')
            }
            var mainModuleUrl = await discoverMainModuleUrl(helperUrl)
            var mainModule = await import(mainModuleUrl)
            var transit = mainModule.G ? mainModule.G() : null
            if (!transit || typeof transit.toJSON !== 'function') {
              throw new Error('Retool Transit codec module did not expose the expected toJSON function.')
            }
            return { helpers: helperModule, transit: transit }
          }

          function isRetoolStore(value) {
            return isRecord(value) && typeof value.dispatch === 'function' && typeof value.getState === 'function'
          }

          function findRetoolStore(mainModule) {
            var values = Object.keys(mainModule || {}).map(function (key) {
              return mainModule[key]
            })
            for (var i = 0; i < values.length; i++) if (isRetoolStore(values[i])) return values[i]
            for (var j = 0; j < values.length; j++) {
              if (!isRecord(values[j])) continue
              if (isRetoolStore(values[j].store)) return values[j].store
            }
            return null
          }

          function findSaveActionCreator(saveModule) {
            var values = Object.keys(saveModule || {}).map(function (key) {
              return saveModule[key]
            })
            for (var i = 0; i < values.length; i++) {
              if (typeof values[i] === 'function' && values[i].typePrefix === SEND_SAVE_TYPE_PREFIX) return values[i]
            }
            return null
          }

          function findToolscriptImportActionCreator(saveModule) {
            var values = Object.keys(saveModule || {}).map(function (key) {
              return saveModule[key]
            })
            for (var i = 0; i < values.length; i++) {
              if (typeof values[i] !== 'function') continue
              var source = Function.prototype.toString.call(values[i])
              if (
                source.indexOf('deserializeToolscriptArchive') !== -1 &&
                source.indexOf('prepareAppStateForFrontend') !== -1 &&
                source.indexOf('imported') !== -1
              ) {
                return values[i]
              }
            }
            return null
          }

          function readCurrentPageUuid(state) {
            var pages = readProperty(state, 'pages')
            return readStringProperty(pages, 'currentPageUuid') || readStringProperty(pages, 'pageUuid')
          }

          function readCurrentSaveId(state) {
            var multiplayer = readProperty(state, 'multiplayer')
            return readNumberProperty(multiplayer, 'currentPageSaveId')
          }

          function extractSaveId(action) {
            var payload = readProperty(action, 'payload')
            var innerPayload = readProperty(payload, 'payload')
            var innerSave = readProperty(innerPayload, 'save')
            var directSave = readProperty(payload, 'save')
            var rootSave = readProperty(action, 'save')
            var found =
              readNumberProperty(innerSave, 'id') !== undefined
                ? readNumberProperty(innerSave, 'id')
                : readNumberProperty(directSave, 'id') !== undefined
                  ? readNumberProperty(directSave, 'id')
                  : readNumberProperty(rootSave, 'id')
            return found === undefined ? null : found
          }

          function readActionType(action) {
            return readStringProperty(action, 'type')
          }

          function readRejectedActionMessage(action) {
            var err = readProperty(action, 'error')
            var errorMessage = readStringProperty(err, 'message')
            if (errorMessage) return errorMessage
            var payload = readProperty(action, 'payload')
            var payloadPayload = readProperty(payload, 'payload')
            var nestedPayload = readProperty(payloadPayload, 'payload')
            return (
              readStringProperty(payload, 'message') ||
              readStringProperty(payloadPayload, 'message') ||
              readStringProperty(nestedPayload, 'message') ||
              'Retool rejected the editor save.'
            )
          }

          function readFailureActionMessage(action) {
            var payload = readProperty(action, 'payload')
            var payloadType = readStringProperty(payload, 'type')
            if (payloadType && payloadType.indexOf('FAILURE_') === 0) return readRejectedActionMessage(action)
            return null
          }

          function normalizeBase64(base64) {
            var text = String(base64 == null ? '' : base64)
            var commaIndex = text.indexOf(',')
            var rawBase64 = text.indexOf('data:') === 0 && commaIndex >= 0 ? text.slice(commaIndex + 1) : text
            return rawBase64.replace(/\s/g, '')
          }

          function ensureZipFileName(fileName) {
            var sanitized = String(fileName == null ? '' : fileName)
              .replace(/^\s+|\s+$/g, '')
              .replace(/[\\/]/g, '_')
            if (!sanitized) sanitized = 'retool-app'
            return sanitized.toLowerCase().endsWith('.zip') ? sanitized : sanitized + '.zip'
          }

          // Deviation: the base64 shape is checked before decoding so a malformed archive
          // reports VALIDATION on every engine instead of depending on atob's strictness.
          function base64ToZipFile(base64, fileName) {
            var raw = normalizeBase64(base64)
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) {
              return {
                error: 'Invalid base64_zip value. Provide a raw base64-encoded ZIP archive or a data URL.',
              }
            }
            var binary
            try {
              binary = atob(raw)
            } catch (e) {
              return {
                error: 'Invalid base64_zip value. Provide a raw base64-encoded ZIP archive or a data URL.',
              }
            }
            var bytes = new Uint8Array(binary.length)
            for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
            return { file: new File([bytes], ensureZipFileName(fileName), { type: ZIP_MIME_TYPE }) }
          }

          async function blobToBase64(blob) {
            var bytes = new Uint8Array(await blob.arrayBuffer())
            var binary = ''
            var chunkSize = 0x8000
            for (var offset = 0; offset < bytes.length; offset += chunkSize) {
              var chunk = bytes.subarray(offset, offset + chunkSize)
              binary += String.fromCharCode.apply(null, chunk)
            }
            return btoa(binary)
          }

          function downloadBlob(blob, fileName) {
            var url = URL.createObjectURL(blob)
            var anchor = document.createElement('a')
            anchor.href = url
            anchor.download = ensureZipFileName(fileName)
            anchor.style.display = 'none'
            document.body.append(anchor)
            anchor.click()
            anchor.remove()
            URL.revokeObjectURL(url)
          }

          function formatToolscriptErrors(ctx) {
            if (typeof ctx.formatErrors === 'function') return ctx.formatErrors()
            return 'Retool reported errors while deserializing the Toolscript archive.'
          }

          async function serializeToolscriptArchive(input) {
            var runtime = await loadToolscriptRuntime()
            return runtime.helpers.serializeToolscriptArchive({
              exportData: {
                uuid: input.exportData.uuid,
                page: input.exportData.page,
                modules: input.exportData.modules || {},
              },
              pageUuid: input.pageUuid,
              experiments: { perPagePositionJsonFiles: input.perPagePositionJsonFiles },
            })
          }

          async function compileToolscriptArchive(base64Zip, fileName) {
            // Deviation: decode/validate the archive first (see base64ToZipFile) so a malformed
            // base64_zip is a validation error even when the helper chunks are not loaded yet.
            var decoded = base64ToZipFile(base64Zip, fileName)
            if (decoded.error) return { error: decoded.error }
            var runtime = await loadToolscriptRuntime()
            var result = await runtime.helpers.deserializeToolscriptArchive(decoded.file)
            var ctx = result.ctx
            var output = result.output
            if (ctx && ctx.hasErrors) return { error: formatToolscriptErrors(ctx) }
            if (!output || !output.appTemplate) {
              return { error: 'Toolscript archive did not contain an app template.' }
            }
            return {
              appState: runtime.transit.toJSON(output.appTemplate),
              isGlobalWidget: readTemplateFlag(output.appTemplate, 'isGlobalWidget'),
              isMobileApp: readTemplateFlag(output.appTemplate, 'isMobileApp'),
              multiScreenMobileApp: readTemplateFlag(output.appTemplate, 'multiScreenMobileApp'),
              warnings: TOOLSCRIPT_IMPORT_WARNINGS.slice(),
            }
          }

          async function forceEditorSave(pageUuid, trigger) {
            var sendSaveUrl = await discoverSendSaveModuleUrl()
            var helperUrl = await discoverToolscriptHelperUrl()
            var mainModuleUrl = await discoverMainModuleUrl(helperUrl)
            var saveModule = await import(sendSaveUrl)
            var mainModule = await import(mainModuleUrl)
            var store = findRetoolStore(mainModule)
            if (!store) return { error: 'Retool editor store was not available in this tab.' }
            var saveActionCreator = findSaveActionCreator(saveModule)
            if (!saveActionCreator) return { error: 'Retool editor save action was not available in this tab.' }
            var beforeState = store.getState()
            var currentPageUuid = readCurrentPageUuid(beforeState)
            if (!currentPageUuid) {
              return { error: 'This tool must target an open Retool editor tab with a loaded app.', code: 'VALIDATION' }
            }
            if (currentPageUuid !== pageUuid) {
              return {
                error: 'Targeted editor is loaded for page ' + currentPageUuid + ', not requested page ' + pageUuid + '.',
                code: 'VALIDATION',
              }
            }
            var previousSaveId = readCurrentSaveId(beforeState)
            var action = await Promise.resolve(store.dispatch(saveActionCreator({ trigger: trigger, forceSave: true, waitForCompletion: true })))
            var actionType = readActionType(action)
            if (actionType && actionType.slice(-9) === '/rejected') return { error: readRejectedActionMessage(action) }
            var failureMessage = readFailureActionMessage(action)
            if (failureMessage) return { error: failureMessage }
            var saveId = extractSaveId(action)
            if (!saveId) return { error: 'Retool editor save completed without returning a save ID.' }
            return { currentPageUuid: currentPageUuid, previousSaveId: previousSaveId, saveId: saveId }
          }

          async function importToolscriptArchiveThroughEditor(input) {
            var sendSaveUrl = await discoverSendSaveModuleUrl()
            var helperUrl = await discoverToolscriptHelperUrl()
            var mainModuleUrl = await discoverMainModuleUrl(helperUrl)
            var saveModule = await import(sendSaveUrl)
            var mainModule = await import(mainModuleUrl)
            var store = findRetoolStore(mainModule)
            if (!store) return { error: 'Retool editor store was not available in this tab.' }
            var importActionCreator = findToolscriptImportActionCreator(saveModule)
            if (!importActionCreator) return { error: 'Retool editor Toolscript import action was not available.' }
            var beforeState = store.getState()
            var currentPageUuid = readCurrentPageUuid(beforeState)
            if (!currentPageUuid) {
              return { error: 'This tool must target an open Retool editor tab with a loaded app.', code: 'VALIDATION' }
            }
            if (currentPageUuid !== input.pageUuid) {
              return {
                error:
                  'Targeted editor is loaded for page ' + currentPageUuid + ', not requested page ' + input.pageUuid + '.',
                code: 'VALIDATION',
              }
            }
            var previousSaveId = readCurrentSaveId(beforeState)
            var saveId = null
            var dispatchAndCaptureSave = async function (action) {
              var result = await Promise.resolve(store.dispatch(action))
              var actionType = readActionType(result)
              if (actionType && actionType.slice(-9) === '/rejected') throw new Error(readRejectedActionMessage(result))
              var failureMessage = readFailureActionMessage(result)
              if (failureMessage) throw new Error(failureMessage)
              var resultSaveId = extractSaveId(result)
              if (resultSaveId) saveId = resultSaveId
              return result
            }
            var decoded = base64ToZipFile(input.base64Zip, input.fileName)
            if (decoded.error) return { error: decoded.error, code: 'VALIDATION' }
            await Promise.resolve(importActionCreator(decoded.file, input.isMobileApp)(dispatchAndCaptureSave))
            var currentSaveId = saveId || readCurrentSaveId(store.getState())
            if (!currentSaveId || currentSaveId === previousSaveId) return forceEditorSave(input.pageUuid, 'imported')
            return { currentPageUuid: currentPageUuid, previousSaveId: previousSaveId, saveId: currentSaveId }
          }

          function isCurrentTabEditorForPage(pageUuid) {
            var encodedPageUuid = encodeURIComponent(pageUuid)
            var pathName = pagePathname()
            return pathName.indexOf('/editor/' + encodedPageUuid) !== -1 || pathName.indexOf('/editor/' + pageUuid) !== -1
          }

          // Upstream handler for update_app_from_toolscript_archive (plugins/retool/src/tools/update-app-from-toolscript-archive.ts).
          var retoolToolImplementations = {
            async update_app_from_toolscript_archive(args) {
              var fileName = ensureZipFileName(args.file_name || args.page_uuid + '.zip')
              var compiled
              try {
                compiled = await compileToolscriptArchive(args.base64_zip, fileName)
              } catch (e) {
                return error('INTERNAL', 'Retool Toolscript compiler failed: ' + String(e && e.message ? e.message : e))
              }
              if (compiled.error) return error('VALIDATION', compiled.error)
              var branchName = args.branch_name || getCurrentSourceControlBranchName() || undefined
              var getResp = await api('/api/pages/uuids/' + args.page_uuid, { query: { branchName: branchName } })
              if (!getResp.ok) return error(getResp.error_code, getResp.message)
              var page = pageRecord(getResp.data)
              if (typeof page.isMobileApp === 'boolean' && page.isMobileApp !== compiled.isMobileApp) {
                return error('VALIDATION', 'Toolscript archive app type does not match the target app mobile/web type.')
              }
              if (typeof page.isGlobalWidget === 'boolean' && page.isGlobalWidget !== compiled.isGlobalWidget) {
                return error('VALIDATION', 'Toolscript archive module/app type does not match the target app type.')
              }
              if (isCurrentTabEditorForPage(args.page_uuid)) {
                var editorSave
                try {
                  editorSave = await importToolscriptArchiveThroughEditor({
                    base64Zip: args.base64_zip,
                    fileName: fileName,
                    pageUuid: args.page_uuid,
                    isMobileApp: compiled.isMobileApp,
                  })
                } catch (e) {
                  return error('INTERNAL', 'Retool editor import failed: ' + String(e && e.message ? e.message : e))
                }
                if (editorSave.error) return error(editorSave.code || 'INTERNAL', editorSave.error)
                return ok({ save_id: editorSave.saveId, success: true, warnings: compiled.warnings })
              }
              var saveResp = await api('/api/pages/uuids/' + args.page_uuid + '/save', {
                method: 'POST',
                body: {
                  appState: compiled.appState,
                  branchName: branchName === undefined ? null : branchName,
                  changesRecordV2: { changes: [], numUntrackedActionsTriggered: 1, isCopilotMode: false },
                  saveValidationInfo: {
                    multiplayerSessionId: pick(page.multiplayerSessionId, null),
                    pageSaveId: pick(page.id, null),
                  },
                  isCopilotGenerated: false,
                  subflowsDiff: null,
                  saveAppTesting: false,
                },
              })
              if (!saveResp.ok) return error(saveResp.error_code, saveResp.message)
              return ok({ save_id: saveResponseId(saveResp.data), success: true, warnings: compiled.warnings })
            },
          }
          async function stdin_default(args) {
            return retoolToolImplementations['update_app_from_toolscript_archive'](args)
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
