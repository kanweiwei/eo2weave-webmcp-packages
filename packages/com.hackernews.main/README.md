# Hacker News WebMCP package (com.hackernews.main 0.1.0)

Full port of the OpenTabs Hacker News plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/hackernews)
into the builtin WebMCP package format — all 10 upstream tools, including the
write tool `submit_comment`.

Hacker News serves a strict CSP (`default-src 'self'`, no `connect-src`
override), so every cross-origin API (Firebase, Algolia) is blocked from the
page. Exactly like the upstream plugin, each tool therefore fetches HN's own
server-rendered HTML from the `news.ycombinator.com` tab and parses it with
`DOMParser`, all inside `browser.eval` with `credentials: 'include'`: the
session cookie travels with the request and is never read out of the page.

## Tools

| Tool | Mechanics | Hacker News page |
| --- | --- | --- |
| `get_item` | item page parse, story/job/comment branch | `GET /item?id=:id` |
| `get_user` | nested profile table parse (karma, created, about) | `GET /user?id=:username` |
| `list_top_stories` | listing parse (`tr.athing` + `.subtext`), `?p=` pagination | `GET /news[?p=n]` |
| `list_new_stories` | listing parse | `GET /newest[?p=n]` |
| `list_best_stories` | listing parse | `GET /best[?p=n]` |
| `list_ask_stories` | listing parse | `GET /ask[?p=n]` |
| `list_show_stories` | listing parse | `GET /show[?p=n]` |
| `list_job_stories` | listing parse (rows without score/author) | `GET /jobs[?p=n]` |
| `get_story_comments` | comment rows, `.ind img width` nesting depth, `&p=` pagination | `GET /item?id=:story_id[&p=n]` |
| `submit_comment` | reply form HMAC token + multipart POST | `GET /reply?id=:parent_id` → `POST /comment` |

Every workflow returns `{ status: 'ok'|'error', data, message }` (mirrored into
`state.result`). Successes carry the tool's payload: `{ item }`, `{ user }`,
`{ stories, has_more }`, `{ comments, total, has_more }` or `{ success }`.

Error results carry a stable `error_code`: `UNSUPPORTED_PAGE` (not on
news.ycombinator.com), `AUTH` (not logged in, no comment form, no HMAC token,
or an HTTP 401/403), `NOT_FOUND` (`No such item`, unknown user, HTTP 404),
`PARSE` (HN returned HTML without the expected rows — never an empty success),
`RATE_LIMITED` (HTTP 429), `NETWORK`, `TIMEOUT` (the in-page request hit its
18s deadline), `HTTP`, `EMPTY_RESULT`, `TAB_UNAVAILABLE` (the tab closed,
navigated away, or could not run the tool) or `UNKNOWN`.

## Argument types

Schemas are the JSON Schema of the upstream zod definitions, not strings:
`id`, `story_id`, `parent_id` and `page` are `integer` (minimum 1) and the
workflow uses them as numbers; nothing is parsed inside the page runtime.

## Deviations from upstream

- `submit_comment` returns `{ success: true }` (upstream returns `{}`), so the
  caller gets a readable result instead of an empty payload.
- A story listing with zero `tr.athing` rows is a `PARSE` error rather than an
  empty `[]`: no rows means HN's markup moved, and an empty successful answer
  would hide it.
- The user lookup URL-encodes the username (`encodeURIComponent`); upstream
  interpolates it raw. Behaviour is identical for real HN usernames.

## Verification

`node scripts/test-packages.mjs` executes 7 test blocks against a
happy-dom DOM with HN-shaped fixtures: a listing page (ids, title, url, site,
score, `by`, exact `time`, `descendants`, `has_more`), listing pagination,
the empty-listing parse failure, an item page (story + job + `No such item`),
a user profile, a story's comments (nesting depth, total) and the comment POST
(the reply form's HMAC token, `POST /comment`, multipart body, no JSON
content-type) plus its logged-out `AUTH` path. The harness also asserts the
10-tool set against the upstream OpenTabs tool set and, when
`scripts/fetch-opentabs.mjs` has cached it, the per-tool input schema.

Not verified in a browser: real HN markup drift, and an actual logged-in
comment submission.
