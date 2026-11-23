// Self-contained adapter workflow. The Vercel session and every same-origin
// API call stay inside the Vercel tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "limit": {
        "description": "Maximum number of teams to return (default 20)",
        "type": "number"
      },
      "since": {
        "description": "Pagination cursor — timestamp to start from",
        "type": "string"
      }
    },
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
    description: 'list_teams',
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

          /**
           * Vercel uses an HttpOnly `authorization` cookie containing a Bearer token.
           * The browser sends it automatically with `credentials: 'include'`.
           * Auth status is detected from the non-HttpOnly `isLoggedIn` cookie.
           * The API is same-origin at `/api/`.
           */
          const getAuth = () => {
              const persisted = getAuthCache('vercel');
              if (persisted)
                  return persisted;
              if (getCookie('isLoggedIn') !== '1')
                  return null;
              const auth = { teamSlug: extractTeamSlug() };
              setAuthCache('vercel', auth);
              return auth;
          };
          const EXCLUDED_PATHS = new Set(['account', 'login', 'signup', 'new', 'api', 'docs', 'blog', 'import', 'integrations']);
          const extractTeamSlugFromPath = (pathname) => {
              // URL pattern: /[teamSlug]/[project]/...
              const match = pathname.match(/^\/([a-z0-9][a-z0-9-]+)\//);
              if (match?.[1] && !EXCLUDED_PATHS.has(match[1]))
                  return match[1];
              return null;
          };
          const extractTeamSlug = () => extractTeamSlugFromPath(window.location.pathname);
          // --- Public auth helpers ---
          const isVercelAuthenticated = () => getAuth() !== null;
          const waitForVercelAuth = () => waitUntil(() => isVercelAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          /** Get the team slug from the current URL, if present */
          const getTeamSlug = () => {
              const auth = getAuth();
              return auth?.teamSlug ?? extractTeamSlug();
          };
          /** Re-extract the team slug from the given URL and update the auth cache. No-op if not authenticated. */
          const updateCachedTeamSlug = (url) => {
              const cached = getAuthCache('vercel');
              if (!cached)
                  return;
              let pathname;
              try {
                  pathname = new URL(url).pathname;
              }
              catch {
                  return; // invalid URL — skip cache update
              }
              const teamSlug = extractTeamSlugFromPath(pathname);
              if (teamSlug !== cached.teamSlug) {
                  setAuthCache('vercel', { ...cached, teamSlug });
              }
          };
          const vercelApi = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Vercel.');
              // Build URL — Vercel API is same-origin at /api/
              let url = `/api${endpoint}`;
              const mergedQuery = { ...options.query };
              // Auto-inject teamId/slug for team-scoped requests
              if (auth.teamSlug && !mergedQuery.teamId && !mergedQuery.slug) {
                  mergedQuery.slug = auth.teamSlug;
              }
              const params = new URLSearchParams();
              for (const [key, value] of Object.entries(mergedQuery)) {
                  if (Array.isArray(value)) {
                      for (const v of value) {
                          if (v !== undefined)
                              params.append(key, String(v));
                      }
                  }
                  else if (value !== undefined) {
                      params.append(key, String(value));
                  }
              }
              const qs = params.toString();
              if (qs)
                  url += `?${qs}`;
              const headers = {};
              let fetchBody;
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = JSON.stringify(options.body);
              }
              const method = options.method ?? 'GET';
              let response;
              try {
                  response = await fetch(url, {
                      method,
                      headers,
                      body: fetchBody,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  }
                  if (err instanceof DOMException && err.name === 'AbortError') {
                      throw new ToolError('Request was aborted', 'aborted');
                  }
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (!response.ok) {
                  const errorBody = (await response.text().catch(() => '')).substring(0, 512);
                  if (response.status === 429) {
                      const retryAfter = response.headers.get('Retry-After');
                      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 401 || response.status === 403) {
                      clearAuthCache('vercel');
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404) {
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  }
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              return (await response.json());
          };

          // --- Project ---
          const projectSchema = z.object({
              id: z.string().describe('Project ID'),
              name: z.string().describe('Project name'),
              framework: z.string().nullable().describe('Detected framework (e.g., "nextjs", "vite")'),
              node_version: z.string().describe('Node.js version used for builds'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
              live: z.boolean().describe('Whether the project has a production deployment'),
              git_repository: z
                  .object({
                  type: z.string().describe('Git provider (e.g., "github")'),
                  repo: z.string().describe('Repository name (owner/repo)'),
              })
                  .nullable()
                  .describe('Linked Git repository'),
          });
          const mapProject = (p) => {
              const link = p.link;
              return {
                  id: p.id ?? '',
                  name: p.name ?? '',
                  framework: p.framework ?? null,
                  node_version: p.nodeVersion ?? '18.x',
                  created_at: p.createdAt ? new Date(p.createdAt).toISOString() : '',
                  updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : '',
                  live: p.live ?? false,
                  git_repository: link
                      ? {
                          type: link.type ?? '',
                          repo: link.repo ?? '',
                      }
                      : null,
              };
          };
          // --- Deployment ---
          const deploymentSchema = z.object({
              uid: z.string().describe('Deployment ID'),
              name: z.string().describe('Project name'),
              url: z.string().describe('Deployment URL'),
              state: z.string().describe('Deployment state (READY, ERROR, BUILDING, QUEUED, CANCELED)'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              ready_at: z.string().nullable().describe('ISO 8601 ready timestamp'),
              source: z.string().describe('Deployment source (e.g., "git", "cli")'),
              target: z.string().nullable().describe('Deployment target ("production" or null for preview)'),
              meta: z
                  .object({
                  git_commit_sha: z.string().describe('Git commit SHA'),
                  git_commit_message: z.string().describe('Git commit message'),
                  git_commit_ref: z.string().describe('Git branch name'),
              })
                  .nullable()
                  .describe('Git metadata'),
          });
          const mapDeployment = (d) => {
              const meta = d.meta;
              return {
                  uid: d.uid ?? '',
                  name: d.name ?? '',
                  url: d.url ?? '',
                  state: d.state ?? d.readyState ?? '',
                  created_at: (d.createdAt ?? d.created) ? new Date((d.createdAt ?? d.created)).toISOString() : '',
                  ready_at: d.ready ? new Date(d.ready).toISOString() : null,
                  source: d.source ?? '',
                  target: d.target ?? null,
                  meta: meta
                      ? {
                          git_commit_sha: meta.githubCommitSha ?? meta.gitlabCommitSha ?? '',
                          git_commit_message: meta.githubCommitMessage ?? meta.gitlabCommitMessage ?? '',
                          git_commit_ref: meta.githubCommitRef ?? meta.gitlabCommitRef ?? '',
                      }
                      : null,
              };
          };
          // --- Domain ---
          const domainSchema = z.object({
              name: z.string().describe('Domain name'),
              configured: z.boolean().describe('Whether DNS is properly configured'),
              redirect: z.string().nullable().describe('Redirect target domain, if this is a redirect'),
              redirect_status_code: z.number().nullable().describe('HTTP status code for redirect (301 or 308)'),
              git_branch: z.string().nullable().describe('Git branch this domain is linked to'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapDomain = (d) => ({
              name: d.name ?? '',
              configured: d.configured ?? false,
              redirect: d.redirect ?? null,
              redirect_status_code: d.redirectStatusCode ?? null,
              git_branch: d.gitBranch ?? null,
              created_at: d.createdAt ? new Date(d.createdAt).toISOString() : '',
              updated_at: d.updatedAt ? new Date(d.updatedAt).toISOString() : '',
          });
          // --- Environment Variable ---
          const envVarSchema = z.object({
              id: z.string().describe('Environment variable ID'),
              key: z.string().describe('Variable name'),
              value: z.string().describe('Variable value (may be encrypted/masked)'),
              target: z.array(z.string()).describe('Deployment targets: "production", "preview", "development"'),
              type: z.string().describe('Variable type: "system", "encrypted", "plain", "secret", "sensitive"'),
              git_branch: z.string().nullable().describe('Git branch filter, if scoped to a specific branch'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last update timestamp'),
          });
          const mapEnvVar = (e) => ({
              id: e.id ?? '',
              key: e.key ?? '',
              value: e.value ?? '',
              target: Array.isArray(e.target) ? e.target : [],
              type: e.type ?? 'plain',
              git_branch: e.gitBranch ?? null,
              created_at: e.createdAt ? new Date(e.createdAt).toISOString() : '',
              updated_at: e.updatedAt ? new Date(e.updatedAt).toISOString() : '',
          });
          const listTeams = defineTool({
              name: 'list_teams',
              displayName: 'List Teams',
              description: 'List all teams the current user belongs to. Returns team names, slugs, billing plans, and roles.',
              summary: 'List Vercel teams',
              icon: 'users',
              group: 'Account',
              input: z.object({
                  limit: z.number().optional().describe('Maximum number of teams to return (default 20)'),
                  since: z.string().optional().describe('Pagination cursor — timestamp to start from'),
              }),
              output: z.object({
                  teams: z
                      .array(z.object({
                      id: z.string().describe('Team ID'),
                      slug: z.string().describe('Team slug'),
                      name: z.string().describe('Team name'),
                      billing_plan: z.string().describe('Billing plan (hobby, pro, enterprise)'),
                      role: z.string().describe('Current user role in this team (OWNER, MEMBER, etc.)'),
                      created_at: z.string().describe('ISO 8601 creation timestamp'),
                  }))
                      .describe('List of teams'),
              }),
              handle: async (params) => {
                  const data = await vercelApi('/v2/teams', {
                      query: { limit: params.limit ?? 20, since: params.since },
                  });
                  const teams = Array.isArray(data.teams) ? data.teams : [];
                  return {
                      teams: teams.map(t => {
                          const billing = t.billing;
                          const membership = t.membership;
                          return {
                              id: t.id ?? '',
                              slug: t.slug ?? '',
                              name: t.name ?? '',
                              billing_plan: billing?.plan ?? 'hobby',
                              role: membership?.role ?? '',
                              created_at: t.createdAt ? new Date(t.createdAt).toISOString() : (t.created ?? ''),
                          };
                      }),
                  };
              },
          });
                    const waitForAuth = waitForVercelAuth;

                    const refreshAuth = waitForVercelAuth;



                    var pluginTool = listTeams

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
                      var productProbe = PRODUCT_HOSTS['vercel'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Vercel page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)vercel\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Vercel page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Vercel page.')
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
            async list_teams(args) {
              return runTool('list_teams', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_teams'](args)
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
            'The Vercel tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Vercel API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Vercel tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
