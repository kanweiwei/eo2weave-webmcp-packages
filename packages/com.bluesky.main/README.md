# Bluesky WebMCP package (com.bluesky.main 0.1.0)

Full port of the OpenTabs Bluesky plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/bluesky) into
the builtin WebMCP package format: all 38 upstream tools, no subset — including
every write tool and the DM/chat tools.

Every call runs inside the bsky.app tab. The AT Protocol session is the page's
own: bsky.app keeps it in `localStorage.BSKY_STORAGE` under
`session.currentAccount` (`accessJwt`, `refreshJwt`, `did`, `pdsUrl`,
`active`). It is re-read on every call — the workflow is injected per call — and
never cached or returned to the caller, so switching accounts in a live tab
cannot reuse the previous account's token.

## Transport

| Namespace | Origin | Notes |
| --- | --- | --- |
| `app.bsky.*` (feeds, threads, search, profiles, graph reads, notifications) | `https://public.api.bsky.app/xrpc/<nsid>` | the public AppView the bsky.app web client itself queries |
| `com.atproto.repo.*` (create/delete record) | `{pdsUrl}/xrpc/<nsid>` | repository writes go to the session's PDS |
| `chat.bsky.convo.*` (DMs) | `{pdsUrl}/xrpc/<nsid>` | plus `atproto-proxy: did:web:api.bsky.chat#bsky_chat`, which is how chat is reached through the PDS |

Requests carry `Authorization: Bearer <accessJwt>` read from the page session
and are made with `credentials: 'omit'`: the XRPC hosts answer
`access-control-allow-origin: *`, so the browser rejects a credentialed
cross-origin fetch on this origin. The bearer token is the credential, exactly
as upstream sends it.

Pagination is upstream's: every cursor tool returns the response's `cursor`
(empty string when the AppView has no next page) and accepts it back as
`cursor`.

Error classification follows upstream, including the AT Protocol quirk that an
expired token arrives as **HTTP 400 `{"error":"ExpiredToken"}`** rather than
401: `ExpiredToken`/`InvalidToken`/`AuthMissing` → `AUTH`, 401/403 → `AUTH`,
404 → `NOT_FOUND`, 429 → `RATE_LIMITED` (with `Retry-After` surfaced as
`retry_after_ms`), other 400/422 → `VALIDATION`, everything else → `HTTP`.
A tab with no usable `BSKY_STORAGE` session fails `AUTH` before any request, and
a non-bsky.app tab fails `UNSUPPORTED_PAGE` without touching the session.

## Tools

### Feed

| Tool | Mechanics | XRPC |
| --- | --- | --- |
| `get_timeline` | cursor, default limit 50 | `app.bsky.feed.getTimeline` |
| `get_feed` | custom feed AT URI, cursor | `app.bsky.feed.getFeed` |
| `get_author_feed` | actor + `filter` enum, cursor | `app.bsky.feed.getAuthorFeed` |
| `get_post_thread` | `depth`/`parent_height`, recursive flatten | `app.bsky.feed.getPostThread` |
| `get_posts` | repeated `uris` param (max 25) | `app.bsky.feed.getPosts` |
| `get_list_feed` | list AT URI, cursor | `app.bsky.feed.getListFeed` |

### Posts

| Tool | Mechanics | XRPC |
| --- | --- | --- |
| `create_post` | `createRecord`, optional `reply` block (root defaults to parent) | `com.atproto.repo.createRecord` |
| `delete_post` | rkey from the AT URI | `com.atproto.repo.deleteRecord` |
| `search_posts` | `q` + sort/author/lang/domain/url/tag/since/until | `app.bsky.feed.searchPosts` |
| `like_post` | like record with `subject {uri,cid}` | `com.atproto.repo.createRecord` |
| `unlike_post` | delete the like record | `com.atproto.repo.deleteRecord` |
| `repost` | repost record with `subject {uri,cid}` | `com.atproto.repo.createRecord` |
| `unrepost` | delete the repost record | `com.atproto.repo.deleteRecord` |

### Profiles and social graph

| Tool | Mechanics | XRPC |
| --- | --- | --- |
| `get_current_user` | actor = session DID | `app.bsky.actor.getProfile` |
| `get_user_profile` | actor = DID or handle | `app.bsky.actor.getProfile` |
| `get_user_profiles` | repeated `actors` param (max 25) | `app.bsky.actor.getProfiles` |
| `search_users` | cursor | `app.bsky.actor.searchActors` |
| `search_users_typeahead` | max 10 | `app.bsky.actor.searchActorsTypeahead` |
| `get_followers` | cursor, default limit 50 | `app.bsky.graph.getFollowers` |
| `get_follows` | cursor, default limit 50 | `app.bsky.graph.getFollows` |
| `follow_user` | follow record `subject` = DID | `com.atproto.repo.createRecord` |
| `unfollow_user` | delete the follow record | `com.atproto.repo.deleteRecord` |
| `get_blocks` | cursor, default limit 50 | `app.bsky.graph.getBlocks` |
| `mute_actor` / `unmute_actor` | JSON body `{actor}` | `app.bsky.graph.muteActor` / `unmuteActor` |
| `mute_thread` / `unmute_thread` | JSON body `{root}` | `app.bsky.graph.muteThread` / `unmuteThread` |

### Notifications and chat

| Tool | Mechanics | XRPC |
| --- | --- | --- |
| `list_notifications` | cursor, default limit 25 | `app.bsky.notification.listNotifications` |
| `get_unread_count` | — | `app.bsky.notification.getUnreadCount` |
| `mark_notifications_seen` | body `{seenAt}` | `app.bsky.notification.updateSeen` |
| `list_conversations` | cursor, default limit 25 | `chat.bsky.convo.listConvos` |
| `get_conversation` | `convoId` query | `chat.bsky.convo.getConvo` |
| `get_messages` | `convoId` + cursor | `chat.bsky.convo.getMessages` |
| `send_message` | body `{convoId, message:{text}}` | `chat.bsky.convo.sendMessage` |
| `delete_message` | body `{convoId, messageId}` (for self) | `chat.bsky.convo.deleteMessageForSelf` |
| `mute_conversation` / `unmute_conversation` | body `{convoId}` | `chat.bsky.convo.muteConvo` / `unmuteConvo` |
| `mark_conversation_read` | body `{convoId}` | `chat.bsky.convo.updateRead` |

## Output shapes

Every tool returns the adapter envelope `{ status, data, message, error_code }`
with the upstream output object inside `data` (`{ posts, cursor }`,
`{ profile }`, `{ thread }`, `{ like_uri }`, `{ conversation }`, …), so a caller
reads the same field names upstream documents.

Input schemas are the published upstream `input_schema` objects verbatim, so
`limit`/`depth`/`parent_height` are `integer`, `uris`/`actors` are arrays, and
`filter`/`sort` stay enums — the host validates arguments without coercion.

## Upstream assumptions to watch

- The session storage layout (`BSKY_STORAGE` → `session.currentAccount`) is
  bsky.app's client-internal format. If the web client moves the session to
  IndexedDB or renames the key, every tool degrades to `AUTH` — which is the
  failure to look for first.
- AppView reads are pinned to `public.api.bsky.app`; a self-hosted AppView or a
  change of that host would need the constant updated.
- `pdsUrl` comes from the session, so repository writes follow the account's
  own PDS (including custom-domain PDS hosts).
- `create_post` sends `langs: ['en']` like upstream — it is not detected from
  the text.
