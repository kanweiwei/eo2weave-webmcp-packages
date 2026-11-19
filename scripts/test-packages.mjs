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
import { Window } from 'happy-dom'

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
  'com.discord.main': 26,
  'com.hackernews.main': 10,
  'com.npm.main': 14,
  'com.todoist.main': 33,
  'com.jira.main': 20,
  'com.slack.main': 22,
  'com.google-calendar.main': 18,
}

/**
 * Tool sets (not just counts) of the upstream plugins: a swapped tool keeps the
 * count equal and still leaves a mechanic unported.
 */
const OPENTABS_TOOL_NAMES = {
  'com.hackernews.main': [
    'get_item',
    'get_user',
    'list_top_stories',
    'list_new_stories',
    'list_best_stories',
    'list_ask_stories',
    'list_show_stories',
    'list_job_stories',
    'get_story_comments',
    'submit_comment',
  ],
  'com.npm.main': [
    'get_current_user',
    'search_packages',
    'get_package',
    'get_package_version',
    'get_package_readme',
    'get_package_downloads',
    'get_package_dependents',
    'get_package_versions',
    'get_package_dependencies',
    'get_user_profile',
    'get_user_packages',
    'get_organization',
    'list_user_packages',
    'list_tokens',
  ],
  'com.slack.main': [
    'send_message',
    'edit_message',
    'delete_message',
    'read_messages',
    'read_thread',
    'search_messages',
    'list_channels',
    'get_channel_info',
    'create_channel',
    'set_channel_topic',
    'set_channel_purpose',
    'invite_to_channel',
    'list_members',
    'get_user_profile',
    'list_users',
    'open_dm',
    'upload_file',
    'list_files',
    'add_reaction',
    'remove_reaction',
    'pin_message',
    'unpin_message',
  ],
  'com.google-calendar.main': [
    'list_events',
    'get_event',
    'create_event',
    'update_event',
    'delete_event',
    'quick_add_event',
    'move_event',
    'list_event_instances',
    'search_events',
    'list_calendars',
    'get_calendar',
    'create_calendar',
    'update_calendar',
    'delete_calendar',
    'query_freebusy',
    'list_settings',
    'get_setting',
    'get_colors',
  ],
  'com.jira.main': [
    'search_issues',
    'get_issue',
    'create_issue',
    'update_issue',
    'delete_issue',
    'transition_issue',
    'get_transitions',
    'assign_issue',
    'link_issues',
    'add_watcher',
    'list_issue_types',
    'list_priorities',
    'add_comment',
    'list_comments',
    'list_projects',
    'get_project',
    'list_boards',
    'list_sprints',
    'search_users',
    'get_myself',
  ],
  'com.todoist.main': [
    'list_projects',
    'get_project',
    'create_project',
    'update_project',
    'delete_project',
    'archive_project',
    'unarchive_project',
    'list_collaborators',
    'list_tasks',
    'get_task',
    'create_task',
    'update_task',
    'close_task',
    'reopen_task',
    'delete_task',
    'list_sections',
    'get_section',
    'create_section',
    'update_section',
    'delete_section',
    'list_comments',
    'get_comment',
    'create_comment',
    'update_comment',
    'delete_comment',
    'list_labels',
    'get_label',
    'create_label',
    'update_label',
    'delete_label',
    'list_shared_labels',
    'rename_shared_label',
    'remove_shared_label',
  ],
}

/**
 * Minimal DOM stub: only what the ported runtimes read.
 *
 * - `meta[name="user-login"]` carries the logged-in GitHub login.
 * - `input[name="authenticity_token"]` carries the CSRF token the GitHub
 *   runtime reads before a mutation.
 * - `a#logout` is the only login signal Hacker News offers; its comment tool
 *   refuses to submit without it.
 *
 * Runtimes that parse fetched HTML use a real DOM (happy-dom's DOMParser, see
 * `runTool`) instead of this stub.
 */
function makeDocument({ cookie = '', login = null, csrf = 'csrf-token', loggedIn = false, meta = {} } = {}) {
  return {
    cookie,
    querySelector(selector) {
      if (selector === 'meta[name="user-login"]' && login) {
        return { getAttribute: () => login }
      }
      if (selector === 'a#logout') {
        return loggedIn ? { getAttribute: () => 'logout' } : null
      }
      // Jira Cloud publishes the session identity as meta tags
      // (ajs-atlassian-account-id, ajs-cloud-id).
      const metaMatch = /^meta\[name="(.+)"\]$/.exec(selector)
      if (metaMatch && meta[metaMatch[1]] !== undefined) {
        return { getAttribute: () => meta[metaMatch[1]] }
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
  // Ported runtimes that parse fetched HTML (Hacker News) call
  // `new DOMParser().parseFromString(...)`: hand them a real DOM parser so the
  // page-side code runs unchanged, exactly as in the tab.
  const domParser = page.DOMParser ?? new Window().DOMParser
  const sandbox = {
    location: {
      hostname: page.hostname,
      href: page.href ?? `https://${page.hostname}/`,
      origin: page.origin ?? `https://${page.hostname}`,
    },
    document: makeDocument(page),
    fetch: page.fetch,
    console,
    URLSearchParams,
    Intl,
    crypto: globalThis.crypto,
    localStorage: makeStorage(page.localStorage),
    sessionStorage: makeStorage(),
    FormData: globalThis.FormData,
    Blob: globalThis.Blob,
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    AbortController,
    DOMParser: domParser,
    setTimeout,
    clearTimeout,
    Date,
  }
  if (page.webpackToken) {
    sandbox.webpackChunkdiscord_app = {
      push(entry) {
        const require = Object.assign(() => {}, {
          c: { 1: { exports: { default: { getToken: () => page.webpackToken } } } },
        })
        entry[2](require)
      },
      indexOf: () => -1,
      splice: () => {},
    }
  }
  // Page globals the runtime reads straight off the window (npm exposes its
  // logged-in session as window.__context__).
  Object.assign(sandbox, page.globals ?? {})
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
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
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

for (const [id, expectedNames] of Object.entries(OPENTABS_TOOL_NAMES)) {
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, id, 'manifest.json'), 'utf8'))
  equal(
    manifest.tools.map((tool) => tool.name).sort().join(','),
    [...expectedNames].sort().join(','),
    `${id}: tool set matches OpenTabs`,
  )
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
    'com.hackernews.main': 'hackernews',
    'com.npm.main': 'npm',
    'com.slack.main': 'slack',
    'com.google-calendar.main': 'google-calendar',
  }
  const schemas = {}
  for (const [id, plugin] of Object.entries(packages)) {
    const file = path.join(cacheDir, `${plugin}-tools.json`)
    // A missing cache file skips that one plugin: an unfetched plugin must not
    // silently disable schema parity for every other package.
    if (!existsSync(file)) {
      console.log(`  (${plugin} manifest not cached — ${id} schema parity skipped)`)
      continue
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    schemas[id] = Object.fromEntries(parsed.tools.map((tool) => [tool.name, tool.input_schema ?? {}]))
  }
  return Object.keys(schemas).length > 0 ? schemas : null
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
      hostname: 'app.notion.com',
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
  equal(requests[0].url, 'https://app.notion.com/api/v3/search', 'notion search: uses the internal api/v3 endpoint')
  equal(requests[0].init.headers['x-notion-active-user-header'], 'user-1', 'notion search: sends the active-user header')
  equal(requests[0].init.headers['x-notion-space-id'], 'space-1', 'notion search: sends the space header')
}

{
  // Notion: append_block writes through submitTransaction.
  const requests = []
  const result = await runTool('com.notion.main', 'append_block', {
    input: { parent_id: 'page-1', content: 'hello' },
    page: {
      hostname: 'app.notion.com',
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

{
  // Discord: pinned messages go through the channel pins endpoint and are
  // mapped into the shared message shape.
  const requests = []
  const result = await runTool('com.discord.main', 'list_pinned_messages', {
    input: { channel: 'chan-1' },
    page: {
      hostname: 'discord.com',
      webpackToken: 'discord-token',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse([
          { id: 'msg-1', channel_id: 'chan-1', content: 'pinned', author: { id: 'u1', username: 'ada' }, pinned: true },
        ])
      },
    },
  })
  equal(result.status, 'ok', 'discord list_pinned_messages: status')
  equal(result.data.messages[0].content, 'pinned', 'discord list_pinned_messages: message content')
  equal(result.data.messages[0].author.username, 'ada', 'discord list_pinned_messages: author mapping')
  ok(String(requests[0].url).endsWith('/api/v9/channels/chan-1/pins'), 'discord list_pinned_messages: uses the pins endpoint')
  equal(requests[0].init.headers.Authorization, 'discord-token', 'discord list_pinned_messages: sends the page token')
  equal(requests[0].init.credentials, 'include', 'discord list_pinned_messages: sends credentials')
}

{
  // Discord: edit_message PATCHes only the content and maps the response.
  const requests = []
  const result = await runTool('com.discord.main', 'edit_message', {
    input: { channel: 'chan-1', message_id: 'msg-1', content: 'edited' },
    page: {
      hostname: 'discord.com',
      webpackToken: 'discord-token',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ id: 'msg-1', channel_id: 'chan-1', content: 'edited', author: { id: 'u1', username: 'ada' } })
      },
    },
  })
  equal(result.status, 'ok', 'discord edit_message: status')
  equal(result.data.message.content, 'edited', 'discord edit_message: edited content')
  equal(requests[0].init.method, 'PATCH', 'discord edit_message: uses PATCH')
  equal(JSON.parse(requests[0].init.body).content, 'edited', 'discord edit_message: sends the new content')
}

{
  // Discord: create_channel posts the optional fields only when supplied.
  const requests = []
  const result = await runTool('com.discord.main', 'create_channel', {
    input: { guild_id: 'guild-1', name: 'general', topic: 'hello' },
    page: {
      hostname: 'discord.com',
      webpackToken: 'discord-token',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ id: 'chan-9', type: 0, guild_id: 'guild-1', name: 'general', topic: 'hello', position: 0 })
      },
    },
  })
  equal(result.status, 'ok', 'discord create_channel: status')
  equal(result.data.channel.id, 'chan-9', 'discord create_channel: channel id')
  const body = JSON.parse(requests[0].init.body)
  equal(body.name, 'general', 'discord create_channel: name')
  equal(body.topic, 'hello', 'discord create_channel: topic')
  ok(!('type' in body), 'discord create_channel: omits an unspecified type')
}

{
  // Discord: upload_file posts multipart form data, never a JSON body.
  const requests = []
  const result = await runTool('com.discord.main', 'upload_file', {
    input: { channel: 'chan-1', filename: 'note.txt', content: 'hello', initial_comment: 'see attached' },
    page: {
      hostname: 'discord.com',
      webpackToken: 'discord-token',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ id: 'msg-2', channel_id: 'chan-1', content: 'see attached', author: { id: 'u1', username: 'ada' } })
      },
    },
  })
  equal(result.status, 'ok', 'discord upload_file: status')
  ok(requests[0].init.body instanceof FormData, 'discord upload_file: body is FormData')
  equal(requests[0].init.headers['Content-Type'], undefined, 'discord upload_file: lets the browser set the boundary')
  equal(JSON.parse(requests[0].init.body.get('payload_json')).content, 'see attached', 'discord upload_file: sends the comment')
}

// Hacker News: every tool parses HN's own server-rendered HTML (its CSP blocks
// all cross-origin APIs), so the fixtures below reproduce the real page shapes:
// `tr.athing` rows paired with a `.subtext` row, `.titleline > a` for the link,
// `.sitestr` for the domain, `a.morelink` for pagination, comment rows carrying
// `.ind img width` for nesting, and the reply/comment form with its HMAC field.

function hnStoryRow({ id, title, href, site = '', score = null, by = null, time, comments = null }) {
  const siteBit = site
    ? ` <span class="sitebit comhead">(<a href="from?site=${site}"><span class="sitestr">${site}</span></a>)</span>`
    : ''
  const scoreBit =
    score === null
      ? ''
      : `<span class="score" id="score_${id}">${score} points</span> by <a href="user?id=${by}" class="hnuser">${by}</a> `
  const commentsBit = comments === null ? '' : `| <a href="item?id=${id}">${comments}&nbsp;comments</a>`
  return `<tr class="athing" id="${id}">
  <td align="right" valign="top" class="title"><span class="rank"></span></td>
  <td valign="top" class="votelinks"><center><a id="up_${id}" href="vote?id=${id}&amp;how=up&amp;goto=news"><div class="votearrow" title="upvote"></div></a></center></td>
  <td class="title"><span class="titleline"><a href="${href}">${title}</a>${siteBit}</span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">${scoreBit}<span class="age" title="${time} 1738391564"><a href="item?id=${id}">3 hours ago</a></span> ${commentsBit}</span></td></tr>
<tr class="spacer" style="height:5px"></tr>`
}

