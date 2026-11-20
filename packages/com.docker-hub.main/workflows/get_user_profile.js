// Self-contained adapter workflow. The Docker Hub session and every same-origin
// API call stay inside the Docker Hub tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "username": {
        "type": "string",
        "description": "Docker Hub username"
      }
    },
    "required": [
      "username"
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
    description: 'get_user_profile',
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

                    function getCurrentUrl() {
                      return typeof location !== 'undefined' ? location.href : ''
                    }

                    var __authCache = {}
                    function getAuthCache(ns) { return __authCache[ns] || null }
                    function setAuthCache(ns, value) { __authCache[ns] = value }
                    function clearAuthCache(ns) { delete __authCache[ns] }

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

          const API_BASE = 'https://hub.docker.com';
          // --- Auth detection ---
          // Docker Hub uses cookie-based session auth via Auth0.
          // The /auth/profile endpoint returns the JWT bearer token and username
          // for the current session. Token is cached to avoid repeated profile fetches.
          const fetchProfile = async () => {
              try {
                  const resp = await fetch(`${API_BASE}/auth/profile`, {
                      credentials: 'include',
                      signal: AbortSignal.timeout(5000),
                  });
                  if (!resp.ok)
                      return null;
                  const data = (await resp.json());
                  if (!data.token || !data.profile?.username)
                      return null;
                  return { token: data.token, username: data.profile.username };
              }
              catch {
                  return null;
              }
          };
          const getAuth = () => {
              const cached = getAuthCache('docker-hub');
              if (cached?.token && cached?.username)
                  return cached;
              return null;
          };
          const refreshAuth = async () => {
              const auth = await fetchProfile();
              if (auth) {
                  setAuthCache('docker-hub', auth);
              }
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = async () => {
              // First try a direct profile fetch to populate the cache
              const auth = await refreshAuth();
              if (auth)
                  return true;
              try {
                  await waitUntil(() => isAuthenticated(), {
                      interval: 500,
                      timeout: 5000,
                  });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const getUsername = () => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Docker Hub.');
              return auth.username;
          };
          // --- API caller ---
          const ensureAuth = async () => {
              let auth = getAuth();
              if (auth)
                  return auth;
              // Token may have expired; attempt a refresh
              auth = await refreshAuth();
              if (auth)
                  return auth;
              throw ToolError.auth('Not authenticated — please log in to Docker Hub.');
          };
          const api = async (endpoint, options = {}) => {
              const auth = await ensureAuth();
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;
              const headers = {
                  Authorization: `Bearer ${auth.token}`,
              };
              const init = {
                  method: options.method ?? 'GET',
                  headers,
              };
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
              }
              let response;
              try {
                  response = await fetch(url, {
                      ...init,
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError')
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (!response.ok) {
                  const errorBody = (await response.text().catch(() => '')).substring(0, 512);
                  if (response.status === 429) {
                      const retryMs = parseRateLimitHeader(response.headers);
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 401 || response.status === 403) {
                      clearAuthCache('docker-hub');
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404)
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  if (response.status === 400 || response.status === 422)
                      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 202 || response.status === 204)
                  return {};
              return (await response.json());
          };
          // Variant for the v3 catalog search API which has a different base path
          const searchApi = async (query) => {
              const auth = await ensureAuth();
              const qs = buildQueryString(query);
              const url = `${API_BASE}/api/search/v3/catalog/search?${qs}`;
              const data = await fetchJSON(url, {
                  headers: { Authorization: `Bearer ${auth.token}` },
              });
              return data;
          };

          // --- Repository ---
          const repositorySchema = z.object({
              name: z.string().describe('Repository name'),
              namespace: z.string().describe('Namespace (user or organization)'),
              description: z.string().describe('Short description'),
              is_private: z.boolean().describe('Whether the repository is private'),
              star_count: z.number().describe('Number of stars'),
              pull_count: z.number().describe('Number of pulls'),
              last_updated: z.string().describe('Last updated ISO 8601 timestamp'),
              repository_type: z.string().describe('Repository type (image, model, etc.)'),
              status_description: z.string().describe('Status description (active, initialized, etc.)'),
              content_types: z.array(z.string()).describe('Content types (image, unrecognized, etc.)'),
          });
          const mapRepository = (r) => ({
              name: r.name ?? '',
              namespace: r.namespace ?? r.user ?? '',
              description: r.description ?? '',
              is_private: r.is_private ?? false,
              star_count: r.star_count ?? 0,
              pull_count: r.pull_count ?? 0,
              last_updated: r.last_updated ?? '',
              repository_type: r.repository_type ?? 'image',
              status_description: r.status_description ?? '',
              content_types: r.content_types ?? [],
          });
          // --- Repository Detail (extends repositorySchema) ---
          const repositoryDetailSchema = repositorySchema.extend({
              full_description: z.string().describe('Full description in Markdown'),
              date_registered: z.string().describe('Date the repository was registered'),
              hub_user: z.string().describe('User who owns the repository'),
              is_automated: z.boolean().describe('Whether builds are automated'),
              categories: z.array(z.string()).describe('Category slugs'),
              permissions: z
                  .object({
                  admin: z.boolean().describe('Whether the user has admin permissions'),
                  read: z.boolean().describe('Whether the user has read permissions'),
                  write: z.boolean().describe('Whether the user has write permissions'),
              })
                  .describe('User permissions on the repository'),
          });
          const mapRepositoryDetail = (r) => ({
              ...mapRepository(r),
              full_description: r.full_description ?? '',
              date_registered: r.date_registered ?? '',
              hub_user: r.hub_user ?? '',
              is_automated: r.is_automated ?? false,
              categories: (r.categories ?? []).map(c => c.slug ?? c.name ?? ''),
              permissions: {
                  admin: r.permissions?.admin ?? false,
                  read: r.permissions?.read ?? false,
                  write: r.permissions?.write ?? false,
              },
          });
          // --- Tag ---
          const tagSchema = z.object({
              name: z.string().describe('Tag name (e.g., "latest", "alpine")'),
              digest: z.string().describe('Image digest (sha256:...)'),
              full_size: z.number().describe('Compressed size in bytes'),
              last_updated: z.string().describe('Last updated ISO 8601 timestamp'),
              tag_status: z.string().describe('Tag status (active, stale)'),
              content_type: z.string().describe('Content type (image, etc.)'),
              media_type: z.string().describe('Media type'),
              images: z
                  .array(z.object({
                  architecture: z.string().describe('CPU architecture (amd64, arm64, etc.)'),
                  os: z.string().describe('Operating system'),
                  size: z.number().describe('Image size in bytes'),
                  status: z.string().describe('Image status'),
              }))
                  .describe('Platform-specific images'),
          });
          const mapImage = (i) => ({
              architecture: i.architecture ?? 'unknown',
              os: i.os ?? 'unknown',
              size: i.size ?? 0,
              status: i.status ?? '',
          });
          const mapTag = (t) => ({
              name: t.name ?? '',
              digest: t.digest ?? '',
              full_size: t.full_size ?? 0,
              last_updated: t.last_updated ?? '',
              tag_status: t.tag_status ?? '',
              content_type: t.content_type ?? '',
              media_type: t.media_type ?? '',
              images: (t.images ?? []).filter(i => i.architecture !== 'unknown').map(mapImage),
          });
          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              username: z.string().describe('Username'),
              full_name: z.string().describe('Full name'),
              location: z.string().describe('Location'),
              company: z.string().describe('Company'),
              date_joined: z.string().describe('Date joined ISO 8601 timestamp'),
              type: z.string().describe('Account type (User, Organization)'),
              gravatar_url: z.string().describe('Gravatar URL'),
          });
          const mapUser = (u) => ({
              id: u.id ?? u.uuid ?? '',
              username: u.username ?? '',
              full_name: u.full_name ?? '',
              location: u.location ?? '',
              company: u.company ?? '',
              date_joined: u.date_joined ?? '',
              type: u.type ?? '',
              gravatar_url: u.gravatar_url ?? '',
          });
          // --- Organization ---
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID'),
              orgname: z.string().describe('Organization name'),
              full_name: z.string().describe('Full display name'),
              location: z.string().describe('Location'),
              company: z.string().describe('Company name'),
              date_joined: z.string().describe('Date joined ISO 8601 timestamp'),
          });
          const mapOrganization = (o) => ({
              id: o.id ?? '',
              orgname: o.orgname ?? '',
              full_name: o.full_name ?? '',
              location: o.location ?? '',
              company: o.company ?? '',
              date_joined: o.date_joined ?? '',
          });
          // --- Search Result ---
          const searchResultSchema = z.object({
              repo_name: z.string().describe('Repository name in namespace/repo format'),
              short_description: z.string().describe('Short description'),
              star_count: z.number().describe('Number of stars'),
              pull_count: z.number().describe('Number of pulls'),
              is_official: z.boolean().describe('Whether this is a Docker Official Image'),
              is_automated: z.boolean().describe('Whether builds are automated'),
          });
          const mapSearchResult = (r) => ({
              repo_name: r.repo_name ?? '',
              short_description: r.short_description ?? '',
              star_count: r.star_count ?? 0,
              pull_count: r.pull_count ?? 0,
              is_official: r.is_official ?? false,
              is_automated: r.is_automated ?? false,
          });
          // --- Catalog Search Result (v3 API) ---
          const catalogResultSchema = z.object({
              name: z.string().describe('Display name'),
              slug: z.string().describe('Slug identifier (namespace/name)'),
              type: z.string().describe('Content type (image, model, extension)'),
              source: z.string().describe('Source (official, verified_publisher, community)'),
              short_description: z.string().describe('Short description'),
              star_count: z.number().describe('Number of stars'),
              categories: z.array(z.string()).describe('Category names'),
              updated_at: z.string().describe('Last updated ISO 8601 timestamp'),
          });
          const mapCatalogResult = (r) => ({
              name: r.name ?? '',
              slug: r.slug ?? '',
              type: r.type ?? '',
              source: r.source ?? '',
              short_description: r.short_description ?? '',
              star_count: r.star_count ?? 0,
              categories: (r.categories ?? []).map(c => c.name ?? ''),
              updated_at: r.updated_at ?? '',
          });
          const getUserProfile = defineTool({
              name: 'get_user_profile',
              displayName: 'Get User Profile',
              description: 'Get a Docker Hub user profile by username. Returns username, full name, location, company, account type, and join date.',
              summary: 'Get a Docker Hub user profile by username',
              icon: 'user',
              group: 'Users',
              input: z.object({
                  username: z.string().describe('Docker Hub username'),
              }),
              output: z.object({ user: userSchema }),
              handle: async (params) => {
                  const data = await api(`/v2/users/${params.username}`);
                  return { user: mapUser(data) };
              },
          });


                    var pluginTool = getUserProfile

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
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Docker Hub page.')
                      }
                      if (!/(^|\.)docker\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Docker Hub page.')
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
            async get_user_profile(args) {
              return runTool('get_user_profile', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['get_user_profile'](args)
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
            'The Docker Hub tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Docker Hub API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Docker Hub tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
