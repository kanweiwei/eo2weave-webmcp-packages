# X (Twitter) WebMCP package (com.x.main 0.1.0)

Full port of the OpenTabs X plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/x, published as
`@opentabs-dev/opentabs-plugin-x`) into the builtin WebMCP package format: all
31 upstream tools, no subset — every timeline, tweet, user, engagement,
bookmark, explore and list tool, including every write
(post, reply, quote, delete, pin, like, unlike, retweet, unretweet, bookmark,
unbookmark, create/update/delete list, add/remove list member).

Every call runs inside the x.com tab. The session is the page's own: the
`ct0` cookie is read on each call (the workflow is injected per call, so
nothing is cached between calls) and never returned to the caller. Switching
accounts in a live tab therefore cannot reuse the previous account's token.

## Transport

X has no usable public REST surface for these operations; the web client
speaks GraphQL, and so does this port — same operations, same variables, same
feature flags, same mappers as upstream.

| Method | Path | Used by |
| --- | --- | --- |
| `GET` | `https://x.com/i/api/graphql/<queryId>/<operation>?variables=…&features=…[&fieldToggles=…]` | every query (`TweetResultByRestId`, `TweetDetail`, `UserTweets`, `UserByScreenName`, `UserByRestId`, `Following`, `Likes`, `Favoriters`, `Retweeters`, `Bookmarks`, `ExploreSidebar`, `SearchTimeline`, `ListByRestId`, `ListRankedTweetsTimeline`) |
| `POST` | `https://x.com/i/api/graphql/<queryId>/<operation>` with `{variables, features, queryId}` | every mutation (`HomeTimeline`, `HomeLatestTimeline`, `CreateTweet`, `DeleteTweet`, `PinTweet`, `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`, `CreateBookmark`, `DeleteBookmark`, `CreateList`, `UpdateList`, `DeleteList`, `ListAddMember`, `ListRemoveMember`) |

Requests carry the web client's static bearer token plus the page's session
(`credentials: 'include'`, same-origin x.com):

| Header | Value |
| --- | --- |
| `authorization` | `Bearer AAAAA…` (the public web-client token upstream pins) |
| `x-csrf-token` | the `ct0` cookie — a tab without it fails `AUTH` before any request |
| `x-twitter-auth-type` | `OAuth2Session` |
| `x-twitter-active-user` | `yes` |
| `x-twitter-client-language` | `en` |
| `content-type` | `application/json` |
| `x-client-transaction-id` | signed, `SearchTimeline` only (see below) |

### Query hashes are discovered, not pinned

X rotates the `queryId` in every URL with each web bundle release, so none are
hard-coded here. On each call the page runtime scans
`window.webpackChunk_twitter_responsive_web` for
`queryId:"…", operationName:"…"` markers and resolves the requested operation;
a page whose bundle does not publish it fails
`INTERNAL — GraphQL operation "X" not found in X client bundle`, exactly as
upstream does.

`SearchTimeline` additionally requires the signed `x-client-transaction-id`
header. Upstream locates the signer module by its `jJ:()=>` marker, obtains a
`require` through a probe chunk push, and calls `jJ('x.com', path, method)`.
That whole path is reproduced; when the signer module is missing the header is
simply omitted (upstream's degradation) rather than failing the call.

## Error mapping

Upstream's `ToolError` categories map onto the package envelope's `error_code`:

| Condition | `error_code` |
| --- | --- |
| no `ct0` cookie (logged out) | `AUTH` |
| HTTP 401 / 403 | `AUTH` |
| HTTP 429 (`x-rate-limit-reset` → `retry_after_ms`) | `RATE_LIMITED` |
| HTTP 404 | `NOT_FOUND` |
| fetch aborted at 18s | `TIMEOUT` |
| fetch rejected | `NETWORK` |
| any other HTTP status, GraphQL `errors[]`, missing operation hash | `INTERNAL` |
| `CreateTweet` returned `tweet_results: {}` | `EMPTY_RESULT_AMBIGUOUS` |
| tab on another host | `UNSUPPORTED_PAGE` |

`EMPTY_RESULT_AMBIGUOUS` is upstream's own code and is kept verbatim: X
accepted the request but returned no tweet, so the post may or may not have
landed and a blind retry could double-post.

## Tools

* **Timelines** — `get_home_timeline`, `get_latest_timeline`, `get_user_tweets`
* **Tweets** — `get_tweet`, `create_tweet`, `quote_tweet`, `delete_tweet`,
  `get_tweet_replies`, `pin_tweet`
* **Users** — `get_user_profile`, `get_user_by_id`, `get_following`,
  `get_user_likes`
* **Engagement** — `like_tweet`, `unlike_tweet`, `retweet`, `unretweet`,
  `bookmark_tweet`, `remove_bookmark`, `get_likers`, `get_retweeters`
* **Bookmarks / Explore** — `get_bookmarks`, `get_trending`, `search_tweets`
* **Lists** — `get_list`, `create_list`, `update_list`, `delete_list`,
  `get_list_tweets`, `add_list_member`, `remove_list_member`

`quote_tweet` first resolves the quoted tweet's author handle and then posts
`CreateTweet` with `attachment_url: https://x.com/<handle>/status/<id>`: X
rejects an attachment URL that lacks the username segment (error 44).

## Deviations from upstream

1. **Request timeout 18s** (upstream `AbortSignal.timeout(30_000)`). The
   package command deadline is 25s, so the in-page fetch aborts at 18s and
   classifies as `TIMEOUT` instead of orphaning a request. `AbortController` is
   used because the WebMCP page sandbox does not expose `AbortSignal.timeout`.
2. **urlRegex covers `x.com` (and its subdomains) only** —
   `^https?://(?:[a-z0-9-]+\.)*x\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$`. That is
   exactly upstream's `urlPatterns: ['*://*.x.com/*']`; `twitter.com` is not
   targeted upstream and a twitter.com tab redirects to x.com, while the
   same-origin `credentials: 'include'` requests require the x.com origin. A
   tab on any other host is refused with `UNSUPPORTED_PAGE` before a request.
3. **Response-shape guards** — where upstream dereferences
   `data.data.user.result` / `data.data.tweetResult.result` directly, a missing
   node is reported as `NOT_FOUND` (with the id) instead of letting a page-side
   `TypeError` escape; any other page-side throw is classified `INTERNAL`.
4. **`get_trending` URL extraction** is upstream's `/query=([^&]+)/` match, so a
   trend URL without a `query=` parameter yields `url: ""` (upstream behaviour,
   reproduced rather than "fixed").

## Tests

`scripts/tests/com.x.main.test.mjs` runs the ported runtime against a stubbed
x.com tab (ct0 cookie, webpack chunk registry with the operation hashes and the
`jJ` signer) and asserts the exact request plus the parsed output for:
timeline (both operations, first page and cursor page), profile, single tweet
(including the `TweetWithVisibilityResults` unwrap), thread, search (including
the signed header), trending, bookmarks, likers, list reads, posting, replying,
quoting, like/unlike, retweet/unretweet, bookmark/unbookmark, delete, pin, list
create/update/delete and membership writes, plus the failure paths: logged out
(`AUTH`, no request), 401, 404, 429 with `retry_after_ms`, a bundle without the
operation hash, a non-x.com tab and a network error. `urlRegex` is probed in
both directions for every tool.
