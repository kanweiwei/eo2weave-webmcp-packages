# Grafana WebMCP package (com.grafana.main 0.1.0)

Full port of the OpenTabs Grafana plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/grafana) into the
builtin WebMCP package format: **all 29 upstream tools, no subset**.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-grafana@0.0.89` `dist/tools.json`): same 29 tool
names, same input property sets, same `required` lists, same JSON Schema per
field (`integer` + `minimum`/`maximum` for `list_org_users`' `page`/`per_page`
and `search_dashboards`' `limit`, `enum: ["dash-db","dash-folder"]` for
`search_dashboards.type`, `number` for the epoch-millisecond and pagination
parameters, `array of string` for tags, and a **string** for
`create_dashboard.panels` — a JSON document, exactly as upstream declares it).

The plugin is REST-only upstream — `src/` never calls a GraphQL endpoint — so no
GraphQL call was invented for this port.

## Host and activation (Grafana is self-hosted)

Upstream ships `urlPatterns: []` and asks the user for `instanceUrl` in its
`configSchema`; there is no fixed Grafana host to pin. A WebMCP package has no
per-package config, so the port cannot carry an instance URL either:

- Every tool declares the same `urlRegex`, `^https?://[^/?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$`,
  which constrains the scheme but **no host** — that is the only pattern that
  covers `grafana.internal`, `myorg.grafana.net`, `localhost:3000`, and an
  instance mounted on an unrelated domain (`https://monitoring.example.com/grafana/`).
- Activation is therefore decided at call time, in the page, by
  `assertPage()`: a tab is a Grafana tab when its host looks like Grafana
  (`localhost`, `127.0.0.1`, `*.grafana.net`, or any host containing `grafana`),
  **or** when the page itself proves it by exposing `grafanaBootData` (the same
  boot global upstream reads). Anything else returns `UNSUPPORTED_PAGE` with
  **no network request** — a non-Grafana tab can never leak a request.
- Trade-off, stated plainly: a narrow `grafana.*`-only regex would silently fail
  to activate on a real instance mounted on a domain without the product name in
  it. Broad matching puts the identity decision in the runtime instead. If the
  registry prefers a tight host pattern, replacing the single `urlRegex` string
  in `manifest.json` is the whole change; the runtime gate stays as the second
  check.

## Transport (same as the Grafana web client)

Every call runs inside the Grafana tab:

- **Endpoints** — same-origin `location.origin` + `appSubUrl` + `/api<endpoint>`;
  alerting uses the provisioning API at `…/api/v1/provisioning/...`. No endpoint
  is invented: each one is the literal path in the upstream tool. The base comes
  from the tab's own `grafanaBootData.settings.appSubUrl`, so an instance mounted
  under a sub-path (`root_url = https://host/grafana/`) is called at
  `https://host/grafana/api/...` instead of the origin root upstream would hit.
  Write tools (`POST`/`DELETE`) number 10 across 8 endpoints; the other 19 tools
  are plain GETs with no request body.
- **Auth** — the browser's own first-party Grafana session cookie via
  `credentials: 'include'`. No cookie, token or session value is read out of the
  page, stored, or returned; nothing about the session leaves page context.
- **CSRF** — upstream sends no CSRF header and `grafanaBootData` carries no
  token, so none is invented here. Requests carry `Accept: application/json`,
  plus `Content-Type: application/json` when a JSON body is sent (GETs send no
  content type). The browser's own `Origin` handling applies to the non-GET
  calls.
- **Session signal** — `grafanaBootData.user.isSignedIn === true`, exactly
  upstream's `isAuthenticated()`. When the boot global is absent (tab still
  loading) the runtime polls it at 500ms for up to 5s, upstream's
  `waitForAuth()` parameters; once the global exists the answer cannot change
  without a reload, so a logged-out call fails immediately instead of stalling.
