# com.github.main — OpenTabs GitHub plugin port

Full-fidelity port of the OpenTabs GitHub plugin (MIT,
https://github.com/opentabs-dev/opentabs — npm `@opentabs-dev/opentabs-plugin-github`)
into the WebMCP package format, following the `com.discord.main` pilot.
**All 35 OpenTabs tools are ported 1:1** — same names, same input
schemas, same endpoint mechanics, including every write/mutation tool.

All page interaction stays inside the github.com tab: the logged-in web session is detected from the `meta[name=user-login]` tag, CSRF tokens come from `input[name=authenticity_token]` elements, and every GitHub call runs as an in-page `fetch` with `credentials: 'include'` — same-origin `/search` + payload unwrap, turbo-frame embedded React data, full-page embedded data, the internal `/_graphql` persisted-query endpoint with runtime query/mutation-ID discovery from GitHub's JS bundles, and DOM-form XHR posts for classic form mutations. The session cookie never leaves the page context.

## Error contract

Every workflow returns `{ status: 'ok'|'error', data, message }`. Error results carry a
stable `error_code`: `UNSUPPORTED_PAGE` (the tab is not on github.com), `AUTH` (401/403 —
the cached page-session snapshot is cleared so the next call re-reads a fresh one),
`NOT_FOUND`, `VALIDATION`, `RATE_LIMITED` (HTTP 429), `NETWORK`, `HTTP` (unclassified
status), `API` (site-reported or unclassified errors), `EVAL_FAILED` (the page-side
tool threw while the tab is alive) or `TAB_UNAVAILABLE` (the github.com tab closed,
navigated away, or returned another tab), plus `UNKNOWN`/`EMPTY_RESULT` from the
shared adapter wrapper.

## Tools

| Tool | Description | Inputs |
| --- | --- | --- |
| `list_repos` | List repositories for the authenticated user or a specified user/organization. Returns repos sorted by last updated. | `owner` (optional), `sort` (optional), `per_page` (optional), `page` (optional) |
| `get_repo` | Get detailed information about a specific repository. | `owner`, `repo` |
| `create_repo` | Create a new repository for the authenticated user. | `name`, `description` (optional), `private` (optional), `auto_init` (optional), `gitignore_template` (optional), `license_template` (optional) |
| `list_commits` | List commits for a repository. Optionally filter by branch or tag. Returns commits sorted by date descending. | `owner`, `repo`, `sha` (optional) |
| `compare_commits` | Compare two commits, branches, or tags. Returns the diff status, commit count, and changed files between the base and head. | `owner`, `repo`, `basehead` |
| `list_releases` | List releases for a repository. Returns published and draft releases sorted by creation date. | `owner`, `repo` |
| `create_release` | Create a new release for a repository. Optionally create as a draft or prerelease. | `owner`, `repo`, `tag_name`, `name` (optional), `body` (optional), `draft` (optional), `prerelease` (optional), `target_commitish` (optional) |
| `list_issues` | List issues for a repository. By default returns open issues sorted by creation date. Can filter by state, labels, assignee, and more. | `owner`, `repo`, `state` (optional), `labels` (optional), `assignee` (optional), `sort` (optional), `direction` (optional), `per_page` (optional), `page` (optional) |
| `get_issue` | Get detailed information about a specific issue, including its full body. | `owner`, `repo`, `issue_number` |
| `create_issue` | Create a new issue in a repository. | `owner`, `repo`, `title`, `body` (optional) |
| `update_issue` | Update an existing issue — change title, body, state, labels, or assignees. | `owner`, `repo`, `issue_number`, `title` (optional), `body` (optional), `state` (optional) |
| `search_issues` | Search issues and pull requests across GitHub. Uses GitHub search syntax — e.g., "repo:owner/name is:open label:bug". | `query`, `per_page` (optional), `page` (optional) |
| `list_labels` | List all labels for a repository. Returns label names, colors, and descriptions. | `owner`, `repo` |
| `create_label` | Create a new label in a repository. | `owner`, `repo`, `name`, `color` (optional), `description` (optional) |
| `list_pull_requests` | List pull requests for a repository with optional state and sort filters. | `owner`, `repo`, `state` (optional), `sort` (optional), `direction` (optional), `per_page` (optional), `page` (optional) |
| `get_pull_request` | Get detailed information about a specific pull request, including merge status and diff stats. | `owner`, `repo`, `pull_number` |
| `create_pull_request` | Create a new pull request. | `owner`, `repo`, `title`, `head`, `base`, `body` (optional), `draft` (optional) |
| `update_pull_request` | Update an existing pull request title or body, or close/reopen it. | `owner`, `repo`, `pull_number`, `title` (optional), `body` (optional), `state` (optional) |
| `merge_pull_request` | Merge a pull request. Supports merge commit, squash, and rebase strategies. | `owner`, `repo`, `pull_number`, `commit_title` (optional), `commit_message` (optional), `merge_method` (optional) |
| `get_pull_request_diff` | Get the raw diff of a pull request. Returns the unified diff text for all changed files. | `owner`, `repo`, `pull_number` |
| `list_pull_request_files` | List files changed in a pull request. Returns filenames, change status, and line-level diff statistics. | `owner`, `repo`, `pull_number` |
| `request_pull_request_review` | Request reviewers for a pull request. Specify individual users and/or team slugs to request reviews from. | `owner`, `repo`, `pull_number`, `reviewers` (optional), `team_reviewers` (optional) |
| `list_comments` | List comments on an issue or pull request. | `owner`, `repo`, `issue_number` |
| `create_comment` | Add a comment to an issue or pull request. | `owner`, `repo`, `issue_number`, `body` |
| `get_user_profile` | Get a GitHub user's profile. Defaults to the authenticated user if no username is provided. | `username` (optional) |
| `list_org_members` | List members of a GitHub organization. | `org` |
| `list_branches` | List branches for a repository. | `owner`, `repo` |
| `get_file_content` | Read a file from a repository. Returns the raw content as text. Use the ref parameter to read from a specific branch or commit. | `owner`, `repo`, `path`, `ref` (optional) |
| `create_or_update_file` | Create or update a file in a repository. Commits directly to the specified branch. | `owner`, `repo`, `path`, `content`, `message`, `branch` (optional) |
| `delete_file` | Delete a file from a repository. Commits directly to the specified branch. | `owner`, `repo`, `path`, `message`, `branch` (optional) |
| `list_workflow_runs` | List workflow runs for a repository. Returns recent workflow runs from the Actions page. | `owner`, `repo` |
| `get_workflow_run` | Get information about a specific GitHub Actions workflow run by its run ID. | `owner`, `repo`, `run_id` |
| `search_repos` | Search for repositories across GitHub. Supports GitHub search syntax (e.g., "repo:owner/name", "language:typescript", "stars:>1000"). | `query`, `per_page` (optional), `page` (optional) |
| `add_reaction` | Add a reaction to an issue, pull request, or comment. Requires the node ID of the subject (e.g., from get_issue or get_pull_request). | `subject_id`, `content` |
| `list_notifications` | List notifications for the authenticated user. Includes issue, PR, and release notifications. | — |

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

- `list_repos`: 列出已认证用户或指定用户/组织的仓库，按最近更新排序。
- `get_repo`: 获取指定仓库的详细信息。
- `create_repo`: 为当前登录用户创建一个新仓库。
- `list_commits`: 列出仓库的提交记录，可按分支或标签过滤，按时间倒序返回。
- `compare_commits`: 比较两个提交、分支或标签，返回变更文件列表与状态。
- `list_releases`: 列出仓库的 release（含草稿与预发布），按创建时间排序。
- `create_release`: 为仓库创建新的 release，可选草稿或预发布。
- `list_issues`: 列出仓库的 issue，默认返回按创建时间排序的开放 issue，支持状态、标签、负责人等过滤。
- `get_issue`: 获取指定 issue 的详细信息，包括完整正文。
- `create_issue`: 在仓库中创建新的 issue。
- `update_issue`: 更新已有 issue 的标题、正文或状态（关闭/重新打开）。
- `search_issues`: 使用 GitHub 搜索语法在全站搜索 issue 和 PR，例如 "repo:owner/name is:open label:bug"。
- `list_labels`: 列出仓库的所有标签（名称、颜色、描述）。
- `create_label`: 在仓库中创建新标签。
- `list_pull_requests`: 列出仓库的 PR，支持状态与排序过滤。
- `get_pull_request`: 获取指定 PR 的详细信息，包括合并状态与 diff 统计。
- `create_pull_request`: 基于 head 与 base 分支创建新的 PR。
- `update_pull_request`: 更新 PR 的标题或正文，或关闭/重新打开。
- `merge_pull_request`: 合并 PR，支持 merge commit、squash、rebase 三种策略。
- `get_pull_request_diff`: 获取 PR 的原始 unified diff 文本。
- `list_pull_request_files`: 列出 PR 中变更的文件：文件名、变更类型与行级统计。
- `request_pull_request_review`: 为 PR 请求审阅者（个人用户和/或团队）。
- `list_comments`: 列出 issue 或 PR 上的评论。
- `create_comment`: 在 issue 或 PR 上添加评论。
- `get_user_profile`: 获取 GitHub 用户资料，缺省返回当前登录用户。
- `list_org_members`: 列出 GitHub 组织的成员。
- `list_branches`: 列出仓库的分支。
- `get_file_content`: 读取仓库中的文件，返回原始文本内容，可用 ref 指定分支或提交。
- `create_or_update_file`: 在仓库中创建或更新文件并直接提交到指定分支。
- `delete_file`: 从仓库中删除文件并直接提交到指定分支。
- `list_workflow_runs`: 列出仓库最近的 GitHub Actions workflow 运行。
- `get_workflow_run`: 按运行 ID 获取 GitHub Actions workflow 运行信息。
- `search_repos`: 使用 GitHub 搜索语法搜索仓库，例如 "language:typescript stars:>1000"。
- `add_reaction`: 为 issue、PR 或评论添加表情回应（需要目标的 node ID）。
- `list_notifications`: 列出当前登录用户的通知（issue、PR、release 等）。

### en-US

- `list_repos`: List repositories for the authenticated user or a specified user/organization. Returns repos sorted by last updated.
- `get_repo`: Get detailed information about a specific repository.
- `create_repo`: Create a new repository for the authenticated user.
- `list_commits`: List commits for a repository. Optionally filter by branch or tag. Returns commits sorted by date descending.
- `compare_commits`: Compare two commits, branches, or tags. Returns the diff status, commit count, and changed files between the base and head.
- `list_releases`: List releases for a repository. Returns published and draft releases sorted by creation date.
- `create_release`: Create a new release for a repository. Optionally create as a draft or prerelease.
- `list_issues`: List issues for a repository. By default returns open issues sorted by creation date. Can filter by state, labels, assignee, and more.
- `get_issue`: Get detailed information about a specific issue, including its full body.
- `create_issue`: Create a new issue in a repository.
- `update_issue`: Update an existing issue — change title, body, state, labels, or assignees.
- `search_issues`: Search issues and pull requests across GitHub. Uses GitHub search syntax — e.g., "repo:owner/name is:open label:bug".
- `list_labels`: List all labels for a repository. Returns label names, colors, and descriptions.
- `create_label`: Create a new label in a repository.
- `list_pull_requests`: List pull requests for a repository with optional state and sort filters.
- `get_pull_request`: Get detailed information about a specific pull request, including merge status and diff stats.
- `create_pull_request`: Create a new pull request.
- `update_pull_request`: Update an existing pull request title or body, or close/reopen it.
- `merge_pull_request`: Merge a pull request. Supports merge commit, squash, and rebase strategies.
- `get_pull_request_diff`: Get the raw diff of a pull request. Returns the unified diff text for all changed files.
- `list_pull_request_files`: List files changed in a pull request. Returns filenames, change status, and line-level diff statistics.
- `request_pull_request_review`: Request reviewers for a pull request. Specify individual users and/or team slugs to request reviews from.
- `list_comments`: List comments on an issue or pull request.
- `create_comment`: Add a comment to an issue or pull request.
- `get_user_profile`: Get a GitHub user's profile. Defaults to the authenticated user if no username is provided.
- `list_org_members`: List members of a GitHub organization.
- `list_branches`: List branches for a repository.
- `get_file_content`: Read a file from a repository. Returns the raw content as text. Use the ref parameter to read from a specific branch or commit.
- `create_or_update_file`: Create or update a file in a repository. Commits directly to the specified branch.
- `delete_file`: Delete a file from a repository. Commits directly to the specified branch.
- `list_workflow_runs`: List workflow runs for a repository. Returns recent workflow runs from the Actions page.
- `get_workflow_run`: Get information about a specific GitHub Actions workflow run by its run ID.
- `search_repos`: Search for repositories across GitHub. Supports GitHub search syntax (e.g., "repo:owner/name", "language:typescript", "stars:>1000").
- `add_reaction`: Add a reaction to an issue, pull request, or comment. Requires the node ID of the subject (e.g., from get_issue or get_pull_request).
- `list_notifications`: List notifications for the authenticated user. Includes issue, PR, and release notifications.

### ja-JP

- `list_repos`: 認証ユーザーまたは指定したユーザー/組織のリポジトリを最終更新順で一覧表示します。
- `get_repo`: 指定したリポジトリの詳細情報を取得します。
- `create_repo`: 認証ユーザー向けに新しいリポジトリを作成します。
- `list_commits`: リポジトリのコミットを一覧表示します。ブランチやタグで絞り込み可能、日付降順。
- `compare_commits`: 2つのコミット・ブランチ・タグを比較し、変更ファイルの一覧と状態を返します。
- `list_releases`: リポジトリのリリース（ドラフト・プレリリース含む）を作成日順で一覧表示します。
- `create_release`: リポジトリに新しいリリースを作成します。ドラフトやプレリリースも指定できます。
- `list_issues`: リポジトリの issue を一覧表示します。デフォルトは作成日順のオープン issue。状態・ラベル・担当者などで絞り込めます。
- `get_issue`: 指定した issue の詳細（本文を含む）を取得します。
- `create_issue`: リポジトリに新しい issue を作成します。
- `update_issue`: 既存 issue のタイトル・本文・状態（クローズ/再オープン）を変更します。
- `search_issues`: GitHub 検索構文で issue と PR を横断検索します（例: "repo:owner/name is:open label:bug"）。
- `list_labels`: リポジトリのすべてのラベル（名前・色・説明）を一覧表示します。
- `create_label`: リポジトリに新しいラベルを作成します。
- `list_pull_requests`: リポジトリの PR を状態や並び順のフィルタ付きで一覧表示します。
- `get_pull_request`: 指定した PR の詳細（マージ状態や diff 統計を含む）を取得します。
- `create_pull_request`: head と base ブランチから新しい PR を作成します。
- `update_pull_request`: PR のタイトル・本文を更新、またはクローズ/再オープンします。
- `merge_pull_request`: PR をマージします。merge commit・squash・rebase の戦略に対応。
- `get_pull_request_diff`: PR の生の unified diff テキストを取得します。
- `list_pull_request_files`: PR の変更ファイルを一覧表示します: ファイル名・変更種別・行単位の統計。
- `request_pull_request_review`: PR にレビュアー（ユーザーおよびチーム）を指定します。
- `list_comments`: issue または PR のコメントを一覧表示します。
- `create_comment`: issue または PR にコメントを追加します。
- `get_user_profile`: GitHub ユーザーのプロフィールを取得します。省略時は認証ユーザー。
- `list_org_members`: GitHub 組織のメンバーを一覧表示します。
- `list_branches`: リポジトリのブランチを一覧表示します。
- `get_file_content`: リポジトリのファイルを読み取り、生のテキストを返します。ref でブランチやコミットを指定できます。
- `create_or_update_file`: リポジトリのファイルを作成または更新し、指定ブランチへ直接コミットします。
- `delete_file`: リポジトリからファイルを削除し、指定ブランチへ直接コミットします。
- `list_workflow_runs`: リポジトリの最近の GitHub Actions ワークフロー実行を一覧表示します。
- `get_workflow_run`: 実行 ID で GitHub Actions ワークフロー実行の情報を取得します。
- `search_repos`: GitHub 検索構文でリポジトリを検索します（例: "language:typescript stars:>1000"）。
- `add_reaction`: issue・PR・コメントに絵文字リアクションを追加します（対象のノード ID が必要）。
- `list_notifications`: 認証ユーザーの通知（issue・PR・リリースなど）を一覧表示します。

### ko-KR

- `list_repos`: 인증된 사용자 또는 지정한 사용자/조직의 저장소를 최근 업데이트 순으로 나열합니다.
- `get_repo`: 지정한 저장소의 상세 정보를 조회합니다.
- `create_repo`: 현재 로그인한 사용자를 위해 새 저장소를 생성합니다.
- `list_commits`: 저장소의 커밋을 나열합니다. 브랜치나 태그로 필터링할 수 있으며 날짜 내림차순으로 반환합니다.
- `compare_commits`: 두 커밋·브랜치·태그를 비교하여 변경된 파일 목록과 상태를 반환합니다.
- `list_releases`: 저장소의 릴리스(초안·프리릴리스 포함)를 생성일 순으로 나열합니다.
- `create_release`: 저장소에 새 릴리스를 생성합니다. 초안이나 프리릴리스로 지정할 수 있습니다.
- `list_issues`: 저장소의 이슈를 나열합니다. 기본값은 생성일 순 오픈 이슈이며 상태·라벨·담당자 등으로 필터링할 수 있습니다.
- `get_issue`: 지정한 이슈의 상세 정보(전문 포함)를 조회합니다.
- `create_issue`: 저장소에 새 이슈를 생성합니다.
- `update_issue`: 기존 이슈의 제목·본문·상태(닫기/다시 열기)를 변경합니다.
- `search_issues`: GitHub 검색 문법으로 이슈와 PR을 전체 검색합니다 (예: "repo:owner/name is:open label:bug").
- `list_labels`: 저장소의 모든 라벨(이름·색상·설명)을 나열합니다.
- `create_label`: 저장소에 새 라벨을 생성합니다.
- `list_pull_requests`: 저장소의 PR을 상태·정렬 필터와 함께 나열합니다.
- `get_pull_request`: 지정한 PR의 상세 정보(병합 상태 및 diff 통계 포함)를 조회합니다.
- `create_pull_request`: head와 base 브랜치로 새 PR을 생성합니다.
- `update_pull_request`: PR의 제목·본문을 업데이트하거나 닫거나 다시 엽니다.
- `merge_pull_request`: PR을 병합합니다. merge commit·squash·rebase 전략을 지원합니다.
- `get_pull_request_diff`: PR의 원본 unified diff 텍스트를 가져옵니다.
- `list_pull_request_files`: PR에서 변경된 파일을 나열합니다: 파일명·변경 유형·줄 단위 통계.
- `request_pull_request_review`: PR에 리뷰어(사용자 및/또는 팀)를 지정합니다.
- `list_comments`: 이슈나 PR의 댓글을 나열합니다.
- `create_comment`: 이슈나 PR에 댓글을 추가합니다.
- `get_user_profile`: GitHub 사용자 프로필을 조회합니다. 지정하지 않으면 현재 로그인 사용자입니다.
- `list_org_members`: GitHub 조직의 구성원을 나열합니다.
- `list_branches`: 저장소의 브랜치를 나열합니다.
- `get_file_content`: 저장소의 파일을 읽어 원본 텍스트를 반환합니다. ref로 브랜치나 커밋을 지정할 수 있습니다.
- `create_or_update_file`: 저장소의 파일을 생성 또는 수정하고 지정한 브랜치에 직접 커밋합니다.
- `delete_file`: 저장소에서 파일을 삭제하고 지정한 브랜치에 직접 커밋합니다.
- `list_workflow_runs`: 저장소의 최근 GitHub Actions 워크플로 실행을 나열합니다.
- `get_workflow_run`: 실행 ID로 GitHub Actions 워크플로 실행 정보를 조회합니다.
- `search_repos`: GitHub 검색 문법으로 저장소를 검색합니다 (예: "language:typescript stars:>1000").
- `add_reaction`: 이슈·PR·댓글에 이모지 반응을 추가합니다(대상의 노드 ID 필요).
- `list_notifications`: 현재 로그인한 사용자의 알림(이슈·PR·릴리스 등)을 나열합니다.

## Scope and ToS posture

Same posture as the upstream OpenTabs plugins: the tools operate on the user's own
logged-in session and quota, inside the github.com tab. No credential is extracted or
exfiltrated — auth stays in page context, mirroring the `com.discord.main` pilot.
