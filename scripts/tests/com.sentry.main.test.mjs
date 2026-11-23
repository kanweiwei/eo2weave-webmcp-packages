/**
 * com.sentry.main — execution tests against a stubbed Sentry tab.
 *
 * Identity is `window.__initialData.isAuthenticated` (or the `sentry-sc` CSRF
 * cookie) plus the org slug taken from the `<org>.sentry.io` subdomain — exactly
 * what the ported API layer reads. A page without both must reject before any
 * request is attempted. Sentry calls `AbortSignal.timeout(30_000)`, which the
 * harness sandbox does not define, so the tests supply a stub through
 * `page.globals` (the same seam the skill prescribes for sandbox gaps).
 */

function jsonResponse(payload, status = 200, headers = {}) {
  const lower = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

function sentryPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'acme.sentry.io',
    href: 'https://acme.sentry.io/issues/?query=is:unresolved',
    cookie: 'sentry-sc=csrf-token-123',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.globals = {
    __initialData: { isAuthenticated: true },
    AbortSignal: { timeout: () => undefined },
    ...(extra.globals ?? {}),
  }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.sentry.main: identity')

  {
    const { requests, page } = sentryPage(() => jsonResponse({}), {
      globals: { __initialData: { isAuthenticated: false } },
      cookie: '',
      // login pages are excluded from the subdomain fallback
      href: 'https://acme.sentry.io/auth/login/',
    })
    const result = await runTool('com.sentry.main', 'list_organizations', { input: {}, page })
    equal(result.status, 'error', 'sentry signed out: error status')
    equal(result.error_code, 'AUTH', 'sentry signed out: AUTH')
    equal(requests.length, 0, 'sentry signed out: makes no request')
  }

  section('com.sentry.main: reads')

  {
    const { requests, page } = sentryPage(() =>
      jsonResponse([
        {
          id: '900',
          shortId: 'ACME-1',
          title: 'TypeError: x is not a function',
          culprit: 'app.views.home',
          level: 'error',
          status: 'unresolved',
          count: '42',
          userCount: 7,
          project: { slug: 'frontend', name: 'frontend' },
        },
      ]),
    )
    const result = await runTool('com.sentry.main', 'search_issues', {
      input: { query: 'is:unresolved', limit: 10 },
      page,
    })

    equal(result.status, 'ok', 'sentry search_issues: ok')
    equal(result.data.issues.length, 1, 'sentry search_issues: one issue')
    equal(result.data.issues[0].short_id, 'ACME-1', 'sentry search_issues: shortId maps to short_id')
    equal(result.data.issues[0].user_count, 7, 'sentry search_issues: userCount maps to user_count')
    equal(requests.length, 1, 'sentry search_issues: one request')
    ok(
      requests[0].url.includes('/api/0/organizations/acme/issues/'),
      'sentry search_issues: org slug from subdomain in path',
    )
    ok(requests[0].url.includes('query=is%3Aunresolved'), 'sentry search_issues: query forwarded')
    equal(requests[0].init.credentials, 'include', 'sentry search_issues: cookies sent')
    ok(requests[0].url.startsWith('/api/0/'), 'sentry search_issues: same-origin relative URL')
  }

  {
    const { requests, page } = sentryPage(() =>
      jsonResponse({ id: '42', name: 'acme', slug: 'acme', status: 'active' }),
    )
    const result = await runTool('com.sentry.main', 'get_organization', { input: {}, page })
    equal(result.status, 'ok', 'sentry get_organization: ok')
    equal(result.data.organization.slug, 'acme', 'sentry get_organization: slug')
    equal(requests[0].url, '/api/0/organizations/acme/', 'sentry get_organization: path')
  }

  section('com.sentry.main: writes')

  {
    const { requests, page } = sentryPage(() =>
      jsonResponse({ id: '900', shortId: 'ACME-1', status: 'resolved' }),
    )
    const result = await runTool('com.sentry.main', 'update_issue', {
      input: { issue_id: '900', status: 'resolved' },
      page,
    })

    equal(result.status, 'ok', 'sentry update_issue: ok')
    equal(requests[0].init.method, 'PUT', 'sentry update_issue: PUT')
    equal(
      requests[0].init.headers['X-CSRFToken'],
      'csrf-token-123',
      'sentry update_issue: CSRF header from sentry-sc cookie',
    )
    equal(JSON.parse(requests[0].init.body).status, 'resolved', 'sentry update_issue: body status')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/json',
      'sentry update_issue: JSON content type',
    )
  }

  section('com.sentry.main: failures')

  {
    const { page } = sentryPage(() => jsonResponse({ detail: 'nope' }, 403))
    const result = await runTool('com.sentry.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'sentry 403: error status')
    equal(result.error_code, 'AUTH', 'sentry 403: AUTH')
  }

  {
    const { requests, page } = sentryPage(
      () => jsonResponse({ detail: 'gone' }, 404),
    )
    const result = await runTool('com.sentry.main', 'get_issue', { input: { issue_id: '999' }, page })
    equal(result.status, 'error', 'sentry 404: error status')
    equal(result.error_code, 'NOT_FOUND', 'sentry 404: NOT_FOUND')
    ok(requests[0].url.includes('/issues/999/'), 'sentry get_issue: id in path')
  }
}
