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
      "name": {
        "type": "string",
        "description": "Notebook title"
      },
      "cells": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "markdown",
                "timeseries",
                "log_stream"
              ],
              "description": "Cell type"
            },
            "content": {
              "type": "string",
              "description": "Cell content (markdown text or metric query)"
            }
          },
          "required": [
            "type",
            "content"
          ],
          "additionalProperties": false
        },
        "description": "Notebook cells"
      },
      "time_span": {
        "description": "Relative time span (e.g., \"1h\", \"4h\", \"1d\"). Default: \"1h\"",
        "type": "string"
      }
    },
    "required": [
      "name",
      "cells"
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
    description: "create_notebook",
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

          // entries/create_notebook.ts
          var create_notebook_exports2 = {};
          __export(create_notebook_exports2, {
            assertPage: () => assertPage,
            error: () => error,
            ok: () => ok,
            toEnvelopeError: () => toEnvelopeError,
            tool: () => tool
          });

          // ../src/tools/create-notebook.ts
          var create_notebook_exports = {};
          __export(create_notebook_exports, {
            createNotebook: () => createNotebook
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

          // ../src/tools/schemas.ts
          var jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
          var jsonValueSchema = z.lazy(
            () => z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
          );
          var monitorOptionsSchema = z.record(z.string(), jsonValueSchema);
          var monitorSchema = z.object({
            id: z.number().describe("Monitor ID"),
            name: z.string().describe("Monitor name"),
            type: z.string().describe("Monitor type (e.g., query alert, service check, metric alert)"),
            query: z.string().describe("Monitor query"),
            message: z.string().describe("Notification message"),
            tags: z.array(z.string()).describe("Monitor tags"),
            overall_state: z.string().describe("Current state (OK, Alert, Warn, No Data)"),
            priority: z.number().nullable().describe("Monitor priority (1-5, null if unset)"),
            options: monitorOptionsSchema.describe(
              "Monitor evaluation and notification options, including thresholds and no-data behavior"
            ),
            created: z.string().describe("Creation timestamp"),
            modified: z.string().describe("Last modification timestamp"),
            creator: z.object({
              name: z.string().nullable().describe("Creator name"),
              handle: z.string().describe("Creator email handle")
            })
          });
          var monitorSearchResultSchema = z.object({
            id: z.number().describe("Monitor ID"),
            name: z.string().describe("Monitor name"),
            type: z.string().describe("Monitor type"),
            overall_state: z.string().describe("Current state"),
            tags: z.array(z.string()).describe("Monitor tags")
          });
          var dashboardSummarySchema = z.object({
            id: z.string().describe("Dashboard ID"),
            title: z.string().describe("Dashboard title"),
            description: z.string().describe("Dashboard description"),
            author_handle: z.string().describe("Author email handle"),
            created_at: z.string().describe("Creation timestamp"),
            modified_at: z.string().describe("Last modification timestamp"),
            url: z.string().describe("Dashboard URL path"),
            is_read_only: z.boolean().describe("Whether dashboard is read-only")
          });
          var sloSchema = z.object({
            id: z.string().describe("SLO ID"),
            name: z.string().describe("SLO name"),
            description: z.string().describe("SLO description"),
            type: z.string().describe("SLO type (metric or monitor)"),
            tags: z.array(z.string()).describe("SLO tags"),
            overall_status: z.array(
              z.object({
                timeframe: z.string().describe("Timeframe (7d, 30d, 90d)"),
                sli_value: z.number().nullable().describe("Current SLI value"),
                target: z.number().describe("Target percentage"),
                status: z.string().describe("Status (OK, warning, breached)")
              })
            ),
            created_at: z.number().describe("Creation timestamp (epoch seconds)"),
            modified_at: z.number().describe("Last modification timestamp (epoch seconds)"),
            creator: z.object({
              name: z.string().nullable().describe("Creator name"),
              handle: z.string().describe("Creator email handle")
            })
          });
          var hostSchema = z.object({
            name: z.string().describe("Host name"),
            id: z.number().describe("Host ID"),
            aliases: z.array(z.string()).describe("Host aliases"),
            apps: z.array(z.string()).describe("Running integrations"),
            is_muted: z.boolean().describe("Whether host is muted"),
            last_reported_time: z.number().describe("Last reported time (epoch seconds)"),
            tags_by_source: z.record(z.string(), z.array(z.string())).describe("Tags organized by source"),
            meta: z.object({
              platform: z.string().describe("Platform (e.g., linux, windows)"),
              agent_version: z.string().describe("Datadog agent version")
            })
          });
          var serviceSchema = z.object({
            name: z.string().describe("Service name"),
            schema_version: z.string().describe("Schema version"),
            team: z.string().describe("Owning team"),
            contacts: z.array(
              z.object({
                type: z.string().describe("Contact type (slack, email, etc.)"),
                contact: z.string().describe("Contact value")
              })
            ),
            links: z.array(
              z.object({
                name: z.string().describe("Link name"),
                type: z.string().describe("Link type (repo, doc, runbook, etc.)"),
                url: z.string().describe("Link URL")
              })
            ),
            tags: z.array(z.string()).describe("Service tags")
          });
          var notebookSchema = z.object({
            id: z.number().describe("Notebook ID"),
            name: z.string().describe("Notebook name"),
            author: z.object({
              handle: z.string().describe("Author email handle"),
              name: z.string().nullable().describe("Author name")
            }),
            status: z.string().describe("Notebook status"),
            created: z.string().describe("Creation timestamp"),
            modified: z.string().describe("Last modification timestamp")
          });
          var mapNotebook = (n) => ({
            id: n.id ?? 0,
            name: n.attributes?.name ?? "",
            author: {
              handle: n.attributes?.author?.handle ?? "",
              name: n.attributes?.author?.name ?? null
            },
            status: n.attributes?.status ?? "",
            created: n.attributes?.created ?? "",
            modified: n.attributes?.modified ?? ""
          });
          var syntheticTestSchema = z.object({
            public_id: z.string().describe("Test public ID"),
            name: z.string().describe("Test name"),
            type: z.string().describe("Test type (api, browser, mobile)"),
            subtype: z.string().describe("Test subtype (http, ssl, tcp, dns, etc.)"),
            status: z.string().describe("Test status (live, paused)"),
            tags: z.array(z.string()).describe("Test tags"),
            locations: z.array(z.string()).describe("Test locations"),
            message: z.string().describe("Notification message"),
            created_at: z.string().describe("Creation timestamp"),
            modified_at: z.string().describe("Last modification timestamp")
          });
          var downtimeSchema = z.object({
            id: z.string().describe("Downtime ID"),
            display_timezone: z.string().describe("Display timezone"),
            message: z.string().describe("Downtime message"),
            scope: z.string().describe("Downtime scope"),
            status: z.string().describe("Downtime status"),
            schedule: z.object({
              start: z.string().describe("Start time"),
              end: z.string().nullable().describe("End time (null if indefinite)")
            }),
            monitor_identifier: z.object({
              monitor_id: z.number().nullable().describe("Specific monitor ID"),
              monitor_tags: z.array(z.string()).describe("Monitor tags to match")
            }),
            created: z.string().describe("Creation timestamp")
          });
          var spanSchema = z.object({
            span_id: z.string().describe("Span ID"),
            trace_id: z.string().describe("Trace ID"),
            service: z.string().describe("Service name"),
            resource: z.string().describe("Resource name"),
            operation_name: z.string().describe("Operation name"),
            duration: z.number().describe("Duration in nanoseconds"),
            start: z.string().describe("Start timestamp"),
            status: z.string().describe("Span status (ok, error, info)"),
            tags: z.record(z.string(), z.string()).describe("Span tags")
          });
          var logEntrySchema = z.object({
            id: z.string().describe("Log entry ID"),
            timestamp: z.string().describe("Log timestamp"),
            status: z.string().describe("Log status (info, warn, error, etc.)"),
            service: z.string().describe("Service name"),
            host: z.string().describe("Host name"),
            message: z.string().describe("Log message"),
            tags: z.array(z.string()).describe("Log tags")
          });
          var metricSeriesSchema = z.object({
            metric: z.string().describe("Metric name"),
            scope: z.string().describe("Scope/tag set"),
            pointlist: z.array(z.tuple([z.number(), z.number()])).describe("Array of [timestamp_ms, value] pairs"),
            unit: z.array(z.object({ name: z.string() })).nullable().describe("Unit info")
          });
          var metricMetadataSchema = z.object({
            type: z.string().describe("Metric type (gauge, rate, count)"),
            description: z.string().describe("Metric description"),
            short_name: z.string().describe("Short name"),
            unit: z.string().describe("Metric unit"),
            per_unit: z.string().describe("Per unit"),
            integration: z.string().describe("Integration name")
          });
          var metricTagConfigurationSchema = z.object({
            id: z.string().describe("Configured metric name"),
            type: z.string().describe("Datadog resource type (manage_tags)"),
            metric_type: z.string().describe("Metric type (count, gauge, rate, or distribution)"),
            tags: z.array(z.string()).describe("Indexed tag keys, or excluded tag keys when exclusion mode is enabled"),
            exclude_tags_mode: z.boolean().describe("Whether the listed tags are excluded instead of being the only indexed tags"),
            include_percentiles: z.boolean().nullable().describe("Whether percentile aggregations are enabled for a distribution metric; null for other metric types"),
            aggregations: z.array(
              z.object({
                space: z.string().describe("Spatial aggregation method"),
                time: z.string().describe("Temporal aggregation method")
              })
            ).describe("Configured aggregation methods; retained by Datadog for existing configurations"),
            created_at: z.string().describe("Configuration creation timestamp"),
            modified_at: z.string().describe("Configuration modification timestamp")
          });
          var userSchema = z.object({
            uuid: z.string().describe("User UUID"),
            name: z.string().describe("User display name"),
            handle: z.string().describe("User email handle"),
            email: z.string().describe("User email"),
            title: z.string().describe("User title"),
            status: z.string().describe("User status"),
            verified: z.boolean().describe("Whether email is verified"),
            disabled: z.boolean().describe("Whether account is disabled"),
            icon: z.string().describe("User avatar URL")
          });
          var incidentSchema = z.object({
            id: z.string().describe("Incident ID"),
            title: z.string().describe("Incident title"),
            status: z.string().describe("Incident status (active, stable, resolved)"),
            severity: z.string().describe("Incident severity (SEV-1 through SEV-5)"),
            created: z.string().describe("Creation timestamp"),
            modified: z.string().describe("Last modification timestamp"),
            commander: z.string().describe("Incident commander handle"),
            customer_impacted: z.boolean().describe("Whether customers are impacted")
          });

          // ../src/tools/create-notebook.ts
          var createNotebook = defineTool({
            name: "create_notebook",
            displayName: "Create Notebook",
            description: "Create a new Datadog notebook with markdown and metric cells.",
            summary: "Create a new notebook",
            icon: "plus",
            group: "Notebooks",
            input: z.object({
              name: z.string().describe("Notebook title"),
              cells: z.array(
                z.object({
                  type: z.enum(["markdown", "timeseries", "log_stream"]).describe("Cell type"),
                  content: z.string().describe("Cell content (markdown text or metric query)")
                })
              ).describe("Notebook cells"),
              time_span: z.string().optional().describe('Relative time span (e.g., "1h", "4h", "1d"). Default: "1h"')
            }),
            output: z.object({
              notebook: notebookSchema
            }),
            handle: async (params) => {
              const cells = params.cells.map((c) => ({
                type: "notebook_cells",
                attributes: {
                  definition: c.type === "markdown" ? { type: "markdown", text: c.content } : c.type === "timeseries" ? {
                    type: "timeseries",
                    requests: [{ q: c.content, display_type: "line" }]
                  } : { type: "log_stream", query: c.content }
                }
              }));
              const data = await apiPost("/api/v1/notebooks", {
                data: {
                  type: "notebooks",
                  attributes: {
                    name: params.name,
                    status: "published",
                    time: { live_span: params.time_span ?? "1h" },
                    cells
                  }
                }
              });
              return { notebook: mapNotebook(data.data ?? {}) };
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

          // entries/create_notebook.ts
          var tool = Object.keys(create_notebook_exports).map((k) => create_notebook_exports[k]).find((v) => v && v.name === "create_notebook");
          return __toCommonJS(create_notebook_exports2);
        })();

        var ok = DD.ok
        var error = DD.error
        var assertDatadogPage = DD.assertPage
        var toEnvelopeError = DD.toEnvelopeError

        var datadogToolImplementations = {
          async create_notebook(args) {
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
        return datadogToolImplementations["create_notebook"](args)
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
