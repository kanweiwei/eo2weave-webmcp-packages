// Self-contained adapter workflow. The Microsoft OneNote session and every same-origin
// API call stay inside the Microsoft OneNote tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "notebook_id": {
        "type": "string",
        "minLength": 1,
        "description": "Notebook ID to create the section in"
      },
      "display_name": {
        "type": "string",
        "minLength": 1,
        "description": "Name for the new section"
      }
    },
    "required": [
      "notebook_id",
      "display_name"
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
    description: 'create_section',
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

          const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
          // MSAL client ID used by the OneNote web app
          const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';
          /**
           * Extracts the Microsoft Graph access token from MSAL localStorage entries.
           * The OneNote web app stores MSAL tokens in localStorage with keys containing
           * "accesstoken" and the target resource URL.
           */
          const extractMsalToken = () => {
              // Find the token keys entry for this MSAL client
              const tokenKeysEntry = findLocalStorageEntry(key => key === `msal.token.keys.${MSAL_CLIENT_ID}`);
              if (!tokenKeysEntry)
                  return null;
              let tokenKeys;
              try {
                  tokenKeys = JSON.parse(tokenKeysEntry.value);
              }
              catch {
                  return null;
              }
              // Look for a Graph API access token
              const graphKey = tokenKeys.accessToken?.find(k => /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(k) || k.includes('notes.create'));
              if (!graphKey)
                  return null;
              const entryStr = findLocalStorageEntry(key => key === graphKey);
              if (!entryStr)
                  return null;
              let entry;
              try {
                  entry = JSON.parse(entryStr.value);
              }
              catch {
                  return null;
              }
              if (!entry.secret)
                  return null;
              // Check expiration
              const expiresOn = Number(entry.expiresOn ?? 0);
              const nowSeconds = Math.floor(Date.now() / 1000);
              if (expiresOn > 0 && expiresOn < nowSeconds)
                  return null;
              return entry.secret;
          };
          const getAuth = () => {
              const cached = getAuthCache('onenote');
              if (cached && cached.expiresOn > Math.floor(Date.now() / 1000))
                  return cached;
              const token = extractMsalToken();
              if (!token)
                  return null;
              const auth = {
                  token,
                  expiresOn: Math.floor(Date.now() / 1000) + 3600,
              };
              setAuthCache('onenote', auth);
              return auth;
          };
          const isAuthenticated = () => getAuth() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          /**
           * Calls the Microsoft Graph API for OneNote operations.
           * Auth is via MSAL bearer tokens extracted from localStorage.
           */
          const api = async (endpoint, options = {}) => {
              const auth = getAuth();
              if (!auth) {
                  clearAuthCache('onenote');
                  throw ToolError.auth('Not authenticated — please log in to Microsoft OneNote.');
              }
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;
              const headers = {
                  Authorization: `Bearer ${auth.token}`,
              };
              let fetchBody;
              if (options.body) {
                  if (typeof options.body === 'string') {
                      headers['Content-Type'] = options.contentType ?? 'text/html';
                      fetchBody = options.body;
                  }
                  else {
                      headers['Content-Type'] = 'application/json';
                      fetchBody = JSON.stringify(options.body);
                  }
              }
              let response;
              try {
                  response = await fetch(url, {
                      method: options.method ?? 'GET',
                      headers,
                      body: fetchBody,
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError')
                      throw ToolError.timeout(`API request timed out: ${endpoint}`);
                  if (err instanceof DOMException && err.name === 'AbortError')
                      throw new ToolError('Request was aborted', 'aborted');
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
                      clearAuthCache('onenote');
                      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
                  }
                  if (response.status === 404)
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  if (response.status === 400 || response.status === 422)
                      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              return (await response.json());
          };

          // --- Identity info (shared by createdBy / lastModifiedBy) ---
          const identitySchema = z.object({
              id: z.string().describe('User ID'),
              display_name: z.string().describe('User display name'),
          });
          const mapIdentity = (i) => ({
              id: i?.user?.id ?? '',
              display_name: i?.user?.displayName ?? '',
          });
          // --- Notebook ---
          const notebookSchema = z.object({
              id: z.string().describe('Notebook ID'),
              display_name: z.string().describe('Notebook name'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              last_modified_at: z.string().describe('ISO 8601 last modified timestamp'),
              is_default: z.boolean().describe('Whether this is the default notebook'),
              is_shared: z.boolean().describe('Whether the notebook is shared'),
              user_role: z.string().describe('User role (e.g., Owner, Contributor, Reader)'),
              sections_url: z.string().describe('URL to list sections in this notebook'),
              section_groups_url: z.string().describe('URL to list section groups in this notebook'),
              created_by: identitySchema.describe('User who created the notebook'),
              last_modified_by: identitySchema.describe('User who last modified the notebook'),
              web_url: z.string().describe('URL to open the notebook in OneNote Online'),
          });
          const mapNotebook = (n) => ({
              id: n.id ?? '',
              display_name: n.displayName ?? '',
              created_at: n.createdDateTime ?? '',
              last_modified_at: n.lastModifiedDateTime ?? '',
              is_default: n.isDefault ?? false,
              is_shared: n.isShared ?? false,
              user_role: n.userRole ?? '',
              sections_url: n.sectionsUrl ?? '',
              section_groups_url: n.sectionGroupsUrl ?? '',
              created_by: mapIdentity(n.createdBy),
              last_modified_by: mapIdentity(n.lastModifiedBy),
              web_url: n.links?.oneNoteWebUrl?.href ?? '',
          });
          // --- Recent Notebook ---
          const recentNotebookSchema = z.object({
              display_name: z.string().describe('Notebook name'),
              last_accessed_time: z.string().describe('ISO 8601 timestamp of last access'),
              source_service: z.string().describe('Source service (e.g., OneDriveForBusiness, OneDrive)'),
              web_url: z.string().describe('URL to open the notebook in OneNote Online'),
          });
          const mapRecentNotebook = (n) => ({
              display_name: n.displayName ?? '',
              last_accessed_time: n.lastAccessedTime ?? '',
              source_service: n.sourceService ?? '',
              web_url: n.links?.oneNoteWebUrl?.href ?? '',
          });
          // --- Section ---
          const sectionSchema = z.object({
              id: z.string().describe('Section ID'),
              display_name: z.string().describe('Section name'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              last_modified_at: z.string().describe('ISO 8601 last modified timestamp'),
              is_default: z.boolean().describe('Whether this is the default section'),
              pages_url: z.string().describe('URL to list pages in this section'),
              parent_notebook_id: z.string().describe('Parent notebook ID'),
              parent_notebook_name: z.string().describe('Parent notebook display name'),
              created_by: identitySchema.describe('User who created the section'),
              last_modified_by: identitySchema.describe('User who last modified the section'),
          });
          const mapSection = (s) => ({
              id: s.id ?? '',
              display_name: s.displayName ?? '',
              created_at: s.createdDateTime ?? '',
              last_modified_at: s.lastModifiedDateTime ?? '',
              is_default: s.isDefault ?? false,
              pages_url: s.pagesUrl ?? '',
              parent_notebook_id: s.parentNotebook?.id ?? '',
              parent_notebook_name: s.parentNotebook?.displayName ?? '',
              created_by: mapIdentity(s.createdBy),
              last_modified_by: mapIdentity(s.lastModifiedBy),
          });
          // --- Section Group ---
          const sectionGroupSchema = z.object({
              id: z.string().describe('Section group ID'),
              display_name: z.string().describe('Section group name'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              last_modified_at: z.string().describe('ISO 8601 last modified timestamp'),
              sections_url: z.string().describe('URL to list sections in this group'),
              section_groups_url: z.string().describe('URL to list nested section groups'),
              parent_notebook_id: z.string().describe('Parent notebook ID'),
              parent_notebook_name: z.string().describe('Parent notebook display name'),
              created_by: identitySchema.describe('User who created the section group'),
              last_modified_by: identitySchema.describe('User who last modified the section group'),
          });
          const mapSectionGroup = (sg) => ({
              id: sg.id ?? '',
              display_name: sg.displayName ?? '',
              created_at: sg.createdDateTime ?? '',
              last_modified_at: sg.lastModifiedDateTime ?? '',
              sections_url: sg.sectionsUrl ?? '',
              section_groups_url: sg.sectionGroupsUrl ?? '',
              parent_notebook_id: sg.parentNotebook?.id ?? '',
              parent_notebook_name: sg.parentNotebook?.displayName ?? '',
              created_by: mapIdentity(sg.createdBy),
              last_modified_by: mapIdentity(sg.lastModifiedBy),
          });
          // --- Page (create response) ---
          const pageSchema = z.object({
              id: z.string().describe('Page ID'),
              title: z.string().describe('Page title'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              last_modified_at: z.string().describe('ISO 8601 last modified timestamp'),
              web_url: z.string().describe('URL to open the page in OneNote Online'),
              content_url: z.string().describe('URL to retrieve the page HTML content'),
              parent_section_id: z.string().describe('Parent section ID'),
          });
          const mapPage = (p) => ({
              id: p.id ?? '',
              title: p.title ?? '',
              created_at: p.createdDateTime ?? '',
              last_modified_at: p.lastModifiedDateTime ?? '',
              web_url: p.links?.oneNoteWebUrl?.href ?? '',
              content_url: p.contentUrl ?? '',
              parent_section_id: p.parentSection?.id ?? '',
          });
          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              display_name: z.string().describe('Full display name'),
              email: z.string().describe('Email address'),
              given_name: z.string().describe('First name'),
              surname: z.string().describe('Last name'),
              preferred_language: z.string().describe('Preferred language code (e.g., en-US)'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              display_name: u.displayName ?? '',
              email: u.mail ?? u.userPrincipalName ?? '',
              given_name: u.givenName ?? '',
              surname: u.surname ?? '',
              preferred_language: u.preferredLanguage ?? '',
          });
          const createSection = defineTool({
              name: 'create_section',
              displayName: 'Create Section',
              description: 'Create a new section in a OneNote notebook. Sections contain pages and are the primary organizational unit within a notebook.',
              summary: 'Create a new section in a notebook',
              icon: 'layers-3',
              group: 'Sections',
              input: z.object({
                  notebook_id: z.string().min(1).describe('Notebook ID to create the section in'),
                  display_name: z.string().min(1).describe('Name for the new section'),
              }),
              output: z.object({
                  section: sectionSchema.describe('Created section'),
              }),
              handle: async (params) => {
                  const data = await api(`/me/onenote/notebooks/${params.notebook_id}/sections`, {
                      method: 'POST',
                      body: { displayName: params.display_name },
                  });
                  return { section: mapSection(data) };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = createSection

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
                      var productProbe = PRODUCT_HOSTS['onenote'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft OneNote page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)onenote\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft OneNote page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft OneNote page.')
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
            async create_section(args) {
              return runTool('create_section', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['create_section'](args)
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
            'The Microsoft OneNote tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Microsoft OneNote API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Microsoft OneNote tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
