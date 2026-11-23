/**
 * com.google-cloud.main — execution tests against a stubbed GCP console tab.
 *
 * Identity is the `gapi.client` page global plus the SAPISID cookie (exactly
 * what the ported API layer reads); REST calls go through
 * `gapi.client.request` with path/params/body asserted from the captured opts.
 */

const captured = []

function makeGapi(result, err) {
  return {
    client: {
      request(opts) {
        captured.push(opts)
        if (err) return Promise.reject(err)
        return Promise.resolve({ result })
      },
    },
  }
}

function gcpPage(extra = {}) {
  captured.length = 0
  const page = {
    hostname: 'console.cloud.google.com',
    href: 'https://console.cloud.google.com/home/dashboard?project=proj-1',
    cookie: 'SAPISID=sapisid-token',
    globals: { gapi: makeGapi({}) },
    fetch: async () => {
      throw new Error('Google Cloud tools use gapi.client.request, not fetch')
    },
  }
  Object.assign(page, extra)
  if (extra.gapi) page.globals.gapi = extra.gapi
  return { captured, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.google-cloud.main: identity')

  {
    // gcpApi gates on the gapi.client page global; a tab without it (not
    // signed in) must reject before any request.
    const { captured, page } = gcpPage({ cookie: '', globals: {} })
    const result = await runTool('com.google-cloud.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'gcloud signed out: error status')
    equal(result.error_code, 'AUTH', 'gcloud signed out: AUTH')
    equal(captured.length, 0, 'gcloud signed out: makes no request')
  }

  section('com.google-cloud.main: reads')

  {
    const { captured, page } = gcpPage({ globals: { gapi: makeGapi({
      projects: [{ projectId: 'proj-1', name: 'My Project', projectNumber: '123' }],
    }) } })
    const result = await runTool('com.google-cloud.main', 'list_projects', { input: {}, page })
    equal(result.status, 'ok', 'gcloud list_projects: ok')
    equal(result.data.projects.length, 1, 'gcloud list_projects: one project')
    equal(result.data.projects[0].project_id, 'proj-1', 'gcloud list_projects: projectId mapped')
    equal(captured.length, 1, 'gcloud list_projects: one gapi call')
    ok(captured[0].path.includes('cloudresourcemanager.googleapis.com'), 'gcloud list_projects: resource manager endpoint')
    equal(captured[0].method, 'GET', 'gcloud list_projects: GET')
  }

  {
    const { captured, page } = gcpPage({ globals: { gapi: makeGapi({
      id: 'inst-1', name: 'web-1', status: 'RUNNING', zone: 'us-central1-a',
    }) } })
    const result = await runTool('com.google-cloud.main', 'get_instance', {
      input: { project_id: 'proj-1', zone: 'us-central1-a', instance_name: 'web-1' },
      page,
    })
    equal(result.status, 'ok', 'gcloud get_instance: ok')
    equal(result.data.instance.name, 'web-1', 'gcloud get_instance: name')
    ok(captured[0].path.includes('/zones/us-central1-a/instances/web-1'), 'gcloud get_instance: zone-scoped path')
  }

  section('com.google-cloud.main: writes')

  {
    const { captured, page } = gcpPage({ globals: { gapi: makeGapi({ status: 'TERMINATED' }) } })
    const result = await runTool('com.google-cloud.main', 'stop_instance', {
      input: { project_id: 'proj-1', zone: 'us-central1-a', instance_name: 'web-1' },
      page,
    })
    equal(result.status, 'ok', 'gcloud stop_instance: ok')
    equal(captured[0].method, 'POST', 'gcloud stop_instance: POST')
    ok(captured[0].path.endsWith('/stop'), 'gcloud stop_instance: :stop verb in path')
  }

  section('com.google-cloud.main: failures')

  {
    const { page } = gcpPage({ globals: { gapi: makeGapi(null, {
      status: 403,
      result: { error: { code: 403, message: 'permission denied' } },
    }) } })
    const result = await runTool('com.google-cloud.main', 'list_instances', {
      input: { project_id: 'proj-1', zone: 'us-central1-a' },
      page,
    })
    equal(result.status, 'error', 'gcloud 403: error status')
    equal(result.error_code, 'AUTH', 'gcloud 403: AUTH')
  }
}
