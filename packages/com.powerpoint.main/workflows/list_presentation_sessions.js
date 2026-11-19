// Self-contained adapter workflow for upstream OpenTabs tool `list_presentation_sessions`
// (plugins/powerpoint/src/tools/list-presentation-sessions.ts, MIT). The PowerPoint
// Online runtime below is that plugin's own code — Microsoft Graph v1.0 paths,
// $select field lists, OOXML (ZIP + DrawingML) handling and mappers — compiled
// from the upstream TypeScript with esbuild and an inlined page-side SDK shim.
// It runs INSIDE the PowerPoint / SharePoint tab on the tab's session, so no
// token or file content is ever read out of the page or returned by this file.
export default {
  inputSchema: {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "sessions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "drive_id": {
              "type": "string"
            },
            "item_id": {
              "type": "string"
            },
            "opened_at": {
              "type": "number"
            },
            "last_accessed_at": {
              "type": "number"
            },
            "dirty": {
              "type": "boolean"
            },
            "slides": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            "idle_seconds": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "drive_id",
            "item_id",
            "opened_at",
            "last_accessed_at",
            "dirty",
            "slides",
            "idle_seconds"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "sessions"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_presentation_sessions',
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

  // entries/list_presentation_sessions.js
  var list_presentation_sessions_exports2 = {};
  __export(list_presentation_sessions_exports2, {
    tools: () => tools
  });

  // src/tools/list-presentation-sessions.ts
  var list_presentation_sessions_exports = {};
  __export(list_presentation_sessions_exports, {
    listPresentationSessionsTool: () => listPresentationSessionsTool
  });

  // sdk-shim.js
  function defineTool(definition) {
    return definition;
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

  // src/session.ts
  var SESSION_TTL_MS = 10 * 60 * 1e3;
  var SESSIONS_GLOBAL_KEY = "__opentabs_powerpoint_sessions";
  var sessionHost = globalThis;
  var sessions = sessionHost[SESSIONS_GLOBAL_KEY] ?? (sessionHost[SESSIONS_GLOBAL_KEY] = /* @__PURE__ */ new Map());
  var isExpired = (session, now) => now - session.lastAccessedAt > SESSION_TTL_MS;
  var listSessions = () => {
    const now = Date.now();
    for (const [key, s] of sessions) {
      if (isExpired(s, now)) sessions.delete(key);
    }
    return Array.from(sessions.values());
  };

  // src/pptx-utils.ts
  var isElement = (node) => node.nodeType === Node.ELEMENT_NODE;
  var getLocalName = (node) => isElement(node) ? node.localName : void 0;
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
  var listPresentationSessions = () => {
    const now = Date.now();
    return listSessions().map((s) => ({
      drive_id: s.driveId,
      item_id: s.itemId,
      opened_at: s.openedAt,
      last_accessed_at: s.lastAccessedAt,
      dirty: s.dirty,
      slides: getSlideList(s.entries).length,
      idle_seconds: Math.round((now - s.lastAccessedAt) / 1e3)
    }));
  };

  // src/tools/list-presentation-sessions.ts
  var listPresentationSessionsTool = defineTool({
    name: "list_presentation_sessions",
    displayName: "List Presentation Sessions",
    description: "List all open presentation sessions in the current tab, including which items are cached, whether they have dirty edits, and how long they have been idle. Useful for recovering context after a long conversation or confirming a session is still alive before committing.",
    summary: "List all open batched edit sessions",
    icon: "list",
    group: "Sessions",
    input: z.object({}),
    output: z.object({
      sessions: z.array(
        z.object({
          drive_id: z.string(),
          item_id: z.string(),
          opened_at: z.number(),
          last_accessed_at: z.number(),
          dirty: z.boolean(),
          slides: z.number().int(),
          idle_seconds: z.number().int()
        })
      )
    }),
    handle: () => Promise.resolve({ sessions: listPresentationSessions() })
  });

  // entries/list_presentation_sessions.js
  var found = Object.values(list_presentation_sessions_exports).filter((v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.handle === "function");
  var tools = found;
  return __toCommonJS(list_presentation_sessions_exports2);
})();

          var powerpointToolImplementations = {
            // list_presentation_sessions: upstream plugins/powerpoint/src/tools/list-presentation-sessions.ts
            async list_presentation_sessions(args) {
              var tool = __pw.tools && __pw.tools[0]
              if (!tool) throw new Error('PowerPoint tool list_presentation_sessions is missing from the bundled runtime')
              return await tool.handle(args)
            },
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await powerpointToolImplementations['list_presentation_sessions'](args)
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
