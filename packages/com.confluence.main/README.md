# Confluence WebMCP package (com.confluence.main 0.1.0)

Full port of the OpenTabs Confluence plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/confluence) into
the builtin WebMCP package format: all 21 upstream tools, no subset — every read
tool plus every write tool (`create_page`, `update_page`, `delete_page`,
`create_comment`, `create_inline_comment`, `delete_comment`, `add_label`,
`remove_label`).

Every call runs inside the `*.atlassian.net/wiki` tab. The plugin's own API layer
is ported as-is: same-origin `fetch` with `credentials: 'include'` against the
page's `ajs-base-url`, which on Confluence Cloud is `https://<site>.atlassian.net/wiki`:
`/wiki/api/v2/...` for the modern REST API and `/wiki/rest/api/...` for the
classic one (search, labels, user). JSON bodies only, and the same status
classification (401/403 → `AUTH`, 404 → `NOT_FOUND`, 400/422 → `VALIDATION`,
429 → `RATE_LIMITED`, anything else → `HTTP`). There is no token: the browser's
Confluence session cookie is the credential.

The session identity and the REST base are the meta tags Confluence Cloud stamps
on every page — `ajs-atlassian-account-id` (falling back to `ajs-remote-user`),
`ajs-base-url` and `ajs-cloud-id`. Upstream caches them in the extension's auth
cache; this port re-reads them on every call, so an account switch in a live tab
cannot reuse the previous identity. A page without them returns
`UNAUTHENTICATED` before any request is made.

Page bodies and comments travel in Confluence storage format (HTML) in both
directions, exactly like upstream: `get_page` asks for
`body-format=storage` only when `include_body` is true, and writes send
`{ representation: 'storage', value }`.

Scope matches the upstream URL pattern `*://*.atlassian.net/wiki/*`, so Jira
pages on the same site are excluded. The `instanceUrl` config schema upstream
offers for self-hosted Confluence is not ported: this package targets Confluence
Cloud, and `config.json` ships empty so activation stays with the opt-in flow.

## Tools

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `list_spaces` | `limit` (default 25) + cursor, `_links.next` → cursor | `GET /wiki/api/v2/spaces` |
| `get_space` | GET + space mapping | `GET /wiki/api/v2/spaces/:id` |
| `list_pages` | space-scoped or site-wide, `sort`, cursor | `GET /wiki/api/v2/spaces/:id/pages`, `GET /wiki/api/v2/pages` |
| `get_page` | `body-format=storage` only when `include_body` | `GET /wiki/api/v2/pages/:id` |
| `create_page` | POST, storage body, `parentId` only when supplied | `POST /wiki/api/v2/pages` |
| `update_page` | PUT, `version.number = version_number + 1` | `PUT /wiki/api/v2/pages/:id` |
| `delete_page` | DELETE, 204 → `{ deleted: true }` | `DELETE /wiki/api/v2/pages/:id` |
| `get_page_children` | GET + `childPosition` mapping | `GET /wiki/api/v2/pages/:id/children` |
| `list_page_attachments` | GET + `_links.download` | `GET /wiki/api/v2/pages/:id/attachments` |
| `list_page_versions` | GET + `minorEdit` mapping | `GET /wiki/api/v2/pages/:id/versions` |
| `search` | CQL, `limit`/`start`, v1 response mapping | `GET /wiki/rest/api/search` |
| `list_comments` | footer comments, `body-format` | `GET /wiki/api/v2/pages/:id/footer-comments` |
| `list_inline_comments` | `resolution-status` filter | `GET /wiki/api/v2/pages/:id/inline-comments` |
| `list_comment_replies` | `comment_type` picks the endpoint | `GET /wiki/api/v2/{inline,footer}-comments/:id/children` |
| `create_comment` | POST `pageId` **or** `parentCommentId`, never both | `POST /wiki/api/v2/footer-comments` |
| `create_inline_comment` | POST `inlineCommentProperties` anchors | `POST /wiki/api/v2/inline-comments` |
| `delete_comment` | DELETE, 204 → `{ deleted: true }` | `DELETE /wiki/api/v2/footer-comments/:id` |
| `list_labels` | GET + label mapping | `GET /wiki/api/v2/pages/:id/labels` |
| `add_label` | POST bare JSON **array** `[{prefix,name}]` | `POST /wiki/rest/api/content/:id/label` |
| `remove_label` | DELETE with `?name=` query | `DELETE /wiki/rest/api/content/:id/label` |
| `get_user_profile` | account id defaults to the page's own | `GET /wiki/rest/api/user?accountId=` |

## Deviations from upstream

- **Writes send `X-Atlassian-Token: no-check`.** Confluence's XSRF check rejects
  a cookie-authenticated `POST`/`PUT`/`DELETE` that carries neither the page
  token nor this opt-out header; upstream's `fetch` sets only `Accept` and
  `Content-Type`. Reads are unchanged.
- **Auth and site meta are re-read per call** instead of cached through the
  plugin SDK's `getAuthCache`/`setAuthCache` (there is no storage in a workflow).
- **In-page deadline is 18 s**, not upstream's `AbortSignal.timeout(30_000)`, so
  the fetch cannot outlive the adapter's 25 s browser command.
- **Cursors are parsed by hand** (`URLSearchParams` on the query part of
  `_links.next`) rather than with `new URL(next, base)`: the page context has no
  global `URL`, and the relative link needs no base.
- **`assertPage` reads the path from `location.href`**, not
  `location.pathname`; the adapter hands the page a minimal `location` object.
- **Error messages prefer the API's JSON `message`/`errors[].message`** when the
  body parses, falling back to the first 512 bytes of the raw body, which is all
  upstream surfaces. Codes and status mapping are upstream's.
- **`outputSchema` is the package envelope** (`status`/`data`/`message`/
  `error_code`), the repo-wide convention; each tool's real payload shape is the
  upstream output schema and is documented per tool above.
- **Self-hosted `instanceUrl` is not supported** (see Scope).

## Verification

`npm test` covers the contract, upstream tool-set/schema parity (21/21 names and
input schemas from the published
`@opentabs-dev/opentabs-plugin-confluence@0.0.88`), and execution against a
stubbed `*.atlassian.net/wiki` page:

- spaces listing with cursor propagation, page listing scoped and site-wide,
  page read with and without `body-format=storage`, children, attachments,
  versions, CQL search on the v1 base path, footer/inline comment listing and
  replies;
- `create_page` (JSON body, default `current`, `parentId` omitted), `update_page`
  (version incremented by one), `delete_page` (204), `create_comment` (page and
  reply variants), `create_inline_comment` (numeric anchor fields),
  `delete_comment`, `add_label` (array body), `remove_label` (query delete),
  `get_user_profile` (current account from meta);
- failure paths: 401 → `AUTH`, 404 → `NOT_FOUND`, 429 → `RATE_LIMITED`,
  missing page meta → `UNAUTHENTICATED` with no request, Jira path on the same
  host → `UNSUPPORTED_PAGE` with no request, both comment ids → `VALIDATION`;
- `urlRegex` both ways: matches `/wiki/` pages (with and without query/fragment),
  rejects Jira paths, `www`-less hosts, lookalike hosts
  (`acme.atlassian.net.evil.com`) and self-hosted instances.
