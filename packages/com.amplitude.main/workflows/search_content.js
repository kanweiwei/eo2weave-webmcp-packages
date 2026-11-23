// Self-contained adapter workflow. The Amplitude session and every same-origin
// API call stay inside the Amplitude tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search text (empty string for recent items)"
      },
      "limit": {
        "description": "Max results to return (default 30)",
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "content_types": {
        "description": "Filter by content types: CHART, DASHBOARD, COHORT, NOTEBOOK, NUDGE, SPACE (default: all)",
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "owners": {
        "description": "Filter by owner login IDs",
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "is_archived": {
        "description": "Include archived content (default false)",
        "type": "boolean"
      },
      "sort_order": {
        "description": "Sort order (default RELEVANCE)",
        "type": "string",
        "enum": [
          "RELEVANCE",
          "LAST_MODIFIED",
          "LAST_VIEWED",
          "VIEW_COUNT"
        ]
      },
      "sort_direction": {
        "description": "Sort direction (default DESC)",
        "type": "string",
        "enum": [
          "ASC",
          "DESC"
        ]
      }
    },
    "required": [
      "query"
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
    description: 'search_content',
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

          const extractOrgFromUrl = () => {
              // URL pattern: /analytics/{orgSlug}/...
              const match = window.location.pathname.match(/\/(analytics|experiment|data)\/([^/]+)/);
              const orgSlug = match?.[2] ?? '';
              if (!orgSlug)
                  return null;
              // Org ID comes from the JWT payload or intercomSettings
              const intercom = getPageGlobal('intercomSettings');
              const orgId = intercom?.org_id ?? '';
              if (!orgId)
                  return null;
              return { orgId, orgSlug };
          };
          const getAuth = () => {
              const cached = getAuthCache('amplitude');
              if (cached?.orgId && cached?.orgSlug)
                  return cached;
              const jwt = getCookie('onenav_jwt_prod');
              if (!jwt)
                  return null;
              const org = extractOrgFromUrl();
              if (!org)
                  return null;
              const auth = { orgId: org.orgId, orgSlug: org.orgSlug };
              setAuthCache('amplitude', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = async () => {
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
          const requireAuth = () => {
              const auth = getAuth();
              if (!auth) {
                  clearAuthCache('amplitude');
                  throw ToolError.auth('Not authenticated — please log in to Amplitude.');
              }
              return auth;
          };
          // --- GraphQL API ---
          const gql = async (operationName, query, variables = {}) => {
              const auth = requireAuth();
              const url = `/t/graphql/org/${auth.orgId}?q=${operationName}`;
              const init = {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'X-Org': auth.orgId,
                  },
                  body: JSON.stringify({ query, variables, operationName }),
              };
              const response = await fetchFromPage(url, init);
              const json = (await response.json());
              if (json.errors?.length && !json.data) {
                  const msg = json.errors.map(e => e.message).join('; ');
                  if (msg.includes('Unauthorized') || msg.includes('not authenticated') || msg.includes('401')) {
                      clearAuthCache('amplitude');
                      throw ToolError.auth(msg);
                  }
                  throw ToolError.internal(`GraphQL error: ${msg}`);
              }
              return json.data;
          };

          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User login ID (email)'),
              alias: z.string().describe('User alias UUID'),
              email: z.string().describe('Email address'),
              first_name: z.string().describe('First name'),
              last_name: z.string().describe('Last name'),
              full_name: z.string().describe('Full display name'),
              org_role: z.number().int().describe('Organization role level (4=admin)'),
              org_team: z.string().nullable().describe('Organization team name'),
              title: z.string().describe('Job title'),
              pronouns: z.string().nullable().describe('Preferred pronouns'),
              has_avatar: z.boolean().describe('Whether the user has a custom avatar'),
              created_at: z.number().describe('Unix timestamp of account creation'),
              is_connected_to_slack: z.boolean().describe('Whether connected to Slack integration'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              alias: u.alias ?? '',
              email: u.email ?? '',
              first_name: u.firstName ?? '',
              last_name: u.lastName ?? '',
              full_name: u.fullName ?? '',
              org_role: u.orgRole ?? 0,
              org_team: u.orgTeam ?? null,
              title: u.title ?? '',
              pronouns: u.pronouns ?? null,
              has_avatar: u.hasAvatar ?? false,
              created_at: u.createdAt ?? 0,
              is_connected_to_slack: u.isConnectedToSlack ?? false,
          });
          // --- App (Project) ---
          const appSchema = z.object({
              id: z.string().describe('App/project numeric ID'),
              name: z.string().describe('App/project name'),
          });
          const mapApp = (a) => ({
              id: String(a.id ?? ''),
              name: a.name ?? '',
          });
          // --- Space ---
          const spaceSchema = z.object({
              id: z.string().describe('Space ID'),
              space_id: z.string().describe('Space UUID'),
              org_id: z.string().describe('Organization ID'),
              type: z.string().describe('Space type (PERSONAL, TEAM, etc.)'),
              name: z.string().describe('Space display name'),
              description: z.string().nullable().describe('Space description'),
              is_archived: z.boolean().describe('Whether the space is archived'),
              is_deleted: z.boolean().describe('Whether the space is soft-deleted'),
              item_count: z.number().int().describe('Number of items in the space'),
              created_by: z.string().describe('Login ID of the creator'),
              created_at: z.number().describe('Unix timestamp of creation'),
              last_modified_at: z.number().describe('Unix timestamp of last modification'),
              permission_level: z.number().int().describe('Permission level'),
              public: z.boolean().describe('Whether the space is public'),
          });
          const mapSpace = (s) => ({
              id: s.id ?? '',
              space_id: s.spaceId ?? '',
              org_id: s.orgId ?? '',
              type: s.type ?? '',
              name: s.name ?? '',
              description: s.description ?? null,
              is_archived: s.isArchived ?? false,
              is_deleted: s.isDeleted ?? false,
              item_count: s.itemCount ?? 0,
              created_by: s.createdBy ?? '',
              created_at: s.createdAt ?? 0,
              last_modified_at: s.lastModifiedAt ?? 0,
              permission_level: s.permissionLevel ?? 0,
              public: s.public ?? false,
          });
          // --- Search Result ---
          const searchResultSchema = z.object({
              entity_id: z.string().describe('Entity ID (format: appId_entityId)'),
              name: z.string().describe('Content name'),
              description: z.string().nullable().describe('Content description'),
              type: z.string().describe('Content type (CHART, DASHBOARD, COHORT, NOTEBOOK, SPACE, NUDGE)'),
              chart_type: z.string().nullable().describe('Chart sub-type if applicable'),
              owners: z.array(z.string()).describe('Owner login IDs'),
              is_official: z.boolean().describe('Whether marked as official'),
              is_template: z.boolean().describe('Whether it is a template'),
              is_archived: z.boolean().describe('Whether archived'),
              last_modified_at: z.number().describe('Unix timestamp of last modification'),
              view_count: z.number().int().describe('Total view count'),
          });
          const mapSearchResult = (r) => {
              const e = r.entity ?? {};
              return {
                  entity_id: e.entityId ?? '',
                  name: e.name ?? '',
                  description: e.description ?? null,
                  type: e.type ?? '',
                  chart_type: e.chartType ?? null,
                  owners: e.owners ?? [],
                  is_official: e.isOfficial ?? false,
                  is_template: e.isTemplate ?? false,
                  is_archived: e.isArchived ?? false,
                  last_modified_at: e.lastModifiedAt ?? 0,
                  view_count: e.viewCount ?? 0,
              };
          };
          // --- Entitlement ---
          const entitlementSchema = z.object({
              type: z.string().describe('Entitlement type'),
              source: z.string().describe('Entitlement source'),
              plan: z.string().describe('Associated plan'),
              quota: z.number().describe('Quota limit'),
              quota_type: z.string().describe('Quota type'),
              start_time: z.string().describe('Start time ISO string'),
              end_time: z.string().describe('End time ISO string'),
          });
          const mapEntitlement = (e) => ({
              type: e.type ?? '',
              source: e.source ?? '',
              plan: e.plan ?? '',
              quota: e.quota ?? 0,
              quota_type: e.quotaType ?? '',
              start_time: e.startTime ?? '',
              end_time: e.endTime ?? '',
          });
          // --- Volume ---
          const volumeSchema = z.object({
              month: z.string().describe('Month in YYYY-MM-DD format'),
              total: z.number().describe('Total count for the month'),
              billed: z.number().describe('Billed count for the month'),
          });
          const QUERY = `query GlobalSearch($query: String!, $limit: Int!, $appIds: [String!], $isArchived: Boolean, $isGenerated: Boolean, $isOfficial: Boolean, $isTemplate: Boolean, $lastModifiedAfter: Float, $lastViewedBefore: Float, $owners: [String!], $searchContentTypes: [String!]!, $sortDirection: SortDirection, $sortOrder: SortOrder, $spaceIds: [String!], $chartTypes: [String!]) {
            unisearchContentSearch(
              query: $query limit: $limit appIds: $appIds isArchived: $isArchived
              isGenerated: $isGenerated isOfficial: $isOfficial isTemplate: $isTemplate
              lastModifiedAfter: $lastModifiedAfter lastViewedBefore: $lastViewedBefore
              owners: $owners searchContentTypes: $searchContentTypes
              sortDirection: $sortDirection sortOrder: $sortOrder
              spaceIds: $spaceIds chartTypes: $chartTypes
            ) {
              results {
                entity {
                  entityId name description type chartType chartCount nudgeType
                  owners isOfficial isTemplate appIds lastModifiedAt lastViewedAt
                  isArchived location { locationId } viewCount
                }
                scoreComponents
              }
              totalHits
            }
          }`;
          const searchContent = defineTool({
              name: 'search_content',
              displayName: 'Search Content',
              description: 'Search across all Amplitude content including charts, dashboards, cohorts, notebooks, and nudges. Filter by content type, owner, space, and more. Results are sorted by relevance by default.',
              summary: 'Search charts, dashboards, cohorts, and more',
              icon: 'search',
              group: 'Search',
              input: z.object({
                  query: z.string().describe('Search text (empty string for recent items)'),
                  limit: z.number().int().min(1).max(100).optional().describe('Max results to return (default 30)'),
                  content_types: z
                      .array(z.string())
                      .optional()
                      .describe('Filter by content types: CHART, DASHBOARD, COHORT, NOTEBOOK, NUDGE, SPACE (default: all)'),
                  owners: z.array(z.string()).optional().describe('Filter by owner login IDs'),
                  is_archived: z.boolean().optional().describe('Include archived content (default false)'),
                  sort_order: z
                      .enum(['RELEVANCE', 'LAST_MODIFIED', 'LAST_VIEWED', 'VIEW_COUNT'])
                      .optional()
                      .describe('Sort order (default RELEVANCE)'),
                  sort_direction: z.enum(['ASC', 'DESC']).optional().describe('Sort direction (default DESC)'),
              }),
              output: z.object({
                  results: z.array(searchResultSchema).describe('Search results'),
                  total_hits: z.number().int().describe('Total number of matching results'),
              }),
              handle: async (params) => {
                  const data = await gql('GlobalSearch', QUERY, {
                      query: params.query,
                      limit: params.limit ?? 30,
                      appIds: [],
                      isArchived: params.is_archived ?? false,
                      isGenerated: false,
                      isOfficial: false,
                      isTemplate: false,
                      lastModifiedAfter: 0,
                      searchContentTypes: params.content_types ?? [],
                      sortDirection: params.sort_direction ?? 'DESC',
                      sortOrder: params.sort_order ?? 'RELEVANCE',
                      spaceIds: [],
                      owners: params.owners ?? [],
                  });
                  const search = data.unisearchContentSearch ?? {
                      results: [],
                      totalHits: 0,
                  };
                  return {
                      results: search.results.map(mapSearchResult),
                      total_hits: search.totalHits ?? 0,
                  };
              },
          });


                    var pluginTool = searchContent

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Amplitude page.')
                      }
                      if (!/(^|\.)amplitude\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Amplitude page.')
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
            async search_content(args) {
              return runTool('search_content', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['search_content'](args)
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
            'The Amplitude tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Amplitude API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Amplitude tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
