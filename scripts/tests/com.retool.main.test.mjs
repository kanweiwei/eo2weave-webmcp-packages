// Execution tests for com.retool.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime runs INSIDE the retool.com tab: it reads the CSRF token from the
// page's own `xsrfToken` cookie and calls same-origin /api/... endpoints with
// `credentials: 'include'`. Every test below stubs that page and asserts the exact
// request (path, query, method, headers, body), the parsed output, and the error
// classification for auth / 404 / 429 / validation failures.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const XSRF = 'xsrfToken=csrf-abc123'

const jsonResponse = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? null },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
  async json() {
    return typeof payload === 'string' ? JSON.parse(payload) : payload
  },
})

const emptyResponse = (status = 204) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async text() {
    return ''
  },
  async json() {
    throw new Error('no body')
  },
})

/** A stubbed acme.retool.com tab with the logged-in xsrfToken cookie. */
function rtPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'acme.retool.com',
      origin: 'https://acme.retool.com',
      href: 'https://acme.retool.com/apps',
      cookie: XSRF,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

// Minimal Transit appState (the shape Retool's editor reads): one TextWidget plugin.
const APP_STATE = JSON.stringify([
  null,
  [
    '^ ',
    'v',
    [
      '^ ',
      'plugins',
      [
        '~#iOM',
        [
          'text1',
          [
            '~#iR',
            [
              '^ ',
              'v',
              [
                '^ ',
                'type',
                'widget',
                'subtype',
                'TextWidget',
                'template',
                ['~#iM', ['value', 'hello', 'format', 'markdown']],
                'position2',
                ['~#iR', ['^ ', 'v', ['^ ', 'row', 0, 'col', 1, 'width', 6, 'height', 2]]],
              ],
            ],
          ],
        ],
      ],
    ],
  ],
])

const PAGE_RECORD = {
  id: 41,
  pageId: 7,
  uuid: '11111111-2222-3333-4444-555555555555',
  name: 'Ops Dashboard',
  multiplayerSessionId: 'sess-9',
  isMobileApp: false,
  isGlobalWidget: false,
  data: { appState: APP_STATE },
}

const APP = {
  id: 41,
  name: 'Ops Dashboard',
  uuid: '11111111-2222-3333-4444-555555555555',
  folderId: 3,
  organizationId: 2,
  description: 'Ops',
  isMobileApp: false,
  isGlobalWidget: false,
  isFormApp: false,
  protected: false,
  synced: true,
  accessLevel: 'owner',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
}

const FOLDER = {
  id: 3,
  name: 'ops',
  displayName: 'Ops',
  systemFolder: false,
  folderType: 'app',
  parentFolderId: null,
  organizationId: 2,
  accessLevel: 'owner',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
}

