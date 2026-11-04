# com.notion.main — OpenTabs Notion plugin port

Full-fidelity port of the OpenTabs Notion plugin (MIT,
https://github.com/opentabs-dev/opentabs — npm `@opentabs-dev/opentabs-plugin-notion`)
into the WebMCP package format, following the `com.discord.main` pilot.
**All 18 OpenTabs tools are ported 1:1** — same names, same input
schemas, same endpoint mechanics, including every write/mutation tool.

All API calls stay inside the notion.so tab: the Notion internal `api/v3` endpoints (`search`, `loadPageChunk`, `getRecordValues`, `queryCollection`, `submitTransaction`, `getSpaces`) are called with `credentials: 'include'`, `x-notion-active-user-header` (from the `notion_user_id` cookie) and `x-notion-space-id` (resolved from localStorage and cached per tab session).

## Error contract

Every workflow returns `{ status: 'ok'|'error', data, message }`. Error results carry a
stable `error_code`: `UNSUPPORTED_PAGE` (the tab is not on notion.so), `AUTH` (401/403 —
the cached page-session snapshot is cleared so the next call re-reads a fresh one),
`NOT_FOUND`, `VALIDATION`, `RATE_LIMITED` (HTTP 429), `NETWORK`, `HTTP` (unclassified
status), `API` (site-reported or unclassified errors), `EVAL_FAILED` (the page-side
tool threw while the tab is alive) or `TAB_UNAVAILABLE` (the notion.so tab closed,
navigated away, or returned another tab), plus `UNKNOWN`/`EMPTY_RESULT` from the
shared adapter wrapper.

## Tools

| Tool | Description | Inputs |
| --- | --- | --- |
| `search` | Search for pages and blocks in the Notion workspace by text query | `query`, `limit` (optional) |
| `list_pages` | List all pages in the Notion workspace, sorted by last edited time. Use this to get an overview of workspace content. | `limit` (optional) |
| `get_page` | Get a Notion page by ID, including its title, metadata, and content blocks. Returns the page info and its direct child blocks. | `page_id` |
| `get_block_children` | Get the child blocks of a specific block or page. Useful for reading nested content. | `block_id` |
| `create_page` | Create a new page in the Notion workspace. The page is created at the top level of the workspace by default, or as a child of an existing page. | `title`, `parent_page_id` (optional), `icon` (optional), `content` (optional) |
| `update_page` | Update a page title, icon, or cover image in Notion | `page_id`, `title` (optional), `icon` (optional), `cover` (optional) |
| `delete_page` | Archive (soft-delete) a page in Notion. The page can be restored from trash. | `page_id` |
| `append_block` | Append a content block (text, heading, list item, quote, code, etc.) to a page or block. Use this to add content to existing pages. | `parent_id`, `type` (optional), `content`, `after_id` (optional) |
| `update_block` | Update the text content of a block in a Notion page. Replaces the block text with the new content. | `block_id`, `content` |
| `delete_block` | Delete a content block from a Notion page. The block and its children are removed. | `block_id` |
| `get_user` | Get profile information for the current authenticated Notion user or a specific user by ID | `user_id` (optional) |
| `list_users` | List all users (members) in the current Notion workspace | — |
| `get_database` | Get a Notion database (collection) schema including its properties/columns and their types. Use this to understand the structure before querying. | `database_id` |
| `query_database` | Query rows from a Notion database with optional search. Returns items with their property values. | `database_id`, `view_id` (optional), `query` (optional), `limit` (optional) |
| `create_database_item` | Add a new row/item to a Notion database. Use get_database first to understand the property schema. | `database_id`, `title`, `properties` (optional) |
| `update_database_item` | Update a row/item in a Notion database. Use get_database first to understand the property schema. | `page_id`, `title` (optional), `properties` (optional) |
| `list_databases` | List all databases in the Notion workspace. Returns databases sorted by last edited time. | `limit` (optional) |
| `create_database` | Create a new database in a Notion page. Creates a basic database with a title column. | `parent_page_id`, `title`, `properties` (optional) |

## Omitted tools

None. Every OpenTabs tool is ported, including the destructive ones
(`delete_file`, `delete_page`, `delete_block`, `delete_issue`, `delete_comment`,
`delete_attachment`, `delete_label`, `delete_issue_relation`, `delete_project_update`).
They keep the upstream semantics — the same soft-delete / site flow you get by clicking
the corresponding control in the logged-in tab.

## Tool descriptions (i18n)

The manifest schema stores one English description per tool (that text is the LLM
protocol text). The four-locale translations below are the authoritative wording for
localized surfaces; the app-side `webmcpTools` i18n keys are a follow-up in the main
repo (`nutstore/eo2weave`) when these packages ship.

### zh-CN

- `search`: 按关键词搜索 Notion 工作区中的页面和内容块。
- `list_pages`: 列出工作区中的页面，按最近编辑时间排序。
- `get_page`: 按 ID 获取 Notion 页面：元信息与直接子内容块。
- `get_block_children`: 获取指定内容块或页面的子块，用于读取嵌套内容。
- `create_page`: 创建新页面，默认在工作区顶层，也可作为某个页面的子页面。
- `update_page`: 更新页面标题、图标或封面。
- `delete_page`: 归档（软删除）页面，可从回收站恢复。
- `append_block`: 向页面或内容块追加内容块（文本、标题、列表、引用、代码等）。
- `update_block`: 替换指定内容块的文本内容。
- `delete_block`: 删除页面中的内容块（含其子块）。
- `get_user`: 获取当前登录用户或指定用户的资料。
- `list_users`: 列出当前工作区的所有成员。
- `get_database`: 获取数据库（collection）的属性结构，便于先了解结构再查询。
- `query_database`: 查询数据库中的行，支持搜索过滤，返回属性值。
- `create_database_item`: 向数据库添加一行，可按属性名设置属性值。
- `update_database_item`: 更新数据库行的标题与属性值。
- `list_databases`: 列出工作区中的所有数据库，按最近编辑时间排序。
- `create_database`: 在指定页面中创建新数据库，含标题列与可选属性列。

### en-US

- `search`: Search for pages and blocks in the Notion workspace by text query
- `list_pages`: List all pages in the Notion workspace, sorted by last edited time. Use this to get an overview of workspace content.
- `get_page`: Get a Notion page by ID, including its title, metadata, and content blocks. Returns the page info and its direct child blocks.
- `get_block_children`: Get the child blocks of a specific block or page. Useful for reading nested content.
- `create_page`: Create a new page in the Notion workspace. The page is created at the top level of the workspace by default, or as a child of an existing page.
- `update_page`: Update a page title, icon, or cover image in Notion
- `delete_page`: Archive (soft-delete) a page in Notion. The page can be restored from trash.
- `append_block`: Append a content block (text, heading, list item, quote, code, etc.) to a page or block. Use this to add content to existing pages.
- `update_block`: Update the text content of a block in a Notion page. Replaces the block text with the new content.
- `delete_block`: Delete a content block from a Notion page. The block and its children are removed.
- `get_user`: Get profile information for the current authenticated Notion user or a specific user by ID
- `list_users`: List all users (members) in the current Notion workspace
- `get_database`: Get a Notion database (collection) schema including its properties/columns and their types. Use this to understand the structure before querying.
- `query_database`: Query rows from a Notion database with optional search. Returns items with their property values.
- `create_database_item`: Add a new row/item to a Notion database. Use get_database first to understand the property schema.
- `update_database_item`: Update a row/item in a Notion database. Use get_database first to understand the property schema.
- `list_databases`: List all databases in the Notion workspace. Returns databases sorted by last edited time.
- `create_database`: Create a new database in a Notion page. Creates a basic database with a title column.

### ja-JP

- `search`: キーワードで Notion ワークスペースのページやブロックを検索します。
- `list_pages`: ワークスペースのページを最終編集順で一覧表示します。
- `get_page`: ID で Notion ページを取得します: メタ情報と直接の子ブロック。
- `get_block_children`: 指定したブロックまたはページの子ブロックを取得し、階層コンテンツを読めます。
- `create_page`: 新しいページを作成します。デフォルトはワークスペースのトップレベル、既存ページの子ページも可能。
- `update_page`: ページのタイトル・アイコン・カバーを更新します。
- `delete_page`: ページをアーカイブ（ソフト削除）します。ゴミ箱から復元できます。
- `append_block`: ページやブロックにコンテンツブロック（テキスト・見出し・リスト・引用・コードなど）を追加します。
- `update_block`: 指定したブロックのテキスト内容を差し替えます。
- `delete_block`: ページからコンテンツブロック（子ブロックごと）を削除します。
- `get_user`: 現在のユーザーまたは指定したユーザーのプロフィールを取得します。
- `list_users`: 現在のワークスペースの全メンバーを一覧表示します。
- `get_database`: データベース（コレクション）のプロパティ構成を取得し、クエリ前の構造把握に使えます。
- `query_database`: データベースの行を検索フィルタ付きで取得し、プロパティ値を返します。
- `create_database_item`: データベースに行を追加します。プロパティ名を指定して値を設定できます。
- `update_database_item`: データベース行のタイトルとプロパティ値を更新します。
- `list_databases`: ワークスペースのすべてのデータベースを最終編集順で一覧表示します。
- `create_database`: 指定したページに新しいデータベース（タイトル列と任意のプロパティ列付き）を作成します。

### ko-KR

- `search`: 키워드로 Notion 워크스페이스의 페이지와 블록을 검색합니다.
- `list_pages`: 워크스페이스의 페이지를 마지막 편집 순으로 나열합니다.
- `get_page`: ID로 Notion 페이지를 조회합니다: 메타 정보와 직계 자식 블록.
- `get_block_children`: 지정한 블록이나 페이지의 자식 블록을 가져와 중첩된 내용을 읽을 수 있습니다.
- `create_page`: 새 페이지를 생성합니다. 기본값은 워크스페이스 최상위이며 기존 페이지의 하위 페이지로도 만들 수 있습니다.
- `update_page`: 페이지의 제목·아이콘·커버를 업데이트합니다.
- `delete_page`: 페이지를 보관(소프트 삭제)합니다. 휴지통에서 복원할 수 있습니다.
- `append_block`: 페이지나 블록에 콘텐츠 블록(텍스트·제목·목록·인용·코드 등)을 추가합니다.
- `update_block`: 지정한 블록의 텍스트 내용을 교체합니다.
- `delete_block`: 페이지에서 콘텐츠 블록(자식 블록 포함)을 삭제합니다.
- `get_user`: 현재 사용자 또는 지정한 사용자의 프로필을 조회합니다.
- `list_users`: 현재 워크스페이스의 모든 멤버를 나열합니다.
- `get_database`: 데이터베이스(컬렉션)의 속성 스키마를 조회하여 쿼리 전에 구조를 파악할 수 있습니다.
- `query_database`: 데이터베이스의 행을 검색 필터와 함께 조회하고 속성 값을 반환합니다.
- `create_database_item`: 데이터베이스에 행을 추가합니다. 속성 이름으로 값을 설정할 수 있습니다.
- `update_database_item`: 데이터베이스 행의 제목과 속성 값을 업데이트합니다.
- `list_databases`: 워크스페이스의 모든 데이터베이스를 마지막 편집 순으로 나열합니다.
- `create_database`: 지정한 페이지에 새 데이터베이스(제목 열과 선택적 속성 열 포함)를 생성합니다.

## Scope and ToS posture

Same posture as the upstream OpenTabs plugins: the tools operate on the user's own
logged-in session and quota, inside the notion.so tab. No credential is extracted or
exfiltrated — auth stays in page context, mirroring the `com.discord.main` pilot.
