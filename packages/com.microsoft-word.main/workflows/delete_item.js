// Self-contained adapter workflow. The Microsoft Word session and every same-origin
// API call stay inside the Microsoft Word tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "item_id": {
        "type": "string",
        "description": "ID of the file or folder to delete"
      }
    },
    "required": [
      "item_id"
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
    description: 'delete_item',
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
          // Microsoft 365 consumer app MSAL client ID
          const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';
          /** localStorage key the pre-script mirrors the captured Graph token to. */
          const LS_TOKEN_KEY = '__opentabs_word_graph_token';
          /**
           * Read a value the pre-script stashed under the `microsoft-word` namespace.
           *
           * `getPreScriptValue` depends on `globalThis.__openTabs._pluginName`, which the
           * adapter only binds during tool dispatch — so it returns `undefined` in
           * `isReady()`, which runs earlier. We try the SDK helper first (forward-compat),
           * then fall back to a direct read against the documented namespace path.
           */
          const readPreScriptValue = (key) => {
              const viaSdk = getPreScriptValue(key);
              if (viaSdk !== undefined)
                  return viaSdk;
              const ns = globalThis.__openTabs
                  ?.preScript?.['microsoft-word'];
              return ns?.[key];
          };
          /** A captured token is usable if it has a non-empty value and is not about to expire. */
          const usableToken = (captured) => {
              if (!captured || typeof captured.token !== 'string' || captured.token.length === 0)
                  return null;
              if (typeof captured.exp !== 'number' || captured.exp <= Math.floor(Date.now() / 1000) + 30)
                  return null;
              return captured.token;
          };
          /**
           * The Graph token captured by the pre-script (the path that works on
           * SharePoint/OneDrive-hosted documents, where MSAL's cache is encrypted).
           * Checked in the in-page namespace first, then the localStorage mirror.
           */
          const getCapturedToken = () => {
              const fromNamespace = usableToken(readPreScriptValue('graph'));
              if (fromNamespace)
                  return fromNamespace;
              try {
                  const raw = getLocalStorage(LS_TOKEN_KEY);
                  if (raw)
                      return usableToken(JSON.parse(raw));
              }
              catch {
                  /* malformed or inaccessible — fall through */
              }
              return null;
          };
          /**
           * A plaintext Graph access token from the standalone `word.cloud.microsoft`
           * app's MSAL localStorage cache, keyed by client id and scope.
           */
          const getMsalToken = () => {
              const tokenKeysRaw = getLocalStorage(`msal.token.keys.${MSAL_CLIENT_ID}`);
              const keysSource = tokenKeysRaw ?? findLocalStorageEntry(key => key.startsWith('msal.token.keys.'))?.value;
              if (!keysSource)
                  return null;
              let tokenKeys;
              try {
                  tokenKeys = JSON.parse(keysSource);
              }
              catch {
                  return null;
              }
              if (!tokenKeys.accessToken)
                  return null;
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
                      // MSAL stores `expiresOn` as a unix-epoch-seconds string. A missing or
                      // unparseable value means we cannot prove the token is live — treat it as
                      // expired rather than risk returning a stale token.
                      const expiresOn = Number.parseInt(String(parsed.expiresOn ?? '0'), 10);
                      if (!(expiresOn > Math.floor(Date.now() / 1000)))
                          continue;
                      return parsed.secret;
                  }
                  catch {
                      // skip invalid token entries
                  }
              }
              return null;
          };
          const getToken = () => getCapturedToken() ?? getMsalToken();
          /**
           * Get the raw Graph API access token.
           * Used by tools that need raw fetch (non-JSON body uploads).
           */
          const getGraphToken = () => {
              const token = getToken();
              if (token)
                  return token;
              return authError(NOT_AUTHENTICATED_MESSAGE);
          };
          const isAuthenticated = () => getToken() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(() => true, () => false);
          /** True when the current tab is a SharePoint/OneDrive-hosted Word document. */
          const isSharePointDocument = () => {
              try {
                  const url = new URL(getCurrentUrl());
                  return url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:w:/');
              }
              catch {
                  return false;
              }
          };
          /**
           * Trailing guidance appended to AUTH_ERROR messages on SharePoint/OneDrive
           * documents. MSAL's encrypted cache means we can't recover in-place — the only
           * reliable path is to clear MSAL state and reload, which the
           * `microsoft-word__reauthenticate` tool does.
           */
          const SP_REAUTH_HINT = 'Call `microsoft-word__reauthenticate` to recover.';
          /** User-facing message when no Graph token is available at all. */
          const NOT_AUTHENTICATED_MESSAGE = 'Not authenticated — please sign in to Microsoft 365.';
          /** User-facing message when Graph rejects the token as expired (401/403). */
          const AUTH_EXPIRED_MESSAGE = 'Authentication expired — please refresh the page.';
          /**
           * Throw an AUTH_ERROR, appending the reauth hint on SharePoint documents.
           * Clears the adapter's cached token first so the next call re-reads fresh auth
           * state — every auth failure path resets the cache through this single helper.
           */
          const authError = (msg) => {
              clearAuthCache('microsoft-word');
              throw ToolError.auth(isSharePointDocument() ? `${msg} ${SP_REAUTH_HINT}` : msg);
          };
          /**
           * Guidance for HTTP 423 from Graph `/content`. The file is held by a WOPI
           * co-authoring lock — almost always because it is open in the Word web editor
           * in this very browser. Graph cannot overwrite a locked file, so the only path
           * is to close the editor (or wait for the lock to lapse) and retry.
           */
          const FILE_LOCKED_MESSAGE = 'The document is locked because it is open in the Word web editor (or another co-authoring session), ' +
              'so Microsoft Graph cannot save changes to it. Close the editor tab — or wait ~30–60 seconds after closing ' +
              'for the lock to release — then retry.';
          /**
           * Per-tab cache keyed by the page URL. The Office apps are SPAs — same-tab
           * navigation to a different document changes `getCurrentUrl()` without
           * reloading the adapter, so a single-slot cache would silently return the
           * wrong drive/item. Comparing the URL on every read invalidates the cache
           * exactly when the document identity changes.
           */
          let cached = null;
          /** Encode a sharing URL into a Graph `/shares` share id (unpadded base64url with a `u!` prefix). */
          const encodeShareId = (sharingUrl) => {
              const bytes = new TextEncoder().encode(sharingUrl);
              let binary = '';
              for (const b of bytes)
                  binary += String.fromCharCode(b);
              const base64 = btoa(binary);
              return `u!${base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
          };
          /**
           * Resolve the open document's drive and item ids.
           *
           * The standalone `word.cloud.microsoft` app carries `driveId`/`docId` in the URL
           * query. SharePoint/OneDrive-hosted documents identify the file by a sharing
           * token in the path, resolved to `{driveId, itemId}` via Graph `/shares`.
           * Returns null when no document context is available (e.g. a file-browser page).
           */
          const resolveDocumentContext = async () => {
              const currentUrl = getCurrentUrl();
              if (cached && cached.url === currentUrl)
                  return cached.ctx;
              const url = new URL(currentUrl);
              const driveId = url.searchParams.get('driveId');
              const docId = url.searchParams.get('docId');
              if (driveId && docId) {
                  const ctx = { driveId, itemId: docId };
                  cached = { url: currentUrl, ctx };
                  return ctx;
              }
              if (url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:w:/')) {
                  const item = await api(`/shares/${encodeShareId(url.href)}/driveItem`, { query: { $select: 'id,parentReference' } });
                  const resolvedDriveId = item.parentReference?.driveId;
                  if (resolvedDriveId && item.id) {
                      const ctx = { driveId: resolvedDriveId, itemId: item.id };
                      cached = { url: currentUrl, ctx };
                      return ctx;
                  }
              }
              return null;
          };
          /**
           * Make an authenticated request to the Microsoft Graph API.
           * Handles JSON responses, error classification, and token invalidation.
           */
          const api = async (endpoint, options = {}) => {
              const token = getToken();
              if (!token)
                  authError(NOT_AUTHENTICATED_MESSAGE);
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `${GRAPH_API_BASE}${endpoint}?${qs}` : `${GRAPH_API_BASE}${endpoint}`;
              const method = options.method ?? 'GET';
              const headers = {
                  Authorization: `Bearer ${token}`,
              };
              const init = { method, headers };
              if (options.body) {
                  headers['Content-Type'] = 'application/json';
                  init.body = JSON.stringify(options.body);
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
                      throw ToolError.timeout('Microsoft Graph API request timed out.');
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
                  const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                  throw ToolError.rateLimited('Microsoft Graph API rate limit exceeded.', retryMs);
              }
              if (response.status === 401 || response.status === 403) {
                  authError(AUTH_EXPIRED_MESSAGE);
              }
              if (response.status === 404) {
                  throw ToolError.notFound('The requested resource was not found.');
              }
              if (!response.ok) {
                  let errorMsg = `Microsoft Graph API error (${response.status})`;
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
              return (await response.json());
          };

          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              display_name: z.string().describe('Display name'),
              email: z.string().describe('Email address'),
          });
          const mapUser = (u) => ({
              id: u.id ?? '',
              display_name: u.displayName ?? '',
              email: u.mail ?? u.userPrincipalName ?? '',
          });
          // --- Drive ---
          const quotaSchema = z.object({
              total: z.number().describe('Total storage in bytes'),
              used: z.number().describe('Used storage in bytes'),
              remaining: z.number().describe('Remaining storage in bytes'),
              state: z.string().describe('Quota state (normal, nearing, critical, exceeded)'),
          });
          const driveSchema = z.object({
              id: z.string().describe('Drive ID'),
              name: z.string().describe('Drive name'),
              drive_type: z.string().describe('Drive type (personal, business, documentLibrary)'),
              quota: quotaSchema.describe('Storage quota information'),
          });
          const mapDrive = (d) => ({
              id: d.id ?? '',
              name: d.name ?? '',
              drive_type: d.driveType ?? '',
              quota: {
                  total: d.quota?.total ?? 0,
                  used: d.quota?.used ?? 0,
                  remaining: d.quota?.remaining ?? 0,
                  state: d.quota?.state ?? '',
              },
          });
          // --- Drive Item (file or folder) ---
          const driveItemSchema = z.object({
              id: z.string().describe('Item ID'),
              name: z.string().describe('File or folder name'),
              size: z.number().describe('Size in bytes (0 for folders)'),
              is_folder: z.boolean().describe('Whether the item is a folder'),
              mime_type: z.string().describe('MIME type (empty for folders)'),
              web_url: z.string().describe('URL to open in browser'),
              created_at: z.string().describe('ISO 8601 creation timestamp'),
              last_modified_at: z.string().describe('ISO 8601 last modification timestamp'),
              parent_path: z.string().describe('Parent folder path'),
              parent_id: z.string().describe('Parent folder ID'),
              description: z.string().describe('Item description'),
          });
          const mapDriveItem = (i) => ({
              id: i.id ?? '',
              name: i.name ?? '',
              size: i.size ?? 0,
              is_folder: !!i.folder,
              mime_type: i.file?.mimeType ?? '',
              web_url: i.webUrl ?? '',
              created_at: i.createdDateTime ?? '',
              last_modified_at: i.lastModifiedDateTime ?? '',
              parent_path: i.parentReference?.path ?? '',
              parent_id: i.parentReference?.id ?? '',
              description: i.description ?? '',
          });
          // --- Permission ---
          const permissionSchema = z.object({
              id: z.string().describe('Permission ID'),
              roles: z.array(z.string()).describe('Permission roles (read, write, owner)'),
              link_url: z.string().describe('Sharing link URL (empty if not a link permission)'),
              link_type: z.string().describe('Link type (view, edit, embed) — empty if not a link'),
              granted_to: z.string().describe('Display name of the grantee — empty if anonymous link'),
          });
          const mapPermission = (p) => ({
              id: p.id ?? '',
              roles: p.roles ?? [],
              link_url: p.link?.webUrl ?? '',
              link_type: p.link?.type ?? '',
              granted_to: p.grantedTo?.user?.displayName ?? p.grantedToIdentities?.[0]?.user?.displayName ?? '',
          });
          // --- Version ---
          const versionSchema = z.object({
              id: z.string().describe('Version ID'),
              last_modified_at: z.string().describe('ISO 8601 last modification timestamp'),
              size: z.number().describe('Size in bytes'),
          });
          const mapVersion = (v) => ({
              id: v.id ?? '',
              last_modified_at: v.lastModifiedDateTime ?? '',
              size: v.size ?? 0,
          });

          /**
           * Utilities for reading and creating .docx files in the browser.
           *
           * A .docx file is a ZIP archive containing OOXML parts:
           *   [Content_Types].xml  — content type declarations
           *   _rels/.rels          — relationship mappings
           *   word/document.xml    — the actual document content
           *
           * Text is stored in <w:t> elements within <w:r> (run) within <w:p> (paragraph) nodes.
           */
          /** Read a little-endian uint16 from a byte array. */
          function readUint16LE(data, offset) {
              return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
          }
          /** Read a little-endian uint32 from a byte array. */
          function readUint32LE(data, offset) {
              return ((data[offset] ?? 0) |
                  ((data[offset + 1] ?? 0) << 8) |
                  ((data[offset + 2] ?? 0) << 16) |
                  (((data[offset + 3] ?? 0) << 24) >>> 0));
          }
          /**
           * Extract a file entry from a ZIP archive by name.
           * Handles both STORE (uncompressed) and DEFLATE (compressed) entries.
           */
          async function extractZipEntry(zipBytes, filename) {
              let offset = 0;
              while (offset < zipBytes.length - 30) {
                  // Local file header signature: PK\x03\x04
                  if (readUint32LE(zipBytes, offset) !== 0x04034b50) {
                      offset++;
                      continue;
                  }
                  const compressionMethod = readUint16LE(zipBytes, offset + 8);
                  const compressedSize = readUint32LE(zipBytes, offset + 18);
                  const nameLen = readUint16LE(zipBytes, offset + 26);
                  const extraLen = readUint16LE(zipBytes, offset + 28);
                  const name = new TextDecoder().decode(zipBytes.slice(offset + 30, offset + 30 + nameLen));
                  const dataStart = offset + 30 + nameLen + extraLen;
                  const rawData = zipBytes.slice(dataStart, dataStart + compressedSize);
                  if (name === filename) {
                      if (compressionMethod === 8) {
                          const bytes = await decompressDeflateRaw(rawData);
                          return new TextDecoder().decode(bytes);
                      }
                      // STORE (method 0) — uncompressed
                      return new TextDecoder().decode(rawData);
                  }
                  offset += 30 + nameLen + extraLen + compressedSize;
              }
              return null;
          }
          /** Decompress a DEFLATE-raw buffer using the browser DecompressionStream API. */
          async function decompressDeflateRaw(data) {
              const ds = new DecompressionStream('deflate-raw');
              const writer = ds.writable.getWriter();
              // Copy into a fresh ArrayBuffer to satisfy the BufferSource type constraint
              const copy = new Uint8Array(data.length);
              copy.set(data);
              writer.write(copy);
              writer.close();
              const reader = ds.readable.getReader();
              const chunks = [];
              for (;;) {
                  const { done, value } = await reader.read();
                  if (done)
                      break;
                  chunks.push(value);
              }
              const totalLen = chunks.reduce((s, c) => s + c.length, 0);
              const result = new Uint8Array(totalLen);
              let pos = 0;
              for (const chunk of chunks) {
                  result.set(chunk, pos);
                  pos += chunk.length;
              }
              return result;
          }
          /**
           * Extract plain text paragraphs from OOXML document.xml content.
           * Returns an array of paragraph strings.
           */
          function extractTextFromDocumentXml(xml) {
              const paraBlocks = xml.split(/<\/w:p>/);
              const paragraphs = [];
              for (const block of paraBlocks) {
                  const texts = [];
                  const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
                  let match = regex.exec(block);
                  while (match !== null) {
                      texts.push(match[1] ?? '');
                      match = regex.exec(block);
                  }
                  const paraText = texts.join('');
                  if (paraText) {
                      paragraphs.push(paraText);
                  }
              }
              return paragraphs;
          }
          /**
           * Extract all entries from a ZIP archive, decompressing DEFLATE entries.
           * Returns raw byte data for each entry (to preserve binary entries like images).
           */
          async function extractAllZipEntries(zipBytes) {
              const entries = [];
              let offset = 0;
              while (offset < zipBytes.length - 30) {
                  if (readUint32LE(zipBytes, offset) !== 0x04034b50) {
                      offset++;
                      continue;
                  }
                  const compressionMethod = readUint16LE(zipBytes, offset + 8);
                  const compressedSize = readUint32LE(zipBytes, offset + 18);
                  const nameLen = readUint16LE(zipBytes, offset + 26);
                  const extraLen = readUint16LE(zipBytes, offset + 28);
                  const name = new TextDecoder().decode(zipBytes.slice(offset + 30, offset + 30 + nameLen));
                  const dataStart = offset + 30 + nameLen + extraLen;
                  const rawData = zipBytes.slice(dataStart, dataStart + compressedSize);
                  let data;
                  if (compressionMethod === 8) {
                      data = await decompressDeflateRaw(rawData);
                  }
                  else {
                      data = rawData;
                  }
                  entries.push({ name, data });
                  offset += 30 + nameLen + extraLen + compressedSize;
              }
              return entries;
          }
          /**
           * Rebuild a ZIP archive from entries, replacing one entry's content.
           * All entries are stored uncompressed (STORE method).
           */
          function rebuildZip(entries) {
              return createZipFromBinary(entries);
          }
          /** Escape text for use inside OOXML <w:t> elements. */
          function escapeXml(text) {
              return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
          /** Build OOXML paragraph elements from plain text strings. */
          function textToParagraphXml(paragraphs) {
              return paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join('');
          }
          /**
           * Append paragraphs to an existing document.xml string.
           * Inserts new <w:p> elements before the closing </w:body> tag.
           */
          function appendParagraphsToXml(existingXml, paragraphs) {
              const newContent = textToParagraphXml(paragraphs);
              // Insert before </w:body>
              const bodyCloseIdx = existingXml.lastIndexOf('</w:body>');
              if (bodyCloseIdx === -1) {
                  // Malformed — wrap in a body
                  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${newContent}</w:body></w:document>`;
              }
              return existingXml.slice(0, bodyCloseIdx) + newContent + existingXml.slice(bodyCloseIdx);
          }
          /**
           * Replace all document body content with new paragraphs, preserving
           * the XML declaration and document wrapper attributes.
           */
          function replaceBodyContent(existingXml, paragraphs) {
              const newContent = textToParagraphXml(paragraphs);
              // Find <w:body...> opening and </w:body> closing
              const bodyOpenMatch = existingXml.match(/<w:body[^>]*>/);
              const bodyCloseIdx = existingXml.lastIndexOf('</w:body>');
              if (!bodyOpenMatch || bodyCloseIdx === -1) {
                  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${newContent}</w:body></w:document>`;
              }
              const bodyOpenEnd = (bodyOpenMatch.index ?? 0) + bodyOpenMatch[0].length;
              return existingXml.slice(0, bodyOpenEnd) + newContent + existingXml.slice(bodyCloseIdx);
          }
          /**
           * Perform find-and-replace on text within <w:t> elements in document.xml.
           * Replaces all occurrences of `find` with `replace` within each text run.
           */
          function replaceTextInXml(xml, find, replace) {
              let count = 0;
              const escaped = escapeXml(find);
              const escapedReplace = escapeXml(replace);
              // Replace within <w:t> content — match each <w:t>...</w:t> and replace inside
              const result = xml.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_match, open, content, close) => {
                  if (!content.includes(escaped))
                      return _match;
                  const parts = content.split(escaped);
                  count += parts.length - 1;
                  return open + parts.join(escapedReplace) + close;
              });
              return { xml: result, count };
          }
          /**
           * Compute CRC-32 for a byte array (used by ZIP format).
           */
          function crc32(data) {
              let crc = 0xffffffff;
              for (let i = 0; i < data.length; i++) {
                  crc ^= data[i] ?? 0;
                  for (let j = 0; j < 8; j++) {
                      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
                  }
              }
              return (crc ^ 0xffffffff) >>> 0;
          }
          /**
           * Build a minimal valid .docx file (ZIP archive) from an array of text paragraphs.
           * Uses STORE (no compression) for simplicity and reliability.
           */
          function buildDocx(paragraphs) {
              const contentTypes = [
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                  '<Default Extension="xml" ContentType="application/xml"/>',
                  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
                  '</Types>',
              ].join('');
              const rels = [
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
                  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
                  '</Relationships>',
              ].join('');
              const escapedParagraphs = paragraphs.map(text => {
                  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
              });
              const documentXml = [
                  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
                  '<w:body>',
                  ...escapedParagraphs,
                  '</w:body>',
                  '</w:document>',
              ].join('');
              return createZip([
                  ['[Content_Types].xml', contentTypes],
                  ['_rels/.rels', rels],
                  ['word/document.xml', documentXml],
              ]);
          }
          /**
           * Create a ZIP archive from an array of [filename, textContent] entries.
           * Uses STORE method (no compression).
           */
          function createZip(files) {
              const encoder = new TextEncoder();
              const localParts = [];
              const centralParts = [];
              let offset = 0;
              for (const [name, content] of files) {
                  const nameBytes = encoder.encode(name);
                  const contentBytes = encoder.encode(content);
                  const crc = crc32(contentBytes);
                  // Local file header (30 bytes) + name + content
                  const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
                  const lv = new DataView(local.buffer);
                  lv.setUint32(0, 0x04034b50, true);
                  lv.setUint16(4, 20, true);
                  lv.setUint16(8, 0, true); // STORE
                  lv.setUint32(14, crc, true);
                  lv.setUint32(18, contentBytes.length, true);
                  lv.setUint32(22, contentBytes.length, true);
                  lv.setUint16(26, nameBytes.length, true);
                  local.set(nameBytes, 30);
                  local.set(contentBytes, 30 + nameBytes.length);
                  localParts.push(local);
                  // Central directory entry (46 bytes) + name
                  const central = new Uint8Array(46 + nameBytes.length);
                  const cv = new DataView(central.buffer);
                  cv.setUint32(0, 0x02014b50, true);
                  cv.setUint16(4, 20, true);
                  cv.setUint16(6, 20, true);
                  cv.setUint16(10, 0, true); // STORE
                  cv.setUint32(16, crc, true);
                  cv.setUint32(20, contentBytes.length, true);
                  cv.setUint32(24, contentBytes.length, true);
                  cv.setUint16(28, nameBytes.length, true);
                  cv.setUint32(42, offset, true);
                  central.set(nameBytes, 46);
                  centralParts.push(central);
                  offset += local.length;
              }
              const centralDirSize = centralParts.reduce((s, c) => s + c.length, 0);
              const endRecord = new Uint8Array(22);
              const ev = new DataView(endRecord.buffer);
              ev.setUint32(0, 0x06054b50, true);
              ev.setUint16(8, files.length, true);
              ev.setUint16(10, files.length, true);
              ev.setUint32(12, centralDirSize, true);
              ev.setUint32(16, offset, true);
              const total = offset + centralDirSize + 22;
              const result = new Uint8Array(total);
              let pos = 0;
              for (const part of localParts) {
                  result.set(part, pos);
                  pos += part.length;
              }
              for (const part of centralParts) {
                  result.set(part, pos);
                  pos += part.length;
              }
              result.set(endRecord, pos);
              return result;
          }
          /**
           * Create a ZIP archive from binary entries (ZipEntry[]).
           * Used by rebuildZip to repackage a modified .docx.
           */
          function createZipFromBinary(entries) {
              const encoder = new TextEncoder();
              const localParts = [];
              const centralParts = [];
              let offset = 0;
              for (const entry of entries) {
                  const nameBytes = encoder.encode(entry.name);
                  const contentBytes = entry.data;
                  const crc = crc32(contentBytes);
                  const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
                  const lv = new DataView(local.buffer);
                  lv.setUint32(0, 0x04034b50, true);
                  lv.setUint16(4, 20, true);
                  lv.setUint16(8, 0, true); // STORE
                  lv.setUint32(14, crc, true);
                  lv.setUint32(18, contentBytes.length, true);
                  lv.setUint32(22, contentBytes.length, true);
                  lv.setUint16(26, nameBytes.length, true);
                  local.set(nameBytes, 30);
                  local.set(contentBytes, 30 + nameBytes.length);
                  localParts.push(local);
                  const central = new Uint8Array(46 + nameBytes.length);
                  const cv = new DataView(central.buffer);
                  cv.setUint32(0, 0x02014b50, true);
                  cv.setUint16(4, 20, true);
                  cv.setUint16(6, 20, true);
                  cv.setUint16(10, 0, true); // STORE
                  cv.setUint32(16, crc, true);
                  cv.setUint32(20, contentBytes.length, true);
                  cv.setUint32(24, contentBytes.length, true);
                  cv.setUint16(28, nameBytes.length, true);
                  cv.setUint32(42, offset, true);
                  central.set(nameBytes, 46);
                  centralParts.push(central);
                  offset += local.length;
              }
              const centralDirSize = centralParts.reduce((s, c) => s + c.length, 0);
              const endRecord = new Uint8Array(22);
              const ev = new DataView(endRecord.buffer);
              ev.setUint32(0, 0x06054b50, true);
              ev.setUint16(8, entries.length, true);
              ev.setUint16(10, entries.length, true);
              ev.setUint32(12, centralDirSize, true);
              ev.setUint32(16, offset, true);
              const total = offset + centralDirSize + 22;
              const result = new Uint8Array(total);
              let pos = 0;
              for (const part of localParts) {
                  result.set(part, pos);
                  pos += part.length;
              }
              for (const part of centralParts) {
                  result.set(part, pos);
                  pos += part.length;
              }
              result.set(endRecord, pos);
              return result;
          }

          "use strict";
          (() => {
            // dist/_pre_script_setup_e318e468-6c34-45f1-afc9-4e2d0dbed36d.ts
            if (!globalThis.__openTabs) {
              globalThis.__openTabs = {};
            }
            var _ot = globalThis.__openTabs;
            if (!_ot.preScript) {
              _ot.preScript = {};
            }
            _ot.preScript["microsoft-word"] = {};
            var _logPrefix = "[opentabs:microsoft-word:pre-script]";
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
                  _ot.preScript["microsoft-word"][key] = value;
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
            var GRAPH_HOSTNAME = "graph.microsoft.com";
            var TOKEN_ENDPOINT_HOSTNAME = "login.microsoftonline.com";
            var TOKEN_ENDPOINT_PATH = /\/oauth2\/(?:v2\.0\/)?token$/i;
            var FETCH_PATCHED_MARKER = /* @__PURE__ */ Symbol.for("opentabs.microsoft-word.fetch.patched");
            var XHR_PATCHED_MARKER = /* @__PURE__ */ Symbol.for("opentabs.microsoft-word.xhr.patched");
            var LS_TOKEN_KEY = "__opentabs_word_graph_token";
            var parseUrl = (url) => {
              try {
                return new URL(url);
              } catch {
                return null;
              }
            };
            var isGraphUrl = (url) => parseUrl(url)?.hostname.toLowerCase() === GRAPH_HOSTNAME;
            var isTokenEndpointUrl = (url) => {
              const u = parseUrl(url);
              return !!u && u.hostname.toLowerCase() === TOKEN_ENDPOINT_HOSTNAME && TOKEN_ENDPOINT_PATH.test(u.pathname);
            };
            definePreScript(({ set, log }) => {
              const g = globalThis;
              const stash = (token, exp) => {
                if (!token || token.length < 16) return;
                set("graph", { token, exp });
                set("graphCapturedAt", Date.now());
                try {
                  localStorage.setItem(LS_TOKEN_KEY, JSON.stringify({ token, exp }));
                } catch {
                }
              };
              const extractBearer = (headers) => {
                if (headers instanceof Headers) {
                  return headers.get("Authorization") ?? headers.get("authorization") ?? void 0;
                }
                if (Array.isArray(headers)) {
                  for (const entry of headers) {
                    if (entry[0]?.toLowerCase() === "authorization") return entry[1];
                  }
                  return void 0;
                }
                if (headers && typeof headers === "object") {
                  const h = headers;
                  return h.Authorization ?? h.authorization;
                }
                return void 0;
              };
              const scopeGrantsGraph = (scope) => scope.split(/\s+/).some((s) => parseUrl(s)?.hostname.toLowerCase() === GRAPH_HOSTNAME);
              const captureFromTokenResponse = (body) => {
                if (!body || typeof body !== "object") return;
                const data = body;
                if (typeof data.access_token !== "string" || typeof data.scope !== "string") return;
                if (!scopeGrantsGraph(data.scope)) return;
                const ttl = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
                const exp = Math.floor(Date.now() / 1e3) + ttl;
                stash(data.access_token, exp);
                log.debug(`[microsoft-word] captured Graph token from AAD token endpoint`);
              };
              if (!g.fetch[FETCH_PATCHED_MARKER]) {
                const origFetch = g.fetch;
                const patchedFetch = async (input, init) => {
                  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
                  if (isGraphUrl(url)) {
                    const header = extractBearer(init?.headers) ?? (input instanceof Request ? extractBearer(input.headers) : void 0);
                    if (header?.startsWith("Bearer ") && header.length > "Bearer ".length) {
                      stash(header.slice("Bearer ".length), Math.floor(Date.now() / 1e3) + 600);
                    }
                  }
                  const response = await origFetch(input, init);
                  if (isTokenEndpointUrl(url)) {
                    response.clone().json().then(captureFromTokenResponse).catch(() => {
                    });
                  }
                  return response;
                };
                patchedFetch[FETCH_PATCHED_MARKER] = true;
                g.fetch = patchedFetch;
              }
              if (!g.XMLHttpRequest.prototype || !g.XMLHttpRequest[XHR_PATCHED_MARKER]) {
                const Xhr = g.XMLHttpRequest;
                const origOpen = Xhr.prototype.open;
                const origSetRequestHeader = Xhr.prototype.setRequestHeader;
                const STATE = /* @__PURE__ */ Symbol("opentabs.microsoft-word.xhr.state");
                const patchedOpen = function patchedOpen2(method, url, ...rest) {
                  const urlStr = typeof url === "string" ? url : url.href;
                  this[STATE] = { url: urlStr };
                  this.addEventListener(
                    "load",
                    () => {
                      const state = this[STATE];
                      if (!state) return;
                      if (isGraphUrl(state.url) && state.bearer?.startsWith("Bearer ")) {
                        stash(state.bearer.slice("Bearer ".length), Math.floor(Date.now() / 1e3) + 600);
                      }
                      if (isTokenEndpointUrl(state.url)) {
                        try {
                          const text = this.responseText;
                          if (text) captureFromTokenResponse(JSON.parse(text));
                        } catch {
                        }
                      }
                    },
                    { once: true }
                  );
                  const forward = origOpen;
                  return forward.call(this, method, urlStr, ...rest);
                };
                Xhr.prototype.open = patchedOpen;
                Xhr.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
                  if (name.toLowerCase() === "authorization" && this[STATE]) {
                    this[STATE].bearer = value;
                  }
                  return origSetRequestHeader.call(this, name, value);
                };
                g.XMLHttpRequest[XHR_PATCHED_MARKER] = true;
              }
              log.info("[microsoft-word] Graph token interceptor installed (fetch + XHR)");
            });
          })();

          const GRAPH_HOSTNAME = 'graph.microsoft.com';
          const TOKEN_ENDPOINT_HOSTNAME = 'login.microsoftonline.com';
          /**
           * AAD token endpoint paths. Matches both:
           *   v2: `/<tenant>/oauth2/v2.0/token`  (MSAL.js 2.x default)
           *   v1: `/<tenant>/oauth2/token`       (MSAL.js 1.x / ADAL.js / legacy SP flows)
           */
          const TOKEN_ENDPOINT_PATH = /\/oauth2\/(?:v2\.0\/)?token$/i;
          /** Marker used to make the fetch patch idempotent under re-injection. */
          const FETCH_PATCHED_MARKER = Symbol.for('opentabs.microsoft-word.fetch.patched');
          /** Marker used to make the XHR patch idempotent under re-injection. */
          const XHR_PATCHED_MARKER = Symbol.for('opentabs.microsoft-word.xhr.patched');
          /**
           * localStorage key the captured token is mirrored to. MSAL only re-mints a
           * Graph token on a cold load or at refresh time, so warm reloads would
           * otherwise see nothing. Persisting here lets every same-origin tab reuse a
           * captured token for its lifetime. The adapter reads the same key.
           */
          const LS_TOKEN_KEY = '__opentabs_word_graph_token';
          const parseUrl = (url) => {
              try {
                  return new URL(url);
              }
              catch {
                  return null;
              }
          };
          const isGraphUrl = (url) => parseUrl(url)?.hostname.toLowerCase() === GRAPH_HOSTNAME;
          const isTokenEndpointUrl = (url) => {
              const u = parseUrl(url);
              return !!u && u.hostname.toLowerCase() === TOKEN_ENDPOINT_HOSTNAME && TOKEN_ENDPOINT_PATH.test(u.pathname);
          };
          definePreScript(({ set, log }) => {
              const g = globalThis;
              const stash = (token, exp) => {
                  if (!token || token.length < 16)
                      return;
                  set('graph', { token, exp });
                  set('graphCapturedAt', Date.now());
                  try {
                      localStorage.setItem(LS_TOKEN_KEY, JSON.stringify({ token, exp }));
                  }
                  catch {
                      /* storage unavailable — the in-page namespace still works for this load */
                  }
              };
              const extractBearer = (headers) => {
                  if (headers instanceof Headers) {
                      return headers.get('Authorization') ?? headers.get('authorization') ?? undefined;
                  }
                  if (Array.isArray(headers)) {
                      for (const entry of headers) {
                          if (entry[0]?.toLowerCase() === 'authorization')
                              return entry[1];
                      }
                      return undefined;
                  }
                  if (headers && typeof headers === 'object') {
                      const h = headers;
                      return h.Authorization ?? h.authorization;
                  }
                  return undefined;
              };
              /**
               * Whether the AAD `scope` claim grants Microsoft Graph. The claim is a
               * space-separated list of scope identifiers (some are URIs), e.g.
               * `https://graph.microsoft.com/Files.Read.All openid profile`. We split and
               * exact-match the hostname rather than substring-match the whole claim.
               */
              const scopeGrantsGraph = (scope) => scope.split(/\s+/).some(s => parseUrl(s)?.hostname.toLowerCase() === GRAPH_HOSTNAME);
              /** Parse an AAD token-endpoint JSON response and stash any Graph-scoped token. */
              const captureFromTokenResponse = (body) => {
                  if (!body || typeof body !== 'object')
                      return;
                  const data = body;
                  if (typeof data.access_token !== 'string' || typeof data.scope !== 'string')
                      return;
                  if (!scopeGrantsGraph(data.scope))
                      return;
                  const ttl = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
                  const exp = Math.floor(Date.now() / 1000) + ttl;
                  stash(data.access_token, exp);
                  log.debug(`[microsoft-word] captured Graph token from AAD token endpoint`);
              };
              // --- fetch patch (primary path for MSAL.js auth-code flow + direct Graph) ---
              // Idempotency: a second injection into the same realm (hot reload, future
              // iframe-reuse) must not stack wrappers — that would recurse and double-stash.
              if (!g.fetch[FETCH_PATCHED_MARKER]) {
                  const origFetch = g.fetch;
                  const patchedFetch = async (input, init) => {
                      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                      // Secondary path: a Bearer header on a direct Graph request.
                      if (isGraphUrl(url)) {
                          const header = extractBearer(init?.headers) ?? (input instanceof Request ? extractBearer(input.headers) : undefined);
                          if (header?.startsWith('Bearer ') && header.length > 'Bearer '.length) {
                              // No expiry available from a request header; trust it for a short window.
                              stash(header.slice('Bearer '.length), Math.floor(Date.now() / 1000) + 600);
                          }
                      }
                      const response = await origFetch(input, init);
                      // Primary path: parse the AAD token-endpoint response for a Graph token.
                      if (isTokenEndpointUrl(url)) {
                          response
                              .clone()
                              .json()
                              .then(captureFromTokenResponse)
                              .catch(() => {
                              /* non-JSON or read failure — ignore */
                          });
                      }
                      return response;
                  };
                  patchedFetch[FETCH_PATCHED_MARKER] = true;
                  g.fetch = patchedFetch;
              }
              // --- XMLHttpRequest patch ---
              //
              // SharePoint's WAC/Owl framework uses XHR for AAD silent-refresh calls on
              // some flows (MSAL.js exposes an XHR client for legacy compatibility, and
              // SP wraps it). Without this hook, refreshed tokens never reach our stash
              // and the LS mirror goes stale after the first hour.
              if (!g.XMLHttpRequest.prototype || !g.XMLHttpRequest[XHR_PATCHED_MARKER]) {
                  const Xhr = g.XMLHttpRequest;
                  const origOpen = Xhr.prototype.open;
                  const origSetRequestHeader = Xhr.prototype.setRequestHeader;
                  // Per-instance state stashed under a Symbol so we don't collide with page code.
                  const STATE = Symbol('opentabs.microsoft-word.xhr.state');
                  const patchedOpen = function patchedOpen(method, url, ...rest) {
                      const urlStr = typeof url === 'string' ? url : url.href;
                      this[STATE] = { url: urlStr };
                      // `once` is essential: XHR instances are reusable, and we add a listener
                      // on every `open()`. Without it, a reused instance would accumulate a
                      // listener per request and re-run capture for every prior request on each
                      // subsequent response. With it, each request gets exactly one fire.
                      this.addEventListener('load', () => {
                          const state = this[STATE];
                          if (!state)
                              return;
                          // Secondary path: outbound Graph request carrying a Bearer header.
                          if (isGraphUrl(state.url) && state.bearer?.startsWith('Bearer ')) {
                              stash(state.bearer.slice('Bearer '.length), Math.floor(Date.now() / 1000) + 600);
                          }
                          // Primary path: AAD token-endpoint response body.
                          if (isTokenEndpointUrl(state.url)) {
                              try {
                                  const text = this.responseText;
                                  if (text)
                                      captureFromTokenResponse(JSON.parse(text));
                              }
                              catch {
                                  /* non-JSON or restricted responseText — ignore */
                              }
                          }
                      }, { once: true });
                      // The two `open` overloads (with/without async/user/password) don't
                      // unify when forwarding a rest tuple, so widen `origOpen` to a single
                      // signature that accepts unknown trailing args.
                      const forward = origOpen;
                      return forward.call(this, method, urlStr, ...rest);
                  };
                  Xhr.prototype.open = patchedOpen;
                  Xhr.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
                      if (name.toLowerCase() === 'authorization' && this[STATE]) {
                          this[STATE].bearer = value;
                      }
                      return origSetRequestHeader.call(this, name, value);
                  };
                  g.XMLHttpRequest[XHR_PATCHED_MARKER] = true;
              }
              log.info('[microsoft-word] Graph token interceptor installed (fetch + XHR)');
          });

          /**
           * Shared helpers for tools that download, modify, and re-upload .docx files.
           */
          const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
          const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          /** Download a .docx file and return all ZIP entries plus the document.xml as text. */
          async function downloadDocxEntries(itemId) {
              const token = getGraphToken();
              // Get the pre-authenticated download URL
              const metaResp = await fetchWithErrorHandling(`${GRAPH_API_BASE}/me/drive/items/${itemId}`, {
                  headers: { Authorization: `Bearer ${token}` },
                  credentials: 'omit',
              });
              const meta = (await metaResp.json());
              if (!meta['@microsoft.graph.downloadUrl']) {
                  throw ToolError.internal('No download URL available for this item.');
              }
              const mimeType = meta.file?.mimeType ?? '';
              if (mimeType && !mimeType.includes('wordprocessingml') && !mimeType.includes('msword')) {
                  throw ToolError.validation(`This file is not a Word document (${mimeType}). Only .docx files can be edited.`);
              }
              // Download the binary
              const docResp = await fetchWithErrorHandling(meta['@microsoft.graph.downloadUrl'], {});
              const docBytes = new Uint8Array(await docResp.arrayBuffer());
              // Extract all ZIP entries
              const entries = await extractAllZipEntries(docBytes);
              const docIndex = entries.findIndex(e => e.name === 'word/document.xml');
              if (docIndex === -1) {
                  throw ToolError.internal('Could not find word/document.xml in the .docx archive.');
              }
              const entry = entries[docIndex];
              if (!entry) {
                  throw ToolError.internal('Could not read word/document.xml from the .docx archive.');
              }
              const documentXml = new TextDecoder().decode(entry.data);
              return { entries, documentXml, documentXmlIndex: docIndex };
          }
          /** Replace the document.xml in entries and re-upload the .docx to OneDrive. */
          async function uploadModifiedDocx(itemId, entries, documentXmlIndex, newDocumentXml) {
              const token = getGraphToken();
              const encoder = new TextEncoder();
              // Replace document.xml content
              entries[documentXmlIndex] = {
                  name: 'word/document.xml',
                  data: encoder.encode(newDocumentXml),
              };
              // Rebuild the ZIP
              const zipBytes = rebuildZip(entries);
              // Upload back — PUT to /content endpoint
              const body = new ArrayBuffer(zipBytes.byteLength);
              new Uint8Array(body).set(zipBytes);
              const resp = await fetchWithErrorHandling(`${GRAPH_API_BASE}/me/drive/items/${itemId}/content`, {
                  method: 'PUT',
                  credentials: 'omit',
                  headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': DOCX_MIME,
                  },
                  body,
              });
              // Consume the response to avoid leaking
              await resp.json();
          }
          /** Wrapper around fetch with standard error handling for Graph API calls. */
          async function fetchWithErrorHandling(url, init) {
              let response;
              try {
                  response = await fetch(url, {
                      ...init,
                      signal: AbortSignal.timeout(30_000),
                  });
              }
              catch (err) {
                  if (err instanceof DOMException && err.name === 'TimeoutError') {
                      throw ToolError.timeout('Microsoft Graph API request timed out.');
                  }
                  throw ToolError.internal(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
              }
              if (response.status === 401 || response.status === 403) {
                  authError(AUTH_EXPIRED_MESSAGE);
              }
              if (response.status === 423) {
                  throw ToolError.validation(FILE_LOCKED_MESSAGE);
              }
              if (response.status === 404) {
                  throw ToolError.notFound('Document not found.');
              }
              if (!response.ok) {
                  let errorMsg = `Microsoft Graph API error (${response.status})`;
                  try {
                      const errBody = (await response.json());
                      if (errBody.error?.message)
                          errorMsg = errBody.error.message;
                  }
                  catch {
                      // ignore parse errors
                  }
                  throw ToolError.internal(errorMsg);
              }
              return response;
          }
          const deleteItem = defineTool({
              name: 'delete_item',
              displayName: 'Delete Item',
              description: 'Permanently delete a file or folder. This action cannot be undone.',
              summary: 'Delete a file or folder',
              icon: 'trash-2',
              group: 'Files',
              input: z.object({
                  item_id: z.string().describe('ID of the file or folder to delete'),
              }),
              output: z.object({
                  success: z.boolean().describe('Whether the deletion succeeded'),
              }),
              handle: async (params) => {
                  await api(`/me/drive/items/${params.item_id}`, {
                      method: 'DELETE',
                  });
                  return { success: true };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = deleteItem

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
                      var productProbe = PRODUCT_HOSTS['microsoft-word'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Word page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)office\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Word page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Microsoft Word page.')
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
            async delete_item(args) {
              return runTool('delete_item', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['delete_item'](args)
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
            'The Microsoft Word tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Microsoft Word API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Microsoft Word tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
