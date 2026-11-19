# com.datadog.main

Datadog for the app the tab is already logged into: monitors, dashboards, SLOs,
logs, APM, metrics, infrastructure, services, notebooks, synthetics, downtimes,
users, RUM, incidents, teams, security signals and admin settings — 75 tools,
the full upstream OpenTabs `datadog` plugin.

Every tool runs inside the current `*.datadoghq.com` tab: same-origin
`/api/...` fetches with the tab's session cookies, exactly the transport the
Datadog web app itself uses.

## Auth and transport

- **Credential**: Datadog keeps its CSRF token in `localStorage` under
  `dd-csrf-token` as JSON (`{ token, timestamp }`). The runtime re-reads it on
  every call — never caches it, because the host app rotates the token and a
  cached copy makes writes fail with 401 (logs) / 403 (spans) until cleared.
  A missing or unparseable entry fails fast as `AUTH` without touching the
  network; `GET` calls need it too, mirroring upstream.
- **Reads**: `GET` to the same-origin path, `credentials: 'include'`, no
  special header (the session cookie authenticates).
- **Writes**: `POST`/`PUT`/`PATCH`/`DELETE` with
  `x-csrf-token` + `x-dd-csrf-token` headers and, for JSON bodies, the token
  duplicated as `body._authentication_token` — upstream does both.
- **Internal UI endpoints**: a few features (monitor state history, the
  multi-query timeseries engine) go through Datadog's own `/api/ui/...` routes,
  as the app does.
- **Timeouts**: the in-page fetch aborts at 18 s so a slow call fails as
  `TIMEOUT` instead of being orphaned by the 25 s browser command deadline.

Errors are classified the way the SDK does it: 401/403 → `AUTH`, 404 →
`NOT_FOUND`, 429 → `RATE_LIMITED`, 400/422 → `VALIDATION`, 500 → `HTTP`,
aborted/network → `TIMEOUT` / `NETWORK`.

## Tools

All 75 tools share one host scope:
`^https://(?:[^/?#]+\.)?datadoghq\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$`

### Monitors (13)

| Tool | Request | Description |
| --- | --- | --- |
| `list_monitors` | `GET /api/v1/monitor` | List monitors in the Datadog organization. Supports filtering by tags and pagination. Returns monitor details including name, type, query, state, and tags. |
| `get_monitor` | `GET /api/v1/monitor/{id}` | Get detailed information about a specific Datadog monitor by its ID. |
| `search_monitors` | `GET /api/v1/monitor/search` | Search for monitors by query string. Supports searching by name, status, tags, and other attributes. Use Datadog monitor search syntax (e.g., "status:Alert", "tag:env:prod", "type:metric"). |
| `mute_monitor` | `POST /api/v1/monitor/{id}/mute` | Mute a monitor so it does not trigger alerts. Optionally specify a scope and end time. |
| `unmute_monitor` | `POST /api/v1/monitor/{id}/unmute` | Unmute a previously muted monitor so it resumes alerting. |
| `delete_monitor` | `DELETE /api/v1/monitor/{id}` | Permanently delete a monitor. This action cannot be undone. |
| `list_monitor_tags` | `GET /api/v1/monitor/tags` | List all tags used across monitors. Useful for discovering available filter values. |
| `get_monitor_groups` | `GET /api/v1/monitor/{id}` | Get the status of individual groups for a multi-alert monitor. Useful for seeing which specific hosts, services, or tag combinations are alerting. |
| `get_monitor_state_history` | `POST /api/ui/monitor/evaluation_preview` | Preview the evaluation results of a monitor over a time range. Shows the timeseries data that the monitor evaluates against. |
| `create_monitor` | `POST /api/v1/monitor` | Create a new Datadog monitor. Supports metric, service check, event, log, process, synthetics, and other monitor types. |
| `update_monitor` | `PUT /api/v1/monitor/{id}` | Update an existing Datadog monitor. Only specified fields are changed. |
| `list_monitor_downtimes` | `GET /api/v1/monitor/{id}` | Get downtimes associated with a specific monitor. |
| `clone_monitor` | `GET /api/v1/monitor/{id}`<br>`POST /api/v1/monitor` | Clone an existing monitor to create a copy. Optionally override the name, query, message, or tags on the clone. The original monitor is not modified. |

### Dashboards (6)

