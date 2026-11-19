// Self-contained adapter workflow for PostHog. Every call runs inside the
// user's own us.posthog.com / eu.posthog.com tab: same-origin /api/... fetches
// with the tab's session cookies plus the `X-CSRFToken` header PostHog's Django
// backend requires on writes.
//
// Ported from the OpenTabs posthog plugin (plugins/posthog/src, MIT): same
// endpoints, same JSON bodies, same soft-delete convention (PATCH {deleted:
// true} — most DELETEs answer 405), same output mappers. The page runtime below
// is that plugin's posthog-api.ts / tools/schemas.ts transcribed to plain JS
// with a shim for the plugin-sdk slice it imports.
export default {
  inputSchema: {
    "additionalProperties": false,
    "properties": {
      "dashboard_id": {
        "description": "Dashboard ID",
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "type": "integer"
      }
    },
    "required": [
      "dashboard_id"
    ],
    "type": "object"
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
    description: "get_dashboard",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {

        // --- plugin-sdk shim: only the slice the PostHog plugin imports ----
        var DEFAULT_TIMEOUT_MS = 18000;
        var MAX_ERROR_BODY_LENGTH = 512;

        var ToolError = class ToolError extends Error {
          constructor(message, code, opts) {
            super(message);
            this.name = 'ToolError';
            this.code = code;
            this.retryable = !!opts && opts.retryable === true;
            this.retryAfterMs = opts && opts.retryAfterMs;
            this.category = opts && opts.category;
          }
          static auth(message, code) {
            return new ToolError(message, code || 'AUTH_ERROR', { category: 'auth', retryable: false });
          }
          static notFound(message, code) {
            return new ToolError(message, code || 'NOT_FOUND', { category: 'not_found', retryable: false });
          }
          static rateLimited(message, retryAfterMs, code) {
            return new ToolError(message, code || 'RATE_LIMITED', { category: 'rate_limit', retryable: true, retryAfterMs: retryAfterMs });
          }
          static validation(message, code) {
            return new ToolError(message, code || 'VALIDATION_ERROR', { category: 'validation', retryable: false });
          }
          static timeout(message, code) {
            return new ToolError(message, code || 'TIMEOUT', { category: 'timeout', retryable: true });
          }
          static internal(message, code) {
            return new ToolError(message, code || 'INTERNAL_ERROR', { category: 'internal', retryable: false });
          }
        };

        function getCookie(name) {
          var raw = '';
          try {
            raw = String(document.cookie || '');
          } catch (e) {
            raw = '';
          }
          var parts = raw.split(';');
          for (var i = 0; i < parts.length; i++) {
            var part = parts[i].replace(/^\s+/, '');
            var eq = part.indexOf('=');
            if (eq < 0) continue;
            if (part.slice(0, eq) !== name) continue;
            var value = part.slice(eq + 1);
            try {
              return decodeURIComponent(value);
            } catch (e) {
              return value;
            }
          }
          return null;
        }

        // getPageGlobal('POSTHOG_APP_CONTEXT.current_team.id') — the app context
        // object the PostHog web app puts on the window.
        function getPageGlobal(path) {
          var ctx = null;
          try {
            ctx = typeof window !== 'undefined' ? window : null;
          } catch (e) {
            ctx = null;
          }
          if (!ctx) return undefined;
          var segments = String(path).split('.');
          var current = ctx;
          for (var i = 0; i < segments.length; i++) {
            if (current === null || current === undefined) return undefined;
            current = current[segments[i]];
          }
          return current;
        }

        function buildQueryString(params) {
          var search = new URLSearchParams();
          var keys = Object.keys(params || {});
          for (var i = 0; i < keys.length; i++) {
            var value = params[keys[i]];
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (var j = 0; j < value.length; j++) search.append(keys[i], String(value[j]));
            } else {
              search.append(keys[i], String(value));
            }
          }
          return search.toString();
        }

        function parseRetryAfterMs(value) {
          var seconds = Number(value);
          if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
          return undefined;
        }

        function httpStatusToToolError(status, headers, message) {
          if (status === 401 || status === 403) return ToolError.auth(message);
          if (status === 404) return ToolError.notFound(message);
          if (status === 429) {
            var retryAfter = headers && typeof headers.get === 'function' ? headers.get('Retry-After') : null;
            return ToolError.rateLimited(message, retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined);
          }
          if (status === 400 || status === 422) return ToolError.validation(message);
          if (status === 408) return ToolError.timeout(message);
          if (status >= 500) {
            var retryable = status === 500 || status === 502 || status === 503 || status === 504;
            return new ToolError(message, 'http_error', { category: 'internal', retryable: retryable });
          }
          if (status >= 400 && status < 500) return new ToolError(message, 'http_error', { retryable: false });
          return new ToolError(message, 'http_error', { category: 'internal' });
        }

        async function fetchFromPage(url, init) {
          init = init || {};
          var timeout = init.timeout || DEFAULT_TIMEOUT_MS;
          var fetchInit = {
            method: init.method,
            headers: init.headers,
            body: init.body,
            credentials: 'include'
          };
          var controller = null;
          if (typeof AbortController === 'function') {
            try {
              controller = new AbortController();
            } catch (e) {
              controller = null;
            }
          }
          var timer = controller !== null ? setTimeout(function () {
            try {
              controller.abort();
            } catch (e) {}
          }, timeout) : null;
          if (controller !== null) fetchInit.signal = controller.signal;
          var response;
          try {
            response = await fetch(url, fetchInit);
          } catch (error) {
            if (timer !== null) clearTimeout(timer);
            var aborted = error && (error.name === 'AbortError' || String(error).indexOf('abort') !== -1);
            if (aborted) throw ToolError.timeout('fetchFromPage: request timed out after ' + timeout + 'ms for ' + url);
            throw new ToolError('fetchFromPage: network error for ' + url + ': ' + String(error), 'network_error', {
              category: 'internal',
              retryable: true
            });
          }
          if (timer !== null) clearTimeout(timer);
          if (!response.ok) {
            var rawText = '';
            try {
              rawText = await response.text();
            } catch (e) {}
            var errorText = rawText.length > MAX_ERROR_BODY_LENGTH ? rawText.slice(0, MAX_ERROR_BODY_LENGTH) + '\u2026' : rawText;
            throw httpStatusToToolError(
              response.status,
              response.headers,
              'fetchFromPage: HTTP ' + response.status + ' for ' + url + ': ' + errorText
            );
          }
          return response;
        }

        async function fetchJSON(url, init) {
          var response = await fetchFromPage(url, init);
          if (response.status === 204) return undefined;
          try {
            return await response.json();
          } catch (e) {
            throw ToolError.validation('fetchJSON: failed to parse JSON response from ' + url);
          }
        }

        // --- posthog-api.ts -------------------------------------------------
        // Auth = the Django CSRF cookie plus the current team/project the app
        // context exposes. Team id and project id are interchangeable in
        // PostHog Cloud, which is why the endpoints below mix
        // /api/environments/:id/... and /api/projects/:id/... exactly as
        // upstream does.
        var authCache = null;

        var getAuth = function () {
          if (authCache) return authCache;
          var csrfToken = getCookie('posthog_csrftoken');
          if (!csrfToken) return null;
          var teamId = getPageGlobal('POSTHOG_APP_CONTEXT.current_team.id');
          if (teamId === undefined || teamId === null) teamId = 0;
          var orgId = getPageGlobal('POSTHOG_APP_CONTEXT.current_project.organization_id');
          if (orgId === undefined || orgId === null) orgId = '';
          if (!teamId) return null;
          authCache = { csrfToken: csrfToken, teamId: teamId, orgId: orgId };
          return authCache;
        };

        var getTeamId = function () {
          var auth = getAuth();
          if (!auth) throw ToolError.auth('Not authenticated \u2014 please log in to PostHog.');
          return auth.teamId;
        };

        var getOrgId = function () {
          var auth = getAuth();
          if (!auth) throw ToolError.auth('Not authenticated \u2014 please log in to PostHog.');
          return auth.orgId;
        };

        var api = async function (endpoint, options) {
          options = options || {};
          var auth = getAuth();
          if (!auth) throw ToolError.auth('Not authenticated \u2014 please log in to PostHog.');

          var qs = options.query ? buildQueryString(options.query) : '';
          var url = qs ? endpoint + '?' + qs : endpoint;
          var method = options.method || 'GET';
          var headers = { Accept: 'application/json' };
          if (method !== 'GET') headers['X-CSRFToken'] = auth.csrfToken;

          var init = { method: method, headers: headers };
          if (options.body) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(options.body);
          }

          try {
            return await fetchJSON(url, init);
          } catch (error) {
            if (error && error.name === 'ToolError' && error.category === 'auth') authCache = null;
            throw error;
          }
        };

        // Most DELETE endpoints answer 405; PostHog soft-deletes with a PATCH.
        var softDelete = async function (endpoint) {
          await api(endpoint, { method: 'PATCH', body: { deleted: true } });
        };

        // --- tools/schemas.ts: mappers --------------------------------------
        var mapUser = function (u) {
          u = u || {};
          return {
            id: u.id != null ? u.id : 0,
            uuid: u.uuid || '',
            email: u.email || '',
            first_name: u.first_name || '',
            last_name: u.last_name || '',
            distinct_id: u.distinct_id || ''
          };
        };
        var mapCreatedBy = function (c) {
          if (!c) return null;
          return { id: c.id != null ? c.id : 0, first_name: c.first_name || '', email: c.email || '' };
        };
        var mapOrganization = function (o) {
          o = o || {};
          return {
            id: o.id || '',
            name: o.name || '',
            created_at: o.created_at || '',
            membership_level: o.membership_level != null ? o.membership_level : 0
          };
        };
        var mapProject = function (p) {
          p = p || {};
          return {
            id: p.id != null ? p.id : 0,
            uuid: p.uuid || '',
            name: p.name || '',
            api_token: p.api_token || '',
            timezone: p.timezone || '',
            is_demo: p.is_demo != null ? p.is_demo : false,
            created_at: p.created_at || ''
          };
        };
        var mapDashboard = function (d) {
          d = d || {};
          return {
            id: d.id != null ? d.id : 0,
            name: d.name || '',
            description: d.description || '',
            pinned: d.pinned != null ? d.pinned : false,
            created_at: d.created_at || '',
            created_by: mapCreatedBy(d.created_by),
            is_shared: d.is_shared != null ? d.is_shared : false,
            tags: d.tags || [],
            tiles_count: d.tiles ? d.tiles.length : 0,
            deleted: d.deleted != null ? d.deleted : false
          };
        };
        var mapInsight = function (i) {
          i = i || {};
          return {
            id: i.id != null ? i.id : 0,
            short_id: i.short_id || '',
            name: i.name || '',
            derived_name: i.derived_name != null ? i.derived_name : null,
            description: i.description || '',
            favorited: i.favorited != null ? i.favorited : false,
            tags: i.tags || [],
            dashboards: i.dashboards || [],
            query_kind: (i.query && i.query.kind) || '',
            source_kind: (i.query && i.query.source && i.query.source.kind) || '',
            created_at: i.created_at || '',
            created_by: mapCreatedBy(i.created_by),
            last_modified_at: i.last_modified_at || '',
            deleted: i.deleted != null ? i.deleted : false
          };
        };
        var mapFeatureFlag = function (f) {
          f = f || {};
          var group = f.filters && f.filters.groups ? f.filters.groups[0] : null;
          return {
            id: f.id != null ? f.id : 0,
            key: f.key || '',
            name: f.name || '',
            active: f.active != null ? f.active : false,
            deleted: f.deleted != null ? f.deleted : false,
            ensure_experience_continuity: f.ensure_experience_continuity != null ? f.ensure_experience_continuity : false,
            rollout_percentage: group && group.rollout_percentage != null ? group.rollout_percentage : null,
            tags: f.tags || [],
            created_at: f.created_at || '',
            created_by: mapCreatedBy(f.created_by)
          };
        };
        var mapExperiment = function (e) {
          e = e || {};
          return {
            id: e.id != null ? e.id : 0,
            name: e.name || '',
            description: e.description || '',
            start_date: e.start_date != null ? e.start_date : null,
            end_date: e.end_date != null ? e.end_date : null,
            feature_flag_key: e.feature_flag_key || '',
            created_at: e.created_at || '',
            created_by: mapCreatedBy(e.created_by),
            type: e.type || ''
          };
        };
        var mapAnnotation = function (a) {
          a = a || {};
          return {
            id: a.id != null ? a.id : 0,
            content: a.content || '',
            date_marker: a.date_marker || '',
            scope: a.scope || '',
            created_at: a.created_at || '',
            created_by: mapCreatedBy(a.created_by)
          };
        };
        var mapPerson = function (p) {
          p = p || {};
          return {
            id: p.id != null ? p.id : 0,
            uuid: p.uuid || '',
            name: p.name || '',
            distinct_ids: p.distinct_ids || [],
            properties: p.properties || {},
            created_at: p.created_at || ''
          };
        };
        var mapCohort = function (c) {
          c = c || {};
          return {
            id: c.id != null ? c.id : 0,
            name: c.name || '',
            description: c.description || '',
            count: c.count != null ? c.count : null,
            is_static: c.is_static != null ? c.is_static : false,
            is_calculating: c.is_calculating != null ? c.is_calculating : false,
            created_at: c.created_at || '',
            created_by: mapCreatedBy(c.created_by)
          };
        };
        var mapSurvey = function (s) {
          s = s || {};
          return {
            id: s.id || '',
            name: s.name || '',
            description: s.description || '',
            type: s.type || '',
            start_date: s.start_date != null ? s.start_date : null,
            end_date: s.end_date != null ? s.end_date : null,
            archived: s.archived != null ? s.archived : false,
            created_at: s.created_at || ''
          };
        };
        var mapAction = function (a) {
          a = a || {};
          return {
            id: a.id != null ? a.id : 0,
            name: a.name || '',
            description: a.description || '',
            tags: a.tags || [],
            created_at: a.created_at || '',
            created_by: mapCreatedBy(a.created_by),
            is_calculating: a.is_calculating != null ? a.is_calculating : false
          };
        };
        var mapEvent = function (e) {
          e = e || {};
          return {
            id: e.id || '',
            event: e.event || '',
            distinct_id: e.distinct_id || '',
            timestamp: e.timestamp || '',
            properties: e.properties || {}
          };
        };
        var mapEventDefinition = function (d) {
          d = d || {};
          return {
            id: d.id || '',
            name: d.name || '',
            volume_30_day: d.volume_30_day != null ? d.volume_30_day : null,
            query_usage_30_day: d.query_usage_30_day != null ? d.query_usage_30_day : null,
            last_seen_at: d.last_seen_at != null ? d.last_seen_at : null,
            created_at: d.created_at || ''
          };
        };
        var mapPropertyDefinition = function (d) {
          d = d || {};
          return {
            id: d.id || '',
            name: d.name || '',
            property_type: d.property_type != null ? d.property_type : null,
            is_numerical: d.is_numerical != null ? d.is_numerical : false
          };
        };

        // --- envelope helpers ------------------------------------------------
        function ok(data) {
          return { status: 'ok', data: data, message: null };
        }
        function error(code, message) {
          return { status: 'error', data: null, message: message, error_code: code };
        }
        function assertPage() {
          var host = '';
          try {
            host = String((window.location && window.location.hostname) || '');
          } catch (e) {
            host = '';
          }
          if (!/^(?:us|eu|app)\.posthog\.com$/.test(host)) {
            return error('UNSUPPORTED_PAGE', 'Not on a PostHog (us.posthog.com, eu.posthog.com) page.');
          }
          return null;
        }
        var ERROR_CODES = {
          AUTH_ERROR: 'AUTH',
          NOT_FOUND: 'NOT_FOUND',
          RATE_LIMITED: 'RATE_LIMITED',
          VALIDATION_ERROR: 'VALIDATION',
          TIMEOUT: 'TIMEOUT',
          network_error: 'NETWORK',
          http_error: 'HTTP'
        };
        function toEnvelopeError(err) {
          if (err && err.name === 'ToolError') {
            return {
              status: 'error',
              data: null,
              message: err.message || 'PostHog API call failed',
              error_code: ERROR_CODES[err.code] || String(err.code || 'ERROR').toUpperCase()
            };
          }
          return {
            status: 'error',
            data: null,
            message: String((err && err.message) || err || 'PostHog API call failed'),
            error_code: 'UNKNOWN'
          };
        }

        // --- the ported tool ------------------------------------------------
        var phTool = {
          name: "get_dashboard",
          description: "get_dashboard",
          handle: async (params) => {
            var data = await api('/api/environments/' + getTeamId() + '/dashboards/' + params.dashboard_id + '/');
            return { dashboard: mapDashboard(data) };
          },
        };

        var phToolImplementations = {
          async get_dashboard(args) {
            var pageError = assertPage();
            if (pageError) return pageError;
            try {
              var data = await phTool.handle(args);
              return ok(data);
            } catch (e) {
              return toEnvelopeError(e);
            }
          },
        };
        return phToolImplementations["get_dashboard"](args);
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
            'The PostHog tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'PostHog API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The PostHog tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
