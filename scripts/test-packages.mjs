/**
 * test-packages.mjs — functional tests for the packages in this repo.
 *
 * Usage: node scripts/test-packages.mjs   (or: npm test)
 *
 * Three layers, all functional (no React rendering, no snapshots):
 *
 * 1. Contract: every package's manifest.json and workflow files parse, tool
 *    names are unique, urlRegex compiles and is anchored, the workflow source
 *    exports the required {inputSchema, outputSchema, tree, result} shape.
 * 2. Parity: the tool set of each ported package is exactly the tool set of
 *    the upstream OpenTabs plugin it was ported from (same names).
 * 3. Execution: representative tools are executed against a stubbed page
 *    (in-page fetch / document / storage), so the ported runtime really runs
 *    and the parsed output is asserted.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = path.join(root, 'packages')

let failures = 0
let checks = 0

function ok(condition, label) {
  checks++
  if (!condition) {
    failures++
    console.error(`FAIL  ${label}`)
  }
}

function equal(actual, expected, label) {
  checks++
  if (actual !== expected) {
    failures++
    console.error(`FAIL  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`)
    return
  }
}

function section(name) {
  console.log(`\n# ${name}`)
}

/**
 * Tool sets of the upstream OpenTabs plugins, by package id. A port is only
 * complete when every tool of the original is present under the same name.
 */
const OPENTABS_TOOL_COUNTS = {
  'com.github.main': 35,
  'com.notion.main': 18,
  'com.linear.main': 59,
}

/**
 * Minimal DOM stub: only what the ported runtimes read.
 *
 * - `meta[name="user-login"]` carries the logged-in GitHub login.
 * - `input[name="authenticity_token"]` carries the CSRF token the GitHub
 *   runtime reads before a mutation.
 */
function makeDocument({ cookie = '', login = null, csrf = 'csrf-token' } = {}) {
  return {
    cookie,
    querySelector(selector) {
      if (selector === 'meta[name="user-login"]' && login) {
        return { getAttribute: () => login }
      }
      if (selector.includes('authenticity_token') && csrf) {
        return { value: csrf }
      }
      return null
    },
    querySelectorAll() {
      return []
    },
  }
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

/**
 * Run one workflow tool in a sandboxed page.
 *
 * The workflow module is imported for its `tree.run`, whose `browser.eval`
 * call is intercepted here: the page-side function is executed inside a vm
 * context with the stubbed page globals, exactly like the extension does.
 */
async function runTool(packageId, toolName, { input = {}, page } = {}) {
  const workflowPath = path.join(packagesDir, packageId, 'workflows', `${toolName}.js`)
  const module = await import(pathToFileURL(workflowPath).href)
  const sandbox = {
    location: { hostname: page.hostname, href: page.href ?? `https://${page.hostname}/` },
    document: makeDocument(page),
    fetch: page.fetch,
    console,
    URLSearchParams,
    Intl,
    crypto: globalThis.crypto,
    localStorage: makeStorage(page.localStorage),
    sessionStorage: makeStorage(),
    AbortController,
    DOMParser: page.DOMParser,
    setTimeout,
    clearTimeout,
    Date,
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)

  const previousBrowser = globalThis.browser
  globalThis.browser = {
    async eval(expr) {
      const fn = vm.runInContext(expr, sandbox)
      const result = await fn()
      return { tabId: 7, result }
    },
  }
  try {
    const state = {}
    await module.default.tree.run({ input, state, target: { tabId: 7 } })
    return state.result
  } finally {
    globalThis.browser = previousBrowser
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
  }
}

function htmlResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/html' },
    async text() {
      return body
    },
  }
}

function jsResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/javascript' },
    async text() {
      return body
    },
  }
}

// --- 1. Contract -------------------------------------------------------------

section('contract: manifests, workflows, urlRegex')

