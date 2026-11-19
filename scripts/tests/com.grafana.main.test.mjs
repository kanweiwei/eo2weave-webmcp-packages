/**
 * com.grafana.main — execution + urlRegex tests.
 *
 * The ported runtime is exercised against a stubbed Grafana tab: grafanaBootData
 * is the session signal (exactly what upstream reads), fetch records every
 * same-origin /api request, and the parsed envelope is asserted.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

const BOOT = {
  user: { id: 1, login: 'ada', name: 'Ada Lovelace', orgId: 1, isSignedIn: true },
  settings: { buildInfo: { version: '11.3.0' }, appSubUrl: '' },
}

/** A logged-in Grafana tab that answers with `handler(url, init)` and records requests. */
function grafanaPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'grafana.internal',
    href: 'https://grafana.internal/d/abc123/platform',
    globals: { grafanaBootData: BOOT },
    fetch: async (url, init) => {
      requests.push({ url, init })
      return handler(url, init)
    },
    ...extra,
  }
  return { requests, page }
}

/** A tab where nobody is signed in (Grafana still renders its boot data). */
function loggedOutPage(handler) {
  return grafanaPage(handler, {
    globals: {
      grafanaBootData: { user: { id: 0, isSignedIn: false }, settings: {} },
    },
  })
}

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  // --- urlRegex ------------------------------------------------------------
  // Grafana is self-hosted: upstream ships urlPatterns: [] and takes the
  // instance URL from config, so the port must not pin a single host. Every
  // tool must accept an arbitrary instance origin and reject non-http(s) URLs.
  section('urlRegex probe: self-hosted Grafana')

  {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const manifest = JSON.parse(
      readFileSync(path.join(packagesDir, 'com.grafana.main', 'manifest.json'), 'utf8'),
    )
    const mustMatch = [
      'https://grafana.internal/',
      'https://grafana.internal',
      'https://grafana.internal/d/abc123/platform?orgId=1&from=now-6h',
      'http://localhost:3000/',
      'http://127.0.0.1:3000/d/abc/dash?viewPanel=2',
      'https://myorg.grafana.net/d/abc/platform?orgId=1',
      'https://monitoring.example.com/grafana/d/abc123/platform#panel-3',
      'https://metrics.acme.example/alerting/list',
    ]
    const mustNotMatch = [
      'ftp://grafana.internal/',
      'file:///Users/ada/dashboard.json',
      'javascript:alert(1)',
      'https://',
      'grafana.internal/d/abc',
      '',
    ]
    equal(manifest.tools.length, 29, 'grafana: 29 tools in the manifest')
    for (const tool of manifest.tools) {
      ok(tool.urlRegex.startsWith('^') && tool.urlRegex.endsWith('$'), `grafana urlRegex anchored (${tool.name})`)
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch) ok(regex.test(url), `grafana urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch) ok(!regex.test(url), `grafana urlRegex rejects ${url} (${tool.name})`)
    }
  }

  // --- reads ---------------------------------------------------------------
  section('execution: Grafana reads')

  {
    // search_dashboards: /api/search with every upstream query key (folder_uids
    // is sent as folderUIDs, starred only when supplied).
    const { requests, page } = grafanaPage(() =>
      jsonResponse([
        {
          id: 12,
          uid: 'abc123',
          title: 'Platform overview',
          url: '/d/abc123/platform-overview',
          type: 'dash-db',
          tags: ['prod', 'sre'],
          isStarred: true,
          folderUid: 'f1',
          folderTitle: 'Platform',
        },
        { id: 0, uid: 'f1', title: 'Platform', type: 'dash-folder' },
      ]),
    )
    const result = await runTool('com.grafana.main', 'search_dashboards', {
      input: { query: 'platform', tag: 'prod', type: 'dash-db', starred: true, folder_uids: 'f1,f2', limit: 5, page: 2 },
      page,
    })
    equal(result.status, 'ok', 'grafana search_dashboards: status')
    equal(result.message, null, 'grafana search_dashboards: null message on success')
    equal(result.data.dashboards.length, 2, 'grafana search_dashboards: result count')
    equal(result.data.dashboards[0].uid, 'abc123', 'grafana search_dashboards: uid')
    equal(result.data.dashboards[0].is_starred, true, 'grafana search_dashboards: starred flag')
    equal(result.data.dashboards[0].folder_title, 'Platform', 'grafana search_dashboards: folder title')
    equal(result.data.dashboards[0].tags.join(','), 'prod,sre', 'grafana search_dashboards: tags')
    equal(result.data.dashboards[1].type, 'dash-folder', 'grafana search_dashboards: folder row type')
    equal(result.data.dashboards[1].title, 'Platform', 'grafana search_dashboards: folder row title')
    equal(
      requests[0].url,
      'https://grafana.internal/api/search?query=platform&tag=prod&type=dash-db&starred=true&folderUIDs=f1%2Cf2&limit=5&page=2',
      'grafana search_dashboards: /api/search query',
    )
    equal(requests[0].init.method, 'GET', 'grafana search_dashboards: GET')
    equal(requests[0].init.credentials, 'include', 'grafana search_dashboards: sends the session cookie')
    equal(requests[0].init.headers.Accept, 'application/json', 'grafana search_dashboards: JSON accept')
    ok(!('Content-Type' in requests[0].init.headers), 'grafana search_dashboards: no body content type on GET')
  }

  {
    // search_dashboards without filters sends no query string at all.
    const { requests, page } = grafanaPage(() => jsonResponse([]))
    const result = await runTool('com.grafana.main', 'search_dashboards', { input: {}, page })
    equal(result.status, 'ok', 'grafana search_dashboards (bare): status')
    equal(requests[0].url, 'https://grafana.internal/api/search', 'grafana search_dashboards (bare): no query')
  }

  {
    // get_dashboard: full dashboard mapping (meta + panels + tags).
    const { requests, page } = grafanaPage(() =>
      jsonResponse({
        dashboard: {
          uid: 'abc123',
          title: 'Platform overview',
          tags: ['prod'],
          panels: [{ id: 1 }, { id: 2 }, { id: 3 }],
        },
        meta: {
          url: '/d/abc123/platform-overview',
          version: 7,
          folderUid: 'f1',
          folderTitle: 'Platform',
          created: '2026-01-02T03:04:05Z',
          updated: '2026-11-18T09:00:00Z',
          createdBy: 'ada',
          updatedBy: 'grace',
          canSave: true,
          canEdit: true,
          canAdmin: false,
          canDelete: true,
        },
      }),
    )
    const result = await runTool('com.grafana.main', 'get_dashboard', { input: { uid: 'abc123' }, page })
    equal(result.status, 'ok', 'grafana get_dashboard: status')
    equal(result.data.dashboard.uid, 'abc123', 'grafana get_dashboard: uid')
    equal(result.data.dashboard.title, 'Platform overview', 'grafana get_dashboard: title')
    equal(result.data.dashboard.version, 7, 'grafana get_dashboard: version')
    equal(result.data.dashboard.folder_uid, 'f1', 'grafana get_dashboard: folder uid')
    equal(result.data.dashboard.panel_count, 3, 'grafana get_dashboard: panel count')
    equal(result.data.dashboard.can_admin, false, 'grafana get_dashboard: can_admin')
    equal(result.data.dashboard.can_delete, true, 'grafana get_dashboard: can_delete')
    equal(result.data.dashboard.updated_by, 'grace', 'grafana get_dashboard: updated_by')
    equal(result.data.dashboard.url, '/d/abc123/platform-overview', 'grafana get_dashboard: meta url')
    equal(requests[0].url, 'https://grafana.internal/api/dashboards/uid/abc123', 'grafana get_dashboard: endpoint')
  }

  {
    // list_datasources + get_datasource: the legacy /api/datasources shapes.
    const sources = [
      { id: 1, uid: 'prom1', name: 'Prometheus', type: 'prometheus', typeName: 'Prometheus', url: 'http://prom:9090', isDefault: true, readOnly: false, access: 'proxy' },
      { id: 2, uid: 'loki1', name: 'Loki', type: 'loki', typeName: 'Loki', url: 'http://loki:3100', isDefault: false, readOnly: true, access: 'proxy' },
    ]
    const list = grafanaPage(() => jsonResponse(sources))
    const listed = await runTool('com.grafana.main', 'list_datasources', { input: {}, page: list.page })
    equal(listed.status, 'ok', 'grafana list_datasources: status')
    equal(listed.data.datasources.length, 2, 'grafana list_datasources: count')
    equal(listed.data.datasources[0].is_default, true, 'grafana list_datasources: default flag')
    equal(listed.data.datasources[0].type_name, 'Prometheus', 'grafana list_datasources: type name')
    equal(listed.data.datasources[1].read_only, true, 'grafana list_datasources: read-only flag')
    equal(list.requests[0].url, 'https://grafana.internal/api/datasources', 'grafana list_datasources: endpoint')

    const one = grafanaPage(() => jsonResponse(sources[0]))
    const fetched = await runTool('com.grafana.main', 'get_datasource', { input: { uid: 'prom1' }, page: one.page })
    equal(fetched.data.datasource.uid, 'prom1', 'grafana get_datasource: uid')
    equal(fetched.data.datasource.access, 'proxy', 'grafana get_datasource: access')
    equal(one.requests[0].url, 'https://grafana.internal/api/datasources/uid/prom1', 'grafana get_datasource: endpoint')
  }

  {
    // list_alert_rules / get_alert_rule / list_contact_points: the v1
    // provisioning API, not the legacy /api/alerts endpoints.
    const rule = {
      id: 4,
      uid: 'rule-1',
      title: 'High error rate',
      condition: 'C',
      folderUID: 'f1',
      ruleGroup: 'slo',
      execErrState: 'Error',
      noDataState: 'NoData',
      for: '5m',
      isPaused: false,
      updated: '2026-11-01T00:00:00Z',
    }
    const rules = grafanaPage(() => jsonResponse([rule]))
    const listed = await runTool('com.grafana.main', 'list_alert_rules', { input: {}, page: rules.page })
    equal(listed.status, 'ok', 'grafana list_alert_rules: status')
    equal(listed.data.rules.length, 1, 'grafana list_alert_rules: count')
    equal(listed.data.rules[0].folder_uid, 'f1', 'grafana list_alert_rules: folderUID mapping')
    equal(listed.data.rules[0].for_duration, '5m', 'grafana list_alert_rules: for duration')
    equal(listed.data.rules[0].no_data_state, 'NoData', 'grafana list_alert_rules: no-data state')
    equal(
      rules.requests[0].url,
      'https://grafana.internal/api/v1/provisioning/alert-rules',
      'grafana list_alert_rules: endpoint',
    )

    const single = grafanaPage(() => jsonResponse(rule))
    const fetched = await runTool('com.grafana.main', 'get_alert_rule', { input: { uid: 'rule-1' }, page: single.page })
    equal(fetched.data.rule.title, 'High error rate', 'grafana get_alert_rule: title')
    equal(fetched.data.rule.rule_group, 'slo', 'grafana get_alert_rule: rule group')
    equal(
      single.requests[0].url,
      'https://grafana.internal/api/v1/provisioning/alert-rules/rule-1',
      'grafana get_alert_rule: endpoint',
    )

    const points = grafanaPage(() =>
      jsonResponse([{ uid: 'cp-1', name: 'oncall', type: 'email', disableResolveMessage: true, provenance: '' }]),
    )
    const contacts = await runTool('com.grafana.main', 'list_contact_points', { input: {}, page: points.page })
    equal(contacts.data.contact_points[0].name, 'oncall', 'grafana list_contact_points: name')
    equal(
      contacts.data.contact_points[0].disable_resolve_message,
      true,
      'grafana list_contact_points: resolve-message flag',
    )
    equal(
      points.requests[0].url,
      'https://grafana.internal/api/v1/provisioning/contact-points',
      'grafana list_contact_points: endpoint',
    )
  }

  {
    // list_annotations / list_org_users / search_teams: query-key translation
    // (dashboardUID, panelId, perpage, perPage) and the wrapped totals.
    const annotations = grafanaPage(() =>
      jsonResponse([
        { id: 9, dashboardUID: 'abc123', dashboardId: 12, panelId: 3, text: 'deploy', tags: ['deploy'], time: 1700000000000, timeEnd: 0, created: 1700000000000, updated: 1700000000000 },
      ]),
    )
    const listed = await runTool('com.grafana.main', 'list_annotations', {
      input: { dashboard_uid: 'abc123', panel_id: 3, limit: 10, tags: 'deploy,prod', from: 1, to: 2 },
      page: annotations.page,
    })
    equal(listed.data.annotations[0].dashboard_uid, 'abc123', 'grafana list_annotations: dashboard uid')
    equal(listed.data.annotations[0].panel_id, 3, 'grafana list_annotations: panel id')
    equal(
      annotations.requests[0].url,
      'https://grafana.internal/api/annotations?dashboardUID=abc123&panelId=3&limit=10&tags=deploy%2Cprod&from=1&to=2',
      'grafana list_annotations: query keys',
    )

    const users = grafanaPage(() =>
      jsonResponse([{ userId: 3, login: 'grace', email: 'grace@example.com', role: 'Admin', lastSeenAt: '2026-11-01T00:00:00Z', isDisabled: false }]),
    )
    const members = await runTool('com.grafana.main', 'list_org_users', { input: { page: 2, per_page: 50 }, page: users.page })
    equal(members.data.users[0].user_id, 3, 'grafana list_org_users: user id')
    equal(members.data.users[0].role, 'Admin', 'grafana list_org_users: role')
    equal(users.requests[0].url, 'https://grafana.internal/api/org/users?page=2&perpage=50', 'grafana list_org_users: query keys')

    const teams = grafanaPage(() =>
      jsonResponse({ teams: [{ id: 5, uid: 'team-1', name: 'SRE', email: 'sre@example.com', memberCount: 4, orgId: 1 }], totalCount: 1 }),
    )
    const found = await runTool('com.grafana.main', 'search_teams', { input: { query: 'sre', per_page: 25 }, page: teams.page })
    equal(found.data.teams[0].member_count, 4, 'grafana search_teams: member count')
    equal(found.data.total_count, 1, 'grafana search_teams: total count')
    equal(teams.requests[0].url, 'https://grafana.internal/api/teams/search?query=sre&perPage=25', 'grafana search_teams: query keys')

    // list_team_members takes the numeric team id straight into the path.
    const membersPage = grafanaPage(() =>
      jsonResponse([{ userId: 3, login: 'grace', email: 'grace@example.com', name: 'Grace Hopper', permission: 4 }]),
    )
    const teamMembers = await runTool('com.grafana.main', 'list_team_members', {
      input: { team_id: 5 },
      page: membersPage.page,
    })
    equal(teamMembers.status, 'ok', 'grafana list_team_members: status')
    equal(teamMembers.data.members[0].user_id, 3, 'grafana list_team_members: user id')
    equal(teamMembers.data.members[0].permission, 4, 'grafana list_team_members: permission')
    equal(membersPage.requests[0].url, 'https://grafana.internal/api/teams/5/members', 'grafana list_team_members: endpoint')
  }

  // --- writes --------------------------------------------------------------
  section('execution: Grafana writes')

  {
    // create_dashboard: POST /api/dashboards/db with schemaVersion 39, the
    // folder and overwrite:false, panels parsed from the JSON string.
    const { requests, page } = grafanaPage(() =>
      jsonResponse({ uid: 'new1', url: '/d/new1/checkout', version: 1, status: 'success' }),
    )
    const result = await runTool('com.grafana.main', 'create_dashboard', {
      input: { title: 'Checkout', tags: ['prod'], folder_uid: 'f1', panels: '[{"id":1,"type":"timeseries"}]' },
      page,
    })
    equal(result.status, 'ok', 'grafana create_dashboard: status')
    equal(result.data.uid, 'new1', 'grafana create_dashboard: uid')
    equal(result.data.url, '/d/new1/checkout', 'grafana create_dashboard: url')
    equal(result.data.status, 'success', 'grafana create_dashboard: status field')
    equal(requests[0].url, 'https://grafana.internal/api/dashboards/db', 'grafana create_dashboard: endpoint')
    equal(requests[0].init.method, 'POST', 'grafana create_dashboard: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'grafana create_dashboard: JSON body')
    equal(
      requests[0].init.body,
      '{"dashboard":{"title":"Checkout","tags":["prod"],"panels":[{"id":1,"type":"timeseries"}],"schemaVersion":39},"folderUid":"f1","overwrite":false}',
      'grafana create_dashboard: request body',
    )
  }

  {
    // create_dashboard with invalid panels is rejected before any request.
    const { requests, page } = grafanaPage(() => jsonResponse({}))
    const result = await runTool('com.grafana.main', 'create_dashboard', {
      input: { title: 'Broken', panels: '{not json' },
      page,
    })
    equal(result.status, 'error', 'grafana create_dashboard invalid panels: status')
    equal(result.error_code, 'VALIDATION', 'grafana create_dashboard invalid panels: VALIDATION')
    equal(result.message, 'panels must be a valid JSON array', 'grafana create_dashboard invalid panels: message')
    equal(requests.length, 0, 'grafana create_dashboard invalid panels: makes no request')

    // No panels argument: panels defaults to [] and tags to [].
    const bare = grafanaPage(() => jsonResponse({ uid: 'n2', url: '/d/n2/x', version: 1, status: 'success' }))
    await runTool('com.grafana.main', 'create_dashboard', { input: { title: 'Bare' }, page: bare.page })
    equal(
      bare.requests[0].init.body,
      '{"dashboard":{"title":"Bare","tags":[],"panels":[],"schemaVersion":39},"overwrite":false}',
      'grafana create_dashboard: defaults',
    )
  }

  {
    // update_dashboard: reads the current version first, applies the changes and
    // saves with that version (no blind overwrite).
    const { requests, page } = grafanaPage((url) => {
      if (String(url).endsWith('/api/dashboards/uid/abc123')) {
        return jsonResponse({
          dashboard: { uid: 'abc123', title: 'Old title', tags: ['old'], panels: [{ id: 1 }], version: 3 },
          meta: { version: 3, folderUid: 'f1', url: '/d/abc123/old' },
        })
      }
      return jsonResponse({ uid: 'abc123', url: '/d/abc123/new-title', version: 4, status: 'success' })
    })
    const result = await runTool('com.grafana.main', 'update_dashboard', {
      input: { uid: 'abc123', title: 'New title', tags: ['prod'] },
      page,
    })
    equal(result.status, 'ok', 'grafana update_dashboard: status')
    equal(result.data.version, 4, 'grafana update_dashboard: new version')
    equal(requests.length, 2, 'grafana update_dashboard: read then write')
    equal(requests[0].url, 'https://grafana.internal/api/dashboards/uid/abc123', 'grafana update_dashboard: read first')
    equal(requests[1].url, 'https://grafana.internal/api/dashboards/db', 'grafana update_dashboard: save endpoint')
    const body = JSON.parse(requests[1].init.body)
    equal(body.dashboard.title, 'New title', 'grafana update_dashboard: new title')
    equal(body.dashboard.tags.join(','), 'prod', 'grafana update_dashboard: new tags')
    equal(body.dashboard.version, 3, 'grafana update_dashboard: saves the version it read')
    equal(body.dashboard.panels.length, 1, 'grafana update_dashboard: keeps the existing panels')
    equal(body.folderUid, 'f1', 'grafana update_dashboard: keeps the folder')
    equal(body.overwrite, false, 'grafana update_dashboard: no blind overwrite')
  }

  {
    // star / unstar / delete: the exact methods and endpoints per tool.
    const star = grafanaPage(() => jsonResponse({}))
    const starred = await runTool('com.grafana.main', 'star_dashboard', { input: { uid: 'abc123' }, page: star.page })
    equal(starred.data.success, true, 'grafana star_dashboard: success')
    equal(star.requests[0].init.method, 'POST', 'grafana star_dashboard: POST')
    equal(
      star.requests[0].url,
      'https://grafana.internal/api/user/stars/dashboard/uid/abc123',
      'grafana star_dashboard: endpoint',
    )

    const unstar = grafanaPage(() => jsonResponse({ message: 'Dashboard unstarred' }))
    const unstarred = await runTool('com.grafana.main', 'unstar_dashboard', { input: { uid: 'abc123' }, page: unstar.page })
    equal(unstarred.status, 'ok', 'grafana unstar_dashboard: status')
    equal(unstar.requests[0].init.method, 'DELETE', 'grafana unstar_dashboard: DELETE')
    equal(
      unstar.requests[0].url,
      'https://grafana.internal/api/user/stars/dashboard/uid/abc123',
      'grafana unstar_dashboard: endpoint',
    )

    const del = grafanaPage(() => jsonResponse({ title: 'Platform overview' }))
    const deleted = await runTool('com.grafana.main', 'delete_dashboard', { input: { uid: 'abc123' }, page: del.page })
    equal(deleted.data.success, true, 'grafana delete_dashboard: success')
    equal(del.requests[0].init.method, 'DELETE', 'grafana delete_dashboard: DELETE')
    equal(del.requests[0].url, 'https://grafana.internal/api/dashboards/uid/abc123', 'grafana delete_dashboard: endpoint')
  }

  {
    // create_folder / get_folder / delete_folder.
    const created = grafanaPage(() =>
      jsonResponse({ id: 8, uid: 'f9', title: 'Platform', url: '/dashboards/f/f9/platform', created: '2026-11-19T00:00:00Z' }),
    )
    const result = await runTool('com.grafana.main', 'create_folder', {
      input: { title: 'Platform', uid: 'f9' },
      page: created.page,
    })
    equal(result.status, 'ok', 'grafana create_folder: status')
    equal(result.data.folder.uid, 'f9', 'grafana create_folder: uid')
    equal(created.requests[0].init.method, 'POST', 'grafana create_folder: POST')
    equal(created.requests[0].url, 'https://grafana.internal/api/folders', 'grafana create_folder: endpoint')
    equal(created.requests[0].init.body, '{"title":"Platform","uid":"f9"}', 'grafana create_folder: body')

    const bare = grafanaPage(() => jsonResponse({ id: 9, uid: 'auto', title: 'Auto' }))
    await runTool('com.grafana.main', 'create_folder', { input: { title: 'Auto' }, page: bare.page })
    equal(bare.requests[0].init.body, '{"title":"Auto"}', 'grafana create_folder: omits an unspecified uid')

    const fetched = grafanaPage(() => jsonResponse({ id: 8, uid: 'f9', title: 'Platform', createdBy: 'ada' }))
    const folder = await runTool('com.grafana.main', 'get_folder', { input: { uid: 'f9' }, page: fetched.page })
    equal(folder.data.folder.title, 'Platform', 'grafana get_folder: title')
    equal(folder.data.folder.created_by, 'ada', 'grafana get_folder: created_by')
    equal(fetched.requests[0].url, 'https://grafana.internal/api/folders/f9', 'grafana get_folder: endpoint')

    const removed = grafanaPage(() => jsonResponse({ message: 'Folder deleted' }))
    const gone = await runTool('com.grafana.main', 'delete_folder', { input: { uid: 'f9' }, page: removed.page })
    equal(gone.data.success, true, 'grafana delete_folder: success')
    equal(removed.requests[0].init.method, 'DELETE', 'grafana delete_folder: DELETE')
    equal(removed.requests[0].url, 'https://grafana.internal/api/folders/f9', 'grafana delete_folder: endpoint')
  }

  {
    // create_annotation: only the supplied optional fields are sent, and the
    // response id/message are returned.
    const { requests, page } = grafanaPage(() =>
      jsonResponse({ id: 42, message: 'Annotation added' }),
    )
    const result = await runTool('com.grafana.main', 'create_annotation', {
      input: { text: 'Deployed 1.2.3', dashboard_uid: 'abc123', tags: ['deploy'], time: 1700000000000 },
      page,
    })
    equal(result.status, 'ok', 'grafana create_annotation: status')
    equal(result.data.id, 42, 'grafana create_annotation: id')
    equal(result.data.message, 'Annotation added', 'grafana create_annotation: message')
    equal(requests[0].init.method, 'POST', 'grafana create_annotation: POST')
    equal(requests[0].url, 'https://grafana.internal/api/annotations', 'grafana create_annotation: endpoint')
    equal(
      requests[0].init.body,
      '{"text":"Deployed 1.2.3","dashboardUID":"abc123","tags":["deploy"],"time":1700000000000}',
      'grafana create_annotation: body',
    )

    // delete_annotation takes a numeric id straight into the path.
    const del = grafanaPage(() => jsonResponse({ message: 'Annotation deleted' }))
    const deleted = await runTool('com.grafana.main', 'delete_annotation', { input: { id: 42 }, page: del.page })
    equal(deleted.data.success, true, 'grafana delete_annotation: success')
    equal(del.requests[0].init.method, 'DELETE', 'grafana delete_annotation: DELETE')
    equal(del.requests[0].url, 'https://grafana.internal/api/annotations/42', 'grafana delete_annotation: endpoint')
  }

  {
    // delete_alert_rule is the only write on the provisioning API.
    const del = grafanaPage(() => jsonResponse({ message: 'rule deleted' }))
    const deleted = await runTool('com.grafana.main', 'delete_alert_rule', { input: { uid: 'rule-1' }, page: del.page })
    equal(deleted.data.success, true, 'grafana delete_alert_rule: success')
    equal(del.requests[0].init.method, 'DELETE', 'grafana delete_alert_rule: DELETE')
    equal(
      del.requests[0].url,
      'https://grafana.internal/api/v1/provisioning/alert-rules/rule-1',
      'grafana delete_alert_rule: endpoint',
    )
  }

  {
    // list_service_accounts / list_snapshots / list_org_quotas / get_organization
    // / get_user_preferences / get_current_user round out the read surface.
    const accounts = grafanaPage(() =>
      jsonResponse({ serviceAccounts: [{ id: 2, uid: 'sa-1', name: 'ci', login: 'sa-ci', role: 'Admin', isDisabled: false, tokens: 2 }], totalCount: 1 }),
    )
    const listed = await runTool('com.grafana.main', 'list_service_accounts', { input: { query: 'ci' }, page: accounts.page })
    equal(listed.data.service_accounts[0].tokens, 2, 'grafana list_service_accounts: tokens')
    equal(listed.data.total_count, 1, 'grafana list_service_accounts: total count')
    equal(
      accounts.requests[0].url,
      'https://grafana.internal/api/serviceaccounts/search?query=ci',
      'grafana list_service_accounts: endpoint',
    )

    const snapshots = grafanaPage(() =>
      jsonResponse([{ id: 6, name: 'Incident 42', key: 'k1', external: false, expires: '2026-12-01T00:00:00Z' }]),
    )
    const snaps = await runTool('com.grafana.main', 'list_snapshots', { input: {}, page: snapshots.page })
    equal(snaps.data.snapshots[0].key, 'k1', 'grafana list_snapshots: key')
    equal(snapshots.requests[0].url, 'https://grafana.internal/api/dashboard/snapshots', 'grafana list_snapshots: endpoint')

    const quotas = grafanaPage(() => jsonResponse([{ target: 'dashboard', limit: 100, used: 12 }]))
    const quotaResult = await runTool('com.grafana.main', 'list_org_quotas', { input: {}, page: quotas.page })
    equal(quotaResult.data.quotas[0].used, 12, 'grafana list_org_quotas: used')
    equal(quotas.requests[0].url, 'https://grafana.internal/api/org/quotas', 'grafana list_org_quotas: endpoint')

    const org = grafanaPage(() =>
      jsonResponse({ id: 1, name: 'Acme', address: { address1: '1 Main St', city: 'Berlin', zipCode: '10115', country: 'DE' } }),
    )
    const orgResult = await runTool('com.grafana.main', 'get_organization', { input: {}, page: org.page })
    equal(orgResult.data.organization.name, 'Acme', 'grafana get_organization: name')
    equal(orgResult.data.organization.city, 'Berlin', 'grafana get_organization: address city')
    equal(orgResult.data.organization.zip_code, '10115', 'grafana get_organization: zip code')
    equal(org.requests[0].url, 'https://grafana.internal/api/org', 'grafana get_organization: endpoint')

    const prefs = grafanaPage(() =>
      jsonResponse({ theme: 'dark', homeDashboardUID: 'abc123', timezone: 'utc', language: 'en-US' }),
    )
    const prefResult = await runTool('com.grafana.main', 'get_user_preferences', { input: {}, page: prefs.page })
    equal(prefResult.data.preferences.theme, 'dark', 'grafana get_user_preferences: theme')
    equal(prefResult.data.preferences.home_dashboard_uid, 'abc123', 'grafana get_user_preferences: home dashboard')
    equal(prefs.requests[0].url, 'https://grafana.internal/api/user/preferences', 'grafana get_user_preferences: endpoint')

    const user = grafanaPage(() =>
      jsonResponse({
        id: 1,
        uid: 'u1',
        login: 'ada',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        orgId: 1,
        isGrafanaAdmin: true,
        isDisabled: false,
        avatarUrl: '/avatar/1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      }),
    )
    const userResult = await runTool('com.grafana.main', 'get_current_user', { input: {}, page: user.page })
    equal(userResult.data.user.login, 'ada', 'grafana get_current_user: login')
    equal(userResult.data.user.org_id, 1, 'grafana get_current_user: org id')
    equal(userResult.data.user.is_grafana_admin, true, 'grafana get_current_user: admin flag')
    equal(user.requests[0].url, 'https://grafana.internal/api/user', 'grafana get_current_user: endpoint')
    equal(user.requests[0].init.credentials, 'include', 'grafana get_current_user: sends the session cookie')
  }

  // --- failures ------------------------------------------------------------
  section('execution: Grafana auth and HTTP failures')

  {
    // Logged out: grafanaBootData.isSignedIn is false, so the call is refused
    // before any request — exactly upstream's ToolError.auth path.
    const { requests, page } = loggedOutPage(() => jsonResponse({}))
    const result = await runTool('com.grafana.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'grafana logged out: error status')
    equal(result.error_code, 'AUTH', 'grafana logged out: AUTH')
    equal(result.message, 'Not authenticated — please log in to Grafana.', 'grafana logged out: message')
    equal(requests.length, 0, 'grafana logged out: makes no request')
  }

  {
    // A tab that is not Grafana at all: no boot data and a non-Grafana host is
    // refused without touching the network.
    const { requests, page } = grafanaPage(() => jsonResponse({}), {
      hostname: 'github.com',
      href: 'https://github.com/nutstore/eo2weave',
      globals: {},
    })
    const result = await runTool('com.grafana.main', 'list_datasources', { input: {}, page })
    equal(result.status, 'error', 'grafana wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'grafana wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'grafana wrong host: makes no request')
  }

  {
    // A self-hosted instance on a host with no "grafana" in it is still accepted:
    // its own boot data identifies the page, and its appSubUrl puts /api under
    // the instance's mount point instead of the bare origin root.
    const { requests, page } = grafanaPage(() => jsonResponse([]), {
      hostname: 'monitoring.example.com',
      href: 'https://monitoring.example.com/grafana/',
      origin: 'https://monitoring.example.com',
      globals: { grafanaBootData: { user: { id: 1, isSignedIn: true }, settings: { appSubUrl: '/grafana' } } },
    })
    const result = await runTool('com.grafana.main', 'list_datasources', { input: {}, page })
    equal(result.status, 'ok', 'grafana arbitrary host: status')
    equal(
      requests[0].url,
      'https://monitoring.example.com/grafana/api/datasources',
      'grafana arbitrary host: /api under the instance sub-path',
    )
    equal(requests[0].init.credentials, 'include', 'grafana arbitrary host: sends credentials')

    // A trailing slash or a full root_url in appSubUrl normalizes to one prefix.
    const trailing = grafanaPage(() => jsonResponse([]), {
      hostname: 'obs.example.com',
      globals: {
        grafanaBootData: { user: { id: 1, isSignedIn: true }, settings: { appSubUrl: 'https://obs.example.com/obs/' } },
      },
    })
    await runTool('com.grafana.main', 'list_folders', { input: {}, page: trailing.page })
    equal(
      trailing.requests[0].url,
      'https://obs.example.com/obs/api/folders',
      'grafana appSubUrl: normalized, origin kept from the tab',
    )
  }

  {
    // 404 → NOT_FOUND, 403 → AUTH, 500 → HTTP; Grafana's message is surfaced.
    const missing = grafanaPage(() => jsonResponse({ message: 'Dashboard not found' }, 404))
    const notFound = await runTool('com.grafana.main', 'get_dashboard', { input: { uid: 'nope' }, page: missing.page })
    equal(notFound.status, 'error', 'grafana 404: error status')
    equal(notFound.error_code, 'NOT_FOUND', 'grafana 404: NOT_FOUND')
    ok(String(notFound.message).includes('Dashboard not found'), 'grafana 404: surfaces the API message')
    ok(String(notFound.message).includes('(404)'), 'grafana 404: keeps the status')

    const denied = grafanaPage(() => jsonResponse({ message: 'Permission denied' }, 403))
    const forbidden = await runTool('com.grafana.main', 'delete_dashboard', { input: { uid: 'abc123' }, page: denied.page })
    equal(forbidden.error_code, 'AUTH', 'grafana 403: AUTH')

    const broken = grafanaPage(() => jsonResponse({ message: 'boom' }, 500))
    const failed = await runTool('com.grafana.main', 'list_folders', { input: {}, page: broken.page })
    equal(failed.error_code, 'HTTP', 'grafana 500: HTTP')

    // A non-JSON body (e.g. a login redirect) is never reported as data.
    const html = grafanaPage(() => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      async text() {
        return '<!doctype html><html><body>login</body></html>'
      },
      async json() {
        throw new SyntaxError('Unexpected token <')
      },
    }))
    const bad = await runTool('com.grafana.main', 'list_snapshots', { input: {}, page: html.page })
    equal(bad.status, 'error', 'grafana non-JSON: error status')
    equal(bad.error_code, 'VALIDATION', 'grafana non-JSON: VALIDATION')
  }
}
