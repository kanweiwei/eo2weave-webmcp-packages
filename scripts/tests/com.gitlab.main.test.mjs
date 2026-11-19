// Execution tests for com.gitlab.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime reads the session identity from the page's own `gon`
// global (gon.current_username), the CSRF token from <meta name="csrf-token">
// and the API base from gon.gitlab_url, so every fixture supplies those and
// every assertion checks the exact request plus the parsed output.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const BASE = 'https://gitlab.com/api/v4'
const GON = { current_username: 'ada', gitlab_url: 'https://gitlab.com', relative_url_root: '' }

const jsonResponse = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? null },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
  async json() {
    return typeof payload === 'string' ? JSON.parse(payload) : payload
  },
})

const textResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'text/plain' },
  async text() {
    return body
  },
})

/** A stubbed gitlab.com page carrying the logged-in gon identity. */
function glPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'gitlab.com',
      origin: 'https://gitlab.com',
      href: 'https://gitlab.com/group/project/-/issues',
      globals: { gon: GON },
      meta: { 'csrf-token': 'csrf-gitlab' },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

const PROJECT = {
  id: 42,
  name: 'Project',
  path_with_namespace: 'group/project',
  description: 'demo',
  visibility: 'private',
  web_url: 'https://gitlab.com/group/project',
  default_branch: 'main',
  star_count: 3,
  forks_count: 1,
  open_issues_count: 7,
  archived: false,
  created_at: '2025-01-02T03:04:05Z',
  last_activity_at: '2026-02-01T00:00:00Z',
}

const ISSUE = {
  iid: 12,
  title: 'Ship the port',
  state: 'opened',
  description: 'All 22 tools',
  web_url: 'https://gitlab.com/group/project/-/issues/12',
  author: { username: 'ada' },
  labels: ['backend', 'port'],
  assignees: [{ username: 'ada' }, { username: 'grace' }],
  milestone: { title: 'v1' },
  confidential: false,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-02T00:00:00Z',
  closed_at: null,
}

