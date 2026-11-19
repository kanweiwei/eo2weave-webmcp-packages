/**
 * Execution tests for com.posthog.main.
 *
 * The ported runtime is upstream's PostHog plugin code (posthog-api.ts +
 * tools/schemas.ts transcribed to plain JS), so these tests assert the
 * *requests* it makes — same-origin /api/... path, method, query string, JSON
 * body and the X-CSRFToken header Django requires on writes — plus the mapped
 * output, the auth/unsupported-page failure paths and the urlRegex scope.
 */
export default async function register({ ok, equal, section, runTool }) {
  const HOST = 'us.posthog.com'
  const TEAM = 42
  const ORG = '8f3a-org-uuid'

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
   * Minimal PostHog page: the app origin, the posthog_csrftoken cookie, the
   * POSTHOG_APP_CONTEXT global (current team + project org), and a fetch that
   * records every call and answers from `routes` keyed by `"<METHOD> <pathname>"`.
   */
  function makePage({ hostname = HOST, csrf = 'csrf-abc123', teamId = TEAM, orgId = ORG, routes = {} } = {}) {
    const calls = []
    return {
      calls,
      hostname,
      href: `https://${hostname}/project/${teamId}/insights`,
      origin: `https://${hostname}`,
      cookie: csrf ? `posthog_csrftoken=${csrf}; posthog_session=1` : 'other=1',
      globals: {
        POSTHOG_APP_CONTEXT: {
          current_team: { id: teamId },
          current_project: { organization_id: orgId },
        },
      },
      fetch: async (url, init = {}) => {
        // Upstream hands fetch the same-origin path; the page resolves it.
        const parsed = new URL(url, `https://${hostname}/`)
        const method = init.method ?? 'GET'
        calls.push({ url, parsed, method, init, body: init.body ? JSON.parse(init.body) : undefined })
        const route = routes[`${method} ${parsed.pathname}`]
        if (route === undefined) return jsonResponse({})
        if (typeof route === 'function') return route(parsed, init)
        return typeof route === 'number' ? jsonResponse({ detail: 'failed' }, route) : jsonResponse(route)
      },
    }
  }

  // --- urlRegex ---------------------------------------------------------------

  section('urlRegex: com.posthog.main scopes to the PostHog app hosts')
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(
    await readFile(new URL('../../packages/com.posthog.main/manifest.json', import.meta.url), 'utf8'),
  )
  equal(manifest.id, 'com.posthog.main', 'posthog: manifest id')
  equal(manifest.version, '0.1.0', 'posthog: version 0.1.0')
  equal(manifest.tools.length, 38, 'posthog: 38 tools in the manifest')
  const regexes = new Set(manifest.tools.map((tool) => tool.urlRegex))
  equal(regexes.size, 1, 'posthog: every tool shares one host-scoped urlRegex')
  const re = new RegExp(manifest.tools[0].urlRegex)
  const matches = (href) => {
    const m = href.match(re)
    return Boolean(m) && m.index === 0 && m[0].length === href.length
  }
  ok(matches('https://us.posthog.com/project/42/insights/abc?date_from=-7d#tab'), 'matches a us app page with query and hash')
  ok(matches('https://eu.posthog.com/project/7/feature_flags'), 'matches the EU host')
  ok(matches('https://app.posthog.com/'), 'matches the legacy app host (302s to us)')
  ok(!matches('https://us.posthog.com.evil.example/project/42'), 'rejects a look-alike suffix')
  ok(!matches('https://notposthog.com/project/42'), 'rejects an unrelated host')
  ok(!matches('http://us.posthog.com/project/42'), 'rejects plain http')
  ok(!matches('https://us.posthog.com:8443/project/42'), 'rejects a non-default port')

  // --- Insights (read) --------------------------------------------------------

  section('execution: PostHog reads carry the session and map the payload')
  const insightPayload = {
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: 901,
        short_id: 'abc123',
        name: 'Weekly signups',
        derived_name: null,
        description: 'signups per week',
        favorited: true,
        tags: ['growth'],
        dashboards: [12],
        query: { kind: 'InsightVizNode', source: { kind: 'TrendsQuery' } },
        created_at: '2024-05-01T10:00:00Z',
        last_modified_at: '2024-05-02T10:00:00Z',
        created_by: { id: 7, first_name: 'Ada', email: 'ada@example.com' },
      },
    ],
  }
  const insightsPage = makePage({ routes: { ['GET /api/environments/' + TEAM + '/insights/']: insightPayload } })
  const insights = await runTool('com.posthog.main', 'list_insights', {
    input: { limit: 10, offset: 20, saved: true, short_id: 'abc123' },
    page: insightsPage,
  })
  equal(insights.status, 'ok', 'list_insights: status')
  equal(insightsPage.calls.length, 1, 'list_insights: one request')
  const iCall = insightsPage.calls[0]
  equal(iCall.parsed.origin, 'https://us.posthog.com', 'list_insights: same-origin request')
  equal(iCall.parsed.pathname, '/api/environments/42/insights/', 'list_insights: endpoint')
  equal(iCall.method, 'GET', 'list_insights: GET')
  equal(iCall.init.credentials, 'include', 'list_insights: sends the session cookie')
  equal(iCall.init.headers?.['X-CSRFToken'], undefined, 'list_insights: reads carry no CSRF header')
  equal(iCall.parsed.searchParams.get('limit'), '10', 'list_insights: limit forwarded')
  equal(iCall.parsed.searchParams.get('offset'), '20', 'list_insights: offset forwarded')
  equal(iCall.parsed.searchParams.get('saved'), 'true', 'list_insights: saved filter forwarded')
  equal(iCall.parsed.searchParams.get('short_id'), 'abc123', 'list_insights: short_id filter forwarded')
  equal(insights.data.count, 1, 'list_insights: count mapped')
  equal(insights.data.has_next, false, 'list_insights: has_next from next=null')
  const insight = insights.data.insights[0]
  equal(insight.id, 901, 'list_insights: id')
  equal(insight.query_kind, 'InsightVizNode', 'list_insights: top-level query kind')
  equal(insight.source_kind, 'TrendsQuery', 'list_insights: source query kind')
  equal(insight.derived_name, null, 'list_insights: null derived_name stays null')
  equal(insight.created_by.email, 'ada@example.com', 'list_insights: created_by mapped')
  equal(insight.dashboards[0], 12, 'list_insights: dashboard ids')

  // --- Events (read) ----------------------------------------------------------

  const eventsPayload = {
    count: 1,
    next: 'https://us.posthog.com/api/environments/42/events/?cursor=xyz',
    results: [
      {
        id: '018f-event-uuid',
        event: '$pageview',
        distinct_id: 'user-1',
        timestamp: '2024-06-01T12:00:00Z',
        properties: { $browser: 'Chrome', plan: 'pro' },
      },
    ],
  }
  const eventsPage = makePage({
    routes: { ['GET /api/environments/' + TEAM + '/events/']: eventsPayload },
  })
  const events = await runTool('com.posthog.main', 'list_events', {
    input: { event: '$pageview', person_id: 'user-1' },
    page: eventsPage,
  })
  equal(events.status, 'ok', 'list_events: status')
  const eCall = eventsPage.calls[0]
  equal(eCall.parsed.pathname, '/api/environments/42/events/', 'list_events: endpoint')
  equal(eCall.parsed.searchParams.get('orderBy'), '["-timestamp"]', 'list_events: newest-first orderBy')
  equal(eCall.parsed.searchParams.get('limit'), '20', 'list_events: default limit 20')
  equal(eCall.parsed.searchParams.get('event'), '$pageview', 'list_events: event filter')
  equal(eCall.parsed.searchParams.get('person_id'), 'user-1', 'list_events: person filter')
  equal(eCall.parsed.searchParams.get('after'), null, 'list_events: omitted after not sent')
  equal(events.data.has_next, true, 'list_events: has_next from next cursor')
  equal(events.data.events[0].event, '$pageview', 'list_events: event name')
  equal(events.data.events[0].properties.$browser, 'Chrome', 'list_events: properties passed through')

  // --- Persons (read) ---------------------------------------------------------

  const personsPayload = {
    count: 1,
    next: null,
    results: [
      {
        id: 55,
        uuid: 'person-uuid',
        name: 'ada@example.com',
        distinct_ids: ['user-1', 'user-1-alias'],
        properties: { email: 'ada@example.com', plan: 'pro' },
        created_at: '2024-01-01T00:00:00Z',
      },
    ],
  }
  const personsPage = makePage({
    routes: { ['GET /api/environments/' + TEAM + '/persons/']: personsPayload },
  })
  const persons = await runTool('com.posthog.main', 'list_persons', {
    input: { search: 'ada@example.com', distinct_id: 'user-1', limit: 5 },
    page: personsPage,
  })
  equal(persons.status, 'ok', 'list_persons: status')
  const pCall = personsPage.calls[0]
  equal(pCall.parsed.pathname, '/api/environments/42/persons/', 'list_persons: endpoint')
  equal(pCall.parsed.searchParams.get('search'), 'ada@example.com', 'list_persons: search forwarded')
  equal(pCall.parsed.searchParams.get('distinct_id'), 'user-1', 'list_persons: distinct_id forwarded')
  equal(pCall.parsed.searchParams.get('offset'), null, 'list_persons: omitted offset not sent')
  equal(persons.data.persons[0].distinct_ids.length, 2, 'list_persons: distinct_ids mapped')
  equal(persons.data.persons[0].properties.plan, 'pro', 'list_persons: properties passed through')

  // --- Feature flags (read) ---------------------------------------------------

  const flagRaw = {
    id: 321,
    key: 'new-checkout',
    name: 'New checkout',
    active: true,
    deleted: false,
    ensure_experience_continuity: true,
    filters: { groups: [{ rollout_percentage: 25, properties: [] }] },
    tags: ['checkout'],
    created_at: '2024-03-01T00:00:00Z',
    created_by: { id: 7, first_name: 'Ada', email: 'ada@example.com' },
  }
  const flagsPage = makePage({
    routes: { ['GET /api/projects/' + TEAM + '/feature_flags/']: { count: 1, next: null, results: [flagRaw] } },
  })
  const flags = await runTool('com.posthog.main', 'list_feature_flags', {
    input: { active: 'true', search: 'checkout', limit: 50 },
    page: flagsPage,
  })
  equal(flags.status, 'ok', 'list_feature_flags: status')
  const fCall = flagsPage.calls[0]
  equal(fCall.parsed.pathname, '/api/projects/42/feature_flags/', 'list_feature_flags: project endpoint')
  equal(fCall.parsed.searchParams.get('active'), 'true', 'list_feature_flags: active filter')
  equal(fCall.parsed.searchParams.get('search'), 'checkout', 'list_feature_flags: search filter')
  equal(fCall.init.headers?.['X-CSRFToken'], undefined, 'list_feature_flags: no CSRF on GET')
  const flag = flags.data.feature_flags[0]
  equal(flag.key, 'new-checkout', 'list_feature_flags: key')
  equal(flag.rollout_percentage, 25, 'list_feature_flags: rollout from filters.groups[0]')
  equal(flag.ensure_experience_continuity, true, 'list_feature_flags: continuity flag')
  equal(flag.created_by.first_name, 'Ada', 'list_feature_flags: created_by')

  // --- Feature flag writes ----------------------------------------------------

  section('execution: PostHog writes send the CSRF header and the real JSON body')
  const createdFlagPage = makePage({
    routes: {
      ['POST /api/projects/' + TEAM + '/feature_flags/']: {
        ...flagRaw,
        id: 654,
        key: 'beta-banner',
        name: 'Beta banner',
        active: false,
        filters: { groups: [{ rollout_percentage: 10, properties: [] }] },
      },
    },
  })
  const createdFlag = await runTool('com.posthog.main', 'create_feature_flag', {
    input: { key: 'beta-banner', name: 'Beta banner', rollout_percentage: 10 },
    page: createdFlagPage,
  })
  equal(createdFlag.status, 'ok', 'create_feature_flag: status')
  const cCall = createdFlagPage.calls[0]
  equal(cCall.method, 'POST', 'create_feature_flag: POST')
  equal(cCall.parsed.pathname, '/api/projects/42/feature_flags/', 'create_feature_flag: endpoint')
  equal(cCall.init.credentials, 'include', 'create_feature_flag: sends credentials')
  equal(cCall.init.headers['X-CSRFToken'], 'csrf-abc123', 'create_feature_flag: CSRF header')
  equal(cCall.init.headers['Content-Type'], 'application/json', 'create_feature_flag: JSON content type')
  equal(cCall.body.key, 'beta-banner', 'create_feature_flag: key in body')
  equal(cCall.body.name, 'Beta banner', 'create_feature_flag: name in body')
  equal(cCall.body.active, undefined, 'create_feature_flag: omitted active not sent')
  equal(cCall.body.ensure_experience_continuity, undefined, 'create_feature_flag: omitted continuity not sent')
  equal(cCall.body.filters.groups[0].rollout_percentage, 10, 'create_feature_flag: rollout in filters.groups[0]')
  equal(Array.isArray(cCall.body.filters.groups[0].properties), true, 'create_feature_flag: empty properties array')
  equal(createdFlag.data.feature_flag.id, 654, 'create_feature_flag: created flag mapped')

  const updatedFlagPage = makePage({
    routes: { ['PATCH /api/projects/' + TEAM + '/feature_flags/321/']: { ...flagRaw, active: false, name: 'Renamed' } },
  })
  const updatedFlag = await runTool('com.posthog.main', 'update_feature_flag', {
    input: { flag_id: 321, name: 'Renamed', active: false },
    page: updatedFlagPage,
  })
  equal(updatedFlag.status, 'ok', 'update_feature_flag: status')
  const uCall = updatedFlagPage.calls[0]
  equal(uCall.method, 'PATCH', 'update_feature_flag: PATCH')
  equal(uCall.parsed.pathname, '/api/projects/42/feature_flags/321/', 'update_feature_flag: endpoint')
  equal(uCall.init.headers['X-CSRFToken'], 'csrf-abc123', 'update_feature_flag: CSRF header')
  equal(uCall.body.name, 'Renamed', 'update_feature_flag: name in body')
  equal(uCall.body.active, false, 'update_feature_flag: explicit false kept')
  equal(uCall.body.key, undefined, 'update_feature_flag: key never sent')
  equal(uCall.body.filters, undefined, 'update_feature_flag: filters not sent when rollout omitted')
  equal(uCall.body.flag_id, undefined, 'update_feature_flag: id not echoed into the body')
  equal(updatedFlag.data.feature_flag.name, 'Renamed', 'update_feature_flag: updated flag mapped')

  // --- Insight write + HogQL query -------------------------------------------

  const createdInsightPage = makePage({
    routes: { ['POST /api/environments/' + TEAM + '/insights/']: { ...insightPayload.results[0], id: 902 } },
  })
  const createdInsight = await runTool('com.posthog.main', 'create_insight', {
    input: { name: 'Signups', query: 'SELECT count() FROM events', dashboard_id: 12, tags: ['growth'] },
    page: createdInsightPage,
  })
  equal(createdInsight.status, 'ok', 'create_insight: status')
  const ciCall = createdInsightPage.calls[0]
  equal(ciCall.method, 'POST', 'create_insight: POST')
  equal(ciCall.parsed.pathname, '/api/environments/42/insights/', 'create_insight: endpoint')
  equal(ciCall.init.headers['X-CSRFToken'], 'csrf-abc123', 'create_insight: CSRF header')
  equal(ciCall.body.query.kind, 'DataTableNode', 'create_insight: DataTableNode wrapper')
  equal(ciCall.body.query.source.kind, 'HogQLQuery', 'create_insight: HogQLQuery source')
  equal(ciCall.body.query.source.query, 'SELECT count() FROM events', 'create_insight: HogQL text')
  equal(ciCall.body.saved, true, 'create_insight: saved=true')
  equal(ciCall.body.dashboards[0], 12, 'create_insight: dashboard attached')
  equal(ciCall.body.tags[0], 'growth', 'create_insight: tags attached')
  equal(ciCall.body.description, '', 'create_insight: description defaults to empty string')
  equal(createdInsight.data.insight.id, 902, 'create_insight: created insight mapped')

  const queryPage = makePage({
    routes: {
      ['POST /api/environments/' + TEAM + '/query/']: {
        columns: ['event', 'total'],
        results: [['$pageview', 1234]],
        types: [['event', 'String'], ['total', 'UInt64']],
        hogql: 'SELECT event, count() AS total FROM events',
      },
    },
  })
  const query = await runTool('com.posthog.main', 'run_query', {
    input: { query: 'SELECT event, count() AS total FROM events' },
    page: queryPage,
  })
  equal(query.status, 'ok', 'run_query: status')
  const qCall = queryPage.calls[0]
  equal(qCall.parsed.pathname, '/api/environments/42/query/', 'run_query: endpoint')
  equal(qCall.body.query.kind, 'HogQLQuery', 'run_query: HogQLQuery body')
  equal(qCall.body.query.query, 'SELECT event, count() AS total FROM events', 'run_query: query text')
  equal(query.data.columns.join(','), 'event,total', 'run_query: columns')
  equal(query.data.results[0][1], 1234, 'run_query: results row')
  equal(query.data.types[1][0], 'total', 'run_query: type pairs')
  equal(query.data.hogql, 'SELECT event, count() AS total FROM events', 'run_query: compiled hogql')

  // --- Soft delete ------------------------------------------------------------

  const deletePage = makePage({
    routes: { ['PATCH /api/environments/' + TEAM + '/dashboards/88/']: { id: 88, deleted: true } },
  })
  const deleted = await runTool('com.posthog.main', 'delete_dashboard', { input: { dashboard_id: 88 }, page: deletePage })
  equal(deleted.status, 'ok', 'delete_dashboard: status')
  const dCall = deletePage.calls[0]
  equal(dCall.method, 'PATCH', 'delete_dashboard: soft deletes with PATCH, not DELETE')
  equal(dCall.parsed.pathname, '/api/environments/42/dashboards/88/', 'delete_dashboard: endpoint')
  equal(dCall.body.deleted, true, 'delete_dashboard: body {deleted: true}')
  equal(deleted.data.success, true, 'delete_dashboard: success flag')

  // --- Failure paths ----------------------------------------------------------

  section('execution: PostHog auth and page-scope failures')
  const loggedOut = makePage({ csrf: null })
  const authFailed = await runTool('com.posthog.main', 'list_dashboards', { input: {}, page: loggedOut })
  equal(authFailed.status, 'error', 'logged out: status error')
  equal(authFailed.error_code, 'AUTH', 'logged out: AUTH error code')
  equal(loggedOut.calls.length, 0, 'logged out: no request sent')
  ok(/log in to PostHog/i.test(authFailed.message), 'logged out: message asks to log in')

  const forbidden = makePage({ routes: { ['GET /api/projects/' + TEAM + '/feature_flags/']: 403 } })
  const forbiddenFlag = await runTool('com.posthog.main', 'list_feature_flags', { input: {}, page: forbidden })
  equal(forbiddenFlag.status, 'error', 'HTTP 403: status error')
  equal(forbiddenFlag.error_code, 'AUTH', 'HTTP 403: classified as AUTH')
  equal(forbidden.calls.length, 1, 'HTTP 403: the request was made')

  const otherPage = makePage({ hostname: 'example.com' })
  const wrongPage = await runTool('com.posthog.main', 'list_projects', { input: {}, page: otherPage })
  equal(wrongPage.status, 'error', 'wrong page: status error')
  equal(wrongPage.error_code, 'UNSUPPORTED_PAGE', 'wrong page: UNSUPPORTED_PAGE')
  equal(otherPage.calls.length, 0, 'wrong page: no request sent')
}
