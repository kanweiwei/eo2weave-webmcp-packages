# com.linear.main — OpenTabs Linear plugin port

Full-fidelity port of the OpenTabs Linear plugin (MIT,
https://github.com/opentabs-dev/opentabs — npm `@opentabs-dev/opentabs-plugin-linear`)
into the WebMCP package format, following the `com.discord.main` pilot.
**All 59 OpenTabs tools are ported 1:1** — same names, same input
schemas, same endpoint mechanics, including every write/mutation tool.

All API calls stay inside the linear.app tab: GraphQL operations go to Linear's `client-api.linear.app/graphql` with `credentials: 'include'` (the HttpOnly session cookie) plus the `useraccount`/`user`/`organization`/`linear-client-id` headers Linear's own web app sends, read from the page's ApplicationStore.

## Error contract

Every workflow returns `{ status: 'ok'|'error', data, message }`. Error results carry a
stable `error_code`: `UNSUPPORTED_PAGE` (the tab is not on linear.app), `AUTH` (401/403 —
the cached page-session snapshot is cleared so the next call re-reads a fresh one),
`NOT_FOUND`, `VALIDATION`, `RATE_LIMITED` (HTTP 429), `NETWORK`, `HTTP` (unclassified
status), `API` (site-reported or unclassified errors), `EVAL_FAILED` (the page-side
tool threw while the tab is alive) or `TAB_UNAVAILABLE` (the linear.app tab closed,
navigated away, or returned another tab), plus `UNKNOWN`/`EMPTY_RESULT` from the
shared adapter wrapper.

## Tools

| Tool | Description | Inputs |
| --- | --- | --- |
| `search_issues` | Search and filter Linear issues. Supports text search, filtering by team, assignee, state, label, project, and more. Returns paginated results. | `query` (optional), `team_key` (optional), `assignee_name` (optional), `state_name` (optional), `label_name` (optional), `project_name` (optional), `priority` (optional), `limit` (optional), `after` (optional) |
| `get_issue` | Get detailed information about a single Linear issue by its UUID or human-readable identifier (e.g. ENG-123). | `issue_id` |
| `create_issue` | Create a new issue in Linear. Requires a team ID and title at minimum. | `team_id`, `title`, `description` (optional), `priority` (optional), `assignee_id` (optional), `state_id` (optional), `label_ids` (optional), `project_id` (optional), `cycle_id` (optional), `due_date` (optional), `estimate` (optional), `parent_id` (optional) |
| `update_issue` | Update an existing Linear issue. Only specified fields are changed; omitted fields remain unchanged. | `issue_id`, `title` (optional), `description` (optional), `priority` (optional), `assignee_id` (optional), `state_id` (optional), `label_ids` (optional), `project_id` (optional), `cycle_id` (optional), `due_date` (optional), `estimate` (optional), `team_id` (optional), `parent_id` (optional) |
| `delete_issue` | Move a Linear issue to the trash. Trashed issues can be restored within 30 days. | `issue_id` |
| `archive_issue` | Archive a Linear issue. Archived issues are hidden from default views but can be restored. | `issue_id` |
| `batch_update_issues` | Apply the same update to multiple issues at once. All specified fields are applied to every issue in the batch. Maximum 25 issues per call. | `issue_ids`, `state_id` (optional), `assignee_id` (optional), `priority` (optional), `project_id` (optional), `cycle_id` (optional), `label_ids` (optional), `due_date` (optional) |
| `list_sub_issues` | List child/sub-issues of a parent Linear issue. | `issue_id`, `limit` (optional), `after` (optional) |
| `list_issue_history` | List the change history (state changes, assignee changes, priority changes) for a Linear issue. | `issue_id`, `limit` (optional), `after` (optional) |
| `list_issue_relations` | List relations (blocks, is blocked by, relates to, duplicate of) for a Linear issue. | `issue_id` |
| `create_issue_relation` | Create a relation between two Linear issues (blocks, is blocked by, relates to, or duplicate of). | `issue_id`, `related_issue_id`, `type` |
| `delete_issue_relation` | Delete a relation between two Linear issues. Use list_issue_relations to find relation IDs. | `relation_id` |
| `add_issue_label` | Add a label to an issue without removing existing labels. Unlike update_issue which replaces all labels, this appends. | `issue_id`, `label_id` |
| `remove_issue_label` | Remove a label from an issue without affecting other labels. Unlike update_issue which replaces all labels, this removes only the specified one. | `issue_id`, `label_id` |
| `add_issue_subscriber` | Subscribe a user to receive notifications for a Linear issue. | `issue_id`, `subscriber_id` |
| `remove_issue_subscriber` | Unsubscribe a user from notifications for a Linear issue. | `issue_id`, `subscriber_id` |
| `set_issue_cycle` | Assign an issue to a cycle (sprint). Use list_cycles to find cycle IDs. Pass an empty string to remove from the current cycle. | `issue_id`, `cycle_id` |
| `move_issue_to_project` | Move an issue to a different project. Use list_projects to find project IDs. Pass an empty string to remove from the current project. | `issue_id`, `project_id` |
| `list_attachments` | List attachments (linked PRs, documents, URLs) on a Linear issue. | `issue_id`, `limit` (optional), `after` (optional) |
| `get_attachment` | Get detailed information about a single attachment by its UUID. | `attachment_id` |
| `create_attachment` | Link a URL (PR, document, design file, etc.) to a Linear issue as an attachment. | `issue_id`, `url`, `title`, `subtitle` (optional) |
| `delete_attachment` | Delete an attachment from a Linear issue. | `attachment_id` |
| `create_comment` | Add a comment to an existing Linear issue. | `issue_id`, `body` |
| `update_comment` | Update an existing comment on a Linear issue. | `comment_id`, `body` |
| `delete_comment` | Delete a comment from a Linear issue. | `comment_id` |
| `list_comments` | List comments on a Linear issue, ordered by creation date. | `issue_id`, `limit` (optional), `after` (optional) |
| `list_projects` | List all projects in the Linear workspace. Supports pagination. | `limit` (optional), `after` (optional) |
| `get_project` | Get detailed information about a single Linear project by its UUID. | `project_id` |
| `create_project` | Create a new project in Linear. | `name`, `description` (optional), `team_ids` (optional), `state` (optional), `target_date` (optional) |
| `update_project` | Update an existing Linear project. Only specified fields are changed. | `project_id`, `name` (optional), `description` (optional), `state` (optional), `target_date` (optional), `start_date` (optional) |
| `list_project_labels` | List labels applied to a specific Linear project. | `project_id` |
| `list_project_updates` | List status updates (health reports) for a Linear project. | `project_id`, `limit` (optional), `after` (optional) |
| `create_project_update` | Post a status update (health report) on a Linear project. | `project_id`, `body`, `health` |
| `delete_project_update` | Delete a status update from a Linear project. | `update_id` |
| `list_milestones` | List milestones for a Linear project. | `project_id` |
| `get_milestone` | Get detailed information about a single project milestone by its UUID. | `milestone_id` |
| `create_milestone` | Create a new milestone in a Linear project. | `project_id`, `name`, `description` (optional), `target_date` (optional) |
| `update_milestone` | Update an existing milestone in a Linear project. Only specified fields are changed. | `milestone_id`, `name` (optional), `description` (optional), `target_date` (optional) |
| `list_initiatives` | List initiatives in the Linear workspace, optionally filtered by status. | `status` (optional), `limit` (optional), `after` (optional) |
| `get_initiative` | Get detailed information about a single Linear initiative by its UUID. | `initiative_id` |
| `create_initiative` | Create a new initiative in Linear. | `name`, `description` (optional), `status` (optional), `color` (optional), `owner_id` (optional) |
| `update_initiative` | Update an existing Linear initiative. Only specified fields are changed. | `initiative_id`, `name` (optional), `description` (optional), `status` (optional), `color` (optional), `owner_id` (optional) |
| `list_documents` | List documents in the Linear workspace, optionally filtered by project. | `project_id` (optional), `limit` (optional), `after` (optional) |
| `get_document` | Get detailed information about a single Linear document by its UUID. | `document_id` |
| `create_document` | Create a new document in Linear, optionally associated with a project. | `title`, `content` (optional), `project_id` (optional), `icon` (optional) |
| `update_document` | Update an existing Linear document. Only specified fields are changed. | `document_id`, `title` (optional), `content` (optional), `project_id` (optional), `icon` (optional) |
| `list_teams` | List all teams in the Linear workspace that the current user can access. | — |
| `get_team` | Get detailed information about a single Linear team by its UUID. | `team_id` |
| `list_team_members` | List members of a specific Linear team. | `team_id`, `limit` (optional), `after` (optional) |
| `list_users` | List all users in the Linear organization. Use this to find user IDs for assigning issues. | `limit` (optional), `after` (optional) |
| `get_user` | Get detailed information about a single Linear user by their UUID. | `user_id` |
| `get_viewer` | Get the authenticated user's profile information. | — |
| `list_workflow_states` | List all workflow states for a team. Use this to find state IDs for filtering issues or updating issue state. | `team_id` |
| `list_labels` | List all issue labels in the Linear workspace. Use this to find label IDs for creating or filtering issues. | — |
| `create_label` | Create a new issue label in Linear. | `name`, `color` (optional), `description` (optional), `team_id` (optional) |
| `update_label` | Update an existing Linear issue label. Only specified fields are changed. | `label_id`, `name` (optional), `color` (optional), `description` (optional) |
| `delete_label` | Delete a Linear issue label. Labels will be removed from all issues that use them. | `label_id` |
| `list_cycles` | List cycles (sprints) for a team. Use this to find cycle IDs for creating or filtering issues. | `team_id`, `limit` (optional), `after` (optional) |
| `get_cycle` | Get detailed information about a single cycle (sprint) by its UUID. | `cycle_id` |

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

- `search_issues`: 按文本与团队、负责人、状态、标签、项目、优先级等条件搜索 Linear issue，支持分页。
- `get_issue`: 按 UUID 或可读标识（如 ENG-123）获取 issue 详情。
- `create_issue`: 在 Linear 中创建新 issue（需要团队 ID 与标题）。
- `update_issue`: 更新已有 issue：仅修改指定字段，其余保持不变。
- `delete_issue`: 将 issue 移入回收站（30 天内可恢复）。
- `archive_issue`: 归档 issue，归档后从默认视图隐藏但可恢复。
- `batch_update_issues`: 对多个 issue（最多 25 个）批量应用同一更新。
- `list_sub_issues`: 列出父 issue 的子 issue。
- `list_issue_history`: 列出 issue 的变更历史（状态、负责人、优先级变化）。
- `list_issue_relations`: 列出 issue 的关系（阻塞、被阻塞、相关、重复）。
- `create_issue_relation`: 在两个 issue 之间创建关系（blocks/blockedBy/related/duplicate）。
- `delete_issue_relation`: 删除两个 issue 之间的关系。
- `add_issue_label`: 为 issue 追加标签（不移除现有标签）。
- `remove_issue_label`: 从 issue 上移除指定标签（不影响其他标签）。
- `add_issue_subscriber`: 为用户订阅 issue 通知。
- `remove_issue_subscriber`: 取消用户对 issue 的订阅。
- `set_issue_cycle`: 将 issue 分配到周期（sprint），传空字符串移出周期。
- `move_issue_to_project`: 把 issue 移到指定项目，传空字符串移出项目。
- `list_attachments`: 列出 issue 上的附件（关联的 PR、文档、URL）。
- `get_attachment`: 按 UUID 获取单个附件详情。
- `create_attachment`: 将 URL（PR、设计文件等）作为附件关联到 issue。
- `delete_attachment`: 删除 issue 上的附件。
- `create_comment`: 为 issue 添加评论。
- `update_comment`: 更新 issue 上的已有评论。
- `delete_comment`: 删除 issue 上的评论。
- `list_comments`: 按创建时间列出 issue 上的评论。
- `list_projects`: 列出工作区中的所有项目，支持分页。
- `get_project`: 按 UUID 获取项目详情。
- `create_project`: 在 Linear 中创建新项目。
- `update_project`: 更新项目：仅修改指定字段。
- `list_project_labels`: 列出指定项目上的标签。
- `list_project_updates`: 列出项目的状态更新（健康报告）。
- `create_project_update`: 在项目上发布状态更新（健康报告）。
- `delete_project_update`: 删除项目的状态更新。
- `list_milestones`: 列出项目中的里程碑。
- `get_milestone`: 按 UUID 获取里程碑详情。
- `create_milestone`: 在项目中创建新里程碑。
- `update_milestone`: 更新项目里程碑：仅修改指定字段。
- `list_initiatives`: 列出工作区中的 initiative，可按状态过滤。
- `get_initiative`: 按 UUID 获取 initiative 详情及其关联项目。
- `create_initiative`: 创建新 initiative。
- `update_initiative`: 更新 initiative：仅修改指定字段。
- `list_documents`: 列出工作区中的文档，可按项目过滤。
- `get_document`: 按 UUID 获取文档详情。
- `create_document`: 创建新文档，可关联项目。
- `update_document`: 更新文档：仅修改指定字段。
- `list_teams`: 列出当前用户可访问的所有团队。
- `get_team`: 按 UUID 获取团队详情。
- `list_team_members`: 列出团队的成员。
- `list_users`: 列出组织中的所有用户（用于查找 assignee 的用户 ID）。
- `get_user`: 按 UUID 获取用户详情。
- `get_viewer`: 获取当前登录用户的资料与所属组织信息。
- `list_workflow_states`: 列出团队的所有工作流状态（用于查找状态 ID）。
- `list_labels`: 列出工作区中的所有 issue 标签。
- `create_label`: 创建新的 issue 标签。
- `update_label`: 更新标签：仅修改指定字段。
- `delete_label`: 删除标签（将从所有使用它的 issue 上移除）。
- `list_cycles`: 列出团队的周期（sprint），用于查找周期 ID。
- `get_cycle`: 按 UUID 获取周期详情。

### en-US

- `search_issues`: Search and filter Linear issues. Supports text search, filtering by team, assignee, state, label, project, and more. Returns paginated results.
- `get_issue`: Get detailed information about a single Linear issue by its UUID or human-readable identifier (e.g. ENG-123).
- `create_issue`: Create a new issue in Linear. Requires a team ID and title at minimum.
- `update_issue`: Update an existing Linear issue. Only specified fields are changed; omitted fields remain unchanged.
- `delete_issue`: Move a Linear issue to the trash. Trashed issues can be restored within 30 days.
- `archive_issue`: Archive a Linear issue. Archived issues are hidden from default views but can be restored.
- `batch_update_issues`: Apply the same update to multiple issues at once. All specified fields are applied to every issue in the batch. Maximum 25 issues per call.
- `list_sub_issues`: List child/sub-issues of a parent Linear issue.
- `list_issue_history`: List the change history (state changes, assignee changes, priority changes) for a Linear issue.
- `list_issue_relations`: List relations (blocks, is blocked by, relates to, duplicate of) for a Linear issue.
- `create_issue_relation`: Create a relation between two Linear issues (blocks, is blocked by, relates to, or duplicate of).
- `delete_issue_relation`: Delete a relation between two Linear issues. Use list_issue_relations to find relation IDs.
- `add_issue_label`: Add a label to an issue without removing existing labels. Unlike update_issue which replaces all labels, this appends.
- `remove_issue_label`: Remove a label from an issue without affecting other labels. Unlike update_issue which replaces all labels, this removes only the specified one.
- `add_issue_subscriber`: Subscribe a user to receive notifications for a Linear issue.
- `remove_issue_subscriber`: Unsubscribe a user from notifications for a Linear issue.
- `set_issue_cycle`: Assign an issue to a cycle (sprint). Use list_cycles to find cycle IDs. Pass an empty string to remove from the current cycle.
- `move_issue_to_project`: Move an issue to a different project. Use list_projects to find project IDs. Pass an empty string to remove from the current project.
- `list_attachments`: List attachments (linked PRs, documents, URLs) on a Linear issue.
- `get_attachment`: Get detailed information about a single attachment by its UUID.
- `create_attachment`: Link a URL (PR, document, design file, etc.) to a Linear issue as an attachment.
- `delete_attachment`: Delete an attachment from a Linear issue.
- `create_comment`: Add a comment to an existing Linear issue.
- `update_comment`: Update an existing comment on a Linear issue.
- `delete_comment`: Delete a comment from a Linear issue.
- `list_comments`: List comments on a Linear issue, ordered by creation date.
- `list_projects`: List all projects in the Linear workspace. Supports pagination.
- `get_project`: Get detailed information about a single Linear project by its UUID.
- `create_project`: Create a new project in Linear.
- `update_project`: Update an existing Linear project. Only specified fields are changed.
- `list_project_labels`: List labels applied to a specific Linear project.
- `list_project_updates`: List status updates (health reports) for a Linear project.
- `create_project_update`: Post a status update (health report) on a Linear project.
- `delete_project_update`: Delete a status update from a Linear project.
- `list_milestones`: List milestones for a Linear project.
- `get_milestone`: Get detailed information about a single project milestone by its UUID.
- `create_milestone`: Create a new milestone in a Linear project.
- `update_milestone`: Update an existing milestone in a Linear project. Only specified fields are changed.
- `list_initiatives`: List initiatives in the Linear workspace, optionally filtered by status.
- `get_initiative`: Get detailed information about a single Linear initiative by its UUID.
- `create_initiative`: Create a new initiative in Linear.
- `update_initiative`: Update an existing Linear initiative. Only specified fields are changed.
- `list_documents`: List documents in the Linear workspace, optionally filtered by project.
- `get_document`: Get detailed information about a single Linear document by its UUID.
- `create_document`: Create a new document in Linear, optionally associated with a project.
- `update_document`: Update an existing Linear document. Only specified fields are changed.
- `list_teams`: List all teams in the Linear workspace that the current user can access.
- `get_team`: Get detailed information about a single Linear team by its UUID.
- `list_team_members`: List members of a specific Linear team.
- `list_users`: List all users in the Linear organization. Use this to find user IDs for assigning issues.
- `get_user`: Get detailed information about a single Linear user by their UUID.
- `get_viewer`: Get the authenticated user's profile information.
- `list_workflow_states`: List all workflow states for a team. Use this to find state IDs for filtering issues or updating issue state.
- `list_labels`: List all issue labels in the Linear workspace. Use this to find label IDs for creating or filtering issues.
- `create_label`: Create a new issue label in Linear.
- `update_label`: Update an existing Linear issue label. Only specified fields are changed.
- `delete_label`: Delete a Linear issue label. Labels will be removed from all issues that use them.
- `list_cycles`: List cycles (sprints) for a team. Use this to find cycle IDs for creating or filtering issues.
- `get_cycle`: Get detailed information about a single cycle (sprint) by its UUID.

### ja-JP

- `search_issues`: テキストやチーム・担当者・ステート・ラベル・プロジェクト・優先度などで Linear issue を検索します。ページネーション対応。
- `get_issue`: UUID または可読 ID（例: ENG-123）で issue の詳細を取得します。
- `create_issue`: Linear に新しい issue を作成します（チーム ID とタイトルが必須）。
- `update_issue`: 既存 issue を更新します。指定フィールドのみ変更し、他はそのまま。
- `delete_issue`: issue をゴミ箱へ移動します（30 日以内なら復元可能）。
- `archive_issue`: issue をアーカイブします。デフォルトビューから非表示になりますが復元できます。
- `batch_update_issues`: 複数の issue（最大 25 件）に同じ更新を一括適用します。
- `list_sub_issues`: 親 issue のサブ issue を一覧表示します。
- `list_issue_history`: issue の変更履歴（ステート・担当者・優先度の変更）を一覧表示します。
- `list_issue_relations`: issue のリレーション（ブロック・被ブロック・関連・重複）を一覧表示します。
- `create_issue_relation`: 2つの issue 間にリレーション（blocks/blockedBy/related/duplicate）を作成します。
- `delete_issue_relation`: issue 間のリレーションを削除します。
- `add_issue_label`: 既存ラベルを残したまま issue にラベルを追加します。
- `remove_issue_label`: 他のラベルに影響せず、指定ラベルだけを issue から外します。
- `add_issue_subscriber`: ユーザーを issue の通知対象にします。
- `remove_issue_subscriber`: ユーザーの issue 通知を解除します。
- `set_issue_cycle`: issue をサイクル（スプリント）に割り当てます。空文字でサイクルから外します。
- `move_issue_to_project`: issue を指定プロジェクトへ移動します。空文字でプロジェクトから外します。
- `list_attachments`: issue の添付（関連 PR・ドキュメント・URL）を一覧表示します。
- `get_attachment`: UUID で単一の添付の詳細を取得します。
- `create_attachment`: URL（PR・デザインファイルなど）を issue の添付として関連付けます。
- `delete_attachment`: issue の添付を削除します。
- `create_comment`: issue にコメントを追加します。
- `update_comment`: issue の既存コメントを更新します。
- `delete_comment`: issue のコメントを削除します。
- `list_comments`: issue のコメントを作成日順で一覧表示します。
- `list_projects`: ワークスペースの全プロジェクトを一覧表示します。ページネーション対応。
- `get_project`: UUID でプロジェクトの詳細を取得します。
- `create_project`: Linear に新しいプロジェクトを作成します。
- `update_project`: プロジェクトを更新します。指定フィールドのみ変更します。
- `list_project_labels`: 指定プロジェクトに付いているラベルを一覧表示します。
- `list_project_updates`: プロジェクトのステータス更新（ヘルスレポート）を一覧表示します。
- `create_project_update`: プロジェクトにステータス更新（ヘルスレポート）を投稿します。
- `delete_project_update`: プロジェクトのステータス更新を削除します。
- `list_milestones`: プロジェクトのマイルストーンを一覧表示します。
- `get_milestone`: UUID でマイルストーンの詳細を取得します。
- `create_milestone`: プロジェクトに新しいマイルストーンを作成します。
- `update_milestone`: プロジェクトのマイルストーンを更新します。指定フィールドのみ変更します。
- `list_initiatives`: ワークスペースのイニシアチブを一覧表示します。状態で絞り込めます。
- `get_initiative`: UUID でイニシアチブの詳細と関連プロジェクトを取得します。
- `create_initiative`: 新しいイニシアチブを作成します。
- `update_initiative`: イニシアチブを更新します。指定フィールドのみ変更します。
- `list_documents`: ワークスペースのドキュメントを一覧表示します。プロジェクトで絞り込めます。
- `get_document`: UUID でドキュメントの詳細を取得します。
- `create_document`: 新しいドキュメントを作成します。プロジェクトへの関連付けも可能。
- `update_document`: ドキュメントを更新します。指定フィールドのみ変更します。
- `list_teams`: 現在のユーザーがアクセスできる全チームを一覧表示します。
- `get_team`: UUID でチームの詳細を取得します。
- `list_team_members`: チームのメンバーを一覧表示します。
- `list_users`: 組織の全ユーザーを一覧表示します（担当者 ID の検索に使用）。
- `get_user`: UUID でユーザーの詳細を取得します。
- `get_viewer`: 認証ユーザーのプロフィールと所属組織の情報を取得します。
- `list_workflow_states`: チームの全ワークフローステートを一覧表示します（ステート ID の検索に使用）。
- `list_labels`: ワークスペースの全 issue ラベルを一覧表示します。
- `create_label`: 新しい issue ラベルを作成します。
- `update_label`: ラベルを更新します。指定フィールドのみ変更します。
- `delete_label`: ラベルを削除します（使用中のすべての issue から外れます）。
- `list_cycles`: チームのサイクル（スプリント）を一覧表示します（サイクル ID の検索に使用）。
- `get_cycle`: UUID でサイクルの詳細を取得します。

### ko-KR

- `search_issues`: 텍스트 및 팀·담당자·상태·라벨·프로젝트·우선순위 등으로 Linear 이슈를 검색합니다. 페이지네이션 지원.
- `get_issue`: UUID 또는 사람이 읽는 식별자(예: ENG-123)로 이슈 상세를 조회합니다.
- `create_issue`: Linear에 새 이슈를 생성합니다(팀 ID와 제목 필수).
- `update_issue`: 기존 이슈를 업데이트합니다. 지정한 필드만 변경되고 나머지는 유지됩니다.
- `delete_issue`: 이슈를 휴지통으로 이동합니다(30일 내 복원 가능).
- `archive_issue`: 이슈를 보관합니다. 기본 뷰에서 숨겨지지만 복원할 수 있습니다.
- `batch_update_issues`: 여러 이슈(최대 25개)에 동일한 업데이트를 일괄 적용합니다.
- `list_sub_issues`: 부모 이슈의 하위 이슈를 나열합니다.
- `list_issue_history`: 이슈의 변경 이력(상태·담당자·우선순위 변경)을 나열합니다.
- `list_issue_relations`: 이슈의 관계(블로킹·블록됨·관련·중복)를 나열합니다.
- `create_issue_relation`: 두 이슈 간에 관계(blocks/blockedBy/related/duplicate)를 생성합니다.
- `delete_issue_relation`: 이슈 간의 관계를 삭제합니다.
- `add_issue_label`: 기존 라벨을 유지하면서 이슈에 라벨을 추가합니다.
- `remove_issue_label`: 다른 라벨에 영향을 주지 않고 지정한 라벨만 이슈에서 제거합니다.
- `add_issue_subscriber`: 사용자를 이슈 알림 대상으로 구독합니다.
- `remove_issue_subscriber`: 사용자의 이슈 구독을 해제합니다.
- `set_issue_cycle`: 이슈를 사이클(스프린트)에 할당합니다. 빈 문자열을 넘기면 사이클에서 제외됩니다.
- `move_issue_to_project`: 이슈를 지정한 프로젝트로 이동합니다. 빈 문자열을 넘기면 프로젝트에서 제외됩니다.
- `list_attachments`: 이슈의 첨부(연관 PR·문서·URL)를 나열합니다.
- `get_attachment`: UUID로 단일 첨부의 상세를 조회합니다.
- `create_attachment`: URL(PR·디자인 파일 등)을 이슈의 첨부로 연결합니다.
- `delete_attachment`: 이슈의 첨부를 삭제합니다.
- `create_comment`: 이슈에 댓글을 추가합니다.
- `update_comment`: 이슈의 기존 댓글을 업데이트합니다.
- `delete_comment`: 이슈의 댓글을 삭제합니다.
- `list_comments`: 이슈의 댓글을 생성일 순으로 나열합니다.
- `list_projects`: 워크스페이스의 모든 프로젝트를 나열합니다. 페이지네이션 지원.
- `get_project`: UUID로 프로젝트 상세를 조회합니다.
- `create_project`: Linear에 새 프로젝트를 생성합니다.
- `update_project`: 프로젝트를 업데이트합니다. 지정한 필드만 변경됩니다.
- `list_project_labels`: 지정한 프로젝트에 적용된 라벨을 나열합니다.
- `list_project_updates`: 프로젝트의 상태 업데이트(헬스 리포트)를 나열합니다.
- `create_project_update`: 프로젝트에 상태 업데이트(헬스 리포트)를 게시합니다.
- `delete_project_update`: 프로젝트의 상태 업데이트를 삭제합니다.
- `list_milestones`: 프로젝트의 마일스톤을 나열합니다.
- `get_milestone`: UUID로 마일스톤 상세를 조회합니다.
- `create_milestone`: 프로젝트에 새 마일스톤을 생성합니다.
- `update_milestone`: 프로젝트 마일스톤을 업데이트합니다. 지정한 필드만 변경됩니다.
- `list_initiatives`: 워크스페이스의 이니셔티브를 나열합니다. 상태로 필터링할 수 있습니다.
- `get_initiative`: UUID로 이니셔티브 상세와 연관 프로젝트를 조회합니다.
- `create_initiative`: 새 이니셔티브를 생성합니다.
- `update_initiative`: 이니셔티브를 업데이트합니다. 지정한 필드만 변경됩니다.
- `list_documents`: 워크스페이스의 문서를 나열합니다. 프로젝트로 필터링할 수 있습니다.
- `get_document`: UUID로 문서 상세를 조회합니다.
- `create_document`: 새 문서를 생성합니다. 프로젝트와 연결할 수도 있습니다.
- `update_document`: 문서를 업데이트합니다. 지정한 필드만 변경됩니다.
- `list_teams`: 현재 사용자가 접근할 수 있는 모든 팀을 나열합니다.
- `get_team`: UUID로 팀 상세를 조회합니다.
- `list_team_members`: 팀의 멤버를 나열합니다.
- `list_users`: 조직의 모든 사용자를 나열합니다(담당자 사용자 ID 조회에 사용).
- `get_user`: UUID로 사용자 상세를 조회합니다.
- `get_viewer`: 인증된 사용자의 프로필과 소속 조직 정보를 조회합니다.
- `list_workflow_states`: 팀의 모든 워크플로 상태를 나열합니다(상태 ID 조회에 사용).
- `list_labels`: 워크스페이스의 모든 이슈 라벨을 나열합니다.
- `create_label`: 새 이슈 라벨을 생성합니다.
- `update_label`: 라벨을 업데이트합니다. 지정한 필드만 변경됩니다.
- `delete_label`: 라벨을 삭제합니다(사용 중인 모든 이슈에서 제거됩니다).
- `list_cycles`: 팀의 사이클(스프린트)을 나열합니다(사이클 ID 조회에 사용).
- `get_cycle`: UUID로 사이클 상세를 조회합니다.

## Scope and ToS posture

Same posture as the upstream OpenTabs plugins: the tools operate on the user's own
logged-in session and quota, inside the linear.app tab. No credential is extracted or
exfiltrated — auth stays in page context, mirroring the `com.discord.main` pilot.
