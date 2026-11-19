// Self-contained adapter workflow for upstream OpenTabs tool `reauthenticate`
// (plugins/powerpoint/src/tools/reauthenticate.ts, MIT). The PowerPoint
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
      "status": {
        "type": "string",
        "enum": [
          "reloading",
          "skipped"
        ]
      },
      "message": {
        "type": "string"
      }
    },
    "required": [
      "status",
      "message"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'reauthenticate',
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

  // entries/reauthenticate.js
  var reauthenticate_exports2 = {};
  __export(reauthenticate_exports2, {
    tools: () => tools
  });

  // src/tools/reauthenticate.ts
  var reauthenticate_exports = {};
  __export(reauthenticate_exports, {
    reauthenticate: () => reauthenticate
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
  function clearAuthCache() {
    const namespace = getPageGlobal("__openTabs.preScript.powerpoint");
    if (namespace && typeof namespace === "object") {
      try {
        delete namespace.graph;
        delete namespace.graphCapturedAt;
      } catch {
      }
    }
  }

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
  var isSharePointPresentation = () => {
    try {
      const url = new URL(getCurrentUrl());
      return url.hostname.toLowerCase().endsWith(".sharepoint.com") && url.pathname.includes("/:p:/");
    } catch {
      return false;
    }
  };

  // src/tools/reauthenticate.ts
  var LS_TOKEN_KEY = "__opentabs_powerpoint_graph_token";
  var reauthenticate = defineTool({
    name: "reauthenticate",
    displayName: "Reauthenticate",
    description: "Clear cached MSAL state and reload the SharePoint/OneDrive tab to force a fresh Microsoft Graph token. Use this when another PowerPoint tool returns an authentication error pointing at this tool. After invoking, wait ~5 seconds for the tab to finish reloading, then retry the original operation.",
    summary: "Force a fresh Microsoft Graph token by clearing stale MSAL state and reloading the tab",
    icon: "refresh-cw",
    group: "Account",
    input: z.object({}),
    output: z.object({
      status: z.enum(["reloading", "skipped"]),
      message: z.string()
    }),
    handle: async () => {
      if (!isSharePointPresentation()) {
        return {
          status: "skipped",
          message: "This tab is not a SharePoint/OneDrive presentation \u2014 reauthenticate has no effect here. If you are seeing AUTH_ERROR on a standalone powerpoint.cloud.microsoft tab, sign in to Microsoft 365 in this browser session."
        };
      }
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("msal.") || k === LS_TOKEN_KEY)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
      clearAuthCache("powerpoint");
      setTimeout(() => {
        const reloadFn = location.reload;
        if (typeof reloadFn === "function") reloadFn.call(location);
      }, 50);
      return {
        status: "reloading",
        message: "Cleared cached MSAL state and reloading the tab. The pre-script will capture a fresh Graph token from the next AAD round-trip (silent via SSO cookies). Wait ~5 seconds, then retry the original tool call."
      };
    }
  });

  // entries/reauthenticate.js
  var found = Object.values(reauthenticate_exports).filter((v) => v && typeof v === "object" && typeof v.name === "string" && typeof v.handle === "function");
  var tools = found;
  return __toCommonJS(reauthenticate_exports2);
})();

          var powerpointToolImplementations = {
            // reauthenticate: upstream plugins/powerpoint/src/tools/reauthenticate.ts
            async reauthenticate(args) {
              var tool = __pw.tools && __pw.tools[0]
              if (!tool) throw new Error('PowerPoint tool reauthenticate is missing from the bundled runtime')
              return await tool.handle(args)
            },
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await powerpointToolImplementations['reauthenticate'](args)
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
