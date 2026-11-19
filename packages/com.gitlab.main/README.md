# GitLab WebMCP package (com.gitlab.main 0.1.0)

Full port of the OpenTabs GitLab plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/gitlab) into the
builtin WebMCP package format: **all 22 upstream tools, no subset**.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-gitlab@0.0.89` `dist/tools.json`): same 22 tool
names, same input property sets, same `required` lists, same JSON Schema per
field (`integer` + min/max for the pagination and IID parameters, `enum` for
the state/order/sort/visibility filters, `array of number` for `assignee_ids`).

The plugin is REST-only upstream — `src/` never calls GitLab's `/api/graphql` —
so no GraphQL call was invented for this port.

## Transport (same as the GitLab web client)

Every call runs inside the GitLab tab:

- **API base** — `gon.gitlab_url` (the instance URL GitLab itself renders on
  every page) + `gon.relative_url_root` (subpath installs) + `/api/v4`. On
  gitlab.com that resolves to `https://gitlab.com/api/v4`, the exact base
  upstream hardcodes; on a self-hosted instance it resolves to that instance,
  which is what upstream's `instanceUrl` config means.
- **Auth** — `gon.current_username` on the page. No token is read, stored or
  sent: the request rides the browser's own first-party session cookie
  (`credentials: 'include'`), exactly like the GitLab SPA.
- **CSRF** — mutating requests (`POST`/`PUT`) send `X-CSRF-Token` from
  `<meta name="csrf-token">`, with Rails' hidden
  `input[name="authenticity_token"]` as the fallback. GETs never send it.
- JSON bodies only (`Content-Type: application/json`, `Accept: application/json`).
- **Error classification** — 401/403 → `AUTH`, 404 → `NOT_FOUND`, 422 →
  `VALIDATION`, 429 → `RATE_LIMITED` (with `Retry-After` echoed in the
  message), anything else → `HTTP`; no page identity → `UNAUTHENTICATED`;
  aborted/network failure → `TIMEOUT`/`NETWORK`. Bodies are truncated to 512
  chars, like upstream.
- The in-page fetch aborts after **18s** so it always settles inside the
  adapter's 25s command window.

## Tools (22)

| Tool | Mechanics | Endpoint on `/api/v4` |
| --- | --- | --- |
| `list_projects` | GET, `per_page`/`page` + `membership`/`owned`/`search`/`visibility`/`order_by`/`sort` | `GET /projects` |
| `get_project` | GET by URL-encoded path or numeric id | `GET /projects/:project` |
| `search_projects` | GET, `search` + sort/page | `GET /projects` |
| `list_issues` | GET, `state` (default `opened`), `labels`, `assignee_username`, `milestone`, `search` | `GET /projects/:project/issues` |
| `get_issue` | GET by IID | `GET /projects/:project/issues/:iid` |
| `create_issue` | POST JSON body (optional fields only when supplied) | `POST /projects/:project/issues` |
| `update_issue` | PUT JSON body, `state_event` close/reopen | `PUT /projects/:project/issues/:iid` |
| `list_merge_requests` | GET, `state` (default `opened`), `labels`, `author_username`, `assignee_id`, branches, `search` | `GET /projects/:project/merge_requests` |
| `get_merge_request` | GET by IID | `GET /projects/:project/merge_requests/:iid` |
| `create_merge_request` | POST with required `source_branch`/`target_branch` | `POST /projects/:project/merge_requests` |
| `update_merge_request` | PUT, `state_event`, `target_branch`, `squash`, … | `PUT /projects/:project/merge_requests/:iid` |
| `merge_merge_request` | PUT with squash/commit-message options | `PUT /projects/:project/merge_requests/:iid/merge` |
| `get_merge_request_diff` | GET, per-file unified diffs from `changes[]` | `GET /projects/:project/merge_requests/:iid/changes` |
| `list_notes` | GET notes on an issue or MR | `GET /projects/:project/:type/:iid/notes` |
| `create_note` | POST `{body}` — the comment tool | `POST /projects/:project/:type/:iid/notes` |
| `list_branches` | GET, `search` + page | `GET /projects/:project/repository/branches` |
| `get_file_content` | GET with `ref` (default `HEAD`), base64 content decoded | `GET /projects/:project/repository/files/:path` |
| `list_commits` | GET, `ref_name`/`path`/`since`/`until` + page | `GET /projects/:project/repository/commits` |
| `list_pipelines` | GET, `status`/`ref`/`source`/`order_by`/`sort` | `GET /projects/:project/pipelines` |
| `list_pipeline_jobs` | GET jobs of one pipeline | `GET /projects/:project/pipelines/:id/jobs` |
| `get_job_log` | GET raw text (no JSON parse) | `GET /projects/:project/jobs/:id/trace` |
| `get_user_profile` | GET `/users?username=`, first match; defaults to the page user | `GET /users` |

Pagination is upstream's: `per_page` (default 20, max 100) and `page` travel as
query parameters; `X-Next-Page`/`X-Total` headers are not surfaced because the
upstream plugin does not read them either.

## Deviations from upstream

1. **API base without a config file.** `config.json` is `{}`, so there is no
   `instanceUrl` setting. The base is derived from the page's own
   `gon.gitlab_url` (+ `relative_url_root`), falling back to `location.origin`.
   On gitlab.com this is byte-identical to upstream's hardcoded
   `https://gitlab.com/api/v4`; on a self-hosted instance it is the instance the
   tab is already on, which is what `instanceUrl` would have been set to.
2. **Host matching.** Each tool declares one `urlRegex` covering `gitlab.com`
   and any self-hosted `gitlab.*` host (`gitlab.example.com`,
   `sub.gitlab.example.co.uk`, with optional port), anchored so an unrelated
   host never activates the package. The runtime re-checks the host (and
   `gon.gitlab_url` for instances whose hostname does not contain `gitlab`) and
   returns `UNSUPPORTED_PAGE` instead of firing a request from another site.
3. **Auth errors.** Upstream throws `ToolError.auth` for a missing identity; the
   adapter reports `error_code: 'UNAUTHENTICATED'` (repo convention) and makes
   no request. HTTP 401/403 remain `AUTH`.
4. **Abort deadline.** 18s `AbortController` instead of upstream's
   `AbortSignal.timeout(30_000)`, so the in-page fetch settles before the
   adapter's 25s browser command deadline. An aborted call is `TIMEOUT`.
5. **CSRF fallback.** `<meta name="csrf-token">` first, then
   `input[name="authenticity_token"]` (the token Rails also renders into forms).
   Upstream reads only the meta tag; both are the page's own token.
6. **Base64 decode failure.** Upstream's bare `atob` would throw; here an
   undecodable body is a `PARSE` error result.
7. Everything else (paths, methods, bodies, defaults, mappers, defensive
   `??` → `''`/`0`/`false` fallbacks, `204` → `{}`) is a straight translation of
   `src/gitlab-api.ts`, `src/tools/schemas.ts` and the 22 tool handlers.

## Verification

- `node scripts/fetch-opentabs.mjs` caches the upstream manifest; `npm test`
  compares tool names, counts, input property sets and `required` lists against
  it, and runs `scripts/tests/com.gitlab.main.test.mjs` (reads, writes,
  comments, pagination, auth and HTTP error classification, self-hosted base
  URL, `urlRegex` both ways).
- `node scripts/validate-package.mjs packages/com.gitlab.main` passes.
