// Self-contained adapter workflow. The Shortcut session and every same-origin
// API call stay inside the Shortcut tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "epic_id": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991,
        "description": "Epic numeric ID"
      }
    },
    "required": [
      "epic_id"
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
    description: 'list_epic_stories',
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
              const cached = getAuthCache('shortcut');
              if (cached)
                  return cached;
              const url = getCurrentUrl();
              const slug = url.match(/app\.shortcut\.com\/([^/]+)/)?.[1];
              if (!slug || slug === 'signup' || slug === 'login')
                  return null;
              return null;
          };
          /**
           * Bootstrap auth by resolving the workspace slug to IDs via the slug-info endpoint.
           * Called from isReady() and cached for subsequent API calls.
           */
          const bootstrapAuth = async () => {
              const cached = getAuthCache('shortcut');
              if (cached)
                  return true;
              const url = getCurrentUrl();
              const slug = url.match(/app\.shortcut\.com\/([^/]+)/)?.[1];
              if (!slug || slug === 'signup' || slug === 'login')
                  return false;
              try {
                  const data = await fetchJSON(`/backend/api/private/user/slug-info/${slug}`);
                  const workspaceId = data?.id;
                  const organizationId = data?.organization2?.id;
                  if (!workspaceId || !organizationId)
                      return false;
                  setAuthCache('shortcut', { workspaceId, organizationId, slug });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const isShortcutAuthenticated = () => getAuth() !== null;
          const waitForShortcutAuth = async () => {
              try {
                  await waitUntil(() => bootstrapAuth(), { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          // --- API caller ---
          const tenantHeaders = () => {
              const auth = getAuthCache('shortcut');
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Shortcut.');
              return {
                  'Content-Type': 'application/json',
                  'Tenant-Organization2': auth.organizationId,
                  'Tenant-Workspace2': auth.workspaceId,
              };
          };
          /**
           * Call a Shortcut v3 API endpoint (documented public API, same-origin with session cookies).
           * Base path: /backend/api/v3
           */
          const api = async (endpoint, options = {}) => {
              const headers = tenantHeaders();
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `/backend/api/v3${endpoint}?${qs}` : `/backend/api/v3${endpoint}`;
              const method = options.method ?? 'GET';
              const init = { method, headers };
              if (options.body !== undefined) {
                  init.body = JSON.stringify(options.body);
              }
              try {
                  if (method === 'DELETE') {
                      const response = await fetchFromPage(url, init);
                      if (response.status === 204)
                          return {};
                      return (await response.json());
                  }
                  return (await fetchJSON(url, init));
              }
              catch (e) {
                  if (e instanceof ToolError && (e.code === 'AUTH_ERROR' || e.code === 'FORBIDDEN')) {
                      clearAuthCache('shortcut');
                  }
                  throw e;
              }
          };

          // --- Shared output schemas ---
          const storySchema = z.object({
              id: z.number().int().describe('Story numeric ID'),
              name: z.string().describe('Story title'),
              app_url: z.string().describe('Web URL to the story'),
              story_type: z.string().describe('Story type: feature, bug, or chore'),
              description: z.string().describe('Story description in Markdown'),
              archived: z.boolean().describe('Whether the story is archived'),
              started: z.boolean().describe('Whether the story has been started'),
              completed: z.boolean().describe('Whether the story is completed'),
              blocker: z.boolean().describe('Whether the story is a blocker'),
              blocked: z.boolean().describe('Whether the story is blocked'),
              workflow_state_id: z.number().int().describe('Workflow state ID'),
              workflow_id: z.number().int().describe('Workflow ID'),
              epic_id: z.number().int().nullable().describe('Epic ID, or null'),
              iteration_id: z.number().int().nullable().describe('Iteration ID, or null'),
              group_id: z.string().describe('Team (group) ID, or empty'),
              estimate: z.number().nullable().describe('Story point estimate, or null'),
              deadline: z.string().describe('Deadline in ISO 8601, or empty'),
              owner_ids: z.array(z.string()).describe('Member IDs of story owners'),
              label_ids: z.array(z.number().int()).describe('Label IDs attached to the story'),
              requested_by_id: z.string().describe('Member ID of the requester'),
              project_id: z.number().int().nullable().describe('Project ID, or null'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last-updated timestamp'),
          });
          const storyDetailSchema = storySchema.extend({
              labels: z.array(z.object({ id: z.number().int(), name: z.string() })).describe('Attached labels'),
              story_links: z
                  .array(z.object({
                  id: z.number().int().describe('Story link ID'),
                  type: z.string().describe('Relationship type'),
                  subject_id: z.number().int().describe('Subject story ID'),
                  object_id: z.number().int().describe('Object story ID'),
              }))
                  .describe('Relationships to other stories'),
              comment_ids: z.array(z.number().int()).describe('IDs of comments on this story'),
              task_ids: z.array(z.number().int()).describe('IDs of tasks in this story'),
          });
          const epicSchema = z.object({
              id: z.number().int().describe('Epic numeric ID'),
              name: z.string().describe('Epic name'),
              app_url: z.string().describe('Web URL to the epic'),
              description: z.string().describe('Epic description in Markdown'),
              archived: z.boolean().describe('Whether the epic is archived'),
              started: z.boolean().describe('Whether the epic has been started'),
              completed: z.boolean().describe('Whether the epic is completed'),
              state: z.string().describe('Epic state: to do, in progress, or done'),
              deadline: z.string().describe('Deadline in ISO 8601, or empty'),
              owner_ids: z.array(z.string()).describe('Member IDs of epic owners'),
              label_ids: z.array(z.number().int()).describe('Label IDs attached'),
              objective_ids: z.array(z.number().int()).describe('Objective IDs linked'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last-updated timestamp'),
          });
          const memberSchema = z.object({
              id: z.string().describe('Member UUID'),
              role: z.string().describe('Role: admin, member, or observer'),
              disabled: z.boolean().describe('Whether the member is disabled'),
              name: z.string().describe('Display name from profile'),
              mention_name: z.string().describe('@mention handle'),
              email: z.string().describe('Email address'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
          });
          const labelSchema = z.object({
              id: z.number().int().describe('Label numeric ID'),
              name: z.string().describe('Label name'),
              color: z.string().describe('Hex color code'),
              description: z.string().describe('Label description'),
              archived: z.boolean().describe('Whether the label is archived'),
          });
          const workflowSchema = z.object({
              id: z.number().int().describe('Workflow numeric ID'),
              name: z.string().describe('Workflow name'),
              team_id: z.number().int().describe('Associated team ID'),
              default_state_id: z.number().int().describe('Default state ID'),
              states: z
                  .array(z.object({
                  id: z.number().int().describe('State ID'),
                  name: z.string().describe('State name'),
                  type: z.string().describe('State type: unstarted, started, or done'),
                  position: z.number().int().describe('Display position'),
              }))
                  .describe('Workflow states in order'),
          });
          const teamSchema = z.object({
              id: z.number().int().describe('Team numeric ID'),
              name: z.string().describe('Team name'),
              description: z.string().describe('Team description'),
              workflow_id: z.number().int().describe('Associated workflow ID'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
          });
          const iterationSchema = z.object({
              id: z.number().int().describe('Iteration numeric ID'),
              name: z.string().describe('Iteration name'),
              app_url: z.string().describe('Web URL to the iteration'),
              status: z.string().describe('Iteration status: unstarted, started, or done'),
              start_date: z.string().describe('Start date in YYYY-MM-DD format'),
              end_date: z.string().describe('End date in YYYY-MM-DD format'),
              label_ids: z.array(z.number().int()).describe('Label IDs attached'),
              group_ids: z.array(z.string()).describe('Team IDs associated'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last-updated timestamp'),
          });
          const commentSchema = z.object({
              id: z.number().int().describe('Comment numeric ID'),
              text: z.string().describe('Comment body in Markdown'),
              author_id: z.string().describe('Member ID of the author'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last-updated timestamp'),
          });
          const objectiveSchema = z.object({
              id: z.number().int().describe('Objective numeric ID'),
              name: z.string().describe('Objective name'),
              app_url: z.string().describe('Web URL'),
              description: z.string().describe('Objective description'),
              archived: z.boolean().describe('Whether the objective is archived'),
              state: z.string().describe('Objective state'),
              completed: z.boolean().describe('Whether the objective is completed'),
              started: z.boolean().describe('Whether the objective has been started'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              updated_at: z.string().describe('ISO 8601 last-updated timestamp'),
          });
          const searchResultSchema = z.object({
              data: z.array(storySchema).describe('Matching stories'),
              total: z.number().int().describe('Total number of results'),
              next: z.string().describe('Cursor token for next page, or empty'),
          });
          // --- Defensive mappers ---
          const mapStory = (s) => ({
              id: s.id ?? 0,
              name: s.name ?? '',
              app_url: s.app_url ?? '',
              story_type: s.story_type ?? '',
              description: s.description ?? '',
              archived: s.archived ?? false,
              started: s.started ?? false,
              completed: s.completed ?? false,
              blocker: s.blocker ?? false,
              blocked: s.blocked ?? false,
              workflow_state_id: s.workflow_state_id ?? 0,
              workflow_id: s.workflow_id ?? 0,
              epic_id: s.epic_id ?? null,
              iteration_id: s.iteration_id ?? null,
              group_id: s.group_id ?? '',
              estimate: s.estimate ?? null,
              deadline: s.deadline ?? '',
              owner_ids: s.owner_ids ?? [],
              label_ids: s.label_ids ?? [],
              requested_by_id: s.requested_by_id ?? '',
              project_id: s.project_id ?? null,
              created_at: s.created_at ?? '',
              updated_at: s.updated_at ?? '',
          });
          const mapStoryDetail = (s) => ({
              ...mapStory(s),
              labels: (s.labels ?? []).map(l => ({ id: l.id ?? 0, name: l.name ?? '' })),
              story_links: (s.story_links ?? []).map(l => ({
                  id: l.id ?? 0,
                  type: l.type ?? '',
                  subject_id: l.subject_id ?? 0,
                  object_id: l.object_id ?? 0,
              })),
              comment_ids: s.comment_ids ?? [],
              task_ids: s.task_ids ?? [],
          });
          const mapEpic = (e) => ({
              id: e.id ?? 0,
              name: e.name ?? '',
              app_url: e.app_url ?? '',
              description: e.description ?? '',
              archived: e.archived ?? false,
              started: e.started ?? false,
              completed: e.completed ?? false,
              state: e.state ?? '',
              deadline: e.deadline ?? '',
              owner_ids: e.owner_ids ?? [],
              label_ids: e.label_ids ?? [],
              objective_ids: e.objective_ids ?? [],
              created_at: e.created_at ?? '',
              updated_at: e.updated_at ?? '',
          });
          const mapMember = (m) => ({
              id: m.id ?? '',
              role: m.role ?? '',
              disabled: m.disabled ?? false,
              name: m.profile?.name ?? '',
              mention_name: m.profile?.mention_name ?? '',
              email: m.profile?.email_address ?? '',
              created_at: m.created_at ?? '',
          });
          const mapLabel = (l) => ({
              id: l.id ?? 0,
              name: l.name ?? '',
              color: l.color ?? '',
              description: l.description ?? '',
              archived: l.archived ?? false,
          });
          const mapWorkflow = (w) => ({
              id: w.id ?? 0,
              name: w.name ?? '',
              team_id: w.team_id ?? 0,
              default_state_id: w.default_state_id ?? 0,
              states: (w.states ?? []).map(s => ({
                  id: s.id ?? 0,
                  name: s.name ?? '',
                  type: s.type ?? '',
                  position: s.position ?? 0,
              })),
          });
          const mapTeam = (t) => ({
              id: t.id ?? 0,
              name: t.name ?? '',
              description: t.description ?? '',
              workflow_id: t.workflow?.id ?? 0,
              created_at: t.created_at ?? '',
          });
          const mapIteration = (i) => ({
              id: i.id ?? 0,
              name: i.name ?? '',
              app_url: i.app_url ?? '',
              status: i.status ?? '',
              start_date: i.start_date ?? '',
              end_date: i.end_date ?? '',
              label_ids: i.label_ids ?? [],
              group_ids: i.group_ids ?? [],
              created_at: i.created_at ?? '',
              updated_at: i.updated_at ?? '',
          });
          const mapComment = (c) => ({
              id: c.id ?? 0,
              text: c.text ?? '',
              author_id: c.author_id ?? '',
              created_at: c.created_at ?? '',
              updated_at: c.updated_at ?? '',
          });
          const mapObjective = (o) => ({
              id: o.id ?? 0,
              name: o.name ?? '',
              app_url: o.app_url ?? '',
              description: o.description ?? '',
              archived: o.archived ?? false,
              state: o.state ?? '',
              completed: o.completed ?? false,
              started: o.started ?? false,
              created_at: o.created_at ?? '',
              updated_at: o.updated_at ?? '',
          });
          const listEpicStories = defineTool({
              name: 'list_epic_stories',
              displayName: 'List Epic Stories',
              description: 'List all stories that belong to a specific epic.',
              summary: 'List stories in an epic',
              icon: 'file-text',
              group: 'Epics',
              input: z.object({
                  epic_id: z.number().int().describe('Epic numeric ID'),
              }),
              output: z.object({ stories: z.array(storySchema).describe('Stories in the epic') }),
              handle: async (params) => {
                  const data = await api(`/epics/${params.epic_id}/stories`);
                  return { stories: (data ?? []).map(mapStory) };
              },
          });
                    const waitForAuth = waitForShortcutAuth;

                    const refreshAuth = waitForShortcutAuth;



                    var pluginTool = listEpicStories

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
                      var productProbe = PRODUCT_HOSTS['shortcut'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Shortcut page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)app\\.shortcut\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Shortcut page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Shortcut page.')
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
            async list_epic_stories(args) {
              return runTool('list_epic_stories', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_epic_stories'](args)
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
            'The Shortcut tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Shortcut API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Shortcut tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
