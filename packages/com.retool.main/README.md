# com.retool.main

Full port of the OpenTabs `retool` plugin (`@opentabs-dev/opentabs-plugin-retool` 0.0.89,
`plugins/retool/src`, MIT) — **50 / 50 upstream tools**, reads and writes.

Every tool runs inside the Retool tab you already have open: the HttpOnly session cookies
ride along (`credentials: 'include'`), the CSRF token is the page's own non-HttpOnly
`xsrfToken` cookie sent as `X-Xsrf-Token`, and every request is a same-origin `/api/...`
fetch. No token is ever read out of the page, stored, or forwarded to a third party.

## Transport

Ported from `src/retool-api.ts` and `src/toolscript.ts`:

- **Auth gate** — `xsrfToken` cookie present, else `UNAUTHENTICATED` with no request.
  A missing/invalid session surfaces as `AUTH` from 401/403.
- **Request shape** — `Content-Type: application/json` **and** `X-Xsrf-Token` on every
  call (upstream sets both unconditionally, including bodyless GET/POST), JSON body when
  one exists, `credentials: 'include'`, 18 s in-page abort.
- **Error mapping** — 401/403 `AUTH`, 404 `NOT_FOUND`, 429 `RATE_LIMITED` (echoes
  `Retry-After`), 400/422 `VALIDATION`, 408 `TIMEOUT`, other 4xx/5xx `HTTP`, aborted
  `TIMEOUT`, transport failure `NETWORK`, unparseable body `PARSE`.
- **Off-host guard** — refused with `UNSUPPORTED_PAGE` before any request when the tab is
  not on `retool.com` / `*.retool.com`.
- **App state** — apps are edited through Retool's Transit-encoded `appState` string:
  `get_app_state` → edit → `save_page`, and `add_component` / `add_query` do the Transit
  surgery themselves and save with the same optimistic-lock body
  (`saveValidationInfo.pageSaveId` + `multiplayerSessionId`).
- **Toolscript** — `export_toolscript_archive`, `create_app_from_toolscript_archive`,
  `update_app_from_toolscript_archive` and `force_editor_save` use Retool's **own
  browser-side Toolscript compiler / editor store**: the helper (`toolscriptHelpers-*.js`),
  codec (`main-*.js`) and `sendSave-*.js` chunks are discovered from the app's loaded
  `/assets_vjs/*` scripts, imported, and driven exactly as the editor does.

## Endpoints used

| Endpoint | Tools |
|---|---|
| `GET /api/user` | `get_current_user` |
| `POST /api/user/changeName` | `change_user_name` |
| `GET /api/organization` | `get_organization` |
| `GET /api/organization/userSpaces` | `list_user_spaces` |
| `GET /api/experiments` | `list_experiments` |
| `GET /api/pages` | `list_apps` |
| `GET /api/editor/pageNames` | `list_page_names` |
| `GET /api/pages/uuids/{uuid}` | `get_app`, `get_app_state`, `list_components`, `add_component`, `add_query`, `save_page`, `update_app_from_toolscript_archive` |
| `POST /api/pages/lookupPage` | `lookup_app` |
| `GET /api/pages/uuids/{uuid}/documentation` | `get_app_docs` |
| `GET /api/pages/uuids/{uuid}/tags` | `list_app_tags` |
| `GET /api/pages/uuids/{uuid}/saves` | `list_page_saves` |
| `POST /api/pages/uuids/{uuid}/export?branch=` | `export_toolscript_archive` |
| `POST /api/pages/uuids/{uuid}/save` | `save_page`, `add_component`, `add_query`, `update_app_from_toolscript_archive` |
| `POST /api/pages/createPage` | `create_app`, `create_app_from_toolscript_archive` |
| `POST /api/pages/clonePage` | `clone_app` |
| `POST /api/pages/deletePage` | `delete_app` |
| `POST /api/folders/createFolder` | `create_folder` |
| `POST /api/folders/renameFolder` | `rename_folder` |
| `POST /api/folders/deleteFolder` | `delete_folder` |
| `GET /api/resources` | `list_resources`, `get_resource`, `add_query`, `run_query`, `run_grpc` |
| `POST /api/resources` | `create_resource` |
| `POST /api/resourceFolders/createResourceFolder` | `create_resource_folder` |
| `POST /api/resourceFolders/deleteResourceFolder` | `delete_resource_folder` |
| `POST /api/resourceFolders/moveResourceToFolder` | `move_resource_to_folder` |
| `GET /api/workflow/` | `list_workflows` |
| `GET /api/workflow/{id}?branchName=` | `get_workflow` |
| `GET /api/workflow/{id}/releases` | `get_workflow_releases` |
| `GET /api/workflow/workflowsConfiguration` | `get_workflows_config` |
| `POST /api/workflowRun/getRuns?workflowId=&limit=&offset=` | `list_workflow_runs` |
| `GET /api/workflowRun/{runId}` | `get_workflow_run` |
| `GET /api/workflowRun/getLog?runId=` | `get_workflow_run_log` |
| `GET /api/workflowRun/getCountByWorkflow` | `get_workflow_run_count` |
| `GET /api/workflowTrigger?workflowId=` | `list_workflow_triggers` |
| `GET /api/environments` | `list_environments` |
| `GET /api/branches` | `list_branches` |
| `GET /api/sourceControl/settings` | `get_source_control_settings` |
| `GET /api/playground` | `list_playground_queries` |
| `POST /api/playground/query` | `run_query` (SQL), `run_grpc` (gRPC) |
| `GET /api/grid` | `list_grids` |
| `GET /api/agents` | `list_agents` |

