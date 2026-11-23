// Self-contained adapter workflow. The Azure Portal session and every same-origin
// API call stay inside the Azure Portal tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "subscription_id": {
        "type": "string",
        "description": "Subscription ID (GUID)"
      },
      "filter": {
        "type": "string",
        "description": "OData filter expression (required). Must include eventTimestamp filter, e.g., \"eventTimestamp ge '2024-01-01'\""
      },
      "select": {
        "description": "Comma-separated list of fields to return (e.g., \"eventTimestamp,operationName,status\")",
        "type": "string"
      }
    },
    "required": [
      "subscription_id",
      "filter"
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
    description: 'list_activity_logs',
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

          // Azure ARM API base URL
          const ARM_BASE = 'https://management.azure.com';
          /**
           * Extract an access token from MSAL sessionStorage entries matching a scope fragment.
           * Azure Portal stores MSAL tokens as JSON objects in sessionStorage
           * with keys containing 'accesstoken' and the resource scope.
           */
          const findMsalToken = (scopeFragment) => {
              for (let i = 0; i < sessionStorage.length; i++) {
                  const key = sessionStorage.key(i);
                  if (!key || !key.includes('accesstoken') || !key.includes(scopeFragment)) {
                      continue;
                  }
                  try {
                      const raw = getSessionStorage(key);
                      if (!raw)
                          continue;
                      const entry = JSON.parse(raw);
                      if (entry.secret && Number.parseInt(entry.expiresOn ?? '0', 10) > Date.now() / 1000) {
                          return entry.secret;
                      }
                  }
                  catch {
                      // Ignore parse errors
                  }
              }
              return null;
          };
          const getAuth = () => {
              // Check persisted cache first (survives adapter re-injection)
              const cached = getAuthCache('azure');
              if (cached?.armToken) {
                  // Verify cached ARM token is not expired by checking MSAL source
                  const freshArm = findMsalToken('management.core.windows.net');
                  if (freshArm) {
                      if (freshArm !== cached.armToken) {
                          // Token was refreshed — update cache
                          const auth = { armToken: freshArm };
                          setAuthCache('azure', auth);
                          return auth;
                      }
                      return cached;
                  }
                  // Cached token may be stale, clear and re-extract
                  clearAuthCache('azure');
              }
              // Extract ARM token from MSAL sessionStorage
              const armToken = findMsalToken('management.core.windows.net');
              if (!armToken)
                  return null;
              const auth = { armToken };
              setAuthCache('azure', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          // --- ARM API caller ---
          const armApi = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Azure Portal.');
              const method = options.method ?? 'GET';
              const query = { ...options.query, 'api-version': options.apiVersion ?? '2022-12-01' };
              const qs = buildQueryString(query);
              const url = `${ARM_BASE}${endpoint}?${qs}`;
              const headers = {
                  Authorization: `Bearer ${auth.armToken}`,
              };
              // ARM is cross-origin — use credentials:'omit' to avoid CORS preflight failures
              const init = { method, headers, credentials: 'omit' };
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
              }
              const data = await fetchJSON(url, init);
              return data;
          };
          // --- ARM DELETE helper (returns void for 200/202/204) ---
          const armDelete = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Azure Portal.');
              const query = { ...options.query, 'api-version': options.apiVersion ?? '2022-12-01' };
              const qs = buildQueryString(query);
              const url = `${ARM_BASE}${endpoint}?${qs}`;
              await fetchFromPage(url, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${auth.armToken}` },
                  credentials: 'omit',
              });
          };

          // --- Tenant ---
          const tenantSchema = z.object({
              tenant_id: z.string().describe('Tenant ID (GUID)'),
              display_name: z.string().describe('Tenant display name'),
              default_domain: z.string().describe('Default domain name'),
              tenant_category: z.string().describe('Tenant category (Home, ProjectedBy, etc.)'),
              country: z.string().describe('Country code'),
          });
          const mapTenant = (t) => ({
              tenant_id: t.tenantId ?? '',
              display_name: t.displayName ?? '',
              default_domain: t.defaultDomain ?? '',
              tenant_category: t.tenantCategory ?? '',
              country: t.country ?? '',
          });
          // --- Subscription ---
          const subscriptionSchema = z.object({
              subscription_id: z.string().describe('Subscription ID (GUID)'),
              display_name: z.string().describe('Subscription display name'),
              state: z.string().describe('Subscription state (Enabled, Disabled, Warned, PastDue, Deleted)'),
              tenant_id: z.string().describe('Associated tenant ID'),
              subscription_policies: z
                  .object({
                  location_placement_id: z.string().describe('Location placement ID'),
                  quota_id: z.string().describe('Quota ID'),
                  spending_limit: z.string().describe('Spending limit (On, Off, CurrentPeriodOff)'),
              })
                  .describe('Subscription policies'),
          });
          const mapSubscription = (s) => ({
              subscription_id: s.subscriptionId ?? '',
              display_name: s.displayName ?? '',
              state: s.state ?? '',
              tenant_id: s.tenantId ?? '',
              subscription_policies: {
                  location_placement_id: s.subscriptionPolicies?.locationPlacementId ?? '',
                  quota_id: s.subscriptionPolicies?.quotaId ?? '',
                  spending_limit: s.subscriptionPolicies?.spendingLimit ?? '',
              },
          });
          // --- Resource Group ---
          const resourceGroupSchema = z.object({
              id: z.string().describe('Full resource group ID'),
              name: z.string().describe('Resource group name'),
              location: z.string().describe('Azure region (e.g., eastus, westeurope)'),
              provisioning_state: z.string().describe('Provisioning state (Succeeded, Failed, etc.)'),
              tags: z.record(z.string(), z.string()).describe('Resource group tags'),
          });
          const mapResourceGroup = (rg) => ({
              id: rg.id ?? '',
              name: rg.name ?? '',
              location: rg.location ?? '',
              provisioning_state: rg.properties?.provisioningState ?? '',
              tags: rg.tags ?? {},
          });
          // --- Resource ---
          const resourceSchema = z.object({
              id: z.string().describe('Full resource ID'),
              name: z.string().describe('Resource name'),
              type: z.string().describe('Resource type (e.g., Microsoft.Compute/virtualMachines)'),
              location: z.string().describe('Azure region'),
              kind: z.string().describe('Resource kind (varies by type)'),
              provisioning_state: z.string().describe('Provisioning state'),
              tags: z.record(z.string(), z.string()).describe('Resource tags'),
          });
          const mapResource = (r) => ({
              id: r.id ?? '',
              name: r.name ?? '',
              type: r.type ?? '',
              location: r.location ?? '',
              kind: r.kind ?? '',
              provisioning_state: r.properties?.provisioningState ?? '',
              tags: r.tags ?? {},
          });
          // --- Deployment ---
          const deploymentSchema = z.object({
              id: z.string().describe('Full deployment ID'),
              name: z.string().describe('Deployment name'),
              provisioning_state: z.string().describe('Provisioning state (Succeeded, Failed, Running, etc.)'),
              timestamp: z.string().describe('Deployment timestamp (ISO 8601)'),
              duration: z.string().describe('Deployment duration'),
              mode: z.string().describe('Deployment mode (Incremental or Complete)'),
              correlation_id: z.string().describe('Correlation ID for tracking'),
          });
          const mapDeployment = (d) => ({
              id: d.id ?? '',
              name: d.name ?? '',
              provisioning_state: d.properties?.provisioningState ?? '',
              timestamp: d.properties?.timestamp ?? '',
              duration: d.properties?.duration ?? '',
              mode: d.properties?.mode ?? '',
              correlation_id: d.properties?.correlationId ?? '',
          });
          // --- Activity Log Event ---
          const activityLogSchema = z.object({
              event_timestamp: z.string().describe('Event timestamp (ISO 8601)'),
              operation_name: z.string().describe('Operation name (e.g., Microsoft.Resources/subscriptions/write)'),
              status: z.string().describe('Event status (Succeeded, Failed, Started, etc.)'),
              caller: z.string().describe('Caller identity (email or service principal)'),
              resource_id: z.string().describe('Resource ID the event applies to'),
              resource_type: z.string().describe('Resource type'),
              level: z.string().describe('Event level (Informational, Warning, Error, Critical)'),
              description: z.string().describe('Event description'),
          });
          const mapActivityLog = (e) => ({
              event_timestamp: e.eventTimestamp ?? '',
              operation_name: e.operationName?.value ?? '',
              status: e.status?.value ?? '',
              caller: e.caller ?? '',
              resource_id: e.resourceId ?? '',
              resource_type: e.resourceType?.value ?? '',
              level: e.level ?? '',
              description: e.description ?? '',
          });
          // --- Location ---
          const locationSchema = z.object({
              name: z.string().describe('Location short name (e.g., eastus)'),
              display_name: z.string().describe('Display name (e.g., East US)'),
              regional_display_name: z.string().describe('Regional display name (e.g., (US) East US)'),
              geography: z.string().describe('Geography (e.g., United States)'),
              geography_group: z.string().describe('Geography group (e.g., US)'),
              region_type: z.string().describe('Region type (Physical, Logical)'),
              region_category: z.string().describe('Region category (Recommended, Other)'),
              physical_location: z.string().describe('Physical location (e.g., Virginia)'),
          });
          const mapLocation = (l) => ({
              name: l.name ?? '',
              display_name: l.displayName ?? '',
              regional_display_name: l.regionalDisplayName ?? '',
              geography: l.metadata?.geography ?? '',
              geography_group: l.metadata?.geographyGroup ?? '',
              region_type: l.metadata?.regionType ?? '',
              region_category: l.metadata?.regionCategory ?? '',
              physical_location: l.metadata?.physicalLocation ?? '',
          });
          // --- Tag ---
          const tagSchema = z.object({
              tag_name: z.string().describe('Tag name'),
              count_type: z.string().describe('Count type'),
              count_value: z.number().describe('Number of resources with this tag'),
              values: z
                  .array(z.object({
                  tag_value: z.string().describe('Tag value'),
                  count_value: z.number().describe('Number of resources with this tag value'),
              }))
                  .describe('Tag values'),
          });
          const mapTag = (t) => ({
              tag_name: t.tagName ?? '',
              count_type: t.count?.type ?? '',
              count_value: t.count?.value ?? 0,
              values: (t.values ?? []).map(v => ({
                  tag_value: v.tagValue ?? '',
                  count_value: v.count?.value ?? 0,
              })),
          });
          // --- Management Lock ---
          const lockSchema = z.object({
              id: z.string().describe('Full lock ID'),
              name: z.string().describe('Lock name'),
              level: z.string().describe('Lock level (CanNotDelete, ReadOnly)'),
              notes: z.string().describe('Notes about the lock'),
          });
          const mapLock = (l) => ({
              id: l.id ?? '',
              name: l.name ?? '',
              level: l.properties?.level ?? '',
              notes: l.properties?.notes ?? '',
          });
          // --- Resource Provider ---
          const providerSchema = z.object({
              namespace: z.string().describe('Provider namespace (e.g., Microsoft.Compute)'),
              registration_state: z.string().describe('Registration state (Registered, NotRegistered)'),
          });
          const mapProvider = (p) => ({
              namespace: p.namespace ?? '',
              registration_state: p.registrationState ?? '',
          });
          // --- Policy Assignment ---
          const policyAssignmentSchema = z.object({
              id: z.string().describe('Full policy assignment ID'),
              name: z.string().describe('Policy assignment name'),
              display_name: z.string().describe('Display name'),
              description: z.string().describe('Description'),
              policy_definition_id: z.string().describe('Policy definition ID'),
              scope: z.string().describe('Assignment scope'),
              enforcement_mode: z.string().describe('Enforcement mode (Default, DoNotEnforce)'),
          });
          const mapPolicyAssignment = (p) => ({
              id: p.id ?? '',
              name: p.name ?? '',
              display_name: p.properties?.displayName ?? '',
              description: p.properties?.description ?? '',
              policy_definition_id: p.properties?.policyDefinitionId ?? '',
              scope: p.properties?.scope ?? '',
              enforcement_mode: p.properties?.enforcementMode ?? '',
          });
          // --- Role Assignment ---
          const roleAssignmentSchema = z.object({
              id: z.string().describe('Full role assignment ID'),
              name: z.string().describe('Role assignment name (GUID)'),
              role_definition_id: z.string().describe('Role definition ID'),
              principal_id: z.string().describe('Principal ID (user, group, or service principal)'),
              principal_type: z.string().describe('Principal type (User, Group, ServicePrincipal)'),
              scope: z.string().describe('Assignment scope'),
          });
          const mapRoleAssignment = (r) => ({
              id: r.id ?? '',
              name: r.name ?? '',
              role_definition_id: r.properties?.roleDefinitionId ?? '',
              principal_id: r.properties?.principalId ?? '',
              principal_type: r.properties?.principalType ?? '',
              scope: r.properties?.scope ?? '',
          });
          // --- User Profile ---
          const userProfileSchema = z.object({
              id: z.string().describe('User object ID'),
              display_name: z.string().describe('Display name'),
              user_principal_name: z.string().describe('User principal name (email-like identifier)'),
              mail: z.string().describe('Email address'),
              given_name: z.string().describe('First name'),
              surname: z.string().describe('Last name'),
              job_title: z.string().describe('Job title'),
          });
          const listActivityLogs = defineTool({
              name: 'list_activity_logs',
              displayName: 'List Activity Logs',
              description: "Query activity log events for a subscription. Use the filter parameter with OData syntax to filter by time range, resource group, or status. Example filter: \"eventTimestamp ge '2024-01-01T00:00:00Z' and eventTimestamp le '2024-01-31T23:59:59Z'\".",
              summary: 'Query activity log events',
              icon: 'scroll-text',
              group: 'Activity Log',
              input: z.object({
                  subscription_id: z.string().describe('Subscription ID (GUID)'),
                  filter: z
                      .string()
                      .describe('OData filter expression (required). Must include eventTimestamp filter, e.g., "eventTimestamp ge \'2024-01-01\'"'),
                  select: z
                      .string()
                      .optional()
                      .describe('Comma-separated list of fields to return (e.g., "eventTimestamp,operationName,status")'),
              }),
              output: z.object({
                  events: z.array(activityLogSchema).describe('List of activity log events'),
              }),
              handle: async (params) => {
                  const data = await armApi(`/subscriptions/${params.subscription_id}/providers/Microsoft.Insights/eventtypes/management/values`, {
                      apiVersion: '2015-04-01',
                      query: { $filter: params.filter, $select: params.select },
                  });
                  return { events: (data.value ?? []).map(mapActivityLog) };
              },
          });


                    var pluginTool = listActivityLogs

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Azure Portal page.')
                      }
                      if (!/(^|\.)portal\.azure\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Azure Portal page.')
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
            async list_activity_logs(args) {
              return runTool('list_activity_logs', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_activity_logs'](args)
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
            'The Azure Portal tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Azure Portal API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Azure Portal tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
