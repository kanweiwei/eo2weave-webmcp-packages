// Self-contained adapter workflow for upstream OpenTabs tool `update_shape`
// (plugins/powerpoint/src/tools/update-shape.ts, MIT). The PowerPoint
// Online runtime below is that plugin's own code — Microsoft Graph v1.0 paths,
// $select field lists, OOXML (ZIP + DrawingML) handling and mappers — compiled
// from the upstream TypeScript with esbuild and an inlined page-side SDK shim.
// It runs INSIDE the PowerPoint / SharePoint tab on the tab's session, so no
// token or file content is ever read out of the page or returned by this file.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "item_id": {
        "type": "string",
        "description": "Item ID of the PowerPoint file"
      },
      "slide_number": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991,
        "description": "Slide number (1-indexed)"
      },
      "shape_id": {
        "type": "string",
        "description": "Shape id from get_slide_layout"
      },
      "text": {
        "description": "New text content. Use \\n for line breaks. First-run formatting is preserved.",
        "type": "string"
      },
      "x": {
        "description": "New X offset in inches from slide top-left",
        "type": "number"
      },
      "y": {
        "description": "New Y offset in inches from slide top-left",
        "type": "number"
      },
      "w": {
        "description": "New width in inches",
        "type": "number",
        "exclusiveMinimum": 0
      },
      "h": {
        "description": "New height in inches",
        "type": "number",
        "exclusiveMinimum": 0
      },
      "rotation": {
        "description": "New rotation in degrees (clockwise)",
        "type": "number"
      },
      "fill": {
        "description": "Solid fill color as hex (e.g. \"FFCC00\" or \"#ffcc00\")",
        "type": "string"
      }
    },
    "required": [
      "item_id",
      "slide_number",
      "shape_id"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean",
        "description": "Whether the update succeeded"
      }
    },
    "required": [
      "success"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'update_shape',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }
          // Upstream isPowerPointTab(): the dedicated cloud app, a SharePoint
          // /:p:/ viewer, or any URL naming a .ppt/.pptx/.pptm/.ppsx file.
          function isPowerPointTab() {
            var url = String(location.href || '')
            var host = ''
            try {
              host = new URL(url).hostname.toLowerCase()
            } catch (e) {
              /* malformed URL — fall through to the path checks */
            }
            if (host === 'powerpoint.cloud.microsoft') return true
            if (/\/:p:\//i.test(url)) return true
            if (/\.(?:pptx?|pptm|ppsx?)(?:[?#]|$)/i.test(url)) return true
            return false
          }
          function assertPage() {
            if (!isPowerPointTab()) {
              return error('UNSUPPORTED_PAGE', 'Not on a PowerPoint or SharePoint presentation page.')
            }
            return null
          }


          // --- Graph token capture (upstream src/pre-script.ts) ----------
          // The plugin's pre-script wraps fetch + XHR at document_start and
          // stashes any Graph-scoped access token from an AAD token-endpoint
          // response (or a Bearer header on a direct Graph call) in
          // localStorage. A workflow cannot run at document_start, so the same
          // interceptor is installed on the first tool call. Consequence: on a
          // cold SharePoint tab the first call can report AUTH until the page
          // mints a token; later calls read the captured mirror.
          var GRAPH_HOSTNAME = 'graph.microsoft.com'
          var GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000'
          var TOKEN_ENDPOINT_HOSTNAME = 'login.microsoftonline.com'
          var TOKEN_ENDPOINT_PATH = /\/oauth2\/(?:v2\.0\/)?token$/i
          var LS_TOKEN_KEY = '__opentabs_powerpoint_graph_token'

          function parseCapturedUrl(value) {
            try {
              return new URL(String(value))
            } catch (e) {
              return null
            }
          }
          function isGraphUrl(url) {
            var parsed = parseCapturedUrl(url)
            return !!parsed && parsed.hostname.toLowerCase() === GRAPH_HOSTNAME
          }
          function isTokenEndpointUrl(url) {
            var parsed = parseCapturedUrl(url)
            return (
              !!parsed &&
              parsed.hostname.toLowerCase() === TOKEN_ENDPOINT_HOSTNAME &&
              TOKEN_ENDPOINT_PATH.test(parsed.pathname)
            )
          }
          function scopeGrantsGraph(scope) {
            var parts = String(scope).split(/\s+/)
            for (var i = 0; i < parts.length; i++) {
              var parsed = parseCapturedUrl(parts[i])
              if (parsed && parsed.hostname.toLowerCase() === GRAPH_HOSTNAME) return true
            }
            return false
          }
          function resourceGrantsGraph(resource) {
            var parsed = parseCapturedUrl(resource)
            if (parsed) return parsed.hostname.toLowerCase() === GRAPH_HOSTNAME
            return resource === GRAPH_RESOURCE_APP_ID
          }
          function stashGraphToken(token, exp) {
            if (!token || token.length < 16) return
            var namespace = globalThis.__openTabs || (globalThis.__openTabs = {})
            var preScript = namespace.preScript || (namespace.preScript = {})
            var powerpoint = preScript.powerpoint || (preScript.powerpoint = {})
            powerpoint.graph = { token: token, exp: exp }
            powerpoint.graphCapturedAt = Date.now()
            try {
              localStorage.setItem(LS_TOKEN_KEY, JSON.stringify({ token: token, exp: exp }))
            } catch (e) {
              /* storage unavailable — the in-page namespace still works */
            }
          }
          function captureFromTokenResponse(body) {
            if (!body || typeof body !== 'object') return
            if (typeof body.access_token !== 'string') return
            var grantsGraph =
              (typeof body.scope === 'string' && scopeGrantsGraph(body.scope)) ||
              (typeof body.resource === 'string' && resourceGrantsGraph(body.resource))
            if (!grantsGraph) return
            var ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600
            stashGraphToken(body.access_token, Math.floor(Date.now() / 1000) + ttl)
          }
          function extractBearerHeader(headers) {
            if (!headers) return undefined
            if (typeof Headers !== 'undefined' && headers instanceof Headers) {
              var fromHeaders = headers.get('Authorization') || headers.get('authorization')
              return fromHeaders === null ? undefined : fromHeaders
            }
            if (Array.isArray(headers)) {
              for (var i = 0; i < headers.length; i++) {
                var entry = headers[i]
                if (entry && String(entry[0]).toLowerCase() === 'authorization') return entry[1]
              }
              return undefined
            }
            if (typeof headers === 'object') return headers.Authorization || headers.authorization
            return undefined
          }
          function installTokenInterceptor() {
            var FETCH_MARKER = '__opentabsPowerpointFetchPatched'
            var XHR_MARKER = '__opentabsPowerpointXhrPatched'
            if (typeof globalThis.fetch === 'function' && !globalThis.fetch[FETCH_MARKER]) {
              var origFetch = globalThis.fetch
              var patchedFetch = async function (input, init) {
                var url =
                  typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input && input.url !== undefined
                        ? input.url
                        : String(input)
                if (isGraphUrl(url)) {
                  var header =
                    extractBearerHeader(init && init.headers) ||
                    (input && input.headers ? extractBearerHeader(input.headers) : undefined)
                  if (typeof header === 'string' && header.indexOf('Bearer ') === 0 && header.length > 7) {
                    stashGraphToken(header.slice(7), Math.floor(Date.now() / 1000) + 600)
                  }
                }
                var response = await origFetch(input, init)
                if (isTokenEndpointUrl(url) && response && typeof response.clone === 'function') {
                  response
                    .clone()
                    .json()
                    .then(captureFromTokenResponse)
                    .catch(function () {})
                }
                return response
              }
              patchedFetch[FETCH_MARKER] = true
              globalThis.fetch = patchedFetch
            }
            if (typeof XMLHttpRequest === 'undefined' || !XMLHttpRequest.prototype) return
            var Xhr = XMLHttpRequest
            if (Xhr[XHR_MARKER]) return
            var origOpen = Xhr.prototype.open
            var origSetRequestHeader = Xhr.prototype.setRequestHeader
            Xhr.prototype.open = function patchedOpen(method, url) {
              var self = this
              var urlStr = typeof url === 'string' ? url : url && url.href !== undefined ? url.href : String(url)
              this.__opentabsPwUrl = urlStr
              this.addEventListener(
                'load',
                function () {
                  if (isGraphUrl(urlStr) && self.__opentabsPwBearer) {
                    var bearer = self.__opentabsPwBearer
                    if (bearer.indexOf('Bearer ') === 0) {
                      stashGraphToken(bearer.slice(7), Math.floor(Date.now() / 1000) + 600)
                    }
                  }
                  if (isTokenEndpointUrl(urlStr)) {
                    try {
                      if (self.responseText) captureFromTokenResponse(JSON.parse(self.responseText))
                    } catch (e) {
                      /* non-JSON or restricted responseText */
                    }
                  }
                },
                { once: true },
              )
              var forward = origOpen
              return forward.apply(this, arguments)
            }
            Xhr.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
              if (String(name).toLowerCase() === 'authorization') this.__opentabsPwBearer = value
              return origSetRequestHeader.call(this, name, value)
            }
            Xhr[XHR_MARKER] = true
          }

          installTokenInterceptor()

          // --- transport -------------------------------------------------
          // Every request goes to https://graph.microsoft.com/v1.0 with the
          // tab's captured Bearer token, not with cookies. Graph answers
          // access-control-allow-origin: * and omits
          // access-control-allow-credentials (verified with curl OPTIONS
          // /v1.0/me from a sharepoint.com Origin), so a credentialed request
          // is rejected by the browser: credentials: 'include' is
          // deliberately NOT used and every fetch sends credentials: 'omit'.
          // The Bearer token in the Authorization header is the credential and
          // never leaves the page.

          // --- upstream runtime, compiled verbatim ------------------------
          var __pw = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // entries/update_shape.js
  var update_shape_exports2 = {};
  __export(update_shape_exports2, {
    tools: () => tools
  });

  // src/tools/update-shape.ts
  var update_shape_exports = {};
  __export(update_shape_exports, {
    updateShape: () => updateShape
  });

  // sdk-shim.js
  function defineTool(definition) {
    return definition;
  }
  function getPageGlobal(path) {
    try {
      const parts = String(path).split(".");
      let node = globalThis;
      for (const part of parts) {
        if (node === null || node === void 0) return void 0;
        node = node[part];
      }
      return node;
    } catch {
      return void 0;
    }
  }
  function getCurrentUrl() {
    try {
      return String(location.href || "");
    } catch {
      return "";
    }
  }
  function getLocalStorage(key) {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function findLocalStorageEntry(predicate) {
    try {
      if (typeof localStorage === "undefined") return null;
      const total = localStorage.length;
      for (let i = 0; i < total; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (value === null) continue;
        if (predicate(key, value)) return { key, value };
      }
    } catch {
      return null;
    }
    return null;
  }
  function getPreScriptValue(key) {
    const namespace = getPageGlobal("__openTabs.preScript.powerpoint");
    if (!namespace || typeof namespace !== "object") return void 0;
    return namespace[key];
  }
  var ToolError = class _ToolError extends Error {
    constructor(message, code, options) {
      super(message);
      this.name = "ToolError";
      this.code = code || "INTERNAL";
      this.__toolError = this.code;
      if (options && options.retryable !== void 0) this.retryable = options.retryable;
      if (options && options.retryAfterMs !== void 0) this.retryAfterMs = options.retryAfterMs;
    }
    static auth(message) {
      return new _ToolError(message, "AUTH");
    }
    static validation(message) {
      return new _ToolError(message, "VALIDATION");
    }
    static notFound(message) {
      return new _ToolError(message, "NOT_FOUND");
    }
    static internal(message) {
      return new _ToolError(message, "INTERNAL");
    }
    static timeout(message) {
      return new _ToolError(message, "TIMEOUT");
    }
    static rateLimited(message, retryAfterMs) {
      return new _ToolError(message, "RATE_LIMITED", { retryAfterMs });
    }
  };

  // zod-shim.js
  var inert = () => {
    const schema = {
      optional: () => schema,
      nullable: () => schema,
      describe: () => schema,
      min: () => schema,
      max: () => schema,
      int: () => schema,
      positive: () => schema,
      negative: () => schema,
      nonempty: () => schema,
      refine: () => schema,
      default: () => schema,
      catch: () => schema,
      transform: () => schema,
      strict: () => schema,
      passthrough: () => schema,
      strip: () => schema,
      and: () => schema,
      or: () => schema,
      brand: () => schema,
      readOnly: () => schema
    };
    return schema;
  };
  var z = {
    object: inert,
    string: inert,
    number: inert,
    bigint: inert,
    boolean: inert,
    date: inert,
    array: inert,
    tuple: inert,
    enum: inert,
    nativeEnum: inert,
    literal: inert,
    union: inert,
    discriminatedUnion: inert,
    record: inert,
    map: inert,
    set: inert,
    lazy: inert,
    any: inert,
    unknown: inert,
    never: inert,
    void: inert,
    null: inert,
    undefined: inert,
    optional: inert,
    nullable: inert,
    coerce: { string: inert, number: inert, boolean: inert, date: inert, bigint: inert }
  };

  // src/powerpoint-api.ts
  var GRAPH_BASE = "https://graph.microsoft.com/v1.0";
  var MSAL_CLIENT_ID = "2821b473-fe24-4c86-ba16-62834d6e80c3";
  var LS_TOKEN_KEY = "__opentabs_powerpoint_graph_token";
  var isSharePoint = () => {
    try {
      return new URL(getCurrentUrl()).hostname.toLowerCase().endsWith(".sharepoint.com");
    } catch {
      return false;
    }
  };
  var isSharePointPresentation = () => {
    try {
      const url = new URL(getCurrentUrl());
      return url.hostname.toLowerCase().endsWith(".sharepoint.com") && url.pathname.includes("/:p:/");
    } catch {
      return false;
    }
  };
  var readPreScriptValue = (key) => {
    const viaSdk = getPreScriptValue(key);
    if (viaSdk !== void 0) return viaSdk;
    const ns = globalThis.__openTabs?.preScript?.powerpoint;
    return ns?.[key];
  };
  var usableToken = (captured) => {
    if (!captured || typeof captured.token !== "string" || captured.token.length === 0) return null;
    if (typeof captured.exp !== "number" || captured.exp <= Math.floor(Date.now() / 1e3) + 30) return null;
    return captured.token;
  };
  var getCapturedToken = () => {
    const fromNamespace = usableToken(readPreScriptValue("graph"));
    if (fromNamespace) return fromNamespace;
    try {
      const raw = getLocalStorage(LS_TOKEN_KEY);
      if (raw) return usableToken(JSON.parse(raw));
    } catch {
    }
    return null;
  };
  var getMsalToken = () => {
    const entry = findLocalStorageEntry(
      (k) => k.includes("accesstoken") && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(k) && k.includes(MSAL_CLIENT_ID)
    );
    if (!entry) return null;
    try {
      const data = JSON.parse(entry.value);
      if (typeof data.secret !== "string" || data.secret.length === 0) return null;
      const expiresOn = Number.parseInt(String(data.expiresOn ?? "0"), 10);
      if (!(expiresOn > Math.floor(Date.now() / 1e3))) return null;
      return data.secret;
    } catch {
      return null;
    }
  };
  var getToken = () => getCapturedToken() ?? getMsalToken();
  var getDriveIdSync = () => {
    const url = new URL(getCurrentUrl());
    const urlDriveId = url.searchParams.get("driveId");
    if (urlDriveId) return urlDriveId;
    const wopiDriveId = getPageGlobal("_wopiContextJson.DriveId");
    if (wopiDriveId) return wopiDriveId;
    const activeAccount = getLocalStorage(`msal.${MSAL_CLIENT_ID}.active-account`);
    if (activeAccount) {
      const match = activeAccount.match(/00000000-0000-0000-([0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) return match[1]?.replace(/-/g, "").toUpperCase() ?? null;
    }
    return null;
  };
  var encodeShareId = (sharingUrl) => {
    const bytes = new TextEncoder().encode(sharingUrl);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    return `u!${base64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
  };
  var cached = null;
  var resolveDriveId = async (token) => {
    const currentUrl = getCurrentUrl();
    if (cached && cached.url === currentUrl) return cached.driveId;
    const sync = getDriveIdSync();
    if (sync) {
      cached = { url: currentUrl, driveId: sync };
      return sync;
    }
    if (isSharePoint()) {
      try {
        const shareId = encodeShareId(currentUrl);
        const response = await fetch(`${GRAPH_BASE}/shares/${shareId}/driveItem?$select=id,parentReference`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
          signal: AbortSignal.timeout(3e4)
        });
        if (response.ok) {
          const item = await response.json();
          const driveId = item.parentReference?.driveId;
          if (driveId) {
            cached = { url: currentUrl, driveId };
            return driveId;
          }
        }
      } catch {
      }
    }
    return null;
  };
  var SP_REAUTH_HINT = "Call `reauthenticate` to recover.";
  var authError = (msg) => {
    throw ToolError.auth(isSharePointPresentation() ? `${msg} ${SP_REAUTH_HINT}` : msg);
  };
  var requireAuth = async () => {
    const token = getToken();
    if (!token) return authError("Not authenticated \u2014 please log in to Microsoft 365.");
    const driveId = await resolveDriveId(token);
    if (!driveId) {
      throw ToolError.validation("Could not determine the current drive. Open a presentation in the browser first.");
    }
    return { token, driveId };
  };

  // src/session.ts
  var SESSION_TTL_MS = 10 * 60 * 1e3;
  var SESSIONS_GLOBAL_KEY = "__opentabs_powerpoint_sessions";
  var sessionHost = globalThis;
  var sessions = sessionHost[SESSIONS_GLOBAL_KEY] ?? (sessionHost[SESSIONS_GLOBAL_KEY] = /* @__PURE__ */ new Map());
  var sessionKey = (driveId, itemId) => `${driveId}:${itemId}`;
  var isExpired = (session, now) => now - session.lastAccessedAt > SESSION_TTL_MS;
  var touchSession = (driveId, itemId) => {
    const key = sessionKey(driveId, itemId);
    const session = sessions.get(key);
    if (!session) return void 0;
    const now = Date.now();
    if (isExpired(session, now)) {
      sessions.delete(key);
      return void 0;
    }
    session.lastAccessedAt = now;
    return session;
  };

  // src/pptx-utils.ts
  var LOCAL_FILE_HEADER_SIG = 67324752;
  var CENTRAL_DIR_HEADER_SIG = 33639248;
  var END_OF_CENTRAL_DIR_SIG = 101010256;
  var isElement = (node) => node.nodeType === Node.ELEMENT_NODE;
  var getLocalName = (node) => isElement(node) ? node.localName : void 0;
  var collectStreamChunks = async (readable) => {
    const chunks = [];
    const reader = readable.getReader();
    for (; ; ) {
      const { value, done } = await reader.read();
      if (value) chunks.push(value);
      if (done) break;
    }
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      result.set(c, pos);
      pos += c.length;
    }
    return result;
  };
  var readZip = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    const entries = /* @__PURE__ */ new Map();
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === END_OF_CENTRAL_DIR_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw ToolError.internal("Invalid ZIP: no EOCD record");
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    let offset = centralDirOffset;
    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(offset, true) !== CENTRAL_DIR_HEADER_SIG)
        throw ToolError.internal("Invalid ZIP: bad central directory header");
      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(buf.subarray(offset + 46, offset + 46 + nameLen));
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const rawData = buf.slice(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        entries.set(name, new Uint8Array(rawData));
      } else if (compressionMethod === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        void writer.write(rawData).then(() => writer.close());
        const decompressed = await collectStreamChunks(ds.readable);
        const result = new Uint8Array(uncompressedSize);
        result.set(decompressed.subarray(0, uncompressedSize));
        entries.set(name, result);
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  };
  var deflateData = async (data) => {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(data.length);
    copy.set(data);
    void writer.write(copy).then(() => writer.close());
    return collectStreamChunks(cs.readable);
  };
  var crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      table[i] = c;
    }
    return table;
  })();
  var crc32 = (data) => {
    let crc = 4294967295;
    for (let i = 0; i < data.length; i++) {
      crc = (crc32Table[(crc ^ (data[i] ?? 0)) & 255] ?? 0) ^ crc >>> 8;
    }
    return (crc ^ 4294967295) >>> 0;
  };
  var writeZip = async (entries) => {
    const parts = [];
    const centralDir = [];
    let offset = 0;
    for (const [name, data] of entries) {
      const nameBytes = new TextEncoder().encode(name);
      const compressed = await deflateData(data);
      const crcVal = crc32(data);
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lhView = new DataView(localHeader);
      lhView.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
      lhView.setUint16(4, 20, true);
      lhView.setUint16(8, 8, true);
      lhView.setUint32(14, crcVal, true);
      lhView.setUint32(18, compressed.length, true);
      lhView.setUint32(22, data.length, true);
      lhView.setUint16(26, nameBytes.length, true);
      new Uint8Array(localHeader).set(nameBytes, 30);
      parts.push(localHeader);
      parts.push(compressed.buffer);
      const cdEntry = new ArrayBuffer(46 + nameBytes.length);
      const cdView = new DataView(cdEntry);
      cdView.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
      cdView.setUint16(4, 20, true);
      cdView.setUint16(6, 20, true);
      cdView.setUint16(10, 8, true);
      cdView.setUint32(16, crcVal, true);
      cdView.setUint32(20, compressed.length, true);
      cdView.setUint32(24, data.length, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint32(42, offset, true);
      new Uint8Array(cdEntry).set(nameBytes, 46);
      centralDir.push(cdEntry);
      offset += localHeader.byteLength + compressed.length;
    }
    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const cd of centralDir) {
      parts.push(cd);
      centralDirSize += cd.byteLength;
    }
    const eocd = new ArrayBuffer(22);
    const eocdView = new DataView(eocd);
    eocdView.setUint32(0, END_OF_CENTRAL_DIR_SIG, true);
    eocdView.setUint16(8, entries.size, true);
    eocdView.setUint16(10, entries.size, true);
    eocdView.setUint32(12, centralDirSize, true);
    eocdView.setUint32(16, centralDirOffset, true);
    parts.push(eocd);
    return new Blob(parts);
  };
  var xmlParser = typeof DOMParser !== "undefined" ? new DOMParser() : void 0;
  var xmlSerializer = typeof XMLSerializer !== "undefined" ? new XMLSerializer() : void 0;
  var parseXml = (xml) => {
    if (!xmlParser) throw ToolError.internal("DOMParser not available");
    return xmlParser.parseFromString(xml, "application/xml");
  };
  var TEXT_DECODER = new TextDecoder();
  var TEXT_ENCODER = new TextEncoder();
  var getSlideList = (entries) => {
    const presRelsData = entries.get("ppt/_rels/presentation.xml.rels");
    if (!presRelsData) return [];
    const relsDoc = parseXml(TEXT_DECODER.decode(presRelsData));
    const relsWalker = relsDoc.createTreeWalker(relsDoc, NodeFilter.SHOW_ELEMENT);
    const rIdToTarget = /* @__PURE__ */ new Map();
    let relsNode = relsWalker.nextNode();
    while (relsNode) {
      if (isElement(relsNode) && getLocalName(relsNode) === "Relationship") {
        const relType = relsNode.getAttribute("Type") ?? "";
        if (relType.includes("/slide") && !relType.includes("Layout") && !relType.includes("Master")) {
          const id = relsNode.getAttribute("Id") ?? "";
          const target = relsNode.getAttribute("Target") ?? "";
          if (id && target) rIdToTarget.set(id, target);
        }
      }
      relsNode = relsWalker.nextNode();
    }
    const presData = entries.get("ppt/presentation.xml");
    if (presData) {
      const presDoc = parseXml(TEXT_DECODER.decode(presData));
      const presWalker = presDoc.createTreeWalker(presDoc, NodeFilter.SHOW_ELEMENT);
      let sldIdLst = null;
      let node = presWalker.nextNode();
      while (node) {
        if (isElement(node) && getLocalName(node) === "sldIdLst") {
          sldIdLst = node;
          break;
        }
        node = presWalker.nextNode();
      }
      if (sldIdLst) {
        const ordered = [];
        for (const child of Array.from(sldIdLst.childNodes)) {
          if (!isElement(child) || getLocalName(child) !== "sldId") continue;
          const rId = child.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || child.getAttribute("r:id") || "";
          const target = rIdToTarget.get(rId);
          if (target) ordered.push(`ppt/${target}`);
        }
        if (ordered.length > 0) return ordered;
      }
    }
    const fallback = Array.from(rIdToTarget.values()).sort((a, b) => {
      const numA = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
      const numB = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
      return numA - numB;
    });
    return fallback.map((t) => `ppt/${t}`);
  };
  var FILE_LOCKED_MESSAGE = "The presentation is locked because it is open in the PowerPoint web editor (or another co-authoring session), so Microsoft Graph cannot save changes to it. Close the editor tab \u2014 or wait ~30\u201360 seconds after closing for the lock to release \u2014 then retry. Any pending session edits are preserved.";
  var fetchItemMetadata = async (driveId, itemId, token) => {
    const resp = await fetch(`${GRAPH_BASE}/drives/${driveId}/items/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      signal: AbortSignal.timeout(3e4)
    });
    if (!resp.ok) throw ToolError.internal(`Failed to get item metadata: ${resp.status}`);
    return await resp.json();
  };
  var fetchPptxBytes = async (downloadUrl) => {
    const resp = await fetch(downloadUrl, {
      credentials: "omit",
      signal: AbortSignal.timeout(6e4)
    });
    if (!resp.ok) throw ToolError.internal(`Failed to download PPTX: ${resp.status}`);
    return resp.blob();
  };
  var downloadPptx = async (itemId) => {
    const { token, driveId } = await requireAuth();
    const session = touchSession(driveId, itemId);
    if (session) return session.entries;
    const itemData = await fetchItemMetadata(driveId, itemId, token);
    const downloadUrl = itemData["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) throw ToolError.internal("No download URL available");
    const blob = await fetchPptxBytes(downloadUrl);
    return readZip(blob);
  };
  var uploadPptx = async (itemId, entries) => {
    const { token, driveId } = await requireAuth();
    const session = touchSession(driveId, itemId);
    if (session) {
      session.entries = entries;
      session.dirty = true;
      return;
    }
    const blob = await writeZip(entries);
    const url = `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      },
      body: blob,
      credentials: "omit",
      signal: AbortSignal.timeout(6e4)
    });
    if (resp.status === 423) throw ToolError.validation(FILE_LOCKED_MESSAGE);
    if (!resp.ok) {
      const errorBody = (await resp.text().catch(() => "")).substring(0, 512);
      throw ToolError.internal(`Failed to upload PPTX: ${resp.status} \u2014 ${errorBody}`);
    }
  };

  // src/slide-edit.ts
  var EMU_PER_INCH = 914400;
  var ROT_UNITS_PER_DEG = 6e4;
  var inchesToEmu = (inches) => Math.round(inches * EMU_PER_INCH);
  var degreesToRotUnits = (deg) => Math.round(deg * ROT_UNITS_PER_DEG);
  var A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
  var P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
  var xmlParser2 = typeof DOMParser !== "undefined" ? new DOMParser() : void 0;
  var xmlSerializer2 = typeof XMLSerializer !== "undefined" ? new XMLSerializer() : void 0;
  var parseXml2 = (xml) => {
    if (!xmlParser2) throw ToolError.internal("DOMParser not available");
    return xmlParser2.parseFromString(xml, "application/xml");
  };
  var serializeXml = (doc) => {
    if (!xmlSerializer2) throw ToolError.internal("XMLSerializer not available");
    return xmlSerializer2.serializeToString(doc);
  };
  var isElement2 = (node) => node.nodeType === Node.ELEMENT_NODE;
  var childElements = (el) => {
    const out = [];
    for (const n of el.childNodes) if (isElement2(n)) out.push(n);
    return out;
  };
  var childByLocalName = (el, localName) => childElements(el).find((c) => c.localName === localName);
  var getNvProps = (shape) => childByLocalName(shape, "nvSpPr") ?? childByLocalName(shape, "nvPicPr") ?? childByLocalName(shape, "nvCxnSpPr") ?? childByLocalName(shape, "nvGraphicFramePr") ?? childByLocalName(shape, "nvGrpSpPr");
  var getShapeId = (shape) => {
    const nv = getNvProps(shape);
    const cNvPr = nv ? childByLocalName(nv, "cNvPr") : void 0;
    return cNvPr?.getAttribute("id") ?? void 0;
  };
  var SHAPE_LOCAL_NAMES = /* @__PURE__ */ new Set(["sp", "pic", "cxnSp", "graphicFrame", "grpSp"]);
  var findShapeById = (root, shapeId) => {
    const doc = root.ownerDocument ?? root;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (isElement2(node) && SHAPE_LOCAL_NAMES.has(node.localName) && getShapeId(node) === shapeId) {
        return node;
      }
      node = walker.nextNode();
    }
    return void 0;
  };
  var findOrCreateXfrm = (shape) => {
    const doc = shape.ownerDocument;
    if (!doc) throw ToolError.internal("Shape element has no owner document");
    const ln = shape.localName;
    if (ln === "graphicFrame") {
      const existing2 = childByLocalName(shape, "xfrm");
      if (existing2) return existing2;
      const xfrm2 = doc.createElementNS(P_NS, "p:xfrm");
      const nv = childByLocalName(shape, "nvGraphicFramePr");
      if (nv?.nextSibling) shape.insertBefore(xfrm2, nv.nextSibling);
      else shape.appendChild(xfrm2);
      return xfrm2;
    }
    let container;
    if (ln === "grpSp") container = childByLocalName(shape, "grpSpPr");
    else container = childByLocalName(shape, "spPr");
    if (!container) throw ToolError.internal(`Shape ${ln} missing spPr/grpSpPr`);
    const existing = childByLocalName(container, "xfrm");
    if (existing) return existing;
    const xfrm = doc.createElementNS(A_NS, "a:xfrm");
    container.insertBefore(xfrm, container.firstChild);
    return xfrm;
  };
  var findOrCreateOff = (xfrm) => {
    const existing = childByLocalName(xfrm, "off");
    if (existing) return existing;
    const doc = xfrm.ownerDocument;
    if (!doc) throw ToolError.internal("xfrm has no owner document");
    const off = doc.createElementNS(A_NS, "a:off");
    off.setAttribute("x", "0");
    off.setAttribute("y", "0");
    const ext = childByLocalName(xfrm, "ext");
    if (ext) xfrm.insertBefore(off, ext);
    else xfrm.appendChild(off);
    return off;
  };
  var findOrCreateExt = (xfrm) => {
    const existing = childByLocalName(xfrm, "ext");
    if (existing) return existing;
    const doc = xfrm.ownerDocument;
    if (!doc) throw ToolError.internal("xfrm has no owner document");
    const ext = doc.createElementNS(A_NS, "a:ext");
    ext.setAttribute("cx", "0");
    ext.setAttribute("cy", "0");
    xfrm.appendChild(ext);
    return ext;
  };
  var editShapeGeometry = (slideXml, shapeId, edit) => {
    const doc = parseXml2(slideXml);
    const shape = findShapeById(doc, shapeId);
    if (!shape) throw ToolError.notFound(`Shape ${shapeId} not found on slide`);
    const xfrm = findOrCreateXfrm(shape);
    if (edit.rotation !== void 0) {
      xfrm.setAttribute("rot", String(degreesToRotUnits(edit.rotation)));
    }
    if (edit.x !== void 0 || edit.y !== void 0) {
      const off = findOrCreateOff(xfrm);
      if (edit.x !== void 0) off.setAttribute("x", String(inchesToEmu(edit.x)));
      if (edit.y !== void 0) off.setAttribute("y", String(inchesToEmu(edit.y)));
    }
    if (edit.w !== void 0 || edit.h !== void 0) {
      const ext = findOrCreateExt(xfrm);
      if (edit.w !== void 0) ext.setAttribute("cx", String(inchesToEmu(edit.w)));
      if (edit.h !== void 0) ext.setAttribute("cy", String(inchesToEmu(edit.h)));
    }
    return serializeXml(doc);
  };
  var editShapeFill = (slideXml, shapeId, hexColor) => {
    const doc = parseXml2(slideXml);
    const shape = findShapeById(doc, shapeId);
    if (!shape) throw ToolError.notFound(`Shape ${shapeId} not found on slide`);
    if (shape.localName === "pic") {
      throw ToolError.validation("Cannot set fill color on a picture shape");
    }
    const spPr = childByLocalName(shape, "spPr") ?? childByLocalName(shape, "grpSpPr");
    if (!spPr) throw ToolError.internal("Shape has no spPr");
    const normalized = hexColor.replace(/^#/, "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(normalized)) {
      throw ToolError.validation(`Invalid hex color: ${hexColor} \u2014 expected 6 hex digits`);
    }
    for (const tag of ["solidFill", "gradFill", "blipFill", "pattFill", "noFill"]) {
      const existing = childByLocalName(spPr, tag);
      if (existing) spPr.removeChild(existing);
    }
    const solidFill = doc.createElementNS(A_NS, "a:solidFill");
    const srgb = doc.createElementNS(A_NS, "a:srgbClr");
    srgb.setAttribute("val", normalized);
    solidFill.appendChild(srgb);
    const geom = childByLocalName(spPr, "prstGeom") ?? childByLocalName(spPr, "custGeom");
    const xfrm = childByLocalName(spPr, "xfrm");
    const anchor = geom ?? xfrm;
    if (anchor?.nextSibling) spPr.insertBefore(solidFill, anchor.nextSibling);
    else spPr.appendChild(solidFill);
    return serializeXml(doc);
  };
  var editShapeText = (slideXml, shapeId, newText) => {
    const doc = parseXml2(slideXml);
    const shape = findShapeById(doc, shapeId);
    if (!shape) throw ToolError.notFound(`Shape ${shapeId} not found on slide`);
    const txBody = childByLocalName(shape, "txBody");
    if (!txBody) {
      throw ToolError.validation(`Shape ${shapeId} (${shape.localName}) does not have a text body`);
    }
    let preservedPPr = null;
    let preservedRPr = null;
    const firstP = childByLocalName(txBody, "p");
    if (firstP) {
      const pPr = childByLocalName(firstP, "pPr");
      if (pPr) preservedPPr = pPr.cloneNode(true);
      const firstR = childByLocalName(firstP, "r");
      if (firstR) {
        const rPr = childByLocalName(firstR, "rPr");
        if (rPr) preservedRPr = rPr.cloneNode(true);
      }
    }
    for (const p of childElements(txBody).filter((c) => c.localName === "p")) {
      txBody.removeChild(p);
    }
    const lines = newText.split("\n");
    for (const line of lines) {
      const p = doc.createElementNS(A_NS, "a:p");
      if (preservedPPr) p.appendChild(preservedPPr.cloneNode(true));
      const r = doc.createElementNS(A_NS, "a:r");
      if (preservedRPr) r.appendChild(preservedRPr.cloneNode(true));
      const t = doc.createElementNS(A_NS, "a:t");
      t.textContent = line;
      r.appendChild(t);
      p.appendChild(r);
      txBody.appendChild(p);
    }
    return serializeXml(doc);
  };

  // src/tools/update-shape.ts
  var updateShape = defineTool({
    name: "update_shape",
    displayName: "Update Shape",
    description: 'Modify an existing shape on a slide \u2014 change its text, position, size, rotation, and/or solid fill color. Find the shape id via `get_slide_layout`. Any field you omit is left unchanged. Positions and sizes are in inches; rotation is in degrees (clockwise). Fill accepts a hex color like "FFCC00" or "#ffcc00" and cannot be applied to picture shapes.',
    summary: "Edit a shape's text, geometry, rotation, or fill",
    icon: "move",
    group: "Slides",
    input: z.object({
      item_id: z.string().describe("Item ID of the PowerPoint file"),
      slide_number: z.number().int().min(1).describe("Slide number (1-indexed)"),
      shape_id: z.string().describe("Shape id from get_slide_layout"),
      text: z.string().optional().describe("New text content. Use \\n for line breaks. First-run formatting is preserved."),
      x: z.number().optional().describe("New X offset in inches from slide top-left"),
      y: z.number().optional().describe("New Y offset in inches from slide top-left"),
      w: z.number().positive().optional().describe("New width in inches"),
      h: z.number().positive().optional().describe("New height in inches"),
      rotation: z.number().optional().describe("New rotation in degrees (clockwise)"),
      fill: z.string().optional().describe('Solid fill color as hex (e.g. "FFCC00" or "#ffcc00")')
    }).refine(
      (p) => p.text !== void 0 || p.x !== void 0 || p.y !== void 0 || p.w !== void 0 || p.h !== void 0 || p.rotation !== void 0 || p.fill !== void 0,
      { message: "At least one of text, x, y, w, h, rotation, or fill must be provided" }
    ),
    output: z.object({
      success: z.boolean().describe("Whether the update succeeded")
    }),
    handle: async (params) => {
      const entries = await downloadPptx(params.item_id);
      const slideFiles = getSlideList(entries);
      if (params.slide_number > slideFiles.length || params.slide_number < 1) {
        throw ToolError.notFound(`Slide ${params.slide_number} not found \u2014 presentation has ${slideFiles.length} slides`);
      }
      const file = slideFiles[params.slide_number - 1];
      if (!file) throw ToolError.notFound(`Slide ${params.slide_number} not found`);
      const slideData = entries.get(file);
      if (!slideData) throw ToolError.internal(`Slide file not found in archive: ${file}`);
      let slideXml = TEXT_DECODER.decode(slideData);
      if (params.text !== void 0) {
        slideXml = editShapeText(slideXml, params.shape_id, params.text);
      }
      if (params.x !== void 0 || params.y !== void 0 || params.w !== void 0 || params.h !== void 0 || params.rotation !== void 0) {
        slideXml = editShapeGeometry(slideXml, params.shape_id, {
          x: params.x,
          y: params.y,
          w: params.w,
          h: params.h,
          rotation: params.rotation
        });
      }
      if (params.fill !== void 0) {
        slideXml = editShapeFill(slideXml, params.shape_id, params.fill);
      }
      entries.set(file, TEXT_ENCODER.encode(slideXml));
      await uploadPptx(params.item_id, entries);
      return { success: true };
    }
  });

  // entries/update_shape.js
  var found = Object.values(update_shape_exports).filter((v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.handle === "function");
  var tools = found;
  return __toCommonJS(update_shape_exports2);
})();

          var powerpointToolImplementations = {
            // update_shape: upstream plugins/powerpoint/src/tools/update-shape.ts
            async update_shape(args) {
              var tool = __pw.tools && __pw.tools[0]
              if (!tool) throw new Error('PowerPoint tool update_shape is missing from the bundled runtime')
              return await tool.handle(args)
            },
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await powerpointToolImplementations['update_shape'](args)
              return ok(data)
            } catch (e) {
              return error(
                e && e.__toolError ? e.__toolError : 'UNKNOWN',
                e && e.message ? e.message : String(e),
              )
            }
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
            'The PowerPoint tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Microsoft Graph call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The PowerPoint tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