- **Error classification** — 401/403 → `AUTH`, 404 → `NOT_FOUND`, 429 →
  `RATE_LIMITED` (`Retry-After` echoed), 400/422 → `VALIDATION`, 408 →
  `TIMEOUT`, 5xx/other 4xx → `HTTP`, no JSON body → `VALIDATION`, aborted or
  network failure → `TIMEOUT`/`NETWORK`, no boot user → `UNAUTHENTICATED`-style
  `AUTH`. Grafana's own `message`/`error` is surfaced, bodies truncated at 512
  chars.
- The in-page fetch aborts after **18s** so it always settles inside the
  adapter's 25s command window.

## Tools (29)

| Tool | Mechanics | Grafana endpoint |
| --- | --- | --- |
| `get_current_user` | map id/uid/login/orgId/isGrafanaAdmin | `GET /api/user` |
| `get_user_preferences` | map theme/homeDashboardUID/timezone/language | `GET /api/user/preferences` |
| `get_organization` | flatten `address.*` into address1/2, city, state, zipCode, country | `GET /api/org` |
| `list_org_users` | `page`/`per_page` → `page`/`perpage` | `GET /api/org/users` |
| `list_org_quotas` | target/limit/used | `GET /api/org/quotas` |
| `search_dashboards` | query/tag/type/starred, `folder_uids` → `folderUIDs`, limit/page | `GET /api/search` |
| `get_dashboard` | `dashboard` + `meta` → one flat record, `panel_count` from panels | `GET /api/dashboards/uid/:uid` |
| `create_dashboard` | POST body `{dashboard:{title,tags,panels,schemaVersion:39},folderUid,overwrite:false}`; `panels` parsed from a JSON string | `POST /api/dashboards/db` |
| `update_dashboard` | read current version + folder, apply title/tags, save with that version | `GET /api/dashboards/uid/:uid` → `POST /api/dashboards/db` |
| `delete_dashboard` | permanent delete → `{success:true}` | `DELETE /api/dashboards/uid/:uid` |
| `star_dashboard` | star by UID | `POST /api/user/stars/dashboard/uid/:uid` |
| `unstar_dashboard` | unstar by UID | `DELETE /api/user/stars/dashboard/uid/:uid` |
| `list_folders` | optional limit/page | `GET /api/folders` |
| `get_folder` | by UID | `GET /api/folders/:uid` |
| `create_folder` | `{title, uid?}` — uid omitted unless supplied | `POST /api/folders` |
| `delete_folder` | deletes the folder and its dashboards | `DELETE /api/folders/:uid` |
| `list_datasources` | map type/typeName/isDefault/readOnly/access | `GET /api/datasources` |
| `get_datasource` | by UID | `GET /api/datasources/uid/:uid` |
| `list_alert_rules` | map folderUID/ruleGroup/for/execErrState/noDataState | `GET /api/v1/provisioning/alert-rules` |
| `get_alert_rule` | by UID | `GET /api/v1/provisioning/alert-rules/:uid` |
| `delete_alert_rule` | permanent delete → `{success:true}` | `DELETE /api/v1/provisioning/alert-rules/:uid` |
| `list_contact_points` | uid/name/type/disableResolveMessage/provenance | `GET /api/v1/provisioning/contact-points` |
| `list_annotations` | `dashboard_uid`→`dashboardUID`, `panel_id`→`panelId`, tags/from/to/limit | `GET /api/annotations` |
| `create_annotation` | text + optional dashboardUID/panelId/tags/time/timeEnd | `POST /api/annotations` |
| `delete_annotation` | by numeric id | `DELETE /api/annotations/:id` |
| `search_teams` | `per_page`→`perPage`, returns `total_count` from `totalCount` | `GET /api/teams/search` |
| `list_team_members` | by team id | `GET /api/teams/:id/members` |
| `list_service_accounts` | `per_page`→`perPage`, `totalCount` | `GET /api/serviceaccounts/search` |
| `list_snapshots` | id/name/key/external/expires | `GET /api/dashboard/snapshots` |

Every tool returns the package envelope `{status, data, message, error_code}`
(`page_url` on the page side). The mapping is a straight transliteration of
upstream's `tools/schemas.ts` mappers, including the `?? 0` / `?? ''` /
`?? false` defaults, so an absent field is always a typed default rather than
`undefined`.

