// Execution tests for com.bitbucket.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime reads the session identity from the page's own
// __app_data__ global, takes the CSRF token from the csrftoken cookie, and
// calls the same-origin /!api/2.0 API. Every fixture supplies both and every
// assertion checks the exact request plus the parsed output.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const API = '/!api/2.0'
const CSRF = 'csrf-abc123'

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
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
  async json() {
    return JSON.parse(body)
  },
})

const noContentResponse = () => ({
  ok: true,
  status: 204,
  headers: { get: () => null },
  async text() {
    return ''
  },
  async json() {
    throw new Error('204 has no JSON body')
  },
})

const REPO = {
  uuid: '{repo-uuid}',
  slug: 'webmcp-packages',
  full_name: 'acme/webmcp-packages',
  name: 'WebMCP Packages',
  description: 'Ported packages',
  is_private: true,
  scm: 'git',
  language: 'javascript',
  mainbranch: { name: 'main' },
  links: { html: { href: 'https://bitbucket.org/acme/webmcp-packages' } },
  created_on: '2024-01-02T03:04:05Z',
  updated_on: '2024-05-06T07:08:09Z',
}

const PR = {
  id: 42,
  title: 'Add bitbucket package',
  description: 'Full port',
  state: 'OPEN',
  source: { branch: { name: 'feat/bitbucket-port' } },
  destination: { branch: { name: 'main' } },
  author: { display_name: 'Ada Lovelace' },
  close_source_branch: true,
  comment_count: 3,
  links: { html: { href: 'https://bitbucket.org/acme/webmcp-packages/pull-requests/42' } },
  created_on: '2024-06-01T00:00:00Z',
  updated_on: '2024-06-02T00:00:00Z',
}

const COMMENT = {
  id: 9001,
  content: { raw: '**LGTM**' },
  user: { display_name: 'Grace Hopper' },
  created_on: '2024-06-03T00:00:00Z',
  updated_on: '2024-06-03T00:00:00Z',
}

const PIPELINE = {
  uuid: '{pipeline-uuid}',
  build_number: 17,
  state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } },
  target: { ref_name: 'main', commit: { hash: 'abc123def' } },
  creator: { display_name: 'Ada Lovelace' },
  duration_in_seconds: 93,
  created_on: '2024-06-04T00:00:00Z',
  completed_on: '2024-06-04T00:01:33Z',
}

