/**
 * com.hex.main — execution tests against a stubbed Hex tab.
 *
 * Identity is the `launchDarklyContext.user` page global. The GraphQL layer is
 * persisted-operations only: the operation hash is discovered from the loaded
 * static.hex.site bundles (fetched with credentials:'omit'), then posted to
 * same-origin /graphql?op=<name> with x-org-id / x-agent-* headers.
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

const BUNDLE_JS =
  'var t={"GetSafeOrUnknownHexesForHome":"' + 'a'.repeat(64) + '","Me":"' + 'b'.repeat(64) + '","CreateHex":"' + 'c'.repeat(64) + '","GetHexVersion":"' + 'd'.repeat(64) + '","GetLogicSessionId":"' + 'e'.repeat(64) + '"};'

function hexPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'app.hex.tech',
    href: 'https://app.hex.tech/acme/home',
    globals: {
      launchDarklyContext: { user: { hexVersion: '1.2.3' } },
      // Hex transport parses URLs and scans resource timings; the sandbox only
      // gets these when the page provides them.
      URL: globalThis.URL,
      performance: { getEntriesByType: () => [] },
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  // querySelectorAll('script[src]') must surface one static.hex.site bundle so
  // operation-hash discovery has something to scan.
  page.document = extra.document ?? {
    cookie: '',
    title: 'Hex',
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector.includes('script') ? [{ src: 'https://static.hex.site/main.bundle.js' }] : [],
    addEventListener() {},
    body: null,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.hex.main: identity')

  {
    const { requests, page } = hexPage(() => jsonResponse({}), {
      globals: { URL: globalThis.URL, performance: { getEntriesByType: () => [] } },
    })
    const result = await runTool('com.hex.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'hex signed out: error status')
    equal(result.error_code, 'AUTH', 'hex signed out: AUTH')
    ok(
      requests.every((r) => !r.url.includes('/graphql')),
      'hex signed out: no GraphQL calls',
    )
  }

  section('com.hex.main: reads')

  {
    const { requests, page } = hexPage((url) => {
      if (String(url).includes('static.hex.site')) return jsonResponse(BUNDLE_JS)
      return jsonResponse({
        data: {
          safeOrUnknownHexes: {
            edges: [
              {
                node: {
                  id: 'p1',
                  title: 'Churn model',
                  hexType: 'PROJECT',
                  projectLanguage: 'PYTHON',
                  effectiveRole: 'OWNER',
                  dateCreated: '2026-01-01',
                  owner: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
                  creator: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
                },
              },
            ],
            pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c2' },
          },
        },
      })
    })
    const result = await runTool('com.hex.main', 'list_projects', { input: { limit: 5 }, page })
    if (result.status !== 'ok') console.log('HEX PROJECTS', JSON.stringify(result).slice(0, 400))
    equal(result.status, 'ok', 'hex list_projects: ok')
    equal(result.data.org_id, 'acme', 'hex list_projects: org from URL path')
    equal(result.data.projects.length, 1, 'hex list_projects: one project')
    equal(result.data.projects[0].id, 'p1', 'hex list_projects: id mapped')
    equal(result.data.projects[0].title, 'Churn model', 'hex list_projects: title mapped')
    equal(result.data.projects[0].owner.name, 'Ada', 'hex list_projects: owner mapped')
    ok(result.data.projects[0].app_url.includes('/acme/app/p1/latest'), 'hex list_projects: app URL built')
    equal(result.data.page_info.has_next_page, true, 'hex list_projects: pageInfo mapped')
    const gql = requests.find((r) => r.url.includes('/graphql'))
    ok(gql !== undefined, 'hex: GraphQL request made')
    ok(gql.url.includes('op=GetSafeOrUnknownHexesForHome'), 'hex: persisted op name in query')
    equal(gql.init.headers['x-org-id'], 'acme', 'hex: x-org-id header')
    equal(gql.init.headers['x-csrf-safe'], 'safe', 'hex: x-csrf-safe header')
    equal(gql.init.headers['x-agent-version'], '1.2.3', 'hex: agent version from LaunchDarkly')
    ok(
      JSON.parse(gql.init.body).extensions.persistedQuery.sha256Hash.length === 64,
      'hex: discovered operation hash sent',
    )
  }

  {
    const { page } = hexPage((url) => {
      if (String(url).includes('static.hex.site')) return jsonResponse(BUNDLE_JS)
      return jsonResponse({
        data: {
          me: { id: 'u1', name: 'Ada', email: 'ada@example.com', orgRole: 'MEMBER', hasApiAccess: true },
          myOrg: { id: 'org-1', name: 'Acme', allowMagic: true },
        },
      })
    })
    const result = await runTool('com.hex.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('HEX USER', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'hex get_current_user: ok')
    equal(result.data.user.id, 'u1', 'hex get_current_user: user mapped')
    equal(result.data.organization.id, 'org-1', 'hex get_current_user: org mapped')
    equal(result.data.organization.allow_magic, true, 'hex get_current_user: allowMagic mapped')
  }

  section('com.hex.main: writes')

  {
    const { requests, page } = hexPage((url) => {
      if (String(url).includes('static.hex.site')) return jsonResponse(BUNDLE_JS)
      const op = decodeURIComponent(String(url).split('op=')[1]?.split('&')[0] ?? '')
      const body = { data: {} }
      if (op === 'CreateHex') {
        body.data.createHex = { id: 'p-new', title: 'New project', org: { id: 'org-1' } }
      } else if (op === 'GetHexVersion') {
        body.data.hexVersionByNumber = { id: 'v-1', logicSessionId: 'ls-1' }
      } else {
        body.data.hexVersionByNumber = { logicSessionId: 'ls-2' }
      }
      return jsonResponse(body)
    })
    const result = await runTool('com.hex.main', 'create_project', {
      input: { title: 'New project' },
      page,
    })
    if (result.status !== 'ok') console.log('HEX CREATE', JSON.stringify(result).slice(0, 400))
    equal(result.status, 'ok', 'hex create_project: ok')
    equal(result.data.project.id, 'p-new', 'hex create_project: id mapped')
    equal(result.data.project.draft_version_id, 'v-1', 'hex create_project: draft version mapped')
    const create = requests.find((r) => r.url.includes('op=CreateHex'))
    equal(create.init.method, 'POST', 'hex create_project: POST')
    equal(JSON.parse(create.init.body).variables.name, 'New project', 'hex create_project: name variable')
  }

  section('com.hex.main: failures')

  {
    const { page } = hexPage((url) => {
      if (String(url).includes('static.hex.site')) return jsonResponse(BUNDLE_JS)
      return jsonResponse({ errors: [{ message: 'Persisted query not found' }] })
    })
    const result = await runTool('com.hex.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'hex persisted-query error: error status')
  }

  section('com.hex.main: wrong page')

  {
    const { page } = hexPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.hex.main', 'list_projects', { input: {}, page })
    equal(result.status, 'error', 'hex wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'hex wrong host: UNSUPPORTED_PAGE')
  }
}
