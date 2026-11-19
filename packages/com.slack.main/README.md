# Slack WebMCP package (com.slack.main 0.1.0)

Full port of the OpenTabs Slack plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/slack) into the
builtin WebMCP package format: every tool the upstream `index.ts` registers, no
subset. Upstream registers **22** tools; `src/tools/` holds 23 files because
`channel-schema.ts` is a shared schema/mapper module, not a tool.

Every call runs inside the `*.slack.com` tab (the upstream `urlPatterns` are
`*://*.slack.com/*`, so both `app.slack.com` and legacy
`WORKSPACE.slack.com` tabs match). The `xoxc-` session token is read inside the
tab and never enters the workflow body or the tool output.

## Authentication

`slack-api.ts` probes four sources, in this order, on **every** call (no
caching, so an account switch in a live tab cannot keep using the previous
account's token):

1. `localStorage.localConfig_v2` / `localConfig_v3` — legacy workspace client
   (`teams[lastActiveTeamId].token`).
2. Page globals — `window.boot_data`, `window.TS.boot_data`,
   `window.TS.model.api_token`, `window.TS.redux.getState().boot`
   (`api_token` must start with `xoxc-`).
3. Inline `<script>` blocks (`application/json`, executable, or the
   `data-boot` attribute) matched with the upstream regexes.
4. A full `localStorage` scan for any key carrying an `xoxc-` token.

Enterprise Grid tabs are refused: upstream returns no auth there so its
dedicated `slack-enterprise` plugin handles them. This port reports
`ENTERPRISE_WORKSPACE` instead of a generic auth error.

The workspace URL comes from `team.url` / `team_url` / `location.origin`, is
stripped of a trailing slash, and is upgraded from `http:` to `https:` before a
token is ever attached; a non-https URL fails with `VALIDATION`.

## API shape

Every tool is a form-encoded `POST` to `<workspace>/api/<method>` with
`credentials: 'include'`, the token in the body, and the web client's metadata
fields `_x_reason=api_call`, `_x_mode=online`, `_x_sonic=true`,
`_x_app_name=client`, plus `_x_team_id` when a team id is known. Parameters the
caller did not supply are omitted (never sent as `null`), numbers stay numbers,
and objects are JSON-encoded.

`upload_file` is the exception: V1 `files.upload` as a same-origin multipart
`POST` (`FormData` with `token`, `channels`, `filename`, `file`, optional
`title`/`initial_comment`/`filetype`) and **no** `Content-Type`, so the browser
sets the multipart boundary.

## Tools

| Tool | Mechanics | Slack method |
| --- | --- | --- |
| `send_message` | optional `thread_ts` | `chat.postMessage` |
| `edit_message` | replaces the text | `chat.update` |
| `delete_message` | author-only upstream | `chat.delete` |
| `read_messages` | `limit`/`oldest`/`latest`/`cursor` | `conversations.history` |
| `read_thread` | replies + parent, `has_more` | `conversations.replies` |
| `search_messages` | `count`/`page`/`sort`/`sort_dir`, nested `messages` envelope | `search.messages` |
| `list_channels` | `limit`/`types`/`cursor`/`exclude_archived` | `conversations.list` |
| `get_channel_info` | full channel mapping | `conversations.info` |
| `create_channel` | create + setTopic, `warning` on partial success | `conversations.create` + `conversations.setTopic` |
| `set_channel_topic` | returns `topic{value,creator,last_set}` | `conversations.setTopic` |
| `set_channel_purpose` | returns `purpose{value,creator,last_set}` | `conversations.setPurpose` |
| `invite_to_channel` | single user id as `users` | `conversations.invite` |
| `list_members` | member user ids + cursor | `conversations.members` |
| `get_user_profile` | profile + admin/bot flags | `users.info` |
| `list_users` | workspace users + cursor | `users.list` |
| `open_dm` | `users` comma list, `return_im` | `conversations.open` |
| `upload_file` | multipart, blocked extensions, base64 magic-byte check | `files.upload` |
| `list_files` | `count`/`page`/`types`/`user` filters | `files.list` |
| `add_reaction` | strips `:` from the emoji name | `reactions.add` |
| `remove_reaction` | strips `:` from the emoji name | `reactions.remove` |
| `pin_message` | — | `pins.add` |
| `unpin_message` | — | `pins.remove` |

## Notes

- Outputs keep the upstream shapes (`{ channel }`, `{ messages, has_more }`,
  `{ files, paging }`, `{}` for the reaction/pin writes, …) inside the adapter
  envelope `{ status, data, message, error_code }`.
- Types are declared as Slack takes them: `limit`/`count`/`page` are
  `integer`, `exclude_archived`/`is_private`/`is_base64` are `boolean`,
  `sort`/`sort_dir` are `enum`. Nothing is stringified or parsed in the
  workflow.
- `upload_file` validates a base64 `png`/`jpg`/`jpeg`/`pdf`/`gif` payload
  against the format's magic bytes before uploading, and refuses
  `exe, sh, bat, cmd, com, app, dmg, msi, bin` — both upstream behaviours.
  Text content is handed to `Blob` as a string (the browser UTF-8 encodes it,
  the same bytes upstream produced with `TextEncoder`).
- Errors are classified, not thrown: `AUTH` (no token, 401/403, and Slack's
  `not_authed`/`invalid_auth`/`token_revoked`/…), `NOT_FOUND`
  (`channel_not_found`, `not_in_channel`, 404), `RATE_LIMITED` (429 or
  `ratelimited`, with `Retry-After`), `VALIDATION` (`invalid_arguments`,
  `msg_too_long`, …, and 400 on upload), `API`, `HTTP`, `NETWORK`, `TIMEOUT`,
  `ENTERPRISE_WORKSPACE`, `UNSUPPORTED_PAGE`, `TAB_UNAVAILABLE`.
- The in-page request deadline is 18s (upstream uses
  `AbortSignal.timeout(30000)`, longer than the adapter's 25s browser-eval
  timeout); a stalled request is aborted with `TIMEOUT` instead of being
  orphaned.

## Not verified

No live Slack workspace was used. The auth probes (`localConfig_v2`,
`boot_data`, inline scripts, localStorage scan), the `_x_*` metadata and the
multipart upload are exercised against stubbed pages; Slack-side acceptance of
the form bodies is assumed from the upstream client behaviour this port copies.