## Deviations from upstream (all deliberate)

1. **No `instanceUrl` config.** A WebMCP package has no config surface; the
   instance is the tab's own origin. Upstream's `instanceUrl` only selects the
   API base, and `location.origin` is the same value for the tab the call runs
   in.
2. **No `urlPatterns: []` equivalent.** See "Host and activation" — the runtime
   identity gate replaces the missing config.
3. **`waitForAuth()` is skipped when boot data is already present.** Upstream
   polls for 5s on every readiness check; in a call path that cannot help, so the
   wait only applies while the boot global is missing.
4. **Tool errors are returned, not thrown.** Upstream throws `ToolError`; the
   package format carries the same classification in `error_code` + `message`.
5. **`encodeURIComponent` on path parameters.** Upstream interpolates UIDs
   directly; encoding only changes behaviour for a UID containing a reserved
   character, which Grafana never issues.
6. **Defensive array mapping.** A non-array payload maps to `[]` instead of
   throwing a `TypeError` out of the workflow; valid responses are unaffected.
7. **`appSubUrl` is part of the API base.** Upstream builds a root-relative
   `/api<endpoint>`, which only resolves at the origin root; the port prefixes
   the instance's own `grafanaBootData.settings.appSubUrl` (normalized, trailing
   slash and full-URL forms included, `''` for a normal install) so sub-path
   installs hit `…/grafana/api/...`.

## Verification

`node scripts/test-packages.mjs` covers this package in four layers:

- **Contract** — manifest id/version, unique tool names, anchored compiling
  `urlRegex`, workflow exports `{inputSchema, outputSchema, tree, result}`, one
  `async <tool>(args)` implementation per tool, `credentials: 'include'`, no page
  navigation.
- **Parity** — the 29 tool names and every input property/`required` list are
  compared against the cached upstream `dist/tools.json`.
- **Execution** (`scripts/tests/com.grafana.main.test.mjs`) — 40 stubbed-tab
  calls, at least one per tool, all 29 covered: request URL/method/query/body
  assertions for the search, dashboard, folder, data-source, alerting,
  annotation, team, service-account, snapshot, org, quota, preference and user
  reads and every write; `AUTH` with zero requests on a logged-out tab;
  `UNSUPPORTED_PAGE` with zero requests on a non-Grafana tab; a self-hosted
  instance on a host with no "grafana" in it (including its `appSubUrl`);
  404/403/500/non-JSON classification; and the `urlRegex` both ways (arbitrary
  instance origins, subpath installs, `localhost:3000`;
  `ftp:`/`file:`/`javascript:`/hostless rejected).
- **CI gate** — `scripts/validate-package.mjs`.

Not verified (no live Grafana instance was reachable from this environment, so
response shapes are replayed fixtures, not recorded ones):

- **Provisioned dashboards.** `update_dashboard` against a provisioned dashboard
  makes Grafana answer 400/412 with a provisioning message; the port classifies
  by status (400 → `VALIDATION`, 412 → `HTTP`, since the SDK's mapping has no 412
  case). Not exercised live.
- **Version conflicts.** `create_dashboard`/`update_dashboard` with
  `overwrite: false` can come back as a 412 "version mismatch" or "already
  exists"; the status classification above is all the port does with it.
- **Legacy alerting.** `/api/alerts` and the unified-alerting preview endpoints
  are untouched — upstream only uses `v1/provisioning`, so nothing was added.
- **Auth beyond the session cookie.** Grafana Cloud's service-account tokens and
  basic-auth are not implemented, matching upstream (session cookie only).
- **`appSubUrl` on a live sub-path install** is covered by fixtures only
  (`/grafana` and a full-URL `root_url`), not by a real mounted instance.
- **`list_org_users`' `per_page` (1000) and `search_dashboards`' `limit` (5000)**
  are Grafana-side defaults; the port sends neither unless the caller supplies
  it, exactly like upstream.