| Tool | Request | Description |
| --- | --- | --- |
| `list_dashboards` | `GET /api/v1/dashboard` | List all dashboards in the Datadog organization. Returns dashboard summaries with titles, authors, and URLs. |
| `get_dashboard` | `GET /api/v1/dashboard/{id}` | Get full details of a Datadog dashboard by ID, including its widgets, layout, and template variables. |
| `search_dashboards` | `GET /api/v1/dashboard` | Search dashboards by title or description. Performs a client-side substring match across all dashboards. |
| `search_dashboards_advanced` | `GET /api/v1/dashboard` | Search dashboards with advanced filters including author handle. Performs client-side filtering across all dashboards. |
| `delete_dashboard` | `DELETE /api/v1/dashboard/{id}` | Permanently delete a Datadog dashboard. This action cannot be undone. |
| `clone_dashboard` | `GET /api/v1/dashboard/{id}`<br>`POST /api/v1/dashboard` | Clone an existing dashboard to create a copy. Optionally override the title or description. The original dashboard is not modified. |

### SLOs (5)

| Tool | Request | Description |
| --- | --- | --- |
| `list_slos` | `GET /api/v1/slo` | List Service Level Objectives (SLOs) in the Datadog organization with optional tag filtering. |
| `get_slo` | `GET /api/v1/slo/{id}` | Get detailed information about a specific Service Level Objective (SLO) by ID. |
| `get_slo_history` | `GET /api/v1/slo/{id}/history` | Get historical SLO data for a specific timeframe. Returns SLI values, error budget remaining, and uptime data. |
| `search_slos` | `GET /api/v1/slo` | Search SLOs by name using substring matching. |
| `list_slo_corrections` | `GET /api/v1/slo/correction` | List all SLO status corrections in the Datadog organization. |

### Logs (1)

| Tool | Request | Description |
| --- | --- | --- |
| `search_logs` | `POST /api/v1/logs-analytics/list` | Search Datadog logs using query syntax. Supports filtering by service, host, status, tags, and free text. Uses the Datadog log query language (e.g., "service:my-app status:error", "@http.status_code:500"). |

### APM (4)

| Tool | Request | Description |
| --- | --- | --- |
| `search_spans` | `POST /api/v2/spans/events/search` | Search APM spans/traces using Datadog query syntax. Filter by service, resource, operation, status, duration, and tags (e.g., "service:web-store", "@http.status_code:500", "@duration:>5000000"). |
| `get_trace` | `GET /api/v1/trace/{id}` | Get a full trace by trace ID from Datadog APM. Accepts either hex or decimal trace IDs. Returns all spans within the trace, including orphaned spans. |
| `aggregate_spans` | `POST /api/v2/spans/analytics/aggregate` | Aggregate Datadog APM spans to compute counts, sums, averages, min, max, and cardinality, with optional grouping by fields or time intervals. Use this for aggregated analysis such as request counts over time, average duration by service, or error counts grouped by endpoint. |
| `get_service_dependencies` | `GET /api/v1/service_dependencies/{id}` | Get upstream and downstream service dependencies for an APM service. Returns services that call this service and services this service calls. |

### Metrics (9)

| Tool | Request | Description |
| --- | --- | --- |
| `query_metrics` | `GET /api/v1/query` | Query time-series metric data from Datadog. Use standard metric query syntax with aggregation, scope, and optional group-by (e.g., "avg:system.cpu.user{env:prod} by {host}"). |
| `list_metrics` | `GET /api/v1/metrics` | List metric names available in Datadog. Filter by prefix to narrow results. |
| `get_metric_metadata` | `GET /api/v1/metrics/{id}` | Get metadata for a specific metric including type, description, unit, and integration name. |
| `query_timeseries` | `POST /api/ui/query/timeseries` | Execute a multi-query timeseries request using the Datadog internal query engine. Supports metrics, logs, spans, and other data sources with formula support. |
| `list_metric_tags` | `GET /api/ui/metrics/all-tags/{id}` | List all tags associated with a specific metric. Useful for understanding available dimensions for filtering and grouping. |
| `get_metric_tag_configuration` | `GET /api/v2/metrics/{id}/tags` | Get the Metrics without Limits tag configuration for a metric, including its indexed or excluded tag keys, metric type, aggregation settings, and timestamps. |
| `create_metric_tag_configuration` | `POST /api/v2/metrics/{id}/tags` | Create a Metrics without Limits tag configuration for a metric that does not already have one. Returns the saved metric type, indexed or excluded tag keys, percentile setting, and timestamps. |
| `update_metric_tag_configuration` | `PATCH /api/v2/metrics/{id}/tags` | Update an existing Metrics without Limits tag configuration. Change any combination of tag keys, exclusion mode, or distribution percentiles. Returns the saved configuration. |
| `delete_metric_tag_configuration` | `DELETE /api/v2/metrics/{id}/tags` | Delete a Metrics without Limits tag configuration. The metric continues to exist, but Datadog resumes indexing all submitted tags for it. |

