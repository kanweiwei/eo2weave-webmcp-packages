# Airtable WebMCP package (com.airtable.main 0.1.0)

Full port of the OpenTabs Airtable plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/airtable) into
the builtin WebMCP package format: all 8 upstream tools, no subset.

Every call runs inside an airtable.com tab. Airtable's web client is a single-page
app that talks to its own internal API, `/v0.3/<endpoint>`, on the same origin;
the port reproduces that transport instead of inventing REST paths:

- **Auth** — Airtable's session lives in HttpOnly cookies that page JS cannot
  read. The web client gets its identity from `window.initData`
  (`sessionUserId`, `csrfToken`), so the port reads those two values from page
  context on **every** call (never cached: switching accounts in a live tab must
  not replay the previous user's CSRF token). A missing `sessionUserId` /
  `csrfToken`, or a `usrPAGESHARE…` id (a public share-link visitor, not a user),
  is reported as `AUTH` before any request is made.
- **Reads** — `GET /v0.3/<endpoint>?stringifiedObjectParams=<json>&requestId=req…`
  with headers `x-airtable-inter-service-client: webClient`,
  `x-requested-with: XMLHttpRequest`, `x-time-zone: <IANA zone>`, and
  `x-airtable-application-id: <base_id>` on base-scoped endpoints.
  `credentials: 'include'` carries the session cookie.
- **Writes** — `POST /v0.3/<endpoint>` with body
  `{ stringifiedObjectParams: "<json>", requestId: "req…", _csrf: "<initData.csrfToken>" }`
  and `Content-Type: application/json`. The CSRF token never leaves page context.
- **Responses** — `json.data` is unwrapped when present; `204` is an empty
  success; an `error` object in the body is classified by type.

## Tools

| Tool | Mechanics | Airtable endpoint |
| --- | --- | --- |
| `list_workspaces` | GET, user id from `initData`, maps `workspaceRecordById` + `applicationRecordById` | `GET /v0.3/user/:userId/listApplicationsAndPageBundlesForDisplay` |
| `get_base_schema` | GET, schema-only read, maps `tableSchemas` → tables/fields/views | `GET /v0.3/application/:baseId/read` |
| `list_records` | GET, `includeDataForTableIds: [table_id]`, maps `tableDatas[].rows` | `GET /v0.3/application/:baseId/read` |
| `get_record` | same read, row picked by `record_id`; `NOT_FOUND` when absent | `GET /v0.3/application/:baseId/read` |
| `update_cell` | POST `{ tableId, rowId, columnId, cellValue }` | `POST /v0.3/row/:recordId/updatePrimitiveCell` |
| `get_record_activity` | GET, merges `rowActivityInfoById` + `commentsById` in `orderedActivityAndCommentIds` order, HTML stripped from diffs | `GET /v0.3/row/:recordId/readRowActivitiesAndComments` |
| `create_comment` | POST `{ tableId, text }` | `POST /v0.3/row/:recordId/createRowComment` |
| `get_field_choices` | GET schema-only, picks `columns[]` by `field_id`, honours `typeOptions.choiceOrder` | `GET /v0.3/application/:baseId/read` |

Mapping details (field/record/choice shapes, empty-string fallbacks for absent
values, `sel`/`fld`/`rec`/`tbl`/`app` id prefixes, the `INVALID_PERMISSIONS`
versus auth split on 403) are taken from upstream `tools/schemas.ts`,
`airtable-api.ts` and the per-tool handlers.

## Errors

| Code | When |
| --- | --- |
| `AUTH` | no `initData` session (or `usrPAGESHARE`), or HTTP 401/403 without an `INVALID_PERMISSIONS` body |
| `VALIDATION` | HTTP 422, 403 with `INVALID_PERMISSIONS`, body `error.type` `INVALID_REQUEST`/`INVALID_MODEL_ID`, or a non-select field passed to `get_field_choices` |
| `NOT_FOUND` | HTTP 404, body `error.type` `NOT_FOUND`/`MODEL_ID_NOT_FOUND`, unknown record/table/field |
| `RATE_LIMITED` | HTTP 429, with `Retry-After` converted to milliseconds |
| `INTERNAL` | other non-2xx statuses, or an unclassified body `error` object |
| `NETWORK` | fetch rejection, including the in-page abort |
| `UNSUPPORTED_PAGE` | the tab is not on `airtable.com` (`urlRegex` also gates this) |
| `TAB_UNAVAILABLE` / `EMPTY_RESULT` | the tab closed/navigated, or the page returned nothing |

## Deviations from upstream

1. **In-page deadline.** Upstream uses `AbortSignal.timeout(30_000)`. The port
   uses `AbortController` + `setTimeout(18_000)`, because the `browser.eval`
   command deadline is 25 s: aborting at 18 s keeps the request from outliving
   the call in the tab. A timeout is reported as `NETWORK` ("API request timed
   out"), which is this repo's code for transport failures.
2. **Explicit `method: 'GET'`.** Upstream omits `method` on reads and relies on
   the fetch default. The port passes `'GET'` so the request descriptor is
   self-describing; the wire request is identical.
3. **Host guard.** Upstream relies on the extension's `*://*.airtable.com/*`
   match pattern. The port additionally refuses a tab whose hostname is not
   `airtable.com` or `*.airtable.com` with `UNSUPPORTED_PAGE`, so a mis-targeted
   tab cannot receive a same-origin `/v0.3` call. `urlRegex` is the anchored
   equivalent of that match pattern (any subdomain depth, optional query/hash).
4. **Upstream has no search, filter, create-record or delete tool.** Its eight
   tools are exactly the ones above; no endpoint was invented to fill those
   gaps. Filtering happens on the web client's side of the reads it already
   performs (`get_record` selects a row, `get_field_choices` selects a field),
   and `update_cell` is the only cell mutation upstream exposes.

## Tests

`scripts/tests/com.airtable.main.test.mjs` stubs the tab (fetch, `location`,
`initData`) and asserts the real request — URL, method, headers, query
`stringifiedObjectParams`, POST body incl. `_csrf` — plus the parsed output for
list/read, schema/choice filtering, both writes, activity/comment merging, the
204 write path, and the auth/404/422/403/429/wrong-host failure paths. It also
probes `urlRegex` in both directions.
