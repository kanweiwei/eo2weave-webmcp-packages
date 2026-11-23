// Self-contained adapter workflow. The Excel Online session and every same-origin
// API call stay inside the Excel Online tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "name": {
        "description": "Name for the new worksheet. Auto-generated if omitted.",
        "type": "string"
      }
    },
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
    description: 'add_worksheet',
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
          /** localStorage key the pre-script mirrors the captured Graph token to. */
          const LS_TOKEN_KEY = '__opentabs_excel_graph_token';
          /**
           * Read a value the pre-script stashed under the `excel-online` namespace.
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
                  ?.preScript?.['excel-online'];
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
           * The Graph token captured by the pre-script. Checked in two places: the
           * in-page pre-script namespace (set on the current load) and the localStorage
           * mirror (persisted across warm reloads and same-origin tabs for the token's
           * lifetime).
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
           * A plaintext Graph access token from MSAL's localStorage cache.
           *
           * Used on the standalone `excel.cloud.microsoft` app, where MSAL.js stores
           * `secret` plaintext. Enterprise SharePoint pages encrypt the `data` field
           * (their entries have no `secret`), so the predicate naturally skips them and
           * the pre-script's captured token is used instead. We match by key shape
           * rather than hardcoding a client ID — consumer vs enterprise tenants use
           * different IDs, and any plaintext Graph AT in storage is fair game.
           */
          const getLocalStorageToken = () => {
              const entry = findLocalStorageEntry(key => key.includes('accesstoken') && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key));
              if (!entry)
                  return null;
              try {
                  const parsed = JSON.parse(entry.value);
                  if (typeof parsed.secret !== 'string' || parsed.secret.length === 0)
                      return null;
                  // MSAL stores `expiresOn` as a unix-epoch-seconds string. A missing or
                  // unparseable value means we cannot prove the token is live — treat it as
                  // expired rather than risk returning a stale token (MSAL leaves expired AT
                  // entries in storage until the next refresh).
                  const expiresOn = Number.parseInt(String(parsed.expiresOn ?? '0'), 10);
                  if (!(expiresOn > Math.floor(Date.now() / 1000)))
                      return null;
                  return parsed.secret;
              }
              catch {
                  return null;
              }
          };
          const getToken = () => getCapturedToken() ?? getLocalStorageToken();
          const isAuthenticated = () => getToken() !== null;
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(() => true, () => false);
          /** True when the current tab is a SharePoint/OneDrive-hosted Excel workbook. */
          const isSharePointWorkbook = () => {
              try {
                  const url = new URL(getCurrentUrl());
                  return url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:x:/');
              }
              catch {
                  return false;
              }
          };
          /**
           * Per-tab cache keyed by the page URL. The Office apps are SPAs — same-tab
           * navigation to a different workbook changes `getCurrentUrl()` without
           * reloading the adapter, so a single-slot cache would silently return the
           * wrong drive/item. Comparing the URL on every read invalidates the cache
           * exactly when the workbook identity changes.
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
          /** Resolve the drive item behind a SharePoint/OneDrive sharing URL via Graph `/shares`. */
          const resolveViaShares = async (sharingUrl) => {
              const item = await api(`/shares/${encodeShareId(sharingUrl)}/driveItem`, { query: { $select: 'id,parentReference' } });
              const driveId = item.parentReference?.driveId;
              if (!driveId || !item.id) {
                  throw ToolError.notFound('Could not resolve the workbook from the current SharePoint URL.');
              }
              return { driveId, itemId: item.id };
          };
          /**
           * Resolve the open workbook's drive and item ids.
           *
           * The standalone `excel.cloud.microsoft` app carries `driveId`/`docId` in the
           * URL query. SharePoint/OneDrive-hosted workbooks identify the file by a
           * sharing token in the path, which we resolve to `{driveId, itemId}` through
           * the Graph `/shares` endpoint.
           */
          const resolveWorkbookContext = async () => {
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
              if (url.hostname.endsWith('.sharepoint.com')) {
                  const ctx = await resolveViaShares(url.href);
                  cached = { url: currentUrl, ctx };
                  return ctx;
              }
              throw ToolError.validation('No workbook is currently open. Please open an Excel workbook in the browser first.');
          };
          // --- API caller ---
          /**
           * Trailing guidance appended to AUTH_ERROR messages on SharePoint/OneDrive
           * pages. MSAL's encrypted cache means we can't recover in-place — the only
           * reliable path is to clear MSAL state and reload, which the
           * `excel-online_reauthenticate` tool does.
           */
          const SP_REAUTH_HINT = 'Call `excel-online_reauthenticate` to recover.';
          const authError = (msg) => {
              throw ToolError.auth(isSharePointWorkbook() ? `${msg} ${SP_REAUTH_HINT}` : msg);
          };
          const api = async (endpoint, options = {}) => {
              const token = getToken();
              if (!token)
                  authError('Not authenticated — please log in to Microsoft 365.');
              const qs = options.query ? buildQueryString(options.query) : '';
              const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;
              const headers = {
                  Authorization: `Bearer ${token}`,
              };
              let fetchBody;
              if (options.body !== undefined) {
                  headers['Content-Type'] = 'application/json';
                  fetchBody = JSON.stringify(options.body);
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
                  if (response.status === 401)
                      authError(`Auth error (401): ${errorBody}`);
                  if (response.status === 403)
                      authError(`Forbidden (403): ${errorBody}`);
                  if (response.status === 404)
                      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
                  if (response.status === 429) {
                      const retryAfter = response.headers.get('Retry-After');
                      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
                      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
                  }
                  if (response.status === 400 || response.status === 422)
                      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
                  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
              }
              if (response.status === 204)
                  return {};
              return (await response.json());
          };
          // --- Workbook API helper ---
          const workbookApi = async (path, options = {}) => {
              const ctx = await resolveWorkbookContext();
              const endpoint = `/drives/${ctx.driveId}/items/${encodeURIComponent(ctx.itemId)}/workbook${path}`;
              return api(endpoint, options);
          };
          // --- User API helper ---
          const getUserInfo = async () => {
              return api('/me');
          };

          // --- Worksheet ---
          const worksheetSchema = z.object({
              id: z.string().describe('Worksheet ID'),
              name: z.string().describe('Worksheet name'),
              position: z.number().int().describe('Zero-based position of the worksheet within the workbook'),
              visibility: z.string().describe('Worksheet visibility: Visible, Hidden, or VeryHidden'),
          });
          const mapWorksheet = (w) => ({
              id: w.id ?? '',
              name: w.name ?? '',
              position: w.position ?? 0,
              visibility: w.visibility ?? 'Visible',
          });
          // --- Range ---
          const rangeSchema = z.object({
              address: z.string().describe('Range address in A1 notation (e.g., "Sheet1!A1:C3")'),
              row_count: z.number().int().describe('Number of rows in the range'),
              column_count: z.number().int().describe('Number of columns in the range'),
              values: z.array(z.array(z.unknown())).describe('2D array of cell values (strings, numbers, booleans)'),
              formulas: z.array(z.array(z.unknown())).describe('2D array of cell formulas'),
              text: z.array(z.array(z.string())).describe('2D array of formatted text representations of cell values'),
              number_format: z.array(z.array(z.string())).describe('2D array of number format codes'),
          });
          const mapRange = (r) => ({
              address: r.address ?? '',
              row_count: r.rowCount ?? 0,
              column_count: r.columnCount ?? 0,
              values: r.values ?? [],
              formulas: r.formulas ?? [],
              text: r.text ?? [],
              number_format: r.numberFormat ?? [],
          });
          // --- Table ---
          const tableSchema = z.object({
              id: z.string().describe('Table ID'),
              name: z.string().describe('Table name'),
              show_headers: z.boolean().describe('Whether the header row is visible'),
              show_totals: z.boolean().describe('Whether the total row is visible'),
              style: z.string().describe('Table style name (e.g., "TableStyleMedium2")'),
          });
          const mapTable = (t) => ({
              id: t.id ?? '',
              name: t.name ?? '',
              show_headers: t.showHeaders ?? true,
              show_totals: t.showTotals ?? false,
              style: t.style ?? '',
          });
          // --- Table Column ---
          const tableColumnSchema = z.object({
              id: z.string().describe('Column ID'),
              name: z.string().describe('Column name'),
              index: z.number().int().describe('Zero-based column index within the table'),
          });
          const mapTableColumn = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              index: c.index ?? 0,
          });
          // --- Table Row ---
          const tableRowSchema = z.object({
              index: z.number().int().describe('Zero-based row index within the table'),
              values: z.array(z.array(z.unknown())).describe('2D array with a single row of cell values'),
          });
          const mapTableRow = (r) => ({
              index: r.index ?? 0,
              values: r.values ?? [],
          });
          // --- Named Item ---
          const namedItemSchema = z.object({
              name: z.string().describe('Named item name'),
              type: z.string().describe('Named item type (e.g., "Range", "String", "Integer")'),
              value: z.string().describe('Named item value or formula'),
              visible: z.boolean().describe('Whether the named item is visible'),
          });
          const mapNamedItem = (n) => ({
              name: n.name ?? '',
              type: n.type ?? '',
              value: String(n.value ?? ''),
              visible: n.visible ?? true,
          });
          // --- Chart ---
          const chartSchema = z.object({
              id: z.string().describe('Chart ID'),
              name: z.string().describe('Chart name'),
              height: z.number().describe('Chart height in points'),
              width: z.number().describe('Chart width in points'),
              top: z.number().describe('Distance from top of worksheet in points'),
              left: z.number().describe('Distance from left of worksheet in points'),
          });
          const mapChart = (c) => ({
              id: c.id ?? '',
              name: c.name ?? '',
              height: c.height ?? 0,
              width: c.width ?? 0,
              top: c.top ?? 0,
              left: c.left ?? 0,
          });
          // --- User ---
          const userSchema = z.object({
              id: z.string().describe('User ID'),
              display_name: z.string().describe('User display name'),
              email: z.string().describe('User email address'),
          });
          // --- Workbook info (from URL context) ---
          const workbookInfoSchema = z.object({
              drive_id: z.string().describe('OneDrive drive ID'),
              item_id: z.string().describe('Workbook item ID'),
              name: z.string().describe('Workbook file name'),
          });

          "use strict";
          (() => {
            // dist/_pre_script_setup_375f5cc8-521d-4aa6-94a2-c4667def26b9.ts
            if (!globalThis.__openTabs) {
              globalThis.__openTabs = {};
            }
            var _ot = globalThis.__openTabs;
            if (!_ot.preScript) {
              _ot.preScript = {};
            }
            _ot.preScript["excel-online"] = {};
            var _logPrefix = "[opentabs:excel-online:pre-script]";
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
                  _ot.preScript["excel-online"][key] = value;
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
            var FETCH_PATCHED_MARKER = /* @__PURE__ */ Symbol.for("opentabs.excel-online.fetch.patched");
            var XHR_PATCHED_MARKER = /* @__PURE__ */ Symbol.for("opentabs.excel-online.xhr.patched");
            var LS_TOKEN_KEY = "__opentabs_excel_graph_token";
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
                log.debug(`[excel-online] captured Graph token from AAD token endpoint`);
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
                const STATE = /* @__PURE__ */ Symbol("opentabs.excel-online.xhr.state");
                const patchedOpen = function patchedOpen2(method, url, ...rest) {
                  const urlStr = typeof url === "string" ? url : url.href;
                  this[STATE] = { url: urlStr };
                  this.addEventListener("load", () => {
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
                  });
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
              log.info("[excel-online] Graph token interceptor installed (fetch + XHR)");
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
          const FETCH_PATCHED_MARKER = Symbol.for('opentabs.excel-online.fetch.patched');
          /** Marker used to make the XHR patch idempotent under re-injection. */
          const XHR_PATCHED_MARKER = Symbol.for('opentabs.excel-online.xhr.patched');
          /**
           * localStorage key the captured token is mirrored to. MSAL only re-mints a
           * Graph token on a cold load or at refresh time, so warm reloads would
           * otherwise see nothing. Persisting here lets every same-origin tab reuse a
           * captured token for its lifetime. The adapter reads the same key.
           */
          const LS_TOKEN_KEY = '__opentabs_excel_graph_token';
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
                  log.debug(`[excel-online] captured Graph token from AAD token endpoint`);
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
                  const STATE = Symbol('opentabs.excel-online.xhr.state');
                  const patchedOpen = function patchedOpen(method, url, ...rest) {
                      const urlStr = typeof url === 'string' ? url : url.href;
                      this[STATE] = { url: urlStr };
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
                      });
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
              log.info('[excel-online] Graph token interceptor installed (fetch + XHR)');
          });
          const addWorksheet = defineTool({
              name: 'add_worksheet',
              displayName: 'Add Worksheet',
              description: 'Add a new worksheet to the currently open Excel workbook. Optionally specify a name for the new worksheet.',
              summary: 'Add a new worksheet',
              icon: 'plus',
              group: 'Worksheets',
              input: z.object({
                  name: z.string().optional().describe('Name for the new worksheet. Auto-generated if omitted.'),
              }),
              output: z.object({ worksheet: worksheetSchema }),
              handle: async (params) => {
                  const body = {};
                  if (params.name)
                      body.name = params.name;
                  const data = await workbookApi('/worksheets', { method: 'POST', body });
                  return { worksheet: mapWorksheet(data) };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = addWorksheet

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
                      var productProbe = PRODUCT_HOSTS['excel-online'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Excel Online page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)office\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Excel Online page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Excel Online page.')
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
            async add_worksheet(args) {
              return runTool('add_worksheet', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['add_worksheet'](args)
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
            'The Excel Online tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Excel Online API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Excel Online tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
