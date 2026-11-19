# Tumblr WebMCP package (com.tumblr.main 0.1.0)

Full port of the OpenTabs Tumblr plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/tumblr) into
the builtin WebMCP package format: all 32 upstream tools, no subset — reads
(dashboard, blogs, posts, queues, drafts, submissions, notes, likes, followers,
notifications, tags, blocks, recommendations) and every write (create, edit,
reblog, delete, like, unlike, follow, unfollow, block, unblock, tag filters).

Every call runs inside the tumblr.com tab. The session is the page's own: the
redpop web client embeds it in

```html
<script id="___INITIAL_STATE___">{"apiFetchStore":{"API_TOKEN":"…"},"csrfToken":"…"}</script>
```

The runtime re-reads that blob on every call (the workflow is injected per
call), so switching accounts in a live tab cannot reuse the previous account's
token. The token is never logged, cached across calls, or returned to the
caller.

## Transport

All calls are **same-origin** fetches to the paths the redpop web client itself
uses, with `credentials: 'include'` so the tab's cookies travel with them:

| Element | Value |
| --- | --- |
| Base | `/api/v2` on the current tumblr.com origin |
| Auth | `Authorization: Bearer <apiFetchStore.API_TOKEN>` from the page |
| Version | `X-Version: redpop/3/0//redpop/` |
| Accept | `application/json;format=camelcase` (camelCase responses, which the mappers expect) |
| Writes | `X-Csrf: <csrfToken>`; JSON body with `Content-Type: application/json` |
| CSRF refresh | when the page's csrf token is empty, `GET /api/v2/user/info` first and take `x-csrf` from the response headers (upstream's `refreshCsrf`) |
| Response | `{ meta, response }` envelope → tools work on `response`; `204` → `{}` |
| Retry-after | `429` surfaces `Retry-After` as `retry_after_ms` |

The `x-csrf` response header is also captured after every call, so a long-lived
page keeps writing with a fresh token.

Error classification follows upstream (`fetchFromPage` → `httpStatusToToolError`
categories): `401/403` → `AUTH` (the cached page token is dropped),
`404` → `NOT_FOUND`, `429` → `RATE_LIMITED`, `400/422` → `VALIDATION`,
`408` → `TIMEOUT`, anything else → `HTTP`. A page with no usable
`___INITIAL_STATE___` token fails `AUTH` before any request; a tab that is not
on tumblr.com fails `UNSUPPORTED_PAGE` without touching the session.

## Tools

### Dashboard and account

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `get_dashboard` | `npf=true`, limit (max 20), offset, type, `since_id` | `GET /user/dashboard` |
| `get_current_user` | user + owned blogs | `GET /user/info` |
| `get_user_limits` | map of limit records (posts, photos, video, follows) | `GET /user/limits` |
| `get_user_likes` | `npf=true`, default limit 20, `liked_count` | `GET /user/likes` |
| `get_user_following` | default limit 20, `total_blogs` | `GET /user/following` |
| `follow_blog` / `unfollow_blog` | JSON body `{url}`, bare host gets `https://` | `POST /user/follow` / `POST /user/unfollow` |
| `get_filtered_tags` | tag strings | `GET /user/filtered_tags` |
| `add_filtered_tag` | body `{filtered_tags:[tag]}` | `POST /user/filtered_tags` |
| `remove_filtered_tag` | tag in the path, URL-encoded | `DELETE /user/filtered_tags/<tag>` |

### Posts

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `get_post` | `npf=true` | `GET /blog/<blog>/posts/<id>` |
| `create_post` | NPF body `{content:[{type:'text',text}], tags, state}` | `POST /blog/<blog>/posts` |
| `edit_post` | only supplied fields (content as NPF, tags, state) | `PUT /blog/<blog>/posts/<id>` |
| `delete_post` | body `{id}` | `POST /blog/<blog>/post/delete` |
| `reblog_post` | `parent_tumblelog_uuid`, `parent_post_id`, `reblog_key`, NPF comment, `state:'published'` | `POST /blog/<blog>/posts` |
| `like_post` / `unlike_post` | body `{id, reblog_key}` | `POST /user/like` / `POST /user/unlike` |
| `get_post_notes` | `id` + `mode` (default `all`), `total_notes` | `GET /blog/<blog>/notes` |
| `get_draft_posts` | `npf=true`, optional `before_id` cursor | `GET /blog/<blog>/posts/draft` |
| `get_queued_posts` | `npf=true`, limit, offset | `GET /blog/<blog>/posts/queue` |
| `get_submissions` | `npf=true`, offset | `GET /blog/<blog>/posts/submission` |

