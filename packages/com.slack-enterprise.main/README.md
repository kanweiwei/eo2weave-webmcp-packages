# Slack Enterprise Grid WebMCP package (com.slack-enterprise.main 0.1.0)

Full port of the OpenTabs Slack Enterprise Grid plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/slack-enterprise,
published as `@opentabs-dev/opentabs-plugin-slack-enterprise@0.0.90`) into the
builtin WebMCP package format: every tool the published `dist/tools.json`
registers — **54 tools**, no subset. The sibling standard-workspace port is
`com.slack.main`; the two are separated exactly as upstream separates
`plugins/slack` from `plugins/slack-enterprise` (`com.slack.main` refuses
Enterprise tabs with `ENTERPRISE_WORKSPACE`, this package refuses tabs without an
enterprise session with `AUTH`).

## Scope

Messages (send/read/thread/reply/react/update/delete), search
(messages/files/users/channels), channels (list/info/members + create, archive,
unarchive, topic, purpose, invite, kick, rename, join, leave), conversations
(open DM), users (info/list/me), files (info/list/upload), pins, stars (incl. the
org-level `saved.list` path), reactions, bookmarks, user groups, profile status,
reminders and Do Not Disturb. Every upstream write tool is included.

## Authentication (Enterprise Grid only)

`slack-enterprise-api.ts` probes, in order, on every call:

1. `localStorage.localConfig_v2` / `localConfig_v3` — the team map must contain
   an **E-prefix** org entry; the first **T-prefix** workspace entry supplies the
   workspace `xoxc-` token (the org `xoxp-` token is kept for the enterprise
   APIs). Without a workspace entry the default workspace is discovered via
   `client.userBoot` using the org token.
2. `window.boot_data` — `api_token` must be `xoxc-` and `enterprise_id` must be
   present; otherwise the tab is not a Grid install.

Auth is cached per tool call for the tab lifetime and re-validated against the
source (`localConfig` raw text / `boot_data.api_token`), so an account switch in a
live tab cannot keep sending the previous account's token.

## API shape

Every tool is a form-encoded `POST` to same-origin `/api/<method>` with
`credentials: 'include'`, the token in the body, and the web client's internal
metadata (`_x_reason=api_call`, `_x_mode=online`, `_x_sonic=true`,
`_x_app_name=client`, `_x_team_id=<workspace or org id>`). Workspace calls use
the `xoxc-` token with the `T…` team id; `search_channels` (`search.modules`) and
`list_stars`' first attempt (`saved.list`) use the org `xoxp-` token with the
`E…` id, exactly as upstream. A non-auth failure on `saved.list` falls back to
`stars.list` on the workspace token.

Errors follow Slack's `{ok:false,error}` envelope: `not_authed`/`invalid_auth`/… →
`AUTH`, `channel_not_found`/… → `NOT_FOUND`, `ratelimited` → `RATE_LIMITED`
(with `Retry-After`), validation strings → `VALIDATION`, everything else →
`INTERNAL`/`HTTP`. HTTP 401/403 → `AUTH`, 404 → `NOT_FOUND`, 429 →
`RATE_LIMITED`. One in-page deadline of 18s aborts stalled requests before the
25s adapter timeout.

## upload_file

Upstream's three-step external upload is reproduced verbatim: blocked extensions
(exe/sh/bat/cmd/com/app/dmg/msi/bin) are rejected before any request, base64
content is magic-byte checked for common types, `files.getUploadURLExternal`
returns a pre-signed URL on `files.slack.com`/`*.slack-edge.com` (HTTPS enforced),
the bytes are POSTed there **without credentials** (auth is in the URL), and
`files.completeUploadExternal` shares the file into the channel with an optional
`initial_comment`.

## Schemas

The `inputSchema`/`outputSchema` of each workflow are the published upstream
schemas verbatim (JSON). Upstream relies on zod `.default()` filling values the
host validator does not coerce or fill (`limit`, `count`, `types`,
`exclude_archived`, `is_private`, `is_base64`, …), so each workflow applies the
schema-declared defaults to the input before running the upstream handler body.
