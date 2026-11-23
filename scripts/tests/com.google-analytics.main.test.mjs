/**
 * com.google-analytics.main — execution tests against a stubbed GA4 tab.
 *
 * Identity is the SAPISID cookie plus `preload.globals.gmsSuiteApiKey`, and the
 * page must expose `gapi.client.request` (exactly what the ported API layer
 * reads). Reports go through gapi.client.request with the apiKey as a query
 * parameter; the Suite Frontend calls ride the same path.
 */

const captured = []

/** A stub `gapi.client.request` that records calls and answers with `result`. */
function makeGapi(result, status = 200) {
  return {
    client: {
      request(opts) {
        captured.push(opts)
        if (status !== 200) {
          return Promise.reject({
            status,
            result: { error: { code: status, message: 'stub error' } },
          })
        }
        return Promise.resolve({ result })
      },
    },
  }
}

function gaPage(handler, extra = {}) {
  captured.length = 0
  const page = {
    hostname: 'analytics.google.com',
    href: 'https://analytics.google.com/analytics/web/#/p4242/reports/dashboard',
    cookie: 'SAPISID=sapisid-token',
    globals: {
      preload: {
        globals: { gmsSuiteApiKey: 'ga-api-key', authuser: '0' },
        accountTree: {
          accounts: [{ id: 'acc-1', name: 'Acme' }],
          properties: [{ id: '4242', name: 'Web' }],
        },
        obfuscatedUserId: 'obf-1',
      },
      gapi: makeGapi(handler()),
    },
    fetch: async () => {
      throw new Error('GA tools use gapi.client.request, not fetch')
    },
  }
  Object.assign(page, extra)
  // extra may replace the gapi stub wholesale (failure-path tests)
  if (extra.gapi) page.globals.gapi = extra.gapi
  return { captured, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.google-analytics.main: identity')

  {
    const { captured, page } = gaPage(() => ({}), { cookie: '' })
    const result = await runTool('com.google-analytics.main', 'list_accounts', { input: {}, page })
    equal(result.status, 'error', 'ga signed out: error status')
    equal(result.error_code, 'AUTH', 'ga signed out: AUTH')
    equal(captured.length, 0, 'ga signed out: makes no request')
  }

  section('com.google-analytics.main: page reads')

  {
    const { page } = gaPage(() => ({}))
    const result = await runTool('com.google-analytics.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'ga get_current_user: ok')
    equal(result.data.user_id, 'obf-1', 'ga get_current_user: preload.obfuscatedUserId')
    equal(result.data.account_count, 1, 'ga get_current_user: account count from preload tree')
    equal(result.data.accounts[0].name, 'Acme', 'ga get_current_user: account name')
  }

  {
    const { page } = gaPage(() => ({}))
    const result = await runTool('com.google-analytics.main', 'get_active_property', { input: {}, page })
    equal(result.status, 'ok', 'ga get_active_property: ok')
    equal(result.data.property_id, '4242', 'ga get_active_property: property id from #/p<id> hash')
    ok(result.data.url_hash.includes('#/p4242'), 'ga get_active_property: url hash echoed')
  }

  section('com.google-analytics.main: reports (gapi.client.request)')

  {
    const { captured, page } = gaPage(() => ({
      dimensionHeaders: [{ name: 'country' }],
      metricHeaders: [{ name: 'activeUsers' }],
      rows: [
        {
          dimensionValues: [{ value: 'US' }],
          metricValues: [{ value: '123' }],
        },
      ],
      rowCount: 1,
      metadata: { currencyCode: 'USD', timeZone: 'America/Los_Angeles' },
    }))
    const result = await runTool('com.google-analytics.main', 'run_report', {
      input: {
        property_id: '4242',
        start_date: '2026-11-01',
        end_date: '2026-11-22',
        metrics: ['activeUsers'],
        dimensions: ['country'],
        limit: 50,
      },
      page,
    })

    equal(result.status, 'ok', 'ga run_report: ok')
    equal(result.data.rows[0].dimensions[0], 'US', 'ga run_report: dimension value mapped')
    equal(result.data.rows[0].metrics[0], '123', 'ga run_report: metric value mapped')
    equal(result.data.currency_code, 'USD', 'ga run_report: currency')
    equal(captured.length, 1, 'ga run_report: one gapi call')
    ok(
      captured[0].path.includes('analyticsdata.googleapis.com/v1beta/properties/4242:runReport'),
      'ga run_report: property-scoped data API path',
    )
    equal(captured[0].method, 'POST', 'ga run_report: POST')
    equal(captured[0].params.key, 'ga-api-key', 'ga run_report: apiKey as query param')
    const body = JSON.parse(captured[0].body)
    equal(body.dateRanges[0].startDate, '2026-11-01', 'ga run_report: date range')
    equal(body.metrics[0].name, 'activeUsers', 'ga run_report: metric name')
    equal(body.dimensions[0].name, 'country', 'ga run_report: dimension name')
    equal(body.limit, '50', 'ga run_report: limit stringified')
  }

  section('com.google-analytics.main: failures')

  {
    const { page } = gaPage(() => ({}), { globals: undefined })
    const result = await runTool('com.google-analytics.main', 'list_accounts', { input: {}, page })
    equal(result.status, 'error', 'ga no preload globals: error status')
    equal(result.error_code, 'AUTH', 'ga no preload globals: AUTH')
  }

  {
    const { captured, page } = gaPage(() => ({}), {
      gapi: makeGapi({}, 403),
    })
    const result = await runTool('com.google-analytics.main', 'run_report', {
      input: {
        property_id: '4242',
        start_date: '2026-11-01',
        end_date: '2026-11-22',
        metrics: ['activeUsers'],
      },
      page,
    })
    equal(result.status, 'error', 'ga 403: error status')
    equal(result.error_code, 'AUTH', 'ga 403: AUTH')
    equal(captured.length, 1, 'ga 403: request was attempted')
  }
  {
    const { page } = gaPage(() => ({}))
    const result = await runTool('com.google-analytics.main', 'run_report', {
      input: {
        property_id: '4242',
        start_date: '2026-11-01',
        end_date: '2026-11-22',
        metrics: ['activeUsers'],
        dimension_filter: 'not-json',
      },
      page,
    })
    equal(result.status, 'error', 'ga bad dimension_filter: error status')
    equal(result.error_code, 'VALIDATION', 'ga bad dimension_filter: VALIDATION')
  }
}
