// Self-contained adapter workflow for upstream OpenTabs tool `list_versions`
// (plugins/powerpoint/src/tools/list-versions.ts, MIT). The PowerPoint
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
        "description": "Item ID of the file"
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
      "versions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Version ID"
            },
            "modified_by": {
              "type": "string",
              "description": "Display name of the modifier"
            },
            "modified_at": {
              "type": "string",
              "description": "ISO 8601 timestamp"
            },
            "size": {
              "type": "number",
              "description": "Version size in bytes"
            }
          },
          "required": [
            "id",
            "modified_by",
            "modified_at",
            "size"
          ],
          "additionalProperties": false
        },
        "description": "Version history entries"
      }
    },
    "required": [
      "versions"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_versions',
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

  // entries/list_versions.js
  var list_versions_exports2 = {};
  __export(list_versions_exports2, {
    tools: () => tools
  });

  // src/tools/list-versions.ts
  var list_versions_exports = {};
  __export(list_versions_exports, {
    listVersions: () => listVersions
  });

  // sdk-shim.js
  function defineTool(definition) {
    return definition;
  }
  function buildQueryString(params) {
    if (!params) return "";
    const search = new URLSearchParams();
    for (const key of Object.keys(params)) {
      const value = params[key];
      if (value === void 0 || value === null) continue;
      search.append(key, String(value));
    }
    return search.toString();
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
  function parseRetryAfterMs(value) {
    if (value === null || value === void 0) return void 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
    const at = Date.parse(String(value));
    if (Number.isNaN(at)) return void 0;
    return Math.max(0, at - Date.now());
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
  var getCurrentDriveId = async () => (await requireAuth()).driveId;
  var api = async (endpoint, options = {}) => {
    const auth = await requireAuth();
    const qs = options.query ? buildQueryString(options.query) : "";
    const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${auth.token}`
    };
    let fetchBody;
    if (options.body !== void 0) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: fetchBody,
        credentials: "omit",
        signal: AbortSignal.timeout(3e4)
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError")
        throw ToolError.timeout(`API request timed out: ${endpoint}`);
      if (err instanceof DOMException && err.name === "AbortError") throw new ToolError("Request was aborted", "aborted");
      throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, "network_error", {
        category: "internal",
        retryable: true
      });
    }
    if (!response.ok) {
      const errorBody = (await response.text().catch(() => "")).substring(0, 512);
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : void 0;
        throw ToolError.rateLimited(`Rate limited: ${endpoint} \u2014 ${errorBody}`, retryMs);
      }
      if (response.status === 401 || response.status === 403) {
        authError(`Auth error (${response.status}): ${errorBody}`);
      }
      if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} \u2014 ${errorBody}`);
      if (response.status === 400 || response.status === 409)
        throw ToolError.validation(`Validation error (${response.status}): ${endpoint} \u2014 ${errorBody}`);
      throw ToolError.internal(`API error (${response.status}): ${endpoint} \u2014 ${errorBody}`);
    }
    if (response.status === 202 || response.status === 204) return {};
    return await response.json();
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
  var mapVersion = (v) => ({
    id: v.id ?? "",
    modified_by: v.lastModifiedBy?.user?.displayName ?? "",
    modified_at: v.lastModifiedDateTime ?? "",
    size: v.size ?? 0
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

  // src/tools/list-versions.ts
  var listVersions = defineTool({
    name: "list_versions",
    displayName: "List File Versions",
    description: "List version history of a file. Returns all saved versions with modifier, timestamp, and size.",
    summary: "List version history of a file",
    icon: "history",
    group: "Files",
    input: z.object({
      item_id: z.string().describe("Item ID of the file")
    }),
    output: z.object({
      versions: z.array(versionSchema).describe("Version history entries")
    }),
    handle: async (params) => {
      const driveId = await getCurrentDriveId();
      const data = await api(`/drives/${driveId}/items/${params.item_id}/versions`);
      return { versions: (data.value ?? []).map(mapVersion) };
    }
  });

  // entries/list_versions.js
  var found = Object.values(list_versions_exports).filter((v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.handle === "function");
  var tools = found;
  return __toCommonJS(list_versions_exports2);
})();

          var powerpointToolImplementations = {
            // list_versions: upstream plugins/powerpoint/src/tools/list-versions.ts
            async list_versions(args) {
              var tool = __pw.tools && __pw.tools[0]
              if (!tool) throw new Error('PowerPoint tool list_versions is missing from the bundled runtime')
              return await tool.handle(args)
            },
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await powerpointToolImplementations['list_versions'](args)
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