const packageIds = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const id of packageIds) {
  const dir = path.join(packagesDir, id)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  equal(manifest.id, id, `${id}: manifest.id matches the directory`)
  ok(typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version), `${id}: semantic version`)
  ok(typeof manifest.description === 'string' && manifest.description.trim().length > 0, `${id}: description`)
  ok(existsSync(path.join(dir, 'config.json')), `${id}: config.json present`)

  const names = new Set()
  for (const tool of manifest.tools) {
    ok(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name), `${id}: tool name shape (${tool.name})`)
    ok(!names.has(tool.name), `${id}: unique tool name (${tool.name})`)
    names.add(tool.name)
    ok(typeof tool.description === 'string' && tool.description.trim().length > 0, `${id}: tool description (${tool.name})`)
    ok(tool.urlRegex.startsWith('^') && tool.urlRegex.endsWith('$'), `${id}: urlRegex anchored (${tool.name})`)
    let compiled = true
    try {
      new RegExp(tool.urlRegex)
    } catch {
      compiled = false
    }
    ok(compiled, `${id}: urlRegex compiles (${tool.name})`)
    ok(existsSync(path.join(dir, tool.path)), `${id}: workflow file exists (${tool.path})`)
  }

  for (const tool of manifest.tools) {
    const source = readFileSync(path.join(dir, tool.path), 'utf8')
    ok(source.includes('export default {'), `${id}: workflow exports a default object (${tool.name})`)
    ok(source.includes('inputSchema:'), `${id}: workflow declares inputSchema (${tool.name})`)
    ok(source.includes('outputSchema:'), `${id}: workflow declares outputSchema (${tool.name})`)
    ok(source.includes('tree:'), `${id}: workflow declares a tree (${tool.name})`)
    ok(source.includes('result('), `${id}: workflow declares result (${tool.name})`)
    ok(source.includes(`async ${tool.name}(args)`), `${id}: workflow implements the tool (${tool.name})`)
    // Navigation belongs to browser.goto, never to a page-side tool.
    ok(!/location\s*\.\s*(assign|replace|reload)\s*\(/.test(source), `${id}: no page navigation (${tool.name})`)
    ok(!/location\s*\.\s*href\s*=/.test(source), `${id}: no href assignment (${tool.name})`)
    ok(!/window\s*\.\s*open\s*\(/.test(source), `${id}: no window.open (${tool.name})`)
    // The session cookie must travel with the request, never be lifted out.
    ok(source.includes("credentials: 'include'"), `${id}: sends credentials (${tool.name})`)
  }
}

// --- 2. Parity with the upstream OpenTabs plugins -----------------------------

section('parity: tool sets match the upstream OpenTabs plugins')

for (const [id, expectedCount] of Object.entries(OPENTABS_TOOL_COUNTS)) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, id, 'manifest.json'), 'utf8'))
  equal(manifest.tools.length, expectedCount, `${id}: tool count matches OpenTabs (${expectedCount})`)
}

/**
 * Read the inputSchema a workflow declares (the manifest carries only the tool
 * metadata; the schema lives in the workflow file).
 */
function workflowInputSchema(workflowPath) {
  const source = readFileSync(workflowPath, 'utf8')
  const marker = '  inputSchema: '
  const start = source.indexOf(marker)
  if (start === -1) return null
  const open = source.indexOf('{', start + marker.length)
  let depth = 0
  let end = open
  while (end < source.length) {
    if (source[end] === '{') depth++
    else if (source[end] === '}') {
      depth--
      if (depth === 0) break
    }
    end++
  }
  try {
    return JSON.parse(source.slice(open, end + 1))
  } catch {
    return null
  }
}

/**
 * The upstream OpenTabs plugin manifests, fetched from the published npm
 * packages. They are the source of truth for the port: same tool names, same
 * input schemas. Skipped when the tarballs are not available (offline CI).
 */
function loadUpstreamSchemas() {
  const cacheDir = path.join(root, '.cache', 'opentabs')
  const packages = {
    'com.github.main': 'github',
    'com.notion.main': 'notion',
    'com.linear.main': 'linear',
  }
  const schemas = {}
  for (const [id, plugin] of Object.entries(packages)) {
    const file = path.join(cacheDir, `${plugin}-tools.json`)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    schemas[id] = Object.fromEntries(parsed.tools.map((tool) => [tool.name, tool.input_schema ?? {}]))
  }
  return schemas
}

