# ClickUp WebMCP package (com.clickup.main 0.1.0)

Full port of the OpenTabs ClickUp plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/clickup) into
the builtin WebMCP package format: **all 11 upstream tools, no subset**.

Upstream publishes 11 read tools (`@opentabs-dev/opentabs-plugin-clickup@0.0.89`
`dist/tools.json`: users, workspaces, spaces, folders, lists, goals, custom
fields). It has **no task, comment, search or write tool** — the ClickUp
plugin's `index.ts` registers exactly those 11 and its `src/tools/` holds no
other handler. Nothing was invented to fill that gap: a task endpoint would be
an endpoint upstream never calls, and parity is asserted against the published
manifest.

## Transport (same as the ClickUp web client)

Every call runs inside the `app.clickup.com` tab:

- **Base URL** — the page's own `apiUrlBase`, read from the `cuHandshake`
  localStorage entry (`entry.appEnvironment.apiUrlBase`), verbatim. Paths are
  appended unchanged, so the request goes exactly where the SPA sends it.
- **Credential** — the session JWT, sent as `Authorization: Bearer <token>`.
  It is captured by patching `WebSocket.prototype.send` and reading the
  `{method:"auth", token, teamId}` frame ClickUp's SPA sends on connect. The
  same frame's `teamId` (or the first `cuHandshake` key) is the default
  workspace. No cookie, no OAuth app, no API key.
- JSON bodies only (`Content-Type: application/json`), `credentials: 'include'`
  so the request stays a normal first-party call.
- Error classification: 401/403 → `AUTH`, 404 → `NOT_FOUND`, 400/422 →
  `VALIDATION`, 429 → `RATE_LIMITED`, anything else → `HTTP`. ClickUp's
  `{err, ecode}` body is surfaced in the message.

The in-page fetch aborts after 20s so it always settles inside the adapter's
25s command window.

## Tools

| Tool | Mechanics | Endpoint (on `apiUrlBase`) |
| --- | --- | --- |
| `get_current_user` | GET, no params | `GET /user/v1/user/me` |
| `get_workspace` | GET, workspace defaults to the session's | `GET /team/v1/team/:team_id` |
| `get_workspace_members` | GET, `members[].user` flattened + role | `GET /v1/team/:team_id/member` |
| `get_spaces` | GET, `team` + `include_archived` query | `GET /hierarchy/v1/project` |
| `get_space` | GET | `GET /hierarchy/v1/project/:space_id` |
| `get_folders` | GET, `include_archived` query, `categories[]` | `GET /hierarchy/v1/project/:space_id/category` |
| `get_folder` | GET | `GET /hierarchy/v1/category/:folder_id` |
| `get_lists` | GET, `include_archived` query, `subcategories[]` | `GET /hierarchy/v1/category/:folder_id/subcategory` |
| `get_list` | GET | `GET /hierarchy/v1/subcategory/:list_id` |
| `get_goals` | GET, `goals[]`, `key_results` counted | `GET /v1/team/:team_id/goal` |
| `get_custom_fields` | GET, `fields[]` | `GET /customFields/v1/team/:team_id/fields` |

`include_archived` is sent explicitly (`false` when omitted), matching the
upstream call — ClickUp's server default differs between hierarchy endpoints,
so leaving it out would change the result.

## Deviations from upstream

1. **Token capture happens per call, not at page load.** Upstream installs the
   WebSocket interceptor when the adapter is injected, before Angular
   bootstraps. A workflow here is evaluated on demand, so the interceptor is
   installed on the first call and captures the *next* auth frame. If the tab
   has not (re)authenticated its socket since then, tools return `AUTH` rather
   than guessing a token from another storage key. Reloading the tab with a
   workflow having run once, or any socket reconnect, populates it.
2. **No auth cache.** Upstream persists `{token, apiUrlBase, workspaceId}` in
   the extension's auth cache; module state does not survive a per-call eval,
   so every call re-reads the page. That is fresher (a workspace switch or a
   re-auth is picked up immediately) at the cost of repeating the read.
3. **Trailing slash of `apiUrlBase` is trimmed** before appending a path, so a
   base ending in `/` cannot produce `//`. Nothing else about the URL is
   rewritten.
4. **IDs are `encodeURIComponent`-escaped** in path segments. Upstream
   interpolates them raw; ClickUp IDs are numeric strings, so the URL is byte
   identical for every valid ID.
5. **Mappers keep upstream's defaults** (`0` / `''` / `false` / `null`) but are
   written so a present-but-empty value (`0`, `false`, `null`) is not replaced
   by the default — `??` in the source, explicit `=== undefined` checks in the
   port. A genuinely missing field can therefore not be told apart from a
   present one in the output schema; that is upstream's behaviour too.

## Scope

`urlRegex` for every tool:
`^https?://app\.clickup\.com/(?:[^?#]*)(?:\?[^#]*)?(?:#.*)?$` — the whole
`app.clickup.com` app, with the optional query/hash tail. `clickup.com` (the
marketing site) and lookalike hosts do not match; the runtime also refuses a
non-`app.clickup.com` host with `UNSUPPORTED_PAGE` before any request.

## Verified

- `node scripts/fetch-opentabs.mjs` → `clickup: cached @opentabs-dev/opentabs-plugin-clickup@0.0.89`
- Tool-set parity against that manifest: 11/11 names, per-tool input
  properties and `required` lists.
- `scripts/tests/com.clickup.main.test.mjs`: every tool executed against a
  stubbed `app.clickup.com` page, asserting the exact URL, method,
  `Authorization` header and parsed output, plus `AUTH` (no token, no
  handshake, 401), `NOT_FOUND`, `UNSUPPORTED_PAGE` and `urlRegex` in both
  directions.

Not verified against the live ClickUp app: the real `apiUrlBase` value, the
exact WebSocket auth frame shape, and every response field the mappers read.
Those come from upstream's `clickup-api.ts` / `tools/schemas.ts` unchanged.