## Tools

**Users** — `get_current_user`, `change_user_name`.
**Organization** — `get_organization`, `list_user_spaces`, `list_experiments`.
**Apps** — `list_apps`, `get_app`, `get_app_state`, `lookup_app`, `get_app_docs`,
`list_app_tags`, `list_page_names`, `list_page_saves`, `list_components`, `create_app`,
`export_toolscript_archive`, `create_app_from_toolscript_archive`,
`update_app_from_toolscript_archive`, `force_editor_save`, `clone_app`, `save_page`,
`add_component`, `add_query`, `delete_app`.
**Folders** — `create_folder`, `rename_folder`, `delete_folder`.
**Resources** — `list_resources`, `get_resource`, `create_resource`,
`create_resource_folder`, `delete_resource_folder`, `move_resource_to_folder`.
**Workflows** — `list_workflows`, `get_workflow`, `list_workflow_runs`, `get_workflow_run`,
`get_workflow_run_log`, `list_workflow_triggers`, `get_workflow_releases`,
`get_workflow_run_count`, `get_workflows_config`.
**Environments** — `list_environments`.
**Source control** — `list_branches`, `get_source_control_settings`.
**Queries** — `list_playground_queries`, `run_query`, `run_grpc`.
**Database** — `list_grids`.
**Agents** — `list_agents`.

All 50 tool input schemas are the upstream JSON Schemas verbatim (real `number`,
`integer`, `boolean`, `enum`, `array` and `object` types — no string-typed stand-ins),
and each workflow declares the upstream `output_schema` as well.

## Execution tests

`scripts/tests/com.retool.main.test.mjs` stubs an `acme.retool.com` tab and asserts real
requests and parsed output for: app/page/workflow/resource/environment reads, the Transit
`list_components` parse, `add_component` + `add_query` appState surgery and save bodies,
`save_page` optimistic locking (with and without a branch), `create_app` / `clone_app` /
`create_folder` / `rename_folder` / `delete_folder` / `create_resource` /
`create_resource_folder` / `delete_resource_folder` / `move_resource_to_folder` /
`delete_app` / `change_user_name` writes, `run_query` + `run_grpc` playground bodies,
CSRF header and cookie transport, `get_app_docs` text/JSON/empty bodies, auth failures
(missing cookie and 401), 403/404/422/429/500/invalid-JSON classification, off-host
refusal and network failure, plus a cross-section smoke pass over all 50 tools.

## Deviations

- **`urlRegex` is `https://retool.com` and `*.retool.com` only.** Upstream also supports
  self-hosted instances through its `instanceUrl` config; this registry package ships
  `config.json` `{}` and a single host pattern, so a self-hosted Retool is not matched.
  The workflows themselves are instance-relative (no host is hardcoded), so adding a host
  pattern is all a self-hosted install would need.
- **Off-host guard.** Upstream is only ever loaded on a matching tab; the port re-checks
  the host inside the page runtime and returns `UNSUPPORTED_PAGE` instead of firing a
  request from another origin.
- **`base64_zip` shape is validated before decoding.** Upstream relies on `atob` throwing;
  the port checks the base64 alphabet/modulus first so a malformed archive reports
  `VALIDATION` on every engine instead of depending on `atob` strictness.
- **`get_app` / `lookup_app` return the raw endpoint envelope under `page`**, exactly as
  upstream does, while the other page tools read `data.page` — the asymmetry is upstream's,
  not introduced here.
- **`save_page` accepts `commit_message` but never transmits it** (upstream does not either;
  the field is decorative in the schema).
- **Toolscript fallback asset hashes** (`toolscriptHelpers-CViOCr-a.js`,
  `main-DNKK9RAp.js`, `sendSave-CM0VM8H0.js`) are upstream constants and rotate with every
  Retool deploy; discovery from loaded `/assets_vjs/*` chunks runs first and normally wins.

## Unverified paths

The four Toolscript tools are ported in full but their success paths cannot be exercised in
the harness: they `import()` Retool's own hashed asset modules (`toolscriptHelpers-*`,
`main-*` G()/Transit codec, `sendSave-*` store action creators) and drive the live editor
store, which only exists in a real Retool editor tab. What *is* verified: the export API
round-trip start (`POST /api/pages/uuids/{uuid}/export` with the branch query) and that a
missing serializer fails loudly as `INTERNAL`; base64 validation (no request, `VALIDATION`)
for `create_app_from_toolscript_archive` and `update_app_from_toolscript_archive`; the
smoke pass asserts a well-formed envelope for `force_editor_save`. The compile → save /
editor-import success paths remain to be exercised in a real tab.
