/**
 * Execution tests for com.datadog.main.
 *
 * The ported runtime is upstream's Datadog plugin code (bundled), so these
 * tests assert the *requests* it makes — same-origin path, method, query, JSON
 * body and the dd-csrf-token headers — plus the mapped output, the failure
 * classification and the urlRegex scope.
 */
export default async function register({ ok, equal, section, runTool }) {
  const HOST = 'app.datadoghq.com'

  const jsonResponse = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  })

  /**
   * Minimal page: the Datadog app origin, the CSRF token the host app keeps in
   * localStorage, and a fetch that records every call and answers from `routes`
   * keyed by `"<METHOD> <pathname>"`.
   */
  function makePage({ hostname = HOST, token = 'csrf-abc123', routes = {} } = {}) {
    const calls = []
    return {
      calls,
      hostname,
      href: `https://${hostname}/monitors`,
      origin: `https://${hostname}`,
      localStorage: token ? { 'dd-csrf-token': JSON.stringify({ token, timestamp: 1700000000000 }) } : {},
      fetch: async (url, init = {}) => {
        // Upstream hands fetch the same-origin path; the page resolves it.
        const parsed = new URL(url, `https://${hostname}/`)
        const method = init.method ?? 'GET'
        calls.push({ url, parsed, method, init, body: init.body ? JSON.parse(init.body) : undefined })
        const route = routes[`${method} ${parsed.pathname}`]
        if (route === undefined) return jsonResponse({})
        if (typeof route === 'function') return route(parsed, init)
        return typeof route === 'number' ? jsonResponse({ errors: ['failed'] }, route) : jsonResponse(route)
      },
    }
  }

  // --- urlRegex ---------------------------------------------------------------

  section('urlRegex: com.datadog.main scopes to Datadog app hosts')
  const manifestSource = await (await import('node:fs/promises')).readFile(
    new URL('../../packages/com.datadog.main/manifest.json', import.meta.url),
    'utf8',
  )
  const manifest = JSON.parse(manifestSource)
  equal(manifest.tools.length, 75, 'datadog: 75 tools in the manifest')
  const regexes = new Set(manifest.tools.map((tool) => tool.urlRegex))
  equal(regexes.size, 1, 'datadog: every tool shares one host-scoped urlRegex')
  const re = new RegExp(manifest.tools[0].urlRegex)
  const matches = (href) => {
    const m = href.match(re)
    return Boolean(m) && m.index === 0 && m[0].length === href.length
  }
  ok(matches('https://app.datadoghq.com/monitors/12345?group=all#top'), 'matches an app page with query and hash')
  ok(matches('https://us5.datadoghq.com/dashboard/abc-def'), 'matches a regional site')
  ok(matches('https://app.datadoghq.com/'), 'matches the app root')
  ok(!matches('https://app.datadoghq.com.evil.example/monitors'), 'rejects a look-alike suffix')
  ok(!matches('https://datadoghq.com.example.com/monitors'), 'rejects a prefixed look-alike host')
  ok(matches('https://us3.datadoghq.com/logs'), 'matches a second regional site')
  ok(!matches('http://app.datadoghq.com/monitors'), 'rejects plain http')
  ok(!matches('https://app.datadoghq.com:8443/monitors'), 'rejects a non-default port')

  // --- Monitors ---------------------------------------------------------------

  section('execution: Datadog monitor reads carry the session and map the payload')
  const monitorPayload = [
    {
      id: 4242,
      name: 'CPU high on web',
      type: 'metric alert',
      query: 'avg(last_5m):avg:system.cpu.user{env:prod} > 90',
      message: 'Disk is full @slack-alerts',
      tags: ['env:prod', 'team:backend'],
      overall_state: 'Alert',
      priority: 2,
      options: { thresholds: { critical: 90 } },
      created: '2024-01-01T00:00:00Z',
      modified: '2024-02-01T00:00:00Z',
      creator: { name: 'Ada', handle: 'ada@example.com' },
    },
  ]
  const monitorsPage = makePage({ routes: { 'GET /api/v1/monitor': monitorPayload } })
  const monitors = await runTool('com.datadog.main', 'list_monitors', {
    input: { tags: 'env:prod,team:backend' },
    page: monitorsPage,
  })
  equal(monitors.status, 'ok', 'list_monitors: status')
  equal(monitorsPage.calls.length, 1, 'list_monitors: one request')
  const monitorCall = monitorsPage.calls[0]
  equal(monitorCall.parsed.pathname, '/api/v1/monitor', 'list_monitors: endpoint')
  equal(monitorCall.parsed.origin, 'https://app.datadoghq.com', 'list_monitors: same-origin request')
  equal(monitorCall.method, 'GET', 'list_monitors: GET')
  equal(monitorCall.init.credentials, 'include', 'list_monitors: sends the session cookie')
  equal(monitorCall.parsed.searchParams.get('page'), '0', 'list_monitors: default page 0')
  equal(monitorCall.parsed.searchParams.get('per_page'), '50', 'list_monitors: default per_page 50')
  equal(monitorCall.parsed.searchParams.get('tags'), 'env:prod,team:backend', 'list_monitors: tag filter')
  equal(monitorCall.init.headers?.['x-csrf-token'], undefined, 'list_monitors: reads carry no CSRF header')
  equal(monitors.data.monitors[0].id, 4242, 'list_monitors: id mapped')
  equal(monitors.data.monitors[0].overall_state, 'Alert', 'list_monitors: state mapped')
  equal(monitors.data.monitors[0].creator.handle, 'ada@example.com', 'list_monitors: creator mapped')
  equal(monitors.data.monitors[0].priority, 2, 'list_monitors: priority stays a number')

  const monitorPage = makePage({ routes: { 'GET /api/v1/monitor/4242': monitorPayload[0] } })
  const single = await runTool('com.datadog.main', 'get_monitor', {
    input: { monitor_id: 4242 },
    page: monitorPage,
  })
  equal(single.status, 'ok', 'get_monitor: status')
  equal(monitorPage.calls[0].parsed.pathname, '/api/v1/monitor/4242', 'get_monitor: endpoint')
  equal(single.data.monitor.options.thresholds.critical, 90, 'get_monitor: options passed through')

  // --- Monitors: writes -------------------------------------------------------

  section('execution: Datadog writes send the dd-csrf-token and a JSON body')
  const mutePage = makePage({ routes: { 'POST /api/v1/monitor/4242/mute': {} } })
  const muted = await runTool('com.datadog.main', 'mute_monitor', {
    input: { monitor_id: 4242, scope: 'host:web-1' },
    page: mutePage,
  })
  equal(muted.status, 'ok', 'mute_monitor: status')
  const muteCall = mutePage.calls[0]
  equal(muteCall.method, 'POST', 'mute_monitor: POST')
  equal(muteCall.parsed.pathname, '/api/v1/monitor/4242/mute', 'mute_monitor: endpoint')
  equal(muteCall.init.headers['x-csrf-token'], 'csrf-abc123', 'mute_monitor: x-csrf-token header')
  equal(muteCall.init.headers['x-dd-csrf-token'], 'csrf-abc123', 'mute_monitor: x-dd-csrf-token header')
  equal(muteCall.init.headers['Content-Type'], 'application/json', 'mute_monitor: JSON content type')
  equal(muteCall.body._authentication_token, 'csrf-abc123', 'mute_monitor: CSRF token also in the body')
  equal(muteCall.body.scope, 'host:web-1', 'mute_monitor: scope forwarded')
  equal(muteCall.body.end, undefined, 'mute_monitor: unspecified end omitted')
  equal(muted.data.success, true, 'mute_monitor: success flag')
  equal(muted.data.id, 4242, 'mute_monitor: id echoed')

  const createPage = makePage({
    routes: { 'POST /api/v1/monitor': { id: 9001, name: 'New monitor', type: 'log alert' } },
  })
  const created = await runTool('com.datadog.main', 'create_monitor', {
    input: {
      name: 'New monitor',
      type: 'log alert',
      query: 'logs("service:api").index("*").rollup("count").last("5m") > 10',
      tags: ['env:prod'],
      priority: 3,
      options: { notify_no_data: true },
    },
    page: createPage,
  })
  equal(created.status, 'ok', 'create_monitor: status')
  const createBody = createPage.calls[0].body
  equal(createBody.tags instanceof Array, true, 'create_monitor: tags stay an array')
  equal(createBody.priority, 3, 'create_monitor: priority stays a number')
  equal(createBody.options.notify_no_data, true, 'create_monitor: options forwarded')
  equal(createBody.message, undefined, 'create_monitor: unspecified message omitted')
  equal(createBody._authentication_token, 'csrf-abc123', 'create_monitor: CSRF token injected')
  equal(created.data.id, 9001, 'create_monitor: new id returned')

  const updatePage = makePage({
    routes: { 'PUT /api/v1/monitor/4242': { id: 4242, name: 'Renamed', type: 'metric alert' } },
  })
  const updated = await runTool('com.datadog.main', 'update_monitor', {
    input: { monitor_id: 4242, name: 'Renamed' },
    page: updatePage,
  })
  equal(updated.status, 'ok', 'update_monitor: status')
  equal(updatePage.calls[0].method, 'PUT', 'update_monitor: PUT')
  equal(updatePage.calls[0].parsed.pathname, '/api/v1/monitor/4242', 'update_monitor: endpoint')
  equal(
    Object.keys(updatePage.calls[0].body).sort().join(','),
    '_authentication_token,name',
    'update_monitor: only the supplied field is sent',
  )

  // --- Dashboards -------------------------------------------------------------

  section('execution: Datadog dashboards')
  const dashboardPage = makePage({
    routes: {
      'GET /api/v1/dashboard/abc-def-123': {
        id: 'abc-def-123',
        title: 'API overview',
        description: 'Latency and errors',
        layout_type: 'ordered',
        widgets: [{ id: 7, definition: { title: 'p99', type: 'timeseries' } }],
        template_variables: [{ name: 'env', default: 'prod', prefix: 'env' }],
        author_handle: 'ada@example.com',
        created_at: '2024-01-01T00:00:00Z',
        modified_at: '2024-02-01T00:00:00Z',
        url: '/dashboard/abc-def-123/api-overview',
      },
    },
  })
  const dashboard = await runTool('com.datadog.main', 'get_dashboard', {
    input: { dashboard_id: 'abc-def-123' },
    page: dashboardPage,
  })
  equal(dashboard.status, 'ok', 'get_dashboard: status')
  equal(dashboardPage.calls[0].parsed.pathname, '/api/v1/dashboard/abc-def-123', 'get_dashboard: endpoint')
  equal(dashboard.data.title, 'API overview', 'get_dashboard: title')
  equal(dashboard.data.widgets[0].title, 'p99', 'get_dashboard: widget titles unwrapped')
  equal(dashboard.data.template_variables[0].name, 'env', 'get_dashboard: template variables')

  // --- Logs / metrics ---------------------------------------------------------

  section('execution: Datadog logs and metric queries')
  const logsPage = makePage({
    routes: {
      'POST /api/v1/logs-analytics/list': {
        result: {
          events: [
            {
              id: 'evt-1',
              columns: ['error', '2024-03-01T10:00:00Z', 'web-1', 'api', 'boom'],
              event: { tags: ['env:prod'] },
            },
          ],
        },
        hitCount: 12,
      },
    },
  })
  const beforeLogs = Date.now()
  const logs = await runTool('com.datadog.main', 'search_logs', {
    input: { query: 'service:api status:error', limit: 50 },
    page: logsPage,
  })
  equal(logs.status, 'ok', 'search_logs: status')
  const logsCall = logsPage.calls[0]
  equal(logsCall.method, 'POST', 'search_logs: POST')
  equal(logsCall.parsed.pathname, '/api/v1/logs-analytics/list', 'search_logs: endpoint')
  equal(logsCall.parsed.searchParams.get('type'), 'logs', 'search_logs: type=logs')
  equal(logsCall.body.list.limit, 50, 'search_logs: limit forwarded')
  equal(logsCall.body.list.search.query, 'service:api status:error', 'search_logs: query forwarded')
  equal(logsCall.body.list.sort.time.order, 'desc', 'search_logs: default sort desc')
  equal(
    logsCall.body.list.time.to - logsCall.body.list.time.from,
    900000,
    'search_logs: default window is now-15m..now',
  )
  ok(logsCall.body.list.time.to >= beforeLogs && logsCall.body.list.time.to <= Date.now() + 1000, 'search_logs: window ends now')
  equal(logsCall.body.list.indexes[0], '*', 'search_logs: searches every index')
  equal(logsCall.body._authentication_token, 'csrf-abc123', 'search_logs: CSRF token in the body')
  equal(logs.data.total, 12, 'search_logs: hitCount becomes total')
  equal(logs.data.logs[0].message, 'boom', 'search_logs: message column mapped')
  equal(logs.data.logs[0].service, 'api', 'search_logs: service column mapped')
  equal(logs.data.logs[0].tags[0], 'env:prod', 'search_logs: tags preserved')

  const metricsPage = makePage({
    routes: {
      'GET /api/v1/query': {
        series: [
          {
            metric: 'system.cpu.user',
            scope: 'env:prod',
            pointlist: [[1700000000000, 12.5]],
            unit: [{ name: 'percent' }],
          },
        ],
        from_date: 1700000000000,
        to_date: 1700000600000,
        query: 'avg:system.cpu.user{env:prod}',
      },
    },
  })
  const metrics = await runTool('com.datadog.main', 'query_metrics', {
    input: { query: 'avg:system.cpu.user{env:prod}', from: 1700000000, to: 1700000600 },
    page: metricsPage,
  })
  equal(metrics.status, 'ok', 'query_metrics: status')
  const metricsCall = metricsPage.calls[0]
  equal(metricsCall.parsed.pathname, '/api/v1/query', 'query_metrics: endpoint')
  equal(metricsCall.parsed.searchParams.get('from'), '1700000000', 'query_metrics: from epoch seconds')
  equal(metricsCall.parsed.searchParams.get('query'), 'avg:system.cpu.user{env:prod}', 'query_metrics: query')
  equal(metrics.data.series[0].metric, 'system.cpu.user', 'query_metrics: series metric')
  equal(metrics.data.series[0].pointlist[0][1], 12.5, 'query_metrics: points preserved')

  const timeseriesPage = makePage({
    routes: { 'POST /api/ui/query/timeseries': { data: { attributes: { series: [] } }, meta: { status: 'ok' } } },
  })
  const timeseries = await runTool('com.datadog.main', 'query_timeseries', {
    input: {
      queries: [{ data_source: 'metrics', query: 'avg:system.cpu.user{*}', name: 'a' }],
      from: 1700000000000,
      to: 1700000600000,
      formulas: [{ formula: 'a * 2' }],
    },
    page: timeseriesPage,
  })
  equal(timeseries.status, 'ok', 'query_timeseries: status')
  equal(timeseriesPage.calls[0].parsed.pathname, '/api/ui/query/timeseries', 'query_timeseries: internal UI endpoint')
  equal(timeseriesPage.calls[0].body.queries[0].name, 'a', 'query_timeseries: queries forwarded')
  equal(timeseriesPage.calls[0].body.formulas[0].formula, 'a * 2', 'query_timeseries: formulas forwarded')
  equal(timeseries.data.meta.status, 'ok', 'query_timeseries: meta returned')

  // --- Incidents / SLOs / users ----------------------------------------------

  section('execution: Datadog incidents, SLOs and users')
  const incidentsPage = makePage({
    routes: {
      'GET /api/v2/incidents': {
        data: [
          {
            id: 'inc-1',
            attributes: {
              title: 'Elevated 5xx',
              status: 'active',
              fields: { severity: { value: 'SEV-2' } },
              created: '2024-03-01T00:00:00Z',
              modified: '2024-03-01T01:00:00Z',
              commander: { data: { attributes: { handle: 'ada@example.com' } } },
              customer_impacted: true,
            },
          },
        ],
      },
    },
  })
  const incidents = await runTool('com.datadog.main', 'list_incidents', {
    input: { page_size: 10 },
    page: incidentsPage,
  })
  equal(incidents.status, 'ok', 'list_incidents: status')
  equal(incidentsPage.calls[0].parsed.pathname, '/api/v2/incidents', 'list_incidents: endpoint')
  equal(incidentsPage.calls[0].parsed.searchParams.get('page[size]'), '10', 'list_incidents: page[size]')
  equal(incidentsPage.calls[0].parsed.searchParams.get('page[offset]'), '0', 'list_incidents: page[offset]')
  equal(incidents.data.incidents[0].severity, 'SEV-2', 'list_incidents: severity from fields')
  equal(incidents.data.incidents[0].commander, 'ada@example.com', 'list_incidents: commander handle')
  equal(incidents.data.incidents[0].customer_impacted, true, 'list_incidents: customer impact')

  const sloPage = makePage({
    routes: {
      'GET /api/v1/slo/slo-abc': {
        data: {
          id: 'slo-abc',
          name: 'API availability',
          description: '99.9%',
          type: 'metric',
          tags: ['team:api'],
          overall_status: [{ timeframe: '7d', sli_value: 99.95, target: 99.9, status: 'OK' }],
          created_at: 1700000000,
          modified_at: 1700001000,
          creator: { name: 'Ada', handle: 'ada@example.com' },
        },
      },
    },
  })
  const slo = await runTool('com.datadog.main', 'get_slo', { input: { slo_id: 'slo-abc' }, page: sloPage })
  equal(slo.status, 'ok', 'get_slo: status')
  equal(sloPage.calls[0].parsed.pathname, '/api/v1/slo/slo-abc', 'get_slo: endpoint')
  equal(slo.data.slo.name, 'API availability', 'get_slo: name')
  equal(slo.data.slo.overall_status[0].sli_value, 99.95, 'get_slo: sli value')

  const usersPage = makePage({
    routes: {
      'GET /api/v2/current_user': {
        data: { id: 'user-1', attributes: { name: 'Ada', handle: 'ada@example.com', email: 'ada@example.com' } },
      },
      'GET /api/v2/users': {
        data: [{ id: 'user-2', attributes: { name: 'Grace', handle: 'grace@example.com', verified: true } }],
      },
    },
  })
  const me = await runTool('com.datadog.main', 'get_current_user', { input: {}, page: usersPage })
  equal(me.status, 'ok', 'get_current_user: status')
  equal(usersPage.calls[0].parsed.href, 'https://app.datadoghq.com/api/v2/current_user', 'get_current_user: endpoint')
  equal(me.data.user.handle, 'ada@example.com', 'get_current_user: handle mapped')
  const users = await runTool('com.datadog.main', 'list_users', {
    input: { filter: 'grace', page_size: 5 },
    page: usersPage,
  })
  equal(users.status, 'ok', 'list_users: status')
  equal(usersPage.calls[1].parsed.searchParams.get('filter'), 'grace', 'list_users: filter')
  equal(usersPage.calls[1].parsed.searchParams.get('page[size]'), '5', 'list_users: page[size]')
  equal(users.data.users[0].verified, true, 'list_users: verified flag')

  // --- Failures ---------------------------------------------------------------

  section('execution: Datadog failure paths')
  const anonymous = makePage({ token: null })
  const unauthenticated = await runTool('com.datadog.main', 'list_monitors', { input: {}, page: anonymous })
  equal(unauthenticated.status, 'error', 'no dd-csrf-token: error envelope')
  equal(unauthenticated.error_code, 'AUTH', 'no dd-csrf-token: AUTH')
  equal(anonymous.calls.length, 0, 'no dd-csrf-token: no request is attempted')
  equal(unauthenticated.data, null, 'no dd-csrf-token: no data')

  const corrupt = makePage({ token: null })
  corrupt.localStorage['dd-csrf-token'] = 'not-json'
  const corruptResult = await runTool('com.datadog.main', 'list_monitors', { input: {}, page: corrupt })
  equal(corruptResult.error_code, 'AUTH', 'unparseable dd-csrf-token: AUTH')

  const missing = await runTool('com.datadog.main', 'get_monitor', {
    input: { monitor_id: 1 },
    page: makePage({ routes: { 'GET /api/v1/monitor/1': 404 } }),
  })
  equal(missing.status, 'error', 'HTTP 404: error envelope')
  equal(missing.error_code, 'NOT_FOUND', 'HTTP 404: NOT_FOUND')
  ok(missing.message.includes('404'), 'HTTP 404: status in the message')

  const limited = await runTool('com.datadog.main', 'get_monitor', {
    input: { monitor_id: 1 },
    page: makePage({ routes: { 'GET /api/v1/monitor/1': 429 } }),
  })
  equal(limited.error_code, 'RATE_LIMITED', 'HTTP 429: RATE_LIMITED')

  const broken = await runTool('com.datadog.main', 'get_monitor', {
    input: { monitor_id: 1 },
    page: makePage({ routes: { 'GET /api/v1/monitor/1': 500 } }),
  })
  equal(broken.error_code, 'HTTP', 'HTTP 500: classified as HTTP')

  const invalid = await runTool('com.datadog.main', 'get_monitor', {
    input: { monitor_id: 1 },
    page: makePage({ routes: { 'GET /api/v1/monitor/1': 422 } }),
  })
  equal(invalid.error_code, 'VALIDATION', 'HTTP 422: VALIDATION')

  const wrongPage = await runTool('com.datadog.main', 'list_monitors', {
    input: {},
    page: makePage({ hostname: 'example.com' }),
  })
  equal(wrongPage.status, 'error', 'non-Datadog page: error envelope')
  equal(wrongPage.error_code, 'UNSUPPORTED_PAGE', 'non-Datadog page: UNSUPPORTED_PAGE')

  // --- smoke: every tool ------------------------------------------------------

  section('execution: all 75 Datadog tools run end to end against a stub')
  const sample = (schema) => {
    if (!schema || typeof schema !== 'object') return 'x'
    if (Array.isArray(schema.enum)) return schema.enum[0]
    if (Array.isArray(schema.anyOf)) return sample(schema.anyOf[0])
    if (Array.isArray(schema.type) && schema.type.length > 0) return sample({ ...schema, type: schema.type[0] })
    if (schema.type === 'object') {
      const out = {}
      for (const key of Object.keys(schema.properties ?? {})) out[key] = sample(schema.properties[key])
      return out
    }
    if (schema.type === 'array') return [sample(schema.items)]
    if (schema.type === 'integer' || schema.type === 'number')
      return typeof schema.minimum === 'number' ? schema.minimum : 1
    if (schema.type === 'boolean') return true
    return 'x'
  }

  const wiringBroken = []
  const silent = []
  const shapeMisses = []
  let succeeded = 0
  for (const entry of manifest.tools) {
    const workflow = await import(new URL(`../../packages/com.datadog.main/${entry.path}`, import.meta.url).href)
    // Every declared argument, not just the required ones: a tool such as
    // update_metric_tag_configuration refuses a call that changes nothing.
    const args = {}
    for (const key of Object.keys(workflow.default.inputSchema.properties ?? {}))
      args[key] = sample(workflow.default.inputSchema.properties[key])
    const page = makePage({})
    const result = await runTool('com.datadog.main', entry.name, { input: args, page })
    ok(Boolean(result) && typeof result.status === 'string', `smoke: ${entry.name} returns an envelope`)
    if (result && result.status === 'ok') succeeded++
    else if (!result || ['TAB_UNAVAILABLE', 'EMPTY_RESULT', 'AUTH', 'UNSUPPORTED_PAGE'].includes(result.error_code))
      wiringBroken.push(`${entry.name}: ${result && result.error_code}`)
    else shapeMisses.push(`${entry.name}: ${result && result.error_code}`)
    if (page.calls.length === 0) silent.push(entry.name)
  }
  // A stub that answers `{}` cannot satisfy every mapper (list endpoints expect
  // an array), so a handful of tools report a shape/validation error — but the
  // runtime plumbing (token read, request, envelope) must hold for all of them.
  console.log(
    `  datadog smoke: ${succeeded}/75 tools mapped the stub response; shape misses: ${shapeMisses.join(', ') || 'none'}`,
  )
  equal(wiringBroken.length, 0, `smoke: no tool fails on auth/page/plumbing (${wiringBroken.join(', ')})`)
  equal(silent.length, 0, `smoke: every tool issues a request (silent: ${silent.join(', ')})`)
  ok(succeeded >= 65, `smoke: at least 65 tools map the stub to a result (${succeeded}/75, shape misses: ${shapeMisses.join(', ')})`)
}