const MR = {
  iid: 7,
  title: 'Port gitlab',
  state: 'opened',
  description: 'body',
  web_url: 'https://gitlab.com/group/project/-/merge_requests/7',
  author: { username: 'ada' },
  source_branch: 'feat/gitlab-port',
  target_branch: 'main',
  labels: ['webmcp'],
  draft: false,
  merged_by: null,
  merge_status: 'can_be_merged',
  has_conflicts: false,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T01:00:00Z',
}

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  const P = 'com.gitlab.main'

  // --- projects ------------------------------------------------------------
  section('execution: GitLab project, issue and MR reads against a stubbed page')

  {
    const { page, requests } = glPage(() => jsonResponse([PROJECT]))
    const result = await runTool(P, 'list_projects', { input: {}, page })
    equal(result.status, 'ok', 'gitlab list_projects: status')
    equal(result.data.projects.length, 1, 'gitlab list_projects: project count')
    equal(result.data.projects[0].path_with_namespace, 'group/project', 'gitlab list_projects: path')
    equal(result.data.projects[0].open_issues_count, 7, 'gitlab list_projects: numeric field')
    equal(requests[0].url, `${BASE}/projects?per_page=20`, 'gitlab list_projects: /projects with the default page size')
    equal(requests[0].init.method, 'GET', 'gitlab list_projects: GET')
    equal(requests[0].init.credentials, 'include', 'gitlab list_projects: sends credentials')
    equal(requests[0].init.headers.Accept, 'application/json', 'gitlab list_projects: asks for JSON')
    equal(requests[0].init.headers['X-CSRF-Token'], undefined, 'gitlab list_projects: no CSRF token on a read')
    equal(requests[0].init.headers['Content-Type'], undefined, 'gitlab list_projects: no body content type on a read')
    equal(requests[0].init.body, undefined, 'gitlab list_projects: no body on a read')
  }

  {
    // Filters travel as query parameters; the project path is URL-encoded.
    const { page, requests } = glPage(() => jsonResponse(PROJECT))
    const result = await runTool(P, 'get_project', { input: { project: 'group/project' }, page })
    equal(result.status, 'ok', 'gitlab get_project: status')
    equal(result.data.project.id, 42, 'gitlab get_project: id')
    equal(result.data.project.default_branch, 'main', 'gitlab get_project: default branch')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject`, 'gitlab get_project: URL-encoded project path')
  }

  {
    const { page, requests } = glPage(() => jsonResponse([PROJECT]))
    const result = await runTool(P, 'search_projects', { input: { search: 'port', per_page: 5, page: 3 }, page })
    equal(result.status, 'ok', 'gitlab search_projects: status')
    equal(requests[0].url, `${BASE}/projects?search=port&per_page=5&page=3`, 'gitlab search_projects: search + pagination')
    equal(result.data.projects[0].visibility, 'private', 'gitlab search_projects: mapped project')
  }

  {
    const { page, requests } = glPage(() => jsonResponse([ISSUE]))
    const result = await runTool(P, 'list_issues', {
      input: { project: 'group/project', labels: 'backend', per_page: 50, page: 2 },
      page,
    })
    equal(result.status, 'ok', 'gitlab list_issues: status')
    equal(result.data.issues[0].iid, 12, 'gitlab list_issues: iid')
    equal(result.data.issues[0].author_username, 'ada', 'gitlab list_issues: author')
    equal(result.data.issues[0].assignees.join(','), 'ada,grace', 'gitlab list_issues: assignees')
    equal(result.data.issues[0].milestone_title, 'v1', 'gitlab list_issues: milestone')
    equal(result.data.issues[0].labels.join(','), 'backend,port', 'gitlab list_issues: labels')
    equal(result.data.issues[0].closed_at, '', 'gitlab list_issues: null closed_at becomes empty string')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/issues?state=opened&per_page=50&page=2&labels=backend`,
      'gitlab list_issues: default state=opened, filters and pagination in the query',
    )
  }

  {
    const { page, requests } = glPage(() => jsonResponse(ISSUE))
    const result = await runTool(P, 'get_issue', { input: { project: 'group/project', issue_iid: 12 }, page })
    equal(result.status, 'ok', 'gitlab get_issue: status')
    equal(result.data.issue.title, 'Ship the port', 'gitlab get_issue: title')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/issues/12`, 'gitlab get_issue: issue endpoint')
  }

  // --- merge requests ------------------------------------------------------
  {
    const { page, requests } = glPage(() => jsonResponse([MR]))
    const result = await runTool(P, 'list_merge_requests', {
      input: { project: 'group/project', state: 'merged', per_page: 10, page: 1 },
      page,
    })
    equal(result.status, 'ok', 'gitlab list_merge_requests: status')
    equal(result.data.merge_requests[0].source_branch, 'feat/gitlab-port', 'gitlab list_merge_requests: source branch')
    equal(result.data.merge_requests[0].merged_by_username, '', 'gitlab list_merge_requests: null merged_by')
    equal(result.data.merge_requests[0].merge_status, 'can_be_merged', 'gitlab list_merge_requests: merge status')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/merge_requests?state=merged&per_page=10&page=1`,
      'gitlab list_merge_requests: state and pagination',
    )
  }

  {
    const { page, requests } = glPage(() => jsonResponse(MR))
    const result = await runTool(P, 'get_merge_request', {
      input: { project: 'group/project', merge_request_iid: 7 },
      page,
    })
    equal(result.status, 'ok', 'gitlab get_merge_request: status')
    equal(result.data.merge_request.iid, 7, 'gitlab get_merge_request: iid')
    equal(result.data.merge_request.target_branch, 'main', 'gitlab get_merge_request: target branch')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/merge_requests/7`, 'gitlab get_merge_request: endpoint')
  }

  {
    const { page, requests } = glPage(() =>
      jsonResponse({
        changes: [
          {
            old_path: 'src/a.js',
            new_path: 'src/b.js',
            diff: '@@ -1 +1 @@\n-old\n+new',
            new_file: false,
            renamed_file: true,
            deleted_file: false,
          },
        ],
      }),
    )
    const result = await runTool(P, 'get_merge_request_diff', {
      input: { project: 'group/project', merge_request_iid: 7 },
      page,
    })
    equal(result.status, 'ok', 'gitlab get_merge_request_diff: status')
    equal(result.data.diffs.length, 1, 'gitlab get_merge_request_diff: file count')
    equal(result.data.diffs[0].new_path, 'src/b.js', 'gitlab get_merge_request_diff: new path')
    equal(result.data.diffs[0].renamed_file, true, 'gitlab get_merge_request_diff: renamed flag')
    ok(result.data.diffs[0].diff.includes('-old'), 'gitlab get_merge_request_diff: unified diff kept')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/merge_requests/7/changes`,
      'gitlab get_merge_request_diff: changes endpoint',
    )
  }

  // --- repository ----------------------------------------------------------
  {
    const { page, requests } = glPage(() => jsonResponse([{ id: 'b1', name: 'main', protected: true, default: true, commit: { id: 'sha-1' }, web_url: 'x' }]))
    const result = await runTool(P, 'list_branches', { input: { project: 'group/project', search: 'mai' }, page })
    equal(result.status, 'ok', 'gitlab list_branches: status')
    equal(result.data.branches[0].sha, 'sha-1', 'gitlab list_branches: sha from commit.id')
    equal(result.data.branches[0].protected, true, 'gitlab list_branches: protected flag')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/repository/branches?per_page=20&search=mai`, 'gitlab list_branches: endpoint')
  }

  {
    const content = Buffer.from('console.log("hi")\n').toString('base64')
    const { page, requests } = glPage(() => jsonResponse({ file_path: 'src/index.js', content, encoding: 'base64' }))
    const result = await runTool(P, 'get_file_content', {
      input: { project: 'group/project', file_path: 'src/index.js' },
      page,
    })
    equal(result.status, 'ok', 'gitlab get_file_content: status')
    equal(result.data.content, 'console.log("hi")\n', 'gitlab get_file_content: base64 decoded to text')
    equal(result.data.file_path, 'src/index.js', 'gitlab get_file_content: file path')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/repository/files/src%2Findex.js?ref=HEAD`,
      'gitlab get_file_content: encoded path with the HEAD default ref',
    )
  }

  {
    const { page, requests } = glPage(() =>
      jsonResponse([
        {
          id: 'abc123',
          short_id: 'abc1',
          title: 'Port it',
          message: 'Port it\n\nbody',
          author_name: 'Ada',
          author_email: 'ada@example.com',
          authored_date: '2026-02-01T00:00:00Z',
          web_url: 'https://gitlab.com/group/project/-/commit/abc123',
        },
      ]),
    )
    const result = await runTool(P, 'list_commits', {
      input: { project: 'group/project', ref_name: 'main', since: '2026-01-01T00:00:00Z' },
      page,
    })
    equal(result.status, 'ok', 'gitlab list_commits: status')
    equal(result.data.commits[0].short_id, 'abc1', 'gitlab list_commits: short id')
    equal(result.data.commits[0].author_email, 'ada@example.com', 'gitlab list_commits: author email')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/repository/commits?per_page=20&ref_name=main&since=2026-01-01T00%3A00%3A00Z`,
      'gitlab list_commits: ref_name and since filters',
    )
  }

  // --- CI/CD ---------------------------------------------------------------
  {
    const { page, requests } = glPage(() =>
      jsonResponse([
        {
          id: 900,
          iid: 12,
          status: 'failed',
          ref: 'main',
          sha: 'sha-9',
          source: 'push',
          web_url: 'u',
          created_at: 'c',
          updated_at: 'u',
        },
      ]),
    )
    const result = await runTool(P, 'list_pipelines', { input: { project: 'group/project', status: 'failed' }, page })
    equal(result.status, 'ok', 'gitlab list_pipelines: status')
    equal(result.data.pipelines[0].id, 900, 'gitlab list_pipelines: id')
    equal(result.data.pipelines[0].source, 'push', 'gitlab list_pipelines: source')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/pipelines?per_page=20&status=failed`,
      'gitlab list_pipelines: status filter',
    )
  }

  {
    const { page, requests } = glPage(() =>
      jsonResponse([
        { id: 31, name: 'rspec', stage: 'test', status: 'success', ref: 'main', web_url: 'u', duration: 12.5, created_at: 'c', finished_at: null },
      ]),
    )
    const result = await runTool(P, 'list_pipeline_jobs', { input: { project: 'group/project', pipeline_id: 900 }, page })
    equal(result.status, 'ok', 'gitlab list_pipeline_jobs: status')
    equal(result.data.jobs[0].stage, 'test', 'gitlab list_pipeline_jobs: stage')
    equal(result.data.jobs[0].duration, 12.5, 'gitlab list_pipeline_jobs: duration stays numeric')
    equal(result.data.jobs[0].finished_at, '', 'gitlab list_pipeline_jobs: null finished_at')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/pipelines/900/jobs?per_page=20`,
      'gitlab list_pipeline_jobs: jobs endpoint',
    )
  }

  {
    // The trace endpoint answers text/plain: the runtime must not JSON-parse it.
    const { page, requests } = glPage(() => textResponse('Running with gitlab-runner\nJob succeeded\n'))
    const result = await runTool(P, 'get_job_log', { input: { project: 'group/project', job_id: 31 }, page })
    equal(result.status, 'ok', 'gitlab get_job_log: status')
    equal(result.data.log, 'Running with gitlab-runner\nJob succeeded\n', 'gitlab get_job_log: raw log text')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/jobs/31/trace`, 'gitlab get_job_log: trace endpoint')
  }

  // --- users ---------------------------------------------------------------
  {
    const { page, requests } = glPage(() =>
      jsonResponse([
        {
          id: 5,
          username: 'ada',
          name: 'Ada Lovelace',
          state: 'active',
          avatar_url: 'https://gitlab.com/a.png',
          web_url: 'w',
          bio: null,
          location: 'London',
          public_email: null,
        },
      ]),
    )
    const result = await runTool(P, 'get_user_profile', { input: {}, page })
    equal(result.status, 'ok', 'gitlab get_user_profile: status')
    equal(result.data.user.username, 'ada', 'gitlab get_user_profile: defaults to the page user')
    equal(result.data.user.name, 'Ada Lovelace', 'gitlab get_user_profile: display name')
    equal(result.data.user.bio, '', 'gitlab get_user_profile: null bio becomes empty string')
    equal(requests[0].url, `${BASE}/users?username=ada`, 'gitlab get_user_profile: /users?username=')

    const missing = glPage(() => jsonResponse([]))
    const none = await runTool(P, 'get_user_profile', { input: { username: 'nobody' }, page: missing.page })
    equal(none.status, 'error', 'gitlab get_user_profile unknown user: is an error')
    equal(none.error_code, 'NOT_FOUND', 'gitlab get_user_profile unknown user: NOT_FOUND')
    equal(missing.requests[0].url, `${BASE}/users?username=nobody`, 'gitlab get_user_profile: explicit username')
  }

  // --- writes --------------------------------------------------------------
  section('execution: GitLab writes carry the page CSRF token')

  {
    const { page, requests } = glPage((url, init) =>
      jsonResponse({
        ...ISSUE,
        iid: 99,
        title: JSON.parse(init.body).title,
        labels: ['backend'],
        confidential: true,
      }),
    )
    const result = await runTool(P, 'create_issue', {
      input: {
        project: 'group/project',
        title: 'New issue',
        description: 'Details',
        labels: 'backend',
        assignee_ids: [5, 6],
        confidential: true,
      },
      page,
    })
    equal(result.status, 'ok', 'gitlab create_issue: status')
    equal(result.data.issue.iid, 99, 'gitlab create_issue: created issue iid')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/issues`, 'gitlab create_issue: issues endpoint')
    equal(requests[0].init.method, 'POST', 'gitlab create_issue: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'gitlab create_issue: JSON body')
    equal(requests[0].init.headers['X-CSRF-Token'], 'csrf-gitlab', 'gitlab create_issue: sends the page CSRF token')
    const body = JSON.parse(requests[0].init.body)
    equal(body.title, 'New issue', 'gitlab create_issue: title')
    equal(body.description, 'Details', 'gitlab create_issue: description')
    equal(body.labels, 'backend', 'gitlab create_issue: labels as a comma-separated string')
    equal(body.assignee_ids.join(','), '5,6', 'gitlab create_issue: assignee ids stay an array')
    equal(body.confidential, true, 'gitlab create_issue: confidential stays a boolean')
    ok(!('milestone_id' in body), 'gitlab create_issue: omits an unspecified milestone_id')
  }

  {
    // A page without any CSRF token still writes — the header is just omitted.
    const { page, requests } = glPage(() => jsonResponse({ ...ISSUE, state: 'closed' }), {
      meta: {},
      csrf: false,
    })
    const result = await runTool(P, 'update_issue', {
      input: { project: 'group/project', issue_iid: 12, state_event: 'close' },
      page,
    })
    equal(result.status, 'ok', 'gitlab update_issue without csrf: status')
    equal(requests[0].init.method, 'PUT', 'gitlab update_issue: PUT')
    equal(requests[0].init.headers['X-CSRF-Token'], undefined, 'gitlab update_issue: no token, no header')
    equal(JSON.parse(requests[0].init.body).state_event, 'close', 'gitlab update_issue: state_event')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/issues/12`,
      'gitlab update_issue: issue endpoint',
    )
  }

  {
    const { page, requests } = glPage(() => jsonResponse({ ...MR, iid: 8 }))
    const result = await runTool(P, 'create_merge_request', {
      input: {
        project: 'group/project',
        title: 'Port gitlab',
        source_branch: 'feat/gitlab-port',
        target_branch: 'main',
        remove_source_branch: true,
      },
      page,
    })
    equal(result.status, 'ok', 'gitlab create_merge_request: status')
    equal(result.data.merge_request.iid, 8, 'gitlab create_merge_request: created iid')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/merge_requests`,
      'gitlab create_merge_request: merge_requests endpoint',
    )
    equal(requests[0].init.headers['X-CSRF-Token'], 'csrf-gitlab', 'gitlab create_merge_request: CSRF token')
    const body = JSON.parse(requests[0].init.body)
    equal(body.source_branch, 'feat/gitlab-port', 'gitlab create_merge_request: source branch')
    equal(body.target_branch, 'main', 'gitlab create_merge_request: target branch')
    equal(body.remove_source_branch, true, 'gitlab create_merge_request: remove source branch')
  }

  {
    const { page, requests } = glPage(() => jsonResponse({ ...MR, title: 'Renamed' }))
    const result = await runTool(P, 'update_merge_request', {
      input: { project: 'group/project', merge_request_iid: 7, title: 'Renamed', squash: true },
      page,
    })
    equal(result.status, 'ok', 'gitlab update_merge_request: status')
    equal(result.data.merge_request.title, 'Renamed', 'gitlab update_merge_request: new title')
    equal(requests[0].init.method, 'PUT', 'gitlab update_merge_request: PUT')
    equal(requests[0].url, `${BASE}/projects/group%2Fproject/merge_requests/7`, 'gitlab update_merge_request: endpoint')
    equal(JSON.parse(requests[0].init.body).squash, true, 'gitlab update_merge_request: squash')
  }

  {
    const { page, requests } = glPage(() => jsonResponse({ ...MR, state: 'merged', merged_by: { username: 'ada' } }))
    const result = await runTool(P, 'merge_merge_request', {
      input: {
        project: 'group/project',
        merge_request_iid: 7,
        squash: true,
        should_remove_source_branch: false,
        merge_commit_message: 'Merge it',
      },
      page,
    })
    equal(result.status, 'ok', 'gitlab merge_merge_request: status')
    equal(result.data.merge_request.state, 'merged', 'gitlab merge_merge_request: merged state')
    equal(result.data.merge_request.merged_by_username, 'ada', 'gitlab merge_merge_request: merged by')
    equal(requests[0].init.method, 'PUT', 'gitlab merge_merge_request: PUT')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/merge_requests/7/merge`,
      'gitlab merge_merge_request: /merge endpoint',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(body.merge_commit_message, 'Merge it', 'gitlab merge_merge_request: commit message')
    equal(body.should_remove_source_branch, false, 'gitlab merge_merge_request: false is sent, not dropped')
  }

  {
    // The comment tool: one POST to the notes collection of the issue.
    const { page, requests } = glPage(() =>
      jsonResponse({ id: 501, body: 'LGTM', author: { username: 'ada' }, system: false, created_at: 'c', updated_at: 'u' }),
    )
    const result = await runTool(P, 'create_note', {
      input: { project: 'group/project', noteable_type: 'issues', noteable_iid: 12, body: 'LGTM' },
      page,
    })
    equal(result.status, 'ok', 'gitlab create_note: status')
    equal(result.data.note.id, 501, 'gitlab create_note: note id')
    equal(result.data.note.body, 'LGTM', 'gitlab create_note: body')
    equal(result.data.note.system, false, 'gitlab create_note: system flag')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/issues/12/notes`,
      'gitlab create_note: notes endpoint for issues',
    )
    equal(requests[0].init.method, 'POST', 'gitlab create_note: POST')
    equal(requests[0].init.headers['X-CSRF-Token'], 'csrf-gitlab', 'gitlab create_note: CSRF token')
    equal(JSON.parse(requests[0].init.body).body, 'LGTM', 'gitlab create_note: body only')
  }

  {
    const { page, requests } = glPage(() =>
      jsonResponse([{ id: 1, body: 'system note', author: { username: 'ada' }, system: true, created_at: 'c', updated_at: 'u' }]),
    )
    const result = await runTool(P, 'list_notes', {
      input: { project: 'group/project', noteable_type: 'merge_requests', noteable_iid: 7, sort: 'asc' },
      page,
    })
    equal(result.status, 'ok', 'gitlab list_notes: status')
    equal(result.data.notes[0].system, true, 'gitlab list_notes: system note kept')
    equal(
      requests[0].url,
      `${BASE}/projects/group%2Fproject/merge_requests/7/notes?per_page=20&sort=asc`,
      'gitlab list_notes: MR notes endpoint with sort',
    )
  }

  // --- auth and error classification ---------------------------------------
  section('execution: GitLab auth failures and HTTP errors are classified')

  {
    // Logged out: no gon identity on the page means no request at all.
    const { page, requests } = glPage(() => jsonResponse([]), { globals: {} })
    const result = await runTool(P, 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'gitlab logged out: is an error')
    equal(result.error_code, 'UNAUTHENTICATED', 'gitlab logged out: UNAUTHENTICATED')
    equal(requests.length, 0, 'gitlab logged out: makes no request')

    const profile = await runTool(P, 'get_user_profile', { input: {}, page })
    equal(profile.error_code, 'UNAUTHENTICATED', 'gitlab logged out get_user_profile: UNAUTHENTICATED')
    equal(requests.length, 0, 'gitlab logged out get_user_profile: makes no request')
  }

  {
    const { page } = glPage(() => jsonResponse({ message: '401 Unauthorized' }, 401))
    const result = await runTool(P, 'get_project', { input: { project: 'group/project' }, page })
    equal(result.status, 'error', 'gitlab 401: is an error')
    equal(result.error_code, 'AUTH', 'gitlab 401: AUTH')
    ok(result.message.includes('401'), 'gitlab 401: message carries the status')
  }

  {
    const { page } = glPage(() => jsonResponse({ message: '404 Project Not Found' }, 404))
    const result = await runTool(P, 'get_issue', { input: { project: 'group/project', issue_iid: 1 }, page })
    equal(result.error_code, 'NOT_FOUND', 'gitlab 404: NOT_FOUND')

    const forbidden = glPage(() => jsonResponse({ message: '403 Forbidden' }, 403))
    const denied = await runTool(P, 'list_branches', { input: { project: 'group/project' }, page: forbidden.page })
    equal(denied.error_code, 'AUTH', 'gitlab 403: AUTH')
  }

  {
    const { page } = glPage(() => jsonResponse({ message: 'title is missing' }, 422))
    const result = await runTool(P, 'create_issue', { input: { project: 'group/project', title: '' }, page })
    equal(result.error_code, 'VALIDATION', 'gitlab 422: VALIDATION')
    ok(result.message.includes('Validation error'), 'gitlab 422: message says validation')
  }

  {
    const { page } = glPage(() => jsonResponse({ message: 'Retry later' }, 429, { 'Retry-After': '30' }))
    const result = await runTool(P, 'list_pipelines', { input: { project: 'group/project' }, page })
    equal(result.error_code, 'RATE_LIMITED', 'gitlab 429: RATE_LIMITED')
    ok(result.message.includes('retry after 30'), 'gitlab 429: Retry-After surfaced')
  }

  {
    // A non-GitLab tab is refused before any request.
    const { page, requests } = glPage(() => jsonResponse([]), { hostname: 'example.com', origin: 'https://example.com', globals: {} })
    const result = await runTool(P, 'list_projects', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'gitlab wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'gitlab wrong host: makes no request')
  }

  // --- self-hosted ---------------------------------------------------------
  section('execution: self-hosted instances use their own API base')

  {
    const { page, requests } = glPage(() => jsonResponse([PROJECT]), {
      hostname: 'gitlab.example.com',
      origin: 'https://gitlab.example.com',
      href: 'https://gitlab.example.com/group/project/-/issues',
      globals: { gon: { current_username: 'ada', gitlab_url: 'https://gitlab.example.com' } },
      meta: { 'csrf-token': 'csrf-self' },
    })
    const result = await runTool(P, 'list_projects', { input: {}, page })
    equal(result.status, 'ok', 'gitlab self-hosted: status')
    equal(
      requests[0].url,
      'https://gitlab.example.com/api/v4/projects?per_page=20',
      'gitlab self-hosted: API base is the instance, not gitlab.com',
    )
  }

  {
    // A subpath install (https://host/gitlab) publishes gon.relative_url_root.
    const { page, requests } = glPage(() => jsonResponse(PROJECT), {
      hostname: 'code.example.com',
      origin: 'https://code.example.com',
      globals: {
        gon: { current_username: 'ada', gitlab_url: 'https://code.example.com', relative_url_root: '/gitlab' },
      },
    })
    const result = await runTool(P, 'get_project', { input: { project: 'group/project' }, page })
    equal(result.status, 'ok', 'gitlab subpath install: status')
    equal(
      requests[0].url,
      'https://code.example.com/gitlab/api/v4/projects/group%2Fproject',
      'gitlab subpath install: relative_url_root in the base',
    )
  }

  // --- urlRegex ------------------------------------------------------------
  section('contract: com.gitlab.main urlRegex matches GitLab hosts only')

  {
    const manifest = JSON.parse(readFileSync(path.join(packagesDir, P, 'manifest.json'), 'utf8'))
    const regex = new RegExp(manifest.tools[0].urlRegex)
    for (const tool of manifest.tools) {
      equal(tool.urlRegex, manifest.tools[0].urlRegex, `gitlab ${tool.name}: shares the package urlRegex`)
    }
    const matches = [
      'https://gitlab.com/',
      'https://gitlab.com/group/project',
      'https://gitlab.com/group/project/-/merge_requests/7?scope=all#note_1',
      'http://gitlab.com/group/project',
      'https://gitlab.example.com/group/project',
      'https://sub.gitlab.example.co.uk:8443/group/project/-/issues',
    ]
    const misses = [
      'https://github.com/opentabs-dev/opentabs',
      'https://example.com/gitlab',
      'https://notgitlab.com/x',
      'ftp://gitlab.com/group/project',
    ]
    for (const url of matches) ok(regex.test(url), `gitlab urlRegex matches ${url}`)
    for (const url of misses) ok(!regex.test(url), `gitlab urlRegex rejects ${url}`)
  }

  {
    // A page that is not part of the GitLab host family is refused even when it
    // carries a gon identity, unless gon.gitlab_url names that very host.
    const { page, requests } = glPage(() => jsonResponse([]), {
      hostname: 'example.com',
      origin: 'https://example.com',
      globals: { gon: { current_username: 'ada', gitlab_url: 'https://gitlab.com' } },
    })
    const result = await runTool(P, 'list_projects', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'gitlab foreign host: refused by the runtime')
    equal(requests.length, 0, 'gitlab foreign host: makes no request')
  }
}