function hnCommentRow({ id, by, html, width, time }) {
  return `<tr class="athing comtr" id="${id}"><td><table border="0"><tbody><tr>
  <td class="ind"><img src="s.gif" height="1" width="${width}"></td>
  <td valign="top" class="votelinks"><center><a id="up_${id}" href="vote?id=${id}&amp;how=up"><div class="votearrow" title="upvote"></div></a></center></td>
  <td class="default"><div style="margin-top:2px"><span class="comhead"><a href="user?id=${by}" class="hnuser">${by}</a> <span class="age" title="${time} 1738394531"><a href="item?id=${id}">2 hours ago</a></span></span></div><br><div class="comment"><div class="commtext c00">${html}</div></div></td>
</tr></tbody></table></td></tr>`
}

const HN_FRONT_PAGE = `<html><head><title>Hacker News</title></head><body><center>
<table id="hnmain" border="0" cellpadding="0" cellspacing="0" width="85%" bgcolor="#f6f6ef"><tbody>
<tr><td bgcolor="#ff6600"><table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
<td><a href="/"><img src="y18.svg" width="18" height="18"></a></td>
<td><span class="pagetop"><b class="hnname"><a href="news">Hacker News</a></b> <a id="login" href="login?goto=news">login</a></span></td>
</tr></tbody></table></td></tr>
<tr><td><table border="0" cellpadding="0" cellspacing="0" class="itemlist"><tbody>
${hnStoryRow({ id: 43120001, title: 'Writing a kernel in Zig', href: 'https://ziglang.example/kernel', site: 'ziglang.example', score: 412, by: 'patio11', time: '2025-02-01T09:12:44', comments: 188 })}
${hnStoryRow({ id: 43120002, title: 'Ask HN: How do you keep a research log?', href: 'item?id=43120002', score: 96, by: 'tptacek', time: '2025-02-01T10:04:00', comments: 54 })}
${hnStoryRow({ id: 43120003, title: 'Example Corp is hiring engineers', href: 'https://jobs.example.org/hn', site: 'jobs.example.org', time: '2025-02-01T08:00:00' })}
<tr class="morespace" style="height:10px"></tr>
<tr><td colspan="2"></td><td class="title"><a href="news?p=2" class="morelink" rel="nofollow">More</a></td></tr>
</tbody></table></td></tr>
</tbody></table></center></body></html>`

const HN_ITEM_PAGE = `<html><head><title>Writing a kernel in Zig | Hacker News</title></head><body><center>
<table id="hnmain"><tbody><tr><td><table class="fatitem" border="0"><tbody>
${hnStoryRow({ id: 43120001, title: 'Writing a kernel in Zig', href: 'https://ziglang.example/kernel', site: 'ziglang.example', score: 412, by: 'patio11', time: '2025-02-01T09:12:44', comments: 188 })}
<tr><td colspan="2"></td><td><div class="toptext">A writeup of the port.<p>With benchmarks.</p></div></td></tr>
</tbody></table></td></tr></tbody></table></center></body></html>`

const HN_JOB_ITEM_PAGE = `<html><head><title>Example Corp is hiring engineers | Hacker News</title></head><body><center>
<table id="hnmain"><tbody><tr><td><table class="fatitem" border="0"><tbody>
${hnStoryRow({ id: 43120003, title: 'Example Corp is hiring engineers', href: 'https://jobs.example.org/hn', site: 'jobs.example.org', time: '2025-02-01T08:00:00' })}
</tbody></table></td></tr></tbody></table></center></body></html>`

const HN_USER_PAGE = `<html><head><title>Profile: patio11 | Hacker News</title></head><body><center>
<table id="hnmain"><tbody><tr><td><table class="fatitem"><tbody><tr><td>
<table border="0"><tbody>
<tr><td>user:</td><td><a href="user?id=patio11" class="hnuser">patio11</a></td></tr>
<tr><td>created:</td><td><a href="user?id=patio11">February 1, 2008</a></td></tr>
<tr><td>karma:</td><td>31204</td></tr>
<tr><td>about:</td><td>Founding partner of Kalzumeus Software.</td></tr>
</tbody></table>
</td></tr></tbody></table></td></tr></tbody></table></center></body></html>`

const HN_COMMENTS_PAGE = `<html><head><title>Writing a kernel in Zig | Hacker News</title></head><body><center>
<table id="hnmain"><tbody><tr><td><table class="fatitem" border="0"><tbody>
${hnStoryRow({ id: 43120001, title: 'Writing a kernel in Zig', href: 'https://ziglang.example/kernel', site: 'ziglang.example', score: 412, by: 'patio11', time: '2025-02-01T09:12:44', comments: 188 })}
</tbody></table></td></tr></tbody></table>
<table border="0" class="comment-tree"><tbody>
${hnCommentRow({ id: 43120500, by: 'dfgd', html: 'Top level take.', width: 0, time: '2025-02-01T10:02:11' })}
${hnCommentRow({ id: 43120501, by: 'tptacek', html: 'A <i>reply</i> to it.', width: 40, time: '2025-02-01T10:09:00' })}
</tbody></table></center></body></html>`

const HN_REPLY_PAGE = `<html><head><title>Reply | Hacker News</title></head><body><center>
<table id="hnmain"><tbody><tr><td>
<form method="post" action="comment"><input type="hidden" name="parent" value="43120001"><input type="hidden" name="goto" value="item?id=43120001"><input type="hidden" name="hmac" value="a1b2c3d4e5f6"><textarea name="text" rows="6" cols="60"></textarea><br><br><input type="submit" value="reply"></form>
<img src="s.gif" height="1" width="0">
</td></tr></tbody></table></center></body></html>`

{
  // Hacker News: list_top_stories parses the front page (no API call) and keeps
  // numeric fields numeric; page 2 goes through `?p=2`.
  const requests = []
  const page = {
    hostname: 'news.ycombinator.com',
    fetch: async (url, init) => {
      requests.push({ url, init })
      return htmlResponse(HN_FRONT_PAGE)
    },
  }
  const result = await runTool('com.hackernews.main', 'list_top_stories', { input: {}, page })
  equal(result.status, 'ok', 'hackernews list_top_stories: status')
  equal(result.data.stories.length, 3, 'hackernews list_top_stories: story count')
  equal(result.data.stories[0].id, 43120001, 'hackernews list_top_stories: item id')
  equal(result.data.stories[0].title, 'Writing a kernel in Zig', 'hackernews list_top_stories: title')
  equal(result.data.stories[0].url, 'https://ziglang.example/kernel', 'hackernews list_top_stories: link url')
  equal(result.data.stories[0].site, 'ziglang.example', 'hackernews list_top_stories: domain')
  equal(result.data.stories[0].score, 412, 'hackernews list_top_stories: score is a number')
  equal(result.data.stories[0].by, 'patio11', 'hackernews list_top_stories: author')
  equal(result.data.stories[0].time, '2025-02-01T09:12:44', 'hackernews list_top_stories: exact timestamp')
  equal(result.data.stories[0].descendants, 188, 'hackernews list_top_stories: comment count is a number')
  equal(result.data.stories[1].url, '', 'hackernews list_top_stories: text post has no url')
  equal(result.data.stories[2].score, 0, 'hackernews list_top_stories: job row has no score')
  equal(result.data.has_more, true, 'hackernews list_top_stories: has_more from a.morelink')
  equal(requests[0].url, 'https://news.ycombinator.com/news', 'hackernews list_top_stories: fetches /news same-origin')
  equal(requests[0].init.credentials, 'include', 'hackernews list_top_stories: sends credentials')

  const paged = await runTool('com.hackernews.main', 'list_top_stories', { input: { page: 2 }, page })
  equal(paged.status, 'ok', 'hackernews list_top_stories page 2: status')
  equal(requests[1].url, 'https://news.ycombinator.com/news?p=2', 'hackernews list_top_stories: paginates with ?p=2')
}

{
  // Hacker News: a listing page without any story rows is a parse failure, not
  // an empty successful result.
  const result = await runTool('com.hackernews.main', 'list_new_stories', {
    input: {},
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async () => htmlResponse('<html><body><table><tbody></tbody></table></body></html>'),
    },
  })
  equal(result.status, 'error', 'hackernews list_new_stories: empty page is an error')
  equal(result.error_code, 'PARSE', 'hackernews list_new_stories: empty page is PARSE')
}

{
  // Hacker News: get_item reads the item page for a story (with its toptext)
  // and for a job (no author, no score).
  const story = await runTool('com.hackernews.main', 'get_item', {
    input: { id: 43120001 },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async (url) => {
        equal(url, 'https://news.ycombinator.com/item?id=43120001', 'hackernews get_item: fetches /item?id=')
        return htmlResponse(HN_ITEM_PAGE)
      },
    },
  })
  equal(story.status, 'ok', 'hackernews get_item: status')
  equal(story.data.item.id, 43120001, 'hackernews get_item: id')
  equal(story.data.item.type, 'story', 'hackernews get_item: type')
  equal(story.data.item.title, 'Writing a kernel in Zig', 'hackernews get_item: title')
  equal(story.data.item.score, 412, 'hackernews get_item: score')
  equal(story.data.item.descendants, 188, 'hackernews get_item: comment count')
  ok(story.data.item.text.includes('benchmarks'), 'hackernews get_item: keeps the HTML text')

  const job = await runTool('com.hackernews.main', 'get_item', {
    input: { id: 43120003 },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async () => htmlResponse(HN_JOB_ITEM_PAGE),
    },
  })
  equal(job.status, 'ok', 'hackernews get_item job: status')
  equal(job.data.item.type, 'job', 'hackernews get_item job: type')
  equal(job.data.item.by, '', 'hackernews get_item job: no author')

  const missing = await runTool('com.hackernews.main', 'get_item', {
    input: { id: 999 },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async () => htmlResponse('<html><body><center>No such item.</center></body></html>'),
    },
  })
  equal(missing.status, 'error', 'hackernews get_item: missing item is an error')
  equal(missing.error_code, 'NOT_FOUND', 'hackernews get_item: missing item is NOT_FOUND')
}

{
  // Hacker News: get_user reads the profile table (karma as a number, HTML bio).
  let requested = null
  const result = await runTool('com.hackernews.main', 'get_user', {
    input: { username: 'patio11' },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async (url) => {
        requested = url
        return htmlResponse(HN_USER_PAGE)
      },
    },
  })
  equal(result.status, 'ok', 'hackernews get_user: status')
  equal(result.data.user.username, 'patio11', 'hackernews get_user: username')
  equal(result.data.user.karma, 31204, 'hackernews get_user: karma is a number')
  equal(result.data.user.created, 'February 1, 2008', 'hackernews get_user: creation date')
  equal(result.data.user.about, 'Founding partner of Kalzumeus Software.', 'hackernews get_user: bio')
  equal(requested, 'https://news.ycombinator.com/user?id=patio11', 'hackernews get_user: fetches /user?id=')
}

{
  // Hacker News: get_story_comments reads comment rows, their nesting depth
  // (40px of indent per level) and the story's total comment count.
  let requested = null
  const result = await runTool('com.hackernews.main', 'get_story_comments', {
    input: { story_id: 43120001 },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async (url) => {
        requested = url
        return htmlResponse(HN_COMMENTS_PAGE)
      },
    },
  })
  equal(result.status, 'ok', 'hackernews get_story_comments: status')
  equal(result.data.comments.length, 2, 'hackernews get_story_comments: comment count')
  equal(result.data.comments[0].id, 43120500, 'hackernews get_story_comments: comment id is a number')
  equal(result.data.comments[0].by, 'dfgd', 'hackernews get_story_comments: author')
  equal(result.data.comments[0].indent, 0, 'hackernews get_story_comments: top-level indent')
  equal(result.data.comments[1].indent, 1, 'hackernews get_story_comments: reply indent')
  equal(result.data.comments[1].text, 'A <i>reply</i> to it.', 'hackernews get_story_comments: keeps comment HTML')
  equal(result.data.total, 188, 'hackernews get_story_comments: total from the story subtext')
  equal(result.data.has_more, false, 'hackernews get_story_comments: no more link')
  equal(requested, 'https://news.ycombinator.com/item?id=43120001', 'hackernews get_story_comments: fetches the item page')
}

{
  // Hacker News: submit_comment reads the HMAC token from the reply form and
  // POSTs the site's own multipart form: never a JSON body, no content type
  // (the browser must set the multipart boundary).
  const requests = []
  const result = await runTool('com.hackernews.main', 'submit_comment', {
    input: { parent_id: 43120001, text: 'Great writeup.' },
    page: {
      hostname: 'news.ycombinator.com',
      loggedIn: true,
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (String(url).includes('/reply?id=43120001')) return htmlResponse(HN_REPLY_PAGE)
        return htmlResponse('<html><body>comment posted</body></html>')
      },
    },
  })
  equal(result.status, 'ok', 'hackernews submit_comment: status')
  equal(result.data.success, true, 'hackernews submit_comment: success flag')
  equal(
    requests[0].url,
    'https://news.ycombinator.com/reply?id=43120001&goto=item%3Fid%3D43120001%2343120001',
    'hackernews submit_comment: reads the reply form first',
  )
  const post = requests.find((request) => String(request.url) === 'https://news.ycombinator.com/comment')
  ok(Boolean(post), 'hackernews submit_comment: posts to /comment')
  equal(post.init.method, 'POST', 'hackernews submit_comment: uses POST')
  ok(post.init.body instanceof FormData, 'hackernews submit_comment: body is FormData')
  equal(post.init.headers['Content-Type'], undefined, 'hackernews submit_comment: lets the browser set the boundary')
  equal(post.init.body.get('parent'), '43120001', 'hackernews submit_comment: sends the parent id')
  equal(post.init.body.get('goto'), 'item?id=43120001', 'hackernews submit_comment: sends the goto target')
  equal(post.init.body.get('hmac'), 'a1b2c3d4e5f6', 'hackernews submit_comment: sends the page HMAC token')
  equal(post.init.body.get('text'), 'Great writeup.', 'hackernews submit_comment: sends the comment text')
  equal(post.init.credentials, 'include', 'hackernews submit_comment: sends credentials')
}

