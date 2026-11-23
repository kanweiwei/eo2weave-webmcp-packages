// Self-contained adapter workflow. The Microsoft Teams session and every same-origin
// API call stay inside the Microsoft Teams tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "members": {
        "minItems": 1,
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "description": "User MRI identifiers to add to the chat (e.g., [\"8:live:username\"])"
      },
      "topic": {
        "description": "Optional chat topic/title",
        "type": "string"
      }
    },
    "required": [
      "members"
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
    description: 'create_chat',
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

          /** Detect whether we are running on consumer or enterprise Teams. */
          const detectEnvironment = () => {
              try {
                  if (typeof window !== 'undefined' && window.location.hostname === 'teams.live.com') {
                      return 'consumer';
                  }
              }
              catch {
                  // Fall through to enterprise default
              }
              return 'enterprise';
          };
          const CONSUMER_CONFIG = {
              authzUrl: 'https://teams.live.com/api/auth/v1.0/authz/consumer',
              chatServiceBase: 'https://teams.live.com/api/chatsvc/consumer',
          };
          const ENTERPRISE_CONFIG = {
              get authzUrl() {
                  try {
                      if (typeof window !== 'undefined') {
                          return `${window.location.origin}/api/authsvc/v1.0/authz`;
                      }
                  }
                  catch {
                      // fall through to default
                  }
                  return 'https://teams.microsoft.com/api/authsvc/v1.0/authz';
              },
              chatServiceBase: null, // Discovered at runtime from regionGtms
          };
          const getConfig = () => {
              return detectEnvironment() === 'consumer' ? CONSUMER_CONFIG : ENTERPRISE_CONFIG;
          };
          /**
           * Read a value the pre-script stashed under the `teams` plugin namespace.
           *
           * `getPreScriptValue` from the SDK depends on `globalThis.__openTabs._pluginName`
           * being bound, but the adapter IIFE only binds that during tool dispatch —
           * `isReady()` runs before any tool is dispatched, so the SDK helper would
           * return `undefined` there. We try the SDK helper first (which gives
           * forward-compat with any future SDK changes), then fall back to a direct
           * namespace read against the documented path.
           */
          const readPreScriptValue = (key) => {
              const viaSdk = getPreScriptValue(key);
              if (viaSdk !== undefined)
                  return viaSdk;
              const ns = globalThis.__openTabs
                  ?.preScript?.teams;
              return ns?.[key];
          };
          /**
           * Read the MSAL-issued Skype API access token captured by the pre-script.
           * The pre-script (plugins/teams/src/pre-script.ts) observes MSAL cache
           * writes via `Storage.prototype.setItem` and an initial `localStorage`
           * scan, recognising entries by their value shape (`credentialType`,
           * `target`, `secret`, `expiresOn`). The adapter only reads the captured
           * value here — it never inspects MSAL key shapes, so the path is
           * resilient to future MSAL cache key layout changes.
           */
          const getSkypeAccessToken = () => {
              const key = detectEnvironment() === 'consumer' ? 'consumerToken' : 'enterpriseToken';
              const captured = readPreScriptValue(key);
              if (!captured || typeof captured.secret !== 'string' || captured.secret.length === 0) {
                  return null;
              }
              if (typeof captured.expiresOn !== 'number' || captured.expiresOn <= Date.now() / 1000) {
                  return null;
              }
              return captured.secret;
          };
          // ---------------------------------------------------------------------------
          // Enterprise chat service URL discovery
          // ---------------------------------------------------------------------------
          /** Cached enterprise chat service URL. */
          let cachedEnterpriseChatServiceBase = null;
          /**
           * Discover the enterprise chat service URL from the regionGtms data stored
           * in localStorage by the Teams SPA. Falls back to the AFD proxy URL.
           */
          const discoverEnterpriseChatServiceBase = () => {
              if (cachedEnterpriseChatServiceBase)
                  return cachedEnterpriseChatServiceBase;
              const entry = findLocalStorageEntry(key => key.includes('Discover.SKYPE-TOKEN'));
              if (entry) {
                  try {
                      const data = JSON.parse(entry.value);
                      const chatServiceAfd = data.item?.regionGtms?.chatServiceAfd;
                      if (chatServiceAfd) {
                          cachedEnterpriseChatServiceBase = chatServiceAfd;
                          return chatServiceAfd;
                      }
                      const chatService = data.item?.regionGtms?.chatService;
                      if (chatService) {
                          cachedEnterpriseChatServiceBase = chatService;
                          return chatService;
                      }
                  }
                  catch {
                      // Fall through to default
                  }
              }
              // Default fallback — AMER region AFD proxy
              return 'https://teams.microsoft.com/api/chatsvc/amer';
          };
          /** Get the chat service base URL for the current environment. */
          const getChatServiceBase = () => {
              const config = getConfig();
              return config.chatServiceBase ?? discoverEnterpriseChatServiceBase();
          };
          // ---------------------------------------------------------------------------
          // Skype JWT exchange
          // ---------------------------------------------------------------------------
          /** Cached Skype JWT and its expiration time in milliseconds. */
          let cachedSkypeJwt = null;
          /**
           * Get a Skype JWT for the current environment. Three sources, in priority order:
           *
           * 1. Adapter-local cache (avoids redundant lookups within one tool invocation).
           * 2. `skypeJwt` pre-script slot — set by the authsvc fetch interceptor when
           *    Teams itself calls authsvc during startup or token refresh. This is the
           *    primary path for Teams v2, where MSAL tokens are stored encrypted and
           *    cannot be read from localStorage directly.
           * 3. Authsvc exchange — Teams calls authsvc with its MSAL Skype API token. This
           *    path works for classic Teams where the MSAL token is captured in plaintext
           *    from localStorage by the pre-script. Not used for Teams v2 (the MSAL token
           *    is encrypted there).
           */
          const getSkypeJwt = async () => {
              if (cachedSkypeJwt && Date.now() < cachedSkypeJwt.expiresAt - 60_000) {
                  return cachedSkypeJwt.token;
              }
              // Pre-captured JWT from the authsvc fetch interceptor (Teams v2 path).
              const preCapture = readPreScriptValue('skypeJwt');
              if (preCapture?.secret && preCapture.expiresOn > Date.now() / 1000 + 60) {
                  cachedSkypeJwt = { token: preCapture.secret, expiresAt: preCapture.expiresOn * 1000 };
                  return preCapture.secret;
              }
              // Classic Teams fallback: exchange MSAL Skype token via authsvc ourselves.
              const config = getConfig();
              const accessToken = getSkypeAccessToken();
              if (!accessToken) {
                  const env = detectEnvironment();
                  throw ToolError.auth(`Not authenticated — no Skype API access token captured for ${env} Teams. If you just installed this plugin, reload the Teams tab so the pre-script can intercept the token.`);
              }
              let response;
              try {
                  response = await fetch(config.authzUrl, {
                      method: 'POST',
                      headers: {
                          Authorization: `Bearer ${accessToken}`,
                          'Content-Type': 'application/json',
                      },
                      credentials: 'include',
                      signal: AbortSignal.timeout(15_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout('Skype JWT exchange timed out');
                  }
                  throw ToolError.internal(`Skype JWT exchange failed: ${err instanceof Error ? err.message : String(err)}`);
              }
              if (!response.ok) {
                  const body = await response.text().catch(() => '');
                  if (response.status === 401 || response.status === 403) {
                      cachedSkypeJwt = null;
                      throw ToolError.auth(`Skype JWT exchange auth error (${String(response.status)}): ${body.substring(0, 256)}`);
                  }
                  throw ToolError.internal(`Skype JWT exchange error (${String(response.status)}): ${body.substring(0, 256)}`);
              }
              const data = (await response.json());
              // Enterprise returns the JWT in tokens.skypeToken (string);
              // consumer returns it in skypeToken.skypetoken (nested object).
              const jwt = data.tokens?.skypeToken ?? data.skypeToken?.skypetoken;
              if (!jwt) {
                  throw ToolError.internal('Skype JWT exchange returned empty token');
              }
              const expiresIn = data.tokens?.expiresIn ?? data.skypeToken?.expiresIn ?? 3600;
              cachedSkypeJwt = { token: jwt, expiresAt: Date.now() + expiresIn * 1000 };
              return jwt;
          };
          /**
           * Decode a JWT payload without verification (we only need to read claims).
           */
          const decodeJwtPayload = (jwt) => {
              const parts = jwt.split('.');
              if (parts.length < 2)
                  return {};
              try {
                  // base64url payloads are emitted without `=` padding; restore it before
                  // calling atob, which throws InvalidCharacterError on lengths not
                  // divisible by 4.
                  const raw = parts[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
                  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
                  return JSON.parse(atob(padded));
              }
              catch {
                  return {};
              }
          };
          /**
           * Read the sign-in email captured by the pre-script. The pre-script
           * decodes the MSAL ID token's JWT and stashes
           * `preferred_username` / `upn` / `email` under `signInName`.
           * Enterprise authz responses do not include the email, so we depend on
           * the ID token claims for it.
           */
          const findSignInName = () => readPreScriptValue('signInName') ?? '';
          /**
           * Get the current user's Skype identity (MRI and sign-in email) by performing
           * a Skype JWT exchange and reading the identity fields from the response.
           * On enterprise, identity is extracted from the JWT payload and MSAL ID token.
           */
          const getSkypeIdentity = async () => {
              const config = getConfig();
              const accessToken = getSkypeAccessToken();
              if (!accessToken) {
                  const env = detectEnvironment();
                  throw ToolError.auth(`Not authenticated — no Skype API access token captured for ${env} Teams. If you just installed this plugin, reload the Teams tab so the pre-script can intercept the token.`);
              }
              const response = await fetch(config.authzUrl, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  credentials: 'include',
                  signal: AbortSignal.timeout(15_000),
              });
              if (!response.ok) {
                  throw ToolError.auth(`Failed to get identity: HTTP ${String(response.status)}`);
              }
              const data = (await response.json());
              // Consumer returns identity directly in the response
              if (data.skypeToken?.skypeid) {
                  return {
                      skypeid: data.skypeToken.skypeid,
                      signinname: data.skypeToken.signinname ?? '',
                  };
              }
              // Enterprise: decode the JWT to get skypeid, and read email from MSAL ID token
              const jwt = data.tokens?.skypeToken ?? data.skypeToken?.skypetoken ?? '';
              const claims = jwt ? decodeJwtPayload(jwt) : {};
              return {
                  skypeid: String(claims.skypeid ?? ''),
                  signinname: findSignInName(),
              };
          };
          // ---------------------------------------------------------------------------
          // Authentication detection
          // ---------------------------------------------------------------------------
          /**
           * Check if a Loki token (Teams v2 readiness signal) is present and valid.
           * The Loki token indicates the user is logged into Teams v2 but cannot be
           * used for Skype API calls — the actual Skype JWT is captured separately
           * via the authsvc fetch interceptor.
           */
          const hasValidLokiToken = () => {
              const token = readPreScriptValue('lokiToken');
              return !!(token?.secret && token.expiresOn > Date.now() / 1000);
          };
          const isTeamsAuthenticated = () => 
          // Classic Teams: MSAL Skype API token captured from localStorage.
          getSkypeAccessToken() !== null ||
              // Teams v2: Loki token present (user is logged in; Skype JWT captured separately).
              hasValidLokiToken();
          /**
           * Wait for the pre-script to capture an auth signal. On classic Teams the MSAL
           * Skype token is captured at document_start; on Teams v2 the Loki token lands
           * as Teams writes it to sessionStorage during startup. Polls at 500ms intervals
           * for up to 8 seconds.
           */
          const waitForTeamsAuth = () => waitUntil(() => isTeamsAuthenticated(), { interval: 500, timeout: 8000 }).then(() => true, () => false);
          // ---------------------------------------------------------------------------
          // Chat Service API
          // ---------------------------------------------------------------------------
          /**
           * Make an authenticated request to the Teams Chat Service (Skype-based API).
           * Uses the Skype JWT obtained via MSAL token exchange.
           * Automatically routes to the correct endpoint for consumer or enterprise.
           */
          const chatApi = async (endpoint, options = {}) => {
              const skypeJwt = await getSkypeJwt();
              const chatServiceBase = getChatServiceBase();
              const { method = 'GET', body, query } = options;
              let url = `${chatServiceBase}${endpoint}`;
              if (query) {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(query)) {
                      if (value !== undefined)
                          params.append(key, String(value));
                  }
                  const qs = params.toString();
                  if (qs)
                      url += `?${qs}`;
              }
              const headers = {
                  Authentication: `skypetoken=${skypeJwt}`,
                  'Content-Type': 'application/json',
              };
              let response;
              try {
                  response = await fetch(url, {
                      method,
                      headers,
                      body: body ? JSON.stringify(body) : undefined,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout(`Teams Chat API timed out: ${method} ${endpoint}`);
                  }
                  throw ToolError.internal(`Network error calling Teams Chat API: ${err instanceof Error ? err.message : String(err)}`);
              }
              return handleApiResponse(response, method, endpoint);
          };
          /**
           * Create a chat thread via the Chat Service. Returns the thread ID extracted
           * from the Location response header.
           */
          const createThread = async (members, properties) => {
              const skypeJwt = await getSkypeJwt();
              const chatServiceBase = getChatServiceBase();
              const body = { members };
              if (properties)
                  body.properties = properties;
              let response;
              try {
                  response = await fetch(`${chatServiceBase}/v1/threads`, {
                      method: 'POST',
                      headers: {
                          Authentication: `skypetoken=${skypeJwt}`,
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(body),
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout('Teams create thread timed out');
                  }
                  throw ToolError.internal(`Network error creating thread: ${err instanceof Error ? err.message : String(err)}`);
              }
              if (!response.ok) {
                  const errorText = await response.text().catch(() => '');
                  classifyHttpError(response.status, errorText, 'POST', '/v1/threads', response.headers);
              }
              const location = response.headers.get('Location') ?? '';
              const threadId = location.split('/threads/').pop() ?? '';
              if (!threadId) {
                  throw ToolError.internal('Thread created but no thread ID returned in Location header');
              }
              return threadId;
          };
          /**
           * Make an authenticated request to a thread-level endpoint
           * (`/v1/threads/{threadId}/...`). Used for member management and
           * property updates on existing threads.
           */
          const threadApi = async (threadId, subpath, options = {}) => {
              const skypeJwt = await getSkypeJwt();
              const chatServiceBase = getChatServiceBase();
              const { method = 'GET', body } = options;
              const url = `${chatServiceBase}/v1/threads/${encodeURIComponent(threadId)}${subpath}`;
              let response;
              try {
                  response = await fetch(url, {
                      method,
                      headers: {
                          Authentication: `skypetoken=${skypeJwt}`,
                          'Content-Type': 'application/json',
                      },
                      body: body ? JSON.stringify(body) : undefined,
                      credentials: 'include',
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout(`Teams thread API timed out: ${method} ${subpath}`);
                  }
                  throw ToolError.internal(`Network error calling Teams thread API: ${err instanceof Error ? err.message : String(err)}`);
              }
              return handleApiResponse(response, method, subpath);
          };
          // ---------------------------------------------------------------------------
          // Shared response handling
          // ---------------------------------------------------------------------------
          const handleApiResponse = async (response, method, endpoint) => {
              if (!response.ok) {
                  const errorText = await response.text().catch(() => '');
                  classifyHttpError(response.status, errorText, method, endpoint, response.headers);
              }
              if (response.status === 204 || response.headers.get('content-length') === '0') {
                  return {};
              }
              let data;
              try {
                  data = await response.json();
              }
              catch {
                  throw ToolError.internal(`Teams API returned invalid JSON: ${method} ${endpoint}`);
              }
              return data;
          };
          /** Clear all module-level caches so the next API call re-discovers fresh values. */
          const clearCaches = () => {
              cachedEnterpriseChatServiceBase = null;
              cachedSkypeJwt = null;
          };
          /** Classify HTTP errors into ToolError categories. Always throws. */
          const classifyHttpError = (status, errorText, method, endpoint, headers) => {
              const errorBody = errorText.substring(0, 512);
              if (status === 429) {
                  const retryAfterHeader = headers.get('Retry-After');
                  const retryMs = retryAfterHeader !== null ? parseRetryAfterMs(retryAfterHeader) : undefined;
                  throw ToolError.rateLimited(`Teams API rate limited: ${method} ${endpoint} — ${errorBody}`, retryMs);
              }
              if (status === 401 || status === 403) {
                  cachedSkypeJwt = null;
                  throw ToolError.auth(`Teams API auth error (${String(status)}): ${errorBody}`);
              }
              if (status === 404) {
                  throw ToolError.notFound(`Teams API not found: ${method} ${endpoint} — ${errorBody}`);
              }
              if (status === 400) {
                  throw ToolError.validation(`Teams API bad request: ${method} ${endpoint} — ${errorBody}`);
              }
              throw ToolError.internal(`Teams API error (${String(status)}): ${method} ${endpoint} — ${errorBody}`);
          };

          // ---------------------------------------------------------------------------
          // Conversation (chat) schema
          // ---------------------------------------------------------------------------
          const conversationSchema = z.object({
              id: z.string().describe('Conversation/thread ID'),
              topic: z.string().describe('Chat name/topic (empty for unnamed 1:1 chats)'),
              type: z.string().describe('Conversation type (e.g., "Conversation")'),
              thread_type: z.string().describe('Thread type (e.g., "chat", "meeting", "space")'),
              member_count: z.string().describe('Number of members in the conversation'),
              created_at: z.string().describe('When the conversation was created (ISO 8601)'),
              last_message_content: z.string().describe('Content of the last message'),
              last_message_type: z.string().describe('Message type of the last message'),
              last_message_time: z.string().describe('Timestamp of the last message'),
              last_message_from: z.string().describe('Display name of the last message sender'),
              version: z.number().describe('Conversation version'),
          });
          const mapConversation = (c) => ({
              id: c.id ?? '',
              topic: String(c.threadProperties?.topic ?? ''),
              type: c.type ?? '',
              thread_type: String(c.threadProperties?.threadType ?? ''),
              member_count: String(c.threadProperties?.memberCount ?? ''),
              created_at: String(c.threadProperties?.createdat ?? ''),
              last_message_content: String(c.lastMessage?.content ?? ''),
              last_message_type: String(c.lastMessage?.messagetype ?? ''),
              last_message_time: String(c.lastMessage?.composetime ?? ''),
              last_message_from: String(c.lastMessage?.imdisplayname ?? ''),
              version: typeof c.version === 'number' ? c.version : 0,
          });
          // ---------------------------------------------------------------------------
          // Mention schema
          // ---------------------------------------------------------------------------
          const mentionSchema = z.object({
              mri: z.string().describe('Mentioned user MRI (e.g., "8:orgid:...")'),
              display_name: z.string().describe('Display name of the mentioned user'),
          });
          // ---------------------------------------------------------------------------
          // File attachment schema
          // ---------------------------------------------------------------------------
          const fileSchema = z.object({
              title: z.string().describe('File name'),
              type: z.string().describe('File type (e.g., "image/png", "application/pdf")'),
              url: z.string().describe('File download URL'),
          });
          // ---------------------------------------------------------------------------
          // Message schema
          // ---------------------------------------------------------------------------
          const messageSchema = z.object({
              id: z.string().describe('Message ID (timestamp-based)'),
              client_message_id: z.string().describe('Client-assigned message ID'),
              content: z.string().describe('Message content (may contain HTML)'),
              message_type: z.string().describe('Message type (e.g., "RichText/Html", "Text")'),
              from: z.string().describe('Sender MRI (e.g., "8:orgid:username")'),
              display_name: z.string().describe('Sender display name'),
              compose_time: z.string().describe('When the message was composed (ISO 8601)'),
              conversation_id: z.string().describe('ID of the conversation this message belongs to'),
              mentions: z.array(mentionSchema).describe('Users mentioned in this message'),
              files: z.array(fileSchema).describe('Files attached to this message'),
              reactions: z.array(z.string()).describe('Reaction emoji keys on this message (e.g., ["like", "heart"])'),
          });
          /** Extract the MRI (e.g., "8:live:username") from a full contact URL. */
          const extractMri = (from) => {
              const match = /\/contacts\/(.+)$/.exec(from);
              return match?.[1] ?? from;
          };
          /** Parse mentions from the serialized JSON string in properties.mentions. */
          const parseMentions = (raw) => {
              if (!raw)
                  return [];
              try {
                  const arr = JSON.parse(raw);
                  return arr.map(m => ({ mri: m.mri ?? '', display_name: m.displayName ?? '' }));
              }
              catch {
                  return [];
              }
          };
          /** Parse files from the serialized JSON string in properties.files. */
          const parseFiles = (raw) => {
              if (!raw)
                  return [];
              try {
                  const arr = JSON.parse(raw);
                  return arr.map(f => ({ title: f.title ?? '', type: f.type ?? '', url: f.objectUrl ?? '' }));
              }
              catch {
                  return [];
              }
          };
          /** Extract unique reaction keys from emotions/annotationsSummary. */
          const parseReactions = (msg) => {
              const emotions = msg.properties?.emotions ?? msg.annotationsSummary?.emotions ?? [];
              const keys = new Set();
              for (const e of emotions) {
                  if (e.key)
                      keys.add(e.key);
              }
              return [...keys];
          };
          const mapMessage = (m) => ({
              id: m.id ?? '',
              client_message_id: m.clientmessageid ?? '',
              content: m.content ?? '',
              message_type: m.messagetype ?? '',
              from: extractMri(m.from ?? ''),
              display_name: m.imdisplayname ?? '',
              compose_time: m.composetime ?? '',
              conversation_id: m.conversationid ?? '',
              mentions: parseMentions(m.properties?.mentions),
              files: parseFiles(m.properties?.files),
              reactions: parseReactions(m),
          });

          "use strict";
          (() => {
            // dist/_pre_script_setup_874c7df7-cbf2-4615-8b9b-c2a90736e561.ts
            if (!globalThis.__openTabs) {
              globalThis.__openTabs = {};
            }
            var _ot = globalThis.__openTabs;
            if (!_ot.preScript) {
              _ot.preScript = {};
            }
            _ot.preScript["teams"] = {};
            var _logPrefix = "[opentabs:teams:pre-script]";
            var _log = {
              debug: (...args) => {
                console.debug(_logPrefix, ...args);
              },
              info: (...args) => {
                console.info(_logPrefix, ...args);
              },
              warn: (...args) => {
                console.warn(_logPrefix, ...args);
              },
              error: (...args) => {
                console.error(_logPrefix, ...args);
              }
            };
            _ot._preScriptRunner = (fn) => {
              delete _ot._preScriptRunner;
              const ctx = {
                set(key, value) {
                  _ot.preScript["teams"][key] = value;
                },
                log: _log
              };
              try {
                fn(ctx);
              } catch (e) {
                console.error(_logPrefix, "pre-script threw:", e);
              }
            };

            // node_modules/@opentabs-dev/plugin-sdk/dist/pre-script.js
            var definePreScript = (fn) => {
              const ot = globalThis.__openTabs;
              ot?._preScriptRunner?.(fn);
            };

            // src/pre-script.ts
            definePreScript(({ set, log }) => {
              const SKYPE_HOST_PATTERN = /spaces\.skype\.com/i;
              const AUTHSVC_PATTERN = /\/authsvc\/v1\.0\/authz|\/auth\/v1\.0\/authz/;
              const decodeJwtClaims = (jwt) => {
                const parts = jwt.split(".");
                if (parts.length < 2) return null;
                try {
                  const raw = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
                  const padded = raw + "=".repeat((4 - raw.length % 4) % 4);
                  return JSON.parse(atob(padded));
                } catch {
                  return null;
                }
              };
              const inspect = (value) => {
                if (typeof value !== "string" || value.length < 32) return;
                let parsed;
                try {
                  parsed = JSON.parse(value);
                } catch {
                  return;
                }
                if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
                const entry = parsed;
                const credentialType = String(entry.credentialType ?? "").toLowerCase();
                const secret = typeof entry.secret === "string" ? entry.secret : "";
                if (!secret) return;
                if (credentialType === "accesstoken") {
                  const target = String(entry.target ?? "");
                  if (!SKYPE_HOST_PATTERN.test(target)) return;
                  const expiresOn = Number.parseInt(String(entry.expiresOn ?? "0"), 10);
                  if (!Number.isFinite(expiresOn) || expiresOn <= Date.now() / 1e3) return;
                  const captured = { secret, expiresOn };
                  const slot = window.location.hostname === "teams.live.com" ? "consumerToken" : "enterpriseToken";
                  set(slot, captured);
                  log.debug(`[teams] captured ${slot}`);
                  return;
                }
                if (credentialType === "idtoken") {
                  const claims = decodeJwtClaims(secret);
                  if (!claims) return;
                  const signInName = String(claims.preferred_username ?? claims.upn ?? claims.email ?? "");
                  if (signInName) {
                    set("signInName", signInName);
                    log.debug("[teams] captured sign-in name from ID token");
                  }
                }
              };
              const inspectLokiEntry = (key, value) => {
                if (!key.startsWith("LokiAuthToken") || key.startsWith("EXPLoki")) return;
                if (typeof value !== "string" || !value.startsWith("eyJ")) return;
                if (typeof window !== "undefined" && window.location.hostname === "teams.live.com") return;
                const claims = decodeJwtClaims(value);
                if (!claims) return;
                const expiresOn = typeof claims.exp === "number" ? claims.exp : 0;
                if (!expiresOn || expiresOn <= Date.now() / 1e3) return;
                set("lokiToken", { secret: value, expiresOn });
                log.debug("[teams] captured lokiToken from LokiAuthToken (readiness signal)");
              };
              const FETCH_MARKER = "__opentabsTeamsFetchPatched";
              const winAny = window;
              if (!winAny[FETCH_MARKER]) {
                const realFetch = window.fetch.bind(window);
                window.fetch = function patchedFetch(input, init) {
                  const url = input instanceof Request ? input.url : String(input);
                  if (AUTHSVC_PATTERN.test(url)) {
                    return realFetch(input, init).then((response) => {
                      if (response.ok) {
                        response.clone().json().then((data) => {
                          if (!data || typeof data !== "object") return;
                          const d = data;
                          const tokens = d.tokens;
                          const entJwt = typeof tokens?.skypeToken === "string" ? tokens.skypeToken : null;
                          if (entJwt) {
                            const expiresIn = typeof tokens?.expiresIn === "number" ? tokens.expiresIn : 3600;
                            set("skypeJwt", {
                              secret: entJwt,
                              expiresOn: Math.floor(Date.now() / 1e3) + expiresIn
                            });
                            log.debug("[teams] captured Skype JWT from authsvc response");
                            return;
                          }
                          const skypeToken = d.skypeToken;
                          const conJwt = typeof skypeToken?.skypetoken === "string" ? skypeToken.skypetoken : null;
                          if (conJwt) {
                            const expiresIn = typeof skypeToken?.expiresIn === "number" ? skypeToken.expiresIn : 3600;
                            set("skypeJwt", {
                              secret: conJwt,
                              expiresOn: Math.floor(Date.now() / 1e3) + expiresIn
                            });
                            log.debug("[teams] captured Skype JWT from authsvc response (consumer)");
                          }
                        }).catch(() => {
                        });
                      }
                      return response;
                    });
                  }
                  return realFetch(input, init);
                };
                winAny[FETCH_MARKER] = true;
              }
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (!key) continue;
                  const val = localStorage.getItem(key);
                  if (val) inspect(val);
                }
              } catch {
              }
              try {
                for (let i = 0; i < sessionStorage.length; i++) {
                  const key = sessionStorage.key(i);
                  if (!key) continue;
                  const val = sessionStorage.getItem(key);
                  if (val) inspectLokiEntry(key, val);
                }
              } catch {
              }
              const PATCH_MARKER = "__opentabsTeamsSetItemPatched";
              const proto = Storage.prototype;
              if (!proto[PATCH_MARKER]) {
                const realSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function patchedSetItem(key, value) {
                  try {
                    if (this === localStorage) inspect(value);
                    if (this === sessionStorage) inspectLokiEntry(key, value);
                  } catch {
                  }
                  return realSetItem.call(this, key, value);
                };
                proto[PATCH_MARKER] = true;
              }
              log.info("[teams] MSAL cache observer + authsvc interceptor installed");
            });
          })();

          /**
           * Pre-script for the Teams plugin.
           *
           * Runs at document_start in MAIN world, strictly before any page script.
           * Three token capture paths run in parallel:
           *
           * 1. **MSAL localStorage observer** — scans existing localStorage entries and
           *    hooks `Storage.prototype.setItem` to catch future writes. Recognises MSAL
           *    credential entries by their *value* shape (`credentialType`, `target`,
           *    `secret`, `expiresOn`). Works for classic Teams (`teams.microsoft.com`
           *    without `/v2/`), where MSAL stores tokens in plaintext.
           *
           * 2. **Loki token observer** — hooks `sessionStorage.setItem` to capture the
           *    raw `LokiAuthToken` JWT that Teams v2 (`teams.microsoft.com/v2/`) stores
           *    in sessionStorage. Used only as a readiness signal (`isReady()`); its
           *    audience (`394866fc-…`) is not accepted by the Skype authz endpoint.
           *
           * 3. **authsvc fetch interceptor** — wraps `window.fetch` to intercept Teams'
           *    own POST to `/api/authsvc/v1.0/authz` (and the consumer equivalent). When
           *    Teams exchanges its MSAL Skype token for a Skype JWT during startup, we
           *    clone the response body and stash the resulting JWT under `skypeJwt`. The
           *    adapter reads this directly, bypassing the need for its own authsvc call.
           *    This is the primary auth path for Teams v2, where MSAL tokens are stored
           *    encrypted and cannot be read from localStorage directly.
           *
           * Adapter reads via `getPreScriptValue` keys:
           *   - `consumerToken`  → { secret, expiresOn } MSAL Skype token for teams.live.com
           *   - `enterpriseToken`→ { secret, expiresOn } MSAL Skype token for teams.microsoft.com
           *   - `lokiToken`      → { secret, expiresOn } LokiAuthToken (readiness signal only)
           *   - `skypeJwt`       → { secret, expiresOn } Skype JWT captured from authsvc response
           *   - `signInName`     → preferred_username / upn / email from the ID token
           */
          definePreScript(({ set, log }) => {
              const SKYPE_HOST_PATTERN = /spaces\.skype\.com/i;
              const AUTHSVC_PATTERN = /\/authsvc\/v1\.0\/authz|\/auth\/v1\.0\/authz/;
              const decodeJwtClaims = (jwt) => {
                  const parts = jwt.split('.');
                  if (parts.length < 2)
                      return null;
                  try {
                      // base64url payloads are emitted without `=` padding; restore it before
                      // calling atob, which throws InvalidCharacterError on lengths not
                      // divisible by 4.
                      const raw = (parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
                      const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
                      return JSON.parse(atob(padded));
                  }
                  catch {
                      return null;
                  }
              };
              // ---------------------------------------------------------------------------
              // Path 1: MSAL localStorage observer (classic Teams)
              // ---------------------------------------------------------------------------
              /**
               * Inspect a single localStorage value. If it parses as an MSAL credential
               * cache entry of interest, stash the relevant pieces.
               */
              const inspect = (value) => {
                  if (typeof value !== 'string' || value.length < 32)
                      return;
                  let parsed;
                  try {
                      parsed = JSON.parse(value);
                  }
                  catch {
                      return;
                  }
                  // MSAL credential entries are JSON objects. Anything else (null, primitives,
                  // arrays) is unrelated cache content; bail before property access so a stray
                  // `null` value can't throw and abort the initial-scan loop.
                  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                      return;
                  const entry = parsed;
                  const credentialType = String(entry.credentialType ?? '').toLowerCase();
                  const secret = typeof entry.secret === 'string' ? entry.secret : '';
                  if (!secret)
                      return;
                  if (credentialType === 'accesstoken') {
                      const target = String(entry.target ?? '');
                      if (!SKYPE_HOST_PATTERN.test(target))
                          return;
                      const expiresOn = Number.parseInt(String(entry.expiresOn ?? '0'), 10);
                      if (!Number.isFinite(expiresOn) || expiresOn <= Date.now() / 1000)
                          return;
                      const captured = { secret, expiresOn };
                      // Route by current page hostname so the slot we write matches the
                      // adapter's detectEnvironment() (which also keys off hostname).
                      const slot = window.location.hostname === 'teams.live.com' ? 'consumerToken' : 'enterpriseToken';
                      set(slot, captured);
                      log.debug(`[teams] captured ${slot}`);
                      return;
                  }
                  if (credentialType === 'idtoken') {
                      const claims = decodeJwtClaims(secret);
                      if (!claims)
                          return;
                      const signInName = String(claims.preferred_username ?? claims.upn ?? claims.email ?? '');
                      if (signInName) {
                          set('signInName', signInName);
                          // Don't log the value — preferred_username / upn / email is PII.
                          log.debug('[teams] captured sign-in name from ID token');
                      }
                  }
              };
              // ---------------------------------------------------------------------------
              // Path 2: Loki token observer (Teams v2 readiness signal)
              // ---------------------------------------------------------------------------
              /**
               * Teams v2 (teams.microsoft.com/v2/) stores a Loki bearer token as a raw JWT
               * string in sessionStorage under the key `LokiAuthToken`. This token is used
               * only as a readiness signal — its audience is the Loki service, not the
               * Skype API, so it cannot be used directly for authsvc or chat APIs. The Skype
               * JWT is captured separately via the authsvc fetch interceptor (Path 3).
               */
              const inspectLokiEntry = (key, value) => {
                  if (!key.startsWith('LokiAuthToken') || key.startsWith('EXPLoki'))
                      return;
                  if (typeof value !== 'string' || !value.startsWith('eyJ'))
                      return;
                  // LokiAuthToken is enterprise-only (teams.microsoft.com), not consumer.
                  if (typeof window !== 'undefined' && window.location.hostname === 'teams.live.com')
                      return;
                  const claims = decodeJwtClaims(value);
                  if (!claims)
                      return;
                  const expiresOn = typeof claims.exp === 'number' ? claims.exp : 0;
                  if (!expiresOn || expiresOn <= Date.now() / 1000)
                      return;
                  set('lokiToken', { secret: value, expiresOn });
                  log.debug('[teams] captured lokiToken from LokiAuthToken (readiness signal)');
              };
              // ---------------------------------------------------------------------------
              // Path 3: authsvc fetch interceptor (Teams v2 Skype JWT)
              // ---------------------------------------------------------------------------
              /**
               * Wrap window.fetch to intercept Teams' own POST to the authsvc endpoint.
               * When Teams exchanges its encrypted MSAL Skype token for a Skype JWT during
               * startup, we clone the successful response body and stash the JWT under
               * `skypeJwt`. This fires for every authsvc call (initial + token refreshes),
               * keeping the cached JWT fresh without any separate polling.
               *
               * The interceptor runs in MAIN world at document_start, before any Teams JS,
               * so it is guaranteed to be in place for the startup authsvc call.
               */
              const FETCH_MARKER = '__opentabsTeamsFetchPatched';
              const winAny = window;
              if (!winAny[FETCH_MARKER]) {
                  const realFetch = window.fetch.bind(window);
                  window.fetch = function patchedFetch(input, init) {
                      const url = input instanceof Request ? input.url : String(input);
                      if (AUTHSVC_PATTERN.test(url)) {
                          return realFetch(input, init).then(response => {
                              if (response.ok) {
                                  response
                                      .clone()
                                      .json()
                                      .then((data) => {
                                      if (!data || typeof data !== 'object')
                                          return;
                                      const d = data;
                                      // Enterprise format: { tokens: { skypeToken: string, expiresIn: number } }
                                      const tokens = d.tokens;
                                      const entJwt = typeof tokens?.skypeToken === 'string' ? tokens.skypeToken : null;
                                      if (entJwt) {
                                          const expiresIn = typeof tokens?.expiresIn === 'number' ? tokens.expiresIn : 3600;
                                          set('skypeJwt', {
                                              secret: entJwt,
                                              expiresOn: Math.floor(Date.now() / 1000) + expiresIn,
                                          });
                                          log.debug('[teams] captured Skype JWT from authsvc response');
                                          return;
                                      }
                                      // Consumer format: { skypeToken: { skypetoken: string, expiresIn: number } }
                                      const skypeToken = d.skypeToken;
                                      const conJwt = typeof skypeToken?.skypetoken === 'string' ? skypeToken.skypetoken : null;
                                      if (conJwt) {
                                          const expiresIn = typeof skypeToken?.expiresIn === 'number' ? skypeToken.expiresIn : 3600;
                                          set('skypeJwt', {
                                              secret: conJwt,
                                              expiresOn: Math.floor(Date.now() / 1000) + expiresIn,
                                          });
                                          log.debug('[teams] captured Skype JWT from authsvc response (consumer)');
                                      }
                                  })
                                      .catch(() => {
                                      // Never block the page on JSON parse failure.
                                  });
                              }
                              return response;
                          });
                      }
                      return realFetch(input, init);
                  };
                  winAny[FETCH_MARKER] = true;
              }
              // ---------------------------------------------------------------------------
              // Initial scans
              // ---------------------------------------------------------------------------
              // localStorage: MSAL credential entries (classic Teams, Path 1).
              try {
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key)
                          continue;
                      const val = localStorage.getItem(key);
                      if (val)
                          inspect(val);
                  }
              }
              catch {
                  // localStorage access can throw under sandboxing; ignore.
              }
              // sessionStorage: LokiAuthToken JWT (Teams v2, Path 2).
              try {
                  for (let i = 0; i < sessionStorage.length; i++) {
                      const key = sessionStorage.key(i);
                      if (!key)
                          continue;
                      const val = sessionStorage.getItem(key);
                      if (val)
                          inspectLokiEntry(key, val);
                  }
              }
              catch {
                  // sessionStorage access can throw under sandboxing; ignore.
              }
              // ---------------------------------------------------------------------------
              // setItem hooks (Path 1 + Path 2)
              // ---------------------------------------------------------------------------
              // Idempotent: if the prototype is already patched (re-injection during
              // dev hot reload, future iframe-realm reuse, etc.), skip rather than
              // stack wrappers.
              const PATCH_MARKER = '__opentabsTeamsSetItemPatched';
              const proto = Storage.prototype;
              if (!proto[PATCH_MARKER]) {
                  const realSetItem = Storage.prototype.setItem;
                  Storage.prototype.setItem = function patchedSetItem(key, value) {
                      try {
                          if (this === localStorage)
                              inspect(value);
                          if (this === sessionStorage)
                              inspectLokiEntry(key, value);
                      }
                      catch {
                          // Never break the page if our observer throws.
                      }
                      return realSetItem.call(this, key, value);
                  };
                  proto[PATCH_MARKER] = true;
              }
              log.info('[teams] MSAL cache observer + authsvc interceptor installed');
          });

          const addMember = defineTool({
              name: 'invite_to_channel',
              displayName: 'Invite to Channel',
              description: 'Add a user to a Teams group chat by their MRI identifier (e.g., "8:live:username").',
              summary: 'Add a user to a group chat',
              icon: 'user-plus',
              group: 'Members',
              input: z.object({
                  conversation_id: z.string().min(1).describe('Conversation/thread ID'),
                  user: z.string().min(1).describe('User MRI to add (e.g., "8:live:username")'),
              }),
              output: z.object({
                  success: z.boolean().describe('Whether the member was added'),
              }),
              handle: async (params) => {
                  await threadApi(params.conversation_id, `/members/${encodeURIComponent(params.user)}`, {
                      method: 'PUT',
                      body: { role: 'User' },
                  });
                  return { success: true };
              },
          });
          const createChat = defineTool({
              name: 'create_chat',
              displayName: 'Create Chat',
              description: 'Create a new chat conversation with one or more users. Pass user MRIs (e.g., "8:live:username") as members. The current user is added automatically.',
              summary: 'Create a new chat conversation',
              icon: 'plus-circle',
              group: 'Chats',
              input: z.object({
                  members: z
                      .array(z.string().min(1))
                      .min(1)
                      .describe('User MRI identifiers to add to the chat (e.g., ["8:live:username"])'),
                  topic: z.string().optional().describe('Optional chat topic/title'),
              }),
              output: z.object({
                  conversation_id: z.string().describe('The created conversation/thread ID'),
              }),
              handle: async (params) => {
                  const members = params.members.map(id => ({ id, role: 'User' }));
                  const properties = {
                      threadType: 'chat',
                      chatFilesIndexId: `uniqueid_${Date.now()}`,
                  };
                  if (params.topic) {
                      properties.topic = params.topic;
                  }
                  const threadId = await createThread(members, properties);
                  return { conversation_id: threadId };
              },
          });
                    const waitForAuth = waitForTeamsAuth;

                    const refreshAuth = waitForTeamsAuth;



                    var pluginTool = createChat

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
                      var productProbe = PRODUCT_HOSTS['teams'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Teams page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)teams\\.(microsoft|live)\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Teams page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Teams page.')
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
            async create_chat(args) {
              return runTool('create_chat', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['create_chat'](args)
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
            'The Microsoft Teams tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Microsoft Teams API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Microsoft Teams tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
