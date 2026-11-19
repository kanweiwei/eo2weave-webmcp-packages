// Execution tests for com.terraform-cloud.main (scripts/tests, auto-loaded by
// npm test).
//
// The ported runtime runs INSIDE the app.terraform.io tab: it detects the
// signed-in shell, reads the CSRF token from the hidden authenticity input and
// calls the app's same-origin /api/v2 JSON:API with `credentials: 'include'`.
// Every test below stubs that page and asserts the exact request (URL, query,
// method, headers, body), the parsed output, and the error classification.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const PKG = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  'packages',
  'com.terraform-cloud.main',
)

const CSRF = 'csrf-token-abc'
const JSON_API = 'application/vnd.api+json'

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

const noContentResponse = (status = 204) => ({
  ok: true,
  status,
  headers: { get: () => null },
  async text() {
    return ''
  },
  async json() {
    throw new Error('no body')
  },
})

/**
 * A stubbed app.terraform.io tab. `authenticated: false` omits the sidebar menu
 * marker the upstream plugin uses as its login signal, which is exactly what a
 * logged-out tab looks like.
 */
function tfcPage(handler, { authenticated = true, hostname = 'app.terraform.io' } = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname,
      origin: 'https://' + hostname,
      href: 'https://app.terraform.io/app/acme/workspaces/ws-1',
      globals: {
        document: {
          cookie: '',
          querySelector(selector) {
            if (!authenticated) return null
            if (selector === '[data-test-sidebar-menu-global]') {
              return { getAttribute: () => 'sidebar' }
            }
            if (selector === 'input[name="authenticity_token"]') return { value: CSRF }
            return null
          },
          querySelectorAll: () => [],
        },
      },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
    },
  }
}

const ORG = {
  id: 'acme',
  type: 'organizations',
  attributes: {
    'external-id': 'org-1',
    name: 'acme',
    email: 'ops@acme.dev',
    'created-at': '2024-01-02T03:04:05Z',
    'plan-identifier': 'free_standard',
    'default-execution-mode': 'remote',
    'managed-resource-count': 12,
    'cost-estimation-enabled': true,
    'saml-enabled': false,
  },
}

const WORKSPACE = {
  id: 'ws-1',
  type: 'workspaces',
  attributes: {
    name: 'prod',
    description: 'production',
    'auto-apply': false,
    'created-at': '2024-02-03T04:05:06Z',
    'updated-at': '2026-01-04T05:06:07Z',
    'execution-mode': 'remote',
    locked: false,
    'resource-count': 8,
    'terraform-version': '~> 1.9.0',
    'working-directory': 'infra',
    'vcs-repo': { identifier: 'acme/infra' },
  },
}

const RUN = {
  id: 'run-1',
  type: 'runs',
  attributes: {
    status: 'planned',
    message: 'deploy',
    source: 'tfe-api',
    'created-at': '2026-02-03T04:05:06Z',
    'is-destroy': false,
    'has-changes': true,
    'auto-apply': false,
    'plan-only': true,
    'terraform-version': '1.9.2',
    actions: { 'is-confirmable': true, 'is-cancelable': true, 'is-discardable': true },
  },
}

const STATE_VERSION = {
  id: 'sv-1',
  type: 'state-versions',
  attributes: {
    'created-at': '2026-02-03T04:05:06Z',
    serial: 7,
    status: 'finalized',
    'terraform-version': '1.9.2',
    size: 2048,
    'resources-processed': true,
  },
}

const VARIABLE = {
  id: 'var-1',
  type: 'vars',
  attributes: {
    key: 'DB_PASSWORD',
    value: '',
    sensitive: true,
    category: 'env',
    hcl: false,
    description: 'database password',
  },
}

const PAGINATION = { 'current-page': 2, 'total-pages': 5, 'total-count': 91 }

