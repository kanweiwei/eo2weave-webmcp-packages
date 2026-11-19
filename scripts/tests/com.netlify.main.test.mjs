// Execution tests for com.netlify.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime runs INSIDE the app.netlify.com tab: it reads the login
// hint from the page's own `_nf-auth-hint` cookie and calls the dashboard's
// same-origin /access-control/bb-api/api/v1 endpoints with
// `credentials: 'include'`. Every test below stubs that page and asserts the
// exact request (path, query, method, headers, body), the parsed output, and
// the error classification for auth / 404 / 429 / validation failures.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const API = '/access-control/bb-api/api/v1'
const AUTH_COOKIE = '_nf-auth-hint=user-is-likely-authed'

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

/** A stubbed app.netlify.com dashboard page with the logged-in hint cookie. */
function nfPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'app.netlify.com',
      origin: 'https://app.netlify.com',
      href: 'https://app.netlify.com/teams/acme/sites',
      cookie: AUTH_COOKIE,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

const SITE = {
  id: 'site_1',
  name: 'shop',
  state: 'current',
  url: 'http://shop.netlify.app',
  ssl_url: 'https://shop.netlify.app',
  admin_url: 'https://app.netlify.com/sites/shop',
  deploy_url: 'https://shop.netlify.app',
  screenshot_url: 'https://cdn.netlify.com/shot.png',
  custom_domain: 'shop.example.com',
  domain_aliases: ['www.shop.example.com'],
  created_at: '2024-01-02T03:04:05Z',
  updated_at: '2026-02-03T04:05:06Z',
  account_name: 'Acme',
  account_slug: 'acme',
  git_provider: 'github',
  ssl: true,
  force_ssl: true,
  managed_dns: false,
  build_image: 'noble',
  published_deploy: { framework: 'next' },
  build_settings: { repo_url: 'https://github.com/acme/shop', repo_branch: 'main', cmd: 'npm run build' },
}

const DEPLOY = {
  id: 'dep_1',
  site_id: 'site_1',
  state: 'ready',
  name: 'shop',
  url: 'http://dep-1--shop.netlify.app',
  ssl_url: 'https://dep-1--shop.netlify.app',
  deploy_url: 'https://dep-1--shop.netlify.app',
  deploy_ssl_url: 'https://dep-1--shop.netlify.app',
  branch: 'main',
  commit_ref: 'abc123',
  commit_url: 'https://github.com/acme/shop/commit/abc123',
  title: 'Fix cart',
  context: 'production',
  framework: 'next',
  error_message: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:02:00Z',
  published_at: '2026-02-01T00:02:00Z',
  locked: true,
  draft: false,
  skipped: false,
}

const ENV_VAR = {
  key: 'DATABASE_URL',
  scopes: ['builds', 'functions'],
  values: [{ id: 'val_1', value: 'postgres://***', context: 'production', context_parameter: '' }],
  is_secret: true,
  updated_at: '2026-01-05T00:00:00Z',
}

