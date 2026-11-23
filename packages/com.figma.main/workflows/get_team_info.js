// Self-contained adapter workflow. The Figma session and every same-origin
// API call stay inside the Figma tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "team_id": {
        "type": "string",
        "minLength": 1,
        "description": "Team ID to get information for"
      }
    },
    "required": [
      "team_id"
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
    description: 'get_team_info',
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

          // ---------------------------------------------------------------------------
          // Auth extraction
          // ---------------------------------------------------------------------------
          const decodeRecentUserData = () => {
              const raw = getCookie('recent_user_data');
              if (!raw)
                  return null;
              // Cookie value is: URL-encoded → JSON string → base64 → JSON object
              try {
                  const unquoted = JSON.parse(raw);
                  return JSON.parse(atob(unquoted));
              }
              catch { }
              // Fallback: plain double-JSON
              try {
                  const outer = JSON.parse(raw);
                  return JSON.parse(outer);
              }
              catch { }
              return null;
          };
          const extractFuidFromCookie = () => {
              const data = decodeRecentUserData();
              return data?.fileBrowserUserId ?? null;
          };
          const extractTeamIdFromUrl = () => {
              const match = window.location.pathname.match(/\/files\/team\/(\d+)/);
              return match?.[1] ?? null;
          };
          const extractFromInitialOptions = () => {
              const result = {};
              try {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                      const text = s.textContent ?? '';
                      if (!text.includes('INITIAL_OPTIONS'))
                          continue;
                      const fuidMatch = text.match(/"fuid["\s]*[:=]\s*["']?(\d+)/);
                      if (fuidMatch)
                          result.fuid = fuidMatch[1];
                      const teamMatch = text.match(/"team_id"\s*:\s*"(\d+)"/);
                      if (teamMatch)
                          result.teamId = teamMatch[1];
                      if (result.fuid && result.teamId)
                          break;
                  }
              }
              catch { }
              return result;
          };
          const extractTeamIdFromUserState = () => {
              const data = decodeRecentUserData();
              if (!data?.userIdToPlan)
                  return null;
              const plans = Object.values(data.userIdToPlan);
              if (plans.length > 0 && plans[0] && plans[0].length >= 2)
                  return plans[0][1] ?? null;
              return null;
          };
          const getAuth = () => {
              const persisted = getAuthCache('figma');
              if (persisted)
                  return persisted;
              // Detect auth status via non-HttpOnly cookie
              const authnState = getCookie('__Host-figma.authn-state');
              if (authnState !== '1')
                  return null;
              // Extract fuid
              let fuid = extractFuidFromCookie();
              if (!fuid) {
                  const opts = extractFromInitialOptions();
                  fuid = opts.fuid ?? null;
              }
              if (!fuid) {
                  const urlMatch = window.location.search.match(/fuid=(\d+)/);
                  fuid = urlMatch?.[1] ?? null;
              }
              if (!fuid)
                  return null;
              // Extract team ID
              let teamId = extractTeamIdFromUrl();
              if (!teamId) {
                  const opts = extractFromInitialOptions();
                  teamId = opts.teamId ?? null;
              }
              if (!teamId)
                  teamId = extractTeamIdFromUserState();
              if (!teamId)
                  teamId = '';
              const auth = { fuid, teamId };
              setAuthCache('figma', auth);
              return auth;
          };
          // ---------------------------------------------------------------------------
          // Public auth helpers
          // ---------------------------------------------------------------------------
          const isFigmaAuthenticated = () => getAuth() !== null;
          const waitForFigmaAuth = () => waitUntil(() => isFigmaAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // ---------------------------------------------------------------------------
          // API caller
          // ---------------------------------------------------------------------------
          const figmaApi = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Figma.');
              // Build URL with query params (auto-append fuid if not present)
              let url = `https://www.figma.com/api${endpoint}`;
              const params = new URLSearchParams();
              if (options.query) {
                  for (const [key, value] of Object.entries(options.query)) {
                      if (value !== undefined)
                          params.append(key, String(value));
                  }
              }
              if (!params.has('fuid') && auth.fuid) {
                  params.append('fuid', auth.fuid);
              }
              const qs = params.toString();
              if (qs)
                  url += `?${qs}`;
              // Set headers
              const headers = {};
              let fetchBody;
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = JSON.stringify(options.body);
              }
              // Make request
              let response;
              try {
                  response = await fetch(url, {
                      method: options.method ?? 'GET',
                      headers,
                      body: fetchBody,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError')
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  if (err instanceof DOMException && err.name === 'AbortError')
                      throw new ToolError('Request was aborted', 'aborted');
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              // Classify HTTP errors
              if (!response.ok) {
                  const errorBody = (await response.text().catch(() => '')).substring(0, 512);
                  if (response.status === 429) {
                      const retryAfter = response.headers.get('Retry-After');
                      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 401 || response.status === 403) {
                      clearAuthCache('figma');
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404)
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              const data = (await response.json());
              // Figma API wraps responses in { error, status, meta }
              if (data.error) {
                  const msg = data.message ?? 'Unknown Figma API error';
                  if (data.status === 401 || data.status === 403) {
                      clearAuthCache('figma');
                      throw ToolError.auth(msg);
                  }
                  if (data.status === 404)
                      throw ToolError.notFound(msg);
                  if (data.status === 429)
                      throw ToolError.rateLimited(msg);
                  if (data.status === 400)
                      throw ToolError.validation(msg);
                  throw ToolError.internal(msg);
              }
              return data;
          };
          // Helper to get auth context (fuid + teamId)
          const getAuthContext = () => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Figma.');
              return auth;
          };

          // ---------------------------------------------------------------------------
          // File schema
          // ---------------------------------------------------------------------------
          const fileSchema = z.object({
              key: z.string().describe('Unique file key identifier'),
              name: z.string().describe('File name'),
              description: z.string().nullable().describe('File description'),
              editor_type: z.string().describe('Editor type (design, figjam, slides)'),
              team_id: z.string().describe('Team ID the file belongs to'),
              folder_id: z.string().describe('Folder/project ID containing the file'),
              creator_id: z.string().describe('User ID of the file creator'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last updated timestamp'),
              thumbnail_url: z.string().nullable().describe('URL to the file thumbnail image'),
              url: z.string().describe('URL to open the file in Figma'),
              link_access: z.string().describe('Link sharing access level (view, edit, inherit)'),
              trashed_at: z.string().nullable().describe('ISO 8601 timestamp when file was trashed, or null'),
          });
          const mapFile = (f) => ({
              key: f.key ?? '',
              name: f.name ?? '',
              description: f.description ?? null,
              editor_type: f.editor_type ?? 'design',
              team_id: f.team_id ?? '',
              folder_id: f.folder_id ?? '',
              creator_id: f.creator_id ?? '',
              created_at: f.created_at ?? '',
              updated_at: f.updated_at ?? '',
              thumbnail_url: f.thumbnail_url ?? null,
              url: f.url ?? f.edit_url ?? '',
              link_access: f.link_access ?? '',
              trashed_at: f.trashed_at ?? null,
          });
          // ---------------------------------------------------------------------------
          // User schema
          // ---------------------------------------------------------------------------
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              name: z.string().describe('Display name'),
              handle: z.string().describe('User handle'),
              email: z.string().describe('Email address'),
              img_url: z.string().describe('Profile image URL'),
              created_at: z.string().describe('ISO 8601 account creation timestamp'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              name: u.name ?? '',
              handle: u.handle ?? '',
              email: u.email ?? '',
              img_url: u.img_url ?? '',
              created_at: u.created_at ?? '',
          });
          // ---------------------------------------------------------------------------
          // Team schema
          // ---------------------------------------------------------------------------
          const teamSchema = z.object({
              id: z.string().describe('Team ID'),
              name: z.string().describe('Team name'),
              description: z.string().nullable().describe('Team description'),
              img_url: z.string().nullable().describe('Team avatar URL'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              editors: z.number().describe('Number of editors in the team'),
              is_paid: z.boolean().describe('Whether the team is on a paid plan'),
          });
          const mapTeam = (t) => ({
              id: t.id ?? '',
              name: t.name ?? '',
              description: t.description ?? null,
              img_url: t.img_url ?? null,
              created_at: t.created_at ?? '',
              editors: t.editors ?? 0,
              is_paid: t.is_paid ?? false,
          });
          // ---------------------------------------------------------------------------
          // Comment schema
          // ---------------------------------------------------------------------------
          const commentSchema = z.object({
              id: z.string().describe('Comment ID'),
              message: z.string().describe('Comment text'),
              user_id: z.string().describe('User ID of the commenter'),
              user_handle: z.string().describe('Display name of the commenter'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              resolved_at: z.string().nullable().describe('ISO 8601 timestamp when resolved, or null'),
              parent_id: z.string().nullable().describe('Parent comment ID for replies, or null'),
          });
          const mapComment = (c) => ({
              id: String(c.id ?? ''),
              message: c.message ?? '',
              user_id: c.user_id ?? c.user?.id ?? '',
              user_handle: c.user_handle ?? c.user?.handle ?? '',
              created_at: c.created_at ?? '',
              resolved_at: c.resolved_at ?? null,
              parent_id: c.parent_id ? String(c.parent_id) : null,
          });
          const getTeamInfo = defineTool({
              name: 'get_team_info',
              displayName: 'Get Team Info',
              description: 'Get detailed information about a specific Figma team',
              summary: 'Get details about a team',
              icon: 'info',
              group: 'Teams',
              input: z.object({
                  team_id: z.string().min(1).describe('Team ID to get information for'),
              }),
              output: z.object({
                  team: teamSchema.describe('Team details'),
              }),
              handle: async (params) => {
                  const { fuid } = getAuthContext();
                  const data = await figmaApi('/user/state', {
                      query: { team_id: params.team_id, fuid },
                  });
                  const teams = data.meta?.teams ?? [];
                  const team = teams.find(t => t.id === params.team_id) ?? teams[0];
                  if (!team)
                      throw ToolError.notFound('Team not found');
                  return { team: mapTeam(team) };
              },
          });
                    const waitForAuth = waitForFigmaAuth;

                    const refreshAuth = waitForFigmaAuth;



                    var pluginTool = getTeamInfo

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
                      var productProbe = PRODUCT_HOSTS['figma'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Figma page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)figma\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Figma page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Figma page.')
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
            async get_team_info(args) {
              return runTool('get_team_info', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['get_team_info'](args)
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
            'The Figma tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Figma API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Figma tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