### Blogs

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `get_blog_info` | title, description, posts, followers, avatar | `GET /blog/<blog>/info` |
| `get_blog_posts` | `npf=true`, limit, offset, type enum, tag | `GET /blog/<blog>/posts` |
| `get_blog_followers` | default limit 20, `totalUsers` | `GET /blog/<blog>/followers` |
| `get_blog_following` | default limit 20, `totalBlogs` | `GET /blog/<blog>/following` |
| `get_blog_likes` | `npf=true`, default limit 20, `likedCount` | `GET /blog/<blog>/likes` |
| `get_blog_notifications` | optional `before` timestamp | `GET /blog/<blog>/notifications` |

### Explore and moderation

| Tool | Mechanics | Endpoint |
| --- | --- | --- |
| `search_tagged` | `tag`, `npf=true`, limit, `before` (response is a bare array) | `GET /tagged` |
| `get_recommended_blogs` | default limit 8 | `GET /recommended/blogs` |
| `get_blocks` | default limit 20, `blockedTumblelogs` | `GET /blog/<blog>/blocks` |
| `block_blog` | body `{blockedTumblelog}` | `POST /blog/<blog>/blocks` |
| `unblock_blog` | `blockedTumblelog` on the query string | `DELETE /blog/<blog>/blocks` |

## Output shapes

Every tool returns the adapter envelope `{ status, data, message, error_code }`
with the upstream output object inside `data` (`{ posts }`, `{ post }`,
`{ blog }`, `{ blogs, total }`, `{ notes, total_notes }`, `{ id, state }`,
`{ success }`, …), so a caller reads the same field names upstream documents.

Mappers are upstream's, one-for-one: posts expose the 64-bit id as
`id` (from `idString`), the flattened `content_text` of the NPF text blocks,
`reblog_key`, and the `can_like`/`can_reblog`/`can_reply` flags; blogs expose
`avatar_url` from `avatar[0].url`; notes and notifications carry the actor blog
name, avatar and any reply/reblog text.

Input schemas are the published upstream `input_schema` objects verbatim:
`limit`/`offset` are `integer` with upstream's bounds (`limit` 1–20), `state`
and `type`/`mode` stay enums, `before`/`before_id` are cursors, `tags` on
`create_post`/`edit_post` is the comma-separated string upstream takes.

## Upstream assumptions to watch

- The session layout (`#___INITIAL_STATE___` → `apiFetchStore.API_TOKEN` +
  `csrfToken`) is the redpop web client's internal format. If Tumblr moves the
  bootstrap blob (different element id or key), every tool degrades to `AUTH` —
  that is the first thing to check when a logged-in tab reports logged out.
- Writes depend on `X-Csrf`. Upstream read the header name from the client and
  so does this port; a rejected write with `AUTH`/`VALIDATION` on a logged-in
  tab usually means the csrf header name or the refresh path moved.
- `reblog_post` sends `parent_tumblelog_uuid` with the parent **blog name**, as
  upstream does (the composer calls it a uuid but the web client accepts the
  name).
- `get_post_notes.total_notes` is passed through as Tumblr returns it; on
  responses without it the field is absent rather than zero (upstream
  behaviour, kept).
- Path segments (`blog_name`, `post_id`) are interpolated as upstream does; a
  blog name is a slug, so no escaping is applied.

## Deviations from upstream

- A non-tumblr.com tab is refused with `UNSUPPORTED_PAGE` before the session is
  read (upstream has no host guard because the extension only injects into
  matching tabs; the WebMCP host can hand any tab to a workflow).
- A `204`/empty body, or an envelope without a `response` member, yields `{}`
  instead of a parse error, so bodyless delete/unlike/block calls and
  single-object reads stay successful.
- The in-page fetch aborts after 18s so a hung request cannot outlive the
  browser command (upstream relied on the SDK's 30s `AbortSignal.timeout`).
