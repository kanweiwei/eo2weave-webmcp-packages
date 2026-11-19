// Self-contained adapter workflow. The Datadog session — the CSRF token the
// host app keeps in localStorage under `dd-csrf-token` — and every same-origin
// /api/... fetch stay inside the *.datadoghq.com tab.
//
// Ported from the OpenTabs datadog plugin (plugins/datadog/src, MIT): same
// endpoints, same request bodies, same CSRF headers, same output mappers. The
// page runtime below is that plugin's tool module bundled with a shim for the
// plugin-sdk slice it imports; the tool definition itself is upstream code.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "monitor_id": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991,
        "description": "Monitor ID to delete"
      }
    },
    "required": [
      "monitor_id"
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
    description: "delete_monitor",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        // --- page runtime -------------------------------------------------
        var DD = (() => {
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

          // entries/delete_monitor.ts
          var delete_monitor_exports2 = {};
          __export(delete_monitor_exports2, {
            assertPage: () => assertPage,
            error: () => error,
            ok: () => ok,
            toEnvelopeError: () => toEnvelopeError,
            tool: () => tool
          });

          // ../src/tools/delete-monitor.ts
          var delete_monitor_exports = {};
          __export(delete_monitor_exports, {
            deleteMonitor: () => deleteMonitor
          });

          // ../../../../tmp/dd/gen/shim.js
          var DEFAULT_TIMEOUT_MS = 18e3;
          var MAX_ERROR_BODY_LENGTH = 512;
          var ToolError = class _ToolError extends Error {
            constructor(message, code, opts) {
              super(message);
              this.name = "ToolError";
              this.code = code;
              this.retryable = (opts && opts.retryable) === true;
              this.retryAfterMs = opts && opts.retryAfterMs;
              this.category = opts && opts.category;
            }
            static auth(message, code) {
              return new _ToolError(message, code || "AUTH_ERROR", { category: "auth", retryable: false });
            }
            static notFound(message, code) {
              return new _ToolError(message, code || "NOT_FOUND", { category: "not_found", retryable: false });
            }
            static rateLimited(message, retryAfterMs, code) {
              return new _ToolError(message, code || "RATE_LIMITED", {
                category: "rate_limit",
                retryable: true,
                retryAfterMs
              });
            }
            static validation(message, code) {
              return new _ToolError(message, code || "VALIDATION_ERROR", { category: "validation", retryable: false });
            }
            static timeout(message, code) {
              return new _ToolError(message, code || "TIMEOUT", { category: "timeout", retryable: true });
            }
            static internal(message, code) {
              return new _ToolError(message, code || "INTERNAL_ERROR", { category: "internal", retryable: false });
            }
          };
          var defineTool = (def) => def;
          function getLocalStorage(key) {
            try {
              return localStorage.getItem(key);
            } catch (e) {
              return null;
            }
          }
          function parseRetryAfterMs(value) {
            var seconds = Number(value);
            if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1e3;
            return void 0;
          }
          function httpStatusToToolError(status, headers, message) {
            if (status === 401 || status === 403) return ToolError.auth(message);
            if (status === 404) return ToolError.notFound(message);
            if (status === 429) {
              var retryAfter = headers && typeof headers.get === "function" ? headers.get("Retry-After") : null;
              return ToolError.rateLimited(message, retryAfter !== null ? parseRetryAfterMs(retryAfter) : void 0);
            }
            if (status === 400 || status === 422) return ToolError.validation(message);
            if (status === 408) return ToolError.timeout(message);
            if (status >= 500) {
              var retryable = status === 500 || status === 502 || status === 503 || status === 504;
              return new ToolError(message, "http_error", { category: "internal", retryable });
            }
            if (status >= 400 && status < 500) return new ToolError(message, "http_error", { retryable: false });
            return new ToolError(message, "http_error", { category: "internal" });
          }
          async function fetchFromPage(url, init) {
            init = init || {};
            var timeout = init.timeout || DEFAULT_TIMEOUT_MS;
            var fetchInit = {
              method: init.method,
              headers: init.headers,
              body: init.body,
              credentials: 'include'
            };
            var controller = null;
            if (typeof AbortController === "function") {
              try {
                controller = new AbortController();
              } catch (e) {
                controller = null;
              }
            }
            var timer = controller !== null ? setTimeout(function() {
              try {
                controller.abort();
              } catch (e) {
              }
            }, timeout) : null;
            if (controller !== null) fetchInit.signal = controller.signal;
            var response;
            try {
              response = await fetch(url, fetchInit);
            } catch (error2) {
              if (timer !== null) clearTimeout(timer);
              var aborted = error2 && (error2.name === "AbortError" || String(error2).indexOf("abort") !== -1);
              if (aborted) throw ToolError.timeout("fetchFromPage: request timed out after " + timeout + "ms for " + url);
              throw new ToolError("fetchFromPage: network error for " + url + ": " + String(error2), "network_error", {
                category: "internal",
                retryable: true
              });
            }
            if (timer !== null) clearTimeout(timer);
            if (!response.ok) {
              var rawText = "";
              try {
                rawText = await response.text();
              } catch (e) {
              }
              var errorText = rawText.length > MAX_ERROR_BODY_LENGTH ? rawText.slice(0, MAX_ERROR_BODY_LENGTH) + "\u2026" : rawText;
              throw httpStatusToToolError(
                response.status,
                response.headers,
                "fetchFromPage: HTTP " + response.status + " for " + url + ": " + errorText
              );
            }
            return response;
          }
          async function fetchJSON(url, init) {
            var response = await fetchFromPage(url, init);
            if (response.status === 204) return void 0;
            try {
              return await response.json();
            } catch (e) {
              throw ToolError.validation("fetchJSON: failed to parse JSON response from " + url);
            }
          }

          // ../../../../tmp/dd/gen/zod-stub.js
          var stub = new Proxy(function zodStub() {
          }, {
            get(target, prop) {
              if (prop === "then") return void 0;
              return () => stub;
            },
            apply() {
              return stub;
            },
            construct() {
              return stub;
            }
          });
          var z = stub;

          // ../src/datadog-api.ts
          var getCsrfToken = () => {
            try {
              const raw = getLocalStorage("dd-csrf-token");
              if (!raw) return null;
              const parsed = JSON.parse(raw);
              return parsed.token ?? null;
            } catch {
              return null;
            }
          };
          var getAuth = () => {
            const csrfToken = getCsrfToken();
            return csrfToken ? { csrfToken } : null;
          };
          var requireAuth = () => {
            const auth = getAuth();
            if (!auth) throw ToolError.auth("Not authenticated \u2014 please log in to Datadog.");
            return auth;
          };
          var apiDelete = async (endpoint) => {
            const auth = requireAuth();
            return fetchJSON(endpoint, {
              method: "DELETE",
              headers: {
                "x-csrf-token": auth.csrfToken,
                "x-dd-csrf-token": auth.csrfToken
              }
            });
          };

          // ../src/tools/delete-monitor.ts
          var deleteMonitor = defineTool({
            name: "delete_monitor",
            displayName: "Delete Monitor",
            description: "Permanently delete a monitor. This action cannot be undone.",
            summary: "Delete a monitor by ID",
            icon: "trash",
            group: "Monitors",
            input: z.object({
              monitor_id: z.number().int().describe("Monitor ID to delete")
            }),
            output: z.object({
              success: z.boolean(),
              deleted_id: z.number().describe("ID of the deleted monitor")
            }),
            handle: async (params) => {
              await apiDelete(`/api/v1/monitor/${params.monitor_id}`);
              return { success: true, deleted_id: params.monitor_id };
            }
          });

          // shim.js
          function ok(data) {
            return { status: "ok", data, message: null };
          }
          function error(code, message) {
            return { status: "error", data: null, message, error_code: code };
          }
          function assertPage() {
            var host = "";
            try {
              host = String(location.hostname || "");
            } catch (e) {
              host = "";
            }
            if (!/(^|\.)datadoghq\.com$/.test(host)) {
              return error("UNSUPPORTED_PAGE", "Not on a Datadog (*.datadoghq.com) page.");
            }
            return null;
          }
          var ERROR_CODES = {
            AUTH_ERROR: "AUTH",
            NOT_FOUND: "NOT_FOUND",
            RATE_LIMITED: "RATE_LIMITED",
            VALIDATION_ERROR: "VALIDATION",
            TIMEOUT: "TIMEOUT",
            network_error: "NETWORK",
            http_error: "HTTP"
          };
          function toEnvelopeError(error2) {
            if (error2 && error2.name === "ToolError") {
              return {
                status: "error",
                data: null,
                message: error2.message || "Datadog API call failed",
                error_code: ERROR_CODES[error2.code] || String(error2.code || "ERROR").toUpperCase()
              };
            }
            return {
              status: "error",
              data: null,
              message: String(error2 && error2.message || error2 || "Datadog API call failed"),
              error_code: "UNKNOWN"
            };
          }

          // entries/delete_monitor.ts
          var tool = Object.keys(delete_monitor_exports).map((k) => delete_monitor_exports[k]).find((v) => v && v.name === "delete_monitor");
          return __toCommonJS(delete_monitor_exports2);
        })();

        var ok = DD.ok
        var error = DD.error
        var assertDatadogPage = DD.assertPage
        var toEnvelopeError = DD.toEnvelopeError

        var datadogToolImplementations = {
          async delete_monitor(args) {
            var pageError = assertDatadogPage()
            if (pageError) return pageError
            try {
              var data = await DD.tool.handle(args)
              return ok(data)
            } catch (e) {
              return toEnvelopeError(e)
            }
          },
        }
        return datadogToolImplementations["delete_monitor"](args)
      }
      let response
      try {
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(input) + ')',
          options,
        )
      } catch (error) {
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The Datadog tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Datadog API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Datadog tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
