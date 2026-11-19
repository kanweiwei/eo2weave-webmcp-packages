# Google Drive WebMCP package (com.google-drive.main 0.1.0)

Full port of the OpenTabs Google Drive plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/google-drive) into the
builtin WebMCP package format: all 17 upstream tools, no subset (`dist/tools.json` of
`@opentabs-dev/opentabs-plugin-google-drive` 0.0.89 lists the same 17 names).

Every call runs inside the drive.google.com tab. The transport is the one upstream
`google-drive-api.ts` uses: `gapi.client.request({ path, method, params, body })` with
paths under `/drive/v3` (`/files`, `/files/{id}`, `/files/{id}/copy`,
`/files/{id}/permissions`, `/files/trash`, `/about`), gapi deriving SAPISIDHASH from the
tab's own session cookies, so no credential is ever read out of the page or returned.
`params` are filtered for `undefined` exactly like upstream, and a JSON body is only
serialized when the tool sends one (`POST`/`PATCH`).

Before a request the runtime mirrors upstream readiness detection: `gapi.client.request`
must be a function (`waitForAuth` semantics — poll every 500 ms, give up after 8 s).
If the Drive app has not published gapi in that window the identical
path/method/params are sent as a same-origin `fetch` with `credentials: 'include'`; a
logged-out tab answers `/drive/v3/...` with the marketing HTML page, which is reported
as `AUTH` "Google Drive is not ready" instead of as data. That fallback is a
best-effort path only: gapi is the transport upstream (and this port) actually uses.

## Tools

| Tool | Mechanics | Drive v3 endpoint |
| --- | --- | --- |
| `get_current_user` | `fields=user(...),storageQuota` | `GET /about` |
| `list_files` | `q='<parent>' in parents[ and trashed = false]`, `pageSize` 50, `orderBy` `modifiedTime desc` | `GET /files` |
| `get_file` | encoded file id, full field mask | `GET /files/{id}` |
| `search_files` | `fullText contains '<q>'` (+ `mimeType`, `trashed = false`), quoted/backslash-escaped, `pageSize` 20 | `GET /files` |
| `create_file` | JSON body, `mimeType` defaults to Google Doc | `POST /files` |
| `create_folder` | JSON body, `mimeType` = `application/vnd.google-apps.folder` | `POST /files` |
| `update_file` | PATCH, only supplied fields (`name`/`description`/`starred`) | `PATCH /files/{id}` |
| `delete_file` | void call, 204 counts as success | `DELETE /files/{id}` |
| `move_file` | `addParents` / `removeParents` params, no body | `PATCH /files/{id}` |
| `copy_file` | optional `name` / `parents` body | `POST /files/{id}/copy` |
| `trash_file` | body `{trashed: true}` | `PATCH /files/{id}` |
| `restore_file` | body `{trashed: false}` | `PATCH /files/{id}` |
| `empty_trash` | void call, 204 counts as success | `DELETE /files/trash` |
| `list_permissions` | `fields=permissions(id,type,role,emailAddress,displayName,domain)` | `GET /files/{id}/permissions` |
| `create_permission` | JSON body `{type, role, emailAddress?, domain?}`, `sendNotificationEmail` defaults true | `POST /files/{id}/permissions` |
| `delete_permission` | void call, both ids encoded | `DELETE /files/{id}/permissions/{pid}` |
| `get_storage_quota` | `fields=storageQuota` | `GET /about` |

Output types follow the upstream zod schemas: byte counts (`size`, `limit_bytes`,
`usage_*`) stay **strings** (Drive returns `int64` as a string), `starred`/`shared`/
`trashed`/`success` stay booleans, `parent_id` is `parents[0]` or `''`.

## Deviations from upstream

- **API key.** Upstream calls `gapi.client.setApiKey(DRIVE_API_KEY)` with a literal that is
  redacted (`AIzaSy...Sz_8`) in the repository *and* in every published tarball
  (0.0.74–0.0.89), so it cannot be reproduced. `ensureApiKey()` keeps the same structure
  and calls `gapi.client.setApiKey` only when a key is present; with none, the call rides
  on the gapi client the Drive app already configured. Unverified against a live tab.
- **In-page deadline.** gapi calls are raced against an 18 s timer (and the fetch
  fallback aborts at 18 s) so a stalled request cannot outlive the 25 s `browser.eval`
  budget; upstream had no deadline. `TIMEOUT` is a new error code.
- **No export/download tool.** Upstream has none — 17 tools, no `export_file` /
  `download_file` — so nothing was invented. The closest upstream surface is `get_file`,
  which returns `web_view_link` (and `icon_link` is not in the field mask).
- Errors are classified, not thrown: `AUTH` (401/403), `NOT_FOUND` (404),
  `RATE_LIMITED` (429), `VALIDATION` (400/422), `INTERNAL`, plus `TIMEOUT`, `NETWORK`,
  `UNSUPPORTED_PAGE` from this port.

## Notes

- Outputs keep the upstream shapes (`{ file }`, `{ files, next_page_token }`,
  `{ permissions }`, `{ permission }`, `{ success }`, `{ user, storage_quota }`) inside
  the adapter envelope `{ status, data, message, error_code }`.
- Types are declared as the API takes them: `page_size` is an `integer` with
  `minimum: 1` / `maximum: 1000`, permission `type`/`role` are enums — taken verbatim
  from the published manifest, not re-derived from the zod source.