export default async function ({ ok, equal, section, runTool }) {
  section('com.netlify.main: sites, deploys, env vars, hooks, forms, auth')

  // --- urlRegex: matches the dashboard, nothing else -------------------------
  {
    const pkgDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'packages', 'com.netlify.main')
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))
    const regex = new RegExp(manifest.tools[0].urlRegex)
    const matching = [
      'https://app.netlify.com',
      'https://app.netlify.com/',
      'https://app.netlify.com/teams/acme/sites/site_1',
      'https://app.netlify.com/teams/acme/sites?query=shop',
      'https://app.netlify.com/teams/acme#/deploys',
    ]
    const nonMatching = [
      'http://app.netlify.com/',
      'https://app.netlify.com.evil.com/',
      'https://evil.com/app.netlify.com',
      'https://netlify.com/',
      'https://sub.app.netlify.com/',
      'https://app.netlifyxcom/',
    ]
    for (const url of matching) ok(regex.test(url), `urlRegex matches ${url}`)
    for (const url of nonMatching) ok(!regex.test(url), `urlRegex rejects ${url}`)
    equal(manifest.id, 'com.netlify.main', 'manifest id')
    equal(manifest.version, '0.1.0', 'manifest version')
    equal(manifest.tools.length, 40, 'manifest ports all 40 tools')
  }

  // --- list_sites: query passthrough + defensive mapping --------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([SITE, { id: 'site_2', name: 'bare' }]))
    const result = await runTool('com.netlify.main', 'list_sites', {
      input: { account_slug: 'acme', name: 'shop', page: 2, per_page: 50 },
      page,
    })
    equal(result.status, 'ok', 'list_sites: status')
    equal(
      requests[0].url,
      `${API}/acme/sites?page=2&per_page=50&name=shop`,
      'list_sites: same-origin bb-api path with upstream query order',
    )
    equal(requests[0].init.method, 'GET', 'list_sites: GET')
    equal(requests[0].init.credentials, 'include', 'list_sites: sends the session cookies')
    equal(requests[0].init.headers['Content-Type'], undefined, 'list_sites: no body header on GET')
    equal(result.data.items.length, 2, 'list_sites: every site returned')
    const site = result.data.items[0]
    equal(site.id, 'site_1', 'list_sites: id')
    equal(site.admin_url, 'https://app.netlify.com/sites/shop', 'list_sites: admin_url')
    equal(site.custom_domain, 'shop.example.com', 'list_sites: custom_domain')
    equal(site.domain_aliases[0], 'www.shop.example.com', 'list_sites: domain_aliases')
    equal(site.framework, 'next', 'list_sites: framework from published_deploy')
    equal(site.repo_url, 'https://github.com/acme/shop', 'list_sites: repo_url from build_settings')
    equal(site.repo_branch, 'main', 'list_sites: repo_branch')
    equal(site.build_cmd, 'npm run build', 'list_sites: build_cmd')
    equal(site.force_ssl, true, 'list_sites: force_ssl')
    equal(site.model, undefined, 'list_sites: output is mapped, not raw')
    const bare = result.data.items[1]
    equal(bare.custom_domain, '', 'list_sites: missing custom_domain → empty string')
    equal(bare.framework, '', 'list_sites: missing published_deploy → empty framework')
    equal(bare.domain_aliases.length, 0, 'list_sites: missing domain_aliases → []')
  }

  // --- list_sites without filters: no query string at all -------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([]))
    const result = await runTool('com.netlify.main', 'list_sites', { input: { account_slug: 'acme' }, page })
    equal(result.status, 'ok', 'list_sites (no filters): status')
    equal(requests[0].url, `${API}/acme/sites`, 'list_sites (no filters): undefined query keys are dropped')
    equal(result.data.items.length, 0, 'list_sites (no filters): empty list')
  }

  // --- get_site ------------------------------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse(SITE))
    const result = await runTool('com.netlify.main', 'get_site', { input: { site_id: 'site_1' }, page })
    equal(result.status, 'ok', 'get_site: status')
    equal(requests[0].url, `${API}/sites/site_1`, 'get_site: site endpoint')
    equal(result.data.name, 'shop', 'get_site: name')
    equal(result.data.ssl, true, 'get_site: ssl')
    equal(result.data.account_slug, 'acme', 'get_site: account_slug')
  }

  // --- list_deploys: pagination + deploy mapping ----------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([DEPLOY]))
    const result = await runTool('com.netlify.main', 'list_deploys', {
      input: { site_id: 'site_1', per_page: 100 },
      page,
    })
    equal(result.status, 'ok', 'list_deploys: status')
    equal(requests[0].url, `${API}/sites/site_1/deploys?per_page=100`, 'list_deploys: per_page only')
    const deploy = result.data.items[0]
    equal(deploy.id, 'dep_1', 'list_deploys: id')
    equal(deploy.branch, 'main', 'list_deploys: branch')
    equal(deploy.context, 'production', 'list_deploys: context')
    equal(deploy.locked, true, 'list_deploys: locked')
    equal(deploy.error_message, '', 'list_deploys: null error_message → empty string')
    equal(deploy.title, 'Fix cart', 'list_deploys: title')
  }

  // --- get_deploy ----------------------------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse(DEPLOY))
    const result = await runTool('com.netlify.main', 'get_deploy', { input: { deploy_id: 'dep_1' }, page })
    equal(result.status, 'ok', 'get_deploy: status')
    equal(requests[0].url, `${API}/deploys/dep_1`, 'get_deploy: deploy endpoint')
    equal(result.data.commit_ref, 'abc123', 'get_deploy: commit_ref')
    equal(result.data.published_at, '2026-02-01T00:02:00Z', 'get_deploy: published_at')
  }

  // --- restore_deploy: creates a new deploy from an old one -----------------
  {
    const { requests, page } = nfPage(async () => jsonResponse({ ...DEPLOY, id: 'dep_2', state: 'enqueued' }))
    const result = await runTool('com.netlify.main', 'restore_deploy', {
      input: { site_id: 'site_1', deploy_id: 'dep_1' },
      page,
    })
    equal(result.status, 'ok', 'restore_deploy: status')
    equal(requests[0].url, `${API}/sites/site_1/deploys/dep_1/restore`, 'restore_deploy: endpoint')
    equal(requests[0].init.method, 'POST', 'restore_deploy: POST')
    equal(requests[0].init.body, undefined, 'restore_deploy: bodyless POST (upstream sends none)')
    equal(requests[0].init.headers['Content-Type'], undefined, 'restore_deploy: no Content-Type without a body')
    equal(result.data.id, 'dep_2', 'restore_deploy: new deploy id')
    equal(result.data.state, 'enqueued', 'restore_deploy: state')
  }

  // --- create_build: triggers a deploy build -------------------------------
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse({ id: 'build_1', deploy_id: 'dep_3', sha: 'def456', done: false, error: null, created_at: '2026-02-04T00:00:00Z' }),
    )
    const result = await runTool('com.netlify.main', 'create_build', { input: { site_id: 'site_1' }, page })
    equal(result.status, 'ok', 'create_build: status')
    equal(requests[0].url, `${API}/sites/site_1/builds`, 'create_build: builds endpoint')
    equal(requests[0].init.method, 'POST', 'create_build: POST')
    equal(result.data.deploy_id, 'dep_3', 'create_build: deploy_id')
    equal(result.data.done, false, 'create_build: done')
    equal(result.data.error, '', 'create_build: null error → empty string')
  }

  // --- lock_deploy: write with no body -------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse({ ...DEPLOY, locked: true }))
    const result = await runTool('com.netlify.main', 'lock_deploy', { input: { deploy_id: 'dep_1' }, page })
    equal(result.status, 'ok', 'lock_deploy: status')
    equal(requests[0].url, `${API}/deploys/dep_1/lock`, 'lock_deploy: endpoint')
    equal(requests[0].init.method, 'POST', 'lock_deploy: POST')
    equal(result.data.locked, true, 'lock_deploy: locked')
  }

  // --- list_env_vars: site scoping ----------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([ENV_VAR]))
    const result = await runTool('com.netlify.main', 'list_env_vars', {
      input: { account_id: 'acc_1', site_id: 'site_1' },
      page,
    })
    equal(result.status, 'ok', 'list_env_vars: status')
    equal(requests[0].url, `${API}/accounts/acc_1/env?site_id=site_1`, 'list_env_vars: site_id query')
    const variable = result.data.items[0]
    equal(variable.key, 'DATABASE_URL', 'list_env_vars: key')
    equal(variable.is_secret, true, 'list_env_vars: is_secret')
    equal(variable.scopes.join(','), 'builds,functions', 'list_env_vars: scopes')
    equal(variable.values[0].context, 'production', 'list_env_vars: value context')
    equal(variable.values[0].context_parameter, '', 'list_env_vars: context_parameter')
  }

  // --- get_env_var: key is URL-encoded ------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse(ENV_VAR))
    const result = await runTool('com.netlify.main', 'get_env_var', {
      input: { account_id: 'acc_1', key: 'API KEY' },
      page,
    })
    equal(result.status, 'ok', 'get_env_var: status')
    equal(requests[0].url, `${API}/accounts/acc_1/env/API%20KEY`, 'get_env_var: encodeURIComponent(key)')
    equal(result.data.key, 'DATABASE_URL', 'get_env_var: mapped variable')
  }

  // --- create_env_vars: the JSON body is the variables array --------------
  {
    const variables = [
      { key: 'NODE_ENV', values: [{ value: 'production', context: 'production' }] },
      { key: 'DEBUG', scopes: ['builds'], values: [{ value: 'false', context: 'all' }], is_secret: false },
    ]
    const { requests, page } = nfPage(async () => jsonResponse([{ key: 'NODE_ENV', values: [], scopes: [], is_secret: false, updated_at: '' }]))
    const result = await runTool('com.netlify.main', 'create_env_vars', {
      input: { account_id: 'acc_1', site_id: 'site_1', variables },
      page,
    })
    equal(result.status, 'ok', 'create_env_vars: status')
    equal(requests[0].url, `${API}/accounts/acc_1/env?site_id=site_1`, 'create_env_vars: site-scoped collection')
    equal(requests[0].init.method, 'POST', 'create_env_vars: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'create_env_vars: JSON content type')
    equal(JSON.stringify(JSON.parse(requests[0].init.body)), JSON.stringify(variables), 'create_env_vars: body is the raw variables array')
    equal(result.data.items[0].key, 'NODE_ENV', 'create_env_vars: parsed result')
  }

  // --- update_env_var: PUT replaces values --------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse({ ...ENV_VAR, is_secret: false }))
    const result = await runTool('com.netlify.main', 'update_env_var', {
      input: {
        account_id: 'acc_1',
        key: 'DATABASE_URL',
        site_id: 'site_1',
        values: [{ value: 'postgres://db', context: 'all' }],
        is_secret: false,
      },
      page,
    })
    equal(result.status, 'ok', 'update_env_var: status')
    equal(requests[0].url, `${API}/accounts/acc_1/env/DATABASE_URL?site_id=site_1`, 'update_env_var: encoded key + site')
    equal(requests[0].init.method, 'PUT', 'update_env_var: PUT')
    const body = JSON.parse(requests[0].init.body)
    equal(body.values[0].value, 'postgres://db', 'update_env_var: new value')
    equal(body.is_secret, false, 'update_env_var: is_secret forwarded')
    equal(body.scopes, undefined, 'update_env_var: omitted scopes are not invented')
    equal(result.data.is_secret, false, 'update_env_var: parsed result')
  }

  // --- delete_env_var: DELETE + 204 ---------------------------------------
  {
    const { requests, page } = nfPage(async () => emptyResponse(204))
    const result = await runTool('com.netlify.main', 'delete_env_var', {
      input: { account_id: 'acc_1', key: 'OLD_FLAG' },
      page,
    })
    equal(result.status, 'ok', 'delete_env_var: status')
    equal(requests[0].url, `${API}/accounts/acc_1/env/OLD_FLAG`, 'delete_env_var: endpoint')
    equal(requests[0].init.method, 'DELETE', 'delete_env_var: DELETE')
    equal(result.data.success, true, 'delete_env_var: success flag on 204')
  }

  // --- notification hooks -------------------------------------------------
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([
        {
          id: 'hook_1',
          site_id: 'site_1',
          type: 'url',
          event: 'deploy_failed',
          data: { url: 'https://example.com/hook' },
          created_at: '2025-12-01T00:00:00Z',
          updated_at: '2025-12-01T00:00:00Z',
          disabled: false,
        },
      ]),
    )
    const result = await runTool('com.netlify.main', 'list_hooks', { input: { site_id: 'site_1' }, page })
    equal(result.status, 'ok', 'list_hooks: status')
    equal(requests[0].url, `${API}/hooks?site_id=site_1`, 'list_hooks: site_id query')
    equal(result.data.items[0].event, 'deploy_failed', 'list_hooks: event')
    equal(result.data.items[0].data.url, 'https://example.com/hook', 'list_hooks: hook data')
  }

  // --- build hooks: list + create ----------------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([{ id: 'bh_1', title: 'Nightly', branch: 'main', url: 'https://api.netlify.com/build_hooks/bh_1', site_id: 'site_1', created_at: '2026-01-01T00:00:00Z' }]))
    const list = await runTool('com.netlify.main', 'list_build_hooks', { input: { site_id: 'site_1' }, page })
    equal(list.status, 'ok', 'list_build_hooks: status')
    equal(requests[0].url, `${API}/sites/site_1/build_hooks`, 'list_build_hooks: endpoint')
    equal(list.data.items[0].url, 'https://api.netlify.com/build_hooks/bh_1', 'list_build_hooks: trigger url')
  }
  {
    const { requests, page } = nfPage(async () => jsonResponse({ id: 'bh_2', title: 'Docs', branch: 'docs', url: 'https://api.netlify.com/build_hooks/bh_2', site_id: 'site_1', created_at: '2026-01-02T00:00:00Z' }))
    const created = await runTool('com.netlify.main', 'create_build_hook', {
      input: { site_id: 'site_1', title: 'Docs', branch: 'docs' },
      page,
    })
    equal(created.status, 'ok', 'create_build_hook: status')
    equal(requests[0].url, `${API}/sites/site_1/build_hooks`, 'create_build_hook: endpoint')
    equal(requests[0].init.method, 'POST', 'create_build_hook: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'create_build_hook: JSON content type')
    equal(JSON.stringify(JSON.parse(requests[0].init.body)), JSON.stringify({ title: 'Docs', branch: 'docs' }), 'create_build_hook: body')
    equal(created.data.id, 'bh_2', 'create_build_hook: parsed result')
  }

  // --- forms + submissions ------------------------------------------------
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([{ id: 'form_1', site_id: 'site_1', name: 'contact', paths: ['/contact'], submission_count: 3, fields: ['email', 'message'], created_at: '2026-01-03T00:00:00Z' }]),
    )
    const forms = await runTool('com.netlify.main', 'list_forms', { input: { site_id: 'site_1' }, page })
    equal(forms.status, 'ok', 'list_forms: status')
    equal(requests[0].url, `${API}/sites/site_1/forms`, 'list_forms: endpoint')
    equal(forms.data.items[0].submission_count, 3, 'list_forms: submission_count')
    equal(forms.data.items[0].fields.join(','), 'email,message', 'list_forms: fields')
  }
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([
        {
          id: 'sub_1',
          form_id: 'form_1',
          form_name: 'contact',
          name: 'Ada',
          email: 'ada@example.com',
          body: 'hello',
          data: { email: 'ada@example.com', message: 'hello' },
          created_at: '2026-01-04T00:00:00Z',
        },
      ]),
    )
    const subs = await runTool('com.netlify.main', 'list_form_submissions', {
      input: { form_id: 'form_1', per_page: 20 },
      page,
    })
    equal(subs.status, 'ok', 'list_form_submissions: status')
    equal(requests[0].url, `${API}/forms/form_1/submissions?per_page=20`, 'list_form_submissions: endpoint + page')
    equal(subs.data.items[0].email, 'ada@example.com', 'list_form_submissions: email')
    equal(subs.data.items[0].data.message, 'hello', 'list_form_submissions: raw data map')
  }

  // --- DNS + deploy keys + audit (parsing only) ---------------------------
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([{ id: 'zone_1', name: 'example.com', account_slug: 'acme', site_id: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', records_count: 4, dedicated: true }]),
    )
    const zones = await runTool('com.netlify.main', 'list_dns_zones', { input: { account_slug: 'acme' }, page })
    equal(zones.status, 'ok', 'list_dns_zones: status')
    equal(requests[0].url, `${API}/dns_zones?account_slug=acme`, 'list_dns_zones: account_slug query')
    equal(zones.data.items[0].site_id, '', 'list_dns_zones: null site_id → empty string')
    equal(zones.data.items[0].dedicated, true, 'list_dns_zones: dedicated')
  }
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([{ id: 'rec_1', hostname: 'www.example.com', type: 'CNAME', value: 'shop.netlify.app', ttl: 3600, priority: 0, dns_zone_id: 'zone_1', flag: 0, tag: '' }]),
    )
    const records = await runTool('com.netlify.main', 'list_dns_records', { input: { zone_id: 'zone_1' }, page })
    equal(records.status, 'ok', 'list_dns_records: status')
    equal(requests[0].url, `${API}/dns_zones/zone_1/dns_records`, 'list_dns_records: endpoint')
    equal(records.data.items[0].type, 'CNAME', 'list_dns_records: type')
    equal(records.data.items[0].ttl, 3600, 'list_dns_records: ttl')
  }
  {
    const { requests, page } = nfPage(async () => jsonResponse([{ id: 'key_1', public_key: 'ssh-ed25519 AAAA', created_at: '2025-06-01T00:00:00Z' }]))
    const keys = await runTool('com.netlify.main', 'list_deploy_keys', { input: {}, page })
    equal(keys.status, 'ok', 'list_deploy_keys: status')
    equal(requests[0].url, `${API}/deploy_keys`, 'list_deploy_keys: endpoint')
    equal(keys.data.items[0].public_key, 'ssh-ed25519 AAAA', 'list_deploy_keys: public_key')
  }
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([
        {
          id: 'evt_1',
          account_id: 'acc_1',
          payload: { actor_id: 'u1', actor_name: 'Ada', actor_email: 'ada@example.com', action: 'site:create', timestamp: '2026-01-01T00:00:00Z', log_type: 'user' },
        },
      ]),
    )
    const events = await runTool('com.netlify.main', 'list_audit_events', {
      input: { account_id: 'acc_1', query: 'site:create', page: 1 },
      page,
    })
    equal(events.status, 'ok', 'list_audit_events: status')
    equal(requests[0].url, `${API}/accounts/acc_1/audit?query=site%3Acreate&page=1`, 'list_audit_events: search + page query')
    equal(events.data.items[0].action, 'site:create', 'list_audit_events: action from payload')
    equal(events.data.items[0].actor_name, 'Ada', 'list_audit_events: actor')
  }

  // --- get_current_user + list_accounts ----------------------------------
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse({
        id: 'u1',
        full_name: 'Ada Lovelace',
        email: 'ada@example.com',
        avatar_url: 'https://cdn.netlify.com/ada.png',
        site_count: 4,
        created_at: '2024-01-01T00:00:00Z',
        last_login: '2026-02-05T00:00:00Z',
        login_providers: ['github'],
        mfa_enabled: true,
      }),
    )
    const user = await runTool('com.netlify.main', 'get_current_user', { input: {}, page })
    equal(user.status, 'ok', 'get_current_user: status')
    equal(requests[0].url, `${API}/user`, 'get_current_user: /user endpoint')
    equal(user.data.email, 'ada@example.com', 'get_current_user: email')
    equal(user.data.login_providers[0], 'github', 'get_current_user: login provider')
    equal(user.data.mfa_enabled, true, 'get_current_user: mfa')
  }
  {
    const { requests, page } = nfPage(async () =>
      jsonResponse([
        {
          id: 'acc_1',
          name: 'Acme',
          slug: 'acme',
          type: 'team',
          type_name: 'Team',
          capabilities: { sites: { included: 10, used: 2 }, collaborators: { included: 5, used: 3 } },
          billing_name: 'Acme Inc',
          billing_email: 'billing@acme.com',
          owner_ids: ['u1'],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    )
    const accounts = await runTool('com.netlify.main', 'list_accounts', { input: {}, page })
    equal(accounts.status, 'ok', 'list_accounts: status')
    equal(requests[0].url, `${API}/accounts`, 'list_accounts: endpoint')
    const account = accounts.data.items[0]
    equal(account.capabilities_sites_used, 2, 'list_accounts: flattened proposals')
    equal(account.capabilities_collaborators_included, 5, 'list_accounts: collaborators included')
    equal(account.owner_ids[0], 'u1', 'list_accounts: owner ids')
  }

  // --- auth failure: no hint cookie → UNAUTHENTICATED, no request ----------
  {
    const { requests, page } = nfPage(async () => jsonResponse([]), { cookie: '' })
    const result = await runTool('com.netlify.main', 'list_sites', { input: { account_slug: 'acme' }, page })
    equal(result.status, 'error', 'auth missing: error status')
    equal(result.error_code, 'UNAUTHENTICATED', 'auth missing: UNAUTHENTICATED')
    equal(requests.length, 0, 'auth missing: makes no request')
  }

  // --- auth failure: 401 from the API → AUTH ------------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse('{"message":"Unauthorized"}', 401))
    const result = await runTool('com.netlify.main', 'list_sites', { input: { account_slug: 'acme' }, page })
    equal(result.status, 'error', 'auth 401: error status')
    equal(result.error_code, 'AUTH', 'auth 401: AUTH error code')
    ok(result.message.startsWith('Auth error (401)'), 'auth 401: message names the status')
    equal(requests.length, 1, 'auth 401: request was attempted')
  }

  // --- error classification ----------------------------------------------
  {
    const { page } = nfPage(async () => jsonResponse('{"message":"Not Found"}', 404))
    const result = await runTool('com.netlify.main', 'get_site', { input: { site_id: 'nope' }, page })
    equal(result.error_code, 'NOT_FOUND', '404 → NOT_FOUND')
    ok(result.message.includes('Not found:') && result.message.includes('/sites/nope'), '404: message names the endpoint')
  }
  {
    const { page } = nfPage(async () => jsonResponse('slow down', 429, { 'Retry-After': '30' }))
    const result = await runTool('com.netlify.main', 'list_deploys', { input: { site_id: 'site_1' }, page })
    equal(result.error_code, 'RATE_LIMITED', '429 → RATE_LIMITED')
    ok(result.message.includes('retry after 30'), '429: echoes Retry-After')
  }
  {
    const { page } = nfPage(async () => jsonResponse('{"message":"invalid"}', 422))
    const result = await runTool('com.netlify.main', 'create_site', { input: { account_slug: 'acme', name: 'x' }, page })
    equal(result.error_code, 'VALIDATION', '422 → VALIDATION')
  }
  {
    const { page } = nfPage(async () => jsonResponse('boom', 500))
    const result = await runTool('com.netlify.main', 'list_builds', { input: { site_id: 'site_1' }, page })
    equal(result.error_code, 'HTTP', '500 → HTTP (internal, non-retryable in the adapter vocabulary)')
    ok(result.message.includes('500'), '500: message keeps the status')
  }

  // --- wrong host: refused before any request ----------------------------
  {
    const { requests, page } = nfPage(async () => jsonResponse([]), { hostname: 'netlify.com', origin: 'https://netlify.com' })
    const result = await runTool('com.netlify.main', 'list_sites', { input: { account_slug: 'acme' }, page })
    equal(result.status, 'error', 'wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'wrong host: makes no request')
  }

  // --- network failure ---------------------------------------------------
  {
    const { page } = nfPage(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await runTool('com.netlify.main', 'list_sites', { input: { account_slug: 'acme' }, page })
    equal(result.error_code, 'NETWORK', 'network failure → NETWORK')
  }
}
