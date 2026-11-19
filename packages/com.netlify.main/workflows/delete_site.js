// Self-contained adapter workflow. Every app.netlify.com API call stays inside the Netlify tab:
// the first-party session cookies ride along (credentials: 'include'), the login hint is the page's
// own `_nf-auth-hint` cookie, and the base is the same-origin /access-control/bb-api/api/v1 path the
// Netlify dashboard itself uses — no token ever leaves the page.
//
// Ported from the OpenTabs netlify plugin (plugins/netlify/src, MIT): same endpoint for delete_site,
// same query/body, same defensive mappers, same error classification.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "site_id": {
        "type": "string",
        "description": "The site ID to delete"
      }
    },
    "required": [
      "site_id"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean",
        "description": "Whether the operation succeeded"
      }
    },
    "required": [
      "success"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'delete_site',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
                  // Page-side Netlify runtime (translated from OpenTabs plugins/netlify/src/netlify-api.ts,
                  // src/tools/schemas.ts and the 40 tool handlers, MIT). Runs INSIDE the app.netlify.com tab:
                  // the HttpOnly session cookies (`_nf-auth`, `connect.sid`) ride along via
                  // credentials: 'include', the login hint is the page's own non-HttpOnly
                  // `_nf-auth-hint` cookie, and every call is a same-origin
                  // /access-control/bb-api/api/v1 fetch — no token ever leaves the page.

                  var API_BASE = '/access-control/bb-api/api/v1'

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

                  // Upstream's isAuthenticated(): Netlify sets the non-HttpOnly hint cookie to
                  // "user-is-likely-authed" whenever a session exists. The session cookies
                  // themselves are HttpOnly, so they are never read or copied here.
                  function isAuthenticated() {
                    return getCookie('_nf-auth-hint') === 'user-is-likely-authed'
                  }

                  function assertPage() {
                    var host = location.hostname || ''
                    if (!host) return error('UNSUPPORTED_PAGE', 'Not on a Netlify page.')
                    if (host === 'app.netlify.com') return null
                    return error('UNSUPPORTED_PAGE', 'Not on the Netlify dashboard (app.netlify.com).')
                  }

                  // Upstream's buildQueryString(): undefined keys are dropped, everything else
                  // is stringified. Numbers arrive as numbers, so `page=2` — not `page=2.0`.
                  function buildQuery(query) {
                    if (!query) return ''
                    var params = new URLSearchParams()
                    var keys = Object.keys(query)
                    for (var i = 0; i < keys.length; i++) {
                      var value = query[keys[i]]
                      if (value === undefined) continue
                      params.append(keys[i], String(value))
                    }
                    return params.toString()
                  }

                  // OpenTabs' httpStatusToToolError(), mapped onto the adapter's error_code
                  // vocabulary: 401/403 auth, 404 not_found, 429 rate_limit, 400/422
                  // validation, 408 timeout, 5xx internal, other 4xx http_error.
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
                    var detail = body || ''
                    var code = classifyStatus(response.status)
                    var suffix = detail ? ' — ' + detail : ''
                    if (code === 'AUTH') return 'Auth error (' + response.status + '): ' + endpoint + suffix
                    if (code === 'NOT_FOUND') return 'Not found: ' + endpoint + suffix
                    if (code === 'RATE_LIMITED') {
                      var wait = retryAfter(response)
                      return 'Rate limited: ' + endpoint + (wait ? ' (retry after ' + wait + ')' : '') + suffix
                    }
                    if (code === 'VALIDATION') return 'Validation error (' + response.status + '): ' + endpoint + suffix
                    if (code === 'TIMEOUT') return 'Request timed out (' + response.status + '): ' + endpoint + suffix
                    return 'Netlify API error (' + response.status + '): ' + endpoint + suffix
                  }

                  // One same-origin fetch: page cookies, JSON in, JSON (or 204 → {}) out,
                  // aborted after 18s so it always settles inside the adapter's 25s window
                  // (upstream uses fetchJSON's 30s AbortSignal.timeout). Bodies are truncated
                  // to 512 chars in errors, like the SDK's MAX_ERROR_BODY_LENGTH.
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
                          ? 'Netlify request aborted after the 18s in-page deadline: ' + endpoint
                          : 'Network error calling Netlify: ' + String(err),
                      }
                    }
                    if (timer !== null) clearTimeout(timer)
                    // The SDK treats 204 / empty bodies as "no data"; delete tools ignore it.
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
                    try {
                      return { ok: true, data: await response.json() }
                    } catch (e) {
                      return { ok: false, error_code: 'PARSE', message: 'Netlify returned invalid JSON: ' + endpoint }
                    }
                  }

                  // Faithful translation of OpenTabs api(): the JSON body (and only then the
                  // Content-Type header) is set exactly as upstream does. Upstream sends no
                  // CSRF header for Netlify — the bb-api trusts the first-party session
                  // cookies plus same-origin, so none is invented here.
                  async function api(endpoint, options) {
                    options = options || {}
                    if (!isAuthenticated())
                      return {
                        ok: false,
                        error_code: 'UNAUTHENTICATED',
                        message: 'Not authenticated — log in to Netlify (the _nf-auth-hint cookie is missing).',
                      }
                    var url = API_BASE + endpoint
                    var qs = buildQuery(options.query)
                    if (qs) url += '?' + qs
                    var headers = {}
                    var body
                    if (options.body) {
                      headers['Content-Type'] = 'application/json'
                      body = JSON.stringify(options.body)
                    }
                    return request(url, endpoint, { method: options.method || 'GET', headers: headers, body: body })
                  }

                  function listOf(data) {
                    if (Array.isArray(data)) return data
                    if (data && Array.isArray(data.items)) return data.items
                    return []
                  }

                  // --- mappers (OpenTabs src/tools/schemas.ts) ---

                  function mapUser(u) {
                    u = u || {}
                    return {
                      id: pick(u.id, ''),
                      full_name: pick(u.full_name, ''),
                      email: pick(u.email, ''),
                      avatar_url: pick(u.avatar_url, ''),
                      site_count: pick(u.site_count, 0),
                      created_at: pick(u.created_at, ''),
                      last_login: pick(u.last_login, ''),
                      login_providers: pick(u.login_providers, []),
                      mfa_enabled: pick(u.mfa_enabled, false),
                    }
                  }

                  function mapAccount(a) {
                    a = a || {}
                    var capabilities = a.capabilities || {}
                    var sites = capabilities.sites || {}
                    var collaborators = capabilities.collaborators || {}
                    return {
                      id: pick(a.id, ''),
                      name: pick(a.name, ''),
                      slug: pick(a.slug, ''),
                      type: pick(a.type, ''),
                      type_name: pick(a.type_name, ''),
                      capabilities_sites_included: pick(sites.included, 0),
                      capabilities_sites_used: pick(sites.used, 0),
                      capabilities_collaborators_included: pick(collaborators.included, 0),
                      capabilities_collaborators_used: pick(collaborators.used, 0),
                      billing_name: pick(a.billing_name, ''),
                      billing_email: pick(a.billing_email, ''),
                      owner_ids: pick(a.owner_ids, []),
                      created_at: pick(a.created_at, ''),
                      updated_at: pick(a.updated_at, ''),
                    }
                  }

                  function mapMember(m) {
                    m = m || {}
                    return {
                      id: pick(m.id, ''),
                      full_name: pick(m.full_name, ''),
                      email: pick(m.email, ''),
                      avatar: pick(m.avatar, ''),
                      role: pick(m.role, ''),
                      pending: pick(m.pending, false),
                      mfa_enabled: pick(m.mfa_enabled, false),
                    }
                  }

                  function mapSite(s) {
                    s = s || {}
                    var published = s.published_deploy || {}
                    var build = s.build_settings || {}
                    return {
                      id: pick(s.id, ''),
                      name: pick(s.name, ''),
                      state: pick(s.state, ''),
                      url: pick(s.url, ''),
                      ssl_url: pick(s.ssl_url, ''),
                      admin_url: pick(s.admin_url, ''),
                      deploy_url: pick(s.deploy_url, ''),
                      screenshot_url: pick(s.screenshot_url, ''),
                      custom_domain: pick(s.custom_domain, ''),
                      domain_aliases: pick(s.domain_aliases, []),
                      created_at: pick(s.created_at, ''),
                      updated_at: pick(s.updated_at, ''),
                      account_name: pick(s.account_name, ''),
                      account_slug: pick(s.account_slug, ''),
                      git_provider: pick(s.git_provider, ''),
                      ssl: pick(s.ssl, false),
                      force_ssl: pick(s.force_ssl, false),
                      managed_dns: pick(s.managed_dns, false),
                      build_image: pick(s.build_image, ''),
                      framework: pick(published.framework, ''),
                      repo_url: pick(build.repo_url, ''),
                      repo_branch: pick(build.repo_branch, ''),
                      build_cmd: pick(build.cmd, ''),
                    }
                  }

                  function mapDeploy(d) {
                    d = d || {}
                    return {
                      id: pick(d.id, ''),
                      site_id: pick(d.site_id, ''),
                      state: pick(d.state, ''),
                      name: pick(d.name, ''),
                      url: pick(d.url, ''),
                      ssl_url: pick(d.ssl_url, ''),
                      deploy_url: pick(d.deploy_url, ''),
                      deploy_ssl_url: pick(d.deploy_ssl_url, ''),
                      branch: pick(d.branch, ''),
                      commit_ref: pick(d.commit_ref, ''),
                      commit_url: pick(d.commit_url, ''),
                      title: pick(d.title, ''),
                      context: pick(d.context, ''),
                      framework: pick(d.framework, ''),
                      error_message: pick(d.error_message, ''),
                      created_at: pick(d.created_at, ''),
                      updated_at: pick(d.updated_at, ''),
                      published_at: pick(d.published_at, ''),
                      locked: pick(d.locked, false),
                      draft: pick(d.draft, false),
                      skipped: pick(d.skipped, false),
                    }
                  }

                  function mapBuild(b) {
                    b = b || {}
                    return {
                      id: pick(b.id, ''),
                      deploy_id: pick(b.deploy_id, ''),
                      sha: pick(b.sha, ''),
                      done: pick(b.done, false),
                      error: pick(b.error, ''),
                      created_at: pick(b.created_at, ''),
                    }
                  }

                  function mapEnvVarValue(v) {
                    v = v || {}
                    return {
                      id: pick(v.id, ''),
                      value: pick(v.value, ''),
                      context: pick(v.context, ''),
                      context_parameter: pick(v.context_parameter, ''),
                    }
                  }

                  function mapEnvVar(e) {
                    e = e || {}
                    var values = pick(e.values, [])
                    var mapped = []
                    for (var i = 0; i < values.length; i++) mapped.push(mapEnvVarValue(values[i]))
                    return {
                      key: pick(e.key, ''),
                      scopes: pick(e.scopes, []),
                      values: mapped,
                      is_secret: pick(e.is_secret, false),
                      updated_at: pick(e.updated_at, ''),
                    }
                  }

                  function mapDnsZone(d) {
                    d = d || {}
                    return {
                      id: pick(d.id, ''),
                      name: pick(d.name, ''),
                      account_slug: pick(d.account_slug, ''),
                      site_id: pick(d.site_id, ''),
                      created_at: pick(d.created_at, ''),
                      updated_at: pick(d.updated_at, ''),
                      records_count: pick(d.records_count, 0),
                      dedicated: pick(d.dedicated, false),
                    }
                  }

                  function mapDnsRecord(r) {
                    r = r || {}
                    return {
                      id: pick(r.id, ''),
                      hostname: pick(r.hostname, ''),
                      type: pick(r.type, ''),
                      value: pick(r.value, ''),
                      ttl: pick(r.ttl, 0),
                      priority: pick(r.priority, 0),
                      dns_zone_id: pick(r.dns_zone_id, ''),
                      flag: pick(r.flag, 0),
                      tag: pick(r.tag, ''),
                    }
                  }

                  function mapHook(h) {
                    h = h || {}
                    return {
                      id: pick(h.id, ''),
                      site_id: pick(h.site_id, ''),
                      type: pick(h.type, ''),
                      event: pick(h.event, ''),
                      data: pick(h.data, {}),
                      created_at: pick(h.created_at, ''),
                      updated_at: pick(h.updated_at, ''),
                      disabled: pick(h.disabled, false),
                    }
                  }

                  function mapBuildHook(h) {
                    h = h || {}
                    return {
                      id: pick(h.id, ''),
                      title: pick(h.title, ''),
                      branch: pick(h.branch, ''),
                      url: pick(h.url, ''),
                      site_id: pick(h.site_id, ''),
                      created_at: pick(h.created_at, ''),
                    }
                  }

                  function mapForm(f) {
                    f = f || {}
                    return {
                      id: pick(f.id, ''),
                      site_id: pick(f.site_id, ''),
                      name: pick(f.name, ''),
                      paths: pick(f.paths, []),
                      submission_count: pick(f.submission_count, 0),
                      fields: pick(f.fields, []),
                      created_at: pick(f.created_at, ''),
                    }
                  }

                  function mapFormSubmission(s) {
                    s = s || {}
                    return {
                      id: pick(s.id, ''),
                      form_id: pick(s.form_id, ''),
                      form_name: pick(s.form_name, ''),
                      name: pick(s.name, ''),
                      email: pick(s.email, ''),
                      body: pick(s.body, ''),
                      data: pick(s.data, {}),
                      created_at: pick(s.created_at, ''),
                    }
                  }

                  function mapAuditEvent(e) {
                    e = e || {}
                    var payload = e.payload || {}
                    return {
                      id: pick(e.id, ''),
                      account_id: pick(e.account_id, ''),
                      actor_id: pick(payload.actor_id, ''),
                      actor_name: pick(payload.actor_name, ''),
                      actor_email: pick(payload.actor_email, ''),
                      action: pick(payload.action, ''),
                      timestamp: pick(payload.timestamp, ''),
                      log_type: pick(payload.log_type, ''),
                    }
                  }

                  function mapDeployKey(k) {
                    k = k || {}
                    return {
                      id: pick(k.id, ''),
                      public_key: pick(k.public_key, ''),
                      created_at: pick(k.created_at, ''),
                    }
                  }

                  function ok(data) {
                    return { status: 'ok', data: data, message: null, page_url: location.href }
                  }

                  function error(code, message) {
                    return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
                  }
          var netlifyToolImplementations = {
            async delete_site(args) {
                            var pageError = assertPage()
                            if (pageError) return pageError
                            var res = await api('/sites/' + args.site_id, { method: 'DELETE' })
                            if (!res.ok) return error(res.error_code, res.message)
                            return ok({ success: true })
            },
          }
          async function stdin_default(args) {
            return netlifyToolImplementations['delete_site'](args)
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
            'The Netlify tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Netlify API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Netlify tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
