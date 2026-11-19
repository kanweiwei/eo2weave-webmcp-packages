# HCP Terraform WebMCP package (com.terraform-cloud.main 0.1.0)

Full port of the OpenTabs HCP Terraform / Terraform Cloud plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/terraform-cloud)
into the builtin WebMCP package format: all 38 upstream tools, no subset
(read tools, every write tool and the destroy/cancel paths included).

Every call runs inside the `app.terraform.io` tab. The transport is the app's own
same-origin API: `/api/v2` with `Content-Type: application/vnd.api+json`,
`credentials: 'include'` so the HttpOnly session cookie travels with the
request, and a `X-CSRF-Token` header on every non-GET, read from the shell's
hidden `input[name="authenticity_token"]`. JSON:API request bodies
(`{ data: { type, attributes, relationships } }`) are built exactly as upstream
builds them, and `DELETE` answers 204 with no body, mapped to `{}` like upstream.

Auth is detected the way upstream detects it — the global sidebar menu
(`[data-test-sidebar-menu-global]`) only renders for a signed-in user, while the
bare `#tfe-app` shell also exists for logged-out visitors. A logged-out tab
returns `AUTH_ERROR` before any request is issued.

## Tools

| Tool | Mechanics | HCP Terraform endpoint |
| --- | --- | --- |
| `get_current_user` | GET | `/account/details` |
| `list_organizations` | GET + `page[number]`/`page[size]` | `/organizations` |
| `get_organization` | GET | `/organizations/:name` |
| `list_organization_members` | GET + pagination + `relationships.user.id` | `/organizations/:name/organization-memberships` |
| `list_projects` | GET + pagination | `/organizations/:name/projects` |
| `get_project` | GET | `/projects/:id` |
| `create_project` | POST, attributes stripped of undefined | `/organizations/:name/projects` |
| `update_project` | PATCH | `/projects/:id` |
| `delete_project` | DELETE (204 → `{ success: true }`) | `/projects/:id` |
| `list_workspaces` | GET + pagination + `search[name]` | `/organizations/:name/workspaces` |
| `get_workspace` | GET | `/workspaces/:id` |
| `create_workspace` | POST + optional `relationships.project` | `/organizations/:name/workspaces` |
| `update_workspace` | PATCH, only supplied attributes | `/workspaces/:id` |
| `delete_workspace` | DELETE | `/workspaces/:id` |
| `lock_workspace` | POST `{ reason }` | `/workspaces/:id/actions/lock` |
| `unlock_workspace` | POST, empty body | `/workspaces/:id/actions/unlock` |
| `list_runs` | GET + pagination + `actions.is-*` flags | `/workspaces/:id/runs` |
| `get_run` | GET | `/runs/:id` |
| `create_run` | POST + `relationships.workspace` | `/runs` |
| `apply_run` | POST `{ comment }` | `/runs/:id/actions/apply` |
| `cancel_run` | POST `{ comment }` | `/runs/:id/actions/cancel` |
| `discard_run` | POST `{ comment }` | `/runs/:id/actions/discard` |
| `get_plan` | GET + resource counters | `/plans/:id` |
| `get_plan_json_output` | GET, raw JSON passed through | `/plans/:id/json-output` |
| `get_apply` | GET + resource counters | `/applies/:id` |
| `list_state_versions` | GET + pagination + serial/status | `/workspaces/:id/state-versions` |
| `get_current_state_version` | GET | `/workspaces/:id/current-state-version` |
| `list_workspace_variables` | GET, sensitive values blank | `/workspaces/:id/vars` |
| `create_variable` | POST, `category` enum `terraform`\|`env` | `/workspaces/:id/vars` |
| `update_variable` | PATCH with `data.id` | `/vars/:id` |
| `delete_variable` | DELETE | `/vars/:id` |
| `list_variable_sets` | GET + pagination | `/organizations/:name/varsets` |
| `get_variable_set` | GET | `/varsets/:id` |
| `create_variable_set` | POST `{ name, description, global, priority }` | `/organizations/:name/varsets` |
| `delete_variable_set` | DELETE | `/varsets/:id` |
| `list_teams` | GET + pagination | `/organizations/:name/teams` |
| `get_team` | GET | `/teams/:id` |
| `list_team_access` | GET + `filter[workspace][id]` | `/team-workspaces` |

## Notes

- Outputs keep the upstream shapes (`{ user }`, `{ runs, pagination }`,
  `{ plan_json }`, `{ success }`, …) inside the adapter envelope
  `{ status, data, message, error_code }`.
- Types are declared as the API takes them: `page`/`page_size` are `integer`
  with `minimum: 1` (and `maximum: 100` for `page_size`), never strings.
  `docs`, `hcl`, `sensitive`, `auto_apply`, `plan_only`, `is_destroy`,
  `refresh_only` and `global`/`priority` are real booleans.
- Errors are classified, not thrown: `AUTH_ERROR` (401/403 and logged-out tab),
  `NOT_FOUND` (404), `RATE_LIMITED` (429), `VALIDATION_ERROR` (400/422),
  `TIMEOUT` (408 / in-page abort), `NETWORK`, `UNSUPPORTED_PAGE`,
  `TAB_UNAVAILABLE`.
- Every request arms an 18s in-page `AbortController`, so a slow response is
  cancelled before the 25s browser command deadline can orphan it.
- Pagination is sent as JSON:API bracket params (`page[number]`,
  `page[size]`); `URLSearchParams` percent-encodes the brackets, as upstream's
  `buildQueryString` does.
- Not ported (there is no tool to port): the upstream plugin's `isReady()` /
  `waitForAuth()` activation hook and its `*://app.terraform.io/*` URL glob.
  The glob becomes the per-tool `urlRegex` in `manifest.json` (https only); the
  auth check the hook performed is the `api()` guard above.