const upstreamSchemas = loadUpstreamSchemas()
if (upstreamSchemas) {
  for (const [id, upstream] of Object.entries(upstreamSchemas)) {
    const manifest = JSON.parse(readFileSync(path.join(packagesDir, id, 'manifest.json'), 'utf8'))
    for (const tool of manifest.tools) {
      const expected = upstream[tool.name]
      ok(Boolean(expected), `${id}: ${tool.name} exists in the upstream OpenTabs plugin`)
      if (!expected) continue
      const ours = workflowInputSchema(path.join(packagesDir, id, tool.path))
      ok(Boolean(ours), `${id}: ${tool.name} declares a readable input schema`)
      if (!ours) continue
      equal(
        Object.keys(ours.properties ?? {}).sort().join(','),
        Object.keys(expected.properties ?? {}).sort().join(','),
        `${id}: ${tool.name} input properties match OpenTabs`,
      )
      equal(
        [...(ours.required ?? [])].sort().join(','),
        [...(expected.required ?? [])].sort().join(','),
        `${id}: ${tool.name} required inputs match OpenTabs`,
      )
    }
  }
} else {
  console.log('  (upstream OpenTabs manifests not cached — schema parity check skipped)')
}

// --- 3. Execution ------------------------------------------------------------

section('execution: ported tools run against a stubbed page')

{
  // GitHub: list_repos reads the same-origin /search endpoint and unwraps the
  // `payload` envelope the logged-in web session returns.
  const requests = []
  const result = await runTool('com.github.main', 'list_repos', {
    input: { owner: 'octocat' },
    page: {
      hostname: 'github.com',
      login: 'octocat',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          payload: {
            result_count: 1,
            results: [
              {
                id: 42,
                name: 'hello-world',
                full_name: 'octocat/hello-world',
                description: 'demo',
                private: false,
                default_branch: 'main',
                stargazers_count: 7,
              },
            ],
          },
        })
      },
    },
  })
  equal(result.status, 'ok', 'github list_repos: status')
  equal(result.data.repositories[0].full_name, 'octocat/hello-world', 'github list_repos: repository name')
  equal(requests[0].init.credentials, 'include', 'github list_repos: sends credentials')
  ok(String(requests[0].url).startsWith('/search'), 'github list_repos: uses the same-origin search endpoint')
}

{
  // GitHub: create_issue posts through the internal /_graphql persisted-query
  // endpoint with the CSRF token taken from the page. The persisted mutation
  // id is discovered at runtime from GitHub's JS bundles, exactly like the
  // upstream plugin does.
  const requests = []
  const result = await runTool('com.github.main', 'create_issue', {
    input: { owner: 'octocat', repo: 'hello-world', title: 'Bug' },
    page: {
      hostname: 'github.com',
      login: 'octocat',
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (String(url).startsWith('/octocat/hello-world/issues')) {
          return htmlResponse(
            '<script data-target="react-app.embeddedData">{"payload":{"preloadedQueries":{"q":{"result":{"data":{"repository":{"id":"R_1"}}}}}}}</script>',
          )
        }
        if (String(url).startsWith('https://github.githubassets.com/')) {
          return jsResponse('...id:"0123456789abcdef0123456789abcdef",name:"createIssueMutation",operationKind:"mutation"...')
        }
        if (String(url) === 'https://github.com/') {
          return htmlResponse('<script src="https://github.githubassets.com/assets/app.js"></script>')
        }
        if (String(url) === '/_graphql') {
          return jsonResponse({ data: { createIssue: { issue: { number: 7, title: 'Bug', url: 'https://github.com/octocat/hello-world/issues/7' } } } })
        }
        return jsonResponse({})
      },
    },
  })
  equal(result.status, 'ok', 'github create_issue: status')
  equal(result.data.issue.number, 7, 'github create_issue: issue number')
  const graphql = requests.find((r) => r.url === '/_graphql')
  ok(Boolean(graphql), 'github create_issue: posts to /_graphql')
  equal(graphql.init.headers['X-CSRF-Token'], 'csrf-token', 'github create_issue: sends the CSRF token')
  const body = JSON.parse(graphql.init.body)
  equal(body.query, '0123456789abcdef0123456789abcdef', 'github create_issue: uses the discovered persisted query id')
  equal(body.variables.input.repositoryId, 'R_1', 'github create_issue: passes the repository id')
}

