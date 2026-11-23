// Self-contained adapter workflow. The Webflow session and every same-origin
// API call stay inside the Webflow tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "site_short_name": {
        "type": "string",
        "description": "Site short name / URL slug"
      }
    },
    "required": [
      "site_short_name"
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
    description: 'get_site_permissions',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
                    // ─── Page-side SDK-compat layer ─────────────────────────────────
                    // Reimplements the subset of @opentabs-dev/plugin-sdk that the
                    // pasted upstream transport calls: credentials:'include' fetches with
                    // a bounded abort and the SDK's HTTP -> ToolError classification,
                    // page readers (meta / cookie / localStorage / globals), the auth
                    // cache and waitUntil. Logging/timing behaviour is not reproduced;
                    // the upstream modules below run unmodified.
                    class ToolError extends Error {
                      constructor(message, code, opts) {
                        super(message)
                        this.name = 'ToolError'
                        this.code = code || 'TOOL_ERROR'
                        this.category = (opts && opts.category) || undefined
                        this.retryable = !!(opts && opts.retryable)
                      }
                      static auth(m, c) { return new ToolError(m, c || 'AUTH_ERROR', { category: 'auth' }) }
                      static notFound(m, c) { return new ToolError(m, c || 'NOT_FOUND', { category: 'not_found' }) }
                      static validation(m, c) { return new ToolError(m, c || 'VALIDATION_ERROR', { category: 'validation' }) }
                      static rateLimited(m, ms, c) { return new ToolError(m, c || 'RATE_LIMITED', { category: 'rate_limit', retryable: true }) }
                      static timeout(m, c) { return new ToolError(m, c || 'TIMEOUT', { category: 'timeout', retryable: true }) }
                      static internal(m, c) { return new ToolError(m, c || 'INTERNAL_ERROR', { category: 'internal' }) }
                    }

                    function defineTool(definition) { return definition }

                    // Zod is only used to declare schemas at module scope; the package
                    // carries its schemas as JSON, so every z.* chain can resolve to this
                    // inert stub.
                    var z = new Proxy(function () {}, {
                      get: function () { return z },
                      apply: function () { return z },
                    })

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

                    function getMetaContent(name) {
                      try {
                        var el = document.querySelector('meta[name="' + name + '"]')
                        if (!el) return null
                        var value = el.getAttribute('content')
                        return value || null
                      } catch (e) {
                        return null
                      }
                    }

                    function getCookie(name) {
                      try {
                        var prefix = name + '='
                        var parts = String(document.cookie || '').split(';')
                        for (var i = 0; i < parts.length; i++) {
                          var part = parts[i].trim()
                          if (part.indexOf(prefix) === 0) return decodeURIComponent(part.slice(prefix.length))
                        }
                        return null
                      } catch (e) {
                        return null
                      }
                    }

                    function getLocalStorage(key) {
                      try {
                        return localStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    function getSessionStorage(key) {
                      try {
                        return sessionStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    // Upstream SDK export (temporal-cloud): scan localStorage keys with a
                    // predicate and return the first hit as { key, value }.
                    function findLocalStorageEntry(predicate) {
                      try {
                        var count = localStorage.length
                        for (var i = 0; i < count; i++) {
                          var key = localStorage.key(i)
                          if (key === null) continue
                          if (!predicate(key)) continue
                          var value = localStorage.getItem(key)
                          if (value === null) continue
                          return { key: key, value: value }
                        }
                      } catch (e) {}
                      return null
                    }

                    function getCurrentUrl() {
                      return typeof location !== 'undefined' ? location.href : ''
                    }

                    var __authCache = (globalThis.__opentabsAuthCache =
                      globalThis.__opentabsAuthCache || {})
                    function getAuthCache(ns) { return __authCache[ns] || null }
                    function setAuthCache(ns, value) { __authCache[ns] = value }
                    function clearAuthCache(ns) { delete __authCache[ns] }

                    // Upstream SDK export: structured logging. The adapter drops log
                    // output, but the pasted transport calls log.debug on auth paths, so
                    // the surface must exist.
                    var log = { debug: function () {}, info: function () {}, warn: function () {}, error: function () {} }

                    function buildQueryString(params) {
                      var search = new URLSearchParams()
                      var keys = Object.keys(params || {})
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

                    function stripUndefined(obj) {
                      var out = {}
                      var keys = Object.keys(obj || {})
                      for (var i = 0; i < keys.length; i++) {
                        if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]]
                      }
                      return out
                    }

                    function parseRetryAfterMs(value) {
                      var seconds = Number(value)
                      if (!isNaN(seconds) && seconds >= 0) return seconds * 1000
                      var date = Date.parse(value)
                      if (!isNaN(date)) {
                        var ms = date - Date.now()
                        return ms > 0 ? ms : undefined
                      }
                      return undefined
                    }

                    function parseRateLimitHeader(headers) {
                      var names = ['Retry-After', 'x-rate-limit-reset', 'x-ratelimit-reset', 'RateLimit-Reset']
                      for (var i = 0; i < names.length; i++) {
                        var raw = null
                        try { raw = headers.get(names[i]) } catch (e) {}
                        if (raw === null || raw === undefined) continue
                        var ms = parseRetryAfterMs(raw)
                        if (ms !== undefined) return ms
                      }
                      return undefined
                    }

                    function sleep(ms) {
                      return new Promise(function (resolve) { setTimeout(resolve, ms) })
                    }

                    // Upstream SDK export (sqlpad): plain sleep with progress reporting.
                    async function delay(ms) {
                      return sleep(ms)
                    }

                    async function waitUntil(predicate, options) {
                      var interval = (options && options.interval) || 500
                      var timeout = (options && options.timeout) || 5000
                      var deadline = Date.now() + timeout
                      while (Date.now() <= deadline) {
                        if (await predicate()) return
                        await sleep(interval)
                      }
                      throw ToolError.timeout('waitUntil timed out after ' + timeout + 'ms')
                    }

                    function httpStatusToToolError(status, message, headers) {
                      if (status === 401 || status === 403) return ToolError.auth(message)
                      if (status === 404) return ToolError.notFound(message)
                      if (status === 429) {
                        var retryAfterMs = headers ? parseRateLimitHeader(headers) : undefined
                        return ToolError.rateLimited(message, retryAfterMs)
                      }
                      if (status === 400 || status === 422) return ToolError.validation(message)
                      if (status === 408) return ToolError.timeout(message)
                      if (status >= 500) return new ToolError(message, 'HTTP_ERROR', { category: 'internal', retryable: true })
                      return new ToolError(message, 'HTTP_ERROR', { retryable: false })
                    }

                    var FETCH_TIMEOUT_MS = 18000

                    async function fetchFromPage(url, init) {
                      init = init || {}
                      var timeout = init.timeout || 30000
                      var controller = null
                      if (typeof AbortController === 'function') {
                        try { controller = new AbortController() } catch (e) {}
                      }
                      var budget = Math.min(timeout, FETCH_TIMEOUT_MS)
                      var timer = controller
                        ? setTimeout(function () { try { controller.abort() } catch (e) {} }, budget)
                        : null
                      var response
                      try {
                        response = await fetch(url, {
                          credentials: 'include',
                          ...init,
                          signal: controller ? controller.signal : undefined,
                          timeout: undefined,
                        })
                      } catch (error) {
                        if (timer !== null) clearTimeout(timer)
                        var aborted = error && (error.name === 'AbortError' || String(error).indexOf('abort') !== -1)
                        if (aborted) {
                          return { __fetchError: ToolError.timeout('request timed out after ' + budget + 'ms for ' + url) }
                        }
                        return {
                          __fetchError: new ToolError('network error for ' + url + ': ' + String(error), 'NETWORK_ERROR', {
                            category: 'internal',
                            retryable: true,
                          }),
                        }
                      }
                      if (timer !== null) clearTimeout(timer)
                      if (response && response.__fetchError) throw response.__fetchError
                      if (!response.ok) {
                        var rawText = ''
                        try { rawText = await response.text() } catch (e) { rawText = '' }
                        var text = String(rawText || '')
                        var body = text.length > 512 ? text.slice(0, 512) + '…' : text
                        throw httpStatusToToolError(
                          response.status,
                          'HTTP ' + response.status + ' for ' + url + ': ' + body,
                          response.headers
                        )
                      }
                      return response
                    }

                    async function fetchJSON(url, init, schema) {
                      var response = await fetchFromPage(url, init)
                      if (response.status === 204) return undefined
                      var data
                      try {
                        data = await response.json()
                      } catch (e) {
                        throw ToolError.validation('failed to parse JSON from ' + url)
                      }
                      return data
                    }

                    // Upstream SDK export (sqlpad): same transport, raw text body.
                    async function fetchText(url, init) {
                      var response = await fetchFromPage(url, init)
                      try {
                        return await response.text()
                      } catch (e) {
                        throw ToolError.validation('failed to read text from ' + url)
                      }
                    }

                    // Upstream SDK export (hex): POST JSON, return the parsed body (null
                    // on 204). Uses the same credentials:'include' transport.
                    async function postJSON(url, body, init) {
                      init = init || {}
                      var response = await fetchFromPage(url, {
                        method: 'POST',
                        headers: Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}),
                        body: JSON.stringify(body),
                        timeout: init.timeout,
                      })
                      if (response.status === 204) return null
                      try {
                        return await response.json()
                      } catch (e) {
                        throw ToolError.validation('failed to parse JSON from ' + url)
                      }
                    }

                    // Upstream SDK export (hex): querySelectorAll over the live document,
                    // returning a real array.
                    function querySelectorAll(selector) {
                      try {
                        return Array.prototype.slice.call(document.querySelectorAll(selector))
                      } catch (e) {
                        return []
                      }
                    }

          const getAuth = () => {
              const cached = getAuthCache('webflow');
              if (cached)
                  return cached;
              const csrf = getMetaContent('_csrf');
              if (!csrf)
                  return null;
              const auth = { csrf };
              setAuthCache('webflow', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // --- API caller ---
          // Webflow's internal API is same-origin at /api/. All endpoints use
          // HttpOnly session cookies sent automatically with credentials: 'include'.
          const API_BASE = '/api';
          const api = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Webflow.');
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;
              const headers = {};
              const init = {
                  method: options.method ?? 'GET',
                  headers,
              };
              if (init.method !== 'GET') {
                  headers['X-CSRF-Token'] = auth.csrf;
              }
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
              }
              try {
                  const data = await fetchJSON(url, init);
                  return data;
              }
              catch (err) {
                  // On 401/403/412, clear auth cache to force re-read
                  if (err instanceof ToolError && (err.category === 'auth' || err.code === '412')) {
                      clearAuthCache('webflow');
                  }
                  throw err;
              }
          };

          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              email: z.string().describe('Email address'),
              first_name: z.string().describe('First name'),
              last_name: z.string().describe('Last name'),
              username: z.string().describe('Username'),
              verified: z.boolean().describe('Whether the email is verified'),
              created_on: z.string().describe('Account creation ISO 8601 timestamp'),
              plan: z.string().describe('Current plan name'),
              two_factor_enabled: z.boolean().describe('Whether 2FA is enabled'),
          });
          const mapUser = (u) => ({
              id: u._id ?? '',
              email: u.email ?? '',
              first_name: u.firstName ?? '',
              last_name: u.lastName ?? '',
              username: u.username ?? '',
              verified: u.verified ?? false,
              created_on: u.createdOn ?? '',
              plan: u.plan ?? '',
              two_factor_enabled: u.twoFactorEnabled ?? false,
          });
          // --- Workspace ---
          const workspaceSchema = z.object({
              id: z.string().describe('Workspace ID'),
              name: z.string().describe('Workspace name'),
              slug: z.string().describe('Workspace URL slug'),
              role: z.string().describe('Current user role in this workspace (e.g., owner, admin, member)'),
              site_count: z.number().int().describe('Number of sites in the workspace'),
              used_seats: z.number().int().describe('Number of seats used'),
              total_seats: z.number().int().describe('Total seats available'),
              created_on: z.string().describe('Workspace creation ISO 8601 timestamp'),
          });
          const mapWorkspace = (w) => ({
              id: w._id ?? '',
              name: w.name ?? '',
              slug: w.slug ?? '',
              role: w.role ?? '',
              site_count: w.siteCount ?? 0,
              used_seats: w.usedSeats ?? 0,
              total_seats: w.totalSeats ?? 0,
              created_on: w.createdOn ?? '',
          });
          // --- Site ---
          const siteSchema = z.object({
              id: z.string().describe('Site ID'),
              name: z.string().describe('Site name'),
              short_name: z.string().describe('Site short name / URL slug'),
              archived: z.boolean().describe('Whether the site is archived'),
              created_on: z.string().describe('Site creation ISO 8601 timestamp'),
              last_updated: z.string().describe('Last update ISO 8601 timestamp'),
              last_published: z.string().describe('Last publish ISO 8601 timestamp or empty if never published'),
              preview_url: z.string().describe('Screenshot preview URL'),
              workspace_id: z.string().describe('Parent workspace ID'),
          });
          const mapSite = (s) => ({
              id: s._id ?? '',
              name: s.name ?? '',
              short_name: s.shortName ?? '',
              archived: s.archived ?? false,
              created_on: s.createdOn ?? '',
              last_updated: s.lastUpdated ?? '',
              last_published: s.lastPublished ?? '',
              preview_url: s.previewUrl ?? '',
              workspace_id: s.workspace ?? '',
          });
          // --- Member ---
          const memberSchema = z.object({
              id: z.string().describe('Member user ID'),
              email: z.string().describe('Email address'),
              first_name: z.string().describe('First name'),
              last_name: z.string().describe('Last name'),
              username: z.string().describe('Username'),
              workspace_role: z.string().describe('Role in the workspace (e.g., owner, admin, member)'),
              site_role: z.string().describe('Default site role (e.g., project_admin, designer, editor)'),
              two_factor_enabled: z.boolean().describe('Whether 2FA is enabled'),
              last_login: z.number().describe('Last login timestamp in milliseconds'),
          });
          const mapMember = (m) => ({
              id: m._id ?? '',
              email: m.email ?? '',
              first_name: m.firstName ?? '',
              last_name: m.lastName ?? '',
              username: m.username ?? '',
              workspace_role: m.roles?.workspace ?? '',
              site_role: m.roles?.site ?? '',
              two_factor_enabled: m.twoFactorEnabled ?? false,
              last_login: m.lastLogin ?? 0,
          });
          // --- Page ---
          const pageSchema = z.object({
              id: z.string().describe('Page ID'),
              title: z.string().describe('Page title'),
              slug: z.string().describe('Page URL slug (null for index page)'),
              type: z.string().describe('Page type (e.g., page, utility)'),
              archived: z.boolean().describe('Whether the page is archived'),
              draft: z.boolean().describe('Whether the page is a draft'),
              created_on: z.string().describe('Page creation ISO 8601 timestamp'),
              last_updated: z.string().describe('Last update ISO 8601 timestamp'),
          });
          const mapPage = (p) => ({
              id: p._id ?? '',
              title: p.title ?? '',
              slug: p.slug ?? '',
              type: p.type ?? '',
              archived: p.archived ?? false,
              draft: p.draft ?? false,
              created_on: p.createdOn ?? '',
              last_updated: p.lastUpdated ?? '',
          });
          // --- Domain ---
          const domainSchema = z.object({
              id: z.string().describe('Domain ID'),
              name: z.string().describe('Domain name (e.g., example.com)'),
              stage: z.string().describe('Domain stage (e.g., staging, production)'),
              has_valid_ssl: z.boolean().describe('Whether the domain has valid SSL'),
              created_on: z.string().describe('Domain creation ISO 8601 timestamp'),
          });
          const mapDomain = (d) => ({
              id: d._id ?? '',
              name: d.name ?? '',
              stage: d.stage ?? '',
              has_valid_ssl: d.hasValidSSL ?? false,
              created_on: d.createdOn ?? '',
          });
          // --- Form ---
          const formSchema = z.object({
              id: z.string().describe('Form ID'),
              name: z.string().describe('Form display name'),
              slug: z.string().describe('Form slug'),
              submission_count: z.number().int().describe('Total number of submissions'),
          });
          const mapForm = (f) => ({
              id: f._id ?? '',
              name: f.name ?? '',
              slug: f.slug ?? '',
              submission_count: f.count ?? 0,
          });
          // --- Folder ---
          const folderSchema = z.object({
              id: z.string().describe('Folder ID'),
              name: z.string().describe('Folder name'),
              site_ids: z.array(z.string()).describe('IDs of sites in this folder'),
              created_on: z.string().describe('Folder creation ISO 8601 timestamp'),
          });
          const mapFolder = (f) => ({
              id: f._id ?? '',
              name: f.name ?? '',
              site_ids: f.sites ?? [],
              created_on: f.createdOn ?? '',
          });
          // --- Invite ---
          const inviteSchema = z.object({
              id: z.string().describe('Invite ID'),
              email: z.string().describe('Invited email address'),
              status: z.string().describe('Invite status'),
              workspace_role: z.string().describe('Invited workspace role'),
          });
          const mapInvite = (i) => ({
              id: i._id ?? '',
              email: i.email ?? '',
              status: i.status ?? '',
              workspace_role: i.role ?? '',
          });
          // --- Permissions ---
          const permissionGroupSchema = z
              .record(z.string(), z.boolean())
              .describe('Permission actions and their enabled status');
          const permissionsOutputSchema = z.object({
              permissions: z.record(z.string(), permissionGroupSchema).describe('Permission groups with their action flags'),
          });
          const getSitePermissions = defineTool({
              name: 'get_site_permissions',
              displayName: 'Get Site Permissions',
              description: 'Get the current user permissions for a specific Webflow site. Returns which actions the user can perform on the site.',
              summary: 'Get your site permissions',
              icon: 'shield',
              group: 'Sites',
              input: z.object({
                  site_short_name: z.string().describe('Site short name / URL slug'),
              }),
              output: permissionsOutputSchema,
              handle: async (params) => {
                  const data = await api(`/sites/${params.site_short_name}/permissions`);
                  return { permissions: data };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = getSitePermissions

                    function mapThrown(error) {
                      if (error && error.name === 'ToolError') {
                        var code = error.code || 'TOOL_ERROR'
                        if (error.category === 'auth') code = 'AUTH'
                        else if (error.category === 'not_found') code = 'NOT_FOUND'
                        else if (error.category === 'rate_limit') code = 'RATE_LIMITED'
                        else if (error.category === 'validation') code = 'VALIDATION'
                        else if (error.category === 'timeout') code = 'TIMEOUT'
                        else if (error.category === 'internal') code = 'INTERNAL'
                        return errorEnvelope(code, error.message || 'Tool failed')
                      }
                      return errorEnvelope('UNKNOWN', error && error.message ? error.message : String(error))
                    }

                    function errorEnvelope(code, message) {
                      return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
                    }

                    function okEnvelope(data) {
                      return { status: 'ok', data: data, message: null, page_url: location.href }
                    }

                    function assertPage() {
                      var PRODUCT_HOSTS = {
                        'sqlpad': /(^|\.)(sqlpad\.[a-z0-9.-]+|localhost|127\.0\.0\.1)$/,
                      }
                      var productProbe = PRODUCT_HOSTS['webflow'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Webflow page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)webflow\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Webflow page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Webflow page.')
                        }
                      }
                      return null
                    }

                    // Some upstream plugins cache a session token that tools read
                    // synchronously (docker-hub's getUsername()). Upstream primes it in
                    // its activation hook, which a WebMCP package does not have: prime it
                    // once here, or every tool that needs the username reports AUTH.
                    var __authPrimed = false
                    async function __primeAuth() {
                      if (__authPrimed) return
                      __authPrimed = true
                      try {
                        if (typeof refreshAuth === 'function') await refreshAuth()
                        else if (typeof waitForAuth === 'function') await waitForAuth()
                      } catch (e) {
                        // The tool's own auth check reports the failure with its code.
                      }
                    }

                    async function runTool(name, args) {
                      var pageError = assertPage()
                      if (pageError) return pageError
                      try {
                        await __primeAuth()
                        var data = await pluginTool.handle(args || {})
                        return okEnvelope(data === undefined ? {} : data)
                      } catch (error) {
                        return mapThrown(error)
                      }
                    }


          var toolEntry = {
            async get_site_permissions(args) {
              return runTool('get_site_permissions', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['get_site_permissions'](args)
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
            'The Webflow tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Webflow API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Webflow tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