/** A stubbed bitbucket.org page. `loggedIn: false` removes the auth global. */
function pageWith(handler, { loggedIn = true, cookie = `csrftoken=${CSRF}`, overrides = {} } = {}) {
  const requests = []
  const page = {
    hostname: 'bitbucket.org',
    origin: 'https://bitbucket.org',
    href: 'https://bitbucket.org/acme/webmcp-packages/src/main/README.md',
    cookie,
    globals: loggedIn ? { __app_data__: { user: { uuid: '{user-uuid}', display_name: 'Ada Lovelace' } } } : {},
    fetch: async (url, init) => {
      requests.push({ url, init })
      return handler(url, init, requests.length)
    },
    ...overrides,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  const P = 'com.bitbucket.main'

  section('execution: Bitbucket reads and writes against a stubbed bitbucket.org page')

  // --- auth surface --------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({}), { loggedIn: false })
    const result = await runTool(P, 'get_user_profile', { input: {}, page })
    equal(result.status, 'error', 'bitbucket get_user_profile: unauthenticated status')
    equal(result.error_code, 'UNAUTHENTICATED', 'bitbucket get_user_profile: error code')
    equal(requests.length, 0, 'bitbucket get_user_profile: no request without a session')
  }

  // --- user ---------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        uuid: '{user-uuid}',
        username: 'ada',
        display_name: 'Ada Lovelace',
        type: 'user',
        links: { html: { href: 'https://bitbucket.org/%7Buser-uuid%7D/' } },
      }),
    )
    const result = await runTool(P, 'get_user_profile', { input: {}, page })
    equal(result.status, 'ok', 'bitbucket get_user_profile: status')
    equal(requests.length, 1, 'bitbucket get_user_profile: one request')
    equal(requests[0].url, `${API}/user`, 'bitbucket get_user_profile: endpoint')
    equal(requests[0].init.method, 'GET', 'bitbucket get_user_profile: GET')
    equal(requests[0].init.credentials, 'include', 'bitbucket get_user_profile: sends credentials')
    equal(
      requests[0].init.headers['X-CSRFToken'],
      undefined,
      'bitbucket get_user_profile: no CSRF header on a read',
    )
    equal(result.data.display_name, 'Ada Lovelace', 'bitbucket get_user_profile: display name')
    equal(result.data.username, 'ada', 'bitbucket get_user_profile: username')
  }

  // --- repositories -------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({ values: [REPO], next: null }))
    const result = await runTool(P, 'list_repositories', {
      input: { workspace: 'acme', page: 2, pagelen: 50 },
      page,
    })
    equal(result.status, 'ok', 'bitbucket list_repositories: status')
    equal(
      requests[0].url,
      `${API}/repositories/acme?page=2&pagelen=50`,
      'bitbucket list_repositories: endpoint + pagination',
    )
    equal(result.data.repositories.length, 1, 'bitbucket list_repositories: one repository')
    equal(result.data.repositories[0].full_name, 'acme/webmcp-packages', 'bitbucket list_repositories: full_name')
    equal(result.data.repositories[0].default_branch, 'main', 'bitbucket list_repositories: default branch')
    equal(
      result.data.repositories[0].web_url,
      'https://bitbucket.org/acme/webmcp-packages',
      'bitbucket list_repositories: web url',
    )
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(REPO))
    const result = await runTool(P, 'list_repositories', {
      input: { workspace: 'acme', query: 'name ~ "webmcp"' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme?q=name+%7E+%22webmcp%22`,
      'bitbucket list_repositories: query maps to q',
    )
    equal(result.status, 'ok', 'bitbucket list_repositories: q status')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(REPO))
    const result = await runTool(P, 'get_repository', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages`,
      'bitbucket get_repository: endpoint',
    )
    equal(result.data.slug, 'webmcp-packages', 'bitbucket get_repository: slug')
    equal(result.data.is_private, true, 'bitbucket get_repository: is_private')
    equal(result.data.scm, 'git', 'bitbucket get_repository: scm')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...REPO, slug: 'new-repo', full_name: 'acme/new-repo' }))
    const result = await runTool(P, 'create_repository', {
      input: { workspace: 'acme', repo_slug: 'new-repo', description: 'fresh' },
      page,
    })
    equal(result.status, 'ok', 'bitbucket create_repository: status')
    equal(requests[0].init.method, 'POST', 'bitbucket create_repository: POST')
    equal(requests[0].url, `${API}/repositories/acme/new-repo`, 'bitbucket create_repository: endpoint')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'bitbucket create_repository: JSON body')
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket create_repository: CSRF header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.scm, 'git', 'bitbucket create_repository: default scm')
    equal(body.is_private, true, 'bitbucket create_repository: default private')
    equal(body.description, 'fresh', 'bitbucket create_repository: description')
    equal('has_issues' in body, false, 'bitbucket create_repository: omitted optionals stay omitted')
    equal(result.data.slug, 'new-repo', 'bitbucket create_repository: parsed slug')
  }

  // --- pull requests ------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({ values: [PR] }))
    const result = await runTool(P, 'list_pull_requests', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', state: 'OPEN' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests?state=OPEN`,
      'bitbucket list_pull_requests: endpoint + state',
    )
    equal(result.data.pull_requests.length, 1, 'bitbucket list_pull_requests: one PR')
    equal(result.data.pull_requests[0].source_branch, 'feat/bitbucket-port', 'bitbucket list_pull_requests: source')
    equal(result.data.pull_requests[0].destination_branch, 'main', 'bitbucket list_pull_requests: destination')
    equal(result.data.pull_requests[0].author, 'Ada Lovelace', 'bitbucket list_pull_requests: author')
    equal(result.data.pull_requests[0].comment_count, 3, 'bitbucket list_pull_requests: comment count')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(PR))
    const result = await runTool(P, 'get_pull_request', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42`,
      'bitbucket get_pull_request: endpoint',
    )
    equal(result.data.id, 42, 'bitbucket get_pull_request: id')
    equal(result.data.state, 'OPEN', 'bitbucket get_pull_request: state')
    equal(result.data.close_source_branch, true, 'bitbucket get_pull_request: close_source_branch')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(PR))
    const result = await runTool(P, 'create_pull_request', {
      input: {
        workspace: 'acme',
        repo_slug: 'webmcp-packages',
        title: 'Add bitbucket package',
        source_branch: 'feat/bitbucket-port',
        destination_branch: 'main',
        description: 'Full port',
        close_source_branch: true,
        reviewers: ['{rev-1}', '{rev-2}'],
      },
      page,
    })
    equal(result.status, 'ok', 'bitbucket create_pull_request: status')
    equal(requests[0].init.method, 'POST', 'bitbucket create_pull_request: POST')
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket create_pull_request: CSRF header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.title, 'Add bitbucket package', 'bitbucket create_pull_request: title')
    equal(body.source.branch.name, 'feat/bitbucket-port', 'bitbucket create_pull_request: source branch')
    equal(body.destination.branch.name, 'main', 'bitbucket create_pull_request: destination branch')
    equal(body.description, 'Full port', 'bitbucket create_pull_request: description')
    equal(body.close_source_branch, true, 'bitbucket create_pull_request: close source branch')
    equal(body.reviewers.length, 2, 'bitbucket create_pull_request: two reviewers')
    equal(body.reviewers[0].uuid, '{rev-1}', 'bitbucket create_pull_request: reviewer uuid shape')
    equal(result.data.id, 42, 'bitbucket create_pull_request: parsed id')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(PR))
    const result = await runTool(P, 'create_pull_request', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', title: 'Minimal', source_branch: 'fix/x' },
      page,
    })
    const body = JSON.parse(requests[0].init.body)
    equal(result.status, 'ok', 'bitbucket create_pull_request minimal: status')
    equal('destination' in body, false, 'bitbucket create_pull_request minimal: no destination')
    equal('reviewers' in body, false, 'bitbucket create_pull_request minimal: no reviewers')
    equal(body.title, 'Minimal', 'bitbucket create_pull_request minimal: title')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...PR, title: 'Renamed' }))
    const result = await runTool(P, 'update_pull_request', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42, title: 'Renamed' },
      page,
    })
    equal(requests[0].init.method, 'PUT', 'bitbucket update_pull_request: PUT')
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42`,
      'bitbucket update_pull_request: endpoint',
    )
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket update_pull_request: CSRF header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.title, 'Renamed', 'bitbucket update_pull_request: title')
    equal('description' in body, false, 'bitbucket update_pull_request: untouched fields omitted')
    equal('destination' in body, false, 'bitbucket update_pull_request: no destination rewrite')
    equal(result.data.title, 'Renamed', 'bitbucket update_pull_request: parsed title')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...PR, state: 'MERGED' }))
    const result = await runTool(P, 'merge_pull_request', {
      input: {
        workspace: 'acme',
        repo_slug: 'webmcp-packages',
        pull_request_id: 42,
        merge_strategy: 'squash',
        message: 'ship it',
      },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/merge`,
      'bitbucket merge_pull_request: endpoint',
    )
    equal(requests[0].init.method, 'POST', 'bitbucket merge_pull_request: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.merge_strategy, 'squash', 'bitbucket merge_pull_request: strategy')
    equal(body.message, 'ship it', 'bitbucket merge_pull_request: message')
    equal('close_source_branch' in body, false, 'bitbucket merge_pull_request: omitted close_source_branch')
    equal(result.data.state, 'MERGED', 'bitbucket merge_pull_request: parsed state')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...PR, state: 'DECLINED' }))
    const result = await runTool(P, 'decline_pull_request', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/decline`,
      'bitbucket decline_pull_request: endpoint',
    )
    equal(requests[0].init.method, 'POST', 'bitbucket decline_pull_request: POST')
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket decline_pull_request: CSRF header')
    equal(result.data.state, 'DECLINED', 'bitbucket decline_pull_request: parsed state')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ approved: true }))
    const result = await runTool(P, 'approve_pull_request', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/approve`,
      'bitbucket approve_pull_request: endpoint',
    )
    equal(requests[0].init.method, 'POST', 'bitbucket approve_pull_request: POST')
    equal(result.data.approved, true, 'bitbucket approve_pull_request: approved')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ values: [COMMENT] }))
    const result = await runTool(P, 'list_pr_comments', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42, pagelen: 10 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/comments?pagelen=10`,
      'bitbucket list_pr_comments: endpoint',
    )
    equal(result.data.comments.length, 1, 'bitbucket list_pr_comments: one comment')
    equal(result.data.comments[0].content, '**LGTM**', 'bitbucket list_pr_comments: content')
    equal(result.data.comments[0].author, 'Grace Hopper', 'bitbucket list_pr_comments: author')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(COMMENT))
    const result = await runTool(P, 'create_pr_comment', {
      input: {
        workspace: 'acme',
        repo_slug: 'webmcp-packages',
        pull_request_id: 42,
        content: '**LGTM**',
      },
      page,
    })
    equal(requests[0].init.method, 'POST', 'bitbucket create_pr_comment: POST')
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/comments`,
      'bitbucket create_pr_comment: endpoint',
    )
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket create_pr_comment: CSRF header')
    equal(JSON.parse(requests[0].init.body).content.raw, '**LGTM**', 'bitbucket create_pr_comment: raw markdown body')
    equal(result.data.id, 9001, 'bitbucket create_pr_comment: parsed id')
  }

  {
    const diff = 'diff --git a/a.txt b/a.txt\n+hello\n'
    const { page, requests } = pageWith(() => textResponse(diff))
    const result = await runTool(P, 'get_pull_request_diff', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pull_request_id: 42 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pullrequests/42/diff`,
      'bitbucket get_pull_request_diff: endpoint',
    )
    equal(result.data.diff, diff, 'bitbucket get_pull_request_diff: raw diff text')
  }

  // --- branches, tags, commits -------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            name: 'main',
            target: {
              hash: 'abc123def',
              date: '2024-06-01T00:00:00Z',
              message: 'Merge pull request #11\n',
              author: { raw: 'Ada <ada@example.com>' },
            },
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_branches', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', query: 'name ~ "ma"' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/refs/branches?q=name+%7E+%22ma%22`,
      'bitbucket list_branches: endpoint + q filter',
    )
    equal(result.data.branches[0].name, 'main', 'bitbucket list_branches: name')
    equal(result.data.branches[0].target_hash, 'abc123def', 'bitbucket list_branches: target hash')
    equal(result.data.branches[0].target_message, 'Merge pull request #11', 'bitbucket list_branches: trimmed message')
    equal(result.data.branches[0].target_author, 'Ada <ada@example.com>', 'bitbucket list_branches: author raw')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ name: 'feat/new', target: { hash: 'abc123def', date: '2024-06-01T00:00:00Z', message: 'seed' } }),
    )
    const result = await runTool(P, 'create_branch', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', name: 'feat/new', target_hash: 'abc123def' },
      page,
    })
    equal(requests[0].init.method, 'POST', 'bitbucket create_branch: POST')
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/refs/branches`,
      'bitbucket create_branch: endpoint',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(body.name, 'feat/new', 'bitbucket create_branch: name')
    equal(body.target.hash, 'abc123def', 'bitbucket create_branch: target hash')
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket create_branch: CSRF header')
    equal(result.data.name, 'feat/new', 'bitbucket create_branch: parsed name')
  }

  {
    const { page, requests } = pageWith(() => noContentResponse())
    const result = await runTool(P, 'delete_branch', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', name: 'feat/new' },
      page,
    })
    equal(requests[0].init.method, 'DELETE', 'bitbucket delete_branch: DELETE')
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/refs/branches/feat/new`,
      'bitbucket delete_branch: endpoint',
    )
    equal(requests[0].init.headers['X-CSRFToken'], CSRF, 'bitbucket delete_branch: CSRF header')
    equal(result.status, 'ok', 'bitbucket delete_branch: 204 is a success')
    equal(result.data.deleted, true, 'bitbucket delete_branch: deleted flag')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            name: 'v1.0.0',
            target: { hash: 'def456', date: '2024-06-02T00:00:00Z' },
            message: 'release 1.0.0\n',
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_tags', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/refs/tags`,
      'bitbucket list_tags: endpoint',
    )
    equal(result.data.tags[0].name, 'v1.0.0', 'bitbucket list_tags: name')
    equal(result.data.tags[0].target_hash, 'def456', 'bitbucket list_tags: target hash')
    equal(result.data.tags[0].message, 'release 1.0.0', 'bitbucket list_tags: trimmed message')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            hash: 'abc123def456',
            message: 'Add bitbucket package\n\nBody line\n',
            author: { raw: 'Ada <ada@example.com>' },
            date: '2024-06-05T00:00:00Z',
            links: { html: { href: 'https://bitbucket.org/acme/webmcp-packages/commits/abc123def456' } },
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_commits', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', branch: 'main' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/commits?include=main`,
      'bitbucket list_commits: include filter',
    )
    equal(result.data.commits[0].hash, 'abc123def456', 'bitbucket list_commits: hash')
    equal(
      result.data.commits[0].message,
      'Add bitbucket package\n\nBody line',
      'bitbucket list_commits: message preserved minus trailing newline',
    )
    equal(result.data.commits[0].author_raw, 'Ada <ada@example.com>', 'bitbucket list_commits: author')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        hash: 'abc123def456',
        message: 'Add bitbucket package',
        author: { raw: 'Ada <ada@example.com>' },
        date: '2024-06-05T00:00:00Z',
        links: { html: { href: 'https://bitbucket.org/acme/webmcp-packages/commits/abc123def456' } },
      }),
    )
    const result = await runTool(P, 'get_commit', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', commit_hash: 'abc123def456' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/commit/abc123def456`,
      'bitbucket get_commit: endpoint',
    )
    equal(result.data.hash, 'abc123def456', 'bitbucket get_commit: hash')
    equal(
      result.data.web_url,
      'https://bitbucket.org/acme/webmcp-packages/commits/abc123def456',
      'bitbucket get_commit: web url',
    )
  }

  // --- pipelines ----------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({ values: [PIPELINE] }))
    const result = await runTool(P, 'list_pipelines', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', sort: '-created_on' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pipelines/?sort=-created_on`,
      'bitbucket list_pipelines: endpoint keeps the trailing slash',
    )
    equal(result.data.pipelines[0].build_number, 17, 'bitbucket list_pipelines: build number')
    equal(result.data.pipelines[0].state_name, 'COMPLETED', 'bitbucket list_pipelines: state')
    equal(result.data.pipelines[0].result_name, 'SUCCESSFUL', 'bitbucket list_pipelines: result')
    equal(result.data.pipelines[0].target_branch, 'main', 'bitbucket list_pipelines: target branch')
    equal(result.data.pipelines[0].duration_seconds, 93, 'bitbucket list_pipelines: duration')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(PIPELINE))
    const result = await runTool(P, 'get_pipeline', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pipeline_uuid: '{pipeline-uuid}' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pipelines/{pipeline-uuid}`,
      'bitbucket get_pipeline: endpoint',
    )
    equal(result.data.creator, 'Ada Lovelace', 'bitbucket get_pipeline: creator')
    equal(result.data.completed_on, '2024-06-04T00:01:33Z', 'bitbucket get_pipeline: completed_on')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            uuid: '{step-uuid}',
            name: 'Build',
            state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } },
            duration_in_seconds: 40,
            started_on: '2024-06-04T00:00:00Z',
            completed_on: '2024-06-04T00:00:40Z',
          },
          {
            uuid: '{step-2}',
            name: 'Deploy',
            state: { name: 'IN_PROGRESS' },
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_pipeline_steps', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', pipeline_uuid: '{pipeline-uuid}' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/pipelines/{pipeline-uuid}/steps/`,
      'bitbucket list_pipeline_steps: endpoint keeps the trailing slash',
    )
    equal(result.data.steps.length, 2, 'bitbucket list_pipeline_steps: two steps')
    equal(result.data.steps[0].name, 'Build', 'bitbucket list_pipeline_steps: step name')
    equal(result.data.steps[0].duration_seconds, 40, 'bitbucket list_pipeline_steps: duration')
    equal(result.data.steps[1].state_name, 'IN_PROGRESS', 'bitbucket list_pipeline_steps: in progress step')
    equal(result.data.steps[1].result_name, '', 'bitbucket list_pipeline_steps: empty result while running')
    equal(result.data.steps[1].duration_seconds, 0, 'bitbucket list_pipeline_steps: zero duration while running')
  }

  // --- source -------------------------------------------------------------
  {
    const { page, requests } = pageWith(() => textResponse('# WebMCP packages\n'))
    const result = await runTool(P, 'get_file_content', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', path: 'README.md' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/src/HEAD/README.md`,
      'bitbucket get_file_content: default ref is HEAD',
    )
    equal(result.data.content, '# WebMCP packages\n', 'bitbucket get_file_content: raw content')
    equal(result.data.path, 'README.md', 'bitbucket get_file_content: path echoed')
  }

  {
    const { page, requests } = pageWith(() => textResponse('module.exports = {}\n'))
    const result = await runTool(P, 'get_file_content', {
      input: { workspace: 'acme', repo_slug: 'webmcp-packages', path: 'index.js', ref: 'main' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/repositories/acme/webmcp-packages/src/main/index.js`,
      'bitbucket get_file_content: explicit ref',
    )
    equal(result.data.content, 'module.exports = {}\n', 'bitbucket get_file_content: content at ref')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            file: {
              path: 'packages/com.jira.main/manifest.json',
              links: {
                self: {
                  href:
                    'https://api.bitbucket.org/2.0/repositories/acme/webmcp-packages/src/abc123/packages/com.jira.main/manifest.json',
                },
              },
            },
            content_matches: [
              {
                lines: [
                  {
                    segments: [
                      { text: '"id": ' },
                      { text: '"com.jira.main"', match: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    const result = await runTool(P, 'search_code', {
      input: { workspace: 'acme', search_query: 'com.jira.main', pagelen: 5 },
      page,
    })
    equal(
      requests[0].url,
      `${API}/workspaces/acme/search/code?search_query=com.jira.main&pagelen=5`,
      'bitbucket search_code: endpoint',
    )
    equal(result.data.results.length, 1, 'bitbucket search_code: one hit')
    equal(
      result.data.results[0].file,
      'packages/com.jira.main/manifest.json',
      'bitbucket search_code: file path',
    )
    equal(result.data.results[0].repo, 'webmcp-packages', 'bitbucket search_code: repo slug from self href')
    equal(
      result.data.results[0].content_matches[0].lines,
      '"id": "com.jira.main"',
      'bitbucket search_code: matched lines joined from segments',
    )
  }

  // --- workspaces ---------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ values: [{ uuid: '{ws-uuid}', slug: 'acme', name: 'Acme Inc', type: 'workspace' }] }),
    )
    const result = await runTool(P, 'list_workspaces', { input: { pagelen: 100 }, page })
    equal(requests[0].url, `${API}/workspaces?pagelen=100`, 'bitbucket list_workspaces: endpoint')
    equal(result.data.workspaces[0].slug, 'acme', 'bitbucket list_workspaces: slug')
    equal(result.data.workspaces[0].name, 'Acme Inc', 'bitbucket list_workspaces: name')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        values: [
          {
            user: { display_name: 'Grace Hopper', uuid: '{member-uuid}', type: 'user' },
            permission: 'owner',
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_workspace_members', {
      input: { workspace: 'acme' },
      page,
    })
    equal(
      requests[0].url,
      `${API}/workspaces/acme/members`,
      'bitbucket list_workspace_members: endpoint',
    )
    equal(result.data.members[0].display_name, 'Grace Hopper', 'bitbucket list_workspace_members: display name')
    equal(result.data.members[0].permission, 'owner', 'bitbucket list_workspace_members: permission')
    equal(result.data.members[0].uuid, '{member-uuid}', 'bitbucket list_workspace_members: uuid')
  }

  // --- error classification ----------------------------------------------
  for (const [status, code, tool] of [
    [401, 'AUTH', ['list_repositories', { workspace: 'acme' }]],
    [403, 'AUTH', ['get_repository', { workspace: 'acme', repo_slug: 'repo' }]],
    [404, 'NOT_FOUND', ['get_pull_request', { workspace: 'acme', repo_slug: 'repo', pull_request_id: 1 }]],
    [400, 'VALIDATION', ['create_pull_request', { workspace: 'acme', repo_slug: 'repo', title: 't', source_branch: 's' }]],
    [429, 'RATE_LIMITED', ['list_commits', { workspace: 'acme', repo_slug: 'repo' }]],
    [500, 'HTTP', ['list_tags', { workspace: 'acme', repo_slug: 'repo' }]],
  ]) {
    const { page } = pageWith(() => jsonResponse({ type: 'error', error: { message: 'boom' } }, status))
    const result = await runTool(P, tool[0], { input: tool[1], page })
    equal(result.status, 'error', `bitbucket ${tool[0]} @${status}: error status`)
    equal(result.error_code, code, `bitbucket ${tool[0]} @${status}: error code`)
    equal(result.data, null, `bitbucket ${tool[0]} @${status}: no data`)
    ok(String(result.message).includes('boom'), `bitbucket ${tool[0]} @${status}: upstream message surfaced`)
  }

  // --- off-site page ------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({}), {
      overrides: { hostname: 'example.com', origin: 'https://example.com' },
    })
    const result = await runTool(P, 'list_workspaces', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'bitbucket list_workspaces: refuses a non-bitbucket.org page')
    equal(requests.length, 0, 'bitbucket list_workspaces: no request off-site')
  }

  // --- urlRegex -----------------------------------------------------------
  section('execution: com.bitbucket.main urlRegex matches bitbucket.org only')

  {
    const manifest = JSON.parse(
      readFileSync(path.join(packagesDir, P, 'manifest.json'), 'utf8'),
    )
    const matches = (regex, href) => {
      const match = href.match(new RegExp(regex))
      return Boolean(match) && match.index === 0 && match[0].length === href.length
    }
    const tool = manifest.tools[0]
    for (const href of [
      'https://bitbucket.org/',
      'https://bitbucket.org/acme/webmcp-packages',
      'https://bitbucket.org/acme/webmcp-packages/src/main/README.md',
      'https://bitbucket.org/acme/webmcp-packages/pull-requests/42?state=OPEN',
      'https://bitbucket.org/acme/webmcp-packages/commits/abc#diff',
      'http://bitbucket.org/acme',
      'https://www.bitbucket.org/acme/webmcp-packages',
    ]) {
      ok(matches(tool.urlRegex, href), `bitbucket urlRegex matches ${href}`)
    }
    for (const href of [
      'https://api.bitbucket.org/2.0/repositories/acme',
      'https://acme.bitbucket.org/acme',
      'https://support.bitbucket.org/',
      'https://bitbucketXorg.example.com/acme',
      'https://example.com/bitbucket.org/acme',
      'https://notbitbucket.org/acme',
    ]) {
      equal(matches(tool.urlRegex, href), false, `bitbucket urlRegex rejects ${href}`)
    }
  }
}