{
  // Notion: search calls the internal api/v3 search endpoint with the
  // x-notion-active-user-header derived from the notion_user_id cookie.
  const requests = []
  const result = await runTool('com.notion.main', 'search', {
    input: { query: 'roadmap' },
    page: {
      hostname: 'www.notion.so',
      cookie: 'notion_user_id=user-1',
      localStorage: { 'LRU:KeyValueStore2:lastVisitedRouteSpaceId': JSON.stringify({ value: 'space-1' }) },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          total: 1,
          results: [{ id: 'block-1' }],
          recordMap: { block: { 'block-1': { value: { id: 'block-1', type: 'page', properties: { title: [['Roadmap']] } } } } },
        })
      },
    },
  })
  equal(result.status, 'ok', 'notion search: status')
  equal(result.data.pages[0].title, 'Roadmap', 'notion search: page title')
  equal(requests[0].url, 'https://www.notion.so/api/v3/search', 'notion search: uses the internal api/v3 endpoint')
  equal(requests[0].init.headers['x-notion-active-user-header'], 'user-1', 'notion search: sends the active-user header')
  equal(requests[0].init.headers['x-notion-space-id'], 'space-1', 'notion search: sends the space header')
}

{
  // Notion: append_block writes through submitTransaction.
  const requests = []
  const result = await runTool('com.notion.main', 'append_block', {
    input: { parent_id: 'page-1', content: 'hello' },
    page: {
      hostname: 'www.notion.so',
      cookie: 'notion_user_id=user-1',
      localStorage: { 'LRU:KeyValueStore2:lastVisitedRouteSpaceId': JSON.stringify({ value: 'space-1' }) },
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (String(url).endsWith('/submitTransaction')) return jsonResponse({})
        return jsonResponse({
          results: [{ value: { id: 'block-2', type: 'text', properties: { title: [['hello']] } } }],
        })
      },
    },
  })
  equal(result.status, 'ok', 'notion append_block: status')
  equal(result.data.block.text, 'hello', 'notion append_block: block text')
  ok(
    requests.some((r) => String(r.url).endsWith('/submitTransaction')),
    'notion append_block: writes through submitTransaction',
  )
}

{
  // Linear: get_viewer queries the GraphQL endpoint with the identity headers
  // the Linear web app sends.
  const requests = []
  const result = await runTool('com.linear.main', 'get_viewer', {
    page: {
      hostname: 'linear.app',
      cookie: 'loggedIn=1',
      localStorage: {
        ApplicationStore: JSON.stringify({
          currentUserAccountId: 'account-1',
          currentUserId: 'user-1',
          userAccounts: { 'account-1': { users: [{ organization: { id: 'org-1' } }] } },
        }),
        clientId: 'client-1',
      },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ data: { viewer: { id: 'user-1', name: 'Ada', email: 'ada@example.com', displayName: 'Ada', organization: { name: 'Acme', urlKey: 'acme' } } } })
      },
    },
  })
  equal(result.status, 'ok', 'linear get_viewer: status')
  equal(result.data.user.display_name, 'Ada', 'linear get_viewer: display name')
  equal(result.data.organization_name, 'Acme', 'linear get_viewer: organization name')
  equal(requests[0].url, 'https://client-api.linear.app/graphql', 'linear get_viewer: uses the client-api endpoint')
  equal(requests[0].init.headers.useraccount, 'account-1', 'linear get_viewer: sends the useraccount header')
  equal(requests[0].init.headers.organization, 'org-1', 'linear get_viewer: sends the organization header')
  equal(requests[0].init.headers['linear-client-id'], 'client-1', 'linear get_viewer: sends the client id header')
  equal(requests[0].init.credentials, 'include', 'linear get_viewer: sends credentials')
}

