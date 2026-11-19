// Self-contained adapter workflow. The Grafana session cookie and every /api
// call stay inside the Grafana tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "uid": {
        "type": "string",
        "description": "UID of the alert rule to delete"
      }
    },
    "required": [
      "uid"
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
    description: 'delete_alert_rule',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Grafana runtime (translated from OpenTabs grafana-api.ts,
          // tools/schemas.ts and plugins/grafana/src/tools/*, MIT). Runs INSIDE the
          // Grafana tab: the browser's own first-party Grafana session cookie is the only
          // credential, every call is a same-origin /api request, and no cookie/token is
          // ever read out of the page.
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

          // Grafana renders window.grafanaBootData into every index.html it serves; the
          // signed-in user lives at grafanaBootData.user — the exact global upstream's
          // getBootUser()/isAuthenticated() read.
          function getBootData() {
            var boot = getPageGlobal('grafanaBootData')
            return boot && typeof boot === 'object' ? boot : null
          }

          function getBootUser() {
            var boot = getBootData()
            if (!boot) return null
            var user = boot.user
            return user && typeof user === 'object' ? user : null
          }

          function isAuthenticated() {
            var user = getBootUser()
            return !!(user && user.isSignedIn === true)
          }

          function sleep(ms) {
            return new Promise(function (resolve) {
              setTimeout(resolve, ms)
            })
          }

          // Upstream waitForAuth(): poll isAuthenticated() every 500ms for up to 5s. It is
          // only reached when the tab has not rendered its boot data yet — once
          // grafanaBootData exists the answer cannot change without a page reload, so the
          // wait is skipped instead of stalling a logged-out call for 5s.
          async function waitForAuth(interval, timeout) {
            var deadline = Date.now() + timeout
            while (Date.now() < deadline) {
              if (isAuthenticated()) return true
              await sleep(interval)
              if (getBootData()) return isAuthenticated()
            }
            return isAuthenticated()
          }

          async function ensureAuth() {
            if (isAuthenticated()) return null
            if (getBootData()) return error('AUTH', 'Not authenticated — please log in to Grafana.')
            var signedIn = await waitForAuth(500, 5000)
            if (signedIn) return null
            return error('AUTH', 'Not authenticated — please log in to Grafana.')
          }

          function isGrafanaHost(host) {
            if (!host) return false
            if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
            if (host === 'grafana.net' || host.indexOf('.grafana.net') !== -1) return true
            // Self-hosted instances usually carry the product name (grafana.internal,
            // grafana.example.com, obs-grafana.corp.example).
            return host.indexOf('grafana') !== -1
          }

          // Grafana is self-hosted: upstream ships urlPatterns: [] and takes the instance
          // URL from config, so no host can be hardcoded here. A tab is a Grafana tab when
          // its host is a Grafana-looking one, or when the page itself proves it by
          // exposing grafanaBootData (an arbitrary host, e.g. monitoring.example.com).
          function assertPage() {
            var host = (typeof location !== 'undefined' && location && location.hostname) || ''
            if (!host) return error('UNSUPPORTED_PAGE', 'Not on a Grafana page.')
            if (isGrafanaHost(host)) return null
            var boot = getBootData()
            if (boot && (boot.user || boot.settings)) return null
            return error('UNSUPPORTED_PAGE', 'Not on a Grafana page.')
          }

          // SDK buildQueryString: undefined values are dropped, arrays append once per item.
          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var key = keys[i]
              var value = query[key]
              if (value === undefined) continue
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++) params.append(key, String(value[j]))
              } else {
                params.append(key, String(value))
              }
            }
            return params.toString()
          }

          // Same classification as the SDK's httpStatusToToolError.
          function errorCodeForStatus(status) {
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP'
          }

          function describeBody(text) {
            if (!text) return ''
            try {
              var parsed = JSON.parse(text)
              if (parsed && typeof parsed === 'object') {
                var detail = parsed.message || parsed.error || parsed.reason || parsed.messageId
                if (typeof detail === 'string' && detail) return detail
              }
            } catch (e) {}
            return text.length > 512 ? text.slice(0, 512) + '…' : text
          }

          // Grafana serves its API under the instance's own sub-path when it is mounted
          // that way (settings.appSubUrl, e.g. '/grafana'); upstream's hardcoded relative
          // '/api' only resolves at the origin root, so the tab's own boot data decides.
          function apiBasePath() {
            var boot = getBootData()
            var settings = (boot && boot.settings) || {}
            var sub = typeof settings.appSubUrl === 'string' ? settings.appSubUrl : ''
            if (sub.indexOf('://') !== -1) {
              var match = /^[a-z]+:\/\/[^/]+(\/.*)?$/i.exec(sub)
              sub = match && match[1] ? match[1] : ''
            }
            sub = sub.replace(/\/+$/, '')
            return sub + '/api'
          }

          // Upstream api(): '/api' + endpoint against the instance the tab is on, JSON
          // Accept header, JSON body when one is supplied. Grafana authenticates these
          // same-origin calls with the first-party session cookie, and upstream sends no
          // CSRF header (grafanaBootData carries no token), so none is invented here.
          // The in-page fetch aborts after 18s so it always settles inside the adapter's
          // 25s command window.
          async function api(endpoint, options) {
            options = options || {}
            var pageError = assertPage()
            if (pageError) return pageError
            var authError = await ensureAuth()
            if (authError) return authError

            var method = options.method || 'GET'
            var headers = { Accept: 'application/json' }
            var body
            if (options.body !== undefined) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(options.body)
            }
            var path = apiBasePath() + endpoint
            if (options.query) {
              var qs = buildQueryString(options.query)
              if (qs) path += '?' + qs
            }
            var url = String(location.origin || '') + path

            var abortController = null
            if (typeof AbortController === 'function') {
              try {
                abortController = new AbortController()
              } catch (e) {}
            }
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
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'Grafana request aborted after the 18s in-page deadline.'
                  : 'Network error calling Grafana: ' + String(e),
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
              var message = 'Grafana API error (' + response.status + ') for ' + path
              var detail = describeBody(text)
              if (detail) message += ': ' + detail
              var result = {
                ok: false,
                error_code: errorCodeForStatus(response.status),
                status: response.status,
                message: message,
              }
              try {
                var retryAfter = response.headers.get('Retry-After')
                if (response.status === 429 && retryAfter) result.retry_after = retryAfter
              } catch (e) {}
              return result
            }
            try {
              var data = await response.json()
              if (abortTimer !== null) clearTimeout(abortTimer)
              return { ok: true, data: data }
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              return {
                ok: false,
                error_code: 'VALIDATION',
                message: 'Grafana returned a non-JSON body for ' + path,
              }
            }
          }

          function asArray(value) {
            return Array.isArray(value) ? value : []
          }

          // --- mappers (OpenTabs plugins/grafana/src/tools/schemas.ts) ---
          function mapUser(u) {
            u = u || {}
            return {
              id: u.id === undefined || u.id === null ? 0 : u.id,
              uid: u.uid || '',
              login: u.login || '',
              name: u.name || '',
              email: u.email || '',
              org_id: u.orgId === undefined || u.orgId === null ? 0 : u.orgId,
              is_grafana_admin: u.isGrafanaAdmin === undefined ? false : !!u.isGrafanaAdmin,
              is_disabled: u.isDisabled === undefined ? false : !!u.isDisabled,
              avatar_url: u.avatarUrl || '',
              created_at: u.createdAt || '',
              updated_at: u.updatedAt || '',
            }
          }

          function mapOrg(o) {
            o = o || {}
            var address = o.address || {}
            return {
              id: o.id === undefined || o.id === null ? 0 : o.id,
              name: o.name || '',
              address1: address.address1 || '',
              address2: address.address2 || '',
              city: address.city || '',
              state: address.state || '',
              zip_code: address.zipCode || '',
              country: address.country || '',
            }
          }

          function mapOrgMember(m) {
            m = m || {}
            return {
              user_id: m.userId === undefined || m.userId === null ? 0 : m.userId,
              uid: m.uid || '',
              login: m.login || '',
              name: m.name || '',
              email: m.email || '',
              role: m.role || '',
              last_seen_at: m.lastSeenAt || '',
              is_disabled: m.isDisabled === undefined ? false : !!m.isDisabled,
            }
          }

          function mapQuota(q) {
            q = q || {}
            return {
              target: q.target || '',
              limit: q.limit === undefined || q.limit === null ? 0 : q.limit,
              used: q.used === undefined || q.used === null ? 0 : q.used,
            }
          }

          function mapDashboardSearch(d) {
            d = d || {}
            return {
              id: d.id === undefined || d.id === null ? 0 : d.id,
              uid: d.uid || '',
              title: d.title || '',
              url: d.url || '',
              type: d.type || '',
              tags: d.tags || [],
              is_starred: d.isStarred === undefined ? false : !!d.isStarred,
              folder_uid: d.folderUid || '',
              folder_title: d.folderTitle || '',
            }
          }

          function mapDashboard(r) {
            r = r || {}
            var dashboard = r.dashboard || {}
            var meta = r.meta || {}
            return {
              uid: dashboard.uid || '',
              title: dashboard.title || '',
              url: meta.url || '',
              version: meta.version === undefined || meta.version === null ? 0 : meta.version,
              folder_uid: meta.folderUid || '',
              folder_title: meta.folderTitle || '',
              created: meta.created || '',
              updated: meta.updated || '',
              created_by: meta.createdBy || '',
              updated_by: meta.updatedBy || '',
              can_save: meta.canSave === undefined ? false : !!meta.canSave,
              can_edit: meta.canEdit === undefined ? false : !!meta.canEdit,
              can_admin: meta.canAdmin === undefined ? false : !!meta.canAdmin,
              can_delete: meta.canDelete === undefined ? false : !!meta.canDelete,
              tags: dashboard.tags || [],
              panel_count: Array.isArray(dashboard.panels) ? dashboard.panels.length : 0,
            }
          }

          function mapFolder(f) {
            f = f || {}
            return {
              id: f.id === undefined || f.id === null ? 0 : f.id,
              uid: f.uid || '',
              title: f.title || '',
              url: f.url || '',
              created: f.created || '',
              updated: f.updated || '',
              created_by: f.createdBy || '',
              updated_by: f.updatedBy || '',
            }
          }

          function mapDatasource(d) {
            d = d || {}
            return {
              id: d.id === undefined || d.id === null ? 0 : d.id,
              uid: d.uid || '',
              name: d.name || '',
              type: d.type || '',
              type_name: d.typeName || '',
              url: d.url || '',
              is_default: d.isDefault === undefined ? false : !!d.isDefault,
              read_only: d.readOnly === undefined ? false : !!d.readOnly,
              access: d.access || '',
            }
          }

          function mapAlertRule(r) {
            r = r || {}
            return {
              id: r.id === undefined || r.id === null ? 0 : r.id,
              uid: r.uid || '',
              title: r.title || '',
              condition: r.condition || '',
              folder_uid: r.folderUID || '',
              rule_group: r.ruleGroup || '',
              exec_err_state: r.execErrState || '',
              no_data_state: r.noDataState || '',
              for_duration: r.for || '',
              is_paused: r.isPaused === undefined ? false : !!r.isPaused,
              updated: r.updated || '',
            }
          }

          function mapAnnotation(a) {
            a = a || {}
            return {
              id: a.id === undefined || a.id === null ? 0 : a.id,
              dashboard_id: a.dashboardId === undefined || a.dashboardId === null ? 0 : a.dashboardId,
              dashboard_uid: a.dashboardUID || '',
              panel_id: a.panelId === undefined || a.panelId === null ? 0 : a.panelId,
              text: a.text || '',
              tags: a.tags || [],
              time: a.time === undefined || a.time === null ? 0 : a.time,
              time_end: a.timeEnd === undefined || a.timeEnd === null ? 0 : a.timeEnd,
              created: a.created === undefined || a.created === null ? 0 : a.created,
              updated: a.updated === undefined || a.updated === null ? 0 : a.updated,
            }
          }

          function mapTeam(t) {
            t = t || {}
            return {
              id: t.id === undefined || t.id === null ? 0 : t.id,
              uid: t.uid || '',
              name: t.name || '',
              email: t.email || '',
              member_count: t.memberCount === undefined || t.memberCount === null ? 0 : t.memberCount,
              org_id: t.orgId === undefined || t.orgId === null ? 0 : t.orgId,
            }
          }

          function mapTeamMember(m) {
            m = m || {}
            return {
              user_id: m.userId === undefined || m.userId === null ? 0 : m.userId,
              login: m.login || '',
              email: m.email || '',
              name: m.name || '',
              permission: m.permission === undefined || m.permission === null ? 0 : m.permission,
            }
          }

          function mapContactPoint(c) {
            c = c || {}
            return {
              uid: c.uid || '',
              name: c.name || '',
              type: c.type || '',
              disable_resolve_message: c.disableResolveMessage === undefined ? false : !!c.disableResolveMessage,
              provenance: c.provenance || '',
            }
          }

          function mapServiceAccount(s) {
            s = s || {}
            return {
              id: s.id === undefined || s.id === null ? 0 : s.id,
              uid: s.uid || '',
              name: s.name || '',
              login: s.login || '',
              role: s.role || '',
              is_disabled: s.isDisabled === undefined ? false : !!s.isDisabled,
              tokens: s.tokens === undefined || s.tokens === null ? 0 : s.tokens,
            }
          }

          function mapSnapshot(s) {
            s = s || {}
            return {
              id: s.id === undefined || s.id === null ? 0 : s.id,
              name: s.name || '',
              key: s.key || '',
              external: s.external === undefined ? false : !!s.external,
              expires: s.expires || '',
            }
          }

          // --- envelope ---
          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }

          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }

          var grafanaToolImplementations = {
            async delete_alert_rule(args) {
              var res = await api('/v1/provisioning/alert-rules/' + encodeURIComponent(args.uid), {
                method: 'DELETE',
              })
              if (!res.ok) return res
              return ok({ success: true })
            },
          }

          async function stdin_default(args) {
            return grafanaToolImplementations['delete_alert_rule'](args)
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
        // Tab closed/navigated or the eval timed out: surface a stable workflow
        // error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The Grafana tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Grafana API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Grafana tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
