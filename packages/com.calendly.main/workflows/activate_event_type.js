// Self-contained adapter workflow. The Calendly session and every same-origin
// API call stay inside the Calendly tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "event_type_id": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991,
        "description": "Event type numeric ID to activate"
      }
    },
    "required": [
      "event_type_id"
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
    description: 'activate_event_type',
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

          // --- Auth detection ---
          // Calendly uses HttpOnly session cookies for auth. The CSRF token is in a <meta> tag.
          // Auth presence is detected via the CALENDLY_AUTHENTICATED_USER_STATUS cookie/localStorage key
          // and the existence of a CSRF token meta tag.
          const getAuth = () => {
              const csrfToken = getMetaContent('csrf-token');
              if (!csrfToken)
                  return null;
              const authStatus = getCookie('CALENDLY_AUTHENTICATED_USER_STATUS') ?? getLocalStorage('CALENDLY_AUTHENTICATED_USER_STATUS');
              if (!authStatus)
                  return null;
              return { csrfToken };
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // --- Internal API caller ---
          // Calendly's internal web API uses session cookies + CSRF token for authentication.
          // All endpoints are under /api/ on the same origin.
          const getHeaders = () => {
              const auth = getAuth();
              if (!auth)
                  throw ToolError.auth('Not authenticated — please log in to Calendly.');
              return {
                  Accept: 'application/json',
                  'X-CSRF-Token': auth.csrfToken,
                  'X-Requested-With': 'XMLHttpRequest',
              };
          };
          const api = async (endpoint, options = {}) => {
              const headers = getHeaders();
              const method = options.method ?? 'GET';
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `/api${endpoint}?${qs}` : `/api${endpoint}`;
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
              }
              const init = {
                  method,
                  headers,
              };
              if (options.body) {
                  init.body = JSON.stringify(options.body);
              }
              return fetchJSON(url, init);
          };

          // --- User ---
          const userSchema = z.object({
              id: z.number().describe('User numeric ID'),
              uuid: z.string().describe('User UUID'),
              name: z.string().describe('Full name'),
              email: z.string().describe('Email address'),
              booking_url: z.string().describe('Public booking page URL'),
              avatar_url: z.string().describe('Avatar image URL (empty if none)'),
              timezone: z.string().describe('IANA timezone (e.g. "America/Los_Angeles")'),
              locale: z.string().describe('Locale code (e.g. "en")'),
              country_code: z.string().describe('Two-letter country code'),
              created_at: z.string().describe('Account creation timestamp (ISO 8601)'),
              date_notation: z.string().describe('Date display format (e.g. "american")'),
              time_notation: z.string().describe('Time display format (e.g. "12h")'),
              events_count: z.number().describe('Total number of scheduled events'),
              is_branded: z.boolean().describe('Whether the account has branding enabled'),
          });
          const mapUser = (u) => ({
              id: u.id ?? 0,
              uuid: u.uuid ?? '',
              name: u.name ?? '',
              email: u.email ?? '',
              booking_url: u.booking_url ?? '',
              avatar_url: u.avatar_url ?? '',
              timezone: u.timezone ?? '',
              locale: u.locale ?? '',
              country_code: u.country_code ?? '',
              created_at: u.created_at ?? '',
              date_notation: u.date_notation ?? '',
              time_notation: u.time_notation ?? '',
              events_count: u.events_count ?? 0,
              is_branded: u.is_branded ?? false,
          });
          // --- Organization ---
          const organizationSchema = z.object({
              id: z.number().describe('Organization numeric ID'),
              name: z.string().describe('Organization name (empty for individual accounts)'),
              kind: z.string().describe('Organization kind (e.g. "single")'),
              stage: z.string().describe('Organization stage (e.g. "trial", "active")'),
              tier: z.string().describe('Subscription tier (e.g. "teams", "professional", "free")'),
              is_trial: z.boolean().describe('Whether the organization is on a trial'),
              created_at: z.string().describe('Organization creation timestamp (ISO 8601)'),
              uri: z.string().describe('Calendly API URI for the organization'),
              owner_name: z.string().describe('Organization owner name'),
              owner_email: z.string().describe('Organization owner email'),
          });
          const mapOrganization = (o) => ({
              id: o.id ?? 0,
              name: o.name ?? '',
              kind: o.kind ?? '',
              stage: o.stage ?? '',
              tier: o.tier ?? '',
              is_trial: o.is_trial ?? false,
              created_at: o.created_at ?? '',
              uri: o.uri ?? '',
              owner_name: o.owner?.name ?? '',
              owner_email: o.owner?.email ?? '',
          });
          // --- Organization Statistics ---
          const orgStatisticsSchema = z.object({
              available_seats: z.number().describe('Number of available seats'),
              users: z.number().describe('Number of active users'),
              invitations: z.number().describe('Number of pending invitations'),
              occupancy_ratio: z.string().describe('Seat occupancy ratio (e.g. "3/5")'),
              occupancy_capacity: z.number().describe('Total seat capacity'),
          });
          const mapOrgStatistics = (s) => ({
              available_seats: s.available_seats ?? 0,
              users: s.users ?? 0,
              invitations: s.invitations ?? 0,
              occupancy_ratio: s.occupancy_ratio ?? '',
              occupancy_capacity: s.occupancy_capacity ?? 0,
          });
          // --- Event Type ---
          const locationConfigSchema = z.object({
              id: z.number().describe('Location configuration ID'),
              kind: z.string().describe('Location type (e.g. "google_conference", "in_person", "phone")'),
              position: z.number().describe('Display position'),
              location: z.string().describe('Location address or URL (empty if auto-generated)'),
          });
          const customFieldSchema = z.object({
              id: z.number().describe('Custom field ID'),
              name: z.string().describe('Field label displayed to invitees'),
              format: z.string().describe('Field type (e.g. "text", "phone_number", "single_select")'),
              required: z.boolean().describe('Whether the field is required'),
              enabled: z.boolean().describe('Whether the field is active'),
              position: z.number().describe('Display order'),
          });
          const eventTypeSchema = z.object({
              id: z.number().describe('Event type numeric ID'),
              uuid: z.string().describe('Event type UUID'),
              name: z.string().describe('Event type name (e.g. "30 Minute Meeting")'),
              slug: z.string().describe('URL-safe slug (e.g. "30min")'),
              description: z.string().describe('Description shown to invitees'),
              duration_minutes: z.number().describe('Duration in minutes'),
              kind: z.string().describe('Event kind (e.g. "solo", "group", "round_robin")'),
              type: z.string().describe('Event type class (e.g. "StandardEventType")'),
              color: z.string().describe('Display color hex code'),
              active: z.boolean().describe('Whether the event type is currently active'),
              public: z.boolean().describe('Whether the event type is publicly visible'),
              booking_url: z.string().describe('Public booking URL'),
              location_configurations: z.array(locationConfigSchema).describe('Meeting location options'),
              custom_fields: z.array(customFieldSchema).describe('Custom intake questions'),
              invitees_limit: z.number().describe('Maximum number of invitees (1 for solo events)'),
              owner_name: z.string().describe('Name of the event type owner'),
          });
          const mapLocationConfig = (l) => ({
              id: l.id ?? 0,
              kind: l.kind ?? '',
              position: l.position ?? 0,
              location: l.location ?? '',
          });
          const mapCustomField = (f) => ({
              id: f.id ?? 0,
              name: f.name ?? '',
              format: f.format ?? '',
              required: f.required ?? false,
              enabled: f.enabled ?? false,
              position: f.position ?? 0,
          });
          const mapEventType = (et) => ({
              id: et.id ?? 0,
              uuid: et.uuid ?? '',
              name: et.name ?? '',
              slug: et.slug ?? '',
              description: et.description ?? '',
              duration_minutes: et.duration_minutes ?? et.duration ?? 0,
              kind: et.kind ?? '',
              type: et.type ?? '',
              color: et.color ?? '',
              active: et.active ?? false,
              public: et.public ?? false,
              booking_url: et.booking_url ?? '',
              location_configurations: (et.location_configurations ?? []).map(mapLocationConfig),
              custom_fields: (et.custom_fields ?? []).map(mapCustomField),
              invitees_limit: et.invitees_limit ?? 1,
              owner_name: et.owning_user_name ?? et.profile?.name ?? '',
          });
          // --- Scheduled Event ---
          // The API returns events grouped by date: { date, raw_date, events: [...] }
          // Each event has nested invitee, event_type, and external_location objects.
          const scheduledEventSchema = z.object({
              id: z.number().describe('Scheduled event numeric ID'),
              uuid: z.string().describe('Scheduled event UUID'),
              name: z.string().describe('Event name (from the event type)'),
              cancelled: z.boolean().describe('Whether the event has been cancelled'),
              start_time: z.string().describe('Event start time (ISO 8601)'),
              end_time: z.string().describe('Event end time (ISO 8601)'),
              location_type: z.string().describe('Location type (e.g. "google_conference", "in_person")'),
              join_url: z.string().describe('Video conference join URL (empty if not applicable)'),
              event_type_name: z.string().describe('Name of the associated event type'),
              event_type_id: z.number().describe('Associated event type numeric ID'),
              invitee_name: z.string().describe('Primary invitee name'),
              invitee_email: z.string().describe('Primary invitee email'),
              scheduled_at: z.string().describe('When the event was scheduled (ISO 8601)'),
          });
          const mapScheduledEvent = (e) => ({
              id: e.id ?? 0,
              uuid: e.uuid ?? '',
              name: e.name ?? '',
              cancelled: e.cancelled ?? false,
              start_time: e.start_time ?? '',
              end_time: e.end_time ?? '',
              location_type: e.location_type ?? '',
              join_url: e.external_location?.join_url ?? '',
              event_type_name: e.event_type?.name ?? '',
              event_type_id: e.event_type?.id ?? 0,
              invitee_name: e.invitee?.name ?? '',
              invitee_email: e.invitee?.email ?? '',
              scheduled_at: e.scheduled_at ?? '',
          });
          // --- Calendar Account ---
          const calendarSchema = z.object({
              id: z.string().describe('Calendar ID'),
              name: z.string().describe('Calendar name'),
              write_access: z.boolean().describe('Whether the calendar has write access'),
          });
          const calendarAccountSchema = z.object({
              uuid: z.string().describe('Calendar account UUID'),
              kind: z.string().describe('Provider kind (e.g. "google", "outlook")'),
              name: z.string().describe('Provider display name (e.g. "Google Calendar")'),
              email: z.string().describe('Email address associated with this calendar account'),
              pull_enabled: z.boolean().describe('Whether conflict checking is enabled'),
              push_enabled: z.boolean().describe('Whether new events are added to this calendar'),
              calendars: z.array(calendarSchema).describe('Sub-calendars in this account'),
          });
          const mapCalendar = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              write_access: c.write_access ?? false,
          });
          const mapCalendarAccount = (a) => ({
              uuid: a.uuid ?? '',
              kind: a.kind ?? '',
              name: a.name ?? '',
              email: a.email ?? '',
              pull_enabled: a.pull_enabled ?? false,
              push_enabled: a.push_enabled ?? false,
              calendars: (a.calendars ?? []).map(mapCalendar),
          });
          // --- Busy Time ---
          const busyTimeSchema = z.object({
              type: z.string().describe('Busy time type (e.g. "calendly", "external")'),
              start_time: z.string().describe('Start time (ISO 8601)'),
              end_time: z.string().describe('End time (ISO 8601)'),
          });
          const mapBusyTime = (b) => ({
              type: b.type ?? '',
              start_time: b.start_time ?? '',
              end_time: b.end_time ?? '',
          });
          // --- Pagination ---
          const paginationSchema = z.object({
              total_count: z.number().describe('Total number of results'),
              current_page: z.number().describe('Current page number (1-indexed)'),
              total_pages: z.number().describe('Total number of pages'),
              has_next_page: z.boolean().describe('Whether there is a next page'),
          });
          const mapPagination = (p) => ({
              total_count: p.total_count ?? 0,
              current_page: p.current_page ?? 1,
              total_pages: p.total_pages ?? 0,
              has_next_page: p.next_page != null,
          });
          const activateEventType = defineTool({
              name: 'activate_event_type',
              displayName: 'Activate Event Type',
              description: 'Activate a previously deactivated event type, making it available for booking again.',
              summary: 'Activate an event type for booking',
              icon: 'calendar-check',
              group: 'Event Types',
              input: z.object({
                  event_type_id: z.number().int().describe('Event type numeric ID to activate'),
              }),
              output: z.object({
                  success: z.boolean().describe('Whether the activation succeeded'),
              }),
              handle: async (params) => {
                  await api(`/users/me/event_types/${params.event_type_id}/activate`, { method: 'PUT' });
                  return { success: true };
              },
          });


                    var pluginTool = activateEventType

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
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Calendly page.')
                      }
                      if (!/(^|\.)calendly\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Calendly page.')
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
            async activate_event_type(args) {
              return runTool('activate_event_type', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['activate_event_type'](args)
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
            'The Calendly tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Calendly API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Calendly tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