{
  // Hacker News: submitting while logged out fails before any form is read.
  const requests = []
  const result = await runTool('com.hackernews.main', 'submit_comment', {
    input: { parent_id: 43120001, text: 'nope' },
    page: {
      hostname: 'news.ycombinator.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return htmlResponse(HN_REPLY_PAGE)
      },
    },
  })
  equal(result.status, 'error', 'hackernews submit_comment logged out: is an error')
  equal(result.error_code, 'AUTH', 'hackernews submit_comment logged out: is AUTH')
  equal(requests.length, 0, 'hackernews submit_comment logged out: makes no request')
}

// --- 4. Registry manifest ----------------------------------------------------

{
  // npm: get_package reads the package page as JSON through x-spiferack and
  // maps the capsule/packageVersion pair into the flat package shape.
  const requests = []
  const result = await runTool('com.npm.main', 'get_package', {
    input: { name: 'react' },
    page: {
      hostname: 'www.npmjs.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          packageVersion: {
            name: 'react',
            version: '19.1.0',
            description: 'React is a JavaScript library for building user interfaces.',
            license: 'MIT',
            homepage: 'https://react.dev/',
            repository: { url: 'git+https://github.com/facebook/react.git' },
            keywords: ['react'],
            author: { name: 'Meta' },
            maintainers: [{ name: 'react-bot' }],
            funding: { url: 'https://github.com/sponsors/react' },
          },
          capsule: {
            name: 'react',
            'dist-tags': { latest: '19.1.0', canary: '19.2.0-canary' },
            lastPublish: { maintainer: 'react-bot', time: '2025-03-28T00:00:00.000Z' },
            types: { typescript: { package: '@types/react' } },
          },
          isStarred: false,
          dependents: { dependentsCount: '123456' },
          provenance: { enabled: true },
        })
      },
    },
  })
  equal(result.status, 'ok', 'npm get_package: status')
  equal(result.data.package.name, 'react', 'npm get_package: name')
  equal(result.data.package.version, '19.1.0', 'npm get_package: version')
  equal(result.data.package.license, 'MIT', 'npm get_package: license')
  equal(result.data.package.repository_url, 'git+https://github.com/facebook/react.git', 'npm get_package: repository url')
  equal(result.data.package.maintainers[0].name, 'react-bot', 'npm get_package: maintainers')
  equal(result.data.package.dist_tags.canary, '19.2.0-canary', 'npm get_package: dist-tags')
  equal(result.data.package.typescript_support, '@types/react', 'npm get_package: typescript support')
  equal(result.data.package.dependents_count, '123456', 'npm get_package: dependents count stays a string')
  equal(result.data.package.has_provenance, true, 'npm get_package: provenance flag')
  equal(requests[0].url, 'https://www.npmjs.com/package/react', 'npm get_package: package page endpoint')
  equal(requests[0].init.headers['x-spiferack'], '1', 'npm get_package: asks for the JSON (spiferack) body')
  equal(requests[0].init.credentials, 'include', 'npm get_package: sends credentials')
  equal(requests[0].init.method, 'GET', 'npm get_package: plain GET needs no csrf token')
  equal(requests[0].init.headers['x-csrf-token'], undefined, 'npm get_package: no csrf header on reads')
}

{
  // npm: get_package_downloads keeps the weekly counts numeric.
  const requests = []
  const result = await runTool('com.npm.main', 'get_package_downloads', {
    input: { name: 'express' },
    page: {
      hostname: 'www.npmjs.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          downloads: [
            { downloads: 29000000, label: '2025-03-10 to 2025-03-16' },
            { downloads: 28400000, label: '2025-03-17 to 2025-03-23' },
          ],
        })
      },
    },
  })
  equal(result.status, 'ok', 'npm get_package_downloads: status')
  equal(result.data.name, 'express', 'npm get_package_downloads: name')
  equal(result.data.downloads.length, 2, 'npm get_package_downloads: weekly points')
  equal(typeof result.data.downloads[0].downloads, 'number', 'npm get_package_downloads: download count is a number')
  equal(result.data.downloads[0].downloads, 29000000, 'npm get_package_downloads: download count')
  equal(result.data.downloads[1].label, '2025-03-17 to 2025-03-23', 'npm get_package_downloads: label')
  equal(requests[0].url, 'https://www.npmjs.com/package/express', 'npm get_package_downloads: package page endpoint')
  equal(requests[0].init.headers['x-spiferack'], '1', 'npm get_package_downloads: asks for the JSON body')
}

{
  // npm: search_packages sends q/page and maps the registry search envelope,
  // including the numeric scores.
  const requests = []
  const result = await runTool('com.npm.main', 'search_packages', {
    input: { query: 'express' },
    page: {
      hostname: 'www.npmjs.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          total: 1,
          objects: [
            {
              package: {
                name: 'express',
                version: '4.21.2',
                description: 'Fast, unopinionated, minimalist web framework',
                keywords: ['express', 'framework'],
                date: '2024-12-03T10:00:00.000Z',
                publisher: { username: 'dougwilson' },
                maintainers: [{ username: 'dougwilson' }],
                links: {
                  npm: 'https://www.npmjs.com/package/express',
                  homepage: 'https://expressjs.com/',
                  repository: 'https://github.com/expressjs/express',
                },
              },
              score: { final: 0.95, detail: { quality: 0.9, popularity: 0.98, maintenance: 0.94 } },
              searchScore: 100000,
            },
          ],
        })
      },
    },
  })
  equal(result.status, 'ok', 'npm search_packages: status')
  equal(result.data.total, 1, 'npm search_packages: total')
  equal(result.data.packages[0].name, 'express', 'npm search_packages: package name')
  equal(result.data.packages[0].publisher, 'dougwilson', 'npm search_packages: publisher')
  equal(result.data.packages[0].maintainers[0], 'dougwilson', 'npm search_packages: maintainers')
  equal(typeof result.data.packages[0].score_final, 'number', 'npm search_packages: score is a number')
  equal(result.data.packages[0].score_popularity, 0.98, 'npm search_packages: popularity score')
  equal(result.data.packages[0].search_score, 100000, 'npm search_packages: search score')
  equal(result.data.packages[0].date, '2024-12-03T10:00:00.000Z', 'npm search_packages: publish date')
  equal(requests[0].url, 'https://www.npmjs.com/search?q=express&page=0', 'npm search_packages: search endpoint with q/page')
}

{
  // npm: list_user_packages is authenticated — the username comes from the
  // page context (window.__context__), never from the caller.
  const requests = []
  const result = await runTool('com.npm.main', 'list_user_packages', {
    input: {},
    page: {
      hostname: 'www.npmjs.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          packages: {
            total: 1,
            objects: [{ name: '@ada/tool', version: '1.0.0', description: 'demo', date: { rel: '2 days ago' } }],
          },
          packagesCounts: { all: 1, linked: 1, unlinked: 0 },
        })
      },
      globals: {
        __context__: {
          context: {
            user: { name: 'ada', avatars: { large: '/avatars/ada.png' } },
            csrftoken: 'csrf-npm',
          },
        },
      },
    },
  })
  equal(result.status, 'ok', 'npm list_user_packages: status')
  equal(result.data.total, 1, 'npm list_user_packages: total')
  equal(result.data.packages[0].name, '@ada/tool', 'npm list_user_packages: package name')
  equal(result.data.packages[0].date, '2 days ago', 'npm list_user_packages: relative date')
  equal(requests[0].url, 'https://www.npmjs.com/settings/ada/packages?page=0', 'npm list_user_packages: settings endpoint for the page user')
  equal(requests[0].init.headers['x-spiferack'], '1', 'npm list_user_packages: asks for the JSON body')
  equal(requests[0].init.credentials, 'include', 'npm list_user_packages: sends credentials')
}

{
  // npm: get_current_user reads the logged-in identity straight off the page.
  const result = await runTool('com.npm.main', 'get_current_user', {
    input: {},
    page: {
      hostname: 'www.npmjs.com',
      globals: {
        __context__: {
          context: {
            user: { name: 'ada', avatars: { large: '/avatars/ada.png' } },
            csrftoken: 'csrf-npm',
            userEmailVerified: true,
          },
        },
      },
      fetch: async () => jsonResponse({}),
    },
  })
  equal(result.status, 'ok', 'npm get_current_user: status')
  equal(result.data.username, 'ada', 'npm get_current_user: username from the page context')
  equal(result.data.avatar_url, 'https://www.npmjs.com/avatars/ada.png', 'npm get_current_user: absolute avatar url')
  equal(result.data.email_verified, true, 'npm get_current_user: verified email flag')
}

{
  // npm: list_tokens is authenticated, and a logged-out page is a classified
  // error instead of an empty token list.
  const requests = []
  const authed = await runTool('com.npm.main', 'list_tokens', {
    input: {},
    page: {
      hostname: 'www.npmjs.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          list: {
            objects: [
              { token: 'npm_52ab......TJGu', readonly: true, created: '2024-01-02T03:04:05.000Z', updated: '2024-06-01T00:00:00.000Z' },
            ],
          },
        })
      },
      globals: { __context__: { context: { user: { name: 'ada' }, csrftoken: 'csrf-npm' } } },
    },
  })
  equal(authed.status, 'ok', 'npm list_tokens: status')
  equal(authed.data.tokens[0].token, 'npm_52ab......TJGu', 'npm list_tokens: token prefix')
  equal(authed.data.tokens[0].readonly, true, 'npm list_tokens: read-only flag is a boolean')
  equal(requests[0].url, 'https://www.npmjs.com/settings/ada/tokens', 'npm list_tokens: settings tokens endpoint')

  const anonymous = await runTool('com.npm.main', 'list_tokens', {
    input: {},
    page: { hostname: 'www.npmjs.com', fetch: async () => jsonResponse({}) },
  })
  equal(anonymous.status, 'error', 'npm list_tokens: logged-out page is an error')
  equal(anonymous.error_code, 'UNAUTHENTICATED', 'npm list_tokens: logged-out page is classified as UNAUTHENTICATED')
}

// --- Slack -------------------------------------------------------------------
//
// Slack's web client authenticates every call with the `xoxc-` token its own
// runtime exposes (localConfig_v2 in the legacy workspace client, boot_data
// globals in the current one) and takes the API as a form-encoded POST to the
// workspace host. These fixtures reproduce that: token read out of the page,
// `application/x-www-form-urlencoded` body carrying the token plus the
// client's `_x_*` metadata, and Slack's `{ ok, error }` envelope.

const SLACK_WORKSPACE = 'acme.slack.com'

function slackPage({ token = 'xoxc-test-token', fetch } = {}) {
  return {
    hostname: SLACK_WORKSPACE,
    localStorage: {
      localConfig_v2: JSON.stringify({
        teams: { T0123: { token, url: 'https://acme.slack.com/', name: 'Acme' } },
        lastActiveTeamId: 'T0123',
      }),
    },
    fetch,
  }
}

function slackForm(request) {
  return new URLSearchParams(request.init.body)
}

{
  // Slack: list_channels is a workspace listing — form-encoded POST, the page
  // token and team id, channel mapping with defensive defaults.
  const requests = []
  const result = await runTool('com.slack.main', 'list_channels', {
    input: {},
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          ok: true,
          channels: [
            {
              id: 'C1',
              name: 'general',
              is_channel: true,
              is_private: false,
              num_members: 12,
              topic: { value: 'Team news' },
              purpose: { value: 'Chatter' },
            },
            { id: 'C2', name: 'random' },
          ],
          response_metadata: { next_cursor: 'cursor-2' },
        })
      },
    }),
  })
  equal(result.status, 'ok', 'slack list_channels: status')
  equal(result.data.channels.length, 2, 'slack list_channels: channel count')
  equal(result.data.channels[0].name, 'general', 'slack list_channels: channel name')
  equal(result.data.channels[0].num_members, 12, 'slack list_channels: member count is a number')
  equal(result.data.channels[0].topic.value, 'Team news', 'slack list_channels: topic text')
  equal(result.data.channels[1].num_members, 0, 'slack list_channels: missing fields default to 0')
  equal(result.data.channels[1].is_private, false, 'slack list_channels: private flag defaults')
  equal(result.data.response_metadata.next_cursor, 'cursor-2', 'slack list_channels: next cursor')
  equal(requests[0].url, 'https://acme.slack.com/api/conversations.list', 'slack list_channels: workspace API endpoint')
  equal(requests[0].init.method, 'POST', 'slack list_channels: uses POST')
  equal(
    requests[0].init.headers['Content-Type'],
    'application/x-www-form-urlencoded',
    'slack list_channels: form-encoded body',
  )
  equal(requests[0].init.credentials, 'include', 'slack list_channels: sends credentials')
  const form = slackForm(requests[0])
  equal(form.get('token'), 'xoxc-test-token', 'slack list_channels: sends the page token')
  equal(form.get('limit'), '100', 'slack list_channels: default limit')
  equal(form.get('types'), 'public_channel', 'slack list_channels: default types')
  equal(form.get('_x_team_id'), 'T0123', 'slack list_channels: sends the team id')
  equal(form.get('_x_mode'), 'online', 'slack list_channels: sends the client metadata')
}

