/**
 * com.shortcut.main — execution tests against a stubbed Shortcut tab.
 *
 * Identity is bootstrapped from the workspace slug in the URL
 * (app.shortcut.com/<slug>) through the /backend/api/private/user/slug-info/
 * endpoint; subsequent v3 API calls carry Tenant-Organization2 /
 * Tenant-Workspace2 headers derived from that bootstrap.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

function shortcutPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'app.shortcut.com',
    href: 'https://app.shortcut.com/acme/stories',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.shortcut.main: identity')

  {
    const { requests, page } = shortcutPage(() => jsonResponse({}), {
      href: 'https://app.shortcut.com/',
    })
    const result = await runTool('com.shortcut.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'error', 'shortcut no workspace slug: error status')
    equal(result.error_code, 'AUTH', 'shortcut no workspace slug: AUTH')
    ok(
      requests.every((r) => !r.url.includes('/api/v3/')),
      'shortcut no workspace slug: no v3 API calls',
    )
  }

  section('com.shortcut.main: reads')

  {
    const { requests, page } = shortcutPage((url) => {
      if (String(url).includes('/slug-info/')) {
        return jsonResponse({ id: 'ws-1', organization2: { id: 'org-1' } })
      }
      return jsonResponse({
        data: [
          {
            id: 101,
            name: 'Ship port',
            app_url: 'https://app.shortcut.com/acme/story/101',
            story_type: 'feature',
            description: '',
            archived: false,
            started: true,
            completed: false,
            blocker: false,
            blocked: false,
            workflow_state_id: 5,
            workflow_id: 2,
            epic_id: null,
            iteration_id: null,
            group_id: 'g1',
            estimate: 3,
            deadline: '',
            owner_ids: ['m1'],
            label_ids: [9],
            requested_by_id: 'm1',
            project_id: 42,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          },
        ],
        total: 1,
        next: '',
      })
    })
    const result = await runTool('com.shortcut.main', 'search_stories', {
      input: { query: 'is:started' },
      page,
    })
    if (result.status !== 'ok') console.log('SHORTCUT SEARCH', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'shortcut search_stories: ok')
    equal(result.data.data.length, 1, 'shortcut search_stories: one story')
    equal(result.data.data[0].id, 101, 'shortcut search_stories: id mapped')
    equal(result.data.data[0].story_type, 'feature', 'shortcut search_stories: type mapped')
    equal(result.data.total, 1, 'shortcut search_stories: total mapped')
    ok(
      requests[0].url.includes('/backend/api/private/user/slug-info/acme'),
      'shortcut: slug-info bootstrap from URL slug',
    )
    const apiRequest = requests[requests.length - 1]
    ok(apiRequest.url.includes('/backend/api/v3/search/stories'), 'shortcut: v3 search path')
    equal(apiRequest.init.headers['Tenant-Organization2'], 'org-1', 'shortcut: Tenant-Organization2 header')
    equal(apiRequest.init.headers['Tenant-Workspace2'], 'ws-1', 'shortcut: Tenant-Workspace2 header')
  }

  {
    const { page } = shortcutPage((url) => {
      if (String(url).includes('/slug-info/')) {
        return jsonResponse({ id: 'ws-1', organization2: { id: 'org-1' } })
      }
      return jsonResponse({
        id: 'm-1',
        name: 'Ada',
        mention_name: 'ada',
        role: 'owner',
        workspace2: { name: 'Acme', url_slug: 'acme' },
      })
    })
    const result = await runTool('com.shortcut.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('SHORTCUT USER', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'shortcut get_current_user: ok')
    equal(result.data.id, 'm-1', 'shortcut get_current_user: id mapped')
    equal(result.data.workspace_slug, 'acme', 'shortcut get_current_user: workspace2.url_slug mapped')
  }

  section('com.shortcut.main: writes')

  {
    const { requests, page } = shortcutPage((url, init) => {
      if (String(url).includes('/slug-info/')) {
        return jsonResponse({ id: 'ws-1', organization2: { id: 'org-1' } })
      }
      return jsonResponse({ id: 202, name: init.body ? JSON.parse(init.body).name : '', app_url: 'u' })
    })
    const result = await runTool('com.shortcut.main', 'create_story', {
      input: { name: 'New story', story_type: 'bug' },
      page,
    })
    if (result.status !== 'ok') console.log('SHORTCUT CREATE', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'shortcut create_story: ok')
    equal(result.data.story.name, 'New story', 'shortcut create_story: name mapped')
    const apiRequest = requests[requests.length - 1]
    equal(apiRequest.init.method, 'POST', 'shortcut create_story: POST')
    ok(apiRequest.url.includes('/backend/api/v3/stories'), 'shortcut create_story: /stories path')
    const body = JSON.parse(apiRequest.init.body)
    equal(body.name, 'New story', 'shortcut create_story: name body')
    equal(body.story_type, 'bug', 'shortcut create_story: story_type body')
  }

  section('com.shortcut.main: failures')

  {
    const { page } = shortcutPage((url) => {
      if (String(url).includes('/slug-info/')) {
        return jsonResponse({ id: 'ws-1', organization2: { id: 'org-1' } })
      }
      return jsonResponse({ error: 'forbidden' }, 403)
    })
    const result = await runTool('com.shortcut.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'error', 'shortcut 403: error status')
    equal(result.error_code, 'AUTH', 'shortcut 403: AUTH')
  }

  section('com.shortcut.main: wrong page')

  {
    const { page } = shortcutPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.shortcut.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'error', 'shortcut wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'shortcut wrong host: UNSUPPORTED_PAGE')
  }
}
