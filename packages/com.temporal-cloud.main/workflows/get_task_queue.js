// Self-contained adapter workflow. The Temporal Cloud session and every same-origin
// API call stay inside the Temporal Cloud tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "namespace": {
        "description": "Temporal namespace (e.g., \"prod-us-west-2.abc123\"). Defaults to the namespace in the current browser tab.",
        "type": "string"
      },
      "task_queue": {
        "type": "string",
        "description": "Task queue name"
      }
    },
    "required": [
      "task_queue"
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
    description: 'get_task_queue',
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

          const AUTH0_CLIENT_ID = 'nTmmPY5xUpQnSr7gRZh7s33hNamtCeDg';
          const AUTH0_AUDIENCE = 'https://saas-api.tmprl.cloud';
          const getToken = () => {
              const entry = findLocalStorageEntry(key => key.startsWith(`@@auth0spajs@@::${AUTH0_CLIENT_ID}::`) && key.includes(AUTH0_AUDIENCE));
              if (!entry)
                  return null;
              try {
                  const data = JSON.parse(entry.value);
                  if (!data.body?.access_token)
                      return null;
                  if (data.expiresAt && data.expiresAt < Math.floor(Date.now() / 1000))
                      return null;
                  return data.body.access_token;
              }
              catch {
                  return null;
              }
          };
          const getAuth = () => {
              const freshToken = getToken();
              if (freshToken) {
                  const cached = getAuthCache('temporal-cloud');
                  if (cached?.token === freshToken)
                      return cached;
                  const auth = { token: freshToken };
                  setAuthCache('temporal-cloud', auth);
                  return auth;
              }
              clearAuthCache('temporal-cloud');
              return null;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const getDefaultNamespace = () => {
              const url = getCurrentUrl();
              const match = url.match(/\/namespaces\/([^/]+)/);
              if (match?.[1])
                  return match[1];
              const hostMatch = url.match(/^https?:\/\/([^.]+)\.web\.tmprl\.cloud/);
              return hostMatch?.[1] ?? null;
          };
          const resolveNamespace = (namespace) => {
              const ns = namespace || getDefaultNamespace();
              if (!ns) {
                  throw ToolError.validation('No namespace specified and none detected from the current page URL. Pass a namespace parameter explicitly.');
              }
              return ns;
          };
          const api = async (namespace, path, query) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — token may have expired. Please refresh the Temporal Cloud page to obtain a new token.');
              const baseUrl = `https://${namespace}.web.tmprl.cloud/api/v1`;
              const qs = query ? buildQueryString(query) : '';
              const url = qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;
              try {
                  const result = await fetchJSON(url, {
                      method: 'GET',
                      headers: { Authorization: `Bearer ${auth.token}` },
                  });
                  return result;
              }
              catch (err) {
                  if (err instanceof ToolError) {
                      if (err.category === 'auth') {
                          clearAuthCache('temporal-cloud');
                      }
                      throw err;
                  }
                  throw ToolError.internal(`Temporal API error: ${err instanceof Error ? err.message : String(err)}`);
              }
          };

          // --- Shared Parameters ---
          const namespaceParam = z
              .string()
              .optional()
              .describe('Temporal namespace (e.g., "prod-us-west-2.abc123"). Defaults to the namespace in the current browser tab.');
          // --- Workflow Execution ---
          const workflowExecutionSchema = z.object({
              workflow_id: z.string().describe('Workflow ID'),
              run_id: z.string().describe('Run ID for this execution'),
              type: z.string().describe('Workflow type name'),
              status: z.string().describe('Execution status (e.g., WORKFLOW_EXECUTION_STATUS_RUNNING)'),
              task_queue: z.string().describe('Task queue name'),
              start_time: z.string().describe('ISO 8601 start timestamp'),
              execution_time: z.string().describe('ISO 8601 execution timestamp'),
              close_time: z.string().describe('ISO 8601 close timestamp (empty if running)'),
              history_length: z.string().describe('Number of events in history'),
              memo: z.record(z.string(), z.string()).describe('Memo fields (key-value pairs)'),
              parent_workflow_id: z.string().describe('Parent workflow ID (empty if none)'),
              parent_run_id: z.string().describe('Parent run ID (empty if none)'),
              root_workflow_id: z.string().describe('Root workflow ID'),
              root_run_id: z.string().describe('Root run ID'),
          });
          const decodeMemo = (memo) => {
              if (!memo?.fields)
                  return {};
              const result = {};
              for (const [key, val] of Object.entries(memo.fields)) {
                  if (val?.data) {
                      try {
                          result[key] = atob(val.data);
                      }
                      catch {
                          result[key] = val.data;
                      }
                  }
              }
              return result;
          };
          const mapWorkflowExecution = (w) => ({
              workflow_id: w.execution?.workflowId ?? '',
              run_id: w.execution?.runId ?? '',
              type: w.type?.name ?? '',
              status: w.status ?? '',
              task_queue: w.taskQueue ?? '',
              start_time: w.startTime ?? '',
              execution_time: w.executionTime ?? '',
              close_time: w.closeTime ?? '',
              history_length: w.historyLength ?? '0',
              memo: decodeMemo(w.memo),
              parent_workflow_id: w.parentExecution?.workflowId ?? '',
              parent_run_id: w.parentExecution?.runId ?? '',
              root_workflow_id: w.rootExecution?.workflowId ?? '',
              root_run_id: w.rootExecution?.runId ?? '',
          });
          // --- Workflow Detail ---
          const workflowDetailSchema = z.object({
              workflow_id: z.string().describe('Workflow ID'),
              run_id: z.string().describe('Run ID'),
              type: z.string().describe('Workflow type name'),
              status: z.string().describe('Execution status'),
              task_queue: z.string().describe('Task queue name'),
              start_time: z.string().describe('ISO 8601 start timestamp'),
              execution_time: z.string().describe('ISO 8601 execution timestamp'),
              close_time: z.string().describe('ISO 8601 close timestamp (empty if running)'),
              history_length: z.string().describe('Number of events in history'),
              history_size_bytes: z.string().describe('History size in bytes'),
              state_transition_count: z.string().describe('Number of state transitions'),
              first_run_id: z.string().describe('First run ID in the chain'),
              execution_timeout: z.string().describe('Workflow execution timeout'),
              run_timeout: z.string().describe('Workflow run timeout'),
              task_timeout: z.string().describe('Workflow task timeout'),
              memo: z.record(z.string(), z.string()).describe('Memo fields'),
              search_attributes: z.record(z.string(), z.string()).describe('Search attributes (decoded)'),
              parent_workflow_id: z.string().describe('Parent workflow ID (empty if none)'),
              parent_run_id: z.string().describe('Parent run ID (empty if none)'),
          });
          const decodeSearchAttributes = (attrs) => {
              if (!attrs)
                  return {};
              const result = {};
              for (const [key, val] of Object.entries(attrs)) {
                  if (val?.data) {
                      try {
                          result[key] = atob(val.data);
                      }
                      catch {
                          result[key] = val.data;
                      }
                  }
              }
              return result;
          };
          const mapWorkflowDetail = (d) => ({
              workflow_id: d.workflowExecutionInfo?.execution?.workflowId ?? '',
              run_id: d.workflowExecutionInfo?.execution?.runId ?? '',
              type: d.workflowExecutionInfo?.type?.name ?? '',
              status: d.workflowExecutionInfo?.status ?? '',
              task_queue: d.workflowExecutionInfo?.taskQueue ?? '',
              start_time: d.workflowExecutionInfo?.startTime ?? '',
              execution_time: d.workflowExecutionInfo?.executionTime ?? '',
              close_time: d.workflowExecutionInfo?.closeTime ?? '',
              history_length: d.workflowExecutionInfo?.historyLength ?? '0',
              history_size_bytes: d.workflowExecutionInfo?.historySizeBytes ?? '0',
              state_transition_count: d.workflowExecutionInfo?.stateTransitionCount ?? '0',
              first_run_id: d.workflowExecutionInfo?.firstRunId ?? '',
              execution_timeout: d.executionConfig?.workflowExecutionTimeout ?? '0s',
              run_timeout: d.executionConfig?.workflowRunTimeout ?? '0s',
              task_timeout: d.executionConfig?.defaultWorkflowTaskTimeout ?? '10s',
              memo: decodeMemo(d.workflowExecutionInfo?.memo),
              search_attributes: decodeSearchAttributes(d.workflowExecutionInfo?.searchAttributes?.indexedFields),
              parent_workflow_id: d.workflowExecutionInfo?.parentExecution?.workflowId ?? '',
              parent_run_id: d.workflowExecutionInfo?.parentExecution?.runId ?? '',
          });
          // --- History Event ---
          const historyEventSchema = z.object({
              event_id: z.string().describe('Event ID (sequential number)'),
              event_type: z.string().describe('Event type (e.g., EVENT_TYPE_WORKFLOW_EXECUTION_STARTED)'),
              event_time: z.string().describe('ISO 8601 timestamp'),
              attributes: z.record(z.string(), z.unknown()).describe('Event-specific attributes'),
          });
          const KNOWN_NON_ATTRIBUTE_KEYS = new Set([
              'eventId',
              'eventType',
              'eventTime',
              'version',
              'taskId',
              'workerMayIgnore',
              'links',
          ]);
          const mapHistoryEvent = (e) => {
              const attributes = {};
              for (const [key, val] of Object.entries(e)) {
                  if (!KNOWN_NON_ATTRIBUTE_KEYS.has(key) && key.endsWith('Attributes') && val) {
                      Object.assign(attributes, val);
                  }
              }
              return {
                  event_id: e.eventId ?? '',
                  event_type: e.eventType ?? '',
                  event_time: e.eventTime ?? '',
                  attributes,
              };
          };
          // --- Schedule ---
          const scheduleSchema = z.object({
              schedule_id: z.string().describe('Schedule ID'),
              workflow_type: z.string().describe('Workflow type that this schedule starts'),
              task_queue: z.string().describe('Task queue for scheduled workflows'),
              spec_summary: z.string().describe('Human-readable schedule spec (interval or cron)'),
              overlap_policy: z.string().describe('Overlap policy'),
              state: z.string().describe('Schedule state (active/paused)'),
              recent_actions_count: z.number().int().describe('Number of recent actions'),
              next_action_times: z.array(z.string()).describe('Next scheduled action times (ISO 8601)'),
          });
          const formatSpec = (spec) => {
              if (!spec)
                  return '';
              if (spec.cronExpressions?.length)
                  return spec.cronExpressions.join(', ');
              if (spec.interval?.length) {
                  return spec.interval.map((i) => `every ${i.interval ?? '?'}`).join(', ');
              }
              if (spec.calendar?.length)
                  return 'calendar-based';
              return '';
          };
          const mapScheduleListEntry = (s) => ({
              schedule_id: s.scheduleId ?? '',
              workflow_type: s.info?.workflowType?.name ?? '',
              task_queue: '',
              spec_summary: formatSpec(s.info?.spec),
              overlap_policy: '',
              state: 'active',
              recent_actions_count: s.info?.recentActions?.length ?? 0,
              next_action_times: s.info?.futureActionTimes ?? [],
          });
          // --- Schedule Detail ---
          const scheduleDetailSchema = z.object({
              schedule_id: z.string().describe('Schedule ID'),
              workflow_type: z.string().describe('Workflow type that this schedule starts'),
              workflow_id: z.string().describe('Workflow ID pattern'),
              task_queue: z.string().describe('Task queue for scheduled workflows'),
              spec_summary: z.string().describe('Human-readable schedule spec'),
              overlap_policy: z.string().describe('Overlap policy'),
              catchup_window: z.string().describe('Catchup window duration'),
              paused: z.boolean().describe('Whether the schedule is paused'),
              notes: z.string().describe('Schedule notes'),
              action_count: z.string().describe('Total number of actions taken'),
              recent_actions: z
                  .array(z.object({
                  schedule_time: z.string().describe('Scheduled time (ISO 8601)'),
                  actual_time: z.string().describe('Actual execution time (ISO 8601)'),
                  workflow_id: z.string().describe('Resulting workflow ID'),
                  run_id: z.string().describe('Resulting run ID'),
                  status: z.string().describe('Workflow execution status'),
              }))
                  .describe('Recent schedule actions'),
              next_action_times: z.array(z.string()).describe('Next scheduled action times (ISO 8601)'),
          });
          const mapScheduleDetail = (d, scheduleId) => ({
              schedule_id: scheduleId,
              workflow_type: d.schedule?.action?.startWorkflow?.workflowType?.name ?? '',
              workflow_id: d.schedule?.action?.startWorkflow?.workflowId ?? '',
              task_queue: d.schedule?.action?.startWorkflow?.taskQueue?.name ?? '',
              spec_summary: formatSpec(d.schedule?.spec),
              overlap_policy: d.schedule?.policies?.overlapPolicy ?? '',
              catchup_window: d.schedule?.policies?.catchupWindow ?? '',
              paused: d.schedule?.state?.paused ?? false,
              notes: d.schedule?.state?.notes ?? '',
              action_count: d.info?.actionCount ?? '0',
              recent_actions: (d.info?.recentActions ?? []).map(a => ({
                  schedule_time: a.scheduleTime ?? '',
                  actual_time: a.actualTime ?? '',
                  workflow_id: a.startWorkflowResult?.workflowId ?? '',
                  run_id: a.startWorkflowResult?.runId ?? '',
                  status: a.startWorkflowStatus ?? '',
              })),
              next_action_times: d.info?.futureActionTimes ?? [],
          });
          // --- Task Queue ---
          const taskQueuePollerSchema = z.object({
              identity: z.string().describe('Worker identity'),
              last_access_time: z.string().describe('Last poll time (ISO 8601)'),
              rate_per_second: z.number().describe('Worker rate per second'),
              worker_version_capabilities_build_id: z.string().describe('Worker build ID'),
          });
          const mapPoller = (p) => ({
              identity: p.identity ?? '',
              last_access_time: p.lastAccessTime ?? '',
              rate_per_second: p.ratePerSecond ?? 0,
              worker_version_capabilities_build_id: p.workerVersionCapabilities?.buildId ?? '',
          });
          const getTaskQueue = defineTool({
              name: 'get_task_queue',
              displayName: 'Get Task Queue',
              description: 'Get information about a task queue including active pollers (workers), their identities, last access times, build IDs, and rate limits. Useful for debugging worker connectivity issues.',
              summary: 'Get task queue pollers and worker info',
              icon: 'server',
              group: 'Infrastructure',
              input: z.object({
                  namespace: namespaceParam,
                  task_queue: z.string().describe('Task queue name'),
              }),
              output: z.object({
                  pollers: z.array(taskQueuePollerSchema).describe('Active pollers (workers) on this queue'),
                  rate_limit_per_second: z.number().describe('Effective rate limit per second (0 = unlimited)'),
                  rate_limit_source: z.string().describe('Source of the rate limit (e.g., RATE_LIMIT_SOURCE_SYSTEM)'),
              }),
              handle: async (params) => {
                  const ns = resolveNamespace(params.namespace);
                  const data = await api(ns, `/namespaces/${ns}/task-queues/${encodeURIComponent(params.task_queue)}`);
                  return {
                      pollers: (data.pollers ?? []).map(mapPoller),
                      rate_limit_per_second: data.effectiveRateLimit?.requestsPerSecond ?? 0,
                      rate_limit_source: data.effectiveRateLimit?.rateLimitSource ?? '',
                  };
              },
          });


                    var pluginTool = getTaskQueue

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
                      var productProbe = PRODUCT_HOSTS['temporal-cloud'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Temporal Cloud page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)((cloud\\.temporal\\.io)|(web\\.tmprl\\.cloud))$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Temporal Cloud page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Temporal Cloud page.')
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
            async get_task_queue(args) {
              return runTool('get_task_queue', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['get_task_queue'](args)
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
            'The Temporal Cloud tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Temporal Cloud API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Temporal Cloud tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