{
  // Slack: the current app.slack.com client exposes auth as window.boot_data
  // rather than localConfig — same call path, workspace URL from team_url.
  const requests = []
  const result = await runTool('com.slack.main', 'get_channel_info', {
    input: { channel: 'C1' },
    page: {
      hostname: 'app.slack.com',
      globals: {
        boot_data: { api_token: 'xoxc-boot', team_id: 'T9', team_url: 'https://acme.slack.com' },
      },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          ok: true,
          channel: { id: 'C1', name: 'general', is_channel: true, num_members: 3, topic: { value: 't' }, purpose: { value: 'p' } },
        })
      },
    },
  })
  equal(result.status, 'ok', 'slack get_channel_info boot_data: status')
  equal(result.data.channel.id, 'C1', 'slack get_channel_info boot_data: channel id')
  equal(requests[0].url, 'https://acme.slack.com/api/conversations.info', 'slack get_channel_info: workspace URL from boot_data')
  equal(slackForm(requests[0]).get('token'), 'xoxc-boot', 'slack get_channel_info: token from boot_data')

  // An Enterprise Grid tab belongs to the upstream slack-enterprise plugin: it
  // must fail loudly instead of silently acting on the wrong workspace type.
  const enterprise = await runTool('com.slack.main', 'get_channel_info', {
    input: { channel: 'C1' },
    page: {
      hostname: 'app.slack.com',
      globals: { boot_data: { api_token: 'xoxc-boot', is_enterprise_install: true } },
      fetch: async () => jsonResponse({ ok: true }),
    },
  })
  equal(enterprise.status, 'error', 'slack enterprise workspace: is an error')
  equal(enterprise.error_code, 'ENTERPRISE_WORKSPACE', 'slack enterprise workspace: is classified')
}

{
  // Slack: read_messages is cursor-paginated — the cursor travels as a form
  // field, the limit stays numeric, and the next cursor comes back verbatim.
  const requests = []
  const result = await runTool('com.slack.main', 'read_messages', {
    input: { channel: 'C1', limit: 50, cursor: 'dGVhbTpDMTIz' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          ok: true,
          messages: [
            { type: 'message', user: 'U1', text: 'deploying now', ts: '1700000000.000100' },
            { text: 'system note', ts: '1700000000.000200' },
          ],
          response_metadata: { next_cursor: 'bmV4dA' },
        })
      },
    }),
  })
  equal(result.status, 'ok', 'slack read_messages: status')
  equal(result.data.messages.length, 2, 'slack read_messages: message count')
  equal(result.data.messages[0].user, 'U1', 'slack read_messages: author id')
  equal(result.data.messages[0].type, 'message', 'slack read_messages: message type')
  equal(result.data.messages[0].ts, '1700000000.000100', 'slack read_messages: timestamp is the id')
  equal(result.data.messages[1].type, 'message', 'slack read_messages: type defaults')
  equal(result.data.messages[1].user, undefined, 'slack read_messages: author omitted when absent')
  equal(result.data.response_metadata.next_cursor, 'bmV4dA', 'slack read_messages: forwards the next cursor')
  equal(requests[0].url, 'https://acme.slack.com/api/conversations.history', 'slack read_messages: history endpoint')
  const form = slackForm(requests[0])
  equal(form.get('channel'), 'C1', 'slack read_messages: channel')
  equal(form.get('limit'), '50', 'slack read_messages: limit stays a number')
  equal(form.get('cursor'), 'dGVhbTpDMTIz', 'slack read_messages: cursor')
}

{
  // Slack: read_thread maps the reply shape and only reports pagination when
  // Slack actually returned a next cursor.
  const requests = []
  const result = await runTool('com.slack.main', 'read_thread', {
    input: { channel: 'C1', ts: '1700000000.000100' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          ok: true,
          messages: [
            { type: 'message', user: 'U1', text: 'parent', ts: '1700000000.000100', thread_ts: '1700000000.000100' },
            { type: 'message', user: 'U2', text: 'reply', ts: '1700000000.000300', thread_ts: '1700000000.000100' },
          ],
          has_more: false,
        })
      },
    }),
  })
  equal(result.status, 'ok', 'slack read_thread: status')
  equal(result.data.messages.length, 2, 'slack read_thread: includes the parent')
  equal(result.data.messages[1].thread_ts, '1700000000.000100', 'slack read_thread: reply thread timestamp')
  equal(result.data.has_more, false, 'slack read_thread: has_more flag')
  equal(result.data.response_metadata, undefined, 'slack read_thread: no pagination metadata without a cursor')
  equal(requests[0].url, 'https://acme.slack.com/api/conversations.replies', 'slack read_thread: replies endpoint')
  const form = slackForm(requests[0])
  equal(form.get('ts'), '1700000000.000100', 'slack read_thread: parent ts')
  equal(form.get('limit'), '20', 'slack read_thread: default limit')
}

{
  // Slack: send_message is a write through the same form-encoded path; an
  // optional thread_ts must reach the body and be omitted otherwise.
  const requests = []
  const result = await runTool('com.slack.main', 'send_message', {
    input: { channel: 'C1', text: 'shipping v1', thread_ts: '1700000000.000100' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ ok: true, channel: 'C1', ts: '1700000000.000900' })
      },
    }),
  })
  equal(result.status, 'ok', 'slack send_message: status')
  equal(result.data.channel, 'C1', 'slack send_message: channel')
  equal(result.data.ts, '1700000000.000900', 'slack send_message: posted ts')
  equal(requests[0].url, 'https://acme.slack.com/api/chat.postMessage', 'slack send_message: postMessage endpoint')
  const form = slackForm(requests[0])
  equal(form.get('text'), 'shipping v1', 'slack send_message: message text')
  equal(form.get('thread_ts'), '1700000000.000100', 'slack send_message: thread reply target')

  const plain = await runTool('com.slack.main', 'send_message', {
    input: { channel: 'C1', text: 'top level' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ ok: true, channel: 'C1', ts: '1700000000.001000' })
      },
    }),
  })
  equal(plain.status, 'ok', 'slack send_message without thread: status')
  equal(slackForm(requests[1]).get('thread_ts'), null, 'slack send_message: omits an absent thread_ts')
}

{
  // Slack: create_channel creates and then sets the topic in a second call.
  const requests = []
  const result = await runTool('com.slack.main', 'create_channel', {
    input: { name: 'project-updates', topic: 'Launch notes' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (String(url).endsWith('/api/conversations.create'))
          return jsonResponse({ ok: true, channel: { id: 'C9', name: 'project-updates', is_private: false } })
        return jsonResponse({ ok: true, channel: { id: 'C9', topic: { value: 'Launch notes' } } })
      },
    }),
  })
  equal(result.status, 'ok', 'slack create_channel: status')
  equal(result.data.channel.id, 'C9', 'slack create_channel: new channel id')
  equal(result.data.channel.is_private, false, 'slack create_channel: public by default')
  equal(result.data.warning, undefined, 'slack create_channel: no warning when the topic is set')
  equal(requests.length, 2, 'slack create_channel: create then setTopic')
  const create = slackForm(requests[0])
  equal(create.get('name'), 'project-updates', 'slack create_channel: channel name')
  equal(create.get('is_private'), 'false', 'slack create_channel: private flag is sent')
  const topic = slackForm(requests[1])
  equal(requests[1].url, 'https://acme.slack.com/api/conversations.setTopic', 'slack create_channel: setTopic endpoint')
  equal(topic.get('channel'), 'C9', 'slack create_channel: topic target')
  equal(topic.get('topic'), 'Launch notes', 'slack create_channel: topic text')
}

{
  // Slack: a failed topic update after a successful create is a warning, not a
  // failed tool call — the channel exists, the caller must learn that.
  const result = await runTool('com.slack.main', 'create_channel', {
    input: { name: 'ops', topic: 'Runbooks' },
    page: slackPage({
      fetch: async (url) => {
        if (String(url).endsWith('/api/conversations.create'))
          return jsonResponse({ ok: true, channel: { id: 'C10', name: 'ops', is_private: true } })
        return jsonResponse({ ok: false, error: 'cant_update_channel' })
      },
    }),
  })
  equal(result.status, 'ok', 'slack create_channel topic failure: still ok')
  equal(result.data.channel.id, 'C10', 'slack create_channel topic failure: channel reported')
  ok(
    String(result.data.warning).startsWith('Channel created but failed to set topic'),
    'slack create_channel topic failure: warning explains the partial success',
  )
}

{
  // Slack: upload_file posts multipart form data (V1 files.upload) — never a
  // JSON body — and lets the browser set the multipart boundary.
  const requests = []
  const result = await runTool('com.slack.main', 'upload_file', {
    input: { channel: 'C1', content: 'hello world', filename: 'note.txt', initial_comment: 'see attached' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ ok: true, file: { id: 'F1', title: 'ignored by the port' } })
      },
    }),
  })
  equal(result.status, 'ok', 'slack upload_file: status')
  equal(result.data.file.id, 'F1', 'slack upload_file: file id from the response')
  equal(result.data.file.title, 'note.txt', 'slack upload_file: title falls back to the filename')
  equal(requests[0].url, 'https://acme.slack.com/api/files.upload', 'slack upload_file: files.upload endpoint')
  equal(requests[0].init.method, 'POST', 'slack upload_file: uses POST')
  ok(requests[0].init.body instanceof FormData, 'slack upload_file: body is FormData')
  equal(requests[0].init.headers, undefined, 'slack upload_file: lets the browser set the multipart boundary')
  const body = requests[0].init.body
  equal(body.get('channels'), 'C1', 'slack upload_file: target channel')
  equal(body.get('filename'), 'note.txt', 'slack upload_file: filename')
  equal(body.get('initial_comment'), 'see attached', 'slack upload_file: comment')
  equal(body.get('file').name, 'note.txt', 'slack upload_file: file part carries the name')
  equal(requests[0].init.credentials, 'include', 'slack upload_file: sends credentials')
}

{
  // Slack: a base64 upload checks the claimed format's magic bytes before any
  // request, and keeps the decoded byte length.
  const requests = []
  const png = await runTool('com.slack.main', 'upload_file', {
    input: {
      channel: 'C1',
      content: 'iVBORw0KGgoAAAANSUhEUg==',
      is_base64: true,
      filename: 'chart.png',
    },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ ok: true, file: { id: 'F2' } })
      },
    }),
  })
  equal(png.status, 'ok', 'slack upload_file base64 png: status')
  equal(requests[0].init.body.get('file').size, 16, 'slack upload_file base64 png: decoded byte length')

  const mismatch = await runTool('com.slack.main', 'upload_file', {
    input: { channel: 'C1', content: 'aGVsbG8=', is_base64: true, filename: 'chart.pdf' },
    page: slackPage({
      fetch: async () => {
        throw new Error('must not send a mismatched file')
      },
    }),
  })
  equal(mismatch.status, 'error', 'slack upload_file magic mismatch: is an error')
  equal(mismatch.error_code, 'VALIDATION', 'slack upload_file magic mismatch: is VALIDATION')

  const blocked = await runTool('com.slack.main', 'upload_file', {
    input: { channel: 'C1', content: 'MZ', filename: 'setup.exe' },
    page: slackPage({ fetch: async () => jsonResponse({ ok: true }) }),
  })
  equal(blocked.status, 'error', 'slack upload_file blocked extension: is an error')
  equal(blocked.error_code, 'VALIDATION', 'slack upload_file blocked extension: is VALIDATION')
}

