/**
 * com.newrelic.main — execution tests against a stubbed New Relic tab.
 *
 * Identity is the `window.__nr.userId` page global (exactly what the ported
 * API layer reads); all traffic goes to the same-origin NerdGraph endpoint
 * `https://one.newrelic.com/graphql` with the first-party headers.
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

/** A signed-in New Relic tab that answers GraphQL with `handler(payload)`. */
function nrPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'one.newrelic.com',
    href: 'https://one.newrelic.com/home?account=1',
    globals: { __nr: { userId: 'user-1' } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      const body = JSON.parse(init.body ?? '{}')
      return jsonResponse({ data: handler(body), errors: [] })
    },
  }
  Object.assign(page, extra)
  if (extra.globals) page.globals = { __nr: { userId: 'user-1' }, ...extra.globals }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.newrelic.main: identity')

  {
    const { requests, page } = nrPage(() => ({}), {
      globals: { __nr: {} },
    })
    const result = await runTool('com.newrelic.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'newrelic signed out: error status')
    equal(result.error_code, 'AUTH', 'newrelic signed out: AUTH')
    equal(requests.length, 0, 'newrelic signed out: makes no request')
  }

  section('com.newrelic.main: reads')

  {
    const { requests, page } = nrPage((body) => ({
      actor: {
        user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        accounts: [{ id: 1, name: 'Production' }],
        organization: { id: 'org-uuid', name: 'Acme' },
      },
      __body: body,
    }))
    const result = await runTool('com.newrelic.main', 'get_current_user', { input: {}, page })

    equal(result.status, 'ok', 'newrelic get_current_user: ok')
    equal(result.data.user.name, 'Ada Lovelace', 'newrelic get_current_user: user name')
    equal(result.data.accounts[0].id, 1, 'newrelic get_current_user: account id')
    equal(result.data.organization.name, 'Acme', 'newrelic get_current_user: organization')
    equal(requests.length, 1, 'newrelic get_current_user: one request')
    equal(requests[0].url, 'https://one.newrelic.com/graphql', 'newrelic: NerdGraph endpoint')
    equal(requests[0].init.method, 'POST', 'newrelic: POST')
    equal(
      requests[0].init.headers['newrelic-requesting-services'],
      'platform|nr1-ui',
      'newrelic: first-party header',
    )
    equal(requests[0].init.credentials, 'include', 'newrelic: cookies sent')
  }

  {
    const { requests, page } = nrPage((body) => ({
      actor: { account: { nrql: { results: [{ count: 5 }], metadata: { facets: ['x'] } } } },
      __body: body,
    }))
    const result = await runTool('com.newrelic.main', 'run_nrql_query', {
      input: { account_id: 1, query: 'SELECT count(*) FROM Transaction SINCE 1 hour ago' },
      page,
    })

    equal(result.status, 'ok', 'newrelic run_nrql_query: ok')
    equal(result.data.results[0].count, 5, 'newrelic run_nrql_query: results passthrough')
    const sent = JSON.parse(requests[0].init.body)
    equal(sent.variables.accountId, 1, 'newrelic run_nrql_query: account_id as number')
    equal(sent.variables.query, 'SELECT count(*) FROM Transaction SINCE 1 hour ago', 'newrelic run_nrql_query: NRQL forwarded')
    ok(String(sent.query).startsWith('query RunNrql'), 'newrelic run_nrql_query: named query')
  }

  {
    const { requests, page } = nrPage(() => ({
      actor: { entitySearch: { results: { entities: [{ guid: 'g1', name: 'web-1', entityType: 'APPLICATION' }] } } },
    }))
    const result = await runTool('com.newrelic.main', 'search_entities', {
      input: { query: 'name = "web-1"' },
      page,
    })
    equal(result.status, 'ok', 'newrelic search_entities: ok')
    ok(result.data.entities.length >= 1, 'newrelic search_entities: entity returned')
  }

  section('com.newrelic.main: writes')

  {
    const { requests, page } = nrPage(() => ({
      alertsPolicyCreate: { id: 7, name: 'High CPU', accountId: 1 },
    }))
    const result = await runTool('com.newrelic.main', 'create_alert_policy', {
      input: { account_id: 1, name: 'High CPU' },
      page,
    })

    equal(result.status, 'ok', 'newrelic create_alert_policy: ok')
    const sent = JSON.parse(requests[0].init.body)
    ok(String(sent.query).startsWith('mutation CreatePolicy'), 'newrelic create_alert_policy: mutation')
    equal(sent.variables.policy.name, 'High CPU', 'newrelic create_alert_policy: policy payload')
    equal(sent.variables.accountId, 1, 'newrelic create_alert_policy: account id number')
  }

  section('com.newrelic.main: failures')

  {
    const { page } = nrPage(
      () => ({}),
      {
        fetch: async (url, init) => {
          return jsonResponse({ errors: [{ message: 'FORBIDDEN: missing Api-Key' }] })
        },
        globals: { __nr: { userId: 'user-1' } },
      },
    )
    // wrap: the raw fetch above returns the payload directly; respond with errors only
    const result = await runTool('com.newrelic.main', 'list_accounts', { input: {}, page })
    ok(['AUTH', 'INTERNAL', 'error'].includes(result.error_code) || result.status === 'error', 'newrelic graphql errors: error status')
  }

  {
    const { page } = nrPage(() => {
      throw Object.assign(new Error('HTTP 401'), { status: 401 })
    })
    // fetchFromPage treats !ok via SDK layer; simulate 401 response instead
    const result = await runTool('com.newrelic.main', 'get_current_user', { input: {}, page })
    ok(result.status === 'error', 'newrelic failure surfaces an error envelope')
  }
}
