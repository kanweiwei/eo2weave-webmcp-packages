# Google Docs WebMCP package (com.google-docs.main 0.1.0)

Full port of the OpenTabs Google Docs plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/google-docs,
`@opentabs-dev/opentabs-plugin-google-docs@0.0.94`) into the builtin WebMCP
package format: all 19 upstream tools, no subset.

Everything runs inside the docs.google.com tab. Upstream talks to the Drive v3
API through the page's own `gapi.client.request`, which signs every call with
SAPISIDHASH derived from the tab's session cookies; the port keeps that
transport, so no credential is ever read out of the page or returned. When the
page embeds `preload.globals.gmsSuiteApiKey`, it is handed to
`gapi.client.setApiKey` once per call, exactly like upstream `ensureApiKey`.
When a tab has not exposed `gapi.client.request` yet, the same path
(`/drive/v3/...`), method and params go out as a same-origin `fetch` with
`credentials: 'include'` and a `)]}'` XSSI prefix strip; Google answers an
unknown `/drive/v3` path on that host with its signed-out HTML, which is
reported as `AUTH` ("Google Docs is not ready") rather than as data. Errors are
classified like upstream `classifyGapiError`: 401/403 `AUTH`, 404 `NOT_FOUND`,
429 `RATE_LIMITED`, 400/422 `VALIDATION`, anything else `INTERNAL`; a stalled
call hits an in-page 18s deadline (`TIMEOUT`).

Every response is mapped through upstream's defensive mappers from
`tools/schemas.ts` (`documentSchema`, `tabSchema`, `commentSchema`,
`replySchema`, `userSchema`, `storageQuotaSchema`), including the Drive field
lists (`DOCUMENT_FIELDS`, `DOCUMENT_LIST_FIELDS`, `COMMENT_FIELDS`,
`COMMENT_LIST_FIELDS`) that upstream requests.

Plain text is **not** read through a Docs API: upstream parses the
`DOCS_modelChunk` JSON blobs embedded in the editor HTML
(`src/document-text.ts`) and the port does the same, sorting chunk ops by `ibi`
and dropping blank lines. Comment anchors are read the same way: `list_comments`
fetches the editor HTML, collects the live `kix.<id>` named ranges and hides
orphaned threads by default.

## Tools

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `get_current_user` | GET profile + storage quota | `GET /drive/v3/about` |
| `get_current_document` | open-tab document id, `?tab=` id | `GET /drive/v3/files/:id` |
| `get_document` | metadata + tab info by id | `GET /drive/v3/files/:id` |
| `get_document_text` | editor HTML → `DOCS_modelChunk` parse | `GET /document/d/:id/edit` |
| `list_recent_documents` | `viewedByMeTime`/`modifiedTime` ordering, paging | `GET /drive/v3/files` |
| `search_documents` | `name contains` / `fullText contains`, escaped | `GET /drive/v3/files` |
| `create_document` | POST Docs mime type, optional folder/description | `POST /drive/v3/files` |
| `copy_document` | POST copy with rename/folder overrides | `POST /drive/v3/files/:id/copy` |
| `update_document_title` | PATCH `{ name }` only | `PATCH /drive/v3/files/:id` |
| `trash_document` | PATCH `{ trashed: true }` | `PATCH /drive/v3/files/:id` |
| `restore_document` | PATCH `{ trashed: false }` | `PATCH /drive/v3/files/:id` |
| `delete_document` | DELETE, 204 treated as success | `DELETE /drive/v3/files/:id` |
| `list_comments` | all pages fetched internally, status filter, orphan filter, offset paging | `GET /drive/v3/files/:id/comments` |
| `create_comment` | POST `content` + `quotedFileContent` | `POST /drive/v3/files/:id/comments` |
| `reply_to_comment` | POST reply with `action: reopen` | `POST /drive/v3/files/:id/comments/:cid/replies` |
| `resolve_comment` | resolve reply, then re-read the thread | `POST .../replies` + `GET .../comments/:cid` |
| `reopen_comment` | reopen reply, then re-read the thread | `POST .../replies` + `GET .../comments/:cid` |
| `delete_comment` | DELETE thread | `DELETE /drive/v3/files/:id/comments/:cid` |
| `delete_reply` | DELETE reply | `DELETE .../comments/:cid/replies/:rid` |

## Deviations from upstream

- **No text-editing tools exist upstream.** The plugin has no Docs API
  `documents.batchUpdate` call anywhere (verified in `src/` and in the published
  `dist/`), so there is no append/insert/replace/formatting tool to port; the
  write path is `create_document` + `update_document_title` + Drive mutations,
  and content edits are left to the editor UI.
- **API key fallback.** Upstream falls back to a Google API key bundled inside
  the plugin; that literal is redacted in both the public source and the
  published build, so the port only sets a key when the page exposes
  `preload.globals.gmsSuiteApiKey` and otherwise lets gapi sign the call with the
  session alone.
- **Same-origin fetch fallback** when `gapi.client.request` is absent. Same
  paths, params, bodies and error classification as the gapi path; upstream
  would report `AUTH` immediately instead.
- **18s in-page deadline** on gapi calls (`TIMEOUT`). Upstream awaits the gapi
  promise unbounded, which can outlive the adapter's 25s browser-eval budget.
- **Signed-out text reads fail loudly.** Upstream returns `text: ''` when it
  cannot extract model chunks; the port reports `AUTH` ("Google Docs is not
  ready") when the fetched HTML contains no `DOCS_modelChunk` at all, so a
  sign-in page is never mistaken for an empty document.
- `driveApiRaw` exists upstream but is exported and never called; it is not
  ported.

`GET/POST/PATCH/DELETE` bodies, params (`fields`, `q`, `orderBy`, `pageSize`,
`pageToken`, `includeDeleted`, `parents`, `trashed`, `name`, `mimeType`) and
tool schemas are upstream's, unchanged.