{
  // Slack: search_messages passes the enum sort fields through untouched and
  // unwraps the nested messages envelope.
  const requests = []
  const result = await runTool('com.slack.main', 'search_messages', {
    input: { query: 'from:@ada in:#general', count: 5, page: 2, sort: 'timestamp', sort_dir: 'asc' },
    page: slackPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          ok: true,
          messages: {
            total: 1,
            matches: [
              { channel: { id: 'C1', name: 'general' }, username: 'ada', text: 'hello', ts: '1700000000.000100', permalink: 'https://acme.slack.com/archives/C1/p1700000000000100' },
            ],
            paging: { count: 5, total: 1, page: 2, pages: 1 },
          },
        })
      },
    }),
  })
  equal(result.status, 'ok', 'slack search_messages: status')
  equal(result.data.messages.total, 1, 'slack search_messages: total')
  equal(result.data.messages.matches[0].channel.name, 'general', 'slack search_messages: match channel')
  equal(result.data.messages.matches[0].permalink.indexOf('https://acme.slack.com/archives/'), 0, 'slack search_messages: permalink')
  equal(result.data.messages.paging.page, 2, 'slack search_messages: paging page')
  const form = slackForm(requests[0])
  equal(requests[0].url, 'https://acme.slack.com/api/search.messages', 'slack search_messages: search endpoint')
  equal(form.get('sort'), 'timestamp', 'slack search_messages: sort enum')
  equal(form.get('sort_dir'), 'asc', 'slack search_messages: sort direction enum')
  equal(form.get('count'), '5', 'slack search_messages: count')
  equal(form.get('page'), '2', 'slack search_messages: page')
}

{
  // Slack: the auth-failure path. No token on the page is AUTH and makes no
  // request; a rejected token (invalid_auth) is AUTH; a 429 is RATE_LIMITED.
  const anonymousRequests = []
  const anonymous = await runTool('com.slack.main', 'list_users', {
    input: {},
    page: {
      hostname: SLACK_WORKSPACE,
      fetch: async (url, init) => {
        anonymousRequests.push({ url, init })
        return jsonResponse({ ok: true, members: [] })
      },
    },
  })
  equal(anonymous.status, 'error', 'slack list_users logged out: is an error')
  equal(anonymous.error_code, 'AUTH', 'slack list_users logged out: is AUTH')
  equal(anonymousRequests.length, 0, 'slack list_users logged out: makes no request')

  const rejected = await runTool('com.slack.main', 'list_users', {
    input: {},
    page: slackPage({ fetch: async () => jsonResponse({ ok: false, error: 'invalid_auth' }) }),
  })
  equal(rejected.status, 'error', 'slack list_users invalid token: is an error')
  equal(rejected.error_code, 'AUTH', 'slack list_users invalid token: is AUTH')
  ok(String(rejected.message).includes('invalid_auth'), 'slack list_users invalid token: keeps the Slack error')

  const rateLimited = await runTool('com.slack.main', 'list_users', {
    input: {},
    page: slackPage({
      fetch: async () => ({
        ok: false,
        status: 429,
        headers: { get: (name) => (name === 'Retry-After' ? '30' : null) },
        async text() {
          return 'ratelimited'
        },
        async json() {
          return {}
        },
      }),
    }),
  })
  equal(rateLimited.status, 'error', 'slack list_users rate limited: is an error')
  equal(rateLimited.error_code, 'RATE_LIMITED', 'slack list_users rate limited: is RATE_LIMITED')
}

// --- 4. Registry manifest ----------------------------------------------------

// Jira Cloud: the session identity is published on every page as meta tags
// (`ajs-atlassian-account-id`, `ajs-cloud-id`), and every call is a same-origin
// REST fetch under /rest/api/3 (Jira platform) or /rest/agile/1.0 (boards and
// sprints). Descriptions and comment bodies travel as Atlassian Document Format.

const JIRA_META = {
  'ajs-atlassian-account-id': '5b10ac8d82e05b22cc7d4ef5',
  'ajs-cloud-id': '2f1a2b3c-4d5e-6789-abcd-ef0123456789',
}

const JIRA_ISSUE = {
  id: '10042',
  key: 'KAN-42',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10042',
  fields: {
    summary: 'Rate limit the public export endpoint',
    status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
    issuetype: { name: 'Task' },
    priority: { name: 'High' },
    assignee: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Ada Lovelace' },
    reporter: { accountId: '712020:1b2c3d4e-0000-1111-2222-333344445555', displayName: 'Grace Hopper' },
    project: { key: 'KAN', name: 'Kanban' },
    labels: ['backend', 'perf'],
    created: '2026-02-03T09:15:00.000+0000',
    updated: '2026-02-04T11:02:31.000+0000',
    description: {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Exports currently bypass the limiter.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Add a per-token budget.' }] },
      ],
    },
  },
}

{
  // Jira: search_issues runs JQL against /rest/api/3/search/jql and maps the
  // ADF description to plain text (paragraphs joined by a newline).
  const requests = []
  const result = await runTool('com.jira.main', 'search_issues', {
    input: { jql: 'project = KAN AND status = "In Progress"' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ issues: [JIRA_ISSUE], total: 1, startAt: 0, maxResults: 20 })
      },
    },
  })
  equal(result.status, 'ok', 'jira search_issues: status')
  equal(result.data.total, 1, 'jira search_issues: total')
  equal(result.data.start_at, 0, 'jira search_issues: start_at')
  equal(result.data.issues[0].key, 'KAN-42', 'jira search_issues: issue key')
  equal(result.data.issues[0].summary, 'Rate limit the public export endpoint', 'jira search_issues: summary')
  equal(result.data.issues[0].status, 'In Progress', 'jira search_issues: status')
  equal(result.data.issues[0].status_category, 'In Progress', 'jira search_issues: status category')
  equal(result.data.issues[0].issue_type, 'Task', 'jira search_issues: issue type')
  equal(result.data.issues[0].priority, 'High', 'jira search_issues: priority')
  equal(result.data.issues[0].assignee_name, 'Ada Lovelace', 'jira search_issues: assignee name')
  equal(result.data.issues[0].project_key, 'KAN', 'jira search_issues: project key')
  equal(result.data.issues[0].labels.join(','), 'backend,perf', 'jira search_issues: labels')
  equal(
    result.data.issues[0].description_text,
    'Exports currently bypass the limiter.\nAdd a per-token budget.',
    'jira search_issues: ADF description flattened per paragraph',
  )
  ok(String(requests[0].url).startsWith('/rest/api/3/search/jql?'), 'jira search_issues: uses the platform search endpoint')
  ok(String(requests[0].url).includes('jql=project+%3D+KAN+AND+status+%3D+%22In+Progress%22'), 'jira search_issues: sends JQL')
  ok(String(requests[0].url).includes('maxResults=20'), 'jira search_issues: defaults maxResults')
  ok(String(requests[0].url).includes('fields=summary%2Cstatus'), 'jira search_issues: requests the standard field set')
  equal(requests[0].init.method, 'GET', 'jira search_issues: GET')
  equal(requests[0].init.headers['Content-Type'], undefined, 'jira search_issues: no JSON content type on a read')
  equal(requests[0].init.credentials, 'include', 'jira search_issues: sends credentials')
}

{
  // Jira: get_issue asks for the explicit field list and maps reporter too.
  const requests = []
  const result = await runTool('com.jira.main', 'get_issue', {
    input: { issue_key: 'KAN-42' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse(JIRA_ISSUE)
      },
    },
  })
  equal(result.status, 'ok', 'jira get_issue: status')
  equal(result.data.issue.id, '10042', 'jira get_issue: id')
  equal(result.data.issue.key, 'KAN-42', 'jira get_issue: key')
  equal(result.data.issue.reporter_name, 'Grace Hopper', 'jira get_issue: reporter name')
  equal(result.data.issue.project_name, 'Kanban', 'jira get_issue: project name')
  equal(result.data.issue.assignee_id, '5b10ac8d82e05b22cc7d4ef5', 'jira get_issue: assignee id')
  ok(String(requests[0].url).startsWith('/rest/api/3/issue/KAN-42?fields='), 'jira get_issue: issue endpoint with fields')
}

{
  // Jira: create_issue posts a JSON body with the ADF description and only the
  // optional fields that were supplied (no priority, no parent).
  const requests = []
  const result = await runTool('com.jira.main', 'create_issue', {
    input: {
      project_key: 'KAN',
      summary: 'Rate limit the public export endpoint',
      description: 'Exports currently bypass the limiter.',
      labels: ['backend', 'perf'],
      assignee_id: '5b10ac8d82e05b22cc7d4ef5',
    },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ id: '10042', key: 'KAN-42', self: 'https://acme.atlassian.net/rest/api/3/issue/10042' }, 201)
      },
    },
  })
  equal(result.status, 'ok', 'jira create_issue: status')
  equal(result.data.id, '10042', 'jira create_issue: id')
  equal(result.data.key, 'KAN-42', 'jira create_issue: key')
  equal(requests[0].url, '/rest/api/3/issue', 'jira create_issue: creates through /issue')
  equal(requests[0].init.method, 'POST', 'jira create_issue: uses POST')
  equal(requests[0].init.headers['Content-Type'], 'application/json', 'jira create_issue: sends JSON')
  equal(requests[0].init.credentials, 'include', 'jira create_issue: sends credentials')
  const body = JSON.parse(requests[0].init.body)
  equal(body.fields.project.key, 'KAN', 'jira create_issue: project key')
  equal(body.fields.summary, 'Rate limit the public export endpoint', 'jira create_issue: summary')
  equal(body.fields.issuetype.name, 'Task', 'jira create_issue: issue type defaults to Task')
  equal(body.fields.description.type, 'doc', 'jira create_issue: description is ADF')
  equal(
    body.fields.description.content[0].content[0].text,
    'Exports currently bypass the limiter.',
    'jira create_issue: ADF text',
  )
  equal(body.fields.labels.join(','), 'backend,perf', 'jira create_issue: labels stay an array')
  equal(body.fields.assignee.accountId, '5b10ac8d82e05b22cc7d4ef5', 'jira create_issue: assignee account id')
  ok(!('priority' in body.fields), 'jira create_issue: omits an unspecified priority')
  ok(!('parent' in body.fields), 'jira create_issue: omits an unspecified parent')
}

{
  // Jira: update_issue PUTs only the supplied fields; an empty assignee_id
  // unassigns with an explicit null instead of an accountId object.
  const requests = []
  const result = await runTool('com.jira.main', 'update_issue', {
    input: { issue_key: 'KAN-42', summary: 'Rate limit the export endpoint', assignee_id: '' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return { ok: true, status: 204, headers: { get: () => null }, async text() { return '' }, async json() { return {} } }
      },
    },
  })
  equal(result.status, 'ok', 'jira update_issue: status')
  equal(result.data.success, true, 'jira update_issue: success flag')
  equal(requests[0].url, '/rest/api/3/issue/KAN-42', 'jira update_issue: updates the issue endpoint')
  equal(requests[0].init.method, 'PUT', 'jira update_issue: uses PUT')
  const body = JSON.parse(requests[0].init.body)
  equal(Object.keys(body.fields).sort().join(','), 'assignee,summary', 'jira update_issue: only supplied fields')
  equal(body.fields.summary, 'Rate limit the export endpoint', 'jira update_issue: new summary')
  equal(body.fields.assignee, null, 'jira update_issue: empty account id unassigns with null')
}

{
  // Jira: transition_issue posts the transition id the caller got from
  // get_transitions.
  const requests = []
  const result = await runTool('com.jira.main', 'transition_issue', {
    input: { issue_key: 'KAN-42', transition_id: '31' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return { ok: true, status: 204, headers: { get: () => null }, async text() { return '' }, async json() { return {} } }
      },
    },
  })
  equal(result.status, 'ok', 'jira transition_issue: status')
  equal(result.data.success, true, 'jira transition_issue: success flag')
  equal(requests[0].url, '/rest/api/3/issue/KAN-42/transitions', 'jira transition_issue: transitions endpoint')
  equal(requests[0].init.method, 'POST', 'jira transition_issue: uses POST')
  equal(JSON.parse(requests[0].init.body).transition.id, '31', 'jira transition_issue: sends the transition id')
}

{
  // Jira: add_comment wraps plain text in ADF and maps the created comment back.
  const requests = []
  const result = await runTool('com.jira.main', 'add_comment', {
    input: { issue_key: 'KAN-42', body: 'On it — the limiter lands today.' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          id: '10077',
          author: { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Ada Lovelace' },
          body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On it — the limiter lands today.' }] }] },
          created: '2026-02-04T12:00:00.000+0000',
          updated: '2026-02-04T12:00:00.000+0000',
        })
      },
    },
  })
  equal(result.status, 'ok', 'jira add_comment: status')
  equal(result.data.comment.id, '10077', 'jira add_comment: comment id')
  equal(result.data.comment.author_name, 'Ada Lovelace', 'jira add_comment: author')
  equal(result.data.comment.body_text, 'On it — the limiter lands today.', 'jira add_comment: body text')
  equal(requests[0].url, '/rest/api/3/issue/KAN-42/comment', 'jira add_comment: comment endpoint')
  equal(requests[0].init.method, 'POST', 'jira add_comment: uses POST')
  const body = JSON.parse(requests[0].init.body)
  equal(body.body.type, 'doc', 'jira add_comment: body is ADF')
  equal(body.body.content[0].content[0].text, 'On it — the limiter lands today.', 'jira add_comment: ADF text')
}

