// Execution tests for com.cloudflare.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime runs INSIDE the dash.cloudflare.com tab: it reads the
// anti-forgery token from the page's own `window.bootstrap.atok`, the account
// ID from the /<32-hex>/ path prefix, and calls the dashboard's same-origin
// /api/v4 proxy with `credentials: 'include'`. Every test below stubs that page
// and asserts the exact request (path, query, method, headers, body), the
// parsed output, and the error classification for auth / 4xx / envelope errors.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const ZONE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const RECORD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

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

const envelope = (result, resultInfo) => ({
  success: true,
  errors: [],
  messages: [],
  result,
  ...(resultInfo ? { result_info: resultInfo } : {}),
})

/** A stubbed dash.cloudflare.com page with the dashboard bootstrap global. */
function cfPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'dash.cloudflare.com',
      origin: 'https://dash.cloudflare.com',
      href: `https://dash.cloudflare.com/${ACCOUNT}/example.com`,
      globals: { bootstrap: { atok: 'atok-1700000000-abc' } },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

const ZONE_OBJECT = {
  id: ZONE,
  name: 'example.com',
  status: 'active',
  paused: false,
  type: 'full',
  name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
  plan: { name: 'Free' },
  account: { id: ACCOUNT, name: 'Acme Inc' },
  created_on: '2023-01-01T00:00:00Z',
  modified_on: '2026-02-02T00:00:00Z',
}

const RECORD_OBJECT = {
  id: RECORD,
  type: 'A',
  name: 'www.example.com',
  content: '192.0.2.10',
  proxied: true,
  ttl: 1,
  priority: null,
  comment: null,
  created_on: '2025-01-01T00:00:00Z',
  modified_on: '2025-06-01T00:00:00Z',
}

