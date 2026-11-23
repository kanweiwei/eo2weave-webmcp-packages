/**
 * com.mongodb-atlas.main — execution tests against a stubbed Atlas tab.
 *
 * Identity is the CSRF token from `PARAMS.csrfToken` (or the csrf-token meta
 * tag) — exactly what the ported API layer reads. The org/project ids come from
 * `PARAMS.currentOrganization.id` / `PARAMS.currentGroup.id`; writes carry the
 * `X-CSRF-Token` header.
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

const PARAMS = {
  csrfToken: 'atlas-csrf-token',
  appUser: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', emailAddress: 'ada@example.com' },
  currentOrganization: { id: 'org-1' },
  currentGroup: { id: 'grp-1' },
}

function atlasPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'cloud.mongodb.com',
    href: 'https://cloud.mongodb.com/v2/org-1/projects',
    globals: { PARAMS: { ...PARAMS } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  Object.assign(page, extra)
  if (extra.globals) page.globals = { PARAMS: { ...PARAMS }, ...extra.globals }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.mongodb-atlas.main: identity')

  {
    const { requests, page } = atlasPage(() => jsonResponse({}), {
      globals: { PARAMS: {} },
    })
    const result = await runTool('com.mongodb-atlas.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'atlas signed out: error status')
    equal(result.error_code, 'AUTH', 'atlas signed out: AUTH')
    equal(requests.length, 0, 'atlas signed out: makes no request')
  }

  section('com.mongodb-atlas.main: reads')

  {
    const { requests, page } = atlasPage(() =>
      jsonResponse([
        {
          id: 'c-1',
          name: 'prod-cluster',
          clusterType: 'REPLICASET',
          stateName: 'IDLE',
          mongoDBVersion: '7.0.0',
          providerSettings: {
            backingProviderName: 'AWS',
            regionName: 'EU_WEST_1',
            instanceSizeName: 'M10',
          },
        },
      ]),
    )
    const result = await runTool('com.mongodb-atlas.main', 'list_clusters', { input: {}, page })

    equal(result.status, 'ok', 'atlas list_clusters: ok')
    equal(result.data.clusters.length, 1, 'atlas list_clusters: one cluster')
    equal(result.data.clusters[0].name, 'prod-cluster', 'atlas list_clusters: name')
    equal(result.data.clusters[0].state, 'IDLE', 'atlas list_clusters: stateName mapped')
    equal(result.data.clusters[0].provider, 'AWS', 'atlas list_clusters: provider mapped')
    equal(requests.length, 1, 'atlas list_clusters: one request')
    equal(requests[0].url, '/nds/clusters/grp-1', 'atlas list_clusters: project-scoped path')
    equal(requests[0].init.credentials, 'include', 'atlas list_clusters: cookies sent')
  }

  {
    const { page } = atlasPage(() => jsonResponse({ id: 'org-1', name: 'Acme' }))
    const result = await runTool('com.mongodb-atlas.main', 'get_organization', { input: {}, page })
    equal(result.status, 'ok', 'atlas get_organization: ok')
    equal(result.data.organization.id, 'org-1', 'atlas get_organization: id from PARAMS context')
  }

  {
    const { page } = atlasPage(() => jsonResponse({}))
    const result = await runTool('com.mongodb-atlas.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'atlas get_current_user: ok')
    equal(result.data.user.first_name, 'Ada', 'atlas get_current_user: firstName mapped')
    equal(result.data.user.email, 'ada@example.com', 'atlas get_current_user: emailAddress mapped')
  }

  section('com.mongodb-atlas.main: writes')

  {
    const { requests, page } = atlasPage(() =>
      jsonResponse({ userId: 'u-2', username: 'app-reader' }),
    )
    const result = await runTool('com.mongodb-atlas.main', 'create_database_user', {
      input: {
        username: 'app-reader',
        password: 'hunter2',
        roles: [{ role_name: 'read', database_name: 'admin' }],
      },
      page,
    })

    equal(result.status, 'ok', 'atlas create_database_user: ok')
    equal(requests[0].init.method, 'POST', 'atlas create_database_user: POST')
    equal(requests[0].init.headers['X-CSRF-Token'], 'atlas-csrf-token', 'atlas create_database_user: CSRF header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.user, 'app-reader', 'atlas create_database_user: username in body')
    equal(body.groupId, 'grp-1', 'atlas create_database_user: group id from PARAMS')
    equal(body.roles[0].roleName, 'read', 'atlas create_database_user: role mapped')
    equal(body.awsIAMType, 'NONE', 'atlas create_database_user: auth types defaulted')
  }

  section('com.mongodb-atlas.main: failures')

  {
    const { page } = atlasPage(() => jsonResponse({ error: 'nope' }), {
      globals: { PARAMS: { csrfToken: 't', appUser: { id: 'u' } } },
    })
    const result = await runTool('com.mongodb-atlas.main', 'list_clusters', { input: {}, page })
    equal(result.status, 'error', 'atlas no project context: error status')
    equal(result.error_code, 'VALIDATION', 'atlas no project context: VALIDATION')
  }

  {
    const { page } = atlasPage(() => jsonResponse({ error: 'denied' }, 403))
    const result = await runTool('com.mongodb-atlas.main', 'list_clusters', { input: {}, page })
    equal(result.status, 'error', 'atlas 403: error status')
    equal(result.error_code, 'AUTH', 'atlas 403: AUTH')
  }
}