const RESOURCE = {
  id: 12,
  uuid: 'res-uuid-1',
  type: 'postgresql',
  name: 'billing_replica',
  displayName: 'Billing Lifecycle (readonly / replica)',
  protected: false,
  synced: true,
  accessLevel: 'use',
  editorType: 'sql',
  production: { createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  environments: { production: { host: 'db.internal', port: '5432', databaseName: 'billing', options: { ssl: true } } },
}

const WORKFLOW = {
  id: 'wf-1',
  name: 'Nightly sync',
  folderId: 8,
  isEnabled: true,
  accessLevel: 'owner',
  createdAt: '2025-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
}

const RUN = {
  id: 'run-1',
  status: 'success',
  triggerType: 'webhook',
  createdAt: '2026-05-01T00:00:00Z',
  timeTakenToExecuteWorkflow: 1234,
  inputDataSizeBytes: 512,
  outputDataSizeBytes: 2048,
}

export default async function ({ ok, equal, section, runTool }) {
  section('com.retool.main: apps, workflows, resources, queries, writes, auth')

  const pkgDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'packages', 'com.retool.main')
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))

  // --- urlRegex: matches any Retool instance, nothing else ------------------
  {
    const regex = new RegExp(manifest.tools[0].urlRegex)
    const matching = [
      'https://retool.com',
      'https://retool.com/',
      'https://acme.retool.com/apps',
      'https://acme.retool.com/editor/11111111-2222-3333-4444-555555555555?branchName=main',
      'https://acme.retool.com/tree/feat%2Fx/editor/abc#panel',
      'https://eu-1.retool.com/workflows/wf-1',
    ]
    const nonMatching = [
      'http://acme.retool.com/apps',
      'https://acme.retool.com.evil.com/apps',
      'https://retool.com.evil.com/',
      'https://notretool.com/apps',
      'https://evil.com/acme.retool.com',
      'https://retoolXcom/apps',
      'https://retool.com:8443/apps',
    ]
    for (const url of matching) ok(regex.test(url), `urlRegex matches ${url}`)
    for (const url of nonMatching) ok(!regex.test(url), `urlRegex rejects ${url}`)
    equal(manifest.id, 'com.retool.main', 'manifest id')
    equal(manifest.version, '0.1.0', 'manifest version')
    equal(manifest.tools.length, 50, 'manifest ports all 50 tools')
    const distinct = new Set(manifest.tools.map((tool) => tool.urlRegex))
    equal(distinct.size, 1, 'every tool carries the same Retool host pattern')
    const config = JSON.parse(readFileSync(path.join(pkgDir, 'config.json'), 'utf8'))
    equal(JSON.stringify(config), '{}', 'config.json ships no activation override')
  }

  // --- list_apps: apps + folders, CSRF header on a GET ----------------------
  {
    const { requests, page } = rtPage(async () =>
      jsonResponse({ pages: [APP, { id: 42, name: 'bare' }], folders: [FOLDER] }),
    )
    const result = await runTool('com.retool.main', 'list_apps', { input: {}, page })
    equal(result.status, 'ok', 'list_apps: status')
    equal(requests[0].url, '/api/pages', 'list_apps: same-origin /api/pages')
    equal(requests[0].init.method, 'GET', 'list_apps: GET')
    equal(requests[0].init.credentials, 'include', 'list_apps: sends the session cookies')
    equal(requests[0].init.headers['X-Xsrf-Token'], 'csrf-abc123', 'list_apps: X-Xsrf-Token from the cookie')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'list_apps: JSON content type (as upstream)')
    equal(requests[0].init.body, undefined, 'list_apps: no body on GET')
    equal(result.data.apps.length, 2, 'list_apps: every page returned')
    const app = result.data.apps[0]
    equal(app.uuid, APP.uuid, 'list_apps: uuid')
    equal(app.folder_id, 3, 'list_apps: folder_id from folderId')
    equal(app.synced, true, 'list_apps: synced')
    equal(result.data.apps[1].description, '', 'list_apps: missing fields default to empty')
    equal(result.data.folders[0].display_name, 'Ops', 'list_apps: folder display name')
    equal(result.data.folders[0].parent_folder_id, null, 'list_apps: null parent folder stays null')
  }

  // --- list_page_names / get_app / get_app_state ---------------------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({ pageNames: [{ uuid: 'abc', name: 'Ops' }, { uuid: 'def', pageName: 'Legacy' }] }))
    const result = await runTool('com.retool.main', 'list_page_names', { input: {}, page })
    equal(result.status, 'ok', 'list_page_names: status')
    equal(requests[0].url, '/api/editor/pageNames', 'list_page_names: editor endpoint')
    equal(result.data.pages[1].name, 'Legacy', 'list_page_names: falls back to pageName')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse(PAGE_RECORD))
    const result = await runTool('com.retool.main', 'get_app', {
      input: { page_uuid: PAGE_RECORD.uuid },
      page,
    })
    equal(result.status, 'ok', 'get_app: status')
    equal(requests[0].url, `/api/pages/uuids/${PAGE_RECORD.uuid}`, 'get_app: page endpoint')
    // Upstream get_app returns the raw endpoint response as `page` (the other page tools
    // read `data.page`); the port keeps that shape rather than silently re-wrapping it.
    equal(result.data.page.id, 41, 'get_app: raw endpoint envelope')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ page: PAGE_RECORD }))
    const result = await runTool('com.retool.main', 'get_app_state', {
      input: { page_uuid: PAGE_RECORD.uuid },
      page,
    })
    equal(result.status, 'ok', 'get_app_state: status')
    equal(result.data.save_id, 41, 'get_app_state: save id')
    equal(result.data.page_id, 7, 'get_app_state: numeric page id')
    equal(result.data.app_state, APP_STATE, 'get_app_state: Transit app state string')
  }

  // --- get_app_docs: plain text, JSON, and empty bodies -------------------
  {
    const { page } = rtPage(async () => jsonResponse('Runbook: rotate keys weekly.'))
    const result = await runTool('com.retool.main', 'get_app_docs', { input: { page_uuid: 'abc' }, page })
    equal(result.status, 'ok', 'get_app_docs (text): status')
    equal(result.data.documentation, 'Runbook: rotate keys weekly.', 'get_app_docs: plain text body')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ documentation: 'JSON docs' }))
    const result = await runTool('com.retool.main', 'get_app_docs', { input: { page_uuid: 'abc' }, page })
    equal(result.data.documentation, 'JSON docs', 'get_app_docs: documentation field')
  }
  {
    const { page } = rtPage(async () => emptyResponse(200))
    const result = await runTool('com.retool.main', 'get_app_docs', { input: { page_uuid: 'abc' }, page })
    equal(result.data.documentation, '', 'get_app_docs: empty body → empty docs')
  }

  // --- list_components: parses the Transit plugin map ---------------------
  {
    const { page } = rtPage(async () => jsonResponse({ page: PAGE_RECORD }))
    const result = await runTool('com.retool.main', 'list_components', {
      input: { page_uuid: PAGE_RECORD.uuid },
      page,
    })
    equal(result.status, 'ok', 'list_components: status')
    equal(result.data.components.length, 1, 'list_components: one component')
    const component = result.data.components[0]
    equal(component.id, 'text1', 'list_components: component id')
    equal(component.type, 'widget', 'list_components: type')
    equal(component.subtype, 'TextWidget', 'list_components: subtype')
    equal(component.position.row, 0, 'list_components: row')
    equal(component.position.width, 6, 'list_components: width')
    equal(component.properties.value, 'hello', 'list_components: template value')
  }

  // --- add_component: injects into appState and saves ---------------------
  {
    const { requests, page } = rtPage(async (url) =>
      url.endsWith('/save') ? jsonResponse({ save: { id: 42 } }) : jsonResponse({ page: PAGE_RECORD }),
    )
    const result = await runTool('com.retool.main', 'add_component', {
      input: {
        page_uuid: PAGE_RECORD.uuid,
        component_id: 'submitButton',
        component_type: 'ButtonWidget2',
        properties: { text: 'Submit' },
        position: { row: 4, col: 0, width: 3, height: 1 },
      },
      page,
    })
    equal(result.status, 'ok', 'add_component: status')
    equal(requests[1].url, `/api/pages/uuids/${PAGE_RECORD.uuid}/save`, 'add_component: save endpoint')
    equal(requests[1].init.method, 'POST', 'add_component: POST save')
    const body = JSON.parse(requests[1].init.body)
    equal(body.saveValidationInfo.pageSaveId, 41, 'add_component: optimistic-lock save id')
    equal(body.saveValidationInfo.multiplayerSessionId, 'sess-9', 'add_component: multiplayer session')
    equal(body.branchName, null, 'add_component: no branch')
    equal(body.saveAppTesting, false, 'add_component: saveAppTesting flag')
    const nextState = JSON.parse(body.appState)
    // appState[1] = ['^ ', 'v', appMap]; appMap[2] = plugins map; map[1] = [id, record, ...]
    const pluginsMap = nextState[1][2][2]
    equal(pluginsMap[0], '~#iOM', 'add_component: plugins map style')
    equal(pluginsMap[1].length, 4, 'add_component: one more plugin entry (id + record)')
    equal(pluginsMap[1][2], 'submitButton', 'add_component: component id appended')
    // record = ['~#iR', ['^ ', 'n', 'pluginTemplate', 'v', vals]]
    const vals = pluginsMap[1][3][1][4]
    equal(vals[0], '^ ', 'add_component: record keeps the Transit map marker')
    equal(vals[8], 'widget', 'add_component: type widget')
    equal(vals[10], 'ButtonWidget2', 'add_component: subtype ButtonWidget2')
    equal(vals[14], null, 'add_component: no resource name')
    equal(vals[17], 'template', 'add_component: template key')
    equal(vals[18][0], '~#iM', 'add_component: template map')
    equal(vals[18][1][0], 'text', 'add_component: template text entry')
    equal(vals[18][1][1], 'Submit', 'add_component: template text value')
    equal(vals[18][1][2], 'events', 'add_component: events defaulted')
    const posVals = vals[22][1][4]
    equal(posVals[2], 'grid', 'add_component: grid position type')
    equal(posVals[10], 4, 'add_component: row')
    equal(posVals[12], 0, 'add_component: col')
    equal(posVals[14], 1, 'add_component: height')
    equal(posVals[16], 3, 'add_component: width')
    equal(result.data.save_id, 42, 'add_component: new save id')
    equal(result.data.success, true, 'add_component: success flag')
  }

  // --- add_query: resolves the resource, injects a datasource -------------
  {
    const { requests, page } = rtPage(async (url) => {
      if (url === '/api/resources') return jsonResponse({ resources: [RESOURCE] })
      if (url.endsWith('/save')) return jsonResponse({ save: { id: 77 } })
      return jsonResponse({ page: PAGE_RECORD })
    })
    const result = await runTool('com.retool.main', 'add_query', {
      input: {
        page_uuid: PAGE_RECORD.uuid,
        query_id: 'getUsers',
        resource_name: 'Billing Lifecycle (readonly / replica)',
        query_type: 'sql',
        query_string: 'select 1',
        run_on_page_load: true,
      },
      page,
    })
    equal(result.status, 'ok', 'add_query: status')
    equal(requests[1].url, '/api/resources', 'add_query: resolves the resource list')
    const body = JSON.parse(requests[2].init.body)
    const nextState = JSON.parse(body.appState)
    const entries = nextState[1][2][2][1]
    equal(entries[2], 'getUsers', 'add_query: query id appended')
    const vals = entries[3][1][4]
    equal(vals[8], 'datasource', 'add_query: datasource type')
    equal(vals[10], 'RetoolDatabaseQuery', 'add_query: sql subtype')
    equal(vals[14], 'billing_replica', 'add_query: internal resource name')
    const template = vals[18][1]
    equal(template[0], 'query', 'add_query: query key')
    equal(template[1], 'select 1', 'add_query: query text')
    equal(template[2], 'runWhenPageLoads', 'add_query: run-on-load key')
    equal(template[3], true, 'add_query: runWhenPageLoads value')
    equal(result.data.save_id, 77, 'add_query: save id')
  }

  // --- workflows: list, get (branch), runs, log, releases, counts ---------
  {
    const { requests, page } = rtPage(async () =>
      jsonResponse({ workflowsMetadata: [WORKFLOW], workflowFolders: [{ ...FOLDER, id: 8, folderType: 'workflow' }] }),
    )
    const result = await runTool('com.retool.main', 'list_workflows', { input: {}, page })
    equal(result.status, 'ok', 'list_workflows: status')
    equal(requests[0].url, '/api/workflow/', 'list_workflows: trailing-slash endpoint')
    equal(result.data.workflows[0].id, 'wf-1', 'list_workflows: workflow id')
    equal(result.data.workflows[0].is_enabled, true, 'list_workflows: enabled flag')
    equal(result.data.folders[0].folder_type, 'workflow', 'list_workflows: workflow folder')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ id: 'wf-1', blocks: [{ name: 'start' }] }))
    const result = await runTool('com.retool.main', 'get_workflow', {
      input: { workflow_id: 'wf-1', branch_name: 'feat/x' },
      page,
    })
    equal(result.status, 'ok', 'get_workflow: status')
    equal(requests[0].url, '/api/workflow/wf-1?branchName=feat%2Fx', 'get_workflow: branchName query')
    equal(result.data.workflow.blocks.length, 1, 'get_workflow: raw definition')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ id: 'wf-1' }))
    const result = await runTool('com.retool.main', 'get_workflow', { input: { workflow_id: 'wf-1' }, page })
    equal(result.status, 'ok', 'get_workflow (no branch): status')
    equal(result.data.workflow.id, 'wf-1', 'get_workflow (no branch): body')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ rows: [RUN], canLoadMore: true }))
    const result = await runTool('com.retool.main', 'list_workflow_runs', {
      input: { workflow_id: 'wf-1', limit: 5, offset: 10 },
      page,
    })
    equal(result.status, 'ok', 'list_workflow_runs: status')
    equal(requests[0].url, '/api/workflowRun/getRuns?workflowId=wf-1&limit=5&offset=10', 'list_workflow_runs: query')
    equal(requests[0].init.method, 'POST', 'list_workflow_runs: POST without a body')
    equal(requests[0].init.body, undefined, 'list_workflow_runs: no body')
    equal(result.data.runs[0].execution_time_ms, 1234, 'list_workflow_runs: execution time')
    equal(result.data.runs[0].trigger_type, 'webhook', 'list_workflow_runs: trigger type')
    equal(result.data.can_load_more, true, 'list_workflow_runs: can load more')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ rows: [RUN] }))
    const result = await runTool('com.retool.main', 'list_workflow_runs', { input: { workflow_id: 'wf-1' }, page })
    equal(result.status, 'ok', 'list_workflow_runs (defaults): status')
    equal(result.data.can_load_more, false, 'list_workflow_runs (defaults): false when absent')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse(RUN))
    const result = await runTool('com.retool.main', 'get_workflow_run', { input: { run_id: 'run-1' }, page })
    equal(requests[0].url, '/api/workflowRun/run-1', 'get_workflow_run: endpoint')
    equal(result.data.run.id, 'run-1', 'get_workflow_run: id')
    equal(result.data.run.output_data_size_bytes, 2048, 'get_workflow_run: output size')
  }
  {
    const { requests, page } = rtPage(async () =>
      jsonResponse({ status: 'failed', logs: [{ message: 'boom', timestamp: 1700000000000 }] }),
    )
    const result = await runTool('com.retool.main', 'get_workflow_run_log', { input: { run_id: 'run-1' }, page })
    equal(requests[0].url, '/api/workflowRun/getLog?runId=run-1', 'get_workflow_run_log: endpoint')
    equal(result.data.status, 'failed', 'get_workflow_run_log: status')
    equal(result.data.logs[0].message, 'boom', 'get_workflow_run_log: message')
    equal(result.data.logs[0].timestamp, 1700000000000, 'get_workflow_run_log: timestamp')
  }
  {
    const { requests, page } = rtPage(async () =>
      jsonResponse({
        deployedTriggers: [{ id: 't1', triggerType: 'schedule', triggerOptions: { crontab: '0 9 * * *', timezone: 'UTC' }, environmentId: 'env-1' }],
        latestSavedTriggers: [{ id: 't2', triggerType: 'webhook' }],
      }),
    )
    const result = await runTool('com.retool.main', 'list_workflow_triggers', { input: { workflow_id: 'wf-1' }, page })
    equal(requests[0].url, '/api/workflowTrigger?workflowId=wf-1', 'list_workflow_triggers: endpoint')
    equal(result.data.deployed_triggers[0].crontab, '0 9 * * *', 'list_workflow_triggers: crontab')
    equal(result.data.deployed_triggers[0].environment_id, 'env-1', 'list_workflow_triggers: environment')
    equal(result.data.saved_triggers[0].crontab, '', 'list_workflow_triggers: missing options → empty crontab')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse([{ version: 3, deployer: 'ada@acme.com', createdAt: '2026-04-01T00:00:00Z' }]))
    const result = await runTool('com.retool.main', 'get_workflow_releases', { input: { workflow_id: 'wf-1' }, page })
    equal(requests[0].url, '/api/workflow/wf-1/releases', 'get_workflow_releases: endpoint')
    equal(result.data.releases[0].version, 3, 'get_workflow_releases: version')
    equal(result.data.releases[0].deployer, 'ada@acme.com', 'get_workflow_releases: deployer')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ workflowRunsCountByWorkflow: { 'wf-1': { count: 9 }, 'wf-2': { count: '4' } } }))
    const result = await runTool('com.retool.main', 'get_workflow_run_count', { input: {}, page })
    equal(requests[0].url, '/api/workflowRun/getCountByWorkflow', 'get_workflow_run_count: endpoint')
    equal(result.data.counts['wf-1'], 9, 'get_workflow_run_count: numeric count')
    equal(result.data.counts['wf-2'], 4, 'get_workflow_run_count: coerced count')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ version: '1.2.3', codeExecutor: 'py' }))
    const result = await runTool('com.retool.main', 'get_workflows_config', { input: {}, page })
    equal(requests[0].url, '/api/workflow/workflowsConfiguration', 'get_workflows_config: endpoint')
    equal(result.data.config.version, '1.2.3', 'get_workflows_config: config body')
  }

  // --- resources: list, get, create (write), folders ---------------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({ resources: [RESOURCE] }))
    const result = await runTool('com.retool.main', 'list_resources', { input: {}, page })
    equal(requests[0].url, '/api/resources', 'list_resources: endpoint')
    equal(result.data.resources[0].display_name, RESOURCE.displayName, 'list_resources: display name')
    equal(result.data.resources[0].created_at, '2025-01-01T00:00:00Z', 'list_resources: created_at from production')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ resources: [RESOURCE] }))
    const result = await runTool('com.retool.main', 'get_resource', { input: { resource_id: 12 }, page })
    equal(requests[0].url, '/api/resources', 'get_resource: reads the collection')
    equal(result.data.host, 'db.internal', 'get_resource: environment host')
    equal(result.data.database_name, 'billing', 'get_resource: database name')
    equal(result.data.options.ssl, true, 'get_resource: options')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ resources: [] }))
    const result = await runTool('com.retool.main', 'get_resource', { input: { resource_id: 999 }, page })
    equal(result.status, 'error', 'get_resource (missing): error')
    equal(result.error_code, 'NOT_FOUND', 'get_resource (missing): NOT_FOUND')
  }
  {
    const { requests, page } = rtPage(async () =>
      jsonResponse({ id: 34, uuid: 'res-uuid-2', name: 'shipping_api', displayName: 'Shipping API', type: 'restapi' }),
    )
    const result = await runTool('com.retool.main', 'create_resource', {
      input: { display_name: 'Shipping API', type: 'restapi', options: { baseURL: 'https://api.example.com' } },
      page,
    })
    equal(result.status, 'ok', 'create_resource: status')
    equal(requests[0].url, '/api/resources', 'create_resource: resources endpoint')
    equal(requests[0].init.method, 'POST', 'create_resource: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.displayName, 'Shipping API', 'create_resource: displayName')
    equal(body.type, 'restapi', 'create_resource: type')
    equal(body.options.baseURL, 'https://api.example.com', 'create_resource: options passthrough')
    equal(body.resourceFolderId, undefined, 'create_resource: omitted folder is not invented')
    equal(result.data.uuid, 'res-uuid-2', 'create_resource: parsed id')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ id: 34, name: 'x', type: 'restapi' }))
    await runTool('com.retool.main', 'create_resource', {
      input: { display_name: 'X', type: 'restapi', options: {}, folder_id: 5 },
      page,
    })
    const { requests, page: page2 } = rtPage(async () => jsonResponse({ id: 34, name: 'x', type: 'restapi' }))
    await runTool('com.retool.main', 'create_resource', {
      input: { display_name: 'X', type: 'restapi', options: {}, folder_id: 5 },
      page: page2,
    })
    equal(JSON.parse(requests[0].init.body).resourceFolderId, 5, 'create_resource: folder_id forwarded')
  }

  // --- writes: create_app, clone_app, save_page, delete_app, folders -----
  {
    const { requests, page } = rtPage(async () => jsonResponse({ page: { uuid: 'new-uuid' }, save: { id: 900 } }))
    const result = await runTool('com.retool.main', 'create_app', {
      input: { name: 'New App', folder_id: 3 },
      page,
    })
    equal(result.status, 'ok', 'create_app: status')
    equal(requests[0].url, '/api/pages/createPage', 'create_app: createPage endpoint')
    equal(requests[0].init.method, 'POST', 'create_app: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.pageName, 'New App', 'create_app: pageName')
    equal(body.folderId, 3, 'create_app: folderId')
    equal(body.isMobileApp, false, 'create_app: isMobileApp defaults false')
    equal(body.isGlobalWidget, false, 'create_app: isGlobalWidget defaults false')
    equal(result.data.page_uuid, 'new-uuid', 'create_app: page uuid')
    equal(result.data.save_id, 900, 'create_app: save id')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ pageUuid: 'clone-uuid', newPageName: 'Copy' }))
    const result = await runTool('com.retool.main', 'clone_app', {
      input: { page_uuid: PAGE_RECORD.uuid, new_name: 'Copy', folder_id: 4 },
      page,
    })
    equal(requests[0].url, '/api/pages/clonePage', 'clone_app: endpoint')
    const body = JSON.parse(requests[0].init.body)
    equal(body.pageUuid, PAGE_RECORD.uuid, 'clone_app: source page')
    equal(body.newPageName, 'Copy', 'clone_app: new name')
    equal(body.folderId, 4, 'clone_app: folder')
    equal(result.data.new_page_uuid, 'clone-uuid', 'clone_app: result uuid')
  }
  {
    const { requests, page } = rtPage(async (url) =>
      url.endsWith('/save') ? jsonResponse({ save: { id: 55 } }) : jsonResponse({ page: PAGE_RECORD }),
    )
    const result = await runTool('com.retool.main', 'save_page', {
      input: { page_uuid: PAGE_RECORD.uuid, app_state: APP_STATE },
      page,
    })
    equal(result.status, 'ok', 'save_page: status')
    equal(requests[0].url, `/api/pages/uuids/${PAGE_RECORD.uuid}`, 'save_page: reads the current save id first')
    equal(requests[1].url, `/api/pages/uuids/${PAGE_RECORD.uuid}/save`, 'save_page: save endpoint')
    const body = JSON.parse(requests[1].init.body)
    equal(body.appState, APP_STATE, 'save_page: app state forwarded verbatim')
    equal(body.branchName, null, 'save_page: branchName null without a branch')
    equal(body.saveValidationInfo.pageSaveId, 41, 'save_page: optimistic lock')
    equal(result.data.save_id, 55, 'save_page: new save id')
  }
  {
    const scoped = rtPage(async (url) =>
      url.endsWith('/save') ? jsonResponse({ save: { id: 56 } }) : jsonResponse({ page: PAGE_RECORD }),
    )
    const result = await runTool('com.retool.main', 'save_page', {
      input: { page_uuid: PAGE_RECORD.uuid, app_state: APP_STATE, branch_name: 'feat/y' },
      page: scoped.page,
    })
    equal(result.status, 'ok', 'save_page (branch): status')
    equal(result.data.save_id, 56, 'save_page (branch): save id')
    equal(scoped.requests[0].url, `/api/pages/uuids/${PAGE_RECORD.uuid}?branchName=feat%2Fy`, 'save_page: branchName query')
    equal(JSON.parse(scoped.requests[1].init.body).branchName, 'feat/y', 'save_page: branch in the save body')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ success: true }))
    const result = await runTool('com.retool.main', 'delete_app', {
      input: { page_uuid: PAGE_RECORD.uuid },
      page,
    })
    equal(requests[0].url, '/api/pages/deletePage', 'delete_app: endpoint')
    equal(JSON.parse(requests[0].init.body).pageUuid, PAGE_RECORD.uuid, 'delete_app: page uuid body')
    equal(result.data.success, true, 'delete_app: success')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ folder: { ...FOLDER, id: 9, name: 'new' } }))
    const result = await runTool('com.retool.main', 'create_folder', {
      input: { name: 'new', parent_folder_id: 3 },
      page,
    })
    equal(requests[0].url, '/api/folders/createFolder', 'create_folder: endpoint')
    const body = JSON.parse(requests[0].init.body)
    equal(body.folderName, 'new', 'create_folder: folderName')
    equal(body.parentFolderId, 3, 'create_folder: parent')
    equal(body.folderType, 'app', 'create_folder: default type')
    equal(result.data.folder.id, 9, 'create_folder: mapped folder')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ folder: { ...FOLDER, name: 'renamed' } }))
    const result = await runTool('com.retool.main', 'rename_folder', {
      input: { folder_id: 3, new_name: 'renamed' },
      page,
    })
    equal(requests[0].url, '/api/folders/renameFolder', 'rename_folder: endpoint')
    equal(JSON.parse(requests[0].init.body).folderName, 'renamed', 'rename_folder: new name')
    equal(result.data.folder.name, 'renamed', 'rename_folder: mapped folder')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ deletedFolderId: 3 }))
    const result = await runTool('com.retool.main', 'delete_folder', { input: { folder_id: 3 }, page })
    equal(requests[0].url, '/api/folders/deleteFolder', 'delete_folder: endpoint')
    equal(result.data.deleted_folder_id, 3, 'delete_folder: deleted id')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ id: 21, name: 'sub' }))
    const result = await runTool('com.retool.main', 'create_resource_folder', {
      input: { name: 'sub', parent_resource_folder_id: 4 },
      page,
    })
    equal(requests[0].url, '/api/resourceFolders/createResourceFolder', 'create_resource_folder: endpoint')
    equal(JSON.parse(requests[0].init.body).parentResourceFolderId, 4, 'create_resource_folder: parent')
    equal(result.data.folder.id, 21, 'create_resource_folder: mapped folder')
  }
  {
    const { requests, page } = rtPage(async () => emptyResponse(204))
    const result = await runTool('com.retool.main', 'delete_resource_folder', {
      input: { resource_folder_id: 21 },
      page,
    })
    equal(requests[0].url, '/api/resourceFolders/deleteResourceFolder', 'delete_resource_folder: endpoint')
    equal(result.data.success, true, 'delete_resource_folder: success on 204')
  }
  {
    const { requests, page } = rtPage(async () => emptyResponse(204))
    const result = await runTool('com.retool.main', 'move_resource_to_folder', {
      input: { resource_id: 12, resource_folder_id: 21 },
      page,
    })
    equal(requests[0].url, '/api/resourceFolders/moveResourceToFolder', 'move_resource_to_folder: endpoint')
    const body = JSON.parse(requests[0].init.body)
    equal(body.resourceId, 12, 'move_resource_to_folder: resource')
    equal(body.resourceFolderId, 21, 'move_resource_to_folder: folder')
    equal(result.data.success, true, 'move_resource_to_folder: success')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ user: { id: 1, firstName: 'Ada', lastName: 'Lovelace' } }))
    const result = await runTool('com.retool.main', 'change_user_name', {
      input: { first_name: 'Ada', last_name: 'Lovelace' },
      page,
    })
    equal(requests[0].url, '/api/user/changeName', 'change_user_name: endpoint')
    equal(requests[0].init.method, 'POST', 'change_user_name: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.firstName, 'Ada', 'change_user_name: firstName')
    equal(body.lastName, 'Lovelace', 'change_user_name: lastName')
    equal(result.data.user.first_name, 'Ada', 'change_user_name: mapped user')
  }

  // --- queries: run_query / run_grpc -------------------------------------
  {
    const { requests, page } = rtPage(async (url) => {
      if (url === '/api/resources') return jsonResponse({ resources: [RESOURCE] })
      return jsonResponse({ 'select 1': [1] })
    })
    const result = await runTool('com.retool.main', 'run_query', {
      input: { resource_name: 'billing_replica', query: 'select 1' },
      page,
    })
    equal(result.status, 'ok', 'run_query: status')
    equal(requests[1].url, '/api/playground/query', 'run_query: playground endpoint')
    equal(requests[1].init.method, 'POST', 'run_query: POST')
    const body = JSON.parse(requests[1].init.body)
    equal(body.resourceName, 'billing_replica', 'run_query: internal resource name')
    equal(body.queryType, 'SqlQueryUnified', 'run_query: unified SQL query type')
    equal(body.queryTemplate.query, 'select 1', 'run_query: SQL text')
    equal(body.queryTemplate.editorMode, 'sql', 'run_query: editor mode')
    equal(body.environment, 'production', 'run_query: production environment')
    equal(result.data.error, null, 'run_query: no error')
    equal(result.data.data['select 1'][0], 1, 'run_query: result data')
  }
  {
    const { page } = rtPage(async (url) => {
      if (url === '/api/resources') return jsonResponse({ resources: [RESOURCE] })
      return jsonResponse({ error: true, message: 'syntax error at or near "selekt"' })
    })
    const result = await runTool('com.retool.main', 'run_query', {
      input: { resource_name: 'billing_replica', query: 'selekt 1' },
      page,
    })
    equal(result.status, 'ok', 'run_query (error payload): status')
    equal(result.data.data, null, 'run_query (error payload): no data')
    equal(result.data.error, 'syntax error at or near "selekt"', 'run_query: error surfaced in the result')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ resources: [] }))
    const result = await runTool('com.retool.main', 'run_query', {
      input: { resource_name: 'missing', query: 'select 1' },
      page,
    })
    equal(result.error_code, 'NOT_FOUND', 'run_query (unknown resource): NOT_FOUND')
  }
  {
    const { requests, page } = rtPage(async (url) => {
      if (url === '/api/resources') return jsonResponse({ resources: [RESOURCE] })
      return jsonResponse({ plans: [] })
    })
    const result = await runTool('com.retool.main', 'run_grpc', {
      input: { resource_name: 'res-uuid-1', method_name: 'ListPlans', body: '{"page":1}' },
      page,
    })
    equal(result.status, 'ok', 'run_grpc: status')
    const body = JSON.parse(requests[1].init.body)
    equal(body.queryType, 'GRPCQuery', 'run_grpc: gRPC query type')
    equal(body.queryTemplate.serviceName, RESOURCE.displayName, 'run_grpc: service name from the resource')
    equal(body.queryTemplate.methodName, 'ListPlans', 'run_grpc: method name')
    equal(body.queryTemplate.query, '{"page":1}', 'run_grpc: request body')
    equal(body.userParams.methodNameParams, 'ListPlans', 'run_grpc: method name param')
    equal(result.data.error, null, 'run_grpc: no error')
  }

  // --- misc reads --------------------------------------------------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({ agents: [{ id: 1, name: 'Helper', uuid: 'ag-1' }] }))
    const result = await runTool('com.retool.main', 'list_agents', { input: {}, page })
    equal(requests[0].url, '/api/agents', 'list_agents: endpoint')
    equal(result.data.agents[0].name, 'Helper', 'list_agents: name')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse([{ id: 'g1', name: 'orders' }]))
    const result = await runTool('com.retool.main', 'list_grids', { input: {}, page })
    equal(requests[0].url, '/api/grid', 'list_grids: endpoint')
    equal(result.data.grids[0].name, 'orders', 'list_grids: table name')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ environments: [{ id: 'env-1', name: 'production', isDefault: true }] }))
    const result = await runTool('com.retool.main', 'list_environments', { input: {}, page })
    equal(requests[0].url, '/api/environments', 'list_environments: endpoint')
    equal(result.data.environments[0].is_default, true, 'list_environments: default flag')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ branches: [{ name: 'main', createdAt: '2025-01-01T00:00:00Z' }] }))
    const result = await runTool('com.retool.main', 'list_branches', { input: {}, page })
    equal(requests[0].url, '/api/branches', 'list_branches: endpoint')
    equal(result.data.branches[0].name, 'main', 'list_branches: name')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ settings: { enableAutoBranchNaming: true } }))
    const result = await runTool('com.retool.main', 'get_source_control_settings', { input: {}, page })
    equal(requests[0].url, '/api/sourceControl/settings', 'get_source_control_settings: endpoint')
    equal(result.data.settings.enable_auto_branch_naming, true, 'get_source_control_settings: flag')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ userQueries: [{ id: 1, name: 'mine' }], orgQueries: [{ id: 2, name: 'shared', shared: true }] }))
    const result = await runTool('com.retool.main', 'list_playground_queries', { input: {}, page })
    equal(requests[0].url, '/api/playground', 'list_playground_queries: endpoint')
    equal(result.data.user_queries[0].name, 'mine', 'list_playground_queries: user query')
    equal(result.data.org_queries[0].shared, true, 'list_playground_queries: org query')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ user: { id: 1, email: 'ada@acme.com' }, org: { id: 2, name: 'Acme' } }))
    const user = await runTool('com.retool.main', 'get_current_user', { input: {}, page })
    equal(requests[0].url, '/api/user', 'get_current_user: endpoint')
    equal(user.data.user.email, 'ada@acme.com', 'get_current_user: email')
    const org = await runTool('com.retool.main', 'get_organization', { input: {}, page })
    equal(requests[1].url, '/api/organization', 'get_organization: endpoint')
    equal(org.data.organization.name, 'Acme', 'get_organization: name')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ page: { name: 'Ops' }, saves: [{ id: 5, user: { email: 'ada@acme.com' }, isReleased: true }], tags: [{ id: 1, name: 'v1' }] }))
    const saves = await runTool('com.retool.main', 'list_page_saves', { input: { page_uuid: 'p1' }, page })
    equal(requests[0].url, '/api/pages/uuids/p1/saves', 'list_page_saves: endpoint')
    equal(saves.data.saves[0].user_email, 'ada@acme.com', 'list_page_saves: user email')
    const tags = await runTool('com.retool.main', 'list_app_tags', { input: { page_uuid: 'p1' }, page })
    equal(requests[1].url, '/api/pages/uuids/p1/tags', 'list_app_tags: endpoint')
    equal(tags.data.tags[0].name, 'v1', 'list_app_tags: tag name')
    const lookup = await runTool('com.retool.main', 'lookup_app', { input: { page_path: 'ops/dash' }, page })
    equal(requests[2].url, '/api/pages/lookupPage', 'lookup_app: endpoint')
    equal(JSON.parse(requests[2].init.body).pagePath, 'ops/dash', 'lookup_app: page path body')
    // lookup_app (like get_app) hands the raw lookupPage response back as `page`.
    equal(lookup.data.page.page.name, 'Ops', 'lookup_app: page payload')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({ userSpaces: [{ userId: 1, orgId: 2, spaceName: 'Acme' }] }))
    const spaces = await runTool('com.retool.main', 'list_user_spaces', { input: {}, page })
    equal(requests[0].url, '/api/organization/userSpaces', 'list_user_spaces: endpoint')
    equal(spaces.data.spaces[0].space_name, 'Acme', 'list_user_spaces: space name')
  }
  {
    // /api/experiments answers with the flag map itself (upstream returns `data ?? {}`).
    const { requests, page } = rtPage(async () => jsonResponse({ 'flag-a': true, 'flag-b': 'variant' }))
    const experiments = await runTool('com.retool.main', 'list_experiments', { input: {}, page })
    equal(requests[0].url, '/api/experiments', 'list_experiments: endpoint')
    equal(experiments.data.experiments['flag-a'], true, 'list_experiments: flag map')
    equal(experiments.data.experiments['flag-b'], 'variant', 'list_experiments: variant value')
  }

  // --- Toolscript tools: validation before any network call --------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({}))
    const result = await runTool('com.retool.main', 'create_app_from_toolscript_archive', {
      input: { name: 'Imported', folder_id: 3, base64_zip: 'not base64!!' },
      page,
    })
    equal(result.status, 'error', 'create_app_from_toolscript_archive (bad zip): error')
    equal(result.error_code, 'VALIDATION', 'create_app_from_toolscript_archive (bad zip): VALIDATION')
    equal(requests.length, 0, 'create_app_from_toolscript_archive (bad zip): no request')
  }
  {
    const { requests, page } = rtPage(async () => jsonResponse({}))
    const result = await runTool('com.retool.main', 'update_app_from_toolscript_archive', {
      input: { page_uuid: PAGE_RECORD.uuid, base64_zip: 'not base64!!' },
      page,
    })
    equal(result.error_code, 'VALIDATION', 'update_app_from_toolscript_archive (bad zip): VALIDATION')
    equal(requests.length, 0, 'update_app_from_toolscript_archive (bad zip): no request')
  }
  {
    const { requests, page } = rtPage(async (url) =>
      url.indexOf('/export') !== -1
        ? jsonResponse({ uuid: PAGE_RECORD.uuid, page: { name: 'Ops Dashboard' }, modules: {} })
        : jsonResponse({}),
    )
    const result = await runTool('com.retool.main', 'export_toolscript_archive', {
      input: { page_uuid: PAGE_RECORD.uuid, branch_name: 'main' },
      page,
    })
    equal(requests[0].url, `/api/pages/uuids/${PAGE_RECORD.uuid}/export?branch=main`, 'export_toolscript_archive: export endpoint')
    equal(requests[0].init.method, 'POST', 'export_toolscript_archive: POST with no body')
    equal(requests[0].init.body, undefined, 'export_toolscript_archive: bodyless export')
    // The ZIP is produced by Retool's own browser-side serializer, which needs the app's
    // live /assets_vjs chunks; the harness has none, so the call must fail loudly, not
    // silently return an empty archive.
    equal(result.status, 'error', 'export_toolscript_archive: reports a serializer failure')
    equal(result.error_code, 'INTERNAL', 'export_toolscript_archive: INTERNAL when the serializer is unavailable')
    ok(result.message.includes('serializer'), 'export_toolscript_archive: message names the serializer')
  }

  // --- auth failure: no xsrfToken cookie → UNAUTHENTICATED, no request ----
  {
    const { requests, page } = rtPage(async () => jsonResponse({}), { cookie: '' })
    const result = await runTool('com.retool.main', 'list_apps', { input: {}, page })
    equal(result.status, 'error', 'auth missing: error status')
    equal(result.error_code, 'UNAUTHENTICATED', 'auth missing: UNAUTHENTICATED')
    ok(result.message.includes('xsrfToken'), 'auth missing: message names the cookie')
    equal(requests.length, 0, 'auth missing: makes no request')
  }

  // --- auth failure: 401 from the API → AUTH ------------------------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({ message: 'Unauthorized' }, 401))
    const result = await runTool('com.retool.main', 'list_apps', { input: {}, page })
    equal(result.status, 'error', 'auth 401: error status')
    equal(result.error_code, 'AUTH', 'auth 401: AUTH error code')
    ok(result.message.startsWith('Auth error (401)'), 'auth 401: message names the status')
    equal(requests.length, 1, 'auth 401: request was attempted')
  }

  // --- error classification ----------------------------------------------
  {
    const { page } = rtPage(async () => jsonResponse({ message: 'Not Found' }, 404))
    const result = await runTool('com.retool.main', 'get_app', { input: { page_uuid: 'nope' }, page })
    equal(result.error_code, 'NOT_FOUND', '404 → NOT_FOUND')
    ok(result.message.includes('Not found:') && result.message.includes('/api/pages/uuids/nope'), '404: names the endpoint')
  }
  {
    const { page } = rtPage(async () => jsonResponse('slow down', 429, { 'Retry-After': '30' }))
    const result = await runTool('com.retool.main', 'list_workflows', { input: {}, page })
    equal(result.error_code, 'RATE_LIMITED', '429 → RATE_LIMITED')
    ok(result.message.includes('retry after 30'), '429: echoes Retry-After')
  }
  {
    const { page } = rtPage(async () => jsonResponse({ message: 'invalid' }, 422))
    const result = await runTool('com.retool.main', 'create_app', { input: { name: 'x', folder_id: 1 }, page })
    equal(result.error_code, 'VALIDATION', '422 → VALIDATION')
  }
  {
    const { page } = rtPage(async () => jsonResponse('boom', 500))
    const result = await runTool('com.retool.main', 'list_resources', { input: {}, page })
    equal(result.error_code, 'HTTP', '500 → HTTP')
    ok(result.message.includes('500'), '500: message keeps the status')
  }
  {
    const { page } = rtPage(async () => jsonResponse('<html>sign in</html>', 403))
    const result = await runTool('com.retool.main', 'list_resources', { input: {}, page })
    equal(result.error_code, 'AUTH', '403 → AUTH')
  }
  {
    const { page } = rtPage(async () => jsonResponse('not json at all'))
    const result = await runTool('com.retool.main', 'list_resources', { input: {}, page })
    equal(result.error_code, 'PARSE', 'invalid JSON → PARSE')
  }

  // --- wrong host / network failure --------------------------------------
  {
    const { requests, page } = rtPage(async () => jsonResponse({}), { hostname: 'example.com', origin: 'https://example.com' })
    const result = await runTool('com.retool.main', 'list_apps', { input: {}, page })
    equal(result.status, 'error', 'wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'wrong host: makes no request')
  }
  {
    const { page } = rtPage(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await runTool('com.retool.main', 'list_apps', { input: {}, page })
    equal(result.error_code, 'NETWORK', 'network failure → NETWORK')
  }

  // --- cross-section smoke: every tool answers with a real envelope ------
  {
    const smokeInput = {
      page_uuid: PAGE_RECORD.uuid,
      page_path: 'ops/dash',
      workflow_id: 'wf-1',
      run_id: 'run-1',
      resource_id: 12,
      resource_folder_id: 21,
      folder_id: 3,
      parent_folder_id: 3,
      parent_resource_folder_id: 4,
      folder_type: 'app',
      name: 'Smoke',
      new_name: 'Smoke 2',
      display_name: 'Smoke API',
      type: 'restapi',
      options: {},
      first_name: 'Ada',
      last_name: 'Lovelace',
      resource_name: 'billing_replica',
      query: 'select 1',
      query_string: 'select 1',
      query_id: 'smokeQuery',
      query_type: 'RESTQuery',
      method_name: 'ListPlans',
      body: '{}',
      component_id: 'smokeText',
      component_type: 'TextWidget',
      properties: { value: 'hi' },
      position: { row: 0, col: 0, width: 4, height: 1 },
      app_state: APP_STATE,
      base64_zip: 'not base64!!',
      file_name: 'smoke.zip',
      trigger: 'manual',
      limit: 5,
      offset: 0,
    }
    const handler = async (url) => {
      if (url === '/api/resources') return jsonResponse({ resources: [RESOURCE] })
      if (url === '/api/pages') return jsonResponse({ pages: [APP], folders: [FOLDER] })
      if (url.indexOf('/releases') !== -1) return jsonResponse([{ version: 1, deployer: 'ada@acme.com' }])
      if (url === '/api/grid') return jsonResponse([{ id: 'g1', name: 'orders' }])
      if (url.indexOf('/save') !== -1) return jsonResponse({ save: { id: 99 } })
      if (url.indexOf('/export') !== -1) return jsonResponse({ uuid: PAGE_RECORD.uuid, page: { name: 'Ops' }, modules: {} })
      if (url.indexOf('/api/pages/uuids/') === 0) return jsonResponse({ page: PAGE_RECORD })
      if (url.indexOf('/workflowRun/getRuns') === 0) return jsonResponse({ rows: [RUN], canLoadMore: false })
      if (url === '/api/workflow/') return jsonResponse({ workflowsMetadata: [WORKFLOW], workflowFolders: [FOLDER] })
      if (url === '/api/workflow/workflowsConfiguration') return jsonResponse({ version: '1' })
      if (url.indexOf('/api/workflow/') === 0) return jsonResponse({ id: 'wf-1' })
      return jsonResponse({})
    }
    let checked = 0
    for (const tool of manifest.tools) {
      const { page } = rtPage(handler)
      let result
      try {
        result = await runTool('com.retool.main', tool.name, { input: smokeInput, page })
      } catch (error) {
        ok(false, `smoke: ${tool.name} threw — ${error && error.message}`)
        continue
      }
      ok(Boolean(result) && typeof result === 'object', `smoke: ${tool.name} returns an envelope`)
      if (!result) continue
      ok(result.status === 'ok' || result.status === 'error', `smoke: ${tool.name} status is ok/error`)
      if (result.status === 'ok') {
        ok(result.data !== undefined, `smoke: ${tool.name} carries data`)
      } else {
        ok(typeof result.error_code === 'string' && result.error_code.length > 0, `smoke: ${tool.name} carries an error_code`)
      }
      checked++
    }
    equal(checked, manifest.tools.length, 'smoke: every manifest tool was exercised')
  }
}