export default async function ({ ok, equal, section, runTool }) {
  section('com.terraform-cloud.main: organizations, workspaces, runs, state, variables, writes, auth')

  // --- urlRegex: the HCP Terraform app, nothing else ------------------------
  {
    const manifest = JSON.parse(readFileSync(path.join(PKG, 'manifest.json'), 'utf8'))
    equal(manifest.tools.length, 38, 'terraform-cloud: 38 upstream tools')
    for (const tool of manifest.tools) {
      const re = new RegExp(tool.urlRegex)
      ok(re.test('https://app.terraform.io/'), `${tool.name}: urlRegex matches the app root`)
      ok(
        re.test('https://app.terraform.io/app/acme/workspaces/ws-1?tab=runs#latest'),
        `${tool.name}: urlRegex matches a deep link with query and hash`,
      )
      ok(
        !re.test('https://app.terraform.io.evil.com/app/acme'),
        `${tool.name}: urlRegex rejects a host suffix spoof`,
      )
      ok(
        !re.test('https://evil.com/app.terraform.io/app/acme'),
        `${tool.name}: urlRegex rejects a path spoof`,
      )
      ok(
        !re.test('http://app.terraform.io/app/acme'),
        `${tool.name}: urlRegex rejects the http scheme`,
      )
    }
  }

  // --- list_organizations: pagination query + JSON:API mapping --------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({
        data: [ORG],
        meta: { pagination: PAGINATION },
      }),
    )
    const result = await runTool('com.terraform-cloud.main', 'list_organizations', {
      input: { page: 2, page_size: 5 },
      page,
    })
    equal(result.status, 'ok', 'list_organizations: ok envelope')
    equal(
      requests[0].url,
      '/api/v2/organizations?page%5Bnumber%5D=2&page%5Bsize%5D=5',
      'list_organizations: JSON:API bracket pagination',
    )
    equal(requests[0].init.method, 'GET', 'list_organizations: GET')
    equal(requests[0].init.credentials, 'include', 'list_organizations: sends cookies')
    equal(requests[0].init.headers['Content-Type'], JSON_API, 'list_organizations: JSON:API content type')
    equal(
      requests[0].init.headers['X-CSRF-Token'],
      undefined,
      'list_organizations: no CSRF header on a read',
    )
    equal(
      JSON.stringify(result.data.organizations[0]),
      JSON.stringify({
        id: 'acme',
        external_id: 'org-1',
        name: 'acme',
        email: 'ops@acme.dev',
        created_at: '2024-01-02T03:04:05Z',
        plan: 'free_standard',
        execution_mode: 'remote',
        managed_resource_count: 12,
        cost_estimation_enabled: true,
        saml_enabled: false,
      }),
      'list_organizations: organization mapped',
    )
    equal(
      JSON.stringify(result.data.pagination),
      JSON.stringify({ current_page: 2, total_pages: 5, total_count: 91 }),
      'list_organizations: pagination mapped',
    )
  }

  // --- list_workspaces: search filter + vcs_repo ----------------------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({ data: [WORKSPACE], meta: { pagination: PAGINATION } }),
    )
    const result = await runTool('com.terraform-cloud.main', 'list_workspaces', {
      input: { organization: 'acme', search: 'prod' },
      page,
    })
    equal(result.status, 'ok', 'list_workspaces: ok envelope')
    equal(
      requests[0].url,
      '/api/v2/organizations/acme/workspaces?page%5Bnumber%5D=1&page%5Bsize%5D=20&search%5Bname%5D=prod',
      'list_workspaces: defaults page=1,size=20 and sends search[name]',
    )
    equal(result.data.workspaces[0].name, 'prod', 'list_workspaces: name')
    equal(result.data.workspaces[0].vcs_repo, 'acme/infra', 'list_workspaces: vcs-repo identifier')
    equal(result.data.workspaces[0].working_directory, 'infra', 'list_workspaces: working directory')
    equal(result.data.workspaces[0].resource_count, 8, 'list_workspaces: resource count')
  }

  // --- list_runs: actions flags --------------------------------------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({ data: [RUN], meta: { pagination: PAGINATION } }),
    )
    const result = await runTool('com.terraform-cloud.main', 'list_runs', {
      input: { workspace_id: 'ws-1' },
      page,
    })
    equal(result.status, 'ok', 'list_runs: ok envelope')
    equal(requests[0].url, '/api/v2/workspaces/ws-1/runs?page%5Bnumber%5D=1&page%5Bsize%5D=20', 'list_runs: url')
    equal(result.data.runs[0].status, 'planned', 'list_runs: status')
    equal(result.data.runs[0].has_changes, true, 'list_runs: has-changes')
    equal(result.data.runs[0].plan_only, true, 'list_runs: plan-only')
    equal(result.data.runs[0].confirmable, true, 'list_runs: confirmable from actions')
    equal(result.data.runs[0].cancelable, true, 'list_runs: cancelable from actions')
    equal(result.data.runs[0].discardable, true, 'list_runs: discardable from actions')
  }

  // --- list_state_versions: serial/size + pagination ------------------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({ data: [STATE_VERSION], meta: { pagination: PAGINATION } }),
    )
    const result = await runTool('com.terraform-cloud.main', 'list_state_versions', {
      input: { workspace_id: 'ws-1', page_size: 50 },
      page,
    })
    equal(result.status, 'ok', 'list_state_versions: ok envelope')
    equal(
      requests[0].url,
      '/api/v2/workspaces/ws-1/state-versions?page%5Bnumber%5D=1&page%5Bsize%5D=50',
      'list_state_versions: url',
    )
    equal(result.data.state_versions[0].serial, 7, 'list_state_versions: serial')
    equal(result.data.state_versions[0].size, 2048, 'list_state_versions: size')
    equal(result.data.state_versions[0].status, 'finalized', 'list_state_versions: status')
    equal(result.data.pagination.total_count, 91, 'list_state_versions: pagination')
  }

  // --- list_workspace_variables: sensitive value stays blank ----------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({
        data: [
          VARIABLE,
          {
            id: 'var-2',
            type: 'vars',
            attributes: { key: 'REGION', value: 'eu-west-1', category: 'terraform' },
          },
        ],
      }),
    )
    const result = await runTool('com.terraform-cloud.main', 'list_workspace_variables', {
      input: { workspace_id: 'ws-1' },
      page,
    })
    equal(result.status, 'ok', 'list_workspace_variables: ok envelope')
    equal(requests[0].url, '/api/v2/workspaces/ws-1/vars', 'list_workspace_variables: url')
    equal(result.data.variables.length, 2, 'list_workspace_variables: two variables')
    equal(result.data.variables[0].key, 'DB_PASSWORD', 'list_workspace_variables: key')
    equal(result.data.variables[0].sensitive, true, 'list_workspace_variables: sensitive flag')
    equal(result.data.variables[0].value, '', 'list_workspace_variables: sensitive value blank')
    equal(result.data.variables[1].hcl, false, 'list_workspace_variables: missing hcl defaults false')
    equal(result.data.variables[1].description, '', 'list_workspace_variables: missing description defaults')
  }

  // --- create_run: JSON:API body + CSRF -----------------------------------
  {
    const { page, requests } = tfcPage(() => jsonResponse({ data: RUN }, 201))
    const result = await runTool('com.terraform-cloud.main', 'create_run', {
      input: { workspace_id: 'ws-1', message: 'deploy main', plan_only: true },
      page,
    })
    equal(result.status, 'ok', 'create_run: ok envelope')
    equal(requests[0].url, '/api/v2/runs', 'create_run: url')
    equal(requests[0].init.method, 'POST', 'create_run: POST')
    equal(requests[0].init.headers['X-CSRF-Token'], CSRF, 'create_run: CSRF token from the page')
    equal(requests[0].init.headers['Content-Type'], JSON_API, 'create_run: JSON:API content type')
    equal(
      JSON.stringify(JSON.parse(requests[0].init.body)),
      JSON.stringify({
        data: {
          type: 'runs',
          attributes: { message: 'deploy main', 'plan-only': true },
          relationships: { workspace: { data: { id: 'ws-1', type: 'workspaces' } } },
        },
      }),
      'create_run: body drops unspecified attributes, keeps the workspace relationship',
    )
    equal(result.data.run.id, 'run-1', 'create_run: run id')
    equal(result.data.run.status, 'planned', 'create_run: run status')
  }

  // --- create_variable: category enum body --------------------------------
  {
    const { page, requests } = tfcPage(() => jsonResponse({ data: VARIABLE }, 201))
    const result = await runTool('com.terraform-cloud.main', 'create_variable', {
      input: {
        workspace_id: 'ws-1',
        key: 'DB_PASSWORD',
        value: 'hunter2',
        category: 'env',
        sensitive: true,
      },
      page,
    })
    equal(result.status, 'ok', 'create_variable: ok envelope')
    equal(requests[0].url, '/api/v2/workspaces/ws-1/vars', 'create_variable: url')
    equal(requests[0].init.method, 'POST', 'create_variable: POST')
    equal(requests[0].init.headers['X-CSRF-Token'], CSRF, 'create_variable: CSRF token')
    equal(
      JSON.stringify(JSON.parse(requests[0].init.body)),
      JSON.stringify({
        data: {
          type: 'vars',
          attributes: {
            key: 'DB_PASSWORD',
            category: 'env',
            value: 'hunter2',
            sensitive: true,
          },
        },
      }),
      'create_variable: body keeps only supplied attributes, in upstream order',
    )
    equal(result.data.variable.key, 'DB_PASSWORD', 'create_variable: mapped key')
    equal(result.data.variable.sensitive, true, 'create_variable: mapped sensitive')
  }

  // --- update_variable: PATCH with data.id --------------------------------
  {
    const { page, requests } = tfcPage(() =>
      jsonResponse({ data: { ...VARIABLE, attributes: { ...VARIABLE.attributes, value: 'new-secret' } } }),
    )
    const result = await runTool('com.terraform-cloud.main', 'update_variable', {
      input: { variable_id: 'var-1', value: 'new-secret' },
      page,
    })
    equal(result.status, 'ok', 'update_variable: ok envelope')
    equal(requests[0].url, '/api/v2/vars/var-1', 'update_variable: url')
    equal(requests[0].init.method, 'PATCH', 'update_variable: PATCH')
    equal(requests[0].init.headers['X-CSRF-Token'], CSRF, 'update_variable: CSRF token')
    equal(
      JSON.stringify(JSON.parse(requests[0].init.body)),
      JSON.stringify({
        data: { type: 'vars', id: 'var-1', attributes: { value: 'new-secret' } },
      }),
      'update_variable: only the supplied attribute, data.id echoed',
    )
    equal(result.data.variable.value, 'new-secret', 'update_variable: updated value mapped')
  }

  // --- create_workspace: project relationship -----------------------------
  {
    const { page, requests } = tfcPage(() => jsonResponse({ data: WORKSPACE }, 201))
    const result = await runTool('com.terraform-cloud.main', 'create_workspace', {
      input: {
        organization: 'acme',
        name: 'prod',
        project_id: 'prj-1',
        execution_mode: 'remote',
        auto_apply: false,
      },
      page,
    })
    equal(result.status, 'ok', 'create_workspace: ok envelope')
    equal(requests[0].url, '/api/v2/organizations/acme/workspaces', 'create_workspace: url')
    equal(requests[0].init.method, 'POST', 'create_workspace: POST')
    equal(
      JSON.stringify(JSON.parse(requests[0].init.body)),
      JSON.stringify({
        data: {
          type: 'workspaces',
          attributes: { name: 'prod', 'execution-mode': 'remote', 'auto-apply': false },
          relationships: { project: { data: { id: 'prj-1', type: 'projects' } } },
        },
      }),
      'create_workspace: project relationship and kebab-case attributes',
    )
    equal(result.data.workspace.id, 'ws-1', 'create_workspace: mapped id')
    equal(result.data.workspace.vcs_repo, 'acme/infra', 'create_workspace: mapped vcs_repo')
  }

  // --- delete_variable: 204 with no body ---------------------------------
  {
    const { page, requests } = tfcPage(() => noContentResponse())
    const result = await runTool('com.terraform-cloud.main', 'delete_variable', {
      input: { variable_id: 'var-1' },
      page,
    })
    equal(result.status, 'ok', 'delete_variable: ok envelope')
    equal(requests[0].url, '/api/v2/vars/var-1', 'delete_variable: url')
    equal(requests[0].init.method, 'DELETE', 'delete_variable: DELETE')
    equal(requests[0].init.body, undefined, 'delete_variable: no body')
    equal(requests[0].init.headers['X-CSRF-Token'], CSRF, 'delete_variable: CSRF token')
    equal(result.data.success, true, 'delete_variable: success flag for the empty 204')
  }

  // --- logged-out tab: auth is detected before any request ----------------
  {
    const { page, requests } = tfcPage(() => jsonResponse({ data: [] }), { authenticated: false })
    const result = await runTool('com.terraform-cloud.main', 'list_organizations', {
      input: {},
      page,
    })
    equal(result.status, 'error', 'auth: error envelope')
    equal(result.error_code, 'AUTH_ERROR', 'auth: AUTH_ERROR code')
    ok(/not authenticated/i.test(result.message), 'auth: message names the login requirement')
    equal(requests.length, 0, 'auth: no request is issued from a logged-out tab')
  }

  // --- wrong tab: refused before fetch -----------------------------------
  {
    const { page, requests } = tfcPage(() => jsonResponse({ data: [] }), { hostname: 'registry.terraform.io' })
    const result = await runTool('com.terraform-cloud.main', 'get_current_user', {
      input: {},
      page,
    })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'page guard: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'page guard: no request from another host')
  }

  // --- 422 from the API is a validation error, not a generic HTTP one -----
  {
    const { page } = tfcPage(() =>
      jsonResponse(
        { errors: [{ status: '422', title: 'invalid attribute', detail: 'Key has already been taken' }] },
        422,
      ),
    )
    const result = await runTool('com.terraform-cloud.main', 'create_project', {
      input: { organization: 'acme', name: 'infra' },
      page,
    })
    equal(result.status, 'error', 'validation: error envelope')
    equal(result.error_code, 'VALIDATION_ERROR', 'validation: 422 mapped to VALIDATION_ERROR')
    ok(
      /Key has already been taken/.test(result.message),
      'validation: JSON:API detail is surfaced in the message',
    )
  }

  // --- 404 from the API is NOT_FOUND ------------------------------------
  {
    const { page } = tfcPage(() =>
      jsonResponse({ errors: [{ status: '404', title: 'not found' }] }, 404),
    )
    const result = await runTool('com.terraform-cloud.main', 'get_workspace', {
      input: { workspace_id: 'ws-missing' },
      page,
    })
    equal(result.error_code, 'NOT_FOUND', 'not found: 404 mapped to NOT_FOUND')
    ok(/HCP Terraform API error \(404\)/.test(result.message), 'not found: status in the message')
  }
}
