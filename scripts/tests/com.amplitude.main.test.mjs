/**
 * com.amplitude.main — execution tests against a stubbed Amplitude tab.
 *
 * Identity is the `onenav_jwt_prod` cookie plus the org slug parsed from the
 * /analytics/<org>/ URL path and the org id from `intercomSettings.org_id`
 * (exactly what the ported API layer reads). GraphQL goes to the same-origin
 * `/t/graphql/org/<orgId>` endpoint with the `X-Org` header.
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

/** A signed-in Amplitude tab at app.amplitude.com. */
function ampPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'app.amplitude.com',
    href: 'https://app.amplitude.com/analytics/acme/home',
    cookie: 'onenav_jwt_prod=jwt-token',
    globals: { intercomSettings: { org_id: '4242' } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      const body = JSON.parse(init.body ?? '{}')
      return jsonResponse({ data: handler(body), errors: [] })
    },
  }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.amplitude.main: identity')

  {
    const { requests, page } = ampPage(() => ({}), { cookie: '' })
    const result = await runTool('com.amplitude.main', 'list_orgs', { input: {}, page })
    equal(result.status, 'error', 'amplitude signed out: error status')
    equal(result.error_code, 'AUTH', 'amplitude signed out: AUTH')
    equal(requests.length, 0, 'amplitude signed out: makes no request')
  }

  {
    // JWT present but no org slug in the path → still no identity
    const { requests, page } = ampPage(() => ({}), { href: 'https://app.amplitude.com/home' })
    const result = await runTool('com.amplitude.main', 'list_orgs', { input: {}, page })
    equal(result.status, 'error', 'amplitude no org slug: error status')
    equal(result.error_code, 'AUTH', 'amplitude no org slug: AUTH')
    equal(requests.length, 0, 'amplitude no org slug: no request')
  }

  section('com.amplitude.main: reads')

  {
    const { requests, page } = ampPage((body) => ({
      orgs: [
        { id: '4242', name: 'Acme' },
        { id: '4243', name: 'Globex' },
      ],
    }))
    const result = await runTool('com.amplitude.main', 'list_orgs', { input: {}, page })

    equal(result.status, 'ok', 'amplitude list_orgs: ok')
    equal(result.data.orgs.length, 2, 'amplitude list_orgs: two orgs')
    equal(result.data.orgs[0].id, '4242', 'amplitude list_orgs: id stringified')
    equal(requests.length, 1, 'amplitude list_orgs: one request')
    equal(
      requests[0].url,
      '/t/graphql/org/4242?q=Orgs',
      'amplitude list_orgs: org-scoped graphql endpoint',
    )
    equal(requests[0].init.headers['X-Org'], '4242', 'amplitude list_orgs: X-Org header')
    equal(requests[0].init.credentials, 'include', 'amplitude list_orgs: cookies sent')
    const sent = JSON.parse(requests[0].init.body)
    equal(sent.operationName, 'Orgs', 'amplitude list_orgs: operationName')
  }

  {
    const { page } = ampPage((body) => ({
      eventProperties: ['os', 'device', 'plan_name'],
    }))
    const result = await runTool('com.amplitude.main', 'list_events', {
      input: { app_id: '4242', event_type: 'Signup' },
      page,
    })
    equal(result.status, 'ok', 'amplitude list_events: ok')
    equal(result.data.event_type, 'Signup', 'amplitude list_events: event type echoed')
    equal(result.data.properties.length, 3, 'amplitude list_events: properties')
  }

  section('com.amplitude.main: writes')

  {
    // search_content is a read-shaped GraphQL call; assert the payload contract
    const { requests, page } = ampPage((body) => ({
      unisearchContentSearch: {
        results: [{ entity: { entityId: 'c1', name: 'Retention chart', type: 'chart' } }],
        totalHits: 1,
      },
    }))
    const result = await runTool('com.amplitude.main', 'search_content', {
      input: { query: 'retention' },
      page,
    })
    equal(result.status, 'ok', 'amplitude search_content: ok')
    equal(result.data.total_hits, 1, 'amplitude search_content: totalHits maps to total_hits')
    equal(result.data.results[0].name, 'Retention chart', 'amplitude search_content: result mapped')
    const sent = JSON.parse(requests[0].init.body)
    equal(sent.operationName, 'GlobalSearch', 'amplitude search_content: operationName')
    equal(sent.variables.query, 'retention', 'amplitude search_content: query forwarded')
  }

  section('com.amplitude.main: failures')

  {
    const { page } = ampPage(() => ({}), {
      fetch: async () =>
        jsonResponse({ errors: [{ message: 'Unauthorized' }] }),
    })
    const result = await runTool('com.amplitude.main', 'list_orgs', { input: {}, page })
    equal(result.status, 'error', 'amplitude graphql Unauthorized: error status')
    equal(result.error_code, 'AUTH', 'amplitude graphql Unauthorized: AUTH')
  }
}
