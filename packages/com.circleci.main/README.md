# com.circleci.main

CircleCI for your own logged-in session on <https://app.circleci.com>.

Ported from the OpenTabs `circleci` plugin (`plugins/circleci/src`, MIT) — all 33 tools,
same endpoints, same query/JSON bodies and the same defensive mappers. Every call is a
same-origin `/api/v2/…` fetch from the tab you are already logged in to; the HttpOnly
session cookie rides along (`credentials: 'include'`) and no token is read, copied or
stored. Upstream sends no CSRF header and neither does this port.

## Tools

| Group | Tools |
| --- | --- |
| Users | `get_current_user`, `list_collaborations` |
| Projects | `get_project` |
| Pipelines | `list_pipelines`, `get_pipeline`, `get_pipeline_config`, `trigger_pipeline` |
| Workflows | `get_pipeline_workflows`, `get_workflow`, `get_workflow_jobs`, `cancel_workflow`, `rerun_workflow` |
| Jobs | `get_job`, `get_job_artifacts`, `get_job_tests`, `cancel_job`, `approve_job` |
| Contexts | `list_contexts`, `get_context`, `create_context`, `delete_context`, `list_context_env_vars` |
| Environment | `list_env_vars`, `create_env_var`, `delete_env_var` |
| Insights | `get_project_workflow_metrics`, `get_workflow_runs`, `get_workflow_job_metrics`, `get_flaky_tests` |
| Schedules | `list_schedules`, `create_schedule`, `update_schedule`, `delete_schedule` |

Writes: `trigger_pipeline`, `cancel_workflow`, `rerun_workflow`, `cancel_job`, `approve_job`,
`create_context`, `delete_context`, `create_env_var`, `delete_env_var`, `create_schedule`,
`update_schedule`, `delete_schedule`.

## Transport notes

- **Base**: `https://app.circleci.com/api/v2` (relative to the tab origin).
- **Auth**: the dashboard's HttpOnly session cookies. A 401/403 is reported as `AUTH`
  ("your session may have expired, reload app.circleci.com"), never as an empty success.
- **Bodies**: JSON only when a body exists; `Content-Type: application/json`. Optional
  inputs are stripped (`stripUndefined`) so an update only changes what you passed.
- **Pagination**: CircleCI's `page-token` query parameter. Each list tool returns
  `next_page_token` (empty string when there are no more pages); pass it back as
  `page_token` to continue.
- **204 / empty 200**: delete and cancel endpoints return no body; those tools report
  `{ "success": true }`.
- **Timeouts**: the in-page fetch aborts after 18s so it always settles inside the
  adapter's 25s command deadline.

## Notes on parity

`get_job` returns the job's `web_url` (the log page) plus duration/parallelism; CircleCI's
raw log text endpoint is not part of the upstream plugin, so no tool is invented for it.
Artifacts (`get_job_artifacts`) and test metadata (`get_job_tests`) are the upstream
log-adjacent reads and are covered by the package tests.

`delete_context` follows upstream and goes through the JSON path (`api`), not `apiVoid`;
it reports `{ "success": true }` on a 2xx.