{
  // Jira: add_watcher posts a bare JSON string (not an object) — the endpoint
  // takes the account id as the request body.
  const requests = []
  const result = await runTool('com.jira.main', 'add_watcher', {
    input: { issue_key: 'KAN-42', account_id: '5b10ac8d82e05b22cc7d4ef5' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return { ok: true, status: 204, headers: { get: () => null }, async text() { return '' }, async json() { return {} } }
      },
    },
  })
  equal(result.status, 'ok', 'jira add_watcher: status')
  equal(requests[0].url, '/rest/api/3/issue/KAN-42/watchers', 'jira add_watcher: watchers endpoint')
  equal(requests[0].init.body, '"5b10ac8d82e05b22cc7d4ef5"', 'jira add_watcher: body is a bare JSON string')
  equal(requests[0].init.headers['Content-Type'], 'application/json', 'jira add_watcher: JSON content type')
}

{
  // Jira: list_boards uses the agile API base path, not /rest/api/3.
  const requests = []
  const result = await runTool('com.jira.main', 'list_boards', {
    input: { project_key: 'KAN' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          maxResults: 50,
          startAt: 0,
          total: 1,
          isLast: true,
          values: [
            {
              id: 7,
              self: 'https://acme.atlassian.net/rest/agile/1.0/board/7',
              name: 'KAN board',
              type: 'scrum',
              location: { projectId: 10001, displayName: 'Kanban', projectKey: 'KAN', projectName: 'Kanban' },
            },
          ],
        })
      },
    },
  })
  equal(result.status, 'ok', 'jira list_boards: status')
  equal(result.data.total, 1, 'jira list_boards: total')
  equal(result.data.boards[0].id, 7, 'jira list_boards: board id stays numeric')
  equal(result.data.boards[0].name, 'KAN board', 'jira list_boards: board name')
  equal(result.data.boards[0].type, 'scrum', 'jira list_boards: board type')
  equal(result.data.boards[0].project_key, 'KAN', 'jira list_boards: project key from location')
  ok(String(requests[0].url).startsWith('/rest/agile/1.0/board?'), 'jira list_boards: agile endpoint')
  ok(String(requests[0].url).includes('projectKeyOrId=KAN'), 'jira list_boards: filters by project')
  ok(String(requests[0].url).includes('maxResults=50'), 'jira list_boards: defaults maxResults')
}

{
  // Jira: delete_issue sends deleteSubtasks and treats the 204 as success.
  const requests = []
  const result = await runTool('com.jira.main', 'delete_issue', {
    input: { issue_key: 'KAN-42' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return { ok: true, status: 204, headers: { get: () => null }, async text() { return '' }, async json() { return {} } }
      },
    },
  })
  equal(result.status, 'ok', 'jira delete_issue: status')
  equal(result.data.success, true, 'jira delete_issue: success flag')
  equal(requests[0].init.method, 'DELETE', 'jira delete_issue: uses DELETE')
  equal(requests[0].url, '/rest/api/3/issue/KAN-42?deleteSubtasks=false', 'jira delete_issue: sends deleteSubtasks')
}

{
  // Jira: a 403 from the API is classified as AUTH (permission), not a crash.
  const forbidden = await runTool('com.jira.main', 'search_issues', {
    input: { jql: 'project = KAN' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async () =>
        jsonResponse({ errorMessages: ['You do not have permission to search issues.'], errors: {} }, 403),
    },
  })
  equal(forbidden.status, 'error', 'jira search_issues 403: is an error')
  equal(forbidden.error_code, 'AUTH', 'jira search_issues 403: classified as AUTH')
  ok(
    String(forbidden.message).includes('You do not have permission'),
    'jira search_issues 403: surfaces the API error message',
  )

  // Jira: a 401 is AUTH too, and no request is made on a logged-out page.
  const unauthorized = await runTool('com.jira.main', 'get_issue', {
    input: { issue_key: 'KAN-42' },
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async () => jsonResponse({ errorMessages: ['Authentication required.'] }, 401),
    },
  })
  equal(unauthorized.status, 'error', 'jira get_issue 401: is an error')
  equal(unauthorized.error_code, 'AUTH', 'jira get_issue 401: classified as AUTH')

  const requests = []
  const anonymous = await runTool('com.jira.main', 'get_myself', {
    input: {},
    page: {
      hostname: 'acme.atlassian.net',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({})
      },
    },
  })
  equal(anonymous.status, 'error', 'jira get_myself logged out: is an error')
  equal(anonymous.error_code, 'UNAUTHENTICATED', 'jira get_myself logged out: classified as UNAUTHENTICATED')
  equal(requests.length, 0, 'jira get_myself logged out: makes no request')
}

{
  // Jira: get_myself maps the Atlassian account envelope.
  const requests = []
  const result = await runTool('com.jira.main', 'get_myself', {
    input: {},
    page: {
      hostname: 'acme.atlassian.net',
      meta: JIRA_META,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          accountId: '5b10ac8d82e05b22cc7d4ef5',
          displayName: 'Ada Lovelace',
          emailAddress: 'ada@example.com',
          active: true,
          accountType: 'atlassian',
          timeZone: 'Europe/London',
        })
      },
    },
  })
  equal(result.status, 'ok', 'jira get_myself: status')
  equal(result.data.user.account_id, '5b10ac8d82e05b22cc7d4ef5', 'jira get_myself: account id')
  equal(result.data.user.display_name, 'Ada Lovelace', 'jira get_myself: display name')
  equal(result.data.user.account_type, 'atlassian', 'jira get_myself: account type')
  equal(requests[0].url, '/rest/api/3/myself', 'jira get_myself: myself endpoint')
}

// --- 4. Registry manifest ----------------------------------------------------

// Todoist: every tool reads the bearer token the web app keeps in
// localStorage['User'] and calls the same-origin /api/v1 REST API with
// credentials. List endpoints answer a { results, next_cursor } envelope;
// close/reopen/delete/archive answer 204 No Content.

function todoistPage(overrides = {}) {
  return {
    hostname: 'app.todoist.com',
    localStorage: { User: JSON.stringify({ id: '42', token: 'todoist-token' }) },
    ...overrides,
  }
}

function noContentResponse(status = 204) {
  return {
    ok: true,
    status,
    headers: { get: () => null },
    async text() {
      return ''
    },
    async json() {
      throw new SyntaxError('Unexpected end of JSON input')
    },
  }
}

const TODOIST_TASK = {
  id: '8f9aB2cD',
  content: 'Ship the Todoist port',
  description: 'All 33 tools',
  project_id: '6X7rM2fP',
  section_id: null,
  parent_id: null,
  labels: ['infra', 'port'],
  priority: 3,
  due: {
    string: 'tomorrow at 3pm',
    date: '2026-11-20',
    is_recurring: false,
    datetime: null,
    timezone: null,
  },
  deadline: { date: '2026-11-25' },
  duration: { amount: 30, unit: 'minute' },
  checked: false,
  child_order: 7,
  added_at: '2026-11-18T09:00:00Z',
  user_id: '42',
  responsible_uid: null,
  note_count: 2,
}

{
  // Todoist: list_tasks sends the optional filters as query parameters (never
  // the string "undefined") and maps the results envelope into task objects.
  const requests = []
  const result = await runTool('com.todoist.main', 'list_tasks', {
    input: { project_id: '6X7rM2fP' },
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ results: [TODOIST_TASK], next_cursor: null })
      },
    }),
  })
  equal(result.status, 'ok', 'todoist list_tasks: status')
  equal(result.data.tasks.length, 1, 'todoist list_tasks: task count')
  equal(result.data.tasks[0].id, '8f9aB2cD', 'todoist list_tasks: task id')
  equal(result.data.tasks[0].section_id, null, 'todoist list_tasks: null section stays null')
  equal(result.data.tasks[0].labels[1], 'port', 'todoist list_tasks: label names')
  equal(result.data.tasks[0].priority, 3, 'todoist list_tasks: priority stays a number')
  equal(result.data.tasks[0].due.string, 'tomorrow at 3pm', 'todoist list_tasks: due string')
  equal(result.data.tasks[0].due.is_recurring, false, 'todoist list_tasks: due is_recurring flag')
  equal(result.data.tasks[0].deadline.date, '2026-11-25', 'todoist list_tasks: deadline date')
  equal(result.data.tasks[0].duration.unit, 'minute', 'todoist list_tasks: duration unit')
  equal(result.data.tasks[0].is_completed, false, 'todoist list_tasks: checked maps to is_completed')
  equal(result.data.tasks[0].order, 7, 'todoist list_tasks: child_order maps to order')
  equal(result.data.tasks[0].creator_id, '42', 'todoist list_tasks: user_id maps to creator_id')
  equal(result.data.tasks[0].comment_count, 2, 'todoist list_tasks: note_count maps to comment_count')
  equal(result.data.tasks[0].url, 'https://app.todoist.com/app/task/8f9aB2cD', 'todoist list_tasks: task url')
  equal(
    requests[0].url,
    'https://app.todoist.com/api/v1/tasks?project_id=6X7rM2fP',
    'todoist list_tasks: same-origin /api/v1/tasks with only the supplied filter',
  )
  equal(requests[0].init.method, 'GET', 'todoist list_tasks: plain GET')
  equal(requests[0].init.credentials, 'include', 'todoist list_tasks: sends credentials')
  equal(
    requests[0].init.headers.Authorization,
    'Bearer todoist-token',
    'todoist list_tasks: bearer token from localStorage',
  )
}

{
  // Todoist: the batch read path — a { results, next_cursor } envelope with
  // several objects — maps every project, inbox and nested ones included.
  const requests = []
  const result = await runTool('com.todoist.main', 'list_projects', {
    input: {},
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          results: [
            {
              id: '6X7rM2fP',
              name: 'Inbox',
              color: 'grey',
              description: '',
              parent_id: null,
              child_order: 0,
              is_favorite: false,
              is_archived: false,
              is_shared: false,
              view_style: 'list',
              created_at: '2026-01-02T03:04:05Z',
              updated_at: '2026-01-02T03:04:05Z',
              inbox_project: true,
            },
            {
              id: '7Y8sN3gQ',
              name: 'Platform',
              color: 'berry_red',
              description: 'Shared roadmap',
              parent_id: '6X7rM2fP',
              child_order: 4,
              is_favorite: true,
              is_archived: false,
              is_shared: true,
              view_style: 'board',
              created_at: '2026-02-03T04:05:06Z',
              updated_at: '2026-03-04T05:06:07Z',
            },
          ],
          next_cursor: 'cursor-2',
        })
      },
    }),
  })
  equal(result.status, 'ok', 'todoist list_projects: status')
  equal(result.data.projects.length, 2, 'todoist list_projects: whole batch returned')
  equal(result.data.projects[0].inbox_project, true, 'todoist list_projects: inbox flag')
  equal(result.data.projects[0].parent_id, null, 'todoist list_projects: null parent stays null')
  equal(result.data.projects[1].parent_id, '6X7rM2fP', 'todoist list_projects: nested parent id')
  equal(result.data.projects[1].view_style, 'board', 'todoist list_projects: view style')
  equal(result.data.projects[1].is_favorite, true, 'todoist list_projects: favorite flag')
  equal(result.data.projects[1].is_shared, true, 'todoist list_projects: shared flag')
  equal(result.data.projects[1].description, 'Shared roadmap', 'todoist list_projects: description')
  equal(requests[0].url, 'https://app.todoist.com/api/v1/projects', 'todoist list_projects: /api/v1/projects')
}

{
  // Todoist: create_task POSTs a JSON body that carries only the supplied
  // fields, and maps the created object back.
  const requests = []
  const result = await runTool('com.todoist.main', 'create_task', {
    input: {
      content: 'Ship the Todoist port',
      project_id: '6X7rM2fP',
      labels: ['infra', 'port'],
      priority: 3,
      due_string: 'tomorrow at 3pm',
    },
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse(TODOIST_TASK)
      },
    }),
  })
  equal(result.status, 'ok', 'todoist create_task: status')
  equal(result.data.task.id, '8f9aB2cD', 'todoist create_task: created task id')
  equal(requests[0].url, 'https://app.todoist.com/api/v1/tasks', 'todoist create_task: /api/v1/tasks')
  equal(requests[0].init.method, 'POST', 'todoist create_task: uses POST')
  equal(requests[0].init.credentials, 'include', 'todoist create_task: sends credentials')
  equal(
    requests[0].init.headers['Content-Type'],
    'application/json',
    'todoist create_task: JSON content type',
  )
  const body = JSON.parse(requests[0].init.body)
  equal(body.content, 'Ship the Todoist port', 'todoist create_task: sends content')
  equal(body.project_id, '6X7rM2fP', 'todoist create_task: sends project_id')
  equal(body.labels.length, 2, 'todoist create_task: sends the label array')
  equal(body.priority, 3, 'todoist create_task: sends priority as a number')
  equal(body.due_string, 'tomorrow at 3pm', 'todoist create_task: sends due_string')
  ok(!('due_date' in body), 'todoist create_task: omits an unset due_date')
  ok(!('duration' in body), 'todoist create_task: omits an unset duration')
  ok(!('assignee_id' in body), 'todoist create_task: omits an unset assignee_id')
}

