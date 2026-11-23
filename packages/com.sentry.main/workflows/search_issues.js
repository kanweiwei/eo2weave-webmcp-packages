// Self-contained adapter workflow. The Sentry session and every same-origin
// API call stay inside the Sentry tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "query": {
        "description": "Search query using Sentry search syntax (e.g., \"is:unresolved\", \"assigned:me\", \"level:error\"). Defaults to \"is:unresolved\"",
        "type": "string"
      },
      "project": {
        "description": "Array of project IDs to filter by. Omit to search all projects",
        "type": "array",
        "items": {
          "type": "number",
          "description": "Project ID"
        }
      },
      "environment": {
        "description": "Environment names to filter by (e.g., [\"production\", \"staging\"])",
        "type": "array",
        "items": {
          "type": "string",
          "description": "Environment name"
        }
      },
      "sort": {
        "description": "Sort order: \"date\" (last seen), \"new\" (first seen), \"freq\" (events), \"user\" (users), \"trends\"",
        "type": "string",
        "enum": [
          "date",
          "new",
          "freq",
          "user",
          "trends"
        ]
      },
      "limit": {
        "description": "Maximum number of issues to return (default 25, max 100)",
        "type": "number"
      },
      "cursor": {
        "description": "Pagination cursor from a previous response",
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
    description: 'search_issues',
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

          /**
           * Sentry uses HttpOnly session cookies for the web UI.
           * The browser sends them automatically with `credentials: 'include'`.
           * Auth status is detected from `window.__initialData.isAuthenticated` and the
           * `sentry-sc` cookie (non-HttpOnly CSRF token that indicates an active session).
           * Write operations require an `X-CSRFToken` header with the `sentry-sc` cookie value.
           */
          const getAuth = () => {
              const cached = getAuthCache('sentry');
              if (cached)
                  return cached;
              const orgSlug = extractOrgSlug();
              if (!orgSlug)
                  return null;
              const isAuthed = detectAuthentication();
              if (!isAuthed)
                  return null;
              const auth = { orgSlug };
              setAuthCache('sentry', auth);
              return auth;
          };
          const extractOrgSlug = () => {
              const hostname = window.location.hostname;
              // Pattern: <org-slug>.sentry.io (SaaS)
              const subdomainMatch = hostname.match(/^([a-z0-9-]+)\.sentry\.io$/);
              if (subdomainMatch?.[1] &&
                  subdomainMatch[1] !== 'sentry' &&
                  subdomainMatch[1] !== 'docs' &&
                  subdomainMatch[1] !== 'blog') {
                  return subdomainMatch[1];
              }
              // Self-hosted and sentry.io path-based: /organizations/<org-slug>/
              const pathMatch = window.location.pathname.match(/^\/organizations\/([a-z0-9_-]+)\//);
              if (pathMatch?.[1])
                  return pathMatch[1];
              return null;
          };
          const detectAuthentication = () => {
              // Primary: check window.__initialData.isAuthenticated (set by Sentry's server-rendered bootstrap)
              if (getPageGlobal('__initialData.isAuthenticated') === true)
                  return true;
              // Secondary: check for the sentry-sc CSRF cookie (non-HttpOnly, present when session is active)
              if (getCookie('sentry-sc') !== null)
                  return true;
              // Fallback: if we're on a sentry.io org subdomain and not on a login page
              const isLoginPage = window.location.pathname.includes('/auth/login');
              const isSentryIoOrg = /^[a-z0-9-]+\.sentry\.io$/.test(window.location.hostname);
              if (!isLoginPage && isSentryIoOrg)
                  return true;
              return false;
          };
          /** Extract the CSRF token from the `sentry-sc` cookie for write operations */
          const getCsrfToken = () => getCookie('sentry-sc');
          // --- Public auth helpers ---
          const isSentryAuthenticated = () => getAuth() !== null;
          const waitForSentryAuth = async () => {
              try {
                  await waitUntil(() => isSentryAuthenticated(), { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const getOrgSlug = () => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Sentry.');
              return auth.orgSlug;
          };
          // --- Pagination ---
          /** Parse the next cursor from the Link header returned by Sentry's paginated APIs. */
          const parseLinkCursor = (headers) => {
              const link = headers.get('Link');
              if (!link)
                  return undefined;
              const nextMatch = link.match(/<[^>]*[?&]cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/);
              return nextMatch?.[1] ?? undefined;
          };
          const sentryApi = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Sentry.');
              // Build URL — Sentry API is same-origin at /api/0/
              let url = `/api/0${endpoint}`;
              if (options.query) {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(options.query)) {
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
              }
              const headers = {};
              let fetchBody;
              // Write operations require the CSRF token
              const method = options.method ?? 'GET';
              if (method !== 'GET' && method !== 'HEAD') {
                  const csrfToken = getCsrfToken();
                  if (csrfToken) {
                      headers['X-CSRFToken'] = csrfToken;
                  }
              }
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = JSON.stringify(options.body);
              }
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
                      throw ToolError.timeout('Request was aborted');
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
                      clearAuthCache('sentry');
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404) {
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  }
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              const nextCursor = parseLinkCursor(response.headers);
              if (response.status === 204)
                  return { data: {}, nextCursor };
              return { data: (await response.json()), nextCursor };
          };

          // --- Issue ---
          const issueSchema = z.object({
              id: z.string().describe('Issue ID'),
              short_id: z.string().describe('Human-readable short ID (e.g., PROJECT-123)'),
              title: z.string().describe('Issue title'),
              culprit: z.string().describe('The function or module that caused the issue'),
              level: z.string().describe('Severity level (error, warning, info, debug, fatal)'),
              status: z.string().describe('Issue status (unresolved, resolved, ignored)'),
              priority: z.string().describe('Issue priority (critical, high, medium, low)'),
              count: z.string().describe('Total number of events for this issue'),
              user_count: z.number().describe('Number of unique users affected'),
              first_seen: z.string().describe('ISO 8601 timestamp when the issue was first seen'),
              last_seen: z.string().describe('ISO 8601 timestamp when the issue was last seen'),
              permalink: z.string().describe('URL to the issue in Sentry'),
              project: z
                  .object({
                  id: z.string().describe('Project ID'),
                  name: z.string().describe('Project name'),
                  slug: z.string().describe('Project slug'),
              })
                  .describe('Project the issue belongs to'),
              assigned_to: z.string().nullable().describe('Name of the assigned user or team, or null if unassigned'),
              is_bookmarked: z.boolean().describe('Whether the issue is bookmarked'),
              has_seen: z.boolean().describe('Whether the current user has seen the issue'),
              issue_category: z.string().describe('Issue category (error, performance, etc.)'),
              issue_type: z.string().describe('Specific issue type'),
          });
          const mapIssue = (i) => {
              const project = i?.project ?? {};
              const assignedTo = i?.assignedTo;
              return {
                  id: i?.id ?? '',
                  short_id: i?.shortId ?? '',
                  title: i?.title ?? '',
                  culprit: i?.culprit ?? '',
                  level: i?.level ?? '',
                  status: i?.status ?? '',
                  priority: i?.priority ?? '',
                  count: i?.count ?? '0',
                  user_count: i?.userCount ?? 0,
                  first_seen: i?.firstSeen ?? '',
                  last_seen: i?.lastSeen ?? '',
                  permalink: i?.permalink ?? '',
                  project: {
                      id: project.id ?? '',
                      name: project.name ?? '',
                      slug: project.slug ?? '',
                  },
                  assigned_to: assignedTo?.name ? assignedTo.name : null,
                  is_bookmarked: i?.isBookmarked ?? false,
                  has_seen: i?.hasSeen ?? false,
                  issue_category: i?.issueCategory ?? '',
                  issue_type: i?.issueType ?? '',
              };
          };
          // --- Event ---
          const eventSchema = z.object({
              id: z.string().describe('Event ID'),
              event_id: z.string().describe('Event UUID'),
              title: z.string().describe('Event title'),
              message: z.string().describe('Event message'),
              platform: z.string().describe('Platform (e.g., python, javascript)'),
              date_created: z.string().describe('ISO 8601 timestamp when the event occurred'),
              tags: z
                  .array(z.object({ key: z.string().describe('Tag key'), value: z.string().describe('Tag value') }))
                  .describe('Event tags'),
          });
          const mapEvent = (e) => {
              const rawTags = e?.tags ?? [];
              return {
                  id: e?.id ?? '',
                  event_id: e?.eventID ?? e?.id ?? '',
                  title: e?.title ?? '',
                  message: e?.message ?? e?.metadata?.value ?? '',
                  platform: e?.platform ?? '',
                  date_created: e?.dateCreated ?? '',
                  tags: rawTags.map(t => ({
                      key: t.key ?? '',
                      value: t.value ?? '',
                  })),
              };
          };
          // --- Project ---
          const projectSchema = z.object({
              id: z.string().describe('Project ID'),
              name: z.string().describe('Project name'),
              slug: z.string().describe('Project slug'),
              platform: z.string().describe('Project platform (e.g., python, javascript)'),
              date_created: z.string().describe('ISO 8601 timestamp when the project was created'),
              is_bookmarked: z.boolean().describe('Whether the project is bookmarked'),
              has_access: z.boolean().describe('Whether the current user has access'),
              status: z.string().describe('Project status'),
          });
          const mapProject = (p) => ({
              id: p?.id ?? '',
              name: p?.name ?? '',
              slug: p?.slug ?? '',
              platform: p?.platform ?? '',
              date_created: p?.dateCreated ?? '',
              is_bookmarked: p?.isBookmarked ?? false,
              has_access: p?.hasAccess ?? false,
              status: p?.status ?? '',
          });
          // --- Organization ---
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID'),
              name: z.string().describe('Organization name'),
              slug: z.string().describe('Organization slug'),
              date_created: z.string().describe('ISO 8601 timestamp when the org was created'),
              status: z.string().describe('Organization status'),
          });
          const mapOrganization = (o) => {
              const status = o?.status ?? {};
              return {
                  id: o?.id ?? '',
                  name: o?.name ?? '',
                  slug: o?.slug ?? '',
                  date_created: o?.dateCreated ?? '',
                  status: status.id ?? o?.status ?? '',
              };
          };
          // --- Team ---
          const teamSchema = z.object({
              id: z.string().describe('Team ID'),
              name: z.string().describe('Team name'),
              slug: z.string().describe('Team slug'),
              member_count: z.number().describe('Number of members in the team'),
              date_created: z.string().describe('ISO 8601 timestamp when the team was created'),
          });
          const mapTeam = (t) => ({
              id: t?.id ?? '',
              name: t?.name ?? '',
              slug: t?.slug ?? '',
              member_count: t?.memberCount ?? 0,
              date_created: t?.dateCreated ?? '',
          });
          // --- Member ---
          const memberSchema = z.object({
              id: z.string().describe('Member ID'),
              email: z.string().describe('Member email address'),
              name: z.string().describe('Member display name'),
              role: z.string().describe('Member role in the organization'),
              date_joined: z.string().describe('ISO 8601 timestamp when the member joined'),
              is_pending: z.boolean().describe('Whether the invitation is still pending'),
          });
          const mapMember = (m) => {
              const user = m?.user ?? {};
              return {
                  id: m?.id ?? '',
                  email: m?.email ?? user.email ?? '',
                  name: user.name ?? m?.name ?? '',
                  role: m?.orgRole ?? m?.role ?? '',
                  date_joined: m?.dateCreated ?? '',
                  is_pending: m?.pending ?? false,
              };
          };
          // --- Release ---
          const releaseSchema = z.object({
              version: z.string().describe('Release version identifier'),
              short_version: z.string().describe('Short version for display'),
              date_released: z.string().describe('ISO 8601 timestamp when the release was deployed'),
              date_created: z.string().describe('ISO 8601 timestamp when the release was created'),
              new_groups: z.number().describe('Number of new issues in this release'),
              commit_count: z.number().describe('Number of commits in this release'),
              deploy_count: z.number().describe('Number of deployments for this release'),
          });
          const mapRelease = (r) => ({
              version: r?.version ?? '',
              short_version: r?.shortVersion ?? '',
              date_released: r?.dateReleased ?? '',
              date_created: r?.dateCreated ?? '',
              new_groups: r?.newGroups ?? 0,
              commit_count: r?.commitCount ?? 0,
              deploy_count: r?.deployCount ?? 0,
          });
          const searchIssues = defineTool({
              name: 'search_issues',
              displayName: 'Search Issues',
              description: 'Search and list issues for a Sentry organization. Supports Sentry search syntax in the query parameter ' +
                  '(e.g., "is:unresolved", "assigned:me", "level:error", "first-seen:-24h"). ' +
                  'Filter by project IDs, environment, and time range. Results are paginated with a cursor.',
              summary: 'Search and list issues with optional filters',
              icon: 'search',
              group: 'Issues',
              input: z.object({
                  query: z
                      .string()
                      .optional()
                      .describe('Search query using Sentry search syntax (e.g., "is:unresolved", "assigned:me", "level:error"). Defaults to "is:unresolved"'),
                  project: z
                      .array(z.number().describe('Project ID'))
                      .optional()
                      .describe('Array of project IDs to filter by. Omit to search all projects'),
                  environment: z
                      .array(z.string().describe('Environment name'))
                      .optional()
                      .describe('Environment names to filter by (e.g., ["production", "staging"])'),
                  sort: z
                      .enum(['date', 'new', 'freq', 'user', 'trends'])
                      .optional()
                      .describe('Sort order: "date" (last seen), "new" (first seen), "freq" (events), "user" (users), "trends"'),
                  limit: z.number().optional().describe('Maximum number of issues to return (default 25, max 100)'),
                  cursor: z.string().optional().describe('Pagination cursor from a previous response'),
              }),
              output: z.object({
                  issues: z.array(issueSchema).describe('List of matching issues'),
                  cursor: z.string().describe('Pagination cursor for next page, empty if no more results'),
              }),
              handle: async (params) => {
                  const orgSlug = getOrgSlug();
                  const { data, nextCursor } = await sentryApi(`/organizations/${orgSlug}/issues/`, {
                      query: {
                          query: params.query ?? 'is:unresolved',
                          sort: params.sort,
                          limit: params.limit ?? 25,
                          cursor: params.cursor,
                          project: params.project,
                          environment: params.environment,
                      },
                  });
                  return {
                      issues: (Array.isArray(data) ? data : []).map(i => mapIssue(i)),
                      cursor: nextCursor ?? '',
                  };
              },
          });


                    var pluginTool = searchIssues

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Sentry page.')
                      }
                      if (!/(^|\.)sentry\.io$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Sentry page.')
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
            async search_issues(args) {
              return runTool('search_issues', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['search_issues'](args)
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
            'The Sentry tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Sentry API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Sentry tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
