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
      "query": {
        "type": "string",
        "description": "Search query to filter spans (e.g., \"service:web-store\", \"@http.status_code:500\")"
      },
      "compute": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "aggregation": {
              "type": "string",
              "enum": [
                "count",
                "avg",
                "sum",
                "min",
                "max",
                "cardinality"
              ],
              "description": "Aggregation function"
            },
            "field": {
              "description": "Field to aggregate on (use \"*\" or omit for count)",
              "type": "string"
            },
            "type": {
              "description": "Compute type (default: total)",
              "type": "string",
              "enum": [
                "total",
                "timeseries"
              ]
            }
          },
          "required": [
            "aggregation"
          ],
          "additionalProperties": false
        },
        "description": "Aggregation computations to perform"
      },
      "group_by": {
        "description": "Grouping configuration",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "facet": {
              "type": "string",
              "description": "Field name to group by (e.g., \"service\", \"resource_name\")"
            },
            "limit": {
              "description": "Max number of groups",
              "type": "number"
            },
            "sort": {
              "type": "object",
              "properties": {
                "aggregation": {
                  "type": "string",
                  "description": "Aggregation to sort by"
                },
                "order": {
                  "type": "string",
                  "enum": [
                    "asc",
                    "desc"
                  ],
                  "description": "Sort order"
                }
              },
              "required": [
                "aggregation",
                "order"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "facet"
          ],
          "additionalProperties": false
        }
      },
      "from": {
        "description": "Start time (default now-1h)",
        "type": "string"
      },
      "to": {
        "description": "End time (default now)",
        "type": "string"
      }
    },
    "required": [
      "query",
      "compute"
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
    description: "aggregate_spans",
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

          // entries/aggregate_spans.ts
          var aggregate_spans_exports2 = {};
          __export(aggregate_spans_exports2, {
            assertPage: () => assertPage,
            error: () => error,
            ok: () => ok,
            toEnvelopeError: () => toEnvelopeError,
            tool: () => tool
          });

          // ../src/tools/aggregate-spans.ts
          var aggregate_spans_exports = {};
          __export(aggregate_spans_exports, {
            aggregateSpans: () => aggregateSpans
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
          function buildQueryString(params) {
            var search = new URLSearchParams();
            var keys = Object.keys(params || {});
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]];
              if (value === void 0) continue;
              if (Array.isArray(value)) {
                for (var j = 0; j < value.length; j++) search.append(keys[i], String(value[j]));
              } else {
                search.append(keys[i], String(value));
              }
            }
            return search.toString();
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
          var apiWrite = async (method, endpoint, body, query) => {
            const auth = requireAuth();
            const qs = query ? buildQueryString(query) : "";
            const url = qs ? `${endpoint}?${qs}` : endpoint;
            const bodyWithToken = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body, _authentication_token: auth.csrfToken } : body;
            return fetchJSON(url, {
              method,
              headers: {
                "Content-Type": "application/json",
                "x-csrf-token": auth.csrfToken,
                "x-dd-csrf-token": auth.csrfToken
              },
              body: JSON.stringify(bodyWithToken)
            });
          };
          var apiPost = async (endpoint, body, query) => apiWrite("POST", endpoint, body, query);

          // ../src/tools/aggregate-spans.ts
          var aggregateSpans = defineTool({
            name: "aggregate_spans",
            displayName: "Aggregate Spans",
            description: "Aggregate Datadog APM spans to compute counts, sums, averages, min, max, and cardinality, with optional grouping by fields or time intervals. Use this for aggregated analysis such as request counts over time, average duration by service, or error counts grouped by endpoint.",
            summary: "Aggregate APM span data with grouping",
            icon: "bar-chart",
            group: "APM",
            input: z.object({
              query: z.string().describe('Search query to filter spans (e.g., "service:web-store", "@http.status_code:500")'),
              compute: z.array(
                z.object({
                  aggregation: z.enum(["count", "avg", "sum", "min", "max", "cardinality"]).describe("Aggregation function"),
                  field: z.string().optional().describe('Field to aggregate on (use "*" or omit for count)'),
                  type: z.enum(["total", "timeseries"]).optional().describe("Compute type (default: total)")
                })
              ).describe("Aggregation computations to perform"),
              group_by: z.array(
                z.object({
                  facet: z.string().describe('Field name to group by (e.g., "service", "resource_name")'),
                  limit: z.number().optional().describe("Max number of groups"),
                  sort: z.object({
                    aggregation: z.string().describe("Aggregation to sort by"),
                    order: z.enum(["asc", "desc"]).describe("Sort order")
                  }).optional()
                })
              ).optional().describe("Grouping configuration"),
              from: z.string().optional().describe("Start time (default now-1h)"),
              to: z.string().optional().describe("End time (default now)")
            }),
            output: z.object({
              data: z.unknown().describe("Aggregation result buckets"),
              meta: z.unknown().describe("Query metadata")
            }),
            handle: async (params) => {
              const data = await apiPost("/api/v2/spans/analytics/aggregate", {
                data: {
                  type: "aggregate_request",
                  attributes: {
                    filter: {
                      query: params.query,
                      from: params.from ?? "now-1h",
                      to: params.to ?? "now"
                    },
                    compute: params.compute.map((c) => ({
                      aggregation: c.aggregation,
                      ...c.field ? { metric: c.field } : {},
                      type: c.type ?? "total"
                    })),
                    ...params.group_by?.length ? { group_by: params.group_by } : {}
                  }
                }
              });
              return { data: data.data ?? null, meta: data.meta ?? null };
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

          // entries/aggregate_spans.ts
          var tool = Object.keys(aggregate_spans_exports).map((k) => aggregate_spans_exports[k]).find((v) => v && v.name === "aggregate_spans");
          return __toCommonJS(aggregate_spans_exports2);
        })();

        var ok = DD.ok
        var error = DD.error
        var assertDatadogPage = DD.assertPage
        var toEnvelopeError = DD.toEnvelopeError

        var datadogToolImplementations = {
          async aggregate_spans(args) {
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
        return datadogToolImplementations["aggregate_spans"](args)
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
