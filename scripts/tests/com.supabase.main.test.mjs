/**
 * com.supabase.main — execution tests against a stubbed Supabase dashboard tab.
 *
 * Identity is localStorage['supabase.dashboard.auth.token'] holding a JSON
 * object with an `access_token` — exactly what the ported API layer reads.
 * The API calls go cross-origin to api.supabase.com with the bearer token;
 * a page without the token must reject before any request is attempted.
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

function supabasePage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'supabase.com',
    href: 'https://supabase.com/dashboard/project/abcdefg',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.localStorage = extra.localStorage ?? {
    'supabase.dashboard.auth.token': JSON.stringify({ access_token: 'sb-token-123' }),
  }
  page.globals = { AbortSignal: { timeout: () => undefined }, DOMException, ...(extra.globals ?? {}) }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.supabase.main: identity')

  {
    const { requests, page } = supabasePage(() => jsonResponse({}), {
      localStorage: {},
    })
    const result = await runTool('com.supabase.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'supabase signed out: error status')
    equal(result.error_code, 'AUTH', 'supabase signed out: AUTH')
    equal(requests.length, 0, 'supabase signed out: makes no request')
  }

  section('com.supabase.main: reads')

  {
    const { requests, page } = supabasePage(() =>
      jsonResponse([
        {
          id: 'p1',
          name: 'Production',
          organization_id: 'org-1',
          region: 'us-east-1',
          status: 'ACTIVE_HEALTHY',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    )
    const result = await runTool('com.supabase.main', 'list_projects', { input: {}, page })
    if (result.status !== 'ok') console.log('SUPABASE PROJECTS', JSON.stringify(result).slice(0, 400))
    equal(result.status, 'ok', 'supabase list_projects: ok')
    equal(result.data.projects.length, 1, 'supabase list_projects: one project')
    equal(result.data.projects[0].id, 'p1', 'supabase list_projects: id mapped')
    equal(result.data.projects[0].status, 'ACTIVE_HEALTHY', 'supabase list_projects: status mapped')
    equal(requests.length, 1, 'supabase list_projects: one request')
    ok(requests[0].url.startsWith('https://api.supabase.com/v1/projects'), 'supabase: api endpoint')
    equal(requests[0].init.headers.Authorization, 'Bearer sb-token-123', 'supabase: bearer token from localStorage')
    equal(requests[0].init.credentials, 'include', 'supabase: cookies sent')
  }

  {
    const { requests, page } = supabasePage(() =>
      jsonResponse({ id: 'org-1', name: 'Acme', slug: 'acme' }),
    )
    const result = await runTool('com.supabase.main', 'get_organization', {
      input: { slug: 'org-1' },
      page,
    })
    equal(result.status, 'ok', 'supabase get_organization: ok')
    equal(result.data.organization.slug, 'acme', 'supabase get_organization: slug mapped')
    ok(requests[0].url.includes('/v1/organizations/org-1'), 'supabase get_organization: path')
  }

  section('com.supabase.main: writes')

  {
    const { requests, page } = supabasePage(() => jsonResponse([]))
    const result = await runTool('com.supabase.main', 'run_query', {
      input: { ref: 'abcdefg', query: 'select 1' },
      page,
    })
    equal(result.status, 'ok', 'supabase run_query: ok')
    equal(requests[0].init.method, 'POST', 'supabase run_query: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'supabase run_query: json content type')
    const body = JSON.parse(requests[0].init.body)
    equal(body.query, 'select 1', 'supabase run_query: query body')
    ok(requests[0].url.includes('/v1/projects/abcdefg/database/query'), 'supabase run_query: path')
  }

  {
    const { requests, page } = supabasePage(() => jsonResponse({}))
    const result = await runTool('com.supabase.main', 'create_secrets', {
      input: { ref: 'abcdefg', secrets: [{ name: 'API_KEY', value: 'v' }] },
      page,
    })
    equal(result.status, 'ok', 'supabase create_secrets: ok')
    equal(requests[0].init.method, 'POST', 'supabase create_secrets: POST')
    ok(requests[0].url.includes('/v1/projects/abcdefg/secrets'), 'supabase create_secrets: path')
  }

  section('com.supabase.main: failures')

  {
    const { page } = supabasePage(() => jsonResponse({ message: 'nope' }, 401))
    const result = await runTool('com.supabase.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'supabase 401: error status')
    equal(result.error_code, 'AUTH', 'supabase 401: AUTH')
  }

  section('com.supabase.main: wrong page')

  {
    const { page } = supabasePage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.supabase.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'supabase wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'supabase wrong host: UNSUPPORTED_PAGE')
  }
}
