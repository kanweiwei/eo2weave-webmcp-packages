# Asana WebMCP package (com.asana.main 0.1.0)

Full port of the OpenTabs Asana plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/asana): all 24
upstream tools, no subset. Tool names, input properties and required fields are
identical to `@opentabs-dev/opentabs-plugin-asana`'s `dist/tools.json`.

Every call runs inside the app.asana.com tab. Asana's web client authenticates
with an HttpOnly `auth_token` cookie that JavaScript cannot read, so the port
never lifts a credential out of the page: requests are same-origin
`/api/1.0/…` fetches with `credentials: 'include'`, and the browser attaches the
session cookie itself. The signed-in user is detected the way the app does it —
the numeric `window.env._user_id` global (falling back to
`page_load_globals.user_id` on server-rendered pages). No session means `AUTH`
and no request at all.

Writes reproduce Asana's own client contract: every non-GET sends
`X-Allow-Asana-Client: 1` (the API rejects cookie-authenticated mutations
without it), bodies are JSON `{"data": {…}}` envelopes, and reads carry the
upstream `opt_fields` lists so the mappers always have their fields. Nothing is
sent to a third-party host.

## Tools

### Tasks

| Tool | Mechanics | Asana endpoint |
| --- | --- | --- |
| `get_task` | `opt_fields` from the caller or the standard task set | `GET /tasks/:task_gid` |
| `create_task` | `{data:{name,workspace,…}}`, only supplied fields | `POST /tasks` |
| `update_task` | partial `{data:{…}}` (name, completed, assignee, dates, notes) | `PUT /tasks/:task_gid` |
| `delete_task` | 204 No Content reported as `{success:true}` | `DELETE /tasks/:task_gid` |
| `search_tasks` | dotted filters `assignee.any`, `due_on.before/after`, `projects.any`, default limit 20 | `GET /workspaces/:gid/tasks/search` |
| `get_tasks_for_project` | `limit`/`offset` + `next_page` token | `GET /projects/:gid/tasks` |
| `get_tasks_for_section` | `limit`/`offset` + `next_page` token | `GET /sections/:gid/tasks` |
| `get_subtasks` | `limit`/`offset` + `next_page` token | `GET /tasks/:gid/subtasks` |
| `add_followers` | `{data:{followers:[…]}}` | `POST /tasks/:gid/addFollowers` |

### Projects

| Tool | Mechanics | Asana endpoint |
| --- | --- | --- |
| `list_projects` | `workspace` filter, optional `archived`, limit/offset | `GET /projects` |
| `get_project` | project detail | `GET /projects/:project_gid` |
| `create_project` | `{data:{workspace,name,…}}`, only supplied fields | `POST /projects` |
| `update_project` | partial update incl. `archived`, `public` | `PUT /projects/:project_gid` |

### Sections

| Tool | Mechanics | Asana endpoint |
| --- | --- | --- |
| `list_sections` | all sections of a project | `GET /projects/:gid/sections` |
| `create_section` | `{data:{name}}` | `POST /projects/:gid/sections` |
| `add_task_to_section` | `{data:{task}}` | `POST /sections/:gid/addTask` |

### Stories (comments)

| Tool | Mechanics | Asana endpoint |
| --- | --- | --- |
| `get_stories_for_task` | comments and activity, limit/offset | `GET /tasks/:gid/stories` |
| `create_story` | `{data:{text}}` — the comment create path | `POST /tasks/:gid/stories` |

### Users, workspaces, tags, teams

| Tool | Mechanics | Asana endpoint |
| --- | --- | --- |
| `get_current_user` | profile + its `workspaces` | `GET /users/me` |
| `get_user` | name and email | `GET /users/:user_gid` |
| `list_users_for_workspace` | name and email, limit/offset | `GET /workspaces/:gid/users` |
| `list_workspaces` | every workspace of the session | `GET /workspaces` |
| `list_tags` | name and color, limit/offset | `GET /workspaces/:gid/tags` |
| `list_teams` | name and description, limit/offset | `GET /workspaces/:gid/teams` |

Pagination is the API's own `next_page.offset` token: list tools return it as
`next_page` (string or `null`) and accept it back as `offset`.

## Deviations from upstream

- **Same-origin paths.** Upstream hardcodes `https://app.asana.com/api/1.0`;
  the port builds `/api/1.0…` against `location.origin`, which is the same URL
  from an app.asana.com tab and keeps the request inside it.
- **No auth polling.** Upstream's `isReady()` waits up to 5 s for
  `env._user_id` to appear. A WebMCP tool call is explicit, so a logged-out tab
  fails fast with `AUTH` instead of blocking the call.
- **Request deadline.** Upstream uses `AbortSignal.timeout(30_000)`; the page
  eval budget here is 25 s, so the in-page fetch aborts at 18 s and reports
  `NETWORK` (aborts stay distinguishable in the message).
- **Error codes.** `AUTH`, `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION`, `HTTP`,
  `NETWORK`, `TIMEOUT`, plus this repo's `UNSUPPORTED_PAGE`,
  `TAB_UNAVAILABLE` and `EMPTY_RESULT`. Status mapping is upstream's
  (401/403 → AUTH, 404 → NOT_FOUND, 429 → RATE_LIMITED, 400/422 → VALIDATION).
- **Result envelope.** Tools return `{status, data, message, error_code}` (the
  repo contract) around the same payload shape upstream declares: `task`,
  `tasks`, `project`, `projects`, `section`, `sections`, `story`, `stories`,
  `user`, `users`, `workspaces`, `tags`, `teams`, `next_page`, `success`.
- **Host check.** The runtime refuses a tab that is not `app.asana.com`
  (`UNSUPPORTED_PAGE`) before issuing a request.

## Tests

`scripts/tests/com.asana.main.test.mjs` stubs the app.asana.com tab (fetch,
`window.env._user_id`) and asserts, for all 24 tools, the exact request
(path, method, query parameters including `opt_fields` and the dotted search
filters, JSON body) plus the parsed output. It also covers the `AUTH` paths
(missing session makes no request; 401 keeps Asana's message), `NOT_FOUND`,
`VALIDATION`, `RATE_LIMITED`, a non-Asana tab, and both directions of the
anchored `urlRegex`.

Parity (tool count, names, input schemas) is asserted centrally by
`npm test` against `.cache/opentabs/asana-tools.json`.
