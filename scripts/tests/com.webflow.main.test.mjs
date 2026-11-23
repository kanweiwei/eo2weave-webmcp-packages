/**
 * com.webflow.main — execution tests against a stubbed Webflow dashboard tab.
 *
 * Identity is the `_csrf` meta tag; the internal API is same-origin at /api/
 * with HttpOnly session cookies sent automatically. Mutations carry the CSRF
 * token in the `X-CSRF-Token` header. Webflow's plugin is read-only (only
 * get_/list_ tools), so the write-path check asserts the header contract via
 * the request envelope of a read instead.
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

function webflowPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'webflow.com',
    href: 'https://webflow.com/dashboard',
    meta: { _csrf: 'csrf-token-1' },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.webflow.main: identity')

  {
    const { requests, page } = webflowPage(() => jsonResponse({}), {
      meta: {},
    })
    const result = await runTool('com.webflow.main', 'list_workspaces', { input: {}, page })
    equal(result.status, 'error', 'webflow signed out: error status')
    equal(result.error_code, 'AUTH', 'webflow signed out: AUTH')
    equal(requests.length, 0, 'webflow signed out: makes no request')
  }

  section('com.webflow.main: reads')

  {
    const { requests, page } = webflowPage(() =>
      jsonResponse({
        sites: [
          {
            _id: 's1',
            name: 'Marketing',
            shortName: 'marketing',
            archived: false,
            createdOn: '2026-01-01',
            lastUpdated: '2026-01-02',
            lastPublished: '2026-01-03',
            previewUrl: 'https://preview.webflow.com/marketing',
            workspace: 'w1',
          },
        ],
        paginationMetadata: { totalCount: 1, totalPages: 1, page: 1 },
      }),
    )
    const result = await runTool('com.webflow.main', 'list_sites', {
      input: { workspace_slug: 'acme' },
      page,
    })
    if (result.status !== 'ok') console.log('WEBFLOW SITES', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'webflow list_sites: ok')
    equal(result.data.sites.length, 1, 'webflow list_sites: one site')
    equal(result.data.sites[0].id, 's1', 'webflow list_sites: _id → id')
    equal(result.data.sites[0].short_name, 'marketing', 'webflow list_sites: shortName → short_name')
    equal(result.data.total_count, 1, 'webflow list_sites: totalCount mapped')
    equal(requests.length, 1, 'webflow list_sites: one request')
    ok(
      requests[0].url.startsWith('/api/workspaces/acme/sites'),
      'webflow: same-origin /api workspace-scoped path',
    )
  }

  {
    const { page } = webflowPage(() =>
      jsonResponse({
        _id: 'u1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'L',
        username: 'adal',
        verified: true,
        createdOn: '2025-06-01',
        plan: 'site-plan',
        twoFactorEnabled: false,
      }),
    )
    const result = await runTool('com.webflow.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('WEBFLOW USER', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'webflow get_current_user: ok')
    equal(result.data.user.id, 'u1', 'webflow get_current_user: id mapped')
    equal(result.data.user.first_name, 'Ada', 'webflow get_current_user: firstName → first_name')
    equal(result.data.user.plan, 'site-plan', 'webflow get_current_user: plan mapped')
  }

  section('com.webflow.main: request envelope')

  {
    const { requests, page } = webflowPage(() => jsonResponse({ _id: 'w1', name: 'Acme', slug: 'acme' }))
    await runTool('com.webflow.main', 'get_workspace', { input: { workspace_slug: 'acme' }, page })
    equal(requests[0].init.method, 'GET', 'webflow read: GET (reads carry no CSRF header)')
    ok(
      requests[0].init.headers === undefined || requests[0].init.headers['X-CSRF-Token'] === undefined,
      'webflow read: no X-CSRF-Token on reads',
    )
  }

  section('com.webflow.main: failures')

  {
    const { page } = webflowPage(() => jsonResponse({ code: 401, msg: 'nope' }, 401))
    const result = await runTool('com.webflow.main', 'list_workspaces', { input: {}, page })
    equal(result.status, 'error', 'webflow 401: error status')
    equal(result.error_code, 'AUTH', 'webflow 401: AUTH')
  }

  section('com.webflow.main: wrong page')

  {
    const { page } = webflowPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.webflow.main', 'list_workspaces', { input: {}, page })
    equal(result.status, 'error', 'webflow wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'webflow wrong host: UNSUPPORTED_PAGE')
  }
}
