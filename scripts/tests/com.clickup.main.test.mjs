// Execution tests for com.clickup.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime reads ClickUp's session JWT from the page (captured off
// its own WebSocket auth frame) and its apiUrlBase from the page's cuHandshake
// localStorage entry, so every fixture supplies both and every assertion
// checks the exact request plus the parsed output.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const API_BASE = 'https://app.clickup.com/api/v2'
const HANDLE = 'https://app.clickup.com/9017/v/li/901'

function handshake(workspaceId = '9017', apiUrlBase = API_BASE) {
  return JSON.stringify({
    [workspaceId]: {
      appEnvironment: {
        apiUrlBase,
        websocketUrl: 'wss://app.clickup.com/ws',
      },
      shardId: 'shard-1',
      workspaceId,
    },
  })
}

/** A stubbed app.clickup.com page carrying the captured session JWT. */
function pageWith(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'app.clickup.com',
      origin: 'https://app.clickup.com',
      href: HANDLE,
      globals: {
        __cu_captured_jwt: 'jwt-abc123',
        __cu_captured_team_id: '9017',
      },
      localStorage: { cuHandshake: handshake() },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

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

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  const P = 'com.clickup.main'

  section('execution: ClickUp reads against a stubbed app.clickup.com page')

  // --- user ---------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        id: 1234,
        username: 'Ada Lovelace',
        email: 'ada@example.com',
        color: '#7B68EE',
        initials: 'AL',
        profilePicture: null,
        timezone: 'Europe/London',
      }),
    )
    const result = await runTool(P, 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_current_user: status')
    equal(requests.length, 1, 'clickup get_current_user: one request')
    equal(requests[0].url, `${API_BASE}/user/v1/user/me`, 'clickup get_current_user: endpoint')
    equal(requests[0].init.method, 'GET', 'clickup get_current_user: GET')
    equal(
      requests[0].init.headers.Authorization,
      'Bearer jwt-abc123',
      'clickup get_current_user: session JWT in Authorization',
    )
    equal(
      requests[0].init.credentials,
      'include',
      'clickup get_current_user: sends credentials',
    )
    equal(result.data.user.username, 'Ada Lovelace', 'clickup get_current_user: username')
    equal(result.data.user.timezone, 'Europe/London', 'clickup get_current_user: timezone')
  }

  // --- workspaces ---------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        id: '9017',
        name: 'Acme',
        color: '#49CFFF',
        plan_id: '13',
        billed_users_this_cycle: 7,
        date_created: '1700000000000',
        owner: {
          id: 1234,
          username: 'Ada Lovelace',
          email: 'ada@example.com',
          color: '#7B68EE',
          initials: 'AL',
          profilePicture: 'https://img/ada.png',
        },
      }),
    )
    const result = await runTool(P, 'get_workspace', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_workspace: status')
    equal(requests[0].url, `${API_BASE}/team/v1/team/9017`, 'clickup get_workspace: default workspace id')
    equal(result.data.workspace.name, 'Acme', 'clickup get_workspace: name')
    equal(result.data.workspace.member_count, 7, 'clickup get_workspace: billed_users_this_cycle')
    equal(result.data.workspace.owner.username, 'Ada Lovelace', 'clickup get_workspace: owner')
    equal(
      result.data.workspace.owner.profile_picture,
      'https://img/ada.png',
      'clickup get_workspace: owner avatar',
    )
    equal(
      'timezone' in result.data.workspace.owner,
      false,
      'clickup get_workspace: owner omits timezone (upstream schema)',
    )
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ id: '555', name: 'Other' }))
    await runTool(P, 'get_workspace', { input: { workspace_id: '555' }, page })
    equal(
      requests[0].url,
      `${API_BASE}/team/v1/team/555`,
      'clickup get_workspace: explicit workspace_id wins over the page default',
    )
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        members: [
          {
            user: {
              id: 1234,
              username: 'Ada Lovelace',
              email: 'ada@example.com',
              color: '#7B68EE',
              initials: 'AL',
              profilePicture: null,
            },
            role: 1,
          },
        ],
      }),
    )
    const result = await runTool(P, 'get_workspace_members', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_workspace_members: status')
    equal(requests[0].url, `${API_BASE}/v1/team/9017/member`, 'clickup get_workspace_members: endpoint')
    equal(result.data.members[0].role, 1, 'clickup get_workspace_members: role')
    equal(result.data.members[0].profile_picture, null, 'clickup get_workspace_members: null avatar')
  }

  // --- spaces -------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse([
        {
          id: 'SP1',
          name: 'Engineering',
          color: '#00BCD4',
          private: false,
          archived: false,
          date_created: '1690000000000',
          multiple_assignees: true,
        },
      ]),
    )
    const result = await runTool(P, 'get_spaces', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_spaces: status')
    equal(
      requests[0].url,
      `${API_BASE}/hierarchy/v1/project?team=9017&include_archived=false`,
      'clickup get_spaces: endpoint + workspace + default archived filter',
    )
    equal(result.data.spaces.length, 1, 'clickup get_spaces: one space')
    equal(result.data.spaces[0].multiple_assignees, true, 'clickup get_spaces: multiple_assignees')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse([]))
    await runTool(P, 'get_spaces', { input: { include_archived: true }, page })
    equal(
      requests[0].url,
      `${API_BASE}/hierarchy/v1/project?team=9017&include_archived=true`,
      'clickup get_spaces: include_archived=true is passed through',
    )
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ id: 'SP1', name: 'Engineering', private: true, archived: false }),
    )
    const result = await runTool(P, 'get_space', { input: { space_id: 'SP1' }, page })
    equal(result.status, 'ok', 'clickup get_space: status')
    equal(requests[0].url, `${API_BASE}/hierarchy/v1/project/SP1`, 'clickup get_space: endpoint')
    equal(result.data.space.private, true, 'clickup get_space: private')
  }

  // --- folders ------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        categories: [
          {
            id: 'F1',
            name: 'Sprint 42',
            orderindex: 3,
            archived: false,
            hidden: false,
            project_id: 'SP1',
            date_updated: '1695000000000',
          },
        ],
      }),
    )
    const result = await runTool(P, 'get_folders', { input: { space_id: 'SP1' }, page })
    equal(result.status, 'ok', 'clickup get_folders: status')
    equal(
      requests[0].url,
      `${API_BASE}/hierarchy/v1/project/SP1/category?include_archived=false`,
      'clickup get_folders: endpoint + default archived filter',
    )
    equal(result.data.folders[0].space_id, 'SP1', 'clickup get_folders: space_id from project_id')
    equal(result.data.folders[0].orderindex, 3, 'clickup get_folders: orderindex')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({}))
    await runTool(P, 'get_folders', { input: { space_id: 'SP1', include_archived: true }, page })
    equal(
      requests[0].url,
      `${API_BASE}/hierarchy/v1/project/SP1/category?include_archived=true`,
      'clickup get_folders: include_archived=true is passed through',
    )
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ id: 'F1', name: 'Sprint 42', archived: true, project_id: 'SP1' }),
    )
    const result = await runTool(P, 'get_folder', { input: { folder_id: 'F1' }, page })
    equal(result.status, 'ok', 'clickup get_folder: status')
    equal(requests[0].url, `${API_BASE}/hierarchy/v1/category/F1`, 'clickup get_folder: endpoint')
    equal(result.data.folder.archived, true, 'clickup get_folder: archived')
  }

  // --- lists --------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        subcategories: [
          {
            id: 'L1',
            name: 'Backlog',
            orderindex: 0,
            archived: false,
            due_date: null,
            start_date: '1690000000000',
            category: { id: 'F1' },
            project: { id: 'SP1' },
            date_updated: '1695000000000',
            task_count: 12,
          },
        ],
      }),
    )
    const result = await runTool(P, 'get_lists', { input: { folder_id: 'F1' }, page })
    equal(result.status, 'ok', 'clickup get_lists: status')
    equal(
      requests[0].url,
      `${API_BASE}/hierarchy/v1/category/F1/subcategory?include_archived=false`,
      'clickup get_lists: endpoint + default archived filter',
    )
    equal(result.data.lists[0].folder_id, 'F1', 'clickup get_lists: folder_id from category.id')
    equal(result.data.lists[0].space_id, 'SP1', 'clickup get_lists: space_id from project.id')
    equal(result.data.lists[0].task_count, 12, 'clickup get_lists: task_count')
    equal(result.data.lists[0].due_date, null, 'clickup get_lists: null due_date')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ id: 'L1', name: 'Backlog', category: { id: 'F1' }, project: { id: 'SP1' } }),
    )
    const result = await runTool(P, 'get_list', { input: { list_id: 'L1' }, page })
    equal(result.status, 'ok', 'clickup get_list: status')
    equal(requests[0].url, `${API_BASE}/hierarchy/v1/subcategory/L1`, 'clickup get_list: endpoint')
    equal(result.data.list.name, 'Backlog', 'clickup get_list: name')
  }

  // --- goals + custom fields ---------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        goals: [
          {
            id: 'G1',
            name: 'Ship v1',
            description: 'Launch',
            color: '#FFC800',
            date_created: '1690000000000',
            due_date: null,
            percent_completed: 42,
            creator: 1234,
            folder_id: null,
            multiple_owners: false,
            key_results: [{ id: 'kr1' }, { id: 'kr2' }],
          },
        ],
      }),
    )
    const result = await runTool(P, 'get_goals', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_goals: status')
    equal(requests[0].url, `${API_BASE}/v1/team/9017/goal`, 'clickup get_goals: endpoint')
    equal(result.data.goals[0].owner_id, 1234, 'clickup get_goals: owner_id from creator')
    equal(result.data.goals[0].key_result_count, 2, 'clickup get_goals: key_result_count')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        fields: [{ id: 'cf1', name: 'Story points', type: 'number', required: true }],
      }),
    )
    const result = await runTool(P, 'get_custom_fields', { input: {}, page })
    equal(result.status, 'ok', 'clickup get_custom_fields: status')
    equal(
      requests[0].url,
      `${API_BASE}/customFields/v1/team/9017/fields`,
      'clickup get_custom_fields: endpoint',
    )
    equal(result.data.fields[0].required, true, 'clickup get_custom_fields: required')
  }

  // --- failure paths ------------------------------------------------------
  {
    // No captured JWT: refuse before any request.
    const requests = []
    const page = {
      hostname: 'app.clickup.com',
      origin: 'https://app.clickup.com',
      href: HANDLE,
      localStorage: { cuHandshake: handshake() },
      fetch: async (url) => {
        requests.push(url)
        return jsonResponse({})
      },
    }
    const result = await runTool(P, 'get_workspace', { input: {}, page })
    equal(result.status, 'error', 'clickup no token: error status')
    equal(result.error_code, 'AUTH', 'clickup no token: AUTH')
    equal(requests.length, 0, 'clickup no token: makes no request')
  }

  {
    // Token captured but the page has no cuHandshake entry: no apiUrlBase.
    const requests = []
    const page = {
      hostname: 'app.clickup.com',
      origin: 'https://app.clickup.com',
      href: HANDLE,
      globals: { __cu_captured_jwt: 'jwt-abc123' },
      fetch: async (url) => {
        requests.push(url)
        return jsonResponse({})
      },
    }
    const result = await runTool(P, 'get_current_user', { input: {}, page })
    equal(result.error_code, 'AUTH', 'clickup no handshake: AUTH')
    equal(requests.length, 0, 'clickup no handshake: makes no request')
  }

  {
    const { page, requests } = pageWith(
      () => jsonResponse({ err: 'Token expired', ecode: 'AUTH_001' }, 401),
    )
    const result = await runTool(P, 'get_spaces', { input: {}, page })
    equal(result.status, 'error', 'clickup 401: error status')
    equal(result.error_code, 'AUTH', 'clickup 401: AUTH')
    ok(
      String(result.message).includes('Token expired'),
      'clickup 401: surfaces ClickUp err text',
    )
    equal(requests.length, 1, 'clickup 401: the request was made')
  }

  {
    const { page } = pageWith(() => jsonResponse({ err: 'Not found' }, 404))
    const result = await runTool(P, 'get_list', { input: { list_id: 'nope' }, page })
    equal(result.error_code, 'NOT_FOUND', 'clickup 404: NOT_FOUND')
  }

  {
    // Another ClickUp page (the marketing site) is refused before any request.
    const requests = []
    const page = {
      hostname: 'clickup.com',
      origin: 'https://clickup.com',
      href: 'https://clickup.com/pricing',
      globals: { __cu_captured_jwt: 'jwt-abc123' },
      localStorage: { cuHandshake: handshake() },
      fetch: async (url) => {
        requests.push(url)
        return jsonResponse({})
      },
    }
    const result = await runTool(P, 'get_current_user', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'clickup wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'clickup wrong host: makes no request')
  }

  // --- scope: urlRegex, both ways ----------------------------------------
  section('execution: ClickUp urlRegex scope')

  {
    const pkgDir = path.join(packagesDir, 'com.clickup.main')
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))
    const regexes = manifest.tools.map((tool) => new RegExp(tool.urlRegex))
    const matches = (href) =>
      regexes.some((re) => {
        const m = re.exec(href)
        return m !== null && m.index === 0 && m[0].length === href.length
      })

    ok(matches('https://app.clickup.com/'), 'clickup urlRegex: app root')
    ok(matches('https://app.clickup.com/9017/v/o/li/901'), 'clickup urlRegex: list page')
    ok(
      matches('https://app.clickup.com/9017/v/li/901?p=1#top'),
      'clickup urlRegex: query string and hash',
    )
    ok(matches('http://app.clickup.com/home'), 'clickup urlRegex: http variant')
    ok(!matches('https://app.clickup.com.evil.io/9017'), 'clickup urlRegex: rejects a lookalike host')
    ok(!matches('https://appXclickup.com/9017'), 'clickup urlRegex: rejects unescaped-dot host')
    ok(!matches('https://clickup.com/pricing'), 'clickup urlRegex: rejects the marketing site')
    ok(
      !matches('https://app.clickup.com:8443/9017'),
      'clickup urlRegex: rejects a non-default port',
    )
  }

  // --- scope: upstream really has no task endpoints -----------------------
  //
  // The upstream plugin publishes 11 read tools (see dist/tools.json); it has
  // no task, comment or search tool and therefore no write path. This guard
  // fails if a task-shaped tool is invented here, which the central parity
  // check would report as a set mismatch anyway.
  {
    const manifest = JSON.parse(
      readFileSync(path.join(packagesDir, 'com.clickup.main', 'manifest.json'), 'utf8'),
    )
    const names = manifest.tools.map((tool) => tool.name)
    equal(names.length, 11, 'clickup scope: 11 upstream tools')
    equal(
      names.some((name) => /task|comment|search|create|update|delete/.test(name)),
      false,
      'clickup scope: no invented task/comment/search/write tool',
    )
  }
}
