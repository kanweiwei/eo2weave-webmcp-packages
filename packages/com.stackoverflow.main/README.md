# Stack Overflow WebMCP package (com.stackoverflow.main 0.1.0)

Full port of the OpenTabs Stack Overflow plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/stackoverflow)
into the builtin WebMCP package format: all 20 upstream tools, no subset.

Every call runs inside the stackoverflow.com tab and talks to the public
Stack Exchange API v2.3 (`https://api.stackexchange.com/2.3`), exactly like the
upstream `stackoverflow-api.ts` helper: `site=stackoverflow`, the caller's
parameters in declaration order (empty strings and `undefined` are dropped), and
`filter=withbody` appended unless the caller supplied a filter. Responses are
mapped through the upstream `tools/schemas.ts` mappers, so unix timestamps
become ISO 8601 strings and nested `owner` / `badge_counts` objects are
flattened into the documented flat fields.

Because the API is public, calls are sent **without credentials**
(`credentials: 'omit'`). `api.stackexchange.com` answers
`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: false`,
so a credentialed cross-origin fetch is rejected by the browser outright — and
there is nothing to send: the API needs no Stack Overflow cookie. That is the one
deliberate difference from same-origin ports in this repo, which send
`credentials: 'include'`.

The only authenticated tool is `get_my_profile`. It reads the signed-in user id
from the page (`StackExchange.options.user.isRegistered` / `.userId`, the same
globals upstream reads), never from the caller, and returns `UNAUTHENTICATED` on
a logged-out tab. Every other tool is a public read, including in upstream.

There are no write tools upstream (no ask/answer/comment/vote/edit), so this port
has none — the tool set is the upstream set, one for one.

## Tools

| Tool | Mechanics | Stack Exchange API v2.3 |
| --- | --- | --- |
| `search_questions` | full-text + tags + accepted/answers filters | `GET /search/advanced` |
| `get_question` | single question (body), `NOT_FOUND` on empty items | `GET /questions/{id}` |
| `list_questions` | sort activity/creation/votes/hot/week/month | `GET /questions` |
| `get_question_answers` | default sort `votes` | `GET /questions/{id}/answers` |
| `get_question_comments` | default sort `creation` | `GET /questions/{id}/comments` |
| `list_related_questions` | system-similar questions | `GET /questions/{id}/related` |
| `list_linked_questions` | questions linking to this one | `GET /questions/{id}/linked` |
| `list_featured_questions` | questions with an active bounty | `GET /questions/featured` |
| `list_unanswered_questions` | no upvoted/accepted answer | `GET /questions/unanswered` |
| `get_similar_questions` | title-similarity search | `GET /similar` |
| `get_answer` | single answer (body) | `GET /answers/{id}` |
| `get_answer_comments` | default sort `creation` | `GET /answers/{id}/comments` |
| `get_user` | profile + `badge_counts` flattening | `GET /users/{id}` |
| `search_users` | display-name search, default sort `reputation` | `GET /users` |
| `get_user_questions` | default sort `activity` | `GET /users/{id}/questions` |
| `get_user_answers` | default sort `activity` | `GET /users/{id}/answers` |
| `get_my_profile` | authenticated, user id read from the page | `GET /users/{id}` |
| `list_tags` | popularity/activity/name, `inname` filter | `GET /tags` |
| `get_tag_info` | two calls: info + wiki | `GET /tags/{t}/info`, `/wikis` |
| `search_excerpts` | highlights, question and answer hits | `GET /search/excerpts` |

## Error mapping

The API reports failures in the body with a numeric `error_id`, which upstream
classifies by id; the port keeps that mapping:

| Condition | `error_code` |
| --- | --- |
| `error_id` 502 (throttle violation) | `RATE_LIMITED` |
| `error_id` 401 / 403 | `AUTH` |
| `error_id` 404 | `NOT_FOUND` |
| `error_id` 400 | `VALIDATION` |
| other `error_id` | `INTERNAL` |
| `backoff` in the response | `RATE_LIMITED` |
| non-2xx HTTP, unparsable JSON | `HTTP` / `INTERNAL` |
| in-page abort (18s) or fetch failure | `TIMEOUT` / `NETWORK` |
| not logged in (`get_my_profile`) | `UNAUTHENTICATED` |
| tab is not `*.stackoverflow.com` | `UNSUPPORTED_PAGE` |

## Scope

Upstream scopes the plugin to `*://*.stackoverflow.com/*`; the port's
`urlRegex` matches `https://` on `stackoverflow.com` and any subdomain
(`meta.`, `www.`, …) with an optional query/hash tail, and rejects plain HTTP,
lookalike hosts (`stackoverflow.com.evil.example`), userinfo and non-default
ports. It is re-checked per call: a tab on another host returns
`UNSUPPORTED_PAGE` before any request is made.

## Verification

`npm test` covers schema parity against the published manifest, the urlRegex
probe in both directions, and execution against a stubbed page for search,
question/answer reads, user profiles, tags, excerpts, the API `error_id`
envelope, the logged-out auth failure and the wrong-host guard. The endpoints and
defaults were additionally exercised against the live API during the port.