export default async function ({ ok, equal, section, runTool }) {
  section('com.cloudflare.main: zones, DNS, workers, settings, cache, auth')

  const pkgDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'packages', 'com.cloudflare.main')

  // --- urlRegex: matches the dashboard, nothing else -------------------------
  {
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))
    equal(manifest.id, 'com.cloudflare.main', 'cloudflare manifest id')
    equal(manifest.tools.length, 30, 'cloudflare manifest lists 30 tools')
    const mustMatch = [
      'https://dash.cloudflare.com/',
      `https://dash.cloudflare.com/${ACCOUNT}/home`,
      `https://dash.cloudflare.com/${ACCOUNT}/example.com/dns/records?type=A#row-2`,
      `https://dash.cloudflare.com/${ACCOUNT}/workers/services/view/api/production`,
    ]
    const mustNotMatch = [
      'https://dash.cloudflare.com.evil.com/' + ACCOUNT,
      'https://api.cloudflare.com/client/v4/zones',
      'http://dash.cloudflare.com/' + ACCOUNT,
      'https://www.cloudflare.com/' + ACCOUNT,
    ]
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch) ok(regex.test(url), `cloudflare urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch) ok(!regex.test(url), `cloudflare urlRegex rejects ${url} (${tool.name})`)
    }
  }

  // --- zones: list + filters + pagination mapping ----------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(
        envelope([ZONE_OBJECT], { page: 2, per_page: 50, count: 1, total_count: 1, total_pages: 1 }),
      ),
    )
    const result = await runTool('com.cloudflare.main', 'list_zones', {
      input: { name: 'example.com', status: 'active', page: 2, per_page: 50 },
      page,
    })
    equal(requests.length, 1, 'list_zones: one request')
    equal(requests[0].url, '/api/v4/zones?name=example.com&status=active&page=2&per_page=50', 'list_zones: proxy path + query')
    equal(requests[0].init.method, 'GET', 'list_zones: GET')
    equal(requests[0].init.credentials, 'include', 'list_zones: sends the dashboard cookie')
    equal(requests[0].init.headers['x-atok'], 'atok-1700000000-abc', 'list_zones: x-atok from bootstrap')
    equal(requests[0].init.body, undefined, 'list_zones: no body')
    equal(result.status, 'ok', 'list_zones: ok envelope')
    const zone = result.data.zones[0]
    equal(zone.plan_name, 'Free', 'list_zones: plan mapped')
    equal(zone.account_name, 'Acme Inc', 'list_zones: account mapped')
    equal(zone.paused, false, 'list_zones: paused mapped')
    equal(zone.name_servers.length, 2, 'list_zones: nameservers mapped')
    equal(zone.status, 'active', 'list_zones: status mapped')
    equal(result.data.pagination.total_count, 1, 'list_zones: pagination mapped')
    equal(result.data.pagination.per_page, 50, 'list_zones: per_page from result_info')
  }

  // --- zones: defaults, and the account ID from the path ---------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope([ZONE_OBJECT])))
    const result = await runTool('com.cloudflare.main', 'list_zones', { input: {}, page })
    equal(requests[0].url, '/api/v4/zones?page=1&per_page=20', 'list_zones: default paging')
    equal(result.status, 'ok', 'list_zones: defaults ok')
    equal(result.data.pagination.page, 1, 'list_zones: pagination defaults when result_info missing')
  }

  // --- DNS: read with type/name filters --------------------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(envelope([RECORD_OBJECT], { page: 1, per_page: 50, count: 1, total_count: 7, total_pages: 1 })),
    )
    const result = await runTool('com.cloudflare.main', 'list_dns_records', {
      input: { zone_id: ZONE, type: 'A', name: 'www.example.com' },
      page,
    })
    equal(
      requests[0].url,
      `/api/v4/zones/${ZONE}/dns_records?type=A&name=www.example.com&page=1&per_page=50`,
      'list_dns_records: proxy path + filters',
    )
    equal(result.status, 'ok', 'list_dns_records: ok envelope')
    equal(result.data.records[0].content, '192.0.2.10', 'list_dns_records: content mapped')
    equal(result.data.records[0].proxied, true, 'list_dns_records: proxied mapped')
    equal(result.data.records[0].ttl, 1, 'list_dns_records: ttl mapped')
    equal(result.data.pagination.total_count, 7, 'list_dns_records: total_count mapped')
  }

  // --- workers: account-scoped read ------------------------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(
        envelope([
          {
            id: 'api-gateway',
            created_on: '2024-05-01T00:00:00Z',
            modified_on: '2026-01-02T00:00:00Z',
            etag: 'etag-1',
            usage_model: 'bundled',
            compatibility_date: '2024-04-01',
          },
        ]),
      ),
    )
    const result = await runTool('com.cloudflare.main', 'list_workers', { input: {}, page })
    equal(requests[0].url, `/api/v4/accounts/${ACCOUNT}/workers/scripts`, 'list_workers: account path from URL')
    equal(requests[0].init.headers['x-atok'], 'atok-1700000000-abc', 'list_workers: x-atok header')
    equal(result.status, 'ok', 'list_workers: ok envelope')
    equal(result.data.workers[0].id, 'api-gateway', 'list_workers: id mapped')
    equal(result.data.workers[0].usage_model, 'bundled', 'list_workers: usage_model mapped')
    equal(result.data.workers[0].compatibility_date, '2024-04-01', 'list_workers: compatibility date mapped')
  }

  // --- account ID required ---------------------------------------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope([])), {
      href: 'https://dash.cloudflare.com/',
    })
    const result = await runTool('com.cloudflare.main', 'list_workers', { input: {}, page })
    equal(requests.length, 0, 'list_workers: no request without an account ID')
    equal(result.status, 'error', 'list_workers: validation error')
    equal(result.error_code, 'VALIDATION', 'list_workers: VALIDATION code')
    ok(/account ID/i.test(result.message), 'list_workers: explains the missing account ID')
  }

  // --- write: create DNS record (defaults + omitted optionals) ---------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope(RECORD_OBJECT)))
    const result = await runTool('com.cloudflare.main', 'create_dns_record', {
      input: { zone_id: ZONE, type: 'A', name: 'www', content: '192.0.2.10' },
      page,
    })
    equal(requests[0].url, `/api/v4/zones/${ZONE}/dns_records`, 'create_dns_record: proxy path')
    equal(requests[0].init.method, 'POST', 'create_dns_record: POST')
    equal(requests[0].init.credentials, 'include', 'create_dns_record: sends credentials')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'create_dns_record: JSON body')
    const body = JSON.parse(requests[0].init.body)
    equal(body.ttl, 1, 'create_dns_record: ttl defaults to 1 (automatic)')
    ok(!('proxied' in body), 'create_dns_record: unspecified proxied is omitted')
    ok(!('priority' in body), 'create_dns_record: unspecified priority is omitted')
    ok(!('comment' in body), 'create_dns_record: unspecified comment is omitted')
    equal(result.status, 'ok', 'create_dns_record: ok envelope')
    equal(result.data.id, RECORD, 'create_dns_record: created record mapped')
    equal(result.data.proxied, true, 'create_dns_record: proxied mapped')
  }

  // --- write: create DNS record (explicit optionals) -------------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope(RECORD_OBJECT)))
    await runTool('com.cloudflare.main', 'create_dns_record', {
      input: {
        zone_id: ZONE,
        type: 'MX',
        name: 'example.com',
        content: 'mail.example.com',
        ttl: 120,
        proxied: false,
        priority: 10,
        comment: 'primary mail',
      },
      page,
    })
    const body = JSON.parse(requests[0].init.body)
    equal(body.ttl, 120, 'create_dns_record: explicit ttl kept')
    equal(body.proxied, false, 'create_dns_record: explicit proxied:false kept')
    equal(body.priority, 10, 'create_dns_record: number priority kept as a number')
    equal(body.comment, 'primary mail', 'create_dns_record: comment kept')
    equal(body.type, 'MX', 'create_dns_record: type kept')
  }

  // --- write: update zone setting (PATCH) ------------------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(
        envelope({ id: 'always_use_https', value: 'on', editable: true, modified_on: '2026-03-03T00:00:00Z' }),
      ),
    )
    const result = await runTool('com.cloudflare.main', 'update_zone_setting', {
      input: { zone_id: ZONE, setting_id: 'always_use_https', value: 'on' },
      page,
    })
    equal(requests[0].url, `/api/v4/zones/${ZONE}/settings/always_use_https`, 'update_zone_setting: proxy path')
    equal(requests[0].init.method, 'PATCH', 'update_zone_setting: PATCH')
    equal(JSON.parse(requests[0].init.body).value, 'on', 'update_zone_setting: value in body')
    equal(result.data.id, 'always_use_https', 'update_zone_setting: setting mapped')
    equal(result.data.editable, true, 'update_zone_setting: editable mapped')
  }

  // --- write: purge cache ----------------------------------------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope({ id: 'purge-1' })))
    const result = await runTool('com.cloudflare.main', 'purge_cache', {
      input: { zone_id: ZONE, purge_everything: true, files: ['https://example.com/a.js'] },
      page,
    })
    equal(requests[0].init.method, 'POST', 'purge_cache: POST')
    equal(requests[0].url, `/api/v4/zones/${ZONE}/purge_cache`, 'purge_cache: proxy path')
    equal(JSON.parse(requests[0].init.body).purge_everything, true, 'purge_cache: purge_everything wins')
    ok(!('files' in JSON.parse(requests[0].init.body)), 'purge_cache: files omitted when purging everything')
    equal(result.data.id, 'purge-1', 'purge_cache: purge id mapped')
  }

  // --- write: purge by files -------------------------------------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope({ id: 'purge-2' })))
    await runTool('com.cloudflare.main', 'purge_cache', {
      input: { zone_id: ZONE, files: ['https://example.com/a.js', 'https://example.com/b.css'] },
      page,
    })
    const body = JSON.parse(requests[0].init.body)
    equal(body.files.length, 2, 'purge_cache: file list kept as an array')
    ok(!('purge_everything' in body), 'purge_cache: purge_everything omitted by default')
  }

  // --- auth: no ATOK on the page means no request at all ---------------------
  {
    const { requests, page } = cfPage(() => jsonResponse(envelope([])), { globals: {} })
    const result = await runTool('com.cloudflare.main', 'list_zones', { input: {}, page })
    equal(requests.length, 0, 'logged-out: no request sent')
    equal(result.status, 'error', 'logged-out: error envelope')
    equal(result.error_code, 'AUTH', 'logged-out: AUTH code')
    ok(/log in to Cloudflare/i.test(result.message), 'logged-out: auth message')
  }

  // --- auth: 401 from the proxy ----------------------------------------------
  {
    const { page } = cfPage(() => jsonResponse({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 401))
    const result = await runTool('com.cloudflare.main', 'get_user', { input: {}, page })
    equal(result.status, 'error', '401: error envelope')
    equal(result.error_code, 'AUTH', '401: AUTH code')
    ok(result.message.includes('401'), '401: status in message')
  }

  // --- 429 and 404 classification -------------------------------------------
  {
    const { page } = cfPage(() => jsonResponse('slow down', 429, { 'Retry-After': '2' }))
    const result = await runTool('com.cloudflare.main', 'list_zones', { input: {}, page })
    equal(result.error_code, 'RATE_LIMITED', '429: RATE_LIMITED code')
  }
  {
    const { page } = cfPage(() => jsonResponse({ success: false, errors: [] }, 404))
    const result = await runTool('com.cloudflare.main', 'get_zone', { input: { zone_id: ZONE }, page })
    equal(result.error_code, 'NOT_FOUND', '404: NOT_FOUND code')
  }

  // --- Cloudflare envelope failure ------------------------------------------
  {
    const { page } = cfPage(() =>
      jsonResponse({ success: false, errors: [{ code: 81044, message: 'Record already exists' }], result: null }),
    )
    const result = await runTool('com.cloudflare.main', 'create_dns_record', {
      input: { zone_id: ZONE, type: 'A', name: 'www', content: '192.0.2.10' },
      page,
    })
    equal(result.status, 'error', 'envelope failure: error envelope')
    equal(result.error_code, 'INTERNAL', 'envelope failure: INTERNAL code')
    ok(result.message.includes('[81044]') && result.message.includes('Record already exists'), 'envelope failure: code + message surfaced')
  }

  // --- zone settings + user profile mapping ---------------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(envelope([{ id: 'brotli', value: 'on', editable: true, modified_on: null }])),
    )
    const result = await runTool('com.cloudflare.main', 'get_zone_settings', {
      input: { zone_id: ZONE },
      page,
    })
    equal(requests[0].url, `/api/v4/zones/${ZONE}/settings`, 'get_zone_settings: proxy path')
    equal(result.data.settings[0].value, 'on', 'get_zone_settings: value mapped')
    equal(result.data.settings[0].modified_on, null, 'get_zone_settings: null modified_on kept')
  }
  {
    const { requests, page } = cfPage(() =>
      jsonResponse(
        envelope({
          id: 'user-1',
          email: 'ops@example.com',
          first_name: 'Ada',
          last_name: null,
          username: 'ada',
          two_factor_authentication_enabled: true,
          suspended: false,
          created_on: '2020-01-01T00:00:00Z',
          modified_on: '2026-01-01T00:00:00Z',
        }),
      ),
    )
    const result = await runTool('com.cloudflare.main', 'get_user', { input: {}, page })
    equal(requests[0].url, '/api/v4/user', 'get_user: proxy path')
    equal(result.data.username, 'ada', 'get_user: username mapped')
    equal(result.data.two_factor_enabled, true, 'get_user: 2FA flag renamed')
    equal(result.data.last_name, null, 'get_user: null last name kept')
  }

  // --- graphql: direct POST, { data, errors } shape --------------------------
  {
    const { requests, page } = cfPage(() =>
      jsonResponse({ data: { viewer: { zones: [] } }, errors: null }),
    )
    const result = await runTool('com.cloudflare.main', 'graphql_query', {
      input: { query: '{ viewer { zones { name } } }', variables: { limit: 7 } },
      page,
    })
    equal(requests[0].url, '/api/v4/graphql', 'graphql_query: GraphQL proxy path')
    equal(requests[0].init.method, 'POST', 'graphql_query: POST')
    equal(requests[0].init.headers['x-atok'], 'atok-1700000000-abc', 'graphql_query: x-atok header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.query, '{ viewer { zones { name } } }', 'graphql_query: query body')
    equal(body.variables.limit, 7, 'graphql_query: number variable kept as a number')
    equal(result.status, 'ok', 'graphql_query: ok envelope')
    ok(result.data.data && result.data.data.viewer, 'graphql_query: data unwrapped')
    equal(result.data.errors, null, 'graphql_query: errors null on success')
  }
  {
    const { page } = cfPage(() =>
      jsonResponse({ data: null, errors: [{ message: 'unknown field' }] }),
    )
    const result = await runTool('com.cloudflare.main', 'graphql_query', { input: { query: '{ nope }' }, page })
    equal(result.data.data, null, 'graphql_query: null data kept')
    equal(result.data.errors[0].message, 'unknown field', 'graphql_query: errors passed through')
  }

  // --- every manifest tool resolves to a real workflow -----------------------
  {
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))
    for (const tool of manifest.tools) {
      const source = readFileSync(path.join(pkgDir, tool.path), 'utf8')
      ok(source.includes(`async ${tool.name}(args)`), `cloudflare workflow implements ${tool.name}`)
      ok(source.includes("credentials: 'include'"), `cloudflare workflow sends credentials (${tool.name})`)
    }
  }
}
