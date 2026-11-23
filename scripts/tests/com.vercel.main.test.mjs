/**
 * com.vercel.main — execution tests against a stubbed Vercel dashboard tab.
 *
 * Identity is the `isLoggedIn=1` cookie; the team slug is extracted from the
 * URL path and auto-injected as `slug=` into team-scoped API queries — exactly
 * what the ported API layer does. The API is same-origin at /api/.
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

function vercelPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'vercel.com',
    href: 'https://vercel.com/acme/overview',
    cookie: 'isLoggedIn=1',
    // Vercel's transport calls AbortSignal.timeout / DOMException inside its
    // fetch wrapper — the sandbox only gets them when the page provides them.
    globals: { AbortSignal: globalThis.AbortSignal, DOMException: globalThis.DOMException },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.vercel.main: identity')

  {
    const { requests, page } = vercelPage(() => jsonResponse({}), { cookie: '' })
    const result = await runTool('com.vercel.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'vercel signed out: error status')
    equal(result.error_code, 'AUTH', 'vercel signed out: AUTH')
    equal(requests.length, 0, 'vercel signed out: makes no request')
  }

  section('com.vercel.main: reads')

  {
    const { requests, page } = vercelPage(() =>
      jsonResponse({
        projects: [
          { id: 'p1', name: 'web', framework: 'nextjs', nodeVersion: '20.x', createdAt: 1700000000000 },
        ],
        pagination: { count: 1, next: null },
      }),
    )
    const result = await runTool('com.vercel.main', 'list_projects', { input: {}, page })
    if (result.status !== 'ok') console.log('VERCEL PROJECTS', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'vercel list_projects: ok')
    equal(result.data.projects.length, 1, 'vercel list_projects: one project')
    equal(result.data.projects[0].name, 'web', 'vercel list_projects: name mapped')
    equal(result.data.projects[0].framework, 'nextjs', 'vercel list_projects: framework mapped')
    equal(requests.length, 1, 'vercel list_projects: one request')
    ok(requests[0].url.includes('/api/v9/projects'), 'vercel: same-origin /api path')
    ok(requests[0].url.includes('slug=acme'), 'vercel: team slug auto-injected from URL')
    ok(requests[0].url.includes('limit=20'), 'vercel: default limit')
    equal(requests[0].init.credentials, 'include', 'vercel: cookies sent')
  }

  {
    const { requests, page } = vercelPage(() =>
      jsonResponse({
        deployments: [{ uid: 'dpl-1', name: 'web', url: 'web.vercel.app', state: 'READY', createdAt: 1700000000000 }],
      }),
    )
    const result = await runTool('com.vercel.main', 'list_deployments', {
      input: { project: 'web' },
      page,
    })
    equal(result.status, 'ok', 'vercel list_deployments: ok')
    equal(result.data.deployments[0].uid, 'dpl-1', 'vercel list_deployments: uid mapped')
    ok(requests[0].url.includes('/api/'), 'vercel list_deployments: same-origin path')
  }

  {
    const { page } = vercelPage(() => jsonResponse({ user: { id: 'u1', username: 'ada' } }))
    const result = await runTool('com.vercel.main', 'get_user', { input: {}, page })
    equal(result.status, 'ok', 'vercel get_user: ok')
  }

  section('com.vercel.main: failures')

  {
    const { page } = vercelPage(() => jsonResponse({ error: { message: 'nope' } }, 403))
    const result = await runTool('com.vercel.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'vercel 403: error status')
    equal(result.error_code, 'AUTH', 'vercel 403: AUTH')
  }

  section('com.vercel.main: wrong page')

  {
    const { page } = vercelPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.vercel.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'vercel wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'vercel wrong host: UNSUPPORTED_PAGE')
  }
}
