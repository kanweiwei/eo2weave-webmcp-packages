/**
 * com.clickhouse.main — execution tests against a stubbed ClickHouse Cloud tab.
 *
 * Identity is localStorage['@@auth0spajs@@::…'] holding a JSON object with
 * body.access_token and a future expiresAt — exactly what the ported API layer
 * extracts. API calls go to the control-plane host from
 * `consoleConfig.controlPlane.apiHost` (page global) with the bearer token.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '3' : 'application/json') },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

const AUTH0_KEY =
  '@@auth0spajs@@::IPpH4RND0qNXHVayepffgsGpbXQmFikr::control-plane-web::openid profile email'

function auth0Entry(token = 'ch-token-123', expiresInSec = 3600) {
  return JSON.stringify({ body: { access_token: token }, expiresAt: Math.floor(Date.now() / 1000) + expiresInSec })
}

function clickhousePage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'console.clickhouse.cloud',
    href: 'https://console.clickhouse.cloud/services/org-1/overview',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.localStorage = extra.localStorage ?? {
    [AUTH0_KEY]: auth0Entry(),
    currentOrganizationId: 'org-1',
  }
  page.globals = {
    AbortSignal: { timeout: () => undefined },
    DOMException,
    consoleConfig: { controlPlane: { apiHost: 'https://control-plane.clickhouse.cloud' } },
    ...(extra.globals ?? {}),
  }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.clickhouse.main: identity')

  {
    const { requests, page } = clickhousePage(() => jsonResponse({}), {
      localStorage: {},
    })
    const result = await runTool('com.clickhouse.main', 'list_services', { input: {}, page })
    equal(result.status, 'error', 'clickhouse signed out: error status')
    equal(result.error_code, 'AUTH', 'clickhouse signed out: AUTH')
    equal(requests.length, 0, 'clickhouse signed out: makes no request')
  }

  {
    // An expired token also rejects (Auth0 refreshes in the background).
    const { requests, page } = clickhousePage(() => jsonResponse({}), {
      localStorage: { [AUTH0_KEY]: auth0Entry('t', -3600) },
    })
    const result = await runTool('com.clickhouse.main', 'list_services', { input: {}, page })
    equal(result.error_code, 'AUTH', 'clickhouse expired token: AUTH')
    equal(requests.length, 0, 'clickhouse expired token: no request')
  }

  section('com.clickhouse.main: reads')

  {
    // list_services reads the instances cache (__uc_cache__:instances:*),
    // filtered by the organization ID — no API request.
    const { requests, page } = clickhousePage(() => jsonResponse({}), {
      localStorage: {
        [AUTH0_KEY]: auth0Entry(),
        currentOrganizationId: 'org-1',
        '__uc_cache__:instances:user-1': JSON.stringify([
          {
            id: 'svc-1',
            name: 'prod',
            state: 'Running',
            organizationId: 'org-1',
            regionId: 'us-east-1',
            cloudProvider: 'aws',
            clickhouseVersion: '24.8',
          },
          { id: 'svc-2', name: 'other-org', organizationId: 'org-2' },
        ]),
      },
    })
    const result = await runTool('com.clickhouse.main', 'list_services', { input: {}, page })
    equal(result.status, 'ok', 'clickhouse list_services: ok')
    equal(result.data.services.length, 1, 'clickhouse list_services: filtered to current org')
    equal(result.data.services[0].id, 'svc-1', 'clickhouse list_services: id mapped')
    equal(result.data.services[0].region, 'us-east-1', 'clickhouse list_services: region mapped')
    equal(requests.length, 0, 'clickhouse list_services: served from cache, no request')
  }

  {
    const { requests, page } = clickhousePage(() =>
      jsonResponse({
        batch: [{ data: [[{ v: 12.5, t: 1700000000000 }]] }],
      }),
    )
    const result = await runTool('com.clickhouse.main', 'query_metrics', {
      input: { service_id: 'svc-1', metric_type: 'CPU_USAGE', time_period: 'LAST_DAY' },
      page,
    })
    equal(result.status, 'ok', 'clickhouse query_metrics: ok')
    equal(result.data.data_points.length, 1, 'clickhouse query_metrics: one point')
    equal(result.data.metric_type, 'CPU_USAGE', 'clickhouse query_metrics: metric echoed')
    equal(requests[0].init.method, 'POST', 'clickhouse query_metrics: POST')
    ok(requests[0].url.includes('/api/metrics/queryMetrics'), 'clickhouse query_metrics: path')
    const body = JSON.parse(requests[0].init.body)
    equal(body.organizationId, 'org-1', 'clickhouse query_metrics: org from cache')
    equal(body.instanceId, 'svc-1', 'clickhouse query_metrics: instance forwarded')
    equal(requests[0].init.headers.Authorization, 'Bearer ch-token-123', 'clickhouse: bearer token from Auth0 storage')
    equal(requests[0].init.credentials, 'include', 'clickhouse: cookies sent')
  }

  {
    // get_status is a public status-page call (no auth header).
    const { requests, page } = clickhousePage(() =>
      jsonResponse({ summary: { status: 'Operational' } }),
    )
    const result = await runTool('com.clickhouse.main', 'get_status', { input: {}, page })
    equal(result.status, 'ok', 'clickhouse get_status: ok')
    ok(requests[0].url.includes('statuspage.incident.io'), 'clickhouse get_status: public status page')
    equal(requests[0].init.headers.Authorization, undefined, 'clickhouse get_status: no auth header')
  }

  section('com.clickhouse.main: missing org')

  {
    const { page } = clickhousePage(() => jsonResponse({}), {
      localStorage: { [AUTH0_KEY]: auth0Entry() },
    })
    const result = await runTool('com.clickhouse.main', 'list_services', { input: {}, page })
    equal(result.status, 'error', 'clickhouse no org: error status')
    equal(result.error_code, 'AUTH', 'clickhouse no org: AUTH')
  }

  section('com.clickhouse.main: failures')

  {
    // A 404 on the metrics path (no such service) → NOT_FOUND, not AUTH:
    // the token is valid, the resource is missing.
    const { page } = clickhousePage(() => jsonResponse({ message: 'nope' }, 404))
    const result = await runTool('com.clickhouse.main', 'query_metrics', {
      input: { service_id: 'missing', metric_type: 'CPU_USAGE' },
      page,
    })
    equal(result.status, 'error', 'clickhouse 404: error status')
    equal(result.error_code, 'NOT_FOUND', 'clickhouse 404: NOT_FOUND')
  }

  section('com.clickhouse.main: wrong page')

  {
    const { page } = clickhousePage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.clickhouse.main', 'list_services', { input: {}, page })
    equal(result.status, 'error', 'clickhouse wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'clickhouse wrong host: UNSUPPORTED_PAGE')
  }
}