{
  // Todoist: close_task answers 204 No Content — the empty body must not be
  // parsed as JSON and the tool still reports success.
  const requests = []
  const result = await runTool('com.todoist.main', 'close_task', {
    input: { task_id: '8f9aB2cD' },
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return noContentResponse()
      },
    }),
  })
  equal(result.status, 'ok', 'todoist close_task: status')
  equal(result.data.success, true, 'todoist close_task: success flag')
  equal(
    requests[0].url,
    'https://app.todoist.com/api/v1/tasks/8f9aB2cD/close',
    'todoist close_task: /close endpoint',
  )
  equal(requests[0].init.method, 'POST', 'todoist close_task: uses POST')
  equal(requests[0].init.body, undefined, 'todoist close_task: sends no body')
  equal(
    requests[0].init.headers['Content-Type'],
    undefined,
    'todoist close_task: no content type without a body',
  )
  equal(
    requests[0].init.headers.Authorization,
    'Bearer todoist-token',
    'todoist close_task: sends the bearer token',
  )
}

{
  // Todoist: delete_task is a DELETE that also answers 204.
  const requests = []
  const result = await runTool('com.todoist.main', 'delete_task', {
    input: { task_id: '8f9aB2cD' },
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return noContentResponse()
      },
    }),
  })
  equal(result.status, 'ok', 'todoist delete_task: status')
  equal(result.data.success, true, 'todoist delete_task: success flag')
  equal(requests[0].url, 'https://app.todoist.com/api/v1/tasks/8f9aB2cD', 'todoist delete_task: task endpoint')
  equal(requests[0].init.method, 'DELETE', 'todoist delete_task: uses DELETE')
}

{
  // Todoist: renewing a shared label goes through apiVoid's default POST with
  // a JSON body — no method override, no response body.
  const requests = []
  const result = await runTool('com.todoist.main', 'rename_shared_label', {
    input: { name: 'infra', new_name: 'platform' },
    page: todoistPage({
      fetch: async (url, init) => {
        requests.push({ url, init })
        return noContentResponse()
      },
    }),
  })
  equal(result.status, 'ok', 'todoist rename_shared_label: status')
  equal(requests[0].url, 'https://app.todoist.com/api/v1/labels/shared/rename', 'todoist rename_shared_label: endpoint')
  equal(requests[0].init.method, 'POST', 'todoist rename_shared_label: defaults to POST')
  const body = JSON.parse(requests[0].init.body)
  equal(body.new_name, 'platform', 'todoist rename_shared_label: sends new_name')
}

{
  // Todoist: a tab with no localStorage['User'] token fails before any request
  // is made, and an HTTP 401 is classified as AUTH.
  const requests = []
  const anonymous = await runTool('com.todoist.main', 'list_projects', {
    input: {},
    page: {
      hostname: 'app.todoist.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({})
      },
    },
  })
  equal(anonymous.status, 'error', 'todoist auth: logged-out tab is an error')
  equal(anonymous.error_code, 'UNAUTHENTICATED', 'todoist auth: logged-out tab is UNAUTHENTICATED')
  equal(requests.length, 0, 'todoist auth: logged-out tab makes no request')

  const rejected = await runTool('com.todoist.main', 'list_projects', {
    input: {},
    page: todoistPage({
      fetch: async () => jsonResponse({ error: 'unauthorized' }, 401),
    }),
  })
  equal(rejected.status, 'error', 'todoist auth: 401 is an error')
  equal(rejected.error_code, 'AUTH', 'todoist auth: 401 is classified as AUTH')
  ok(String(rejected.message).includes('401'), 'todoist auth: 401 stays visible in the message')
}

// --- urlRegex probes ---------------------------------------------------------
// The host toolbar only offers these tools on app.todoist.com; a lookalike host
// or the plain-HTTP origin must not match, while any path, query or hash tail
// on the real origin must.

section('urlRegex probe: app.todoist.com')

{
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.todoist.main', 'manifest.json'), 'utf8'),
  )
  const mustMatch = [
    'https://app.todoist.com/',
    'https://app.todoist.com/app/today',
    'https://app.todoist.com/app/project/6X7rM2fP/v2?view=board&lang=en',
    'https://app.todoist.com/app/task/8f9aB2cD#comment-1234',
  ]
  const mustNotMatch = [
    'https://todoist.com/app/today',
    'http://app.todoist.com/app/today',
    'https://app.todoist.com.evil.example/app/today',
    'https://evilapp.todoist.com/app/today',
    'https://user@app.todoist.com/app/today',
    'https://app.todoist.com:8443/app/today',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `todoist urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch)
      ok(!regex.test(url), `todoist urlRegex rejects ${url} (${tool.name})`)
  }
}

// --- urlRegex probe: calendar.google.com ------------------------------------

section('urlRegex probe: calendar.google.com')

{
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.google-calendar.main', 'manifest.json'), 'utf8'),
  )
  const mustMatch = [
    'https://calendar.google.com/',
    'https://calendar.google.com/calendar/u/0/r/week',
    'https://calendar.google.com/calendar/u/0/r/day?src=cal&ctz=Asia%2FShanghai',
    'https://calendar.google.com/calendar/u/0/r/eventedit/abc123#main',
  ]
  const mustNotMatch = [
    'http://calendar.google.com/calendar/u/0/r/week',
    'https://calendar.google.com.evil.example/calendar/u/0/r/week',
    'https://evilcalendar.google.com/calendar/u/0/r/week',
    'https://calendar.google.com:8443/calendar/u/0/r/week',
    'https://mail.google.com/calendar/u/0/r/week',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `google-calendar urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch)
      ok(!regex.test(url), `google-calendar urlRegex rejects ${url} (${tool.name})`)
  }
}

// --- Google Calendar execution ----------------------------------------------
// The Calendar web app signs every API call through gapi.client.request, which
// resolves with { status, result }. The stub records the request descriptors and
// answers with realistic Calendar resources, so the ported transport parsing and
// resource mapping really run.

section('execution: Google Calendar tools against a stubbed page')

function gcalPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'calendar.google.com',
    globals: {
      gapi: {
        client: {
          request: async (options) => {
            requests.push(options)
            return handler(options)
          },
        },
      },
    },
    ...extra,
  }
  return { requests, page }
}

const GCAL_EVENT = {
  kind: 'calendar#event',
  id: 'evt_1',
  status: 'confirmed',
  htmlLink: 'https://www.google.com/calendar/event?eid=ZXZ0XzE',
  summary: 'Weekly sync',
  description: 'Roadmap checkpoint',
  location: 'Room 4',
  creator: { email: 'ada@example.com', self: true },
  organizer: { email: 'ada@example.com', displayName: 'Ada Lovelace' },
  start: { dateTime: '2026-11-20T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
  end: { dateTime: '2026-11-20T10:30:00+08:00', timeZone: 'Asia/Shanghai' },
  created: '2026-11-01T09:00:00.000Z',
  updated: '2026-11-18T09:00:00.000Z',
  attendees: [
    { email: 'grace@example.com', displayName: 'Grace Hopper', responseStatus: 'accepted', optional: true },
    { email: 'ada@example.com', self: true, organizer: true, responseStatus: 'accepted' },
  ],
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
  colorId: '7',
  transparency: 'transparent',
  visibility: 'private',
  eventType: 'default',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  conferenceData: {
    entryPoints: [
      { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
      { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij?hs=224' },
    ],
  },
}

{
  // Calendar list: the primary calendar plus a subscribed holiday calendar.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: {
      items: [
        {
          id: 'ada@example.com',
          summary: 'Ada Lovelace',
          timeZone: 'Asia/Shanghai',
          backgroundColor: '#9fe1e7',
          foregroundColor: '#1d1d1d',
          selected: true,
          accessRole: 'owner',
          primary: true,
        },
        {
          id: 'en.usa#holiday@group.v.calendar.google.com',
          summary: 'Holidays in the United States',
          accessRole: 'reader',
          selected: false,
        },
      ],
    },
  }))
  const result = await runTool('com.google-calendar.main', 'list_calendars', {
    input: { show_hidden: true },
    page,
  })
  equal(result.status, 'ok', 'google list_calendars: status')
  equal(result.data.calendars.length, 2, 'google list_calendars: calendar count')
  equal(result.data.calendars[0].is_primary, true, 'google list_calendars: primary flag')
  equal(result.data.calendars[0].time_zone, 'Asia/Shanghai', 'google list_calendars: time zone')
  equal(result.data.calendars[1].access_role, 'reader', 'google list_calendars: access role')
  equal(requests[0].path, '/calendar/v3/users/me/calendarList', 'google list_calendars: endpoint')
  equal(requests[0].params.showHidden, true, 'google list_calendars: showHidden param')
  ok(!('showDeleted' in requests[0].params), 'google list_calendars: undefined params filtered')
}

{
  // Event list for an explicit range: singleEvents expansion defaults to true and
  // orderBy follows it.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { items: [GCAL_EVENT], nextPageToken: 'page-2' },
  }))
  const result = await runTool('com.google-calendar.main', 'list_events', {
    input: { time_min: '2026-11-19T00:00:00+08:00', time_max: '2026-11-26T00:00:00+08:00' },
    page,
  })
  equal(result.status, 'ok', 'google list_events: status')
  equal(result.data.events[0].summary, 'Weekly sync', 'google list_events: summary')
  equal(result.data.events[0].start.date_time, '2026-11-20T10:00:00+08:00', 'google list_events: start')
  equal(result.data.events[0].organizer_email, 'ada@example.com', 'google list_events: organizer')
  equal(result.data.next_page_token, 'page-2', 'google list_events: next page token')
  equal(requests[0].path, '/calendar/v3/calendars/primary/events', 'google list_events: endpoint')
  equal(requests[0].params.timeMin, '2026-11-19T00:00:00+08:00', 'google list_events: timeMin')
  equal(requests[0].params.timeMax, '2026-11-26T00:00:00+08:00', 'google list_events: timeMax')
  equal(requests[0].params.maxResults, 25, 'google list_events: default maxResults')
  equal(requests[0].params.singleEvents, true, 'google list_events: singleEvents default')
  equal(requests[0].params.orderBy, 'startTime', 'google list_events: orderBy default')
}

{
  // Single event read: attendees, reminder overrides and the video conference
  // entry point all map through upstream's defensive mappers.
  const { requests, page } = gcalPage(() => ({ status: 200, result: GCAL_EVENT }))
  const result = await runTool('com.google-calendar.main', 'get_event', {
    input: { event_id: 'evt_1' },
    page,
  })
  equal(result.status, 'ok', 'google get_event: status')
  equal(result.data.event.id, 'evt_1', 'google get_event: id')
  equal(result.data.event.attendees.length, 2, 'google get_event: attendee count')
  equal(
    result.data.event.attendees[0].response_status,
    'accepted',
    'google get_event: attendee response status',
  )
  equal(result.data.event.attendees[0].is_optional, true, 'google get_event: optional flag')
  equal(result.data.event.uses_default_reminders, false, 'google get_event: custom reminders')
  equal(result.data.event.reminders[0].method, 'popup', 'google get_event: reminder method')
  equal(
    result.data.event.conference_uri,
    'https://meet.google.com/abc-defg-hij?hs=224',
    'google get_event: video entry point',
  )
  equal(requests[0].path, '/calendar/v3/calendars/primary/events/evt_1', 'google get_event: endpoint')
}

{
  // Create: timed event body mapping, attendees as { email }, explicit reminders,
  // and sendUpdates defaulting to none.
  const { requests, page } = gcalPage((options) => ({
    status: 200,
    result: {
      ...GCAL_EVENT,
      summary: JSON.parse(options.body).summary,
    },
  }))
  const result = await runTool('com.google-calendar.main', 'create_event', {
    input: {
      summary: 'Design review',
      start_datetime: '2026-11-21T14:00:00+08:00',
      time_zone: 'Asia/Shanghai',
      attendees: ['grace@example.com'],
      reminders: [{ method: 'email', minutes: 30 }],
      color_id: '9',
    },
    page,
  })
  equal(result.status, 'ok', 'google create_event: status')
  equal(result.data.event.summary, 'Design review', 'google create_event: summary round trip')
  const body = JSON.parse(requests[0].body)
  equal(requests[0].method, 'POST', 'google create_event: POST')
  equal(requests[0].path, '/calendar/v3/calendars/primary/events', 'google create_event: endpoint')
  equal(body.start.dateTime, '2026-11-21T14:00:00+08:00', 'google create_event: start dateTime')
  equal(body.start.timeZone, 'Asia/Shanghai', 'google create_event: start time zone')
  equal(body.end.dateTime, '2026-11-21T14:00:00+08:00', 'google create_event: end defaults to start')
  equal(body.attendees[0].email, 'grace@example.com', 'google create_event: attendee mapping')
  equal(body.reminders.useDefault, false, 'google create_event: reminders disabled default')
  equal(body.reminders.overrides[0].minutes, 30, 'google create_event: reminder minutes')
  equal(body.colorId, '9', 'google create_event: color id')
  equal(requests[0].params.sendUpdates, 'none', 'google create_event: sendUpdates default')
}

