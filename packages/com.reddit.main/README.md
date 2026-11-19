# Reddit WebMCP package (com.reddit.main 0.1.0)

Full port of the OpenTabs Reddit plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/reddit) into the
builtin WebMCP package format: all 23 upstream tools the published manifest
registers, no subset.

Every call runs inside a reddit.com tab (`www.reddit.com`, `old.reddit.com` or
`new.reddit.com` — the upstream `urlPatterns`). Reads are plain same-site
`fetch` against the public `.json` API with `credentials: 'include'`, exactly
like upstream `reddit-api.ts`. Nothing is scraped from the DOM.

## Authentication

- **Reads** ride on the session cookies the tab already has. A 401/403 surfaces
  as `AUTH`, a 404 as `NOT_FOUND`, a 429 as `RATE_LIMITED`.
- **Writes** first `GET https://www.reddit.com/api/me.json` for the `modhash`
  and send it as `uh` in the form body plus `X-Modhash`; `api_type=json` is
  appended. A failed modhash fetch (401 or a missing token) is `AUTH` — writes
  never go out without it. A 401/403 on the write clears the cached modhash.
- **Private messages** are the one endpoint that rejects cookie auth: upstream
  exchanges the `csrf_token` cookie for a short-lived bearer token at
  `POST /svc/shreddit/token` and posts the form to
  `https://oauth.reddit.com/api/compose` with `Authorization: Bearer …`
  (no cookies on that call). The port keeps that path.

The modhash and bearer token are cached for one tool call only — never stored in
the workflow body, the manifest or the output — so an account switch in a live
tab cannot replay the previous account's credential.

## Tools

| Tool | Mechanics | Reddit endpoint |
| --- | --- | --- |
| `get_me` | GET | `GET /user/me/about.json` |
| `list_posts` | GET + `limit`/`t`/`after` cursor, optional bodies | `GET /r/:sub/:sort.json`, `GET /:sort.json` |
| `get_post` | GET + post/comment listings, depth-capped flatten | `GET /r/:sub/comments/:id.json` |
| `search_posts` | GET + `q`/`restrict_sr` + cursor | `GET /r/:sub/search.json`, `GET /search.json` |
| `submit_post` | modhash form POST, optional fields omitted | `POST /api/submit` |
| `submit_comment` | modhash form POST, `errors[]` surfaced | `POST /api/comment` |
| `get_comment_thread` | GET `comment`/`depth` focus + reply flatten | `GET /r/:sub/comments/:id.json` |
| `edit_text` | modhash form POST | `POST /api/editusertext` |
| `delete` | modhash form POST | `POST /api/del` |
| `vote` | modhash form POST, `dir` = -1/0/1 | `POST /api/vote` |
| `save` | modhash form POST (save/unsave) | `POST /api/save`, `/api/unsave` |
| `hide` | modhash form POST (hide/unhide) | `POST /api/hide`, `/api/unhide` |
| `report` | modhash form POST | `POST /api/report` |
| `list_user_content` | GET + `where`/`sort`/`t`/cursor | `GET /user/:name/:where.json` |
| `get_subreddit` | GET | `GET /r/:sub/about.json` |
| `list_flairs` | GET, bare array response | `GET /r/:sub/api/link_flair_v2.json` |
| `search_subreddits` | GET + cursor | `GET /subreddits/search.json` |
| `list_subscriptions` | GET + cursor | `GET /subreddits/mine/subscriber.json` |
| `list_popular_subreddits` | GET + `category` + cursor | `GET /subreddits/:category.json` |
| `subscribe` | modhash form POST | `POST /api/subscribe` |
| `get_user` | GET | `GET /user/:name/about.json` |
| `send_message` | bearer token + OAuth form POST | `POST /svc/shreddit/token` → `POST oauth.reddit.com/api/compose` |
| `read_inbox` | GET + cursor | `GET /message/inbox.json` |

## Deviations from upstream

- **18s in-page deadline** instead of upstream's 30s `AbortSignal.timeout`: the
  browser command deadline is 25s, so the in-page fetch aborts before it and a
  timed-out call cannot orphan a request. Surfaced as `NETWORK`.
- Empty-body mutations return `{ "success": true }` — the upstream tool output
  schema, unchanged. `delete`/`report`/etc. are not rewritten to `{}`.
- `outputSchema` is the adapter envelope (`status`/`data`/`message`/`error_code`)
  used by every package in this repo; the per-tool payload is `data`.

## Verified

- `node scripts/fetch-opentabs.mjs` caches the published manifest (23 tools);
  `npm test` asserts the tool-name SET and every input schema against it.
- Execution tests in `scripts/test-packages.mjs` cover: a listing read, a
  cursor+time-filter page, post/comment flattening, a vote write (modhash +
  form body), a comment POST, a text-post submit (optional fields omitted),
  the OAuth bearer message path, inbox pagination, and the auth-failure paths.
- `urlRegex` probed against www/old/new hosts (with query/hash tails) and
  rejected for the apex host, plain HTTP, lookalikes, userinfo and ports.
