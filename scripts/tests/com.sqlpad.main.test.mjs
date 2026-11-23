/**
 * com.sqlpad.main — execution tests against a stubbed self-hosted SQLPad tab.
 *
 * SQLPad is self-hosted (upstream urlPatterns: []), so the package pins no
 * host: the runtime gate accepts product-looking hosts (sqlpad.*,
 * localhost/127.0.0.1) and rejects everything else with UNSUPPORTED_PAGE and
 * zero requests. Identity is established by the same-origin session probe
 * (`/api/app` → currentUser.id), cached for subsequent calls.
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

function sqlpadPage(handler, { hostname = 'sqlpad.example.com', href = 'https://sqlpad.example.com/queries', ...extra } = {}) {
  const requests = []
  const page = {
    hostname,
    href,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.sqlpad.main: identity')

  {
    // A non-product host is rejected before any request — the self-hosted gate.
    const { requests, page } = sqlpadPage(() => jsonResponse({}), {
      hostname: 'blog.example.com',
      href: 'https://blog.example.com/',
    })
    const result = await runTool('com.sqlpad.main', 'list_connections', { input: {}, page })
    equal(result.status, 'error', 'sqlpad wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'sqlpad wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'sqlpad wrong host: makes no request')
  }

  {
    // A product host with a dead session → the auth probe fails → AUTH.
    const { requests, page } = sqlpadPage(() => jsonResponse({}), { hostname: 'localhost' })
    const result = await runTool('com.sqlpad.main', 'list_connections', { input: {}, page })
    equal(result.status, 'error', 'sqlpad signed out: error status')
    equal(result.error_code, 'AUTH', 'sqlpad signed out: AUTH')
    ok(requests.some((r) => r.url.includes('/api/app')), 'sqlpad signed out: session probe attempted')
  }

  section('com.sqlpad.main: reads')

  {
    const { requests, page } = sqlpadPage((url) => {
      if (url.includes('/api/app')) return jsonResponse({ currentUser: { id: 'u1', email: 'ada@example.com' } })
      if (url.includes('/api/connections'))
        return jsonResponse([{ id: 'c-1', name: 'Prod DB', driver: 'postgres' }])
      return jsonResponse({})
    })
    const result = await runTool('com.sqlpad.main', 'list_connections', { input: {}, page })
    if (result.status !== 'ok') console.log('SQLPAD CONN', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'sqlpad list_connections: ok')
    equal(result.data.connections.length, 1, 'sqlpad list_connections: one connection')
    equal(result.data.connections[0].id, 'c-1', 'sqlpad list_connections: id mapped')
    equal(result.data.connections[0].name, 'Prod DB', 'sqlpad list_connections: name mapped')
    ok(requests.some((r) => r.url.endsWith('/api/connections')), 'sqlpad list_connections: same-origin path')
  }

  {
    const { requests, page } = sqlpadPage((url) => {
      if (url.includes('/api/app')) return jsonResponse({ currentUser: { id: 'u1' } })
      if (url.includes('/schema')) return jsonResponse({ schemas: [{ name: 'public', tables: [{ name: 'users', columns: [{ name: 'id', datatype: 'integer' }] }] }] })
      return jsonResponse({})
    })
    const result = await runTool('com.sqlpad.main', 'get_schema', {
      input: { connectionId: 'c-1' },
      page,
    }) 
    equal(result.status, 'ok', 'sqlpad get_schema: ok')
    equal(result.data.schemas.length, 1, 'sqlpad get_schema: one schema')
    equal(result.data.schemas[0].tables[0].name, 'users', 'sqlpad get_schema: table mapped')
  }

  section('com.sqlpad.main: run_query (submit → poll → fetch)')

  {
    const { requests, page } = sqlpadPage((url) => {
      if (url.includes('/api/app')) return jsonResponse({ currentUser: { id: 'u1' } })
      if (url.endsWith('/api/batches')) {
        return jsonResponse({ id: 'b-1' })
      }
      if (url.includes('/api/batches/b-1')) {
        return jsonResponse({
          id: 'b-1',
          status: 'finished',
          statements: [
            {
              id: 's-1',
              status: 'finished',
              columns: [{ name: 'id', datatype: 'integer' }],
              durationMs: 12,
            },
          ],
        })
      }
      if (url.includes('/api/statements/s-1/results')) {
        // Raw 2D array as JSON text.
        return jsonResponse([[1], [2]])
      }
      return jsonResponse({})
    })
    const result = await runTool('com.sqlpad.main', 'run_query', {
      input: { connectionId: 'c-1', query: 'select id from users' },
      page,
    })
    if (result.status !== 'ok') console.log('SQLPAD QUERY', JSON.stringify(result).slice(0, 400))
    equal(result.status, 'ok', 'sqlpad run_query: ok')
    equal(result.data.rowCount, 2, 'sqlpad run_query: row count')
    equal(result.data.rows.length, 2, 'sqlpad run_query: rows capped')
    equal(result.data.rows[0].id, 1, 'sqlpad run_query: rows keyed by column name')
    equal(result.data.columns[0].name, 'id', 'sqlpad run_query: column mapped')
    const batch = requests.find((r) => r.url.endsWith('/api/batches'))
    equal(batch.init.method, 'POST', 'sqlpad run_query: batch submit is POST')
    const body = JSON.parse(batch.init.body)
    equal(body.connectionId, 'c-1', 'sqlpad run_query: connection forwarded')
    equal(body.batchText, 'select id from users', 'sqlpad run_query: query in batch body')
  }

  section('com.sqlpad.main: writes')

  {
    const { requests, page } = sqlpadPage((url) => {
      if (url.includes('/api/app')) return jsonResponse({ currentUser: { id: 'u1' } })
      if (url.endsWith('/api/queries')) return jsonResponse({ id: 'q-9', name: 'My query' })
      if (url.includes('/api/queries/q-9')) return jsonResponse({ id: 'q-9', name: 'Renamed' })
      return jsonResponse({})
    })
    const result = await runTool('com.sqlpad.main', 'create_saved_query', {
      input: { name: 'My query', connectionId: 'c-1', queryText: 'select 1' },
      page,
    })
    if (result.status !== 'ok') console.log('SQLPAD CREATE', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'sqlpad create_saved_query: ok')
    const create = requests.find((r) => r.url.endsWith('/api/queries'))
    equal(create.init.method, 'POST', 'sqlpad create_saved_query: POST')
    ok(JSON.parse(create.init.body).name === 'My query', 'sqlpad create_saved_query: name body')

    const upd = await runTool('com.sqlpad.main', 'update_saved_query', {
      input: { queryId: 'q-9', name: 'Renamed' },
      page,
    })
    equal(upd.status, 'ok', 'sqlpad update_saved_query: ok')
    const update = requests.find((r) => r.url.includes('/api/queries/q-9') && r.init.method === 'PUT')
    ok(update, 'sqlpad update_saved_query: PUT to /api/queries/q-9')
  }

  section('com.sqlpad.main: failures')

  {
    const { page } = sqlpadPage((url) => {
      if (url.includes('/api/app')) return jsonResponse({ currentUser: { id: 'u1' } })
      return jsonResponse({ message: 'nope' }, 401)
    })
    const result = await runTool('com.sqlpad.main', 'list_connections', { input: {}, page })
    equal(result.status, 'error', 'sqlpad 401: error status')
    equal(result.error_code, 'AUTH', 'sqlpad 401: AUTH')
  }
}
