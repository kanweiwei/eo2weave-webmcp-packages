// Self-contained adapter workflow for upstream OpenTabs tool `get_slide_layout`
// (plugins/powerpoint/src/tools/get-slide-layout.ts, MIT). The PowerPoint
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
        "description": "Slide number to inspect (1-indexed)"
      }
    },
    "required": [
      "item_id",
      "slide_number"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "layout": {
        "type": "object",
        "properties": {
          "slide_number": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Slide number (1-indexed)"
          },
          "width": {
            "type": "number",
            "description": "Slide canvas width in inches"
          },
          "height": {
            "type": "number",
            "description": "Slide canvas height in inches"
          },
          "shapes": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/__schema0"
            },
            "description": "All top-level shapes on the slide"
          }
        },
        "required": [
          "slide_number",
          "width",
          "height",
          "shapes"
        ],
        "additionalProperties": false,
        "description": "Structured slide layout"
      }
    },
    "required": [
      "layout"
    ],
    "additionalProperties": false,
    "$defs": {
      "__schema0": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "Shape id, unique within the slide"
          },
          "name": {
            "type": "string",
            "description": "Shape name from authoring tool"
          },
          "kind": {
            "type": "string",
            "enum": [
              "textbox",
              "shape",
              "placeholder",
              "picture",
              "group",
              "table",
              "chart",
              "graphicFrame",
              "connector"
            ],
            "description": "Shape category"
          },
          "preset": {
            "description": "Preset geometry name for shapes (\"rect\", \"ellipse\", ...)",
            "type": "string"
          },
          "placeholder_type": {
            "description": "Placeholder type (\"title\", \"body\", \"ctrTitle\", ...)",
            "type": "string"
          },
          "x": {
            "type": "number",
            "description": "X offset from slide top-left in inches"
          },
          "y": {
            "type": "number",
            "description": "Y offset from slide top-left in inches"
          },
          "w": {
            "type": "number",
            "description": "Width in inches"
          },
          "h": {
            "type": "number",
            "description": "Height in inches"
          },
          "rotation": {
            "description": "Rotation in degrees (clockwise)",
            "type": "number"
          },
          "fill": {
            "description": "Solid fill color — hex or \"scheme:<name>\" for theme colors",
            "type": "string"
          },
          "text": {
            "description": "Text content with per-run formatting",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "runs": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "text": {
                        "type": "string",
                        "description": "Run text content"
                      },
                      "bold": {
                        "description": "Bold formatting",
                        "type": "boolean"
                      },
                      "italic": {
                        "description": "Italic formatting",
                        "type": "boolean"
                      },
                      "underline": {
                        "description": "Underline formatting",
                        "type": "boolean"
                      },
                      "size": {
                        "description": "Font size in points",
                        "type": "number"
                      },
                      "font": {
                        "description": "Font family name",
                        "type": "string"
                      },
                      "color": {
                        "description": "Hex color (e.g. \"FFCC00\") or \"scheme:<name>\" for theme colors",
                        "type": "string"
                      }
                    },
                    "required": [
                      "text"
                    ],
                    "additionalProperties": false
                  },
                  "description": "Formatted text runs within the paragraph"
                },
                "align": {
                  "description": "Horizontal alignment",
                  "type": "string",
                  "enum": [
                    "left",
                    "center",
                    "right",
                    "justify"
                  ]
                },
                "level": {
                  "description": "Indent level (0 = top level)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "runs"
              ],
              "additionalProperties": false
            }
          },
          "image_rel": {
            "description": "Relationship id of embedded image (picture shapes only)",
            "type": "string"
          },
          "children": {
            "description": "Child shapes for group shapes",
            "type": "array",
            "items": {
              "$ref": "#/$defs/__schema0"
            }
          },
          "inherited_geometry": {
            "description": "True when position/size are inherited from the slide layout/master",
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "name",
          "kind",
          "x",
          "y",
          "w",
          "h"
        ],
        "additionalProperties": false
      }
    }
  },
  tree: {
    type: 'action',
    description: 'get_slide_layout',
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

  // entries/get_slide_layout.js
  var get_slide_layout_exports2 = {};
  __export(get_slide_layout_exports2, {
    tools: () => tools
  });

  // src/tools/get-slide-layout.ts
  var get_slide_layout_exports = {};
  __export(get_slide_layout_exports, {
    getSlideLayout: () => getSlideLayout
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

  // src/slide-layout.ts
  var EMU_PER_INCH = 914400;
  var ROT_UNITS_PER_DEG = 6e4;
  var FONT_SIZE_UNITS_PER_PT = 100;
  var emuToInches = (emu) => Math.round(emu / EMU_PER_INCH * 1e3) / 1e3;
  var xmlParser2 = typeof DOMParser !== "undefined" ? new DOMParser() : void 0;
  var parseXml2 = (xml) => {
    if (!xmlParser2) throw ToolError.internal("DOMParser not available");
    return xmlParser2.parseFromString(xml, "application/xml");
  };
  var isElement2 = (node) => node.nodeType === Node.ELEMENT_NODE;
  var childElements = (el) => {
    const out = [];
    for (const n of el.childNodes) if (isElement2(n)) out.push(n);
    return out;
  };
  var childByLocalName = (el, localName) => childElements(el).find((c) => c.localName === localName);
  var descendantsByLocalName = (root, localName) => {
    const results = [];
    const walker = "createTreeWalker" in root ? root.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) : root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (isElement2(node) && node.localName === localName) results.push(node);
      node = walker.nextNode();
    }
    return results;
  };
  var firstDescendantByLocalName = (root, localName) => {
    const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    if (!walker) return void 0;
    let node = walker.nextNode();
    while (node) {
      if (isElement2(node) && node.localName === localName) return node;
      node = walker.nextNode();
    }
    return void 0;
  };
  var parseXfrm = (xfrm) => {
    if (!xfrm) return { x: 0, y: 0, w: 0, h: 0, found: false };
    const off = childByLocalName(xfrm, "off");
    const ext = childByLocalName(xfrm, "ext");
    const x = Number.parseInt(off?.getAttribute("x") ?? "0", 10);
    const y = Number.parseInt(off?.getAttribute("y") ?? "0", 10);
    const cx = Number.parseInt(ext?.getAttribute("cx") ?? "0", 10);
    const cy = Number.parseInt(ext?.getAttribute("cy") ?? "0", 10);
    const rotAttr = xfrm.getAttribute("rot");
    const rot = rotAttr ? Number.parseInt(rotAttr, 10) / ROT_UNITS_PER_DEG : void 0;
    return {
      x: emuToInches(x),
      y: emuToInches(y),
      w: emuToInches(cx),
      h: emuToInches(cy),
      rotation: rot,
      found: !!(off || ext)
    };
  };
  var parseSolidFill = (spPr) => {
    if (!spPr) return void 0;
    const solidFill = childByLocalName(spPr, "solidFill");
    if (!solidFill) return void 0;
    const srgb = childByLocalName(solidFill, "srgbClr");
    if (srgb) return srgb.getAttribute("val") ?? void 0;
    const scheme = childByLocalName(solidFill, "schemeClr");
    if (scheme) return `scheme:${scheme.getAttribute("val") ?? ""}`;
    const prstClr = childByLocalName(solidFill, "prstClr");
    if (prstClr) return `preset:${prstClr.getAttribute("val") ?? ""}`;
    return void 0;
  };
  var parseRunProperties = (rPr) => {
    if (!rPr) return {};
    const props = {};
    if (rPr.getAttribute("b") === "1") props.bold = true;
    if (rPr.getAttribute("i") === "1") props.italic = true;
    const u = rPr.getAttribute("u");
    if (u && u !== "none") props.underline = true;
    const sz = rPr.getAttribute("sz");
    if (sz) props.size = Number.parseInt(sz, 10) / FONT_SIZE_UNITS_PER_PT;
    const latin = childByLocalName(rPr, "latin");
    const face = latin?.getAttribute("typeface");
    if (face) props.font = face;
    const color = parseSolidFill(rPr);
    if (color) props.color = color;
    return props;
  };
  var parseParagraph = (p) => {
    const runs = [];
    let align;
    let level;
    const pPr = childByLocalName(p, "pPr");
    if (pPr) {
      const algn = pPr.getAttribute("algn");
      if (algn === "l") align = "left";
      else if (algn === "ctr") align = "center";
      else if (algn === "r") align = "right";
      else if (algn === "just") align = "justify";
      const lvl = pPr.getAttribute("lvl");
      if (lvl) level = Number.parseInt(lvl, 10);
    }
    for (const child of childElements(p)) {
      if (child.localName === "r") {
        const rPr = childByLocalName(child, "rPr");
        const t = childByLocalName(child, "t");
        const text = t?.textContent ?? "";
        runs.push({ text, ...parseRunProperties(rPr) });
      } else if (child.localName === "br") {
        runs.push({ text: "\n" });
      } else if (child.localName === "fld") {
        const t = childByLocalName(child, "t");
        if (t?.textContent) runs.push({ text: t.textContent });
      }
    }
    const para = { runs };
    if (align) para.align = align;
    if (level !== void 0) para.level = level;
    return para;
  };
  var parseTextBody = (txBody) => {
    if (!txBody) return void 0;
    const paragraphs = [];
    for (const child of childElements(txBody)) {
      if (child.localName === "p") paragraphs.push(parseParagraph(child));
    }
    return paragraphs.length > 0 ? paragraphs : void 0;
  };
  var parseNvProps = (nvProps) => {
    if (!nvProps) return { id: "", name: "", isTextBox: false };
    const cNvPr = childByLocalName(nvProps, "cNvPr");
    const id = cNvPr?.getAttribute("id") ?? "";
    const name = cNvPr?.getAttribute("name") ?? "";
    const cNvSpPr = childByLocalName(nvProps, "cNvSpPr");
    const isTextBox = cNvSpPr?.getAttribute("txBox") === "1";
    const nvPr = childByLocalName(nvProps, "nvPr");
    const ph = nvPr ? childByLocalName(nvPr, "ph") : void 0;
    const placeholderType = ph?.getAttribute("type") ?? (ph ? "body" : void 0);
    return { id, name, placeholderType, isTextBox };
  };
  var parseSp = (sp) => {
    const nvSpPr = childByLocalName(sp, "nvSpPr");
    const spPr = childByLocalName(sp, "spPr");
    const txBody = childByLocalName(sp, "txBody");
    const common = parseNvProps(nvSpPr);
    const xfrm = parseXfrm(spPr ? childByLocalName(spPr, "xfrm") : void 0);
    const prstGeom = spPr ? childByLocalName(spPr, "prstGeom") : void 0;
    const preset = prstGeom?.getAttribute("prst") ?? void 0;
    const fill = parseSolidFill(spPr);
    const text = parseTextBody(txBody);
    let kind;
    if (common.placeholderType) kind = "placeholder";
    else if (common.isTextBox) kind = "textbox";
    else kind = "shape";
    const node = {
      id: common.id,
      name: common.name,
      kind,
      x: xfrm.x,
      y: xfrm.y,
      w: xfrm.w,
      h: xfrm.h
    };
    if (preset) node.preset = preset;
    if (common.placeholderType) node.placeholder_type = common.placeholderType;
    if (xfrm.rotation !== void 0 && xfrm.rotation !== 0) node.rotation = xfrm.rotation;
    if (fill) node.fill = fill;
    if (text) node.text = text;
    if (!xfrm.found) node.inherited_geometry = true;
    return node;
  };
  var parsePic = (pic) => {
    const nvPicPr = childByLocalName(pic, "nvPicPr");
    const spPr = childByLocalName(pic, "spPr");
    const blipFill = childByLocalName(pic, "blipFill");
    const common = parseNvProps(nvPicPr);
    const xfrm = parseXfrm(spPr ? childByLocalName(spPr, "xfrm") : void 0);
    let imageRel;
    if (blipFill) {
      const blip = childByLocalName(blipFill, "blip");
      imageRel = blip?.getAttribute("r:embed") ?? blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed") ?? void 0;
    }
    const node = {
      id: common.id,
      name: common.name,
      kind: "picture",
      x: xfrm.x,
      y: xfrm.y,
      w: xfrm.w,
      h: xfrm.h
    };
    if (xfrm.rotation !== void 0 && xfrm.rotation !== 0) node.rotation = xfrm.rotation;
    if (imageRel) node.image_rel = imageRel;
    if (!xfrm.found) node.inherited_geometry = true;
    return node;
  };
  var parseGraphicFrame = (frame) => {
    const nv = childByLocalName(frame, "nvGraphicFramePr");
    const xfrmEl = childByLocalName(frame, "xfrm");
    const xfrm = parseXfrm(xfrmEl);
    const common = parseNvProps(nv);
    let kind = "graphicFrame";
    const graphic = childByLocalName(frame, "graphic");
    const data = graphic ? childByLocalName(graphic, "graphicData") : void 0;
    const uri = data?.getAttribute("uri") ?? "";
    if (uri.includes("/table")) kind = "table";
    else if (uri.includes("/chart")) kind = "chart";
    const node = {
      id: common.id,
      name: common.name,
      kind,
      x: xfrm.x,
      y: xfrm.y,
      w: xfrm.w,
      h: xfrm.h
    };
    if (xfrm.rotation !== void 0 && xfrm.rotation !== 0) node.rotation = xfrm.rotation;
    if (!xfrm.found) node.inherited_geometry = true;
    return node;
  };
  var parseConnector = (cxn) => {
    const nv = childByLocalName(cxn, "nvCxnSpPr");
    const spPr = childByLocalName(cxn, "spPr");
    const common = parseNvProps(nv);
    const xfrm = parseXfrm(spPr ? childByLocalName(spPr, "xfrm") : void 0);
    const prstGeom = spPr ? childByLocalName(spPr, "prstGeom") : void 0;
    const node = {
      id: common.id,
      name: common.name,
      kind: "connector",
      x: xfrm.x,
      y: xfrm.y,
      w: xfrm.w,
      h: xfrm.h
    };
    const preset = prstGeom?.getAttribute("prst");
    if (preset) node.preset = preset;
    if (xfrm.rotation !== void 0 && xfrm.rotation !== 0) node.rotation = xfrm.rotation;
    if (!xfrm.found) node.inherited_geometry = true;
    return node;
  };
  var parseGroup = (grp) => {
    const nvGrpSpPr = childByLocalName(grp, "nvGrpSpPr");
    const grpSpPr = childByLocalName(grp, "grpSpPr");
    const common = parseNvProps(nvGrpSpPr);
    const xfrm = parseXfrm(grpSpPr ? childByLocalName(grpSpPr, "xfrm") : void 0);
    const children = [];
    for (const child of childElements(grp)) {
      const node2 = parseShapeElement(child);
      if (node2) children.push(node2);
    }
    const node = {
      id: common.id,
      name: common.name,
      kind: "group",
      x: xfrm.x,
      y: xfrm.y,
      w: xfrm.w,
      h: xfrm.h,
      children
    };
    if (xfrm.rotation !== void 0 && xfrm.rotation !== 0) node.rotation = xfrm.rotation;
    if (!xfrm.found) node.inherited_geometry = true;
    return node;
  };
  var parseShapeElement = (el) => {
    switch (el.localName) {
      case "sp":
        return parseSp(el);
      case "pic":
        return parsePic(el);
      case "graphicFrame":
        return parseGraphicFrame(el);
      case "cxnSp":
        return parseConnector(el);
      case "grpSp":
        return parseGroup(el);
      default:
        return null;
    }
  };
  var getSlideSize = (entries) => {
    const data = entries.get("ppt/presentation.xml");
    if (!data) return { width: 13.333, height: 7.5 };
    const xml = TEXT_DECODER.decode(data);
    const doc = parseXml2(xml);
    const sldSz = descendantsByLocalName(doc, "sldSz")[0];
    if (!sldSz) return { width: 13.333, height: 7.5 };
    const cx = Number.parseInt(sldSz.getAttribute("cx") ?? "0", 10);
    const cy = Number.parseInt(sldSz.getAttribute("cy") ?? "0", 10);
    return { width: emuToInches(cx), height: emuToInches(cy) };
  };
  var parseSlideLayout = (slideXml, slideNumber, canvas) => {
    const doc = parseXml2(slideXml);
    const root = doc.documentElement;
    if (!root) throw ToolError.internal("Empty slide XML");
    const cSld = firstDescendantByLocalName(root, "cSld");
    const spTree = cSld ? childByLocalName(cSld, "spTree") : void 0;
    if (!spTree) throw ToolError.internal("Slide XML has no spTree");
    const shapes = [];
    for (const child of childElements(spTree)) {
      const node = parseShapeElement(child);
      if (node) shapes.push(node);
    }
    return {
      slide_number: slideNumber,
      width: canvas.width,
      height: canvas.height,
      shapes
    };
  };

  // src/tools/schemas.ts
  var userSchema = z.object({
    id: z.string().describe("User ID"),
    display_name: z.string().describe("Display name"),
    email: z.string().describe("Email address")
  });
  var driveItemSchema = z.object({
    id: z.string().describe("Item ID"),
    name: z.string().describe("File or folder name"),
    size: z.number().describe("Size in bytes"),
    web_url: z.string().describe("Web URL to open the item"),
    mime_type: z.string().describe("MIME type (empty for folders)"),
    is_folder: z.boolean().describe("Whether this item is a folder"),
    created_by: z.string().describe("Display name of the creator"),
    created_at: z.string().describe("ISO 8601 creation timestamp"),
    modified_by: z.string().describe("Display name of the last modifier"),
    modified_at: z.string().describe("ISO 8601 last modified timestamp")
  });
  var driveSchema = z.object({
    id: z.string().describe("Drive ID"),
    name: z.string().describe("Drive name"),
    drive_type: z.string().describe("Drive type (personal, business, documentLibrary)"),
    total_bytes: z.number().describe("Total storage in bytes"),
    used_bytes: z.number().describe("Used storage in bytes"),
    remaining_bytes: z.number().describe("Remaining storage in bytes"),
    state: z.string().describe("Quota state (normal, nearing, critical, exceeded)")
  });
  var versionSchema = z.object({
    id: z.string().describe("Version ID"),
    modified_by: z.string().describe("Display name of the modifier"),
    modified_at: z.string().describe("ISO 8601 timestamp"),
    size: z.number().describe("Version size in bytes")
  });
  var permissionSchema = z.object({
    id: z.string().describe("Permission ID"),
    roles: z.array(z.string()).describe("Roles granted (read, write, owner)"),
    granted_to: z.string().describe("Display name of the grantee"),
    granted_to_email: z.string().describe("Email of the grantee"),
    link_url: z.string().describe("Sharing link URL (if link-based permission)"),
    link_type: z.string().describe("Link type (view, edit, embed) \u2014 empty if not a link"),
    link_scope: z.string().describe("Link scope (anonymous, organization, users) \u2014 empty if not a link")
  });
  var thumbnailSchema = z.object({
    url: z.string().describe("Thumbnail image URL"),
    width: z.number().describe("Width in pixels"),
    height: z.number().describe("Height in pixels")
  });
  var slideSchema = z.object({
    number: z.number().int().describe("Slide number (1-indexed)"),
    file: z.string().describe("Internal file path within the PPTX archive"),
    texts: z.array(z.string()).describe("Text content extracted from the slide"),
    has_notes: z.boolean().describe("Whether this slide has speaker notes")
  });
  var textRunSchema = z.object({
    text: z.string().describe("Run text content"),
    bold: z.boolean().optional().describe("Bold formatting"),
    italic: z.boolean().optional().describe("Italic formatting"),
    underline: z.boolean().optional().describe("Underline formatting"),
    size: z.number().optional().describe("Font size in points"),
    font: z.string().optional().describe("Font family name"),
    color: z.string().optional().describe('Hex color (e.g. "FFCC00") or "scheme:<name>" for theme colors')
  });
  var textParagraphSchema = z.object({
    runs: z.array(textRunSchema).describe("Formatted text runs within the paragraph"),
    align: z.enum(["left", "center", "right", "justify"]).optional().describe("Horizontal alignment"),
    level: z.number().int().optional().describe("Indent level (0 = top level)")
  });
  var shapeNodeSchema = z.lazy(
    () => z.object({
      id: z.string().describe("Shape id, unique within the slide"),
      name: z.string().describe("Shape name from authoring tool"),
      kind: z.enum(["textbox", "shape", "placeholder", "picture", "group", "table", "chart", "graphicFrame", "connector"]).describe("Shape category"),
      preset: z.string().optional().describe('Preset geometry name for shapes ("rect", "ellipse", ...)'),
      placeholder_type: z.string().optional().describe('Placeholder type ("title", "body", "ctrTitle", ...)'),
      x: z.number().describe("X offset from slide top-left in inches"),
      y: z.number().describe("Y offset from slide top-left in inches"),
      w: z.number().describe("Width in inches"),
      h: z.number().describe("Height in inches"),
      rotation: z.number().optional().describe("Rotation in degrees (clockwise)"),
      fill: z.string().optional().describe('Solid fill color \u2014 hex or "scheme:<name>" for theme colors'),
      text: z.array(textParagraphSchema).optional().describe("Text content with per-run formatting"),
      image_rel: z.string().optional().describe("Relationship id of embedded image (picture shapes only)"),
      children: z.array(shapeNodeSchema).optional().describe("Child shapes for group shapes"),
      inherited_geometry: z.boolean().optional().describe("True when position/size are inherited from the slide layout/master")
    })
  );
  var slideLayoutSchema = z.object({
    slide_number: z.number().int().describe("Slide number (1-indexed)"),
    width: z.number().describe("Slide canvas width in inches"),
    height: z.number().describe("Slide canvas height in inches"),
    shapes: z.array(shapeNodeSchema).describe("All top-level shapes on the slide")
  });

  // src/tools/get-slide-layout.ts
  var getSlideLayout = defineTool({
    name: "get_slide_layout",
    displayName: "Get Slide Layout",
    description: "Return the full structural layout of a slide \u2014 every shape, text box, placeholder, picture, table, and chart \u2014 with position, size, rotation, fill color, and text formatting. All positions and sizes are in inches. Use this to understand what is on a slide before editing. Each shape has a stable `id` that future edit tools will use as a handle.",
    summary: "Get the structural layout of a slide (shapes, positions, text, fill)",
    icon: "layout-grid",
    group: "Slides",
    input: z.object({
      item_id: z.string().describe("Item ID of the PowerPoint file"),
      slide_number: z.number().int().min(1).describe("Slide number to inspect (1-indexed)")
    }),
    output: z.object({
      layout: slideLayoutSchema.describe("Structured slide layout")
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
      const slideXml = TEXT_DECODER.decode(slideData);
      const canvas = getSlideSize(entries);
      const layout = parseSlideLayout(slideXml, params.slide_number, canvas);
      return { layout };
    }
  });

  // entries/get_slide_layout.js
  var found = Object.values(get_slide_layout_exports).filter((v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.handle === "function");
  var tools = found;
  return __toCommonJS(get_slide_layout_exports2);
})();

          var powerpointToolImplementations = {
            // get_slide_layout: upstream plugins/powerpoint/src/tools/get-slide-layout.ts
            async get_slide_layout(args) {
              var tool = __pw.tools && __pw.tools[0]
              if (!tool) throw new Error('PowerPoint tool get_slide_layout is missing from the bundled runtime')
              return await tool.handle(args)
            },
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await powerpointToolImplementations['get_slide_layout'](args)
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
