# Discord WebMCP package (com.discord.main 0.2.0)

Full port of the OpenTabs Discord plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/discord) into
the builtin WebMCP package format. Tracked by nutstore/eo2weave#91.

All page interaction stays inside the discord.com tab: the auth token is
extracted from `webpackChunkdiscord_app` by `browser.eval` (same webpack walk
as OpenTabs' `getTokenFromWebpack`) and every Discord API v9 call runs as an
in-page `fetch` with `credentials: 'include'` plus an `Authorization` header.
The token never leaves the page context.

## Tools

| Tool | Mechanics | Discord endpoint |
| --- | --- | --- |
| `read_messages` | GET + query params + collection mapping | `GET /channels/:id/messages` |
| `send_message` | POST + body mapping, optional reply | `POST /channels/:id/messages` |
| `add_reaction` | PUT endpoint | `PUT /channels/:id/messages/:mid/reactions/:emoji/@me` |
| `remove_reaction` | DELETE endpoint | `DELETE /channels/:id/messages/:mid/reactions/:emoji/@me` |
| `list_guilds` | collection mapping, `with_counts` | `GET /users/@me/guilds` |
| `list_channels` | nested resource | `GET /guilds/:id/channels` |
| `get_user_profile` | user-shaped output | `GET /users/:id/profile` (`@me` uses `GET /users/@me`) |
| `search_messages` | grouped search results | `GET /guilds/:id/messages/search` |
| `get_message` | GET around + pick | `GET /channels/:id/messages?around=:mid` |
| `delete_message` | DELETE | `DELETE /channels/:id/messages/:mid` |
| `edit_message` | PATCH + body mapping | `PATCH /channels/:id/messages/:mid` |
| `pin_message` | PUT nested resource | `PUT /channels/:id/pins/:mid` |
| `unpin_message` | DELETE nested resource | `DELETE /channels/:id/pins/:mid` |
| `read_thread` | GET + pagination | `GET /channels/:id/messages` (thread id) |
| `create_channel` | POST + body mapping | `POST /guilds/:id/channels` |
| `edit_channel` | PATCH + partial body | `PATCH /channels/:id` |
| `delete_channel` | DELETE returning channel | `DELETE /channels/:id` |
| `create_thread` | POST, two endpoints | `POST /channels/:id/threads`（或 `/messages/:mid/threads`） |
| `get_channel_info` | GET single resource | `GET /channels/:id` |
| `get_guild_info` | GET + with_counts | `GET /guilds/:id?with_counts=true` |
| `list_roles` | collection mapping | `GET /guilds/:id/roles` |
| `list_members` | GET + after pagination | `GET /guilds/:id/members` |
| `list_dms` | collection mapping | `GET /users/@me/channels` |
| `open_dm` | POST creating channel | `POST /users/@me/channels` |
| `list_pinned_messages` | collection mapping | `GET /channels/:id/pins` |
| `upload_file` | multipart FormData in page context | `POST /channels/:id/messages`（multipart） |

Every workflow returns `{ status: 'ok'|'error', data, message }`. Error
results carry a stable `error_code`: `UNSUPPORTED_PAGE`, `UNAUTHENTICATED`,
`AUTH`, `VALIDATION`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `NETWORK`,
`HTTP`, `API` (unclassified Discord error codes), `EMPTY_RESULT`,
`TAB_UNAVAILABLE` (the
discord.com tab closed, navigated away, or could not run the tool) or
`UNKNOWN`. Discord error codes are
classified the same way as OpenTabs
(auth 0/40001/40002/50014, not-found 10003/10004/10006/10008/10013/10011/
10014/10015, forbidden 50001/50013, validation 50003/50006/50007/50008/
50035/50109). Every HTTP 401 is classified `AUTH` regardless of the
Discord code (an unrecognized code stays in the message as diagnostic
detail) and removes the exact rejected credential from the page's
per-token rejected set AND from the cache, suppressing the
webpack-exposed token until the page offers a fresh one (Discord has
rejected that exact credential, so re-reading it would keep sending a
dead token; overlapping 401s for different tokens are tracked
independently so a stale in-flight 401 can neither re-enable another
rejected token nor block a fresh rejection). An
uncoded 403 clears the cache, a coded 403 (e.g. 50013 Missing
Permissions) is a permission denial that keeps it, and HTTP 429 is
reported as `RATE_LIMITED` without touching the cache — rate limiting
does not reject the credential, so a later failed webpack walk must not
read as a logout.

Input validation rejects before any API call: `read_messages` accepts at
most one of `before`/`after`/`around`, `list_guilds` accepts at most one
of `before`/`after`, and `search_messages` requires at least one search
criterion (`content`, `author_id`, `channel_id` or `has`) alongside
`guild_id`. `send_message` posts with `nonce` plus `enforce_nonce: true`;
retrying a timed-out send with the SAME `nonce` input makes Discord dedupe
it, and when the caller omits `nonce` the auto-generated value (max 25
chars, like every caller-supplied nonce enforced by the schema) is
remembered per send (a bounded per-key map, 5-minute expiry) so a retry
of the same send reuses it and is deduped instead of posting twice, while
retries of different sends do not evict each other; it is echoed back in
`data.nonce`. The 5-minute window matches Discord's `enforce_nonce`
guarantee (uniqueness is checked over the past few minutes): within it a
retry IS deduped; a retry AFTER it re-sends the same nonce but Discord no
longer enforces uniqueness, so it can post a duplicate — automatic
retries outside that window are potentially duplicating, and callers who
need exact-once semantics across longer horizons must pass their own
`nonce` and reconcile against the channel history. The remembered nonce
is dropped as soon as a send is confirmed delivered (HTTP 2xx), so it
only ever covers retries of sends whose outcome is unknown: two
intentionally identical sends in a row both post normally, each with its
own fresh nonce.

## Readiness gating

If the current tab is not on discord.com, tools return
`status: 'error'` with `error_code: 'UNSUPPORTED_PAGE'`. If the Discord app
has not hydrated its webpack modules yet (or the session has no token), tools
return `error_code: 'UNAUTHENTICATED'` immediately instead of hanging. A
successful token extraction is cached on the page
(`globalThis.__eo2DiscordToken`), but the cache is a short-lived
optimization only: every call first re-reads Discord's live webpack token
and refreshes the cache with it, so switching accounts in a still-loaded
tab is picked up immediately. The cached token is NEVER reused when the
webpack probe is unavailable or incomplete — a cached token cannot be
confirmed to belong to the current account in that state (an account
switch exactly while the probe fails would otherwise silently reuse the
previous account's credential), so such calls return
`UNAUTHENTICATED` until a fresh token can be read. When the walk runs
and finds no token, the page genuinely has no credential and the cache
is dropped — this is what keeps a previous account's token from being
sent after logout or an account switch. A 401 additionally marks the
exact rejected credential in a per-token rejected set so the
webpack-exposed token is suppressed until the page exposes a fresh one.
Unclassified Discord error codes surface
as `API` (a coded HTTP 401 is always classified `AUTH` regardless of the
code; the code stays in the message as diagnostic detail).

## Tool descriptions (i18n)

The manifest schema stores one English description per tool. The four-locale
translations below are the authoritative wording for localized surfaces.

### zh-CN

- `read_messages`: 读取 Discord 频道的最近消息，支持 before/after/around 分页。使用当前 discord.com 标签页的登录态。
- `send_message`: 向 Discord 频道发送消息，可通过 reply_to 回复指定消息。
- `add_reaction`: 为 Discord 消息添加 emoji 表情回应（Unicode 或 name:id 自定义表情）。
- `remove_reaction`: 移除自己在 Discord 消息上的 emoji 表情回应。
- `list_guilds`: 列出当前登录账号所在的 Discord 服务器及大致成员数。
- `list_channels`: 列出 Discord 服务器的频道（id、类型、名称、主题、排序、父分类、NSFW）。
- `get_user_profile`: 按 ID 读取 Discord 用户资料，传 '@me' 查询当前登录账号。
- `search_messages`: 在 Discord 服务器内按内容搜索消息，支持作者、频道与附件过滤。
- `get_message`: 按 ID 获取 Discord 频道中的单条消息。
- `delete_message`: 删除频道中的一条消息。
- `edit_message`: 编辑已发送的消息（仅限自己发送的消息）。
- `pin_message`: 在频道中置顶一条消息（需要管理消息权限）。
- `unpin_message`: 取消频道中某条消息的置顶。
- `read_thread`: 读取子区（thread）中的消息，支持按 before/after 分页。
- `create_channel`: 在 Discord 服务器中新建频道（需要管理频道权限）。
- `edit_channel`: 修改频道名称、主题、NSFW 标记或所属分类。
- `delete_channel`: 删除频道。此操作不可撤销。
- `create_thread`: 从某条消息创建子区，或在频道中创建独立子区。
- `get_channel_info`: 获取指定频道的详细信息。
- `get_guild_info`: 获取服务器详情：简介、成员数、功能开关、加成状态。
- `list_roles`: 列出服务器的所有身份组（按位置排序）。
- `list_members`: 列出服务器成员，支持 after 分页。
- `list_dms`: 列出当前账号所有已开启的私信频道。
- `open_dm`: 打开（或获取已存在的）与某用户的私信；传多个 ID 即群组私信。
- `list_pinned_messages`: 列出频道中所有置顶消息（最新在前）。
- `upload_file`: 向频道上传文件，支持 UTF-8 文本或 base64 编码的二进制内容。

### en-US

- `read_messages`: Read recent messages from a Discord channel with optional pagination (before/after/around). Uses the logged-in session of the current discord.com tab.
- `send_message`: Send a message to a Discord channel in the logged-in discord.com tab, optionally replying to a message ID.
- `add_reaction`: Add an emoji reaction to a Discord message. Accepts Unicode emoji or custom emoji in name:id form.
- `remove_reaction`: Remove your own emoji reaction from a Discord message.
- `list_guilds`: List the Discord guilds your logged-in account belongs to, with approximate member counts.
- `list_channels`: List the channels of a Discord guild with type, topic, position, parent and NSFW metadata.
- `get_user_profile`: Read a Discord user profile by user ID, or pass '@me' for the logged-in account.
- `search_messages`: Search messages in a Discord guild by content with optional author, channel and attachment filters.
- `get_message`: Get a specific message by its ID from a Discord channel.
- `delete_message`: Delete a message from a channel.
- `edit_message`: Edit an existing message. Only messages sent by the authenticated user can be edited.
- `pin_message`: Pin a message in a channel. Requires Manage Messages permission.
- `unpin_message`: Unpin a message from a channel. Requires Manage Messages permission.
- `read_thread`: Read messages from a thread. Threads are channels, so this works like read_messages but is specific to threads.
- `create_channel`: Create a new channel in a Discord guild (server). Requires Manage Channels permission.
- `edit_channel`: Edit a Discord channel: name, topic, NSFW flag, or parent category.
- `delete_channel`: Delete a Discord channel. This action is permanent and cannot be undone.
- `create_thread`: Create a thread from a message, or a standalone thread in a channel.
- `get_channel_info`: Get detailed information about a specific Discord channel.
- `get_guild_info`: Get detailed information about a Discord guild: description, member count, features, boost status.
- `list_roles`: List all roles in a Discord guild (server), sorted by position.
- `list_members`: List members in a Discord guild (server).
- `list_dms`: List all open direct message channels for the authenticated user.
- `open_dm`: Open or get an existing direct message channel with a user. Pass multiple IDs for a group DM.
- `list_pinned_messages`: List all pinned messages in a Discord channel, newest first.
- `upload_file`: Upload a file to a Discord channel. Supports UTF-8 text and base64-encoded binary content.

### ja-JP

- `read_messages`: Discord チャンネルの最近のメッセージを before/after/around ページネーション付きで読み取ります。現在の discord.com タブのログインセッションを使用します。
- `send_message`: ログイン中の discord.com タブで Discord チャンネルにメッセージを送信します。メッセージ ID への返信も可能です。
- `add_reaction`: Discord メッセージに絵文字リアクションを追加します（Unicode 絵文字または name:id 形式のカスタム絵文字）。
- `remove_reaction`: 自分の絵文字リアクションを Discord メッセージから削除します。
- `list_guilds`: ログイン中のアカウントが所属する Discord サーバー（ギルド）と概算メンバー数を一覧表示します。
- `list_channels`: Discord サーバーのチャンネル（id・種類・名前・トピック・並び順・親カテゴリ・NSFW）を一覧表示します。
- `get_user_profile`: ユーザー ID で Discord のプロフィールを取得します。'@me' でログイン中アカウントを指定できます。
- `search_messages`: Discord サーバー内のメッセージを内容で検索し、作者・チャンネル・添付ファイルでフィルターできます。
- `get_message`: Discord チャンネルのメッセージを ID で取得します。
- `delete_message`: チャンネルのメッセージを削除します。
- `edit_message`: 既存メッセージを編集します（自分の送信分のみ）。
- `pin_message`: チャンネルでメッセージをピン留めします（メッセージ管理権限が必要）。
- `unpin_message`: チャンネルのメッセージのピン留めを解除します。
- `read_thread`: スレッドのメッセージを読み取ります（before/after ページネーション対応）。
- `create_channel`: Discord サーバーに新しいチャンネルを作成します。
- `edit_channel`: チャンネル名・トピック・NSFW・親カテゴリを変更します。
- `delete_channel`: チャンネルを削除します。元に戻せません。
- `create_thread`: メッセージからスレッドを作成、または単独スレッドを作成します。
- `get_channel_info`: 指定チャンネルの詳細情報を取得します。
- `get_guild_info`: サーバーの詳細（説明・メンバー数・機能・ブースト状況）を取得します。
- `list_roles`: サーバーの全ロールを位置順に一覧表示します。
- `list_members`: サーバーのメンバーを一覧表示します（after ページネーション対応）。
- `list_dms`: ログイン中アカウントの DM チャンネルを一覧表示します。
- `open_dm`: ユーザーとの DM を開きます（複数 ID でグループ DM）。
- `list_pinned_messages`: チャンネルのピン留めメッセージを一覧表示します。
- `upload_file`: チャンネルにファイルをアップロードします（UTF-8 テキストまたは base64）。

### ko-KR

- `read_messages`: Discord 채널의 최근 메시지를 before/after/around 페이지네이션과 함께 읽어옵니다. 현재 discord.com 탭의 로그인 세션을 사용합니다.
- `send_message`: 로그인된 discord.com 탭에서 Discord 채널에 메시지를 보냅니다. 메시지 ID로 답장할 수 있습니다.
- `add_reaction`: Discord 메시지에 이모지 반응을 추가합니다(유니코드 이모지 또는 name:id 형식의 커스텀 이모지).
- `remove_reaction`: Discord 메시지에서 내 이모지 반응을 제거합니다.
- `list_guilds`: 로그인한 계정이 속한 Discord 서버와 대략적인 멤버 수를 나열합니다.
- `list_channels`: Discord 서버의 채널(id, 유형, 이름, 주제, 정렬, 상위 카테고리, NSFW)을 나열합니다.
- `get_user_profile`: 사용자 ID로 Discord 프로필을 조회합니다. '@me'로 로그인 계정을 조회할 수 있습니다.
- `search_messages`: Discord 서버에서 메시지 내용을 검색하고 작성자·채널·첨부 파일로 필터링합니다.

## Scope and ToS posture

Same posture as the upstream OpenTabs plugin: the tools operate on the
user's own logged-in session and quota. This package covers all 26 tools of the
upstream plugin (the pilot covered 8; the remaining 18 were ported on the same
runtime contract).
- `get_message`: Discord 채널에서 메시지 ID로 단일 메시지를 가져옵니다.
- `delete_message`: 채널의 메시지를 삭제합니다.
- `edit_message`: 기존 메시지를 수정합니다(본인 전송분만).
- `pin_message`: 채널에서 메시지를 고정합니다(메시지 관리 권한 필요).
- `unpin_message`: 채널 메시지의 고정을 해제합니다.
- `read_thread`: 스레드의 메시지를 읽습니다(before/after 페이지네이션 지원).
- `create_channel`: Discord 서버에 새 채널을 만듭니다.
- `edit_channel`: 채널 이름·주제·NSFW·상위 카테고리를 수정합니다.
- `delete_channel`: 채널을 삭제합니다. 되돌릴 수 없습니다.
- `create_thread`: 메시지에서 스레드를 만들거나 독립 스레드를 만듭니다.
- `get_channel_info`: 지정한 채널의 상세 정보를 가져옵니다.
- `get_guild_info`: 서버 상세 정보(설명·멤버 수·기능·부스트 상태)를 가져옵니다.
- `list_roles`: 서버의 모든 역할을 위치순으로 나열합니다.
- `list_members`: 서버 멤버를 나열합니다(after 페이지네이션 지원).
- `list_dms`: 로그인한 계정의 DM 채널을 나열합니다.
- `open_dm`: 사용자와의 DM을 엽니다(여러 ID는 그룹 DM).
- `list_pinned_messages`: 채널의 고정 메시지를 나열합니다.
- `upload_file`: 채널에 파일을 업로드합니다(UTF-8 텍스트 또는 base64).
