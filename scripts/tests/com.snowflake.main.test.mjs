/**
 * com.snowflake.main — execution tests against a stubbed Snowsight tab.
 *
 * Identity is the `numeracy` page globals: `numeracy.pageState.user.id` plus a
 * working `numeracy.api.backendHttp.getRequestContext()` returning the app
 * server URL and decoded user key — exactly what the ported API layer reads.
 * A page without both must reject before any request is attempted.
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

const CTX = {
  role: 'ACCOUNTADMIN',
  appServerUrl: 'https://acme.snowflakecomputing.com',
  decodedUserKey: 'user-key-abc',
}

function snowflakePage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'app.snowflake.com',
    href: 'https://app.snowflake.com/us-east-1/acme/worksheets',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.globals = extra.globals ?? {
    numeracy: {
      pageState: { user: { id: 'u1', email: 'ada@example.com' } },
      stores: { organization: { activeOrg: { id: 'org-1', shortName: 'acme' } } },
      api: { backendHttp: { getRequestContext: () => CTX } },
    },
    AbortSignal: { timeout: () => undefined },
  }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.snowflake.main: identity')

  {
    const { requests, page } = snowflakePage(() => jsonResponse({}), {
      globals: { AbortSignal: { timeout: () => undefined } },
    })
    const result = await runTool('com.snowflake.main', 'get_session', { input: {}, page })
    equal(result.status, 'error', 'snowflake signed out: error status')
    equal(result.error_code, 'AUTH', 'snowflake signed out: AUTH')
    equal(requests.length, 0, 'snowflake signed out: makes no request')
  }

  section('com.snowflake.main: session')

  {
    const { page } = snowflakePage(() => jsonResponse({}))
    const result = await runTool('com.snowflake.main', 'get_session', { input: {}, page })
    equal(result.status, 'ok', 'snowflake get_session: ok')
    equal(result.data.role, 'ACCOUNTADMIN', 'snowflake get_session: role from context')
    equal(result.data.userEmail, 'ada@example.com', 'snowflake get_session: email from page state')
    equal(result.data.orgShortName, 'acme', 'snowflake get_session: org short name')
  }

  section('com.snowflake.main: run_query')

  {
    const { requests, page } = snowflakePage(() =>
      jsonResponse({
        queryId: 'q-1',
        status: { summary: 'SUCCESS', totalDuration: 120, warehouseName: 'WH' },
        result: {
          resultColumnMetadata: [{ name: 'N', typeName: 'NUMBER', nullable: true }],
          firstChunkData: JSON.stringify([{ N: '1' }]),
          firstChunkRowCount: 1,
          chunkFileCount: 1,
          statementType: 'SELECT',
        },
      }),
    )
    const result = await runTool('com.snowflake.main', 'run_query', {
      input: { query: 'select 1', warehouse: 'WH' },
      page,
    })
    if (result.status !== 'ok') console.log('SNOWFLAKE QUERY', JSON.stringify(result).slice(0, 400))
    equal(result.status, 'ok', 'snowflake run_query: ok')
    equal(result.data.execution.queryId, 'q-1', 'snowflake run_query: query id in execution meta')
    equal(result.data.rows.length, 1, 'snowflake run_query: one row')
    equal(result.data.columns[0].name, 'N', 'snowflake run_query: column mapped')
    equal(result.data.totalRows, 1, 'snowflake run_query: total rows')
    equal(requests[0].init.method, 'POST', 'snowflake run_query: POST')
    ok(requests[0].url.startsWith('https://acme.snowflakecomputing.com/v1/queries'), 'snowflake run_query: app server URL from context')
    equal(requests[0].init.headers['x-snowflake-context'], 'user-key-abc', 'snowflake run_query: context header')
    equal(requests[0].init.credentials, 'include', 'snowflake run_query: cookies sent')
    const body = JSON.parse(requests[0].init.body)
    equal(body.sqlText, 'select 1', 'snowflake run_query: sqlText body')
    equal(body.warehouse, 'WH', 'snowflake run_query: warehouse forwarded')
  }

  {
    // SQL compilation errors surface as HTTP 422 with a descriptive body.
    const { page } = snowflakePage(() =>
      jsonResponse({ data: { errorMessage: 'Unknown column FOO', sqlState: '02000', errorCode: 2003 } }, 422),
    )
    const result = await runTool('com.snowflake.main', 'run_query', {
      input: { sql_text: 'select foo' },
      page,
    })
    equal(result.status, 'error', 'snowflake 422: error status')
    equal(result.error_code, 'VALIDATION', 'snowflake 422: VALIDATION')
    ok(result.message.includes('Unknown column FOO'), 'snowflake 422: SQL error extracted')
  }

  section('com.snowflake.main: reads (entity API)')

  {
    const { requests, page } = snowflakePage((url) => {
      if (url.includes('/organizations/org-1/entities/list')) {
        return jsonResponse({
          entities: [
            { entityId: 'w-1', info: { name: 'Sheet 1', type: 'query', lastModified: 1700000000000 } },
          ],
          next: '',
        })
      }
      return jsonResponse({})
    })
    page.globals.numeracy.stores.entity = {
      api: {
        async post(call) {
          requests.push({ url: 'entity:' + call.path, init: { method: 'POST' }, init_note: 'entity API POST' })
          return {
            entities: [
              { entityId: 'w-1', entityType: 'query', info: { name: 'Sheet 1', type: 'query' } },
            ],
            next: '',
          }
        },
      },
    }
    const result = await runTool('com.snowflake.main', 'list_worksheets', { input: {}, page })
    if (result.status !== 'ok') console.log('SNOWFLAKE WS', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'snowflake list_worksheets: ok')
    equal(result.data.worksheets.length, 1, 'snowflake list_worksheets: one worksheet')
    equal(result.data.worksheets[0].name, 'Sheet 1', 'snowflake list_worksheets: name mapped')
  }

  section('com.snowflake.main: wrong page')

  {
    const { page } = snowflakePage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.snowflake.main', 'get_session', { input: {}, page })
    equal(result.status, 'error', 'snowflake wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'snowflake wrong host: UNSUPPORTED_PAGE')
  }
}