{
  // Update: PATCH semantics — only the fields the caller sent reach the body.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { ...GCAL_EVENT, summary: 'Weekly sync (moved)' },
  }))
  const result = await runTool('com.google-calendar.main', 'update_event', {
    input: { event_id: 'evt_1', summary: 'Weekly sync (moved)', start_datetime: '2026-11-20T11:00:00+08:00' },
    page,
  })
  equal(result.status, 'ok', 'google update_event: status')
  equal(result.data.event.summary, 'Weekly sync (moved)', 'google update_event: summary')
  const body = JSON.parse(requests[0].body)
  equal(requests[0].method, 'PATCH', 'google update_event: PATCH')
  equal(body.summary, 'Weekly sync (moved)', 'google update_event: summary in body')
  equal(body.start.dateTime, '2026-11-20T11:00:00+08:00', 'google update_event: start in body')
  ok(!('description' in body), 'google update_event: omitted fields stay out of the body')
  ok(!('end' in body), 'google update_event: untouched end stays out of the body')
  equal(requests[0].params.sendUpdates, 'none', 'google update_event: sendUpdates default')
}

{
  // Delete: DELETE on the instance id, and the gapi response without a result
  // body still reports the deletion.
  const { requests, page } = gcalPage(() => ({ status: 204 }))
  const result = await runTool('com.google-calendar.main', 'delete_event', {
    input: { event_id: 'evt_1', send_updates: 'all' },
    page,
  })
  equal(result.status, 'ok', 'google delete_event: status')
  equal(result.data.deleted, true, 'google delete_event: deleted flag')
  equal(requests[0].method, 'DELETE', 'google delete_event: DELETE')
  equal(requests[0].path, '/calendar/v3/calendars/primary/events/evt_1', 'google delete_event: endpoint')
  equal(requests[0].params.sendUpdates, 'all', 'google delete_event: sendUpdates passthrough')
}

{
  // Free/busy: POST body built from calendar_ids, per-calendar busy slots and
  // request errors mapped into strings.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: {
      calendars: {
        'ada@example.com': { busy: [{ start: '2026-11-20T10:00:00Z', end: '2026-11-20T10:30:00Z' }] },
        'grace@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
      },
    },
  }))
  const result = await runTool('com.google-calendar.main', 'query_freebusy', {
    input: { time_min: '2026-11-20T00:00:00Z', time_max: '2026-11-21T00:00:00Z' },
    page,
  })
  equal(result.status, 'ok', 'google query_freebusy: status')
  equal(result.data.calendars[0].busy[0].start, '2026-11-20T10:00:00Z', 'google query_freebusy: busy start')
  equal(result.data.calendars[1].errors[0], 'global: notFound', 'google query_freebusy: error string')
  equal(requests[0].path, '/calendar/v3/freeBusy', 'google query_freebusy: endpoint')
  const body = JSON.parse(requests[0].body)
  equal(body.items[0].id, 'primary', 'google query_freebusy: default calendar id')
}

{
  // Colors: object maps become ordered arrays keyed by colour id.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: {
      calendar: { '1': { background: '#ac725e', foreground: '#1d1d1d' } },
      event: { '9': { background: '#5484ed', foreground: '#ffffff' } },
    },
  }))
  const result = await runTool('com.google-calendar.main', 'get_colors', { page })
  equal(result.status, 'ok', 'google get_colors: status')
  equal(result.data.calendar_colors[0].id, '1', 'google get_colors: calendar colour id')
  equal(result.data.event_colors[0].background, '#5484ed', 'google get_colors: event colour')
  equal(requests[0].path, '/calendar/v3/colors', 'google get_colors: endpoint')
}

{
  // Quick add: natural-language text rides as a query param on quickAdd.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { ...GCAL_EVENT, summary: 'Lunch with Sarah' },
  }))
  const result = await runTool('com.google-calendar.main', 'quick_add_event', {
    input: { text: 'Lunch with Sarah tomorrow at noon' },
    page,
  })
  equal(result.status, 'ok', 'google quick_add_event: status')
  equal(result.data.event.summary, 'Lunch with Sarah', 'google quick_add_event: event summary')
  equal(requests[0].path, '/calendar/v3/calendars/primary/events/quickAdd', 'google quick_add_event: endpoint')
  equal(requests[0].method, 'POST', 'google quick_add_event: POST')
  equal(requests[0].params.text, 'Lunch with Sarah tomorrow at noon', 'google quick_add_event: text param')
}

{
  // Move: POST with the destination calendar id as a param.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { ...GCAL_EVENT, organizer: { email: 'team@group.calendar.google.com' } },
  }))
  const result = await runTool('com.google-calendar.main', 'move_event', {
    input: { event_id: 'evt_1', destination: 'team@group.calendar.google.com' },
    page,
  })
  equal(result.status, 'ok', 'google move_event: status')
  equal(
    result.data.event.organizer_email,
    'team@group.calendar.google.com',
    'google move_event: new organizer',
  )
  equal(requests[0].path, '/calendar/v3/calendars/primary/events/evt_1/move', 'google move_event: endpoint')
  equal(requests[0].params.destination, 'team@group.calendar.google.com', 'google move_event: destination')
}

{
  // Recurring instances: nested resource plus the recurring parent id.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: {
      items: [{ ...GCAL_EVENT, id: 'evt_1_20261127', recurringEventId: 'evt_1' }],
    },
  }))
  const result = await runTool('com.google-calendar.main', 'list_event_instances', {
    input: { event_id: 'evt_1', max_results: 5 },
    page,
  })
  equal(result.status, 'ok', 'google list_event_instances: status')
  equal(result.data.events[0].recurring_event_id, 'evt_1', 'google list_event_instances: parent id')
  equal(
    requests[0].path,
    '/calendar/v3/calendars/primary/events/evt_1/instances',
    'google list_event_instances: endpoint',
  )
  equal(requests[0].params.maxResults, 5, 'google list_event_instances: maxResults passthrough')
}

{
  // Search: reads the calendar list, keeps owner/writer calendars only, then
  // queries each of them with q + singleEvents.
  const { requests, page } = gcalPage((options) => {
    if (options.path === '/calendar/v3/users/me/calendarList') {
      return {
        status: 200,
        result: {
          items: [
            { id: 'ada@example.com', accessRole: 'owner', primary: true },
            { id: 'old@group.calendar.google.com', accessRole: 'reader' },
          ],
        },
      }
    }
    return { status: 200, result: { items: [GCAL_EVENT] } }
  })
  const result = await runTool('com.google-calendar.main', 'search_events', {
    input: { q: 'sync' },
    page,
  })
  equal(result.status, 'ok', 'google search_events: status')
  equal(result.data.events.length, 1, 'google search_events: result count')
  equal(requests.length, 2, 'google search_events: one list read plus one writable calendar')
  equal(
    requests[1].path,
    '/calendar/v3/calendars/ada%40example.com/events',
    'google search_events: queries the writable calendar',
  )
  equal(requests[1].params.q, 'sync', 'google search_events: query param')
  equal(requests[1].params.singleEvents, true, 'google search_events: expands recurring events')
}

{
  // Calendar metadata read: the id is URL-encoded into the path.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { id: 'team@group.calendar.google.com', summary: 'Team', timeZone: 'UTC' },
  }))
  const result = await runTool('com.google-calendar.main', 'get_calendar', {
    input: { calendar_id: 'team@group.calendar.google.com' },
    page,
  })
  equal(result.status, 'ok', 'google get_calendar: status')
  equal(result.data.calendar.summary, 'Team', 'google get_calendar: summary')
  equal(
    requests[0].path,
    '/calendar/v3/calendars/team%40group.calendar.google.com',
    'google get_calendar: encoded calendar id',
  )
}

{
  // Secondary calendar create / update / delete round trip.
  const { requests, page } = gcalPage((options) => ({
    status: options.method === 'DELETE' ? 204 : 200,
    result: { id: 'new@group.calendar.google.com', summary: 'Projects', timeZone: 'Asia/Shanghai' },
  }))
  const created = await runTool('com.google-calendar.main', 'create_calendar', {
    input: { summary: 'Projects', time_zone: 'Asia/Shanghai' },
    page,
  })
  equal(created.status, 'ok', 'google create_calendar: status')
  equal(created.data.calendar.id, 'new@group.calendar.google.com', 'google create_calendar: id')
  equal(requests[0].path, '/calendar/v3/calendars', 'google create_calendar: endpoint')
  equal(JSON.parse(requests[0].body).timeZone, 'Asia/Shanghai', 'google create_calendar: time zone body')

  const updated = await runTool('com.google-calendar.main', 'update_calendar', {
    input: { calendar_id: 'new@group.calendar.google.com', summary: 'Projects 2027' },
    page,
  })
  equal(updated.status, 'ok', 'google update_calendar: status')
  equal(requests[1].method, 'PATCH', 'google update_calendar: PATCH')
  const updateBody = JSON.parse(requests[1].body)
  equal(updateBody.summary, 'Projects 2027', 'google update_calendar: summary in body')
  ok(!('timeZone' in updateBody), 'google update_calendar: omitted fields stay out of the body')

  const deleted = await runTool('com.google-calendar.main', 'delete_calendar', {
    input: { calendar_id: 'new@group.calendar.google.com' },
    page,
  })
  equal(deleted.status, 'ok', 'google delete_calendar: status')
  equal(deleted.data.deleted, true, 'google delete_calendar: deleted flag')
  equal(requests[2].method, 'DELETE', 'google delete_calendar: DELETE')
}

{
  // Single setting read: setting id is encoded into the nested path.
  const { requests, page } = gcalPage(() => ({
    status: 200,
    result: { id: 'timezone', value: 'Asia/Shanghai' },
  }))
  const result = await runTool('com.google-calendar.main', 'get_setting', {
    input: { setting_id: 'timezone' },
    page,
  })
  equal(result.status, 'ok', 'google get_setting: status')
  equal(result.data.setting.value, 'Asia/Shanghai', 'google get_setting: value')
  equal(requests[0].path, '/calendar/v3/users/me/settings/timezone', 'google get_setting: endpoint')
}

{
  // Auth failure, logged-out tab: no gapi on the page and the same-origin
  // /calendar/v3 path answers with Google's marketing HTML instead of JSON.
  const requests = []
  const result = await runTool('com.google-calendar.main', 'list_events', {
    input: {},
    page: {
      hostname: 'calendar.google.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return htmlResponse('<!doctype html><html><head><title>Google Calendar</title></head></html>')
      },
    },
  })
  equal(result.status, 'error', 'google logged-out: error status')
  equal(result.error_code, 'AUTH', 'google logged-out: classified as AUTH')
  ok(
    String(result.message).includes('not ready'),
    'google logged-out: explains the tab is not ready',
  )
  equal(requests[0].init.credentials, 'include', 'google logged-out: sends credentials')
  ok(
    String(requests[0].url).startsWith('https://calendar.google.com/calendar/v3/calendars/primary/events'),
    'google logged-out: keeps the same-origin API path',
  )
}

{
  // A gapi call that rejects with a 401 is surfaced as an AUTH error result, not
  // as a thrown adapter failure.
  const { page } = gcalPage(() => {
    const error = new Error('Invalid Credentials')
    error.status = 401
    error.result = { error: { code: 401, message: 'Invalid Credentials' } }
    throw error
  })
  const result = await runTool('com.google-calendar.main', 'list_settings', { page })
  equal(result.status, 'error', 'google gapi 401: error status')
  equal(result.error_code, 'AUTH', 'google gapi 401: classified as AUTH')
  equal(result.message, 'Invalid Credentials', 'google gapi 401: upstream error message')
}

{
  // A gapi 404 keeps its own classification.
  const { page } = gcalPage(() => {
    const error = new Error('Not Found')
    error.status = 404
    error.result = { error: { code: 404, message: 'Not Found' } }
    throw error
  })
  const result = await runTool('com.google-calendar.main', 'get_event', {
    input: { event_id: 'missing' },
    page,
  })
  equal(result.status, 'error', 'google gapi 404: error status')
  equal(result.error_code, 'NOT_FOUND', 'google gapi 404: classified as NOT_FOUND')
}

{
  // Fallback transport: the XSSI guard line Google may prepend is stripped before
  // the JSON parse, so settings still map.
  const requests = []
  const result = await runTool('com.google-calendar.main', 'list_settings', {
    page: {
      hostname: 'calendar.google.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse(")]}'\n{\"items\":[{\"id\":\"timezone\",\"value\":\"Asia/Shanghai\"},{\"id\":\"locale\",\"value\":\"en\"}]}")
      },
    },
  })
  equal(result.status, 'ok', 'google fallback settings: status')
  equal(result.data.settings.length, 2, 'google fallback settings: setting count')
  equal(result.data.settings[0].value, 'Asia/Shanghai', 'google fallback settings: value')
  equal(
    requests[0].url,
    'https://calendar.google.com/calendar/v3/users/me/settings',
    'google fallback settings: same-origin path',
  )
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