### Infrastructure (6)

| Tool | Request | Description |
| --- | --- | --- |
| `list_hosts` | `GET /api/v1/hosts` | List infrastructure hosts reporting to Datadog. Supports filtering by name and pagination. |
| `mute_host` | `POST /api/v1/host/{id}/mute` | Mute a host to suppress all monitor alerts originating from it. |
| `unmute_host` | `POST /api/v1/host/{id}/unmute` | Unmute a previously muted host to resume alerting. |
| `get_host_totals` | `GET /api/v1/hosts/totals` | Get the total number of active and up hosts in the organization. |
| `list_host_tags` | `GET /api/v1/tags/hosts/{id}` | List all tags for a specific host, organized by source (e.g., datadog-agent, cloud provider). |
| `get_host_info` | `GET /api/v1/hosts` | Get detailed information about a specific host by hostname. |

### Services (3)

| Tool | Request | Description |
| --- | --- | --- |
| `list_services` | `GET /api/v2/services/definitions` | List service definitions from the Datadog service catalog. Returns service names, owning teams, contacts, and links. |
| `get_service_definition` | `GET /api/v2/services/definitions/{id}` | Get the full service catalog definition for a specific service, including team, contacts, links, and tags. |
| `search_services` | `GET /api/v2/services/definitions` | Search services in the service catalog by name, team, or other attributes. |

### Notebooks (6)

| Tool | Request | Description |
| --- | --- | --- |
| `list_notebooks` | `GET /api/v1/notebooks` | List Datadog notebooks with optional text search. Notebooks are collaborative documents with time-synced data widgets. |
| `get_notebook` | `GET /api/v1/notebooks/{id}` | Get full details of a Datadog notebook by ID, including its cells and metadata. |
| `search_notebooks` | `GET /api/v1/notebooks` | Search Datadog notebooks by name. Returns matching notebooks sorted by modification time. |
| `create_notebook` | `POST /api/v1/notebooks` | Create a new Datadog notebook with markdown and metric cells. |
| `update_notebook` | `PUT /api/v1/notebooks/{id}` | Update an existing Datadog notebook — change name, cells, or time span. |
| `delete_notebook` | `DELETE /api/v1/notebooks/{id}` | Permanently delete a Datadog notebook. This action cannot be undone. |

### Synthetics (5)

| Tool | Request | Description |
| --- | --- | --- |
| `list_synthetics_tests` | `GET /api/v1/synthetics/tests` | List synthetic monitoring tests (API, browser, mobile). Supports filtering by page size. |
| `get_synthetics_test` | `GET /api/v1/synthetics/tests/{id}` | Get detailed information about a specific synthetic test by public ID. |
| `get_synthetics_results` | `GET /api/v1/synthetics/tests/{id}/results` | Get recent execution results for a synthetic test. |
| `trigger_synthetics_test` | `POST /api/v1/synthetics/tests/trigger` | Trigger an on-demand run of a synthetic test. Returns the triggered results with batch ID. |
| `pause_synthetics_test` | `PUT /api/v1/synthetics/tests/{id}/status` | Pause or resume a synthetic test by changing its status. |

### Downtimes (4)

| Tool | Request | Description |
| --- | --- | --- |
| `list_downtimes` | `GET /api/v2/downtime` | List scheduled downtimes (maintenance windows) in the Datadog organization. |
| `get_downtime` | `GET /api/v2/downtime/{id}` | Get detailed information about a specific scheduled downtime by ID. |
| `cancel_downtime` | `DELETE /api/v2/downtime/{id}` | Cancel a scheduled downtime by ID. This resumes alerting for the affected monitors. |
| `create_downtime` | `POST /api/v2/downtime` | Create a scheduled downtime (maintenance window) in Datadog. |

### Users (3)

| Tool | Request | Description |
| --- | --- | --- |
| `get_current_user` | `GET /api/v2/current_user` | Get the profile of the currently authenticated Datadog user. |
| `list_users` | `GET /api/v2/users` | List users in the Datadog organization. Supports filtering and pagination. |
| `get_user` | `GET /api/v2/users/{id}` | Get detailed information about a specific user by UUID. |

### RUM (2)

| Tool | Request | Description |
| --- | --- | --- |
| `search_rum_events` | `POST /api/v2/rum/events/search` | Search Real User Monitoring (RUM) events. Filter by event type, user, URL, browser, and more using Datadog query syntax (e.g., "@type:error", "@view.url:*/checkout/*", "@usr.id:user123"). |
| `aggregate_rum_events` | `POST /api/v2/rum/analytics/aggregate` | Aggregate Datadog RUM events to compute counts, sums, averages, min, max, and cardinality, with optional grouping by fields or time intervals. Use this for aggregated analysis of RUM data such as session counts over time, error counts by page, or average loading times by browser. |

