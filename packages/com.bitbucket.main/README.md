# Bitbucket WebMCP package (com.bitbucket.main 0.1.0)

Full port of the OpenTabs Bitbucket plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/bitbucket,
`@opentabs-dev/opentabs-plugin-bitbucket@0.0.90`) into the builtin WebMCP
package format: all 27 upstream tools, no subset.

Every call runs inside the `bitbucket.org` tab. The plugin's own API layer is
ported as-is: same-origin `fetch` with `credentials: 'include'` against
`/!api/2.0` — Bitbucket's own page-level proxy to the 2.0 REST API, not the
separate `api.bitbucket.org` host — JSON bodies only, and the same status
classification (401/403 → `AUTH`, 404 → `NOT_FOUND`, 400/422 → `VALIDATION`,
429 → `RATE_LIMITED`, 5xx → `HTTP`).

Two credentials, both read from the page and never minted here:

- the browser's Bitbucket session cookie (the actual auth);
- the `csrftoken` cookie, sent as `X-CSRFToken` on every non-GET request, which
  is what the site requires for a session-authenticated mutation.

The session identity is the page's own `__app_data__.user.uuid` global
(upstream's `getPageGlobal`). Without it every tool returns `UNAUTHENTICATED`
before any request is made, so a logged-out tab fails fast instead of being
classified as a 401.

## Tools

| Tool | Mechanics | Endpoint (`/!api/2.0`) |
| --- | --- | --- |
| `list_repositories` | `page`/`pagelen`/`q` query | `GET /repositories/:workspace` |
| `get_repository` | single object | `GET /repositories/:workspace/:repo` |
| `create_repository` | POST, `scm: git` + `is_private: true` defaults, optional fields only when supplied | `POST /repositories/:workspace/:repo` |
| `list_pull_requests` | `state`/`page`/`pagelen` query | `GET /repositories/:ws/:repo/pullrequests` |
| `get_pull_request` | single object | `GET …/pullrequests/:id` |
| `create_pull_request` | POST `{title, source.branch.name}`, optional destination/description/close_source_branch, `reviewers: [{uuid}]` | `POST …/pullrequests` |
| `update_pull_request` | PUT, only supplied fields | `PUT …/pullrequests/:id` |
| `merge_pull_request` | POST, optional `merge_strategy`/`close_source_branch`/`message` | `POST …/pullrequests/:id/merge` |
| `decline_pull_request` | POST, no body | `POST …/pullrequests/:id/decline` |
| `approve_pull_request` | POST, no body → `{approved}` | `POST …/pullrequests/:id/approve` |
| `list_pr_comments` | `page`/`pagelen` query | `GET …/pullrequests/:id/comments` |
| `create_pr_comment` | POST `{content:{raw}}` | `POST …/pullrequests/:id/comments` |
| `get_pull_request_diff` | raw text response (no JSON parse) | `GET …/pullrequests/:id/diff` |
| `list_branches` | `page`/`pagelen`/`q` query | `GET …/refs/branches` |
| `create_branch` | POST `{name, target:{hash}}` | `POST …/refs/branches` |
| `delete_branch` | DELETE, 204 → `{deleted: true}` | `DELETE …/refs/branches/:name` |
| `list_tags` | `page`/`pagelen` query | `GET …/refs/tags` |
| `list_commits` | `branch` → `include` query | `GET …/commits` |
| `get_commit` | single object | `GET …/commit/:hash` |
| `list_pipelines` | `page`/`pagelen`/`sort` query, trailing slash kept | `GET …/pipelines/` |
| `get_pipeline` | single object | `GET …/pipelines/:uuid` |
| `list_pipeline_steps` | `page`/`pagelen` query, trailing slash kept | `GET …/pipelines/:uuid/steps/` |
| `get_file_content` | raw text, `ref` defaults to `HEAD` | `GET …/src/:ref/:path` |
| `search_code` | workspace-level code search; repo slug derived from the hit's `links.self.href` | `GET /workspaces/:ws/search/code` |
| `list_workspaces` | `page`/`pagelen` query | `GET /workspaces` |
| `list_workspace_members` | `page`/`pagelen` query | `GET /workspaces/:ws/members` |
| `get_user_profile` | single object | `GET /user` |

## Deviations and notes

- **Upstream fidelity is verbatim on transport.** `/!api/2.0`, the `csrftoken`
  cookie header, the unencoded branch name in `delete_branch`, the unencoded
  `ref`/`path` in `get_file_content`, and the trailing slashes on the pipeline
  list endpoints are all upstream behaviour, kept so the port fails the same way
  upstream does. Upstream has no Atlassian request-token header for this site;
  the CSRF cookie is the whole mutation contract.
- Empty `200` bodies are treated as `{}` instead of failing the JSON parse: the
  endpoints here answer `204` for empty success, so the branch is defensive, not
  a behavioural change on any tested path.
- The in-page request abort is 20s (upstream uses `AbortSignal.timeout(30s)`) so
  the fetch cannot outlive the adapter's 25s browser-command deadline.
- Errors are re-thrown as this repo's envelope
  (`{status, data, message, error_code}`) instead of `ToolError`; `AUTH` /
  `NOT_FOUND` / `VALIDATION` / `RATE_LIMITED` / `HTTP` / `NETWORK` / `TIMEOUT`
  carry the same meaning, and a missing session is `UNAUTHENTICATED`.
- Scope is the bare host plus `www`: `^https?://(?:www\.)?bitbucket\.org…`
  with the optional query/hash tail. Upstream's `*://*.bitbucket.org/*` also
  matches `api.bitbucket.org` (a REST host with no session, no SPA) and
  `support.bitbucket.org`; those are excluded deliberately.
- `search_code` is a workspace-level endpoint (`/workspaces/:ws/search/code`),
  as upstream. Bitbucket gates it on plan/search availability; a workspace
  without it answers 404, surfaced as `NOT_FOUND`.

## Verification

`npm test` covers the contract, upstream tool-set/schema parity (27/27 names and
input schemas auto-derived from the cached published
`@opentabs-dev/opentabs-plugin-bitbucket` manifest), and execution against a
stubbed `bitbucket.org` page: repository list/detail/create, PR list/detail,
create (defaults, reviewer UUID mapping, omitted optionals), partial update,
merge, decline, approve, comments, raw diff text, branches (filter, create,
204 delete), tags, commits (`include` filter), pipelines and steps (trailing
slash, duration/result mapping), raw file content at `HEAD` and at an explicit
ref, code search (repo slug from the self href), workspaces, members, the
session-less `UNAUTHENTICATED` path, the 401/403/404/400/429/500 classification,
the off-site refusal, and `urlRegex` in both directions.

Browser-only paths not exercised by the harness: a real Bitbucket Cloud session
(cookie + CSRF), and site behaviour that depends on workspace plan
(code search) or repository permissions.
