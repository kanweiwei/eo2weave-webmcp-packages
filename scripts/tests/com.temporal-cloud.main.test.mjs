/**
 * com.temporal-cloud.main — execution tests against a stubbed Temporal Cloud tab.
 *
 * Identity is an Auth0 SPA localStorage entry (key starting
 * `@@auth0spajs@@::<clientId>::` and containing the tmprl.cloud audience) whose
 * body.access_token is unexpired — exactly what the ported API layer extracts.
 * API calls go cross-origin to `<ns>.web.tmprl.cloud/api/v1` with the bearer
 * token; the namespace defaults from the page URL.
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

const CLIENT_ID = 'nTmmPY5xUpQnSr7gRZh7s33hNamtCeDg'
const AUDIENCE = 'https://saas-api.tmprl.cloud'
const AUTH0_KEY = `@@auth0spajs@@::${CLIENT_ID}::${AUDIENCE}`

function auth0Entry(token = 'tm-token-123', expiresInSec = 3600) {
  return JSON.stringify({
    body: { access_token: token },
    expiresAt: Math.floor(Date.now() / 1000) + expiresInSec,
  })
}

function temporalPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'web.tmprl.cloud',
    href: 'https://acme.web.tmprl.cloud/namespaces/acme/workflows',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.localStorage = extra.localStorage ?? { [AUTH0_KEY]: auth0Entry() }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.temporal-cloud.main: identity')

  {
    const { requests, page } = temporalPage(() => jsonResponse({}), {
      localStorage: {},
    })
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'error', 'temporal signed out: error status')
    equal(result.error_code, 'AUTH', 'temporal signed out: AUTH')
    equal(requests.length, 0, 'temporal signed out: makes no request')
  }

  {
    // Expired token rejects too (upstream checks expiresAt).
    const { requests, page } = temporalPage(() => jsonResponse({}), {
      localStorage: { [AUTH0_KEY]: auth0Entry('t', -3600) },
    })
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', {
      input: { namespace: 'acme' },
      page,
    })
    equal(result.error_code, 'AUTH', 'temporal expired token: AUTH')
    equal(requests.length, 0, 'temporal expired token: no request')
  }

  section('com.temporal-cloud.main: reads')

  {
    const { requests, page } = temporalPage(() =>
      jsonResponse({
        executions: [
          {
            execution: { workflowId: 'wf-1', runId: 'run-1' },
            type: { name: 'ShipOrder' },
            status: 'Running',
            taskQueue: 'orders',
            startTime: '2026-01-01T00:00:00Z',
            historyLength: '42',
          },
        ],
        nextPageToken: '',
      }),
    )
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', { input: {}, page })
    if (result.status !== 'ok') console.log('TEMPORAL LIST', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'temporal list_workflows: ok')
    equal(result.data.workflows.length, 1, 'temporal list_workflows: one workflow')
    equal(result.data.workflows[0].workflow_id, 'wf-1', 'temporal list_workflows: id mapped')
    equal(result.data.workflows[0].type, 'ShipOrder', 'temporal list_workflows: type mapped')
    equal(result.data.workflows[0].status, 'Running', 'temporal list_workflows: status mapped')
    equal(requests.length, 1, 'temporal list_workflows: one request')
    ok(requests[0].url.startsWith('https://acme.web.tmprl.cloud/api/v1/namespaces/acme/workflows'), 'temporal: namespace from page URL')
    ok(requests[0].url.includes('maximumPageSize=100'), 'temporal list_workflows: default page size')
    equal(requests[0].init.headers.Authorization, 'Bearer tm-token-123', 'temporal: bearer token from Auth0 storage')
    equal(requests[0].init.credentials, 'include', 'temporal: cookies sent')
  }

  {
    const { requests, page } = temporalPage(() =>
      jsonResponse({
        execution: { workflowId: 'wf-1', runId: 'run-1' },
        type: { name: 'ShipOrder' },
        status: 'Completed',
        history: { events: [{ eventId: '1', eventType: 'WorkflowExecutionStarted' }] },
      }),
    )
    const result = await runTool('com.temporal-cloud.main', 'get_workflow', {
      input: { namespace: 'acme', workflow_id: 'wf 1', run_id: 'run-1' },
      page,
    })
    equal(result.status, 'ok', 'temporal get_workflow: ok')
    ok(requests[0].url.includes('/namespaces/acme/workflows/wf%201?execution.runId=run-1'), 'temporal get_workflow: encoded path + runId query')
  }

  section('com.temporal-cloud.main: namespace required')

  {
    // No namespace arg and a page URL without a namespace → VALIDATION.
    const { requests, page } = temporalPage(() => jsonResponse({}), {
      href: 'https://cloud.temporal.io/home',
      hostname: 'cloud.temporal.io',
    })
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'error', 'temporal no namespace: error status')
    equal(result.error_code, 'VALIDATION', 'temporal no namespace: VALIDATION')
    equal(requests.length, 0, 'temporal no namespace: no request')
  }

  section('com.temporal-cloud.main: failures')

  {
    const { page } = temporalPage(() => jsonResponse({ message: 'nope' }, 401))
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', {
      input: { namespace: 'acme' },
      page,
    })
    equal(result.status, 'error', 'temporal 401: error status')
    equal(result.error_code, 'AUTH', 'temporal 401: AUTH')
  }

  section('com.temporal-cloud.main: wrong page')

  {
    const { page } = temporalPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.temporal-cloud.main', 'list_workflows', {
      input: { namespace: 'acme' },
      page,
    })
    equal(result.status, 'error', 'temporal wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'temporal wrong host: UNSUPPORTED_PAGE')
  }
}
