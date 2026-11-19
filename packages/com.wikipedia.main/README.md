# Wikipedia WebMCP package (com.wikipedia.main 0.1.0)

Full port of the OpenTabs Wikipedia plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/wikipedia) into
the builtin WebMCP package format: all 19 upstream tools, no subset.

Every call runs inside the current `*.wikipedia.org` tab. Wikipedia is
server-rendered MediaWiki, so the port talks to the wiki's own action API on the
tab's origin — `/w/api.php` with `format=json&formatversion=2` — and reuses the
tab's session cookies (`credentials: 'include'`). Three tools use the Wikimedia
REST API instead (`/api/rest_v1/...` for the page summary and the featured feed,
`https://wikimedia.org/api/rest_v1/metrics/...` for page views), matching the
endpoints upstream calls.

The login identity is read from the page, never from the caller:
`mw.config.values.wgUserName` and `mw.config.values.wgUserId`. It is re-read on
every call, so an account switch in a live tab cannot keep answering with the
previous session's identity. Only `get_current_user` needs it; the other 18
tools are public reads that work anonymously, exactly like the upstream
implementations.

## Tools

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `search_articles` | `list=search`, `srlimit`/`sroffset`, snippet HTML stripped | `GET /w/api.php?action=query&list=search` |
| `get_article` | intro extract + info + pageprops + thumbnail, `missing` → NOT_FOUND | `GET /w/api.php?action=query&prop=extracts\|info\|pageprops\|pageimages` |
| `get_page_summary` | REST summary, spaces → underscores before encoding | `GET /api/rest_v1/page/summary/:title` |
| `get_article_sections` | parse sections, string indexes kept verbatim | `GET /w/api.php?action=parse&prop=sections` |
| `get_section_content` | parse text, `disabletoc`/`disableeditsection`, HTML → plain text | `GET /w/api.php?action=parse&prop=text&section=` |
| `get_article_categories` | `prop=categories`, `cllimit` | `GET query&prop=categories` |
| `get_article_links` | `prop=links`, `plnamespace=0` | `GET query&prop=links` |
| `get_article_languages` | `prop=langlinks`, `llprop=url`, legacy `*` title fallback | `GET query&prop=langlinks` |
| `get_backlinks` | `list=backlinks`, `blnamespace=0` | `GET query&list=backlinks` |
| `get_revisions` | `prop=revisions`, ids/timestamp/user/comment/size | `GET query&prop=revisions` |
| `compare_revisions` | `action=compare`, diff cells rendered as `-`/`+` lines | `GET /w/api.php?action=compare` |
| `get_recent_changes` | `list=recentchanges`, `rctype=edit`, `rcnamespace=0`, old/new sizes | `GET query&list=recentchanges` |
| `get_random_articles` | `list=random`, `rnnamespace=0` | `GET query&list=random` |
| `opensearch` | bare array `[query, titles, descriptions, urls]` | `GET /w/api.php?action=opensearch` |
| `get_current_user` | identity from `mw.config`, then `meta=userinfo` | `GET query&meta=userinfo` |
| `get_user_contributions` | `list=usercontribs`, `ucuser` | `GET query&list=usercontribs` |
| `get_category_members` | `list=categorymembers`, `cmtype` passthrough (default `page`) | `GET query&list=categorymembers` |
| `get_page_views` | cross-origin, anonymous (`credentials: 'omit'`), daily series | `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...` |
| `get_featured_content` | `tfa` + top-10 most read + top-5 on-this-day | `GET /api/rest_v1/feed/featured/:YYYY/MM/DD` |

## Error classification

MediaWiki reports application failures with HTTP 200 in an `error` object; the
port classifies those the way upstream does: `badtoken` / `assertuserfailed` →
`AUTH`, `missingtitle` / `nosuchpageid` → `NOT_FOUND`, `ratelimited` →
`RATE_LIMITED`, anything else → `INTERNAL`. Transport failures are classified by
status (`AUTH`, `NOT_FOUND`, `RATE_LIMITED`, `HTTP`) or `NETWORK`. Two tool-level
codes sit on top: `invalidsection` → `VALIDATION`, `nosuchrevid` → `NOT_FOUND`.
A logged-out tab yields `UNAUTHENTICATED` from `get_current_user` without an API
call, and any tab that is not `*.wikipedia.org` yields `UNSUPPORTED_PAGE`.

## Deviations from upstream (deliberate)

- **No auth cache.** Upstream stores `{username, userId}` in the SDK's auth cache;
  the port re-reads `mw.config` per call. Same source, no stale identity after an
  account switch in a still-loaded tab.
- **Readiness gate is best-effort.** Upstream gates the whole plugin on `isReady()`
  (`mw.config.values.wgSiteName`). The port only waits for it inside
  `get_current_user`, which is the only tool that reads `mw.config`; the public
  API reads do not need it and therefore do not fail while the page bundle loads.
- **Errors are envelopes, not throws.** `ToolError.auth` becomes
  `UNAUTHENTICATED` and `ToolError.validation` becomes `VALIDATION`, so the
  adapter always returns `{status, data, message, error_code}`.
- **`api()` keeps both verbs.** The GET path is used by all 19 tools; the
  form-encoded POST path upstream implements is ported unchanged (no tool uses
  writes — upstream has no write tool).

## Notes

- Outputs keep the upstream shapes (`{ article }`, `{ results, total_hits, suggestion }`,
  `{ sections }`, `{ featured_article, most_read, on_this_day }`, …) inside the
  adapter envelope.
- Types are declared as the API takes them: `limit`/`offset`/`section` are
  `integer`s with the upstream bounds, never strings.
- `get_page_views` is the only cross-origin call: it is hard-wired to
  `en.wikipedia` (upstream does the same) and sends no cookies
  (`credentials: 'omit'`), again as upstream does.