### Incidents (2)

| Tool | Request | Description |
| --- | --- | --- |
| `list_incidents` | `GET /api/v2/incidents` | List incidents in the Datadog organization. Supports filtering by status and pagination. Note: Incident Management must be enabled. |
| `get_incident` | `GET /api/v2/incidents/{id}` | Get detailed information about a specific incident by ID. |

### Teams (1)

| Tool | Request | Description |
| --- | --- | --- |
| `list_teams` | `GET /api/v2/team` | List teams in the Datadog organization. |

### Security (1)

| Tool | Request | Description |
| --- | --- | --- |
| `search_security_signals` | `POST /api/v2/security_monitoring/signals/search` | Search security signals in Datadog Security Monitoring. |

### Admin (4)

| Tool | Request | Description |
| --- | --- | --- |
| `get_permissions` | `GET /api/v2/permissions` | List all available permissions in the Datadog organization. Useful for understanding role-based access. |
| `get_org_config` | `GET /api/v2/org_configs/{id}` | Get a specific organization configuration value by name. |
| `list_api_keys` | `GET /api/v2/api_keys` | List API keys in the Datadog organization. |
| `get_usage_summary` | `GET /api/v1/usage/summary` | Get usage summary for the Datadog organization over a time range. |

## Deviations from upstream

1. **No `waitForAuth` on load.** Upstream's plugin class waits up to 5 s for the
   token to appear before declaring itself ready; the adapter calls a tool only
   when the user asks, so the token is read per call and a missing one is a
   plain `AUTH` error instead of a plugin-readiness state.
2. **Envelope, not a bare object.** Every workflow returns
   `{ status, data, message, error_code }` with the upstream tool output under
   `data`, like the rest of this repo. The upstream per-tool `output` schema is
   not published as the workflow `outputSchema` (that one describes the
   envelope); the payload shape is documented per tool above.
3. **18 s in-page abort.** Upstream relies on the SDK's 30 s timeout; the tab
   deadline here is 25 s, so the fetch is cut at 18 s.
4. **Regional sites.** Only `*.datadoghq.com` is in scope, as upstream's
   `urlPatterns` says. The EU site (`app.datadoghq.eu`) is *not* matched — the
   upstream plugin does not support it either.
5. **Token read on `GET` too.** Upstream calls `requireAuth()` before reads;
   the port keeps that, so a tab whose localStorage was cleared reports `AUTH`
   before the request rather than an opaque 302/401.
6. **Generated runtime.** Each workflow carries the upstream tool module
   (handler + mappers + `datadog-api.ts`) bundled with a shim for the plugin-sdk
   slice it uses (`ToolError`, `fetchJSON`, `buildQueryString`,
   `getLocalStorage`, `waitUntil`, `defineTool`) and an identity stand-in for
   `zod` (the schemas are declarative; the host validates arguments against the
   published JSON Schema). The handler, endpoint, body and mapper code is
   upstream's, unmodified.

## Tests

`scripts/tests/com.datadog.main.test.mjs` (run by `npm test`) covers:

- the urlRegex scope, with matching and non-matching hosts;
- monitor reads (`list_monitors`, `get_monitor`) and writes (`mute_monitor`,
  `create_monitor`, `update_monitor`) — URL, query defaults, CSRF headers and
  body token, typed body fields, and the parsed output;
- dashboards (`get_dashboard`, widget/template-variable unwrapping);
- logs (`search_logs` internal analytics body incl. the 15-minute default
  window) and metrics (`query_metrics`, `query_timeseries`);
- incidents, SLOs and users;
- failure paths: missing/corrupt token (no request attempted), 404, 429, 500,
  422 and a non-Datadog page;
- a smoke pass that runs all 75 tools end to end against a stubbed response and
  checks each returns an envelope without failing on auth/page/plumbing.

Schema and name parity with the published
`@opentabs-dev/opentabs-plugin-datadog` manifest is asserted centrally by
`scripts/test-packages.mjs` from `.cache/opentabs/datadog-tools.json`.

## Unverified paths

- Everything above runs against stubbed responses; no call was executed against
  a live Datadog organization.
- Tools whose response the stub could not shape (`list_monitors` returns a bare
  array) are exercised for plumbing only in the smoke pass.
- Write tools that cannot be undone (`delete_dashboard`, `delete_notebook`,
  `delete_monitor`, `cancel_downtime`, `trigger_synthetics_test`) are verified
  at the request level only — never against a real org.
