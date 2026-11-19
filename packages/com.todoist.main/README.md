# Todoist WebMCP package (com.todoist.main 0.1.0)

Full port of the OpenTabs Todoist plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/todoist) into
the builtin WebMCP package format: all 33 upstream tools, no subset — every
read and every write (tasks, projects, sections, comments, labels, shared
labels, project archiving and collaborators).

Every call runs inside the app.todoist.com tab. The plugin's real API layer is
reproduced page-side: the bearer token the web app keeps in
`localStorage["User"]` (JSON, `.token`) is read on every call and sent as
`Authorization: Bearer <token>` to the same-origin `/api/v1` REST API with
`credentials: 'include'`. Upstream reads no CSRF token for this API, so neither
does the port. The token never leaves page context and is never cached across
calls, so an account switch or sign-out in a live tab cannot reuse the previous
account's credential.

Two upstream helpers map onto one page-side request function: `api()` (JSON
response) and `apiVoid()` (no response body — close, reopen, delete, archive,
shared-label rename/remove; it defaults to POST and never parses a body).
`list` endpoints answer a `{ results, next_cursor }` envelope; the port maps
`results` through the plugin's own field mappers (snake_case Todoist fields →
documented tool fields, e.g. `checked` → `is_completed`, `child_order` →
`order`, `note_count` → `comment_count`).

## Tools

| Tool | Mechanics | Todoist endpoint |
| --- | --- | --- |
| `list_projects` | GET, `results` envelope | `GET /api/v1/projects` |
| `get_project` | GET single object | `GET /api/v1/projects/:id` |
| `create_project` | POST, body = the supplied fields | `POST /api/v1/projects` |
| `update_project` | POST, body = supplied fields minus `project_id` | `POST /api/v1/projects/:id` |
| `delete_project` | void (DELETE, 204) | `DELETE /api/v1/projects/:id` |
| `archive_project` | void (POST, 204) | `POST /api/v1/projects/:id/archive` |
| `unarchive_project` | void (POST, 204) | `POST /api/v1/projects/:id/unarchive` |
| `list_collaborators` | GET, `results` envelope | `GET /api/v1/projects/:id/collaborators` |
| `list_tasks` | GET + `project_id`/`section_id`/`label` filters | `GET /api/v1/tasks` |
| `get_task` | GET single object | `GET /api/v1/tasks/:id` |
| `create_task` | POST, only the fields the caller supplied | `POST /api/v1/tasks` |
| `update_task` | POST, only the fields the caller supplied | `POST /api/v1/tasks/:id` |
| `close_task` | void (apiVoid default POST, 204) | `POST /api/v1/tasks/:id/close` |
| `reopen_task` | void (apiVoid default POST, 204) | `POST /api/v1/tasks/:id/reopen` |
| `delete_task` | void (DELETE, 204) | `DELETE /api/v1/tasks/:id` |
| `list_sections` | GET + optional `project_id` | `GET /api/v1/sections` |
| `get_section` | GET single object | `GET /api/v1/sections/:id` |
| `create_section` | POST `{name, project_id, order?}` | `POST /api/v1/sections` |
| `update_section` | POST `{name}` | `POST /api/v1/sections/:id` |
| `delete_section` | void (DELETE, 204) | `DELETE /api/v1/sections/:id` |
| `list_comments` | GET + `task_id`/`project_id` | `GET /api/v1/comments` |
| `get_comment` | GET single object | `GET /api/v1/comments/:id` |
| `create_comment` | POST `{content, task_id?, project_id?}` | `POST /api/v1/comments` |
| `update_comment` | POST `{content}` | `POST /api/v1/comments/:id` |
| `delete_comment` | void (DELETE, 204) | `DELETE /api/v1/comments/:id` |
| `list_labels` | GET, `results` envelope | `GET /api/v1/labels` |
| `get_label` | GET single object | `GET /api/v1/labels/:id` |
| `create_label` | POST, body = the supplied fields | `POST /api/v1/labels` |
| `update_label` | POST, body = supplied fields minus `label_id` | `POST /api/v1/labels/:id` |
| `delete_label` | void (DELETE, 204) | `DELETE /api/v1/labels/:id` |
| `list_shared_labels` | GET + `omit_personal`; results are bare strings | `GET /api/v1/labels/shared` |
| `rename_shared_label` | void (apiVoid default POST) | `POST /api/v1/labels/shared/rename` |
| `remove_shared_label` | void (apiVoid default POST) | `POST /api/v1/labels/shared/remove` |

## Behaviour

* **Auth** — no token in the tab: `UNAUTHENTICATED`, before any request is made.
* **HTTP mapping** (mirrors the SDK's `httpStatusToToolError`): 400/422 →
  `VALIDATION`, 401/403 → `AUTH`, 404 → `NOT_FOUND`, 408 → `TIMEOUT`, 429 →
  `RATE_LIMITED`, other statuses → `HTTP`. The status and the API's own
  `error`/`error_tag` detail stay in `message`.
* **Transport** — `NETWORK` on a failed fetch; the in-page request aborts after
  18s so a hung call cannot outlive the 25s browser command, and
  `TAB_UNAVAILABLE` when the tab closes or navigates mid-call.
* **Wrong page** — a non-`app.todoist.com` tab answers `UNSUPPORTED_PAGE`
  (the urlRegex already gates activation).
* **Writes** — only the fields the caller supplied go into the JSON body;
  omitted optional fields are absent, so Todoist keeps its own defaults
  (`create_task`, `create_project`, `create_label` and friends). `update_*`
  bodies drop the path id, exactly like the upstream
  `const { id, ...body } = params`.

## Tools covered by execution tests

`list_tasks` (filtered list read), `list_projects` (multi-object batch read),
`create_task` (POST with a JSON body), `close_task` and `delete_task` (204 /
empty-body writes), `rename_shared_label` (apiVoid default POST),
plus the auth paths (missing token, HTTP 401) and a urlRegex probe over every
tool (match and non-match hosts).

## Deviations from upstream

* The token is re-read from `localStorage` on every call; upstream memoises it
  in a module-level auth cache. Uncached is strictly safer in a live tab.
* Error codes are the string codes above instead of `ToolError` categories.
* A list envelope without `results` degrades to `[]` instead of throwing a
  TypeError (the same defensive default this repo's other ports use).
* `outputSchema` is the workflow result envelope (`status`/`data`/`message`/
  `error_code`) required by this format, not the upstream per-tool output
  schema.

## Not verified against a live account

Everything here is verified against a stubbed page (in-page `fetch`,
`localStorage`) only; no live Todoist account was used. Unverified: the real
token payload shape beyond `.token`, live 204 responses for
close/reopen/delete/archive, live error bodies, sampler payloads for
`list_collaborators` and `list_shared_labels`, and whether Todoist ever
rate-limits the web API per token.