{
  // Linear: create_issue runs the issueCreate mutation.
  const requests = []
  const result = await runTool('com.linear.main', 'create_issue', {
    input: { team_id: 'team-1', title: 'Ship it' },
    page: {
      hostname: 'linear.app',
      cookie: 'loggedIn=1',
      localStorage: {
        ApplicationStore: JSON.stringify({
          currentUserAccountId: 'account-1',
          currentUserId: 'user-1',
          userAccounts: { 'account-1': { users: [{ organization: { id: 'org-1' } }] } },
        }),
        clientId: 'client-1',
      },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'issue-1', identifier: 'ENG-1', title: 'Ship it', team: { key: 'ENG', name: 'Engineering' }, state: { name: 'Todo', type: 'unstarted' } },
            },
          },
        })
      },
    },
  })
  equal(result.status, 'ok', 'linear create_issue: status')
  equal(result.data.issue.identifier, 'ENG-1', 'linear create_issue: issue identifier')
  const body = JSON.parse(requests[0].init.body)
  ok(body.query.includes('issueCreate'), 'linear create_issue: runs the issueCreate mutation')
  equal(body.variables.input.teamId, 'team-1', 'linear create_issue: passes the team id')
}

{
  // Linear: native-typed parameters reach the mutation unchanged. The schema
  // declares priority/estimate as numbers and label_ids/team_ids/issue_ids as
  // arrays, so the workflow must not parse CSV or stringified numbers.
  const requests = []
  const result = await runTool('com.linear.main', 'create_issue', {
    input: { team_id: 'team-1', title: 'Typed', priority: 2, label_ids: ['label-a', 'label-b'] },
    page: {
      hostname: 'linear.app',
      cookie: 'loggedIn=1',
      localStorage: {
        ApplicationStore: JSON.stringify({
          currentUserAccountId: 'account-1',
          currentUserId: 'user-1',
          userAccounts: { 'account-1': { users: [{ organization: { id: 'org-1' } }] } },
        }),
        clientId: 'client-1',
      },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          data: {
            issueCreate: {
              success: true,
              issue: { id: 'issue-2', identifier: 'ENG-2', title: 'Typed', team: { key: 'ENG', name: 'Engineering' }, state: { name: 'Todo', type: 'unstarted' } },
            },
          },
        })
      },
    },
  })
  equal(result.status, 'ok', 'linear create_issue typed: status')
  const body = JSON.parse(requests[0].init.body)
  equal(body.variables.input.priority, 2, 'linear create_issue typed: priority stays a number')
  ok(Array.isArray(body.variables.input.labelIds), 'linear create_issue typed: label ids stay an array')
  equal(body.variables.input.labelIds.join(','), 'label-a,label-b', 'linear create_issue typed: label ids preserved')
}

{
  // Linear: a GraphQL auth error is classified, not thrown.
  const result = await runTool('com.linear.main', 'get_issue', {
    input: { issue_id: 'ENG-1' },
    page: {
      hostname: 'linear.app',
      cookie: 'loggedIn=1',
      localStorage: {
        ApplicationStore: JSON.stringify({
          currentUserAccountId: 'account-1',
          currentUserId: 'user-1',
          userAccounts: { 'account-1': { users: [{ organization: { id: 'org-1' } }] } },
        }),
      },
      fetch: async () => jsonResponse({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }),
    },
  })
  equal(result.status, 'error', 'linear get_issue: auth failure is an error result')
  equal(result.error_code, 'AUTH', 'linear get_issue: auth failure is classified as AUTH')
}

// --- 4. Registry manifest ----------------------------------------------------

section('registry manifest')

{
  const registry = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  for (const id of packageIds) {
    const entry = registry.packages.find((pkg) => pkg.id === id)
    ok(Boolean(entry), `registry manifest lists ${id}`)
    if (!entry) continue
    const manifest = JSON.parse(readFileSync(path.join(packagesDir, id, 'manifest.json'), 'utf8'))
    equal(entry.toolCount, manifest.tools.length, `registry manifest tool count for ${id}`)
    ok(entry.files.some((f) => f.path === `packages/${id}/manifest.json`), `registry manifest lists the ${id} manifest file`)
  }
}

// --- 5. The repo's own package validator -------------------------------------

section('validate-package.mjs (the CI gate)')

for (const id of packageIds) {
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-package.mjs'), path.join(packagesDir, id)], { stdio: 'pipe' })
    ok(true, `validate-package.mjs passes for ${id}`)
  } catch (error) {
    ok(false, `validate-package.mjs passes for ${id}: ${error.stderr?.toString() ?? error.message}`)
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('OK — all package checks passed')
