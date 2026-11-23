// Self-contained adapter workflow. The Microsoft Outlook session and every same-origin
// API call stay inside the Microsoft Outlook tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "subject": {
        "type": "string",
        "description": "Event subject/title"
      },
      "start": {
        "type": "string",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|))$",
        "description": "Start as ISO 8601 without an offset (e.g. \"2026-06-02T13:00:00\"); the zone is set by time_zone."
      },
      "end": {
        "type": "string",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|))$",
        "description": "End as ISO 8601 without an offset (e.g. \"2026-06-02T14:00:00\"); the zone is set by time_zone."
      },
      "time_zone": {
        "description": "Time zone for start/end (e.g. \"Eastern Standard Time\"). Defaults to UTC.",
        "type": "string"
      },
      "body": {
        "description": "Event body/description",
        "type": "string"
      },
      "body_type": {
        "description": "Body content type (default: text)",
        "type": "string",
        "enum": [
          "text",
          "html"
        ]
      },
      "location": {
        "description": "Location display name",
        "type": "string"
      },
      "attendees": {
        "description": "Attendees to invite",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "address": {
              "type": "string",
              "description": "Attendee email address"
            },
            "name": {
              "description": "Attendee display name",
              "type": "string"
            },
            "type": {
              "description": "Attendance type (default: required)",
              "type": "string",
              "enum": [
                "required",
                "optional",
                "resource"
              ]
            }
          },
          "required": [
            "address"
          ],
          "additionalProperties": false
        }
      },
      "is_all_day": {
        "description": "All-day event. When true, start/end must be at midnight.",
        "type": "boolean"
      },
      "is_online_meeting": {
        "description": "Attach an online (Teams) meeting",
        "type": "boolean"
      },
      "importance": {
        "description": "Importance level",
        "type": "string",
        "enum": [
          "low",
          "normal",
          "high"
        ]
      },
      "show_as": {
        "description": "Free/busy status to show (default: busy)",
        "type": "string",
        "enum": [
          "free",
          "tentative",
          "busy",
          "oof",
          "workingElsewhere"
        ]
      },
      "reminder_minutes_before_start": {
        "description": "Reminder lead time in minutes",
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "calendar_id": {
        "description": "Calendar to create the event in. Defaults to the primary calendar.",
        "type": "string"
      }
    },
    "required": [
      "subject",
      "start",
      "end"
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
    description: 'create_event',
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

          const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
          const OUTLOOK_API_BASE = 'https://outlook.office.com/api/v2.0';
          // Outlook enterprise MSAL client ID
          const MSAL_CLIENT_ID = '9199bf20-a13f-4107-85dc-02114787ef48';
          // Consumer fallback
          const MSAL_CLIENT_ID_CONSUMER = '2821b473-fe24-4c86-ba16-62834d6e80c3';
          /** Per-capability auth cache key, keeping each token bucket separate. */
          const AUTH_CACHE_KEY = {
              mail: 'outlook',
              calendar: 'outlook-calendar',
              'calendar-write': 'outlook-calendar-write',
          };
          /**
           * Enumerate every MSAL client id whose token-index key starts with `prefix`.
           * The SDK's `findLocalStorageEntry` returns only the first match, which silently
           * drops every additional client id present when a user has multiple Microsoft
           * apps signed in.
           */
          const findAllMsalClientIds = (prefix) => {
              const ids = [];
              try {
                  const storage = window.localStorage;
                  for (let i = 0; i < storage.length; i++) {
                      const key = storage.key(i);
                      if (key?.startsWith(prefix)) {
                          ids.push(key.slice(prefix.length));
                      }
                  }
              }
              catch {
                  // SecurityError or missing localStorage — nothing we can do
              }
              return ids;
          };
          /**
           * True when the AAD scope claim (space-separated) contains at least one scope
           * whose URL hostname equals `host`. Each scope is parsed as a URL and compared
           * by `hostname` rather than substring-matched so a malicious value like
           * `https://attacker.com/graph.microsoft.com/foo` cannot satisfy the check.
           */
          const scopeClaimHasHost = (target, host) => {
              for (const scope of target.split(/\s+/)) {
                  if (scope.length === 0)
                      continue;
                  try {
                      if (new URL(scope).hostname.toLowerCase() === host)
                          return true;
                  }
                  catch {
                      // non-URL scopes (openid, profile, email, ...) — skip
                  }
              }
              return false;
          };
          /**
           * Return unexpired access tokens whose target scope claim grants the given host
           * from the MSAL v2 or v3 cache. Both versions share the same entry shape
           * (`secret`, `target`, `expiresOn`); only the index-key prefix differs.
           */
          const findMsalModernTokens = (version, clientId, host) => {
              const tokenKeysRaw = getLocalStorage(`msal.${version}.token.keys.${clientId}`);
              if (!tokenKeysRaw)
                  return [];
              let tokenKeys;
              try {
                  tokenKeys = JSON.parse(tokenKeysRaw);
              }
              catch {
                  return [];
              }
              if (!tokenKeys.accessToken)
                  return [];
              const apiBase = host === 'graph.microsoft.com' ? GRAPH_API_BASE : OUTLOOK_API_BASE;
              const matches = [];
              for (const key of tokenKeys.accessToken) {
                  const raw = getLocalStorage(key);
                  if (!raw)
                      continue;
                  try {
                      const parsed = JSON.parse(raw);
                      if (typeof parsed.secret !== 'string' || parsed.secret.length === 0)
                          continue;
                      const target = parsed.target ?? '';
                      if (!scopeClaimHasHost(target, host))
                          continue;
                      // Strict numeric coercion — Number.parseInt would accept '9999999999junk'
                      // as a giant future expiry; Number(...) returns NaN for trailing garbage.
                      const expiresOn = Number(parsed.expiresOn);
                      if (!Number.isInteger(expiresOn) || expiresOn <= 0 || expiresOn * 1000 < Date.now())
                          continue;
                      matches.push({ token: parsed.secret, apiBase });
                  }
                  catch {
                      // skip invalid entries
                  }
              }
              return matches;
          };
          /** Search MSAL v1 token cache for valid Graph API access tokens. */
          const findMsalV1Tokens = (clientId) => {
              const tokenKeysRaw = getLocalStorage(`msal.token.keys.${clientId}`);
              if (!tokenKeysRaw)
                  return [];
              let tokenKeys;
              try {
                  tokenKeys = JSON.parse(tokenKeysRaw);
              }
              catch {
                  return [];
              }
              if (!tokenKeys.accessToken)
                  return [];
              const matches = [];
              for (const key of tokenKeys.accessToken) {
                  if (!/(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key))
                      continue;
                  const raw = getLocalStorage(key);
                  if (!raw)
                      continue;
                  try {
                      const parsed = JSON.parse(raw);
                      if (typeof parsed.secret !== 'string' || parsed.secret.length === 0)
                          continue;
                      const expiresOn = Number(parsed.expiresOn);
                      if (!Number.isInteger(expiresOn) || expiresOn <= 0 || expiresOn * 1000 < Date.now())
                          continue;
                      matches.push({ token: parsed.secret, apiBase: GRAPH_API_BASE });
                  }
                  catch {
                      // skip invalid entries
                  }
              }
              return matches;
          };
          /**
           * Return every MSAL-cached token plausibly usable against Graph or Outlook REST,
           * deduplicated and ordered by preference (v3 enterprise → v2 enterprise → v1
           * consumer → other client ids). `api()` cascades through the list on 401/403;
           * the first token the API accepts is cached for subsequent calls.
           */
          const collectAuthCandidates = () => {
              const all = [];
              // Enterprise, known client id — v3 then v2, Graph then Outlook REST per version
              for (const version of ['3', '2']) {
                  all.push(...findMsalModernTokens(version, MSAL_CLIENT_ID, 'graph.microsoft.com'));
                  all.push(...findMsalModernTokens(version, MSAL_CLIENT_ID, 'outlook.office.com'));
              }
              // Consumer v1
              all.push(...findMsalV1Tokens(MSAL_CLIENT_ID_CONSUMER));
              // Fallback: every other client id present in localStorage, modern then v1.
              // Enumerate (not first-match) so users with multiple Microsoft apps signed in
              // surface every token, not just the first index key the iterator hits.
              for (const version of ['3', '2']) {
                  for (const cid of findAllMsalClientIds(`msal.${version}.token.keys.`)) {
                      if (cid === MSAL_CLIENT_ID)
                          continue;
                      all.push(...findMsalModernTokens(version, cid, 'graph.microsoft.com'));
                      all.push(...findMsalModernTokens(version, cid, 'outlook.office.com'));
                  }
              }
              for (const cid of findAllMsalClientIds('msal.token.keys.')) {
                  if (cid === MSAL_CLIENT_ID_CONSUMER)
                      continue;
                  all.push(...findMsalV1Tokens(cid));
              }
              // Deduplicate by token — multiple lookups can surface the same secret
              const seen = new Set();
              return all.filter(c => {
                  if (seen.has(c.token))
                      return false;
                  seen.add(c.token);
                  return true;
              });
          };
          const isAuthenticated = () => {
              if (getAuthCache(AUTH_CACHE_KEY.mail))
                  return true;
              return collectAuthCandidates().length > 0;
          };
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          /**
           * Recursively convert PascalCase keys to camelCase.
           * Outlook REST API returns PascalCase; Graph returns camelCase.
           * Normalizing to camelCase lets all mappers work with both APIs.
           */
          const toCamelCase = (str) => str.charAt(0).toLowerCase() + str.slice(1);
          const normalizeKeys = (obj) => {
              if (obj === null || obj === undefined || typeof obj !== 'object')
                  return obj;
              if (Array.isArray(obj))
                  return obj.map(normalizeKeys);
              const result = {};
              for (const [key, value] of Object.entries(obj)) {
                  // Skip OData metadata keys like @odata.context
                  const newKey = key.startsWith('@') ? key : toCamelCase(key);
                  result[newKey] = normalizeKeys(value);
              }
              return result;
          };
          const toPascalCase = (str) => str.charAt(0).toUpperCase() + str.slice(1);
          /**
           * Recursively convert object keys to PascalCase.
           * The Outlook REST API deserializes request bodies case-sensitively and requires
           * PascalCase property names for both entities (Subject, Start/DateTime) and OData
           * action parameters (Schedules, Comment). Graph uses camelCase. Request bodies are
           * authored in camelCase and transformed here when the request targets the REST base;
           * GET query options ($filter, $orderby) are case-insensitive on REST and unaffected.
           */
          const pascalCaseKeys = (obj) => {
              if (obj === null || obj === undefined || typeof obj !== 'object')
                  return obj;
              if (Array.isArray(obj))
                  return obj.map(pascalCaseKeys);
              const result = {};
              for (const [key, value] of Object.entries(obj)) {
                  result[toPascalCase(key)] = pascalCaseKeys(value);
              }
              return result;
          };
          /**
           * Send an authenticated request and handle the response.
           * Returns the parsed response or throws on error.
           * On 401/403, returns `null` to signal the caller to retry with a fresh token.
           */
          const sendRequest = async (auth, endpoint, options) => {
              const isOutlookApi = auth.apiBase === OUTLOOK_API_BASE;
              // Outlook REST API uses different $select field names, so drop $select
              // and let it return all fields. The normalizeKeys step handles casing.
              const query = options.query ? { ...options.query } : undefined;
              if (isOutlookApi && query) {
                  delete query.$select;
              }
              const qs = query ? buildQueryString(query) : '';
              const url = qs ? `${auth.apiBase}${endpoint}?${qs}` : `${auth.apiBase}${endpoint}`;
              const method = options.method ?? 'GET';
              const headers = {
                  Authorization: `Bearer ${auth.token}`,
                  ...options.headers,
              };
              const init = { method, headers };
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  const body = isOutlookApi ? pascalCaseKeys(options.body) : options.body;
                  init.body = JSON.stringify(body);
              }
              let response;
              try {
                  response = await fetch(url, {
                      ...init,
                      credentials: 'omit',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout('Microsoft API request timed out.');
                  }
                  if (err instanceof DOMException && err.name === 'AbortError') {
                      throw new ToolError('Request aborted', 'aborted');
                  }
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (response.status === 204)
                  return {};
              if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After');
                  const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
                  throw ToolError.rateLimited('Microsoft API rate limit exceeded.', retryMs);
              }
              // Signal caller to retry with a fresh token
              if (response.status === 401 || response.status === 403)
                  return null;
              if (response.status === 404) {
                  throw ToolError.notFound('The requested resource was not found.');
              }
              if (!response.ok) {
                  let errorMsg = `Microsoft API error (${response.status})`;
                  try {
                      const errBody = (await response.json());
                      if (errBody.error?.message) {
                          errorMsg = errBody.error.message;
                      }
                  }
                  catch {
                      // ignore parse errors
                  }
                  if (response.status === 400 || response.status === 422) {
                      throw ToolError.validation(errorMsg);
                  }
                  throw ToolError.internal(errorMsg);
              }
              // Successful actions (cancel, RSVP, sendMail) often return 202/205 or a 200 with
              // an empty body and no JSON. Only parse when the response actually carries JSON.
              const contentType = response.headers.get('content-type') ?? '';
              if (!contentType.includes('application/json'))
                  return {};
              const json = await response.json();
              return (isOutlookApi ? normalizeKeys(json) : json);
          };
          /**
           * Make an authenticated request to a Microsoft 365 API for the given capability,
           * cascading through every MSAL-cached candidate on 401/403 (the capability's cached
           * winner first) and caching the first that succeeds under that capability's slot.
           * Mail requests default to the `mail` capability; calendar tools pass `calendar` or
           * `calendar-write` so their winning token is cached separately and never thrashes a
           * mail-only token. Automatically uses whichever API the resolved token supports
           * (Graph or Outlook REST). Throws an auth error only after every candidate fails.
           */
          const api = async (endpoint, options = {}, capability = 'mail') => {
              const cacheKey = AUTH_CACHE_KEY[capability];
              const cached = getAuthCache(cacheKey);
              if (cached) {
                  const r = await sendRequest(cached, endpoint, options);
                  if (r !== null)
                      return r;
                  clearAuthCache(cacheKey);
              }
              const candidates = collectAuthCandidates();
              // Skip the cached candidate we just tried — it 401'd, no point retrying it.
              const remaining = cached ? candidates.filter(c => c.token !== cached.token) : candidates;
              if (remaining.length === 0) {
                  throw ToolError.auth(cached
                      ? 'Authentication expired — please refresh the Outlook page.'
                      : 'Not authenticated — please sign in to Microsoft 365.');
              }
              for (const auth of remaining) {
                  const r = await sendRequest(auth, endpoint, options);
                  if (r !== null) {
                      setAuthCache(cacheKey, auth);
                      return r;
                  }
              }
              throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
          };
          // OWS gateway lives on the OWA page's own origin — a third base distinct from Graph
          // and Outlook REST. It serves the client-side compose settings (roaming signatures,
          // startup data) that Graph's mailboxSettings does not expose. The adapter runs on
          // whichever OWA host matched (outlook.cloud.microsoft, outlook.office.com, or
          // outlook.office365.com), so resolve against the current origin to stay same-origin
          // rather than hardcoding one host. Read lazily (not at module scope) because the
          // plugin module is also loaded in Node at build time, where `window` is undefined.
          const owsBaseUrl = () => window.location.origin;
          const OWS_AUTH_CACHE_KEY = 'outlook-ows';
          /**
           * Read the `puid`/`tid` claims from an MSAL access token's JWT payload. No signature
           * verification — the token is already trusted (we minted the request with it); we
           * only need its routing hints. Returns an empty object for any malformed token.
           */
          const decodeTokenClaims = (jwt) => {
              const payload = jwt.split('.')[1];
              if (!payload)
                  return {};
              try {
                  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
                  const parsed = JSON.parse(json);
                  return {
                      puid: typeof parsed.puid === 'string' ? parsed.puid : undefined,
                      tid: typeof parsed.tid === 'string' ? parsed.tid : undefined,
                  };
              }
              catch {
                  return {};
              }
          };
          /**
           * Build the header set OWS gateway endpoints expect. The mailbox anchor
           * (`x-anchormailbox` / `x-routingparameter-sessionkey`) is derived from the token's
           * own `puid`/`tid` claims so the gateway routes to the right mailbox's settings.
           */
          const buildOwsHeaders = (token, extra) => {
              const headers = {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/json',
                  'x-ms-appname': 'owa-reactmail',
                  owaappid: '00000002-0000-0ff1-ce00-000000000000',
                  'x-outlook-client': 'owa',
                  ...extra,
              };
              const { puid, tid } = decodeTokenClaims(token);
              if (puid) {
                  const anchor = tid ? `PUID:${puid}@${tid}` : `PUID:${puid}`;
                  headers['x-anchormailbox'] = anchor;
                  headers['x-routingparameter-sessionkey'] = anchor;
              }
              return headers;
          };
          /**
           * Encode an OWS query string with `encodeURIComponent` per value, yielding `%20` for
           * spaces (in signature display names) and `%2C` for commas (the `settingname` list
           * delimiter) — both of which the OWS gateway accepts. `URLSearchParams` is avoided
           * because it encodes spaces as `+`, which OWS does not decode back to a space.
           */
          const encodeOwsQuery = (query) => {
              const parts = [];
              for (const [key, value] of Object.entries(query)) {
                  if (value === undefined)
                      continue;
                  parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
              }
              return parts.join('&');
          };
          /**
           * Send one OWS request with a specific token. OWS is same-origin, so cookies ride
           * along with the Bearer token. A 404 means the token authenticated but the settings
           * collection holds no such item (e.g. a signature with no body) — distinct from
           * 401/403, which signals "try the next candidate token".
           */
          const sendOwsRequest = async (token, endpoint, options) => {
              const qs = options.query ? encodeOwsQuery(options.query) : '';
              const base = owsBaseUrl();
              const url = qs ? `${base}${endpoint}?${qs}` : `${base}${endpoint}`;
              let response;
              try {
                  response = await fetch(url, {
                      method: options.method ?? 'GET',
                      headers: buildOwsHeaders(token, options.headers),
                      credentials: 'same-origin',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout('Microsoft settings request timed out.');
                  }
                  throw new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
                      category: 'internal',
                      retryable: true,
                  });
              }
              if (response.status === 401 || response.status === 403)
                  return { kind: 'authFail' };
              if (response.status === 404)
                  return { kind: 'notFound' };
              if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After');
                  const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
                  throw ToolError.rateLimited('Microsoft API rate limit exceeded.', retryMs);
              }
              if (!response.ok) {
                  throw ToolError.internal(`Microsoft settings request failed (${response.status}).`);
              }
              const contentType = response.headers.get('content-type') ?? '';
              const data = contentType.includes('application/json') ? (await response.json()) : {};
              return { kind: 'ok', data };
          };
          /**
           * Request an OWS gateway endpoint on the OWA origin (roaming signature settings,
           * startup data), cascading through every MSAL candidate on 401/403 exactly like
           * `api()` and caching the winner in its own slot. Returns `undefined` when a token
           * authenticated but the endpoint returned 404 (no such setting), so callers can
           * treat a missing signature as "none configured" rather than an error. Throws only
           * when no candidate authenticates at all.
           */
          const owsRequest = async (endpoint, options = {}) => {
              const cached = getAuthCache(OWS_AUTH_CACHE_KEY);
              if (cached) {
                  const outcome = await sendOwsRequest(cached.token, endpoint, options);
                  if (outcome.kind === 'ok')
                      return outcome.data;
                  if (outcome.kind === 'notFound')
                      return undefined;
                  clearAuthCache(OWS_AUTH_CACHE_KEY);
              }
              const candidates = collectAuthCandidates();
              const remaining = cached ? candidates.filter(c => c.token !== cached.token) : candidates;
              if (remaining.length === 0) {
                  throw ToolError.auth(cached
                      ? 'Authentication expired — please refresh the Outlook page.'
                      : 'Not authenticated — please sign in to Microsoft 365.');
              }
              for (const auth of remaining) {
                  const outcome = await sendOwsRequest(auth.token, endpoint, options);
                  if (outcome.kind === 'ok') {
                      setAuthCache(OWS_AUTH_CACHE_KEY, auth);
                      return outcome.data;
                  }
                  // A 404 means this token authenticated (the gateway resolved its mailbox) and the
                  // setting is simply absent — a valid winner to cache, so a genuinely-missing
                  // signature does not re-cascade through every token on each subsequent call.
                  if (outcome.kind === 'notFound') {
                      setAuthCache(OWS_AUTH_CACHE_KEY, auth);
                      return undefined;
                  }
              }
              throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
          };

          // ── User ────────────────────────────────────────────────────────────────
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              display_name: z.string().describe('Display name'),
              email: z.string().describe('Email address'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              display_name: u.displayName ?? '',
              email: u.mail ?? u.emailAddress ?? u.userPrincipalName ?? '',
          });
          // ── Email Address ───────────────────────────────────────────────────────
          const emailAddressSchema = z.object({
              name: z.string().describe('Display name'),
              address: z.string().describe('Email address'),
          });
          const mapEmailAddress = (e) => ({
              name: e?.emailAddress?.name ?? '',
              address: e?.emailAddress?.address ?? '',
          });
          // ── Message ─────────────────────────────────────────────────────────────
          const messageSummarySchema = z.object({
              id: z.string().describe('Message ID'),
              subject: z.string().describe('Subject line'),
              from: emailAddressSchema.describe('Sender'),
              to: z.array(emailAddressSchema).describe('To recipients'),
              received_at: z.string().describe('Received datetime (ISO 8601)'),
              is_read: z.boolean().describe('Whether the message has been read'),
              has_attachments: z.boolean().describe('Whether the message has attachments'),
              importance: z.string().describe('Importance level (low, normal, high)'),
              preview: z.string().describe('Body preview text'),
          });
          const messageDetailSchema = messageSummarySchema.extend({
              cc: z.array(emailAddressSchema).describe('CC recipients'),
              bcc: z.array(emailAddressSchema).describe('BCC recipients'),
              body_type: z.string().describe('Body content type (text or html)'),
              body: z.string().describe('Full message body'),
              web_link: z.string().describe('Link to open in Outlook'),
              conversation_id: z.string().describe('Conversation thread ID'),
              categories: z.array(z.string()).describe('Categories/labels'),
              flag_status: z.string().describe('Flag status (notFlagged, flagged, complete)'),
          });
          const mapMessageSummary = (m) => ({
              id: m.id ?? '',
              subject: m.subject ?? '(no subject)',
              from: mapEmailAddress(m.from ?? {}),
              to: (m.toRecipients ?? []).map(mapEmailAddress),
              received_at: m.receivedDateTime ?? '',
              is_read: m.isRead ?? false,
              has_attachments: m.hasAttachments ?? false,
              importance: m.importance ?? 'normal',
              preview: m.bodyPreview ?? '',
          });
          const mapMessageDetail = (m) => ({
              ...mapMessageSummary(m),
              cc: (m.ccRecipients ?? []).map(mapEmailAddress),
              bcc: (m.bccRecipients ?? []).map(mapEmailAddress),
              body_type: m.body?.contentType ?? 'text',
              body: m.body?.content ?? '',
              web_link: m.webLink ?? '',
              conversation_id: m.conversationId ?? '',
              categories: m.categories ?? [],
              flag_status: m.flag?.flagStatus ?? 'notFlagged',
          });
          // ── Mail Folder ─────────────────────────────────────────────────────────
          const mailFolderSchema = z.object({
              id: z.string().describe('Folder ID'),
              display_name: z.string().describe('Folder display name'),
              parent_folder_id: z.string().describe('Parent folder ID'),
              child_folder_count: z.number().describe('Number of child folders'),
              unread_count: z.number().describe('Unread message count'),
              total_count: z.number().describe('Total message count'),
          });
          const mapMailFolder = (f) => ({
              id: f.id ?? '',
              display_name: f.displayName ?? '',
              parent_folder_id: f.parentFolderId ?? '',
              child_folder_count: f.childFolderCount ?? 0,
              unread_count: f.unreadItemCount ?? 0,
              total_count: f.totalItemCount ?? 0,
          });
          // ── Attachment ──────────────────────────────────────────────────────────
          const attachmentSchema = z.object({
              id: z.string().describe('Attachment ID'),
              name: z.string().describe('File name'),
              content_type: z.string().describe('MIME type'),
              size: z.number().describe('Size in bytes'),
              is_inline: z.boolean().describe('Whether the attachment is inline'),
          });
          const mapAttachment = (a) => ({
              id: a.id ?? '',
              name: a.name ?? '',
              content_type: a.contentType ?? '',
              size: a.size ?? 0,
              is_inline: a.isInline ?? false,
          });
          // ── Shared field lists for $select ──────────────────────────────────────
          const MESSAGE_SUMMARY_FIELDS = 'id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,bodyPreview';
          const MESSAGE_DETAIL_FIELDS = 'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,hasAttachments,importance,bodyPreview,body,webLink,conversationId,categories,flag';

          /**
           * Applies the user's Outlook compose defaults — default font and signature — to
           * bodies the plugin creates, so plugin-authored drafts match what OWA's compose
           * surface produces. These are client-side OWA behaviors that Graph's mailboxSettings
           * does not expose; they are read from OWS gateway endpoints on the OWA origin.
           */
          /**
           * OWA's default compose font family. There is no server-stored compose font *name* —
           * startup data carries only size/color/flags — so the family is OWA's client default
           * (the Aptos stack), matching what the compose surface renders.
           */
          const DEFAULT_FONT_FAMILY = 'Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif';
          const DEFAULT_FONT_SIZE_PT = 12;
          const DEFAULT_FONT_COLOR = '#000000';
          /** 3- or 6-digit hex color, so a server value can't break out of the style attribute. */
          const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
          /**
           * OWA's rich-text compose font-size enum → point size — the classic Outlook/Word
           * font-size scale (1–7). `3 ⇒ 12 pt` is confirmed against the live compose surface;
           * values outside this range fall back to the 12 pt default.
           */
          const FONT_SIZE_PT_BY_ENUM = {
              1: 8,
              2: 10,
              3: 12,
              4: 14,
              5: 18,
              6: 24,
              7: 36,
          };
          /** OWA compose font style bit flags (Microsoft rich-text convention). */
          const FONT_FLAG_BOLD = 1;
          const FONT_FLAG_ITALIC = 2;
          const FONT_FLAG_UNDERLINE = 4;
          // Compose defaults are stable for the page's lifetime, so cache them for the tab
          // session. A page reload (e.g. after the user edits a signature in OWA) refreshes.
          let cachedDefaults = null;
          const signatureHtmlCache = new Map();
          const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const textToHtml = (text) => escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
          /** Read the signature display-name defaults (new-mail + reply/forward) from OWS. */
          const readSignatureNames = async () => {
              const settings = await owsRequest('/ows/v1/OutlookCloudSettings/settings/', {
                  query: { settingname: 'roaming_signature_list,roaming_new_signature,roaming_reply_signature' },
              });
              // Field-name casing varies (roaming_new_signature vs Roaming_Reply_Signature), so
              // key the lookup case-insensitively.
              const byName = new Map();
              for (const setting of settings ?? []) {
                  if (setting.name && typeof setting.value === 'string')
                      byName.set(setting.name.toLowerCase(), setting.value);
              }
              const nonEmpty = (value) => (value && value.trim().length > 0 ? value : null);
              return {
                  newSignatureName: nonEmpty(byName.get('roaming_new_signature')),
                  replySignatureName: nonEmpty(byName.get('roaming_reply_signature')),
              };
          };
          /** Read the default compose font (size/color/flags) from OWA startup data. */
          const readFont = async () => {
              let options;
              try {
                  const data = await owsRequest('/owa/startupdata.ashx', {
                      method: 'POST',
                      query: { app: 'Mail', n: 0 },
                      headers: { action: 'StartupData', 'x-owa-actionsource': 'StartupData', 'x-req-source': 'Mail' },
                  });
                  options = data?.owaUserConfig?.UserOptions;
              }
              catch {
                  options = undefined;
              }
              const sizeEnum = options?.ComposeFontSize;
              const fontSizePt = (typeof sizeEnum === 'number' && FONT_SIZE_PT_BY_ENUM[sizeEnum]) || DEFAULT_FONT_SIZE_PT;
              const composeFontColor = options?.ComposeFontColor?.trim();
              const fontColor = composeFontColor && HEX_COLOR_PATTERN.test(composeFontColor) ? composeFontColor : DEFAULT_FONT_COLOR;
              const fontFlags = typeof options?.ComposeFontFlags === 'number' ? options.ComposeFontFlags : 0;
              return { fontFamily: DEFAULT_FONT_FAMILY, fontSizePt, fontColor, fontFlags };
          };
          /**
           * Resolve (and cache) the user's compose defaults. The font lookup degrades to
           * defaults on failure, but the signature-name lookup propagates whatever `owsRequest`
           * throws (auth, rate-limit, non-OK, or network), so callers that must not fail — like
           * `composeBody` — guard the call.
           */
          const getComposeDefaults = async () => {
              if (cachedDefaults)
                  return cachedDefaults;
              const [names, font] = await Promise.all([readSignatureNames(), readFont()]);
              cachedDefaults = { ...font, ...names };
              return cachedDefaults;
          };
          /**
           * Fetch a signature's HTML body (with its logo inlined as a data-URI) by display
           * name. Returns null when the signature has no HTML body. Requires the
           * `x-islargesetting: true` header — signature bodies live in OWS's large-settings
           * collection, and without it the gateway 404s.
           */
          const getSignatureHtml = async (displayName) => {
              const key = displayName.toLowerCase();
              const cached = signatureHtmlCache.get(key);
              if (cached !== undefined)
                  return cached;
              const items = await owsRequest('/ows/v1/OutlookCloudSettings/settings/account', {
                  query: { settingname: displayName },
                  headers: { 'x-islargesetting': 'true' },
              });
              const html = items?.find(item => item.secondaryKey === 'htm')?.value;
              const result = typeof html === 'string' && html.length > 0 ? html : null;
              signatureHtmlCache.set(key, result);
              return result;
          };
          /** Wrap body HTML in the default-font div OWA applies to the compose surface. */
          const wrapInDefaultFont = (html, defaults) => {
              const styles = [
                  `font-family: ${defaults.fontFamily}`,
                  `font-size: ${defaults.fontSizePt}pt`,
                  `color: ${defaults.fontColor}`,
              ];
              if (defaults.fontFlags & FONT_FLAG_BOLD)
                  styles.push('font-weight: bold');
              if (defaults.fontFlags & FONT_FLAG_ITALIC)
                  styles.push('font-style: italic');
              if (defaults.fontFlags & FONT_FLAG_UNDERLINE)
                  styles.push('text-decoration: underline');
              return `<div style="${styles.join('; ')}">${html}</div>`;
          };
          /**
           * Compose an HTML email body with the user's default compose font and (optionally)
           * their Outlook signature applied — matching what OWA's compose surface produces.
           * Plain-text input is escaped and wrapped in the default-font div; HTML input is
           * kept as-is (assumed already styled by the caller). The signature, with its inline
           * data-URI images, is appended below the body. Degrades gracefully: if compose
           * defaults or the signature can't be fetched, the body is still returned as safe
           * HTML — a draft is never blocked on fetching a signature.
           */
          const composeBody = async (input) => {
              const bodyHtml = input.bodyType === 'html' ? input.body : textToHtml(input.body);
              let defaults = null;
              try {
                  defaults = await getComposeDefaults();
              }
              catch {
                  defaults = null;
              }
              // Only synthesize the default font for plain-text input; HTML input is trusted to
              // carry its own styling.
              const styledBody = defaults && input.bodyType === 'text' ? wrapInDefaultFont(bodyHtml, defaults) : bodyHtml;
              let signatureHtml = null;
              if (defaults && input.signature !== 'none') {
                  const name = input.signature === 'new' ? defaults.newSignatureName : defaults.replySignatureName;
                  if (name) {
                      try {
                          signatureHtml = await getSignatureHtml(name);
                      }
                      catch {
                          signatureHtml = null;
                      }
                  }
              }
              const content = signatureHtml ? `${styledBody}<br>${signatureHtml}` : styledBody;
              return { contentType: 'HTML', content };
          };
          /**
           * Convenience wrapper over `composeBody` for the message tools: maps a tool's
           * `body_type` / `include_signature` inputs to compose options, applying the given
           * signature kind unless the caller opted out with `include_signature: false`.
           */
          const composeToolBody = (input, signatureKind) => composeBody({
              body: input.body,
              bodyType: input.body_type === 'html' ? 'html' : 'text',
              signature: input.include_signature === false ? 'none' : signatureKind,
          });

          // ── Date / time ───────────────────────────────────────────────────────────
          const dateTimeZoneSchema = z.object({
              date_time: z.string().describe('Local date-time in ISO 8601 without offset (e.g. "2026-06-02T13:00:00")'),
              time_zone: z.string().describe('Time zone name (e.g. "UTC", "Eastern Standard Time")'),
          });
          const mapDateTimeZone = (d) => ({
              date_time: d?.dateTime ?? '',
              time_zone: d?.timeZone ?? '',
          });
          // ── Attendee ───────────────────────────────────────────────────────────────
          const attendeeSchema = z.object({
              name: z.string().describe('Attendee display name'),
              address: z.string().describe('Attendee email address'),
              type: z.string().describe('Attendance type (required, optional, resource)'),
              response: z
                  .string()
                  .describe('Response status (none, accepted, declined, tentativelyAccepted, notResponded, organizer)'),
          });
          const mapAttendee = (a) => {
              const { name, address } = mapEmailAddress(a);
              return {
                  name,
                  address,
                  type: a.type ?? 'required',
                  response: a.status?.response ?? 'none',
              };
          };
          // ── Calendar ───────────────────────────────────────────────────────────────
          const calendarSchema = z.object({
              id: z.string().describe('Calendar ID'),
              name: z.string().describe('Calendar display name'),
              color: z.string().describe('Color preset name (auto, lightBlue, lightGreen, ...)'),
              hex_color: z.string().describe('Color as a hex string when available'),
              is_default: z.boolean().describe('Whether this is the default calendar'),
              can_edit: z.boolean().describe('Whether the user can edit events in this calendar'),
              can_share: z.boolean().describe('Whether the user can share this calendar'),
              can_view_private_items: z.boolean().describe('Whether the user can view private events'),
              owner: emailAddressSchema.describe('Calendar owner'),
          });
          const mapCalendar = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              color: c.color ?? 'auto',
              hex_color: c.hexColor ?? '',
              is_default: c.isDefaultCalendar ?? false,
              can_edit: c.canEdit ?? false,
              can_share: c.canShare ?? false,
              can_view_private_items: c.canViewPrivateItems ?? false,
              owner: {
                  name: c.owner?.name ?? '',
                  address: c.owner?.address ?? '',
              },
          });
          // ── Event ──────────────────────────────────────────────────────────────────
          const eventSummarySchema = z.object({
              id: z.string().describe('Event ID'),
              subject: z.string().describe('Event subject/title'),
              start: dateTimeZoneSchema.describe('Start date-time'),
              end: dateTimeZoneSchema.describe('End date-time'),
              is_all_day: z.boolean().describe('Whether the event lasts all day'),
              location: z.string().describe('Primary location display name'),
              organizer: emailAddressSchema.describe('Event organizer'),
              is_cancelled: z.boolean().describe('Whether the event has been cancelled'),
              show_as: z.string().describe('Free/busy status (free, tentative, busy, oof, workingElsewhere, unknown)'),
              is_online_meeting: z.boolean().describe('Whether the event is an online meeting'),
              online_meeting_url: z.string().describe('Join URL for the online meeting, if any'),
              type: z.string().describe('Event type (singleInstance, occurrence, exception, seriesMaster)'),
              response_status: z
                  .string()
                  .describe("The current user's response (none, accepted, declined, tentativelyAccepted, organizer, notResponded)"),
              web_link: z.string().describe('Link to open the event in Outlook on the web'),
              preview: z.string().describe('Body preview text'),
          });
          const eventDetailSchema = eventSummarySchema.extend({
              body_type: z.string().describe('Body content type (text or html)'),
              body: z.string().describe('Full event body'),
              attendees: z.array(attendeeSchema).describe('Event attendees and their responses'),
              importance: z.string().describe('Importance level (low, normal, high)'),
              sensitivity: z.string().describe('Sensitivity (normal, personal, private, confidential)'),
              categories: z.array(z.string()).describe('Categories/labels'),
              is_reminder_on: z.boolean().describe('Whether a reminder is set'),
              reminder_minutes_before_start: z.number().describe('Minutes before start the reminder fires'),
              has_attachments: z.boolean().describe('Whether the event has attachments'),
              response_requested: z.boolean().describe('Whether the organizer requested a response'),
              series_master_id: z.string().describe('ID of the series master, for occurrences/exceptions'),
              is_recurring: z.boolean().describe('Whether the event is part of a recurring series'),
              created_at: z.string().describe('Creation datetime (ISO 8601)'),
              last_modified_at: z.string().describe('Last modified datetime (ISO 8601)'),
          });
          const mapEventSummary = (e) => ({
              id: e.id ?? '',
              subject: e.subject ?? '(no subject)',
              start: mapDateTimeZone(e.start),
              end: mapDateTimeZone(e.end),
              is_all_day: e.isAllDay ?? false,
              location: e.location?.displayName ?? '',
              organizer: mapEmailAddress(e.organizer ?? {}),
              is_cancelled: e.isCancelled ?? false,
              show_as: e.showAs ?? 'unknown',
              is_online_meeting: e.isOnlineMeeting ?? false,
              online_meeting_url: e.onlineMeeting?.joinUrl ?? '',
              type: e.type ?? 'singleInstance',
              response_status: e.responseStatus?.response ?? 'none',
              web_link: e.webLink ?? '',
              preview: e.bodyPreview ?? '',
          });
          const mapEventDetail = (e) => ({
              ...mapEventSummary(e),
              body_type: e.body?.contentType ?? 'text',
              body: e.body?.content ?? '',
              attendees: (e.attendees ?? []).map(mapAttendee),
              importance: e.importance ?? 'normal',
              sensitivity: e.sensitivity ?? 'normal',
              categories: e.categories ?? [],
              is_reminder_on: e.isReminderOn ?? false,
              reminder_minutes_before_start: e.reminderMinutesBeforeStart ?? 0,
              has_attachments: e.hasAttachments ?? false,
              response_requested: e.responseRequested ?? false,
              series_master_id: e.seriesMasterId ?? '',
              is_recurring: Boolean(e.recurrence) || e.type === 'seriesMaster' || e.type === 'occurrence' || e.type === 'exception',
              created_at: e.createdDateTime ?? '',
              last_modified_at: e.lastModifiedDateTime ?? '',
          });
          // ── Request-body builders (create / update) ─────────────────────────────────
          /** Build a Graph/REST dateTimeTimeZone object. Times default to UTC when no zone given. */
          const buildDateTime = (dateTime, timeZone) => ({
              dateTime,
              timeZone: timeZone ?? 'UTC',
          });
          /** Attendee shape accepted by create_event / update_event input. */
          const attendeeInputSchema = z.object({
              address: z.string().describe('Attendee email address'),
              name: z.string().optional().describe('Attendee display name'),
              type: z.enum(['required', 'optional', 'resource']).optional().describe('Attendance type (default: required)'),
          });
          /** Build the attendees array for an event request body. */
          const buildAttendees = (attendees) => attendees.map(a => ({
              emailAddress: { address: a.address, name: a.name },
              type: a.type ?? 'required',
          }));
          // ── Schedule (free/busy) ─────────────────────────────────────────────────
          const scheduleItemSchema = z.object({
              status: z.string().describe('Free/busy status (free, tentative, busy, oof, workingElsewhere, unknown)'),
              start: dateTimeZoneSchema.describe('Slot start'),
              end: dateTimeZoneSchema.describe('Slot end'),
              subject: z.string().describe('Subject, when visible to the requester'),
              location: z.string().describe('Location, when visible'),
              is_private: z.boolean().describe('Whether the item is marked private'),
              is_meeting: z.boolean().describe('Whether the item is a meeting'),
              is_recurring: z.boolean().describe('Whether the item recurs'),
          });
          const workingHoursSchema = z.object({
              days_of_week: z.array(z.string()).describe('Working days'),
              start_time: z.string().describe('Work day start time'),
              end_time: z.string().describe('Work day end time'),
              time_zone: z.string().describe('Working-hours time zone name'),
          });
          const scheduleSchema = z.object({
              schedule_id: z.string().describe('The email address this schedule belongs to'),
              availability_view: z
                  .string()
                  .describe('Per-interval availability string: 0=free, 1=tentative, 2=busy, 3=oof, 4=workingElsewhere'),
              items: z.array(scheduleItemSchema).describe('Busy/tentative/oof time blocks in the requested window'),
              working_hours: workingHoursSchema.nullable().describe('Working hours, when available'),
              error: z.string().describe('Error message for this schedule, if the lookup failed'),
          });
          const mapSchedule = (s) => ({
              schedule_id: s.scheduleId ?? '',
              availability_view: s.availabilityView ?? '',
              items: (s.scheduleItems ?? []).map(item => ({
                  status: item.status ?? 'unknown',
                  start: mapDateTimeZone(item.start),
                  end: mapDateTimeZone(item.end),
                  subject: item.subject ?? '',
                  location: item.location ?? '',
                  is_private: item.isPrivate ?? false,
                  is_meeting: item.isMeeting ?? false,
                  is_recurring: item.isRecurring ?? false,
              })),
              working_hours: s.workingHours
                  ? {
                      days_of_week: s.workingHours.daysOfWeek ?? [],
                      start_time: s.workingHours.startTime ?? '',
                      end_time: s.workingHours.endTime ?? '',
                      time_zone: s.workingHours.timeZone?.name ?? '',
                  }
                  : null,
              error: s.error?.message ?? '',
          });
          // ── Shared field lists for $select ──────────────────────────────────────────
          const EVENT_SUMMARY_FIELDS = 'id,subject,start,end,isAllDay,location,organizer,isCancelled,showAs,isOnlineMeeting,onlineMeeting,type,responseStatus,webLink,bodyPreview';
          const EVENT_DETAIL_FIELDS = `${EVENT_SUMMARY_FIELDS},body,attendees,importance,sensitivity,categories,isReminderOn,reminderMinutesBeforeStart,hasAttachments,responseRequested,seriesMasterId,recurrence,createdDateTime,lastModifiedDateTime`;
          const createEvent = defineTool({
              name: 'create_event',
              displayName: 'Create Event',
              description: 'Create a calendar event or meeting. Add attendees to send invitations. Set is_online_meeting to attach a Teams meeting link. Times are interpreted as UTC unless a time_zone is supplied.',
              summary: 'Create a calendar event',
              icon: 'calendar-plus',
              group: 'Calendar',
              input: z.object({
                  subject: z.string().describe('Event subject/title'),
                  start: z.iso
                      .datetime({ offset: false, local: true })
                      .describe('Start as ISO 8601 without an offset (e.g. "2026-06-02T13:00:00"); the zone is set by time_zone.'),
                  end: z.iso
                      .datetime({ offset: false, local: true })
                      .describe('End as ISO 8601 without an offset (e.g. "2026-06-02T14:00:00"); the zone is set by time_zone.'),
                  time_zone: z
                      .string()
                      .optional()
                      .describe('Time zone for start/end (e.g. "Eastern Standard Time"). Defaults to UTC.'),
                  body: z.string().optional().describe('Event body/description'),
                  body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
                  location: z.string().optional().describe('Location display name'),
                  attendees: z.array(attendeeInputSchema).optional().describe('Attendees to invite'),
                  is_all_day: z.boolean().optional().describe('All-day event. When true, start/end must be at midnight.'),
                  is_online_meeting: z.boolean().optional().describe('Attach an online (Teams) meeting'),
                  importance: z.enum(['low', 'normal', 'high']).optional().describe('Importance level'),
                  show_as: z
                      .enum(['free', 'tentative', 'busy', 'oof', 'workingElsewhere'])
                      .optional()
                      .describe('Free/busy status to show (default: busy)'),
                  reminder_minutes_before_start: z.number().int().min(0).optional().describe('Reminder lead time in minutes'),
                  calendar_id: z.string().optional().describe('Calendar to create the event in. Defaults to the primary calendar.'),
              }),
              output: z.object({
                  event: eventDetailSchema.describe('The created event'),
              }),
              handle: async (params) => {
                  const body = {
                      subject: params.subject,
                      start: buildDateTime(params.start, params.time_zone),
                      end: buildDateTime(params.end, params.time_zone),
                  };
                  if (params.body !== undefined) {
                      body.body = { contentType: params.body_type === 'html' ? 'HTML' : 'Text', content: params.body };
                  }
                  if (params.location !== undefined)
                      body.location = { displayName: params.location };
                  if (params.attendees)
                      body.attendees = buildAttendees(params.attendees);
                  if (params.is_all_day !== undefined)
                      body.isAllDay = params.is_all_day;
                  if (params.is_online_meeting !== undefined)
                      body.isOnlineMeeting = params.is_online_meeting;
                  if (params.importance !== undefined)
                      body.importance = params.importance;
                  if (params.show_as !== undefined)
                      body.showAs = params.show_as;
                  if (params.reminder_minutes_before_start !== undefined) {
                      body.reminderMinutesBeforeStart = params.reminder_minutes_before_start;
                      body.isReminderOn = true;
                  }
                  const endpoint = params.calendar_id
                      ? `/me/calendars/${encodeURIComponent(params.calendar_id)}/events`
                      : '/me/events';
                  const created = await api(endpoint, { method: 'POST', body, query: { $select: EVENT_DETAIL_FIELDS } }, 'calendar-write');
                  return { event: mapEventDetail(created) };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = createEvent

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
                      var productProbe = PRODUCT_HOSTS['outlook'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Outlook page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)outlook\\.(office|live)\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Outlook page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Outlook page.')
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
            async create_event(args) {
              return runTool('create_event', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['create_event'](args)
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
            'The Microsoft Outlook tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Microsoft Outlook API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Microsoft Outlook tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
