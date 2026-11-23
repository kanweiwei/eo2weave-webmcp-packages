// Self-contained adapter workflow. The MongoDB Atlas session and every same-origin
// API call stay inside the MongoDB Atlas tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {},
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
    description: 'list_network_peering',
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

          const getAuth = () => {
              const cached = getAuthCache('mongodb-atlas');
              if (cached)
                  return cached;
              const csrfToken = getPageGlobal('PARAMS.csrfToken') ?? getMetaContent('csrf-token');
              const userId = getPageGlobal('PARAMS.appUser.id') ?? '';
              if (!csrfToken)
                  return null;
              const auth = { csrfToken, userId };
              setAuthCache('mongodb-atlas', auth);
              return auth;
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
          // --- Context helpers ---
          const getGroupId = () => {
              const id = getPageGlobal('PARAMS.currentGroup.id');
              if (!id)
                  throw ToolError.validation('No project selected — navigate to a project first.');
              return id;
          };
          const getOrgId = () => {
              const id = getPageGlobal('PARAMS.currentOrganization.id');
              if (!id)
                  throw ToolError.validation('No organization context — navigate to an organization first.');
              return id;
          };
          // --- API caller ---
          const api = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to MongoDB Atlas.');
              const method = options.method ?? 'GET';
              const headers = {
                  Accept: 'application/json',
              };
              if (method !== 'GET') {
                  headers['X-CSRF-Token'] = auth.csrfToken;
              }
              const init = { method, headers };
              if (options.body !== undefined) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
              }
              const response = await fetchFromPage(endpoint, init);
              if (response.status === 204)
                  return {};
              const text = await response.text();
              if (!text || text.trim() === '')
                  return {};
              try {
                  return JSON.parse(text);
              }
              catch {
                  throw ToolError.internal(`Unexpected response from Atlas API: ${text.substring(0, 200)}`);
              }
          };

          // --- User / Account ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              first_name: z.string().describe('First name'),
              last_name: z.string().describe('Last name'),
              email: z.string().describe('Email address'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              first_name: u.firstName ?? '',
              last_name: u.lastName ?? '',
              email: u.emailAddress ?? u.username ?? '',
          });
          // --- Organization ---
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID'),
              name: z.string().describe('Organization name'),
              plan_type: z.string().describe('Plan type (e.g., NDS for Atlas)'),
              created: z.string().describe('ISO 8601 creation timestamp'),
              is_atlas: z.boolean().describe('Whether this is an Atlas organization'),
              mfa_required: z.boolean().describe('Whether multi-factor auth is required'),
              payment_status: z.string().describe('Payment status (e.g., OK, DEAD)'),
              gen_ai_enabled: z.boolean().describe('Whether GenAI features are enabled'),
          });
          const mapOrganization = (o) => ({
              id: o.id ?? '',
              name: o.name ?? '',
              plan_type: o.planType ?? '',
              created: o.created ?? '',
              is_atlas: o.atlas ?? false,
              mfa_required: o.multiFactorAuthRequired ?? false,
              payment_status: o.paymentStatus?.status ?? '',
              gen_ai_enabled: o.genAIFeaturesEnabled ?? false,
          });
          // --- Organization Member ---
          const orgMemberSchema = z.object({
              user_id: z.string().describe('User ID'),
              email: z.string().describe('Email address'),
              first_name: z.string().describe('First name'),
              last_name: z.string().describe('Last name'),
              roles: z.array(z.string()).describe('Organization roles (e.g., ORG_OWNER, ORG_MEMBER)'),
              status: z.string().describe('Membership status (e.g., CONFIRMED, PENDING)'),
              created: z.string().describe('ISO 8601 creation timestamp'),
              last_auth: z.string().describe('ISO 8601 timestamp of last authentication'),
          });
          const mapOrgMember = (m) => ({
              user_id: (m.userId ?? '').replace('@', ''),
              email: m.emailAddress ?? m.username ?? '',
              first_name: m.firstName ?? '',
              last_name: m.lastName ?? '',
              roles: m.roles ?? [],
              status: m.status ?? '',
              created: m.created ?? '',
              last_auth: m.lastAuth ?? '',
          });
          // --- Organization Project ---
          const orgProjectSchema = z.object({
              id: z.string().describe('Project (group) ID'),
              name: z.string().describe('Project name'),
              cluster_count: z.number().int().describe('Number of clusters'),
              user_count: z.number().int().describe('Number of users'),
              alert_count: z.number().int().describe('Number of active alerts'),
          });
          const mapOrgProject = (p) => ({
              id: p.id ?? '',
              name: p.name ?? '',
              cluster_count: p.numCluster ?? 0,
              user_count: p.users ?? 0,
              alert_count: p.alerts ?? 0,
          });
          // --- Project ---
          const projectSchema = z.object({
              id: z.string().describe('Project (group) ID'),
              name: z.string().describe('Project name'),
              state: z.string().describe('Project state (e.g., IDLE, ACTIVE)'),
              group_type: z.string().describe('Group type (e.g., NDS for Atlas)'),
              cluster_count: z.number().int().describe('Number of clusters'),
              data_size_bytes: z.number().describe('Total data size backed up in bytes'),
          });
          const mapProject = (p) => ({
              id: p.id ?? '',
              name: p.groupName ?? '',
              state: p.state ?? '',
              group_type: p.groupType ?? '',
              cluster_count: p.summaryStatistics?.numCluster ?? 0,
              data_size_bytes: p.summaryStatistics?.dataSizeBackedUpBytes ?? 0,
          });
          // --- Cluster ---
          const clusterSchema = z.object({
              id: z.string().describe('Cluster ID'),
              name: z.string().describe('Cluster name'),
              cluster_type: z.string().describe('Cluster type (REPLICASET, SHARDED, GEOSHARDED)'),
              state: z.string().describe('Cluster state (e.g., IDLE, CREATING, UPDATING, DELETING)'),
              mongodb_version: z.string().describe('MongoDB version'),
              provider: z.string().describe('Cloud provider (AWS, GCP, AZURE, TENANT)'),
              region: z.string().describe('Region name'),
              instance_size: z.string().describe('Instance size (e.g., M0, M10, M30)'),
              connection_string: z.string().describe('Standard connection string (SRV)'),
              paused: z.boolean().describe('Whether the cluster is paused'),
              disk_size_gb: z.number().describe('Disk size in GB'),
          });
          const mapCluster = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              cluster_type: c.clusterType ?? '',
              state: c.stateName ?? '',
              mongodb_version: c.mongoDBVersion ?? '',
              provider: c.providerSettings?.backingProviderName ?? c.providerSettings?.providerName ?? '',
              region: c.providerSettings?.regionName ?? '',
              instance_size: c.providerSettings?.instanceSizeName ?? '',
              connection_string: c.connectionStrings?.standardSrv ?? '',
              paused: c.paused ?? false,
              disk_size_gb: c.diskSizeGB ?? 0,
          });
          // --- Database User ---
          const dbUserSchema = z.object({
              username: z.string().describe('Database username'),
              database: z.string().describe('Authentication database (e.g., admin)'),
              roles: z
                  .array(z.object({
                  role_name: z.string().describe('Role name (e.g., readWriteAnyDatabase, atlasAdmin)'),
                  database_name: z.string().describe('Database the role applies to'),
              }))
                  .describe('Assigned roles'),
              scopes: z
                  .array(z.object({
                  name: z.string().describe('Scope name (cluster name)'),
                  type: z.string().describe('Scope type (CLUSTER)'),
              }))
                  .describe('Access scopes (which clusters this user can access)'),
              auth_type: z.string().describe('Authentication type (SCRAM, X509, LDAP, AWS_IAM)'),
          });
          const mapDbUser = (u) => {
              let authType = 'SCRAM';
              if (u.awsIAMType && u.awsIAMType !== 'NONE')
                  authType = 'AWS_IAM';
              else if (u.x509Type && u.x509Type !== 'NONE')
                  authType = 'X509';
              else if (u.ldapAuthType && u.ldapAuthType !== 'NONE')
                  authType = 'LDAP';
              return {
                  username: u.user ?? '',
                  database: u.db ?? 'admin',
                  roles: (u.roles ?? []).map(r => ({
                      role_name: r.roleName ?? '',
                      database_name: r.databaseName ?? '',
                  })),
                  scopes: (u.scopes ?? []).map(s => ({
                      name: s.name ?? '',
                      type: s.type ?? '',
                  })),
                  auth_type: authType,
              };
          };
          // --- IP Access List Entry ---
          const ipAccessEntrySchema = z.object({
              ip_address: z.string().describe('IP address or CIDR block'),
              comment: z.string().describe('Description of the entry'),
              group_id: z.string().describe('Project ID this entry belongs to'),
          });
          const mapIpAccessEntry = (e) => ({
              ip_address: e.cidrBlock ?? e.ipAddress ?? '',
              comment: e.comment ?? '',
              group_id: e.groupId ?? '',
          });
          // --- Alert ---
          const alertSchema = z.object({
              id: z.string().describe('Alert ID'),
              event_type: z.string().describe('Event type that triggered the alert'),
              status: z.string().describe('Alert status (OPEN, CLOSED, TRACKING)'),
              created: z.string().describe('ISO 8601 timestamp when the alert was created'),
              cluster_name: z.string().describe('Name of the affected cluster'),
              metric_name: z.string().describe('Metric name if metric-based alert'),
          });
          const mapAlert = (a) => ({
              id: a.id ?? '',
              event_type: a.eventTypeName ?? '',
              status: a.status ?? '',
              created: a.created ?? '',
              cluster_name: a.clusterName ?? '',
              metric_name: a.metricName ?? '',
          });
          // --- Alert Config ---
          const alertConfigSchema = z.object({
              id: z.string().describe('Alert configuration ID'),
              event_type: z.string().describe('Event type (e.g., NO_PRIMARY, OUTSIDE_METRIC_THRESHOLD)'),
              enabled: z.boolean().describe('Whether this alert configuration is active'),
              type: z.string().describe('Alert type (e.g., NDS, REPLICA_SET, HOST_METRIC, CLUSTER)'),
              created: z.string().describe('ISO 8601 creation timestamp'),
          });
          const mapAlertConfig = (c) => ({
              id: c.id ?? '',
              event_type: c.et ?? '',
              enabled: c.enabled ?? false,
              type: c._t ?? '',
              created: c.cre ?? '',
          });
          // --- Team ---
          const teamSchema = z.object({
              id: z.string().describe('Team ID'),
              name: z.string().describe('Team name'),
              user_count: z.number().int().describe('Number of members in the team'),
          });
          const mapTeam = (t) => ({
              id: t.id ?? '',
              name: t.name ?? '',
              user_count: t.userCount ?? 0,
          });
          // --- Network Peering ---
          const peeringSchema = z.object({
              id: z.string().describe('Peering connection ID'),
              provider: z.string().describe('Cloud provider (AWS, GCP, AZURE)'),
              status: z.string().describe('Peering status'),
              vpc_id: z.string().describe('VPC/VNet ID'),
              cidr_block: z.string().describe('CIDR block'),
          });
          const mapPeering = (p) => ({
              id: p.id ?? '',
              provider: p.providerName ?? '',
              status: p.statusName ?? '',
              vpc_id: p.vpcId ?? p.azureDirectoryId ?? p.gcpProjectId ?? '',
              cidr_block: p.routeTableCidrBlock ?? '',
          });
          // --- Deployment Status ---
          const deploymentStatusSchema = z.object({
              is_in_goal_state: z.boolean().describe('Whether the deployment has reached its goal state'),
              has_version_conflict: z.boolean().describe('Whether there is a version conflict'),
              is_draft: z.boolean().describe('Whether the deployment is a draft'),
              jobs_in_progress: z.boolean().describe('Whether there are jobs currently in progress'),
              process_count: z.number().int().describe('Number of managed processes'),
          });
          const mapDeploymentStatus = (d) => ({
              is_in_goal_state: d.isInGoalState ?? true,
              has_version_conflict: d.hasVersionConflict ?? false,
              is_draft: d.isDraft ?? false,
              jobs_in_progress: d.areJobsInProgress ?? false,
              process_count: d.automationStatus?.processes?.length ?? 0,
          });
          // --- Billing Plan ---
          const billingPlanSchema = z.object({
              plan_type: z.string().describe('Plan type'),
              plan_name: z.string().describe('Plan display name'),
              is_paid: z.boolean().describe('Whether this is a paid plan'),
          });
          const mapBillingPlan = (p) => ({
              plan_type: p.planType ?? '',
              plan_name: p.planName ?? '',
              is_paid: p.isPaid ?? false,
          });
          const listNetworkPeering = defineTool({
              name: 'list_network_peering',
              displayName: 'List Network Peering',
              description: 'List all network peering connections for the current MongoDB Atlas project including provider, status, VPC ID, and CIDR block.',
              summary: 'List network peering connections',
              icon: 'network',
              group: 'Network Access',
              input: z.object({}),
              output: z.object({
                  connections: z.array(peeringSchema).describe('Network peering connections'),
              }),
              handle: async () => {
                  const groupId = getGroupId();
                  const raw = await api(`/nds/${groupId}/peers`);
                  return { connections: (raw ?? []).map(mapPeering) };
              },
          });


                    var pluginTool = listNetworkPeering

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a MongoDB Atlas page.')
                      }
                      if (!/(^|\.)cloud\.mongodb\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a MongoDB Atlas page.')
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
            async list_network_peering(args) {
              return runTool('list_network_peering', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['list_network_peering'](args)
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
            'The MongoDB Atlas tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'MongoDB Atlas API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The MongoDB Atlas tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
