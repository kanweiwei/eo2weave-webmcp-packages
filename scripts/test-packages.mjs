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
  'com.google-docs.main': 19,
  'com.google-drive.main': 17,
  'com.wikipedia.main': 19,
  'com.google-calendar.main': 18,
  'com.stackoverflow.main': 20,
  'com.reddit.main': 23,
  'com.todoist.main': 33,
  'com.jira.main': 20,
  'com.slack.main': 22,
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
  'com.reddit.main': [
    'get_me',
    'list_posts',
    'get_post',
    'search_posts',
    'submit_post',
    'submit_comment',
    'get_comment_thread',
    'edit_text',
    'delete',
    'vote',
    'save',
    'hide',
    'report',
    'list_user_content',
    'get_subreddit',
    'list_flairs',
    'search_subreddits',
    'list_subscriptions',
    'list_popular_subreddits',
    'subscribe',
    'get_user',
    'send_message',
    'read_inbox',
  ],
  'com.stackoverflow.main': [
    'search_questions',
    'get_question',
    'list_questions',
    'get_question_answers',
    'get_question_comments',
    'list_related_questions',
    'list_linked_questions',
    'list_featured_questions',
    'list_unanswered_questions',
    'get_similar_questions',
    'get_answer',
    'get_answer_comments',
    'get_user',
    'search_users',
    'get_user_questions',
    'get_user_answers',
    'get_my_profile',
    'list_tags',
    'get_tag_info',
    'search_excerpts',
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
  'com.wikipedia.main': [
    'search_articles',
    'get_article',
    'get_page_summary',
    'get_article_sections',
    'get_section_content',
    'get_article_categories',
    'get_article_links',
    'get_article_languages',
    'get_backlinks',
    'get_revisions',
    'compare_revisions',
    'get_recent_changes',
    'get_random_articles',
    'opensearch',
    'get_current_user',
    'get_user_contributions',
    'get_category_members',
    'get_page_views',
    'get_featured_content',
  ],
  'com.google-drive.main': [
    'get_current_user',
    'list_files',
    'get_file',
    'search_files',
    'create_file',
    'create_folder',
    'update_file',
    'delete_file',
    'move_file',
    'copy_file',
    'trash_file',
    'restore_file',
    'empty_trash',
    'list_permissions',
    'create_permission',
    'delete_permission',
    'get_storage_quota',
  ],
  'com.google-docs.main': [
    'get_current_user',
    'get_current_document',
    'get_document',
    'get_document_text',
    'list_recent_documents',
    'search_documents',
    'create_document',
    'copy_document',
    'update_document_title',
    'trash_document',
    'restore_document',
    'delete_document',
    'list_comments',
    'create_comment',
    'reply_to_comment',
    'resolve_comment',
    'reopen_comment',
    'delete_comment',
    'delete_reply',
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
    const omitCredentials = id === 'com.stackoverflow.main' || id === 'com.bluesky.main'
    const credentialsMode = omitCredentials ? "credentials: 'omit'" : "credentials: 'include'"
    ok(source.includes(credentialsMode), `${id}: sends credentials (${tool.name})`)
  }
}

// --- 2. Parity with the upstream OpenTabs plugins -----------------------------

section('parity: tool sets match the upstream OpenTabs plugins')

// Derived from the cache: every package whose upstream manifest is cached is
// compared against it, so adding a package never means editing this file.
const upstreamCacheDir = path.join(root, '.cache', 'opentabs')

function upstreamToolsFor(id) {
  const file = path.join(upstreamCacheDir, `${id.split('.')[1]}-tools.json`)
  if (!existsSync(file)) return null
  const cached = JSON.parse(readFileSync(file, 'utf8'))
  const tools = Array.isArray(cached) ? cached : cached.tools
  return Array.isArray(tools) ? tools : null
}

let parityCovered = 0
for (const id of readdirSync(packagesDir).sort()) {
  if (!existsSync(path.join(packagesDir, id, 'manifest.json'))) continue
  const upstream = upstreamToolsFor(id)
  if (!upstream) continue
  parityCovered++
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, id, 'manifest.json'), 'utf8'))
  const expectedNames = upstream.map((tool) => tool.name).sort()
  equal(manifest.tools.length, expectedNames.length, `${id}: tool count matches OpenTabs (${expectedNames.length})`)
  equal(
    manifest.tools.map((tool) => tool.name).sort().join(','),
    expectedNames.join(','),
    `${id}: tool set matches OpenTabs`,
  )
}
console.log(`  (${parityCovered} packages compared against upstream manifests)`)

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
  const packages = Object.fromEntries(
    readdirSync(packagesDir)
      .filter((id) => existsSync(path.join(packagesDir, id, 'manifest.json')))
      // com.discord.main predates the ported-package contract and declares its
      // schemas inside the workflow tree rather than as a top-level inputSchema.
      .filter((id) => id !== 'com.discord.main')
      .map((id) => [id, id.split('.')[1]]),
  )
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

// --- 4. Registry manifest ----------------------------------------------------

// --- Reddit ------------------------------------------------------------------
// The reddit runtime posts form bodies (plus the modhash), exchanges the CSRF
// cookie for a bearer token on the /svc/shreddit/token endpoint, and reads the
// nested Listing shape; these tests stub exactly those seams.

function redditListing(children, after = null) {
  return { kind: 'Listing', data: { after, before: null, children, dist: children.length } }
}

const REDDIT_POST = {
  kind: 't3',
  data: {
    id: 'abc123',
    name: 't3_abc123',
    title: 'Zig 0.15 released',
    author: 'andrewrk',
    subreddit: 'programming',
    score: 412,
    upvote_ratio: 0.95,
    num_comments: 88,
    url: 'https://example.com/zig',
    permalink: '/r/programming/comments/abc123/zig/',
    selftext: '',
    is_self: false,
    created_utc: 1763500000,
    over_18: false,
    stickied: false,
    link_flair_text: 'News',
    thumbnail: '',
  },
}

const REDDIT_SELF_POST = {
  kind: 't3',
  data: {
    ...REDDIT_POST.data,
    id: 'def456',
    name: 't3_def456',
    title: 'What editor do you use?',
    url: 'https://www.reddit.com/r/programming/comments/def456/',
    permalink: '/r/programming/comments/def456/editor/',
    selftext: 'I switched to helix and I like it.',
    is_self: true,
    link_flair_text: null,
  },
}

function redditComment(overrides = {}) {
  return {
    kind: 't1',
    data: {
      id: 'c1',
      name: 't1_c1',
      author: 'commenter',
      body: 'Nice release.',
      score: 12,
      created_utc: 1763500100,
      parent_id: 't3_abc123',
      depth: 0,
      is_submitter: false,
      replies: '',
      ...overrides,
    },
  }
}

function redditPage(handler, extra = {}) {
  const calls = []
  const page = {
    hostname: 'www.reddit.com',
    href: 'https://www.reddit.com/r/programming/',
    origin: 'https://www.reddit.com',
    cookie: 'csrf_token=csrf-test-token; reddit_session=session-cookie',
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { page, calls }
}

const REDDIT_MODHASH = { kind: 't2', data: { modhash: 'mh-test', name: 'tester' } }

{
  // Listing read: default hot listing, metadata only (url/selftext withheld).
  const { page, calls } = redditPage(() =>
    jsonResponse(redditListing([REDDIT_POST, REDDIT_SELF_POST], 't3_next')),
  )
  const result = await runTool('com.reddit.main', 'list_posts', {
    input: { subreddit: 'programming' },
    page,
  })
  equal(result.status, 'ok', 'reddit list_posts: status')
  equal(result.data.posts.length, 2, 'reddit list_posts: maps every child')
  equal(result.data.posts[0].title, 'Zig 0.15 released', 'reddit list_posts: title')
  equal(result.data.posts[0].score, 412, 'reddit list_posts: score')
  equal(result.data.posts[0].url, null, 'reddit list_posts: url withheld without include_body')
  equal(result.data.posts[0].selftext, null, 'reddit list_posts: selftext withheld without include_body')
  equal(result.data.posts[1].link_flair_text, null, 'reddit list_posts: absent flair is null')
  equal(result.data.after, 't3_next', 'reddit list_posts: cursor returned')
  equal(calls[0].url, 'https://www.reddit.com/r/programming/hot.json?limit=25', 'reddit list_posts: hot endpoint')
}

{
  // Paginated read with a time filter and bodies: cursor and t both travel.
  const { page, calls } = redditPage(() => jsonResponse(redditListing([REDDIT_SELF_POST])))
  const result = await runTool('com.reddit.main', 'list_posts', {
    input: {
      subreddit: 'programming',
      sort: 'top',
      t: 'week',
      limit: 2,
      after: 't3_next',
      include_body: true,
    },
    page,
  })
  equal(result.status, 'ok', 'reddit list_posts page 2: status')
  equal(
    calls[0].url,
    'https://www.reddit.com/r/programming/top.json?limit=2&t=week&after=t3_next',
    'reddit list_posts page 2: cursor and t in query',
  )
  equal(result.data.posts[0].url, REDDIT_SELF_POST.data.url, 'reddit list_posts: include_body returns url')
  equal(result.data.posts[0].selftext, 'I switched to helix and I like it.', 'reddit list_posts: include_body returns selftext')
  equal(result.data.after, null, 'reddit list_posts: null cursor at the end')
}

{
  // Post + flattened comment tree: depth caps the recursion.
  const { page, calls } = redditPage(() =>
    jsonResponse([
      redditListing([REDDIT_POST]),
      redditListing([
        redditComment({
          replies: { kind: 'Listing', data: { children: [redditComment({ id: 'c2', name: 't1_c2', depth: 1, parent_id: 't1_c1', replies: { kind: 'Listing', data: { children: [redditComment({ id: 'c3', depth: 2, parent_id: 't1_c2' })] } } })] } },
        }),
      ]),
    ]),
  )
  const result = await runTool('com.reddit.main', 'get_post', {
    input: { subreddit: 'programming', post_id: 'abc123', comment_limit: 10, comment_depth: 1 },
    page,
  })
  equal(result.status, 'ok', 'reddit get_post: status')
  equal(result.data.post.id, 'abc123', 'reddit get_post: post id')
  equal(result.data.post.selftext, '', 'reddit get_post: empty selftext stays a string')
  equal(calls[0].url, 'https://www.reddit.com/r/programming/comments/abc123.json?limit=10&depth=1', 'reddit get_post: endpoint')
  equal(result.data.comments.length, 2, 'reddit get_post: depth cap drops the grandchild')
  equal(result.data.comments[1].depth, 1, 'reddit get_post: flattened reply keeps depth')
  equal(result.data.comments[1].parent_id, 't1_c1', 'reddit get_post: reply keeps parent fullname')
}

{
  // Vote write: modhash fetched once, form body carries uh + api_type.
  const { page, calls } = redditPage((url) => {
    if (url === 'https://www.reddit.com/api/me.json') return jsonResponse(REDDIT_MODHASH)
    if (url === 'https://www.reddit.com/api/vote') return jsonResponse({})
    return jsonResponse({}, 404)
  })
  const result = await runTool('com.reddit.main', 'vote', {
    input: { id: 't3_abc123', dir: 1 },
    page,
  })
  equal(result.status, 'ok', 'reddit vote: status')
  equal(result.data.success, true, 'reddit vote: success flag')
  equal(calls.length, 2, 'reddit vote: modhash then vote')
  equal(calls[1].url, 'https://www.reddit.com/api/vote', 'reddit vote: endpoint')
  equal(calls[1].init.method, 'POST', 'reddit vote: POST')
  equal(calls[1].init.headers['X-Modhash'], 'mh-test', 'reddit vote: X-Modhash header')
  equal(calls[1].init.headers['Content-Type'], 'application/x-www-form-urlencoded', 'reddit vote: form content type')
  const body = new URLSearchParams(calls[1].init.body)
  equal(body.get('id'), 't3_abc123', 'reddit vote: id in form body')
  equal(body.get('dir'), '1', 'reddit vote: dir as string in form body')
  equal(body.get('uh'), 'mh-test', 'reddit vote: uh carries the modhash')
  equal(body.get('api_type'), 'json', 'reddit vote: api_type=json')
}

{
  // Comment POST: JSON-in-json response; optional fields are not invented.
  const { page, calls } = redditPage((url) => {
    if (url === 'https://www.reddit.com/api/me.json') return jsonResponse(REDDIT_MODHASH)
    if (url === 'https://www.reddit.com/api/comment')
      return jsonResponse({
        json: { errors: [], data: { things: [{ kind: 't1', data: { id: 't1_new', parent: 't3_abc123', contentText: 'hello', link: '' } }] } },
      })
    return jsonResponse({}, 404)
  })
  const result = await runTool('com.reddit.main', 'submit_comment', {
    input: { thing_id: 't3_abc123', text: 'hello **world**' },
    page,
  })
  equal(result.status, 'ok', 'reddit submit_comment: status')
  equal(result.data.id, 't1_new', 'reddit submit_comment: new comment id')
  equal(result.data.parent, 't3_abc123', 'reddit submit_comment: parent fullname')
  equal(result.data.body, 'hello **world**', 'reddit submit_comment: body as submitted')
  const body = new URLSearchParams(calls[1].init.body)
  equal(body.get('thing_id'), 't3_abc123', 'reddit submit_comment: thing_id in form body')
  equal(body.get('text'), 'hello **world**', 'reddit submit_comment: markdown text in form body')
  equal(body.has('nsfw'), false, 'reddit submit_comment: no stray fields')
}

{
  // Submit post: text post omits unset optional fields, errors[] is surfaced.
  const { page, calls } = redditPage((url) => {
    if (url === 'https://www.reddit.com/api/me.json') return jsonResponse(REDDIT_MODHASH)
    if (url === 'https://www.reddit.com/api/submit')
      return jsonResponse({ json: { errors: [], data: { name: 't3_new', id: 'new', url: 'https://www.reddit.com/r/programming/comments/new/x/' } } })
    return jsonResponse({}, 404)
  })
  const created = await runTool('com.reddit.main', 'submit_post', {
    input: { subreddit: 'programming', title: 'Hello', kind: 'self', text: 'body' },
    page,
  })
  equal(created.status, 'ok', 'reddit submit_post: status')
  equal(created.data.name, 't3_new', 'reddit submit_post: fullname')
  const body = new URLSearchParams(calls[1].init.body)
  equal(body.get('sr'), 'programming', 'reddit submit_post: sr')
  equal(body.get('kind'), 'self', 'reddit submit_post: kind')
  equal(body.has('url'), false, 'reddit submit_post: unset url omitted')
  equal(body.has('flair_id'), false, 'reddit submit_post: unset flair omitted')
  equal(body.has('nsfw'), false, 'reddit submit_post: false nsfw omitted')

  const rejectedPage = redditPage((url) => {
    if (url === 'https://www.reddit.com/api/me.json') return jsonResponse(REDDIT_MODHASH)
    return jsonResponse({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'that community does not allow text posts', 'sr']] } })
  })
  const rejected = await runTool('com.reddit.main', 'submit_post', {
    input: { subreddit: 'programming', title: 'Hello', kind: 'self' },
    page: rejectedPage.page,
  })
  equal(rejected.status, 'error', 'reddit submit_post: errors[] is an error')
  equal(rejected.error_code, 'VALIDATION', 'reddit submit_post: errors[] is VALIDATION')
  ok(String(rejected.message).includes('does not allow'), 'reddit submit_post: upstream message surfaced')
}

{
  // Private messages: CSRF cookie -> bearer token -> oauth.reddit.com form POST.
  const { page, calls } = redditPage((url) => {
    if (url === 'https://www.reddit.com/svc/shreddit/token')
      return jsonResponse({ token: 'bearer-test', expires: new Date(Date.now() + 600000).toISOString() })
    if (url === 'https://oauth.reddit.com/api/compose') return jsonResponse({ json: { errors: [] } })
    return jsonResponse({}, 404)
  })
  const result = await runTool('com.reddit.main', 'send_message', {
    input: { to: 'someuser', subject: 'Hi', text: 'Hello there' },
    page,
  })
  equal(result.status, 'ok', 'reddit send_message: status')
  equal(result.data.success, true, 'reddit send_message: success flag')
  equal(calls[0].url, 'https://www.reddit.com/svc/shreddit/token', 'reddit send_message: token endpoint')
  equal(JSON.parse(calls[0].init.body).csrf_token, 'csrf-test-token', 'reddit send_message: token body reads csrf cookie')
  equal(calls[1].url, 'https://oauth.reddit.com/api/compose', 'reddit send_message: oauth endpoint')
  equal(calls[1].init.headers.Authorization, 'Bearer bearer-test', 'reddit send_message: bearer auth header')
  equal(calls[1].init.credentials, undefined, 'reddit send_message: bearer call sends no cookies')
  const body = new URLSearchParams(calls[1].init.body)
  equal(body.get('to'), 'someuser', 'reddit send_message: to')
  equal(body.get('api_type'), 'json', 'reddit send_message: api_type=json')
}

{
  // Inbox: listing mapping + cursor.
  const message = {
    kind: 't4',
    data: {
      id: 'm1',
      name: 't4_m1',
      author: 'reddit',
      subject: 'Welcome',
      body: 'Welcome to Reddit.',
      dest: 'tester',
      created_utc: 1763500000,
      was_comment: false,
      new: true,
    },
  }
  const { page, calls } = redditPage(() => jsonResponse(redditListing([message], 't4_next')))
  const result = await runTool('com.reddit.main', 'read_inbox', { input: { limit: 5, after: 't4_prev' }, page })
  equal(result.status, 'ok', 'reddit read_inbox: status')
  equal(result.data.messages[0].subject, 'Welcome', 'reddit read_inbox: subject')
  equal(result.data.messages[0].new, true, 'reddit read_inbox: unread flag')
  equal(result.data.after, 't4_next', 'reddit read_inbox: cursor returned')
  equal(calls[0].url, 'https://www.reddit.com/message/inbox.json?limit=5&after=t4_prev', 'reddit read_inbox: endpoint with cursor')
}

{
  // Auth failure paths: reads surface AUTH on 401; writes fail at the modhash.
  const { page } = redditPage(() => jsonResponse({ message: 'Unauthorized' }, 401))
  const read = await runTool('com.reddit.main', 'get_me', { input: {}, page })
  equal(read.status, 'error', 'reddit auth: get_me 401 is an error')
  equal(read.error_code, 'AUTH', 'reddit auth: get_me 401 is AUTH')

  const { page: writePage } = redditPage((url) => jsonResponse({ message: 'Unauthorized' }, 401))
  const write = await runTool('com.reddit.main', 'save', { input: { id: 't3_abc123' }, page: writePage })
  equal(write.status, 'error', 'reddit auth: write without session is an error')
  equal(write.error_code, 'AUTH', 'reddit auth: write without session is AUTH')
  ok(String(write.message).includes('modhash'), 'reddit auth: write error names the modhash')
}

// --- Stack Overflow ----------------------------------------------------------
//
// The upstream plugin talks to the public Stack Exchange API
// (api.stackexchange.com/2.3) with `site=stackoverflow` and `filter=withbody`
// appended by its own helper, and reads the signed-in identity from the page
// (`StackExchange.options.user`). These fixtures reproduce that envelope: paged
// `{ items, has_more, quota_remaining }` bodies, the API's numeric `error_id`
// failures, in-page identity for the authenticated tool, and a logged-out page.

const SO_HOST = 'stackoverflow.com'

/** The Stack Exchange question shape the port maps (unix dates, nested owner). */
const SO_QUESTION = {
  question_id: 11227809,
  title: 'Why is processing a sorted array faster than processing an unsorted array?',
  body: '<p>Here is a piece of C++ code…</p>',
  tags: ['c++', 'performance', 'branch-prediction'],
  score: 27341,
  answer_count: 17,
  view_count: 1980000,
  is_answered: true,
  accepted_answer_id: 11227902,
  creation_date: 1340805096,
  last_activity_date: 1749000000,
  link: 'https://stackoverflow.com/questions/11227809',
  owner: { display_name: 'GManNickG', reputation: 138000, user_id: 87234 },
  bounty_amount: 500,
  closed_reason: '',
}

const SO_ANSWER = {
  answer_id: 11227902,
  question_id: 11227809,
  body: '<p>You are a victim of branch prediction fail.</p>',
  score: 31000,
  is_accepted: true,
  creation_date: 1340808338,
  last_activity_date: 1731000000,
  owner: { display_name: 'Mysticial', reputation: 430000, user_id: 43421 },
}

const SO_USER = {
  user_id: 22656,
  display_name: 'Jon Skeet',
  reputation: 1445000,
  profile_image: 'https://i.sstatic.net/JonSkeet.jpg',
  link: 'https://stackoverflow.com/users/22656/jon-skeet',
  accept_rate: 87,
  question_count: 40,
  answer_count: 34000,
  creation_date: 1222430705,
  last_access_date: 1749100000,
  location: 'Reading, United Kingdom',
  website_url: 'https://codeblog.jonskeet.uk',
  badge_counts: { gold: 900, silver: 9000, bronze: 90000 },
}

{
  // stackoverflow: search_questions builds the advanced-search query exactly
  // like the upstream helper — site, then the caller's params in declaration
  // order, then the default withbody filter — and maps the whole question row.
  const requests = []
  const result = await runTool('com.stackoverflow.main', 'search_questions', {
    input: { q: 'react hooks useEffect', tagged: 'javascript;react', pagesize: 2 },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_QUESTION], has_more: true, quota_remaining: 297 })
      },
    },
  })
  equal(result.status, 'ok', 'stackoverflow search_questions: status')
  const searchUrl = new URL(requests[0].url)
  equal(searchUrl.origin + searchUrl.pathname, 'https://api.stackexchange.com/2.3/search/advanced', 'stackoverflow search_questions: API endpoint')
  equal(searchUrl.searchParams.get('site'), 'stackoverflow', 'stackoverflow search_questions: site param')
  equal(searchUrl.searchParams.get('q'), 'react hooks useEffect', 'stackoverflow search_questions: query text')
  equal(searchUrl.searchParams.get('tagged'), 'javascript;react', 'stackoverflow search_questions: tagged filter')
  equal(searchUrl.searchParams.get('order'), 'desc', 'stackoverflow search_questions: default order')
  equal(searchUrl.searchParams.get('sort'), null, 'stackoverflow search_questions: no sort default, like upstream')
  equal(searchUrl.searchParams.get('pagesize'), '2', 'stackoverflow search_questions: pagesize')
  equal(searchUrl.searchParams.getAll('filter').join(','), 'withbody', 'stackoverflow search_questions: one withbody filter')
  equal(requests[0].init.method, 'GET', 'stackoverflow search_questions: GET')
  equal(requests[0].init.credentials, 'omit', 'stackoverflow search_questions: no cookies sent cross-origin')
  equal(result.data.questions.length, 1, 'stackoverflow search_questions: question count')
  const question = result.data.questions[0]
  equal(question.question_id, 11227809, 'stackoverflow search_questions: question id is numeric')
  equal(question.tags[1], 'performance', 'stackoverflow search_questions: tags')
  equal(question.is_answered, true, 'stackoverflow search_questions: answered flag')
  equal(question.accepted_answer_id, 11227902, 'stackoverflow search_questions: accepted answer id')
  equal(question.creation_date, '2012-06-27T13:51:36.000Z', 'stackoverflow search_questions: unix date converted to ISO')
  equal(question.owner_display_name, 'GManNickG', 'stackoverflow search_questions: owner display name')
  equal(question.owner_reputation, 138000, 'stackoverflow search_questions: owner reputation')
  equal(question.bounty_amount, 500, 'stackoverflow search_questions: bounty amount')
  equal(result.data.has_more, true, 'stackoverflow search_questions: has_more')
  equal(result.data.quota_remaining, 297, 'stackoverflow search_questions: quota')
}

{
  // stackoverflow: get_question reads one question by id from the API and
  // leaves every field absent from the payload at its documented default.
  const requests = []
  const result = await runTool('com.stackoverflow.main', 'get_question', {
    input: { question_id: 11227809 },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [{ ...SO_QUESTION, bounty_amount: undefined, closed_reason: undefined }], has_more: false, quota_remaining: 300 })
      },
    },
  })
  equal(result.status, 'ok', 'stackoverflow get_question: status')
  const questionUrl = new URL(requests[0].url)
  equal(questionUrl.origin + questionUrl.pathname, 'https://api.stackexchange.com/2.3/questions/11227809', 'stackoverflow get_question: question endpoint')
  equal(questionUrl.searchParams.get('filter'), 'withbody', 'stackoverflow get_question: body filter')
  equal(result.data.question.title.startsWith('Why is processing a sorted array'), true, 'stackoverflow get_question: title')
  equal(result.data.question.body.includes('C++ code'), true, 'stackoverflow get_question: full body returned')
  equal(result.data.question.bounty_amount, 0, 'stackoverflow get_question: absent bounty defaults to 0')
  equal(result.data.question.closed_reason, '', 'stackoverflow get_question: absent close reason defaults to empty')
  equal(result.data.question.owner_user_id, 87234, 'stackoverflow get_question: owner user id')

  // An empty items array is a real answer from the API (deleted or bad id) and
  // must surface as NOT_FOUND, not as a zero-filled question.
  const missing = await runTool('com.stackoverflow.main', 'get_question', {
    input: { question_id: 999999999 },
    page: { hostname: SO_HOST, fetch: async () => jsonResponse({ items: [], has_more: false, quota_remaining: 300 }) },
  })
  equal(missing.status, 'error', 'stackoverflow get_question: empty items is an error')
  equal(missing.error_code, 'NOT_FOUND', 'stackoverflow get_question: empty items classified as NOT_FOUND')
}

{
  // stackoverflow: reading answers for a question defaults to votes/desc, and
  // get_answer reads a single answer by id.
  const requests = []
  const answers = await runTool('com.stackoverflow.main', 'get_question_answers', {
    input: { question_id: 11227809 },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_ANSWER], has_more: false, quota_remaining: 299 })
      },
    },
  })
  equal(answers.status, 'ok', 'stackoverflow get_question_answers: status')
  const answersUrl = new URL(requests[0].url)
  equal(answersUrl.origin + answersUrl.pathname, 'https://api.stackexchange.com/2.3/questions/11227809/answers', 'stackoverflow get_question_answers: endpoint')
  equal(answersUrl.searchParams.get('sort'), 'votes', 'stackoverflow get_question_answers: default sort votes')
  equal(answersUrl.searchParams.get('order'), 'desc', 'stackoverflow get_question_answers: default order desc')
  equal(answers.data.answers[0].answer_id, 11227902, 'stackoverflow get_question_answers: answer id')
  equal(answers.data.answers[0].is_accepted, true, 'stackoverflow get_question_answers: accepted flag')
  equal(answers.data.answers[0].owner_display_name, 'Mysticial', 'stackoverflow get_question_answers: answer author')

  const single = await runTool('com.stackoverflow.main', 'get_answer', {
    input: { answer_id: 11227902 },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_ANSWER], has_more: false, quota_remaining: 298 })
      },
    },
  })
  equal(single.status, 'ok', 'stackoverflow get_answer: status')
  const answerUrl = new URL(requests[1].url)
  equal(answerUrl.origin + answerUrl.pathname, 'https://api.stackexchange.com/2.3/answers/11227902', 'stackoverflow get_answer: answer endpoint')
  equal(single.data.answer.score, 31000, 'stackoverflow get_answer: score')
  equal(single.data.answer.creation_date, '2012-06-27T14:45:38.000Z', 'stackoverflow get_answer: ISO date')
}

{
  // stackoverflow: get_user maps the public profile (nested badge_counts,
  // accept_rate) and search_users sends inname with the reputation default.
  const requests = []
  const result = await runTool('com.stackoverflow.main', 'get_user', {
    input: { user_id: 22656 },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_USER], has_more: false, quota_remaining: 296 })
      },
    },
  })
  equal(result.status, 'ok', 'stackoverflow get_user: status')
  equal(new URL(requests[0].url).pathname, '/2.3/users/22656', 'stackoverflow get_user: user endpoint')
  equal(result.data.user.display_name, 'Jon Skeet', 'stackoverflow get_user: display name')
  equal(result.data.user.reputation, 1445000, 'stackoverflow get_user: reputation')
  equal(result.data.user.badge_gold, 900, 'stackoverflow get_user: gold badges from badge_counts')
  equal(result.data.user.accept_rate, 87, 'stackoverflow get_user: accept rate')
  equal(result.data.user.location, 'Reading, United Kingdom', 'stackoverflow get_user: location')

  const found = await runTool('com.stackoverflow.main', 'search_users', {
    input: { inname: 'skeet' },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_USER], has_more: false, quota_remaining: 295 })
      },
    },
  })
  equal(found.status, 'ok', 'stackoverflow search_users: status')
  const usersUrl = new URL(requests[1].url)
  equal(usersUrl.pathname, '/2.3/users', 'stackoverflow search_users: users endpoint')
  equal(usersUrl.searchParams.get('inname'), 'skeet', 'stackoverflow search_users: inname')
  equal(usersUrl.searchParams.get('sort'), 'reputation', 'stackoverflow search_users: default sort reputation')
  equal(found.data.users[0].user_id, 22656, 'stackoverflow search_users: user id')
}

{
  // stackoverflow: get_my_profile takes the user id from the page
  // (StackExchange.options.user), never from the caller — and a logged-out page
  // is a classified auth error, matching upstream getCurrentUserId().
  const requests = []
  const authed = await runTool('com.stackoverflow.main', 'get_my_profile', {
    input: {},
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({ items: [SO_USER], has_more: false, quota_remaining: 294 })
      },
      globals: { StackExchange: { options: { user: { isRegistered: true, userId: 22656 } } } },
    },
  })
  equal(authed.status, 'ok', 'stackoverflow get_my_profile: status')
  equal(new URL(requests[0].url).pathname, '/2.3/users/22656', 'stackoverflow get_my_profile: page user id in the path')
  equal(authed.data.user.display_name, 'Jon Skeet', 'stackoverflow get_my_profile: profile mapped')

  const anonymous = await runTool('com.stackoverflow.main', 'get_my_profile', {
    input: {},
    page: { hostname: SO_HOST, fetch: async () => jsonResponse({ items: [] }) },
  })
  equal(anonymous.status, 'error', 'stackoverflow get_my_profile: logged-out page is an error')
  equal(anonymous.error_code, 'UNAUTHENTICATED', 'stackoverflow get_my_profile: logged-out page classified as UNAUTHENTICATED')
}

{
  // stackoverflow: get_tag_info makes the two upstream calls (info + wikis) and
  // merges the wiki into the tag; search_excerpts maps question and answer hits.
  const requests = []
  const tag = await runTool('com.stackoverflow.main', 'get_tag_info', {
    input: { tag: 'javascript' },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (new URL(url).pathname.endsWith('/wikis')) {
          return jsonResponse({
            items: [{ tag_name: 'javascript', excerpt: 'For questions about programming in ECMAScript.', body: '<p>JavaScript wiki</p>' }],
            has_more: false,
            quota_remaining: 293,
          })
        }
        return jsonResponse({
          items: [{ name: 'javascript', count: 2400000, has_synonyms: true, is_moderator_only: false, is_required: false }],
          has_more: false,
          quota_remaining: 292,
        })
      },
    },
  })
  equal(tag.status, 'ok', 'stackoverflow get_tag_info: status')
  equal(new URL(requests[0].url).pathname, '/2.3/tags/javascript/info', 'stackoverflow get_tag_info: tag info endpoint')
  equal(new URL(requests[1].url).pathname, '/2.3/tags/javascript/wikis', 'stackoverflow get_tag_info: wiki endpoint')
  equal(tag.data.tag.name, 'javascript', 'stackoverflow get_tag_info: tag name')
  equal(tag.data.tag.count, 2400000, 'stackoverflow get_tag_info: tag count')
  equal(tag.data.tag.has_synonyms, true, 'stackoverflow get_tag_info: synonyms flag')
  equal(tag.data.tag.excerpt.includes('ECMAScript'), true, 'stackoverflow get_tag_info: wiki excerpt merged')
  equal(tag.data.tag.wiki_body, '<p>JavaScript wiki</p>', 'stackoverflow get_tag_info: wiki body merged')

  const excerpts = await runTool('com.stackoverflow.main', 'search_excerpts', {
    input: { q: 'useEffect cleanup', accepted: true },
    page: {
      hostname: SO_HOST,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({
          items: [
            {
              question_id: 53331175,
              answer_id: 0,
              title: 'React useEffect cleanup',
              excerpt: '…',
              item_type: 'question',
              tags: ['javascript', 'reactjs'],
              score: 412,
              is_answered: true,
              creation_date: 1550000000,
            },
          ],
          has_more: false,
          quota_remaining: 291,
        })
      },
    },
  })
  equal(excerpts.status, 'ok', 'stackoverflow search_excerpts: status')
  const excerptsUrl = new URL(requests[2].url)
  equal(excerptsUrl.pathname, '/2.3/search/excerpts', 'stackoverflow search_excerpts: endpoint')
  equal(excerptsUrl.searchParams.get('accepted'), 'true', 'stackoverflow search_excerpts: boolean sent as true')
  equal(excerptsUrl.searchParams.get('sort'), 'relevance', 'stackoverflow search_excerpts: default sort relevance')
  equal(excerpts.data.results[0].item_type, 'question', 'stackoverflow search_excerpts: item type')
  equal(excerpts.data.results[0].answer_id, 0, 'stackoverflow search_excerpts: question hit has answer_id 0')
}

{
  // stackoverflow: the API's numeric error_id envelope is classified the way
  // upstream does it (502 → rate limited), and a non-Stack-Overflow tab refuses
  // to run instead of calling the API from the wrong site.
  const limited = await runTool('com.stackoverflow.main', 'list_questions', {
    input: {},
    page: {
      hostname: SO_HOST,
      fetch: async () => jsonResponse({ error_id: 502, error_name: 'throttle_violation', error_message: 'too many requests from this IP' }),
    },
  })
  equal(limited.status, 'error', 'stackoverflow error_id: 502 is an error')
  equal(limited.error_code, 'RATE_LIMITED', 'stackoverflow error_id: 502 classified as RATE_LIMITED')

  let requests = 0
  const wrongHost = await runTool('com.stackoverflow.main', 'search_questions', {
    input: { q: 'x' },
    page: {
      hostname: 'stackoverflow.com.evil.example',
      fetch: async () => {
        requests++
        return jsonResponse({})
      },
    },
  })
  equal(wrongHost.status, 'error', 'stackoverflow wrong host: is an error')
  equal(wrongHost.error_code, 'UNSUPPORTED_PAGE', 'stackoverflow wrong host: classified as UNSUPPORTED_PAGE')
  equal(requests, 0, 'stackoverflow wrong host: no API call is made')
}

section('urlRegex probe: stackoverflow.com')

{
  // Upstream scopes the plugin to `*://*.stackoverflow.com/*`, so the port keeps
  // every subdomain (meta.*, www.*) while refusing lookalike hosts, plain HTTP
  // and non-default ports.
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.stackoverflow.main', 'manifest.json'), 'utf8'),
  )
  const mustMatch = [
    'https://stackoverflow.com/',
    'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster',
    'https://stackoverflow.com/questions?tab=Newest&pagesize=50',
    'https://stackoverflow.com/users/22656/jon-skeet#answers',
    'https://stackoverflow.com/search?q=react+hooks#top',
    'https://stackoverflow.com/tags/javascript/info',
    'https://meta.stackoverflow.com/questions/ask',
    'https://www.stackoverflow.com/questions',
  ]
  const mustNotMatch = [
    'http://stackoverflow.com/questions',
    'https://stackoverflow.com.evil.example/questions',
    'https://evil.example/stackoverflow.com/questions',
    'https://stackoverflow.com:8443/questions',
    'https://user@stackoverflow.com/questions',
    'https://stackoverflow.co/questions',
    'https://api.stackexchange.com/2.3/questions',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `stackoverflow urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch)
      ok(!regex.test(url), `stackoverflow urlRegex rejects ${url} (${tool.name})`)
  }
}

// --- 4. Registry manifest ----------------------------------------------------

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

section('execution: Wikipedia tools against a stubbed page')

// --- Wikipedia ---------------------------------------------------------------
// The wikipedia port speaks the MediaWiki action API on the tab's own origin
// (/w/api.php, format=json&formatversion=2) for every tool except the three
// Wikimedia REST endpoints (page summary, featured feed, page views). The tests
// stub that same-origin fetch and assert both the request shape and the
// upstream mapping of each response.

function wikiPage(handler, extra = {}) {
  const calls = []
  const page = {
    hostname: 'en.wikipedia.org',
    href: 'https://en.wikipedia.org/wiki/JavaScript',
    origin: 'https://en.wikipedia.org',
    globals: { mw: { config: { values: { wgSiteName: 'Wikipedia' } } } },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { page, calls }
}

const WIKI_ARTICLE_PAGE = {
  pageid: 7072926,
  ns: 0,
  title: 'JavaScript',
  extract: 'JavaScript, often abbreviated as JS, is a programming language.',
  pageprops: { 'wikibase-shortdesc': 'Programming language' },
  fullurl: 'https://en.wikipedia.org/wiki/JavaScript',
  editurl: 'https://en.wikipedia.org/w/index.php?title=JavaScript&action=edit',
  thumbnail: { source: 'https://upload.wikimedia.org/thumb.png', width: 300, height: 200 },
  length: 123456,
  touched: '2026-11-18T12:00:00Z',
  protection: [
    { type: 'edit', level: 'autoconfirmed', expiry: 'infinity' },
    { type: 'move', level: 'sysop', expiry: 'infinity' },
  ],
}

{
  // Search: list=search with the default limit and the page-side mapping that
  // strips the highlight markup out of the snippet.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      batchcomplete: true,
      query: {
        search: [
          {
            pageid: 7072926,
            title: 'JavaScript',
            snippet: '<span class="searchmatch">JavaScript</span> is a programming language',
            size: 123456,
            wordcount: 12345,
            timestamp: '2026-11-18T12:00:00Z',
          },
        ],
        searchinfo: { totalhits: 4291, suggestion: 'javascript tutorial' },
      },
    }),
  )
  const result = await runTool('com.wikipedia.main', 'search_articles', {
    input: { query: 'javascript' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia search_articles: status')
  equal(result.data.results.length, 1, 'wikipedia search_articles: result count')
  equal(result.data.results[0].pageid, 7072926, 'wikipedia search_articles: page id')
  equal(result.data.results[0].snippet, 'JavaScript is a programming language', 'wikipedia search_articles: snippet stripped')
  equal(result.data.results[0].wordcount, 12345, 'wikipedia search_articles: word count')
  equal(result.data.total_hits, 4291, 'wikipedia search_articles: total hits')
  equal(result.data.suggestion, 'javascript tutorial', 'wikipedia search_articles: suggestion')
  const url = new URL(calls[0].url)
  equal(url.origin, 'https://en.wikipedia.org', 'wikipedia search_articles: same-origin call')
  equal(url.pathname, '/w/api.php', 'wikipedia search_articles: action API path')
  equal(url.searchParams.get('action'), 'query', 'wikipedia search_articles: action')
  equal(url.searchParams.get('list'), 'search', 'wikipedia search_articles: list')
  equal(url.searchParams.get('srsearch'), 'javascript', 'wikipedia search_articles: query text')
  equal(url.searchParams.get('srlimit'), '10', 'wikipedia search_articles: default limit')
  equal(url.searchParams.get('format'), 'json', 'wikipedia search_articles: format')
  equal(url.searchParams.get('formatversion'), '2', 'wikipedia search_articles: formatversion')
  equal(calls[0].init.credentials, 'include', 'wikipedia search_articles: sends credentials')
}

{
  // Search pagination: offset and a non-default limit travel as integers.
  const { page, calls } = wikiPage(() => jsonResponse({ query: { search: [] } }))
  const result = await runTool('com.wikipedia.main', 'search_articles', {
    input: { query: 'rust', limit: 5, offset: 10 },
    page,
  })
  equal(result.status, 'ok', 'wikipedia search_articles paged: status')
  equal(result.data.results.length, 0, 'wikipedia search_articles paged: empty page')
  equal(result.data.total_hits, 0, 'wikipedia search_articles paged: missing total defaults to 0')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('srlimit'), '5', 'wikipedia search_articles paged: limit')
  equal(url.searchParams.get('sroffset'), '10', 'wikipedia search_articles paged: offset')
}

{
  // Article read: extracts|info|pageprops|pageimages in one request, mapped
  // into the upstream page summary shape (description from pageprops).
  const { page, calls } = wikiPage(() => jsonResponse({ query: { pages: [WIKI_ARTICLE_PAGE] } }))
  const result = await runTool('com.wikipedia.main', 'get_article', {
    input: { title: 'JavaScript' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_article: status')
  equal(result.data.article.pageid, 7072926, 'wikipedia get_article: page id')
  equal(result.data.article.title, 'JavaScript', 'wikipedia get_article: title')
  equal(result.data.article.description, 'Programming language', 'wikipedia get_article: short description')
  equal(result.data.article.url, 'https://en.wikipedia.org/wiki/JavaScript', 'wikipedia get_article: canonical url')
  equal(result.data.article.thumbnail, 'https://upload.wikimedia.org/thumb.png', 'wikipedia get_article: thumbnail')
  equal(result.data.article.length, 123456, 'wikipedia get_article: byte length')
  equal(result.data.article.last_edited, '2026-11-18T12:00:00Z', 'wikipedia get_article: last edited')
  equal(result.data.article.protection.length, 2, 'wikipedia get_article: protection entries')
  equal(result.data.article.protection[1].level, 'sysop', 'wikipedia get_article: protection level')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('titles'), 'JavaScript', 'wikipedia get_article: titles param')
  equal(
    url.searchParams.get('prop'),
    'extracts|info|pageprops|pageimages',
    'wikipedia get_article: prop list',
  )
  equal(url.searchParams.get('exintro'), '1', 'wikipedia get_article: intro extract')
  equal(url.searchParams.get('explaintext'), '1', 'wikipedia get_article: plain text')
  equal(url.searchParams.get('piprop'), 'thumbnail', 'wikipedia get_article: thumbnail prop')
  equal(url.searchParams.get('pithumbsize'), '300', 'wikipedia get_article: thumbnail size')
  equal(url.searchParams.get('inprop'), 'url|displaytitle|protection', 'wikipedia get_article: info props')
}

{
  // A missing title is reported as NOT_FOUND, not as an empty success.
  const { page } = wikiPage(() =>
    jsonResponse({ query: { pages: [{ ns: 0, title: 'Nope', missing: true }] } }),
  )
  const result = await runTool('com.wikipedia.main', 'get_article', {
    input: { title: 'Nope' },
    page,
  })
  equal(result.status, 'error', 'wikipedia get_article missing: error status')
  equal(result.error_code, 'NOT_FOUND', 'wikipedia get_article missing: NOT_FOUND')
  ok(result.message.includes('Nope'), 'wikipedia get_article missing: names the title')
}

{
  // Wikimedia REST summary: underscore/percent encoding in the path plus the
  // mobile/desktop URL and full-resolution image mapping.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      type: 'standard',
      title: 'Albert Einstein',
      displaytitle: 'Albert Einstein',
      pageid: 736,
      extract: 'Albert Einstein was a German-born theoretical physicist.',
      description: 'German-born theoretical physicist (1879–1955)',
      thumbnail: { source: 'https://upload.wikimedia.org/einstein-320.jpg', width: 320, height: 400 },
      originalimage: { source: 'https://upload.wikimedia.org/einstein.jpg', width: 2000, height: 2500 },
      content_urls: {
        desktop: { page: 'https://en.wikipedia.org/wiki/Albert_Einstein' },
        mobile: { page: 'https://en.m.wikipedia.org/wiki/Albert_Einstein' },
      },
      timestamp: '2026-11-17T09:30:00Z',
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_page_summary', {
    input: { title: 'Albert Einstein' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_page_summary: status')
  equal(result.data.pageid, 736, 'wikipedia get_page_summary: page id')
  equal(result.data.description, 'German-born theoretical physicist (1879–1955)', 'wikipedia get_page_summary: description')
  equal(result.data.thumbnail, 'https://upload.wikimedia.org/einstein-320.jpg', 'wikipedia get_page_summary: thumbnail')
  equal(result.data.original_image, 'https://upload.wikimedia.org/einstein.jpg', 'wikipedia get_page_summary: original image')
  equal(result.data.url, 'https://en.wikipedia.org/wiki/Albert_Einstein', 'wikipedia get_page_summary: desktop url')
  equal(result.data.mobile_url, 'https://en.m.wikipedia.org/wiki/Albert_Einstein', 'wikipedia get_page_summary: mobile url')
  equal(result.data.timestamp, '2026-11-17T09:30:00Z', 'wikipedia get_page_summary: timestamp')
  equal(calls[0].url, 'https://en.wikipedia.org/api/rest_v1/page/summary/Albert_Einstein', 'wikipedia get_page_summary: REST path')
  equal(calls[0].init.credentials, 'include', 'wikipedia get_page_summary: sends credentials')
}

{
  // REST 404 becomes NOT_FOUND with the caller's title in the message.
  const { page } = wikiPage(() => jsonResponse({ title: 'Not found' }, 404))
  const result = await runTool('com.wikipedia.main', 'get_page_summary', {
    input: { title: 'Nonexistent article' },
    page,
  })
  equal(result.status, 'error', 'wikipedia get_page_summary 404: error status')
  equal(result.error_code, 'NOT_FOUND', 'wikipedia get_page_summary 404: NOT_FOUND')
}

{
  // Table of contents: action=parse prop=sections keeps the raw string indexes
  // so they can be fed back into get_section_content.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      parse: {
        title: 'JavaScript',
        pageid: 7072926,
        sections: [
          { toclevel: 1, level: '2', line: 'History', number: '1', index: '1', byteoffset: 900, anchor: 'History' },
          { toclevel: 2, level: '3', line: 'Creation at Netscape', number: '1.1', index: '2', byteoffset: 1200, anchor: 'Creation_at_Netscape' },
        ],
      },
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_article_sections', {
    input: { title: 'JavaScript' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_article_sections: status')
  equal(result.data.title, 'JavaScript', 'wikipedia get_article_sections: title')
  equal(result.data.sections.length, 2, 'wikipedia get_article_sections: section count')
  equal(result.data.sections[1].index, '2', 'wikipedia get_article_sections: index is a string')
  equal(result.data.sections[1].level, '3', 'wikipedia get_article_sections: heading level')
  equal(result.data.sections[1].number, '1.1', 'wikipedia get_article_sections: section number')
  equal(result.data.sections[1].anchor, 'Creation_at_Netscape', 'wikipedia get_article_sections: anchor')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('action'), 'parse', 'wikipedia get_article_sections: action=parse')
  equal(url.searchParams.get('page'), 'JavaScript', 'wikipedia get_article_sections: page param')
  equal(url.searchParams.get('prop'), 'sections', 'wikipedia get_article_sections: prop')
}

{
  // Section body: parsed HTML is flattened to plain text (tags → spaces).
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      parse: {
        title: 'JavaScript',
        pageid: 7072926,
        text: '<div class="mw-parser-output"><p>JavaScript was created by <a href="/wiki/Brendan_Eich">Brendan Eich</a> in 1995.</p></div>',
      },
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_section_content', {
    input: { title: 'JavaScript', section: 1 },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_section_content: status')
  equal(result.data.section, 1, 'wikipedia get_section_content: section echoed')
  equal(
    result.data.content,
    'JavaScript was created by Brendan Eich in 1995.',
    'wikipedia get_section_content: tags stripped to text',
  )
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('section'), '1', 'wikipedia get_section_content: section param')
  equal(url.searchParams.get('prop'), 'text', 'wikipedia get_section_content: prop=text')
  equal(url.searchParams.get('disabletoc'), '1', 'wikipedia get_section_content: toc disabled')
  equal(url.searchParams.get('disableeditsection'), '1', 'wikipedia get_section_content: edit links disabled')
}

{
  // MediaWiki answers application errors with HTTP 200: an invalid section is
  // classified as VALIDATION instead of leaking a generic API error.
  const { page } = wikiPage(() =>
    jsonResponse({ error: { code: 'invalidsection', info: 'The section parameter must be a valid section id' } }),
  )
  const result = await runTool('com.wikipedia.main', 'get_section_content', {
    input: { title: 'JavaScript', section: 99 },
    page,
  })
  equal(result.status, 'error', 'wikipedia invalidsection: error status')
  equal(result.error_code, 'VALIDATION', 'wikipedia invalidsection: VALIDATION')
  ok(result.message.includes('99'), 'wikipedia invalidsection: names the section')
}

{
  // Categories, links and languages all read one page prop each.
  const categories = await runTool('com.wikipedia.main', 'get_article_categories', {
    input: { title: 'JavaScript' },
    page: wikiPage(() =>
      jsonResponse({
        query: {
          pages: [
            {
              pageid: 7072926,
              title: 'JavaScript',
              categories: [
                { ns: 14, title: 'Category:Programming languages' },
                { ns: 14, title: 'Category:JavaScript' },
              ],
            },
          ],
        },
      }),
    ).page,
  })
  equal(categories.status, 'ok', 'wikipedia get_article_categories: status')
  equal(categories.data.categories.length, 2, 'wikipedia get_article_categories: count')
  equal(categories.data.categories[0].title, 'Category:Programming languages', 'wikipedia get_article_categories: title')

  const { page: linksPage, calls: linkCalls } = wikiPage(() =>
    jsonResponse({
      query: {
        pages: [
          {
            pageid: 7072926,
            title: 'JavaScript',
            links: [{ ns: 0, title: 'ECMAScript' }, { ns: 0, title: 'Java (programming language)' }],
          },
        ],
      },
    }),
  )
  const links = await runTool('com.wikipedia.main', 'get_article_links', {
    input: { title: 'JavaScript' },
    page: linksPage,
  })
  equal(links.status, 'ok', 'wikipedia get_article_links: status')
  equal(links.data.links.join('|'), 'ECMAScript|Java (programming language)', 'wikipedia get_article_links: titles')
  const linksUrl = new URL(linkCalls[0].url)
  equal(linksUrl.searchParams.get('prop'), 'links', 'wikipedia get_article_links: prop')
  equal(linksUrl.searchParams.get('plnamespace'), '0', 'wikipedia get_article_links: main namespace only')

  const { page: langPage, calls: langCalls } = wikiPage(() =>
    jsonResponse({
      query: {
        pages: [
          {
            pageid: 7072926,
            title: 'JavaScript',
            langlinks: [
              { lang: 'fr', title: 'JavaScript', url: 'https://fr.wikipedia.org/wiki/JavaScript' },
              { lang: 'de', '*': 'JavaScript', url: 'https://de.wikipedia.org/wiki/JavaScript' },
            ],
          },
        ],
      },
    }),
  )
  const languages = await runTool('com.wikipedia.main', 'get_article_languages', {
    input: { title: 'JavaScript', limit: 2 },
    page: langPage,
  })
  equal(languages.status, 'ok', 'wikipedia get_article_languages: status')
  equal(languages.data.languages[0].lang, 'fr', 'wikipedia get_article_languages: language code')
  equal(languages.data.languages[0].url, 'https://fr.wikipedia.org/wiki/JavaScript', 'wikipedia get_article_languages: url')
  equal(languages.data.languages[1].title, 'JavaScript', 'wikipedia get_article_languages: legacy * title fallback')
  const langUrl = new URL(langCalls[0].url)
  equal(langUrl.searchParams.get('llprop'), 'url', 'wikipedia get_article_languages: asks for urls')
  equal(langUrl.searchParams.get('lllimit'), '2', 'wikipedia get_article_languages: limit')
}

{
  // Backlinks and category members both map pageid + title pairs.
  const { page: backlinkPage, calls: backlinkCalls } = wikiPage(() =>
    jsonResponse({
      query: {
        backlinks: [
          { pageid: 100, ns: 0, title: 'ECMAScript' },
          { pageid: 101, ns: 0, title: 'Web browser' },
        ],
      },
    }),
  )
  const backlinks = await runTool('com.wikipedia.main', 'get_backlinks', {
    input: { title: 'JavaScript' },
    page: backlinkPage,
  })
  equal(backlinks.status, 'ok', 'wikipedia get_backlinks: status')
  equal(backlinks.data.backlinks.length, 2, 'wikipedia get_backlinks: count')
  equal(backlinks.data.backlinks[1].pageid, 101, 'wikipedia get_backlinks: page id')
  const backlinkUrl = new URL(backlinkCalls[0].url)
  equal(backlinkUrl.searchParams.get('list'), 'backlinks', 'wikipedia get_backlinks: list')
  equal(backlinkUrl.searchParams.get('bltitle'), 'JavaScript', 'wikipedia get_backlinks: title param')
  equal(backlinkUrl.searchParams.get('blnamespace'), '0', 'wikipedia get_backlinks: namespace')

  const { page: memberPage, calls: memberCalls } = wikiPage(() =>
    jsonResponse({
      query: {
        categorymembers: [
          { pageid: 200, ns: 14, title: 'Category:Scripting languages' },
          { pageid: 201, ns: 14, title: 'Category:Programming languages' },
        ],
      },
    }),
  )
  const members = await runTool('com.wikipedia.main', 'get_category_members', {
    input: { category: 'Category:Programming languages', type: 'subcat' },
    page: memberPage,
  })
  equal(members.status, 'ok', 'wikipedia get_category_members: status')
  equal(members.data.members.length, 2, 'wikipedia get_category_members: count')
  equal(members.data.members[0].title, 'Category:Scripting languages', 'wikipedia get_category_members: title')
  const memberUrl = new URL(memberCalls[0].url)
  equal(memberUrl.searchParams.get('cmtitle'), 'Category:Programming languages', 'wikipedia get_category_members: category param')
  equal(memberUrl.searchParams.get('cmtype'), 'subcat', 'wikipedia get_category_members: type passthrough')
}

{
  // Revision history plus the diff renderer: deleted/added cells become -/+ lines.
  const { page: revPage, calls: revCalls } = wikiPage(() =>
    jsonResponse({
      query: {
        pages: [
          {
            pageid: 7072926,
            title: 'JavaScript',
            revisions: [
              {
                revid: 1267000001,
                parentid: 1266999999,
                user: 'Ada Lovelace',
                timestamp: '2026-11-18T12:00:00Z',
                comment: 'Fix typo in the history section',
                size: 123456,
              },
            ],
          },
        ],
      },
    }),
  )
  const revisions = await runTool('com.wikipedia.main', 'get_revisions', {
    input: { title: 'JavaScript' },
    page: revPage,
  })
  equal(revisions.status, 'ok', 'wikipedia get_revisions: status')
  equal(revisions.data.revisions[0].revid, 1267000001, 'wikipedia get_revisions: revision id')
  equal(revisions.data.revisions[0].user, 'Ada Lovelace', 'wikipedia get_revisions: editor')
  equal(revisions.data.revisions[0].size, 123456, 'wikipedia get_revisions: size')
  const revUrl = new URL(revCalls[0].url)
  equal(revUrl.searchParams.get('prop'), 'revisions', 'wikipedia get_revisions: prop')
  equal(revUrl.searchParams.get('rvlimit'), '10', 'wikipedia get_revisions: default limit')
  equal(revUrl.searchParams.get('rvprop'), 'ids|timestamp|user|comment|size', 'wikipedia get_revisions: props')

  const { page: diffPage, calls: diffCalls } = wikiPage(() =>
    jsonResponse({
      compare: {
        fromid: 0,
        fromrevid: 1266999999,
        fromtitle: 'JavaScript',
        toid: 0,
        torevid: 1267000001,
        totitle: 'JavaScript',
        body: '<table><tr><td class="diff-deletedline"><div>was created in 1994</div></td><td class="diff-addedline"><div>was created in 1995 &amp; shipped</div></td></tr><tr><td colspan="2" class="diff-context"><div>Context line</div></td></tr></table>',
      },
    }),
  )
  const diff = await runTool('com.wikipedia.main', 'compare_revisions', {
    input: { from_rev: 1266999999, to_rev: 1267000001 },
    page: diffPage,
  })
  equal(diff.status, 'ok', 'wikipedia compare_revisions: status')
  equal(diff.data.from_title, 'JavaScript', 'wikipedia compare_revisions: from title')
  ok(diff.data.diff.includes('- was created in 1994'), 'wikipedia compare_revisions: deletion line')
  ok(diff.data.diff.includes('+ was created in 1995 & shipped'), 'wikipedia compare_revisions: addition line with entity decoded')
  ok(diff.data.diff.includes('Context line'), 'wikipedia compare_revisions: context line')
  ok(!diff.data.diff.includes('<div>'), 'wikipedia compare_revisions: no markup left')
  const diffUrl = new URL(diffCalls[0].url)
  equal(diffUrl.searchParams.get('action'), 'compare', 'wikipedia compare_revisions: action=compare')
  equal(diffUrl.searchParams.get('fromrev'), '1266999999', 'wikipedia compare_revisions: fromrev')
  equal(diffUrl.searchParams.get('torev'), '1267000001', 'wikipedia compare_revisions: torev')
  equal(diffUrl.searchParams.get('prop'), 'diff|title|ids', 'wikipedia compare_revisions: props')
}

{
  // Recent changes: oldlen/newlen become old_size/new_size, filtered to edits.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      query: {
        recentchanges: [
          {
            type: 'edit',
            ns: 0,
            title: 'Zig (programming language)',
            pageid: 42,
            revid: 1267000100,
            old_revid: 1267000099,
            user: 'andrewrk',
            timestamp: '2026-11-19T03:00:00Z',
            comment: 'Bump version',
            oldlen: 9000,
            newlen: 9050,
          },
        ],
      },
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_recent_changes', { input: { limit: 1 }, page })
  equal(result.status, 'ok', 'wikipedia get_recent_changes: status')
  equal(result.data.changes[0].title, 'Zig (programming language)', 'wikipedia get_recent_changes: title')
  equal(result.data.changes[0].old_size, 9000, 'wikipedia get_recent_changes: old size')
  equal(result.data.changes[0].new_size, 9050, 'wikipedia get_recent_changes: new size')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('rctype'), 'edit', 'wikipedia get_recent_changes: edits only')
  equal(url.searchParams.get('rcnamespace'), '0', 'wikipedia get_recent_changes: article namespace')
  equal(url.searchParams.get('rclimit'), '1', 'wikipedia get_recent_changes: limit')
}

{
  // Random articles and opensearch (a bare JSON array, not an object).
  const random = await runTool('com.wikipedia.main', 'get_random_articles', {
    input: { count: 2 },
    page: wikiPage(() =>
      jsonResponse({ query: { random: [{ id: 11, ns: 0, title: 'Banana' }, { id: 12, ns: 0, title: 'Kettle' }] } }),
    ).page,
  })
  equal(random.status, 'ok', 'wikipedia get_random_articles: status')
  equal(random.data.articles.length, 2, 'wikipedia get_random_articles: count')
  equal(random.data.articles[0].title, 'Banana', 'wikipedia get_random_articles: title')

  const { page: osPage, calls: osCalls } = wikiPage(() =>
    jsonResponse(['javascript', ['JavaScript', 'JavaScript engine'], ['', ''], ['https://en.wikipedia.org/wiki/JavaScript', 'https://en.wikipedia.org/wiki/JavaScript_engine']]),
  )
  const os = await runTool('com.wikipedia.main', 'opensearch', {
    input: { query: 'javascript', limit: 2 },
    page: osPage,
  })
  equal(os.status, 'ok', 'wikipedia opensearch: status')
  equal(os.data.suggestions.length, 2, 'wikipedia opensearch: suggestion count')
  equal(os.data.suggestions[1].title, 'JavaScript engine', 'wikipedia opensearch: title')
  equal(os.data.suggestions[1].url, 'https://en.wikipedia.org/wiki/JavaScript_engine', 'wikipedia opensearch: url')
  const osUrl = new URL(osCalls[0].url)
  equal(osUrl.searchParams.get('action'), 'opensearch', 'wikipedia opensearch: action')
  equal(osUrl.searchParams.get('search'), 'javascript', 'wikipedia opensearch: search param')
  equal(osUrl.searchParams.get('namespace'), '0', 'wikipedia opensearch: namespace')
}

{
  // Logged-in profile: the identity comes from mw.config, never from the caller.
  const { page, calls } = wikiPage(
    () =>
      jsonResponse({
        query: {
          userinfo: {
            id: 1234,
            userid: 1234,
            name: 'Ada',
            editcount: 4321,
            registration: '2015-01-02T03:04:05Z',
            groups: ['*', 'user', 'autoconfirmed', 'extendedconfirmed'],
          },
        },
      }),
    {
      globals: {
        mw: { config: { values: { wgSiteName: 'Wikipedia', wgUserName: 'Ada', wgUserId: 1234 } } },
      },
    },
  )
  const result = await runTool('com.wikipedia.main', 'get_current_user', { input: {}, page })
  equal(result.status, 'ok', 'wikipedia get_current_user: status')
  equal(result.data.user.name, 'Ada', 'wikipedia get_current_user: name')
  equal(result.data.user.id, 1234, 'wikipedia get_current_user: id')
  equal(result.data.user.editcount, 4321, 'wikipedia get_current_user: edit count')
  equal(result.data.user.groups.length, 4, 'wikipedia get_current_user: groups')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('meta'), 'userinfo', 'wikipedia get_current_user: meta=userinfo')
  equal(url.searchParams.get('uiprop'), 'editcount|registrationdate|groups', 'wikipedia get_current_user: props')
}

{
  // Logged-out tab: get_current_user refuses before touching the API.
  const { page, calls } = wikiPage(() => jsonResponse({}))
  const result = await runTool('com.wikipedia.main', 'get_current_user', { input: {}, page })
  equal(result.status, 'error', 'wikipedia logged out: error status')
  equal(result.error_code, 'UNAUTHENTICATED', 'wikipedia logged out: UNAUTHENTICATED')
  equal(calls.length, 0, 'wikipedia logged out: no API call')
}

{
  // An anonymous visitor's mw.config exposes wgUserId 0, which the port treats
  // as "not logged in" exactly like upstream's `!userId` check.
  const { page, calls } = wikiPage(
    () => jsonResponse({ query: { userinfo: { id: 0, name: '203.0.113.7', anon: true } } }),
    {
      globals: {
        mw: { config: { values: { wgSiteName: 'Wikipedia', wgUserName: '203.0.113.7', wgUserId: 0 } } },
      },
    },
  )
  const result = await runTool('com.wikipedia.main', 'get_current_user', { input: {}, page })
  equal(result.status, 'error', 'wikipedia anonymous visitor: error status')
  equal(result.error_code, 'UNAUTHENTICATED', 'wikipedia anonymous visitor: UNAUTHENTICATED')
  equal(calls.length, 0, 'wikipedia anonymous visitor: no API call')
}

{
  // User contributions: ucuser rides in the query and sizes map through.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      query: {
        usercontribs: [
          {
            user: 'Ada',
            pageid: 42,
            revid: 1267000200,
            parentid: 1267000199,
            ns: 0,
            title: 'Analytical Engine',
            timestamp: '2026-11-19T04:00:00Z',
            comment: 'Add Babbage citation',
            size: 5000,
          },
        ],
      },
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_user_contributions', {
    input: { username: 'Ada', limit: 1 },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_user_contributions: status')
  equal(result.data.contributions[0].revid, 1267000200, 'wikipedia get_user_contributions: revid')
  equal(result.data.contributions[0].comment, 'Add Babbage citation', 'wikipedia get_user_contributions: comment')
  const url = new URL(calls[0].url)
  equal(url.searchParams.get('list'), 'usercontribs', 'wikipedia get_user_contributions: list')
  equal(url.searchParams.get('ucuser'), 'Ada', 'wikipedia get_user_contributions: user')
  equal(url.searchParams.get('uclimit'), '1', 'wikipedia get_user_contributions: limit')
}

{
  // Page views: the one cross-origin call, anonymous, against wikimedia.org.
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      items: [
        { project: 'en.wikipedia', article: 'JavaScript', granularity: 'daily', timestamp: '2026110100', access: 'all-access', agent: 'all-agents', views: 1200 },
        { project: 'en.wikipedia', article: 'JavaScript', granularity: 'daily', timestamp: '2026110200', access: 'all-access', agent: 'all-agents', views: 1800 },
      ],
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_page_views', {
    input: { title: 'JavaScript', start: '20261101', end: '20261102' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_page_views: status')
  equal(result.data.article, 'JavaScript', 'wikipedia get_page_views: article')
  equal(result.data.views[0].date, '20261101', 'wikipedia get_page_views: date from timestamp')
  equal(result.data.views[1].count, 1800, 'wikipedia get_page_views: view count')
  equal(result.data.total, 3000, 'wikipedia get_page_views: total')
  equal(
    calls[0].url,
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/JavaScript/daily/20261101/20261102',
    'wikipedia get_page_views: wikimedia metrics path',
  )
  equal(calls[0].init.credentials, 'omit', 'wikipedia get_page_views: anonymous request')
}

{
  // Featured content: unencoded YYYY/MM/DD date, tfa + top-10 most read + top-5
  // on-this-day trimming.
  const mostread = Array.from({ length: 12 }, (_, i) => ({
    title: 'Article ' + i,
    extract: 'Extract ' + i,
    views: 1000 - i,
    thumbnail: i === 0 ? { source: 'https://upload.wikimedia.org/a0.jpg' } : undefined,
  }))
  const onthisday = Array.from({ length: 6 }, (_, i) => ({ text: 'Event ' + i, year: 1900 + i }))
  const { page, calls } = wikiPage(() =>
    jsonResponse({
      tfa: { title: 'Alan Turing', extract: 'Alan Mathison Turing was an English mathematician.', thumbnail: { source: 'https://upload.wikimedia.org/turing.jpg' } },
      mostread: { date: '2026-11-19Z', articles: mostread },
      onthisday,
    }),
  )
  const result = await runTool('com.wikipedia.main', 'get_featured_content', {
    input: { date: '2026/11/19' },
    page,
  })
  equal(result.status, 'ok', 'wikipedia get_featured_content: status')
  equal(result.data.featured_article.title, 'Alan Turing', 'wikipedia get_featured_content: TFA title')
  equal(result.data.featured_article.thumbnail, 'https://upload.wikimedia.org/turing.jpg', 'wikipedia get_featured_content: TFA thumbnail')
  equal(result.data.most_read.length, 10, 'wikipedia get_featured_content: most read capped at 10')
  equal(result.data.most_read[0].views, 1000, 'wikipedia get_featured_content: view count')
  equal(result.data.on_this_day.length, 5, 'wikipedia get_featured_content: on-this-day capped at 5')
  equal(result.data.on_this_day[1].year, 1901, 'wikipedia get_featured_content: event year')
  equal(calls[0].url, 'https://en.wikipedia.org/api/rest_v1/feed/featured/2026/11/19', 'wikipedia get_featured_content: feed path')
}

{
  // MediaWiki application errors arrive with HTTP 200: rate limiting and a
  // missing title are classified, not reported as success.
  const limited = await runTool('com.wikipedia.main', 'search_articles', {
    input: { query: 'x' },
    page: wikiPage(() => jsonResponse({ error: { code: 'ratelimited', info: 'You have exceeded your rate limit.' } })).page,
  })
  equal(limited.status, 'error', 'wikipedia ratelimited: error status')
  equal(limited.error_code, 'RATE_LIMITED', 'wikipedia ratelimited: RATE_LIMITED')

  const missing = await runTool('com.wikipedia.main', 'get_revisions', {
    input: { title: 'Nope' },
    page: wikiPage(() => jsonResponse({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } })).page,
  })
  equal(missing.status, 'error', 'wikipedia missingtitle: error status')
  equal(missing.error_code, 'NOT_FOUND', 'wikipedia missingtitle: NOT_FOUND')

  // A wrong host refuses to run and never calls the API.
  let fetches = 0
  const wrongHost = await runTool('com.wikipedia.main', 'get_article', {
    input: { title: 'JavaScript' },
    page: {
      hostname: 'en.wikipedia.org.evil.example',
      href: 'https://en.wikipedia.org.evil.example/wiki/JavaScript',
      origin: 'https://en.wikipedia.org.evil.example',
      globals: { mw: { config: { values: { wgSiteName: 'Wikipedia' } } } },
      fetch: async () => {
        fetches++
        return jsonResponse({})
      },
    },
  })
  equal(wrongHost.status, 'error', 'wikipedia wrong host: error status')
  equal(wrongHost.error_code, 'UNSUPPORTED_PAGE', 'wikipedia wrong host: UNSUPPORTED_PAGE')
  equal(fetches, 0, 'wikipedia wrong host: no API call')

  // A dropped connection is a NETWORK failure, not an empty result.
  const offline = await runTool('com.wikipedia.main', 'get_random_articles', {
    input: {},
    page: {
      hostname: 'en.wikipedia.org',
      href: 'https://en.wikipedia.org/wiki/Main_Page',
      origin: 'https://en.wikipedia.org',
      globals: { mw: { config: { values: { wgSiteName: 'Wikipedia' } } } },
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    },
  })
  equal(offline.status, 'error', 'wikipedia offline: error status')
  equal(offline.error_code, 'NETWORK', 'wikipedia offline: NETWORK')
}

section('urlRegex probe: *.wikipedia.org')

{
  // Upstream scopes the plugin to `*://*.wikipedia.org/*`: the port keeps every
  // language and project subdomain (en., de., en.m., ...) while refusing
  // lookalike hosts, plain HTTP, non-default ports and the sibling
  // wikimedia.org hosts.
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.wikipedia.main', 'manifest.json'), 'utf8'),
  )
  const mustMatch = [
    'https://en.wikipedia.org/wiki/JavaScript',
    'https://en.wikipedia.org/',
    'https://en.wikipedia.org/wiki/Albert_Einstein?action=history',
    'https://en.wikipedia.org/wiki/JavaScript#History',
    'https://de.wikipedia.org/wiki/JavaScript',
    'https://zh.wikipedia.org/wiki/%E7%BB%B4%E5%9F%BA%E7%99%BE%E7%A7%91',
    'https://en.m.wikipedia.org/wiki/JavaScript',
    'https://en.wikipedia.org/w/index.php?title=Special:RecentChanges&namespace=0#top',
  ]
  const mustNotMatch = [
    'http://en.wikipedia.org/wiki/JavaScript',
    'https://en.wikipedia.org.evil.example/wiki/JavaScript',
    'https://evil.example/en.wikipedia.org/wiki/JavaScript',
    'https://en.wikipedia.org:8443/wiki/JavaScript',
    'https://user@en.wikipedia.org/wiki/JavaScript',
    'https://wikimedia.org/api/rest_v1/page/summary/JavaScript',
    'https://commons.wikimedia.org/wiki/File:Example.jpg',
    'https://wikipedia.org.evil.example/',
    'https://en.wikipediaorg/wiki/JavaScript',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `wikipedia urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch)
      ok(!regex.test(url), `wikipedia urlRegex rejects ${url} (${tool.name})`)
  }
}


// --- urlRegex probe: drive.google.com ---------------------------------------

section('urlRegex probe: drive.google.com')

{
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.google-drive.main', 'manifest.json'), 'utf8'),
  )
  const mustMatch = [
    'https://drive.google.com/',
    'https://drive.google.com/drive/u/0/my-drive',
    'https://drive.google.com/drive/folders/1AbC?usp=drive_link',
    'https://drive.google.com/file/d/1AbC/view#detail',
  ]
  const mustNotMatch = [
    'http://drive.google.com/drive/u/0/my-drive',
    'https://drive.google.com.evil.example/drive/u/0/my-drive',
    'https://evildrive.google.com/drive/u/0/my-drive',
    'https://drive.google.com:8443/drive/u/0/my-drive',
    'https://mail.google.com/drive/u/0/my-drive',
    'https://docs.google.com/drive/u/0/my-drive',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `google-drive urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch)
      ok(!regex.test(url), `google-drive urlRegex rejects ${url} (${tool.name})`)
  }
}

// --- Google Drive execution --------------------------------------------------
// The Drive web app signs every call through gapi.client.request, which resolves
// with { status, result }. The stub records the request descriptors (path,
// method, params, body) and answers with realistic Drive v3 resources, so the
// ported transport and field mapping really run.

section('execution: Google Drive tools against a stubbed page')

function gdrivePage(handler) {
  const requests = []
  const page = {
    hostname: 'drive.google.com',
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
  }
  return { requests, page }
}

const GDRIVE_FILE = {
  kind: 'drive#file',
  id: 'file-1',
  name: 'Roadmap',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-11-18T09:00:00.000Z',
  createdTime: '2026-11-01T09:00:00.000Z',
  size: '1024',
  parents: ['folder-1'],
  trashed: false,
  starred: true,
  shared: true,
  webViewLink: 'https://docs.google.com/document/d/file-1/edit',
  description: 'Q4 plan',
  owners: [{ displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' }],
  lastModifyingUser: { displayName: 'Grace Hopper', emailAddress: 'grace@example.com' },
}

const GDRIVE_FOLDER = {
  kind: 'drive#file',
  id: 'folder-2',
  name: 'Projects',
  mimeType: 'application/vnd.google-apps.folder',
  parents: ['root'],
}

{
  // list_files: My Drive root by default — the q filter, the 50-item page, the
  // modifiedTime ordering and the full field mask, then the file mapping.
  const { requests, page } = gdrivePage(() => ({
    status: 200,
    result: { files: [GDRIVE_FILE, GDRIVE_FOLDER], nextPageToken: 'page-2' },
  }))
  const result = await runTool('com.google-drive.main', 'list_files', { input: {}, page })
  equal(result.status, 'ok', 'google-drive list_files: status')
  equal(result.data.files.length, 2, 'google-drive list_files: file count')
  equal(result.data.files[0].name, 'Roadmap', 'google-drive list_files: file name')
  equal(result.data.files[0].parent_id, 'folder-1', 'google-drive list_files: parent id')
  equal(result.data.files[0].owner, 'Ada Lovelace', 'google-drive list_files: owner name')
  equal(result.data.files[0].owner_email, 'ada@example.com', 'google-drive list_files: owner email')
  equal(result.data.files[0].last_modified_by, 'Grace Hopper', 'google-drive list_files: last modifier')
  equal(result.data.files[0].size, '1024', 'google-drive list_files: size stays a string')
  equal(result.data.files[0].shared, true, 'google-drive list_files: shared flag')
  equal(result.data.files[1].parent_id, 'root', 'google-drive list_files: folder parent')
  equal(result.data.files[1].size, '', 'google-drive list_files: missing size is empty')
  equal(result.data.next_page_token, 'page-2', 'google-drive list_files: next page token')
  equal(requests[0].path, '/drive/v3/files', 'google-drive list_files: /drive/v3/files endpoint')
  equal(requests[0].method, undefined, 'google-drive list_files: plain read sends no method')
  equal(requests[0].body, undefined, 'google-drive list_files: read has no body')
  equal(
    requests[0].params.q,
    "'root' in parents and trashed = false",
    'google-drive list_files: default q excludes trashed',
  )
  equal(requests[0].params.pageSize, 50, 'google-drive list_files: default page size')
  equal(requests[0].params.orderBy, 'modifiedTime desc', 'google-drive list_files: default ordering')
  equal(requests[0].params.pageToken, undefined, 'google-drive list_files: undefined params filtered')
  ok(
    String(requests[0].params.fields).startsWith('nextPageToken,files(id,name,mimeType'),
    'google-drive list_files: requests the list field mask',
  )
}

{
  // list_files inside a folder, including trashed items, ordered by name.
  const { requests, page } = gdrivePage(() => ({ status: 200, result: { files: [] } }))
  const result = await runTool('com.google-drive.main', 'list_files', {
    input: { parent_id: 'folder-9', include_trashed: true, order_by: 'name', page_size: 5 },
    page,
  })
  equal(result.status, 'ok', 'google-drive list_files folder: status')
  equal(requests[0].params.q, "'folder-9' in parents", 'google-drive list_files folder: parent filter')
  equal(requests[0].params.pageSize, 5, 'google-drive list_files folder: page size passthrough')
  equal(requests[0].params.orderBy, 'name', 'google-drive list_files folder: ordering passthrough')
  equal(result.data.files.length, 0, 'google-drive list_files folder: empty list stays ok')
  equal(result.data.next_page_token, '', 'google-drive list_files folder: empty page token')
}

{
  // search_files: fullText query with the upstream quote/backslash escaping, an
  // optional MIME filter and the trashed clause, default page size 20.
  const { requests, page } = gdrivePage(() => ({
    status: 200,
    result: { files: [GDRIVE_FILE] },
  }))
  const result = await runTool('com.google-drive.main', 'search_files', {
    input: { query: "Ada's \\ notes", mime_type: 'application/vnd.google-apps.document' },
    page,
  })
  equal(result.status, 'ok', 'google-drive search_files: status')
  equal(result.data.files[0].id, 'file-1', 'google-drive search_files: match id')
  equal(
    requests[0].params.q,
    "fullText contains 'Ada\\'s \\\\ notes' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
    'google-drive search_files: escaped query, mime filter, trashed clause',
  )
  equal(requests[0].params.pageSize, 20, 'google-drive search_files: default page size 20')
  equal(requests[0].path, '/drive/v3/files', 'google-drive search_files: /drive/v3/files endpoint')
}

{
  // get_file: metadata read by id, encoded into the path, full field mask. This
  // is the only content surface upstream exposes (web_view_link) — the plugin
  // has no export/download tool.
  const { requests, page } = gdrivePage(() => ({ status: 200, result: GDRIVE_FILE }))
  const result = await runTool('com.google-drive.main', 'get_file', {
    input: { file_id: 'file-1' },
    page,
  })
  equal(result.status, 'ok', 'google-drive get_file: status')
  equal(result.data.file.id, 'file-1', 'google-drive get_file: id')
  equal(result.data.file.mime_type, 'application/vnd.google-apps.document', 'google-drive get_file: mime type')
  equal(result.data.file.description, 'Q4 plan', 'google-drive get_file: description')
  equal(
    result.data.file.web_view_link,
    'https://docs.google.com/document/d/file-1/edit',
    'google-drive get_file: web view link',
  )
  equal(requests[0].path, '/drive/v3/files/file-1', 'google-drive get_file: /files/{id} path')
  equal(requests[0].method, undefined, 'google-drive get_file: read sends no method')
  ok(
    String(requests[0].params.fields).indexOf('owners(displayName,emailAddress)') !== -1,
    'google-drive get_file: asks for owners in the field mask',
  )

  const encoded = await runTool('com.google-drive.main', 'get_file', {
    input: { file_id: 'folder/1' },
    page,
  })
  equal(encoded.status, 'ok', 'google-drive get_file encoded: status')
  equal(requests[1].path, '/drive/v3/files/folder%2F1', 'google-drive get_file: id is URL-encoded')
}

{
  // create_folder: POST with the folder MIME type; parents only when supplied.
  const { requests, page } = gdrivePage(() => ({ status: 200, result: GDRIVE_FOLDER }))
  const nested = await runTool('com.google-drive.main', 'create_folder', {
    input: { name: 'Projects', parent_id: 'folder-1', description: 'Q4 work' },
    page,
  })
  equal(nested.status, 'ok', 'google-drive create_folder: status')
  equal(nested.data.file.id, 'folder-2', 'google-drive create_folder: new folder id')
  equal(requests[0].method, 'POST', 'google-drive create_folder: POST')
  equal(requests[0].path, '/drive/v3/files', 'google-drive create_folder: /files endpoint')
  const body = JSON.parse(requests[0].body)
  equal(body.name, 'Projects', 'google-drive create_folder: name')
  equal(body.mimeType, 'application/vnd.google-apps.folder', 'google-drive create_folder: folder MIME type')
  equal(body.parents.join(','), 'folder-1', 'google-drive create_folder: parents')
  equal(body.description, 'Q4 work', 'google-drive create_folder: description')

  await runTool('com.google-drive.main', 'create_folder', { input: { name: 'Root folder' }, page })
  const rootBody = JSON.parse(requests[1].body)
  ok(!('parents' in rootBody), 'google-drive create_folder: omits parents without a parent id')
  ok(!('description' in rootBody), 'google-drive create_folder: omits an unspecified description')
}

{
  // create_file: the MIME type defaults to a Google Doc.
  const { requests, page } = gdrivePage(() => ({ status: 200, result: GDRIVE_FILE }))
  const result = await runTool('com.google-drive.main', 'create_file', {
    input: { name: 'Notes' },
    page,
  })
  equal(result.status, 'ok', 'google-drive create_file: status')
  equal(requests[0].method, 'POST', 'google-drive create_file: POST')
  equal(
    JSON.parse(requests[0].body).mimeType,
    'application/vnd.google-apps.document',
    'google-drive create_file: default MIME type',
  )
}

{
  // Rename (update_file PATCH, only the supplied field) and move (addParents /
  // removeParents params, no body).
  const { requests, page } = gdrivePage((options) => ({
    status: 200,
    result: { ...GDRIVE_FILE, name: options.body ? JSON.parse(options.body).name || GDRIVE_FILE.name : GDRIVE_FILE.name },
  }))
  const renamed = await runTool('com.google-drive.main', 'update_file', {
    input: { file_id: 'file-1', name: 'Roadmap 2027' },
    page,
  })
  equal(renamed.status, 'ok', 'google-drive update_file: status')
  equal(renamed.data.file.name, 'Roadmap 2027', 'google-drive update_file: renamed file')
  equal(requests[0].method, 'PATCH', 'google-drive update_file: PATCH')
  equal(requests[0].path, '/drive/v3/files/file-1', 'google-drive update_file: /files/{id} path')
  const patchBody = JSON.parse(requests[0].body)
  equal(patchBody.name, 'Roadmap 2027', 'google-drive update_file: name in body')
  ok(!('description' in patchBody), 'google-drive update_file: omits untouched fields')

  const moved = await runTool('com.google-drive.main', 'move_file', {
    input: { file_id: 'file-1', from_parent_id: 'folder-1', to_parent_id: 'folder-2' },
    page,
  })
  equal(moved.status, 'ok', 'google-drive move_file: status')
  equal(requests[1].method, 'PATCH', 'google-drive move_file: PATCH')
  equal(requests[1].params.addParents, 'folder-2', 'google-drive move_file: addParents')
  equal(requests[1].params.removeParents, 'folder-1', 'google-drive move_file: removeParents')
  equal(requests[1].body, undefined, 'google-drive move_file: parent move needs no body')
}

{
  // copy_file posts the copy body; trash/restore PATCH the trashed flag.
  const { requests, page } = gdrivePage(() => ({ status: 200, result: GDRIVE_FILE }))
  await runTool('com.google-drive.main', 'copy_file', {
    input: { file_id: 'file-1', name: 'Copy of Roadmap', parent_id: 'folder-2' },
    page,
  })
  equal(requests[0].path, '/drive/v3/files/file-1/copy', 'google-drive copy_file: /copy path')
  equal(requests[0].method, 'POST', 'google-drive copy_file: POST')
  const copyBody = JSON.parse(requests[0].body)
  equal(copyBody.name, 'Copy of Roadmap', 'google-drive copy_file: name')
  equal(copyBody.parents.join(','), 'folder-2', 'google-drive copy_file: parents')

  await runTool('com.google-drive.main', 'trash_file', { input: { file_id: 'file-1' }, page })
  equal(JSON.parse(requests[1].body).trashed, true, 'google-drive trash_file: sets trashed')
  await runTool('com.google-drive.main', 'restore_file', { input: { file_id: 'file-1' }, page })
  equal(JSON.parse(requests[2].body).trashed, false, 'google-drive restore_file: clears trashed')
}

{
  // Sharing: list_permissions maps the permission list, create_permission posts
  // the grantee and defaults sendNotificationEmail to true.
  const { requests, page } = gdrivePage((options) => ({
    status: 200,
    result: options.method === 'POST'
      ? { id: 'perm-2', type: 'user', role: 'writer', emailAddress: 'grace@example.com', displayName: 'Grace Hopper' }
      : {
          permissions: [
            { id: 'perm-1', type: 'user', role: 'owner', emailAddress: 'ada@example.com', displayName: 'Ada Lovelace' },
            { id: 'perm-3', type: 'domain', role: 'reader', domain: 'example.com' },
          ],
        },
  }))
  const listed = await runTool('com.google-drive.main', 'list_permissions', {
    input: { file_id: 'file-1' },
    page,
  })
  equal(listed.status, 'ok', 'google-drive list_permissions: status')
  equal(listed.data.permissions.length, 2, 'google-drive list_permissions: permission count')
  equal(listed.data.permissions[0].role, 'owner', 'google-drive list_permissions: role')
  equal(listed.data.permissions[1].domain, 'example.com', 'google-drive list_permissions: domain grantee')
  equal(
    requests[0].path,
    '/drive/v3/files/file-1/permissions',
    'google-drive list_permissions: /permissions path',
  )
  equal(
    requests[0].params.fields,
    'permissions(id,type,role,emailAddress,displayName,domain)',
    'google-drive list_permissions: permission field mask',
  )

  const shared = await runTool('com.google-drive.main', 'create_permission', {
    input: { file_id: 'file-1', type: 'user', role: 'writer', email: 'grace@example.com' },
    page,
  })
  equal(shared.status, 'ok', 'google-drive create_permission: status')
  equal(shared.data.permission.id, 'perm-2', 'google-drive create_permission: permission id')
  equal(shared.data.permission.display_name, 'Grace Hopper', 'google-drive create_permission: grantee name')
  equal(requests[1].method, 'POST', 'google-drive create_permission: POST')
  equal(requests[1].params.sendNotificationEmail, true, 'google-drive create_permission: notifies by default')
  const shareBody = JSON.parse(requests[1].body)
  equal(shareBody.type, 'user', 'google-drive create_permission: type')
  equal(shareBody.role, 'writer', 'google-drive create_permission: role')
  equal(shareBody.emailAddress, 'grace@example.com', 'google-drive create_permission: grantee email')
  ok(!('domain' in shareBody), 'google-drive create_permission: omits an absent domain')
}

{
  // Account reads: the About endpoint maps the profile and the storage quota
  // (byte counts stay strings; missing counters default to '0').
  const { requests, page } = gdrivePage(() => ({
    status: 200,
    result: {
      user: {
        displayName: 'Ada Lovelace',
        emailAddress: 'ada@example.com',
        permissionId: 'perm-1',
        photoLink: 'https://lh3.googleusercontent.com/ada',
      },
      storageQuota: { limit: '16106127360', usage: '1073741824', usageInDrive: '805306368' },
    },
  }))
  const me = await runTool('com.google-drive.main', 'get_current_user', { input: {}, page })
  equal(me.status, 'ok', 'google-drive get_current_user: status')
  equal(me.data.user.display_name, 'Ada Lovelace', 'google-drive get_current_user: display name')
  equal(me.data.user.permission_id, 'perm-1', 'google-drive get_current_user: permission id')
  equal(me.data.storage_quota.limit_bytes, '16106127360', 'google-drive get_current_user: limit stays a string')
  equal(me.data.storage_quota.usage_in_trash_bytes, '0', 'google-drive get_current_user: missing trash usage')
  equal(requests[0].path, '/drive/v3/about', 'google-drive get_current_user: /about endpoint')

  const quota = await runTool('com.google-drive.main', 'get_storage_quota', { input: {}, page })
  equal(quota.status, 'ok', 'google-drive get_storage_quota: status')
  equal(quota.data.storage_quota.usage_in_drive_bytes, '805306368', 'google-drive get_storage_quota: drive usage')
  equal(requests[1].params.fields, 'storageQuota', 'google-drive get_storage_quota: quota field mask')
}

{
  // Permanent deletes: gapi rejects a 204 No Content DELETE, which upstream
  // treats as success.
  const { requests, page } = gdrivePage(() => {
    const error = new Error('No Content')
    error.status = 204
    throw error
  })
  const deleted = await runTool('com.google-drive.main', 'delete_file', {
    input: { file_id: 'file-1' },
    page,
  })
  equal(deleted.status, 'ok', 'google-drive delete_file: 204 counts as success')
  equal(deleted.data.success, true, 'google-drive delete_file: success flag')
  equal(requests[0].method, 'DELETE', 'google-drive delete_file: DELETE')
  equal(requests[0].path, '/drive/v3/files/file-1', 'google-drive delete_file: /files/{id} path')

  const emptied = await runTool('com.google-drive.main', 'empty_trash', { input: {}, page })
  equal(emptied.status, 'ok', 'google-drive empty_trash: 204 counts as success')
  equal(requests[1].path, '/drive/v3/files/trash', 'google-drive empty_trash: /files/trash path')
  equal(requests[1].method, 'DELETE', 'google-drive empty_trash: DELETE')

  const removed = await runTool('com.google-drive.main', 'delete_permission', {
    input: { file_id: 'file-1', permission_id: 'perm-2' },
    page,
  })
  equal(removed.status, 'ok', 'google-drive delete_permission: 204 counts as success')
  equal(
    requests[2].path,
    '/drive/v3/files/file-1/permissions/perm-2',
    'google-drive delete_permission: nested permission path',
  )
}

{
  // Auth failures are classified, not thrown: a gapi 401 is AUTH, a 404 is
  // NOT_FOUND, and the Drive error message survives.
  const unauthorized = gdrivePage(() => {
    const error = new Error('Invalid Credentials')
    error.status = 401
    error.result = { error: { code: 401, message: 'Invalid Credentials' } }
    throw error
  })
  const auth = await runTool('com.google-drive.main', 'list_files', {
    input: {},
    page: unauthorized.page,
  })
  equal(auth.status, 'error', 'google-drive gapi 401: error status')
  equal(auth.error_code, 'AUTH', 'google-drive gapi 401: classified as AUTH')
  equal(auth.message, 'Invalid Credentials', 'google-drive gapi 401: upstream message')

  const missing = gdrivePage(() => {
    const error = new Error('File not found: file-404.')
    error.status = 404
    error.result = { error: { code: 404, message: 'File not found: file-404.' } }
    throw error
  })
  const notFound = await runTool('com.google-drive.main', 'get_file', {
    input: { file_id: 'file-404' },
    page: missing.page,
  })
  equal(notFound.status, 'error', 'google-drive gapi 404: error status')
  equal(notFound.error_code, 'NOT_FOUND', 'google-drive gapi 404: classified as NOT_FOUND')
}

{
  // Logged-out tab: the Drive app never publishes gapi, so after the upstream
  // 8s readiness window the same-origin /drive/v3 path answers with Google's
  // marketing HTML instead of JSON — reported as AUTH "not ready", not as data.
  const requests = []
  const result = await runTool('com.google-drive.main', 'list_files', {
    input: {},
    page: {
      hostname: 'drive.google.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return htmlResponse('<!doctype html><html><head><title>Google Drive</title></head></html>')
      },
    },
  })
  equal(result.status, 'error', 'google-drive logged-out: error status')
  equal(result.error_code, 'AUTH', 'google-drive logged-out: classified as AUTH')
  ok(String(result.message).includes('not ready'), 'google-drive logged-out: explains the tab is not ready')
  equal(requests[0].init.credentials, 'include', 'google-drive logged-out: fallback sends credentials')
  ok(
    String(requests[0].url).startsWith('https://drive.google.com/drive/v3/files?'),
    'google-drive logged-out: keeps the same-origin Drive v3 path',
  )
}




// --- urlRegex probe: docs.google.com ----------------------------------------

section('urlRegex probe: docs.google.com')

{
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, 'com.google-docs.main', 'manifest.json'), 'utf8'))
  const mustMatch = [
    'https://docs.google.com/document/d/1abcDEF_ghi-jkl/edit',
    'https://docs.google.com/document/d/1abcDEF_ghi-jkl/edit?tab=t.0',
    'https://docs.google.com/document/d/1abcDEF_ghi-jkl/edit?usp=sharing&tab=t.1#heading=h.abc',
    'https://docs.google.com/document/u/0/d/1abcDEF_ghi-jkl/edit',
    'https://docs.google.com/document/',
  ]
  const mustNotMatch = [
    'http://docs.google.com/document/d/1abcDEF_ghi-jkl/edit',
    'https://docs.google.com.evil.example/document/d/1abc/edit',
    'https://evildocs.google.com/document/d/1abc/edit',
    'https://docs.google.com:8443/document/d/1abc/edit',
    'https://docs.google.com/spreadsheets/d/1abc/edit',
    'https://docs.google.com/presentation/d/1abc/edit',
    'https://drive.google.com/document/d/1abc/edit',
    'https://mail.google.com/document/d/1abc/edit',
  ]
  for (const tool of manifest.tools) {
    const regex = new RegExp(tool.urlRegex)
    for (const url of mustMatch) ok(regex.test(url), `google-docs urlRegex matches ${url} (${tool.name})`)
    for (const url of mustNotMatch) ok(!regex.test(url), `google-docs urlRegex rejects ${url} (${tool.name})`)
  }
}

// --- Google Docs execution ---------------------------------------------------
// The Docs editor loads gapi and every plugin call goes through
// gapi.client.request with a Drive v3 path (upstream has no Docs API v2/v1
// batchUpdate usage). The stubs below record those request descriptors, answer
// with realistic Drive resources, and serve the editor HTML the plain-text and
// comment-anchor paths parse.

section('execution: Google Docs tools against a stubbed page')

function gdocsPage(handler, extra = {}) {
  const requests = []
  const apiKeys = []
  const page = {
    hostname: 'docs.google.com',
    href: 'https://docs.google.com/document/d/DOC1/edit',
    globals: {
      gapi: {
        client: {
          request: async (options) => {
            requests.push(options)
            return handler(options)
          },
          setApiKey: (key) => apiKeys.push(key),
        },
      },
    },
    ...extra,
  }
  return { requests, apiKeys, page }
}

const GDOC_FILE = {
  kind: 'drive#file',
  id: 'DOC1',
  name: 'Roadmap Q4',
  mimeType: 'application/vnd.google-apps.document',
  createdTime: '2026-10-01T08:00:00.000Z',
  modifiedTime: '2026-11-18T12:30:00.000Z',
  trashed: false,
  starred: true,
  shared: true,
  ownedByMe: true,
  webViewLink: 'https://docs.google.com/document/d/DOC1/edit',
  owners: [{ displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' }],
  lastModifyingUser: { displayName: 'Grace Hopper', emailAddress: 'grace@example.com' },
}

// Two model chunks written out of document order, one non-text op and one
// trailing blank line: the parser must sort by ibi, drop blanks and ignore ops
// that are not `ty: "is"`.
const GDOC_HTML = `<!doctype html><html><head><title>Roadmap Q4 - Google Docs</title></head><body>
<script>DOCS_modelChunk = {"chunk":[{"ty":"is","s":"Q4 priorities\\n","ibi":2},{"ty":"ds"}]};</script>
<script>DOCS_modelChunk = {"chunk":[{"ty":"is","s":"Ship the port\\n","ibi":1},{"ty":"te","s":"not body text"}]};</script>
</body></html>`

{
  // get_current_document: the document is the one in the tab, the tab id comes
  // from ?tab=, and the page's embedded gmsSuiteApiKey is handed to gapi once.
  const { requests, apiKeys, page } = gdocsPage(() => ({ status: 200, result: GDOC_FILE }), {
    href: 'https://docs.google.com/document/d/DOC1/edit?tab=t.0',
  })
  page.globals.preload = { globals: { gmsSuiteApiKey: 'page-key' } }
  const result = await runTool('com.google-docs.main', 'get_current_document', { input: {}, page })
  equal(result.status, 'ok', 'google-docs get_current_document: status')
  equal(result.message, null, 'google-docs get_current_document: null message on success')
  equal(result.data.document.id, 'DOC1', 'google-docs get_current_document: id')
  equal(result.data.document.title, 'Roadmap Q4', 'google-docs get_current_document: title')
  equal(result.data.document.trashed, false, 'google-docs get_current_document: trashed flag')
  equal(result.data.document.starred, true, 'google-docs get_current_document: starred flag')
  equal(result.data.document.owner, 'Ada Lovelace', 'google-docs get_current_document: owner name')
  equal(result.data.document.owner_email, 'ada@example.com', 'google-docs get_current_document: owner email')
  equal(result.data.document.last_modified_by, 'Grace Hopper', 'google-docs get_current_document: last modifier')
  equal(result.data.active_tab.id, 't.0', 'google-docs get_current_document: tab id from the URL')
  equal(result.data.active_tab.title, 'Current tab', 'google-docs get_current_document: tab title')
  equal(result.data.active_tab.is_current_tab, true, 'google-docs get_current_document: current tab flag')
  equal(result.data.tabs.length, 1, 'google-docs get_current_document: tabs')
  equal(requests[0].path, '/drive/v3/files/DOC1', 'google-docs get_current_document: file endpoint')
  ok(
    String(requests[0].params.fields).startsWith('id,name,mimeType,modifiedTime'),
    'google-docs get_current_document: requests the document field set',
  )
  equal(requests[0].method, undefined, 'google-docs get_current_document: plain GET')
  equal(apiKeys[0], 'page-key', 'google-docs get_current_document: sets the page API key')
  equal(apiKeys.length, 1, 'google-docs get_current_document: sets the API key once')
}

{
  // get_document with an explicit id that is not the open tab: the caller's
  // tab_id is reported back instead of the (unavailable) live tab.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: GDOC_FILE }))
  const result = await runTool('com.google-docs.main', 'get_document', {
    input: { document_id: 'DOC9', tab_id: 't.5' },
    page,
  })
  equal(result.status, 'ok', 'google-docs get_document: status')
  equal(result.data.document.id, 'DOC1', 'google-docs get_document: mapped document')
  equal(result.data.selected_tab.id, 't.5', 'google-docs get_document: explicit tab id')
  equal(result.data.selected_tab.title, 'Tab t.5', 'google-docs get_document: explicit tab title')
  equal(requests[0].path, '/drive/v3/files/DOC9', 'google-docs get_document: explicit id endpoint')

  // The live tab of the open document cannot be swapped for another one.
  const live = gdocsPage(() => ({ status: 200, result: GDOC_FILE }), {
    href: 'https://docs.google.com/document/d/DOC1/edit?tab=t.0',
  })
  const rejected = await runTool('com.google-docs.main', 'get_document', {
    input: { tab_id: 't.9' },
    page: live.page,
  })
  equal(rejected.status, 'error', 'google-docs get_document: foreign tab is an error')
  equal(rejected.error_code, 'VALIDATION', 'google-docs get_document: foreign tab is VALIDATION')
  ok(String(rejected.message).includes('active tab'), 'google-docs get_document: explains the active-tab limit')
}

{
  // Plain text: the editor HTML is fetched with the session cookie and the
  // DOCS_modelChunk blobs are parsed in document order.
  const requests = []
  const result = await runTool('com.google-docs.main', 'get_document_text', {
    input: {},
    page: {
      hostname: 'docs.google.com',
      href: 'https://docs.google.com/document/d/DOC1/edit',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return htmlResponse(GDOC_HTML)
      },
    },
  })
  equal(result.status, 'ok', 'google-docs get_document_text: status')
  equal(result.data.document_id, 'DOC1', 'google-docs get_document_text: document id from the tab')
  equal(result.data.title, 'Roadmap Q4', 'google-docs get_document_text: title without the Google Docs suffix')
  equal(result.data.text, 'Ship the port\nQ4 priorities', 'google-docs get_document_text: chunks sorted by ibi')
  ok(
    String(requests[0].url).startsWith('https://docs.google.com/document/d/DOC1/edit?tab=t.0&_cb='),
    'google-docs get_document_text: fetches the editor HTML',
  )
  equal(requests[0].init.credentials, 'include', 'google-docs get_document_text: sends credentials')
  equal(requests[0].init.cache, 'no-store', 'google-docs get_document_text: bypasses the cache')
}

{
  // create_document: JSON POST with the Docs mime type, optional fields omitted.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: { ...GDOC_FILE, id: 'DOC2', name: 'New doc' } }))
  const result = await runTool('com.google-docs.main', 'create_document', {
    input: { name: 'New doc' },
    page,
  })
  equal(result.status, 'ok', 'google-docs create_document: status')
  equal(result.data.document.id, 'DOC2', 'google-docs create_document: new id')
  equal(requests[0].path, '/drive/v3/files', 'google-docs create_document: files endpoint')
  equal(requests[0].method, 'POST', 'google-docs create_document: POST')
  const body = JSON.parse(requests[0].body)
  equal(body.name, 'New doc', 'google-docs create_document: name')
  equal(body.mimeType, 'application/vnd.google-apps.document', 'google-docs create_document: Docs mime type')
  ok(!('parents' in body), 'google-docs create_document: omits an unspecified folder')
  ok(!('description' in body), 'google-docs create_document: omits an unspecified description')
}

{
  // update_document_title: PATCH with only the new name.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: { ...GDOC_FILE, name: 'Renamed' } }))
  const result = await runTool('com.google-docs.main', 'update_document_title', {
    input: { document_id: 'DOC1', title: 'Renamed' },
    page,
  })
  equal(result.status, 'ok', 'google-docs update_document_title: status')
  equal(result.data.document.title, 'Renamed', 'google-docs update_document_title: new title')
  equal(requests[0].method, 'PATCH', 'google-docs update_document_title: PATCH')
  equal(requests[0].path, '/drive/v3/files/DOC1', 'google-docs update_document_title: file endpoint')
  equal(requests[0].body, '{"name":"Renamed"}', 'google-docs update_document_title: only the name is sent')
}

{
  // trash_document / restore_document flip the trashed flag in place.
  const trashed = gdocsPage(() => ({ status: 200, result: { ...GDOC_FILE, trashed: true } }))
  const trashResult = await runTool('com.google-docs.main', 'trash_document', {
    input: { document_id: 'DOC1' },
    page: trashed.page,
  })
  equal(trashResult.status, 'ok', 'google-docs trash_document: status')
  equal(trashResult.data.document.trashed, true, 'google-docs trash_document: trashed flag')
  equal(trashed.requests[0].body, '{"trashed":true}', 'google-docs trash_document: PATCH body')

  const restored = gdocsPage(() => ({ status: 200, result: { ...GDOC_FILE, trashed: false } }))
  const restoreResult = await runTool('com.google-docs.main', 'restore_document', {
    input: { document_id: 'DOC1' },
    page: restored.page,
  })
  equal(restoreResult.status, 'ok', 'google-docs restore_document: status')
  equal(restored.requests[0].body, '{"trashed":false}', 'google-docs restore_document: PATCH body')
}

{
  // delete_document: a permanent DELETE, whose 204 is a rejection for gapi and
  // must not be reported as an error.
  const { requests, page } = gdocsPage(() => {
    const error = new Error('No Content')
    error.status = 204
    throw error
  })
  const result = await runTool('com.google-docs.main', 'delete_document', {
    input: { document_id: 'DOC1' },
    page,
  })
  equal(result.status, 'ok', 'google-docs delete_document: status')
  equal(result.data.success, true, 'google-docs delete_document: success flag')
  equal(requests[0].method, 'DELETE', 'google-docs delete_document: DELETE')
  equal(requests[0].path, '/drive/v3/files/DOC1', 'google-docs delete_document: file endpoint')
}

{
  // copy_document: POST to /copy with only the supplied overrides.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: { ...GDOC_FILE, id: 'DOC3', name: 'Roadmap Q4 (copy)' } }))
  const result = await runTool('com.google-docs.main', 'copy_document', {
    input: { document_id: 'DOC1', name: 'Roadmap Q4 (copy)', folder_id: 'FOLDER1' },
    page,
  })
  equal(result.status, 'ok', 'google-docs copy_document: status')
  equal(result.data.document.id, 'DOC3', 'google-docs copy_document: copy id')
  equal(requests[0].path, '/drive/v3/files/DOC1/copy', 'google-docs copy_document: copy endpoint')
  const body = JSON.parse(requests[0].body)
  equal(body.name, 'Roadmap Q4 (copy)', 'google-docs copy_document: new name')
  equal(body.parents[0], 'FOLDER1', 'google-docs copy_document: target folder')
  ok(!('description' in body), 'google-docs copy_document: omits an unspecified description')
}

{
  // search_documents: Drive query with the upstream mime + trashed filters and
  // the upstream escaping of a quoted search term.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: { files: [GDOC_FILE], nextPageToken: 'p2' } }))
  const result = await runTool('com.google-docs.main', 'search_documents', {
    input: { query: "ada's notes" },
    page,
  })
  equal(result.status, 'ok', 'google-docs search_documents: status')
  equal(result.data.documents.length, 1, 'google-docs search_documents: result count')
  equal(result.data.documents[0].title, 'Roadmap Q4', 'google-docs search_documents: mapped title')
  equal(result.data.next_page_token, 'p2', 'google-docs search_documents: next page token')
  equal(
    requests[0].params.q,
    "mimeType = 'application/vnd.google-apps.document' and (name contains 'ada\\'s notes' or fullText contains 'ada\\'s notes') and trashed = false",
    'google-docs search_documents: escaped Drive query',
  )
  equal(requests[0].params.pageSize, 20, 'google-docs search_documents: default page size')
  ok(!('orderBy' in requests[0].params), 'google-docs search_documents: no orderBy upstream')
}

{
  // get_current_user: /about maps the profile and the storage quota strings.
  const { requests, page } = gdocsPage(() => ({
    status: 200,
    result: {
      user: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', permissionId: 'perm-1', photoLink: 'https://lh3.example/ada' },
      storageQuota: { limit: '16106127360', usage: '1073741824', usageInDrive: '1000000000', usageInDriveTrash: '73741824' },
    },
  }))
  const result = await runTool('com.google-docs.main', 'get_current_user', { input: {}, page })
  equal(result.status, 'ok', 'google-docs get_current_user: status')
  equal(result.data.user.display_name, 'Ada Lovelace', 'google-docs get_current_user: display name')
  equal(result.data.user.permission_id, 'perm-1', 'google-docs get_current_user: permission id')
  equal(result.data.storage_quota.limit_bytes, '16106127360', 'google-docs get_current_user: quota limit stays a string')
  equal(result.data.storage_quota.usage_in_trash_bytes, '73741824', 'google-docs get_current_user: trash usage')
  equal(requests[0].path, '/drive/v3/about', 'google-docs get_current_user: about endpoint')
  ok(String(requests[0].params.fields).includes('storageQuota'), 'google-docs get_current_user: requests the quota')
}

// Comments: Drive v3 exposes threads at /files/:id/comments with resolution
// expressed as a reply whose action is "resolve"/"reopen", and pagination via
// nextPageToken. list_comments additionally filters orphaned threads by the
// kix.<id> anchors embedded in the editor HTML.

const GDOC_COMMENT = {
  id: 'c1',
  author: { displayName: 'Grace Hopper', emailAddress: 'grace@example.com' },
  content: 'Tighten this intro',
  createdTime: '2026-11-10T09:00:00.000Z',
  modifiedTime: '2026-11-10T09:00:00.000Z',
  resolved: false,
  quotedFileContent: { mimeType: 'text/plain', value: 'Ship the port' },
  anchor: 'kix.a1b2c3d4e5f6g7',
  replies: [
    {
      id: 'r1',
      author: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' },
      content: 'Agreed',
      createdTime: '2026-11-10T10:00:00.000Z',
      modifiedTime: '2026-11-10T10:00:00.000Z',
      action: 'reopen',
    },
  ],
}

{
  // list_comments: two comment pages fetched internally, resolved threads
  // dropped by the default status, the orphan (its kix id is absent from the
  // HTML) dropped, and the page token treated as an offset.
  const { requests, page } = gdocsPage((options) => ({
    status: 200,
    result: String(options.params.pageToken || '') === 'p2'
      ? { comments: [{ ...GDOC_COMMENT, id: 'c3', anchor: 'kix.orphan0000000000' }] }
      : {
          comments: [
            GDOC_COMMENT,
            { ...GDOC_COMMENT, id: 'c2', resolved: true },
          ],
          nextPageToken: 'p2',
        },
  }))
  const html = '<html><body><span id="kix.a1b2c3d4e5f6g7"></span></body></html>'
  const fetches = []
  page.fetch = async (url, init) => {
    fetches.push({ url, init })
    return htmlResponse(html)
  }
  const result = await runTool('com.google-docs.main', 'list_comments', { input: {}, page })
  equal(result.status, 'ok', 'google-docs list_comments: status')
  equal(result.data.comments.length, 1, 'google-docs list_comments: open, live comments only')
  equal(result.data.comments[0].id, 'c1', 'google-docs list_comments: surviving comment')
  equal(result.data.comments[0].resolved, false, 'google-docs list_comments: resolved flag')
  equal(result.data.comments[0].quoted_text, 'Ship the port', 'google-docs list_comments: quoted text')
  equal(result.data.comments[0].replies[0].action, 'reopen', 'google-docs list_comments: reply action')
  equal(result.data.next_page_token, '', 'google-docs list_comments: no more pages')
  equal(requests.length, 2, 'google-docs list_comments: fetches every comment page')
  equal(requests[0].path, '/drive/v3/files/DOC1/comments', 'google-docs list_comments: comments endpoint')
  equal(requests[0].params.pageSize, 100, 'google-docs list_comments: upstream page size')
  equal(requests[0].params.includeDeleted, false, 'google-docs list_comments: includeDeleted default')
  equal(requests[1].params.pageToken, 'p2', 'google-docs list_comments: follows nextPageToken')
  ok(
    String(fetches[0].url).endsWith('/document/d/DOC1/edit'),
    'google-docs list_comments: reads the editor HTML for anchors',
  )
  equal(fetches[0].init.credentials, 'include', 'google-docs list_comments: sends credentials for the HTML')

  // include_orphaned keeps the orphan and status "all" keeps resolved threads;
  // page_size then slices the filtered set and returns an offset token.
  const second = gdocsPage((options) => ({
    status: 200,
    result: String(options.params.pageToken || '') === 'p2'
      ? { comments: [{ ...GDOC_COMMENT, id: 'c3', anchor: 'kix.orphan0000000000' }] }
      : { comments: [GDOC_COMMENT, { ...GDOC_COMMENT, id: 'c2', resolved: true }], nextPageToken: 'p2' },
  }))
  const all = await runTool('com.google-docs.main', 'list_comments', {
    input: { status: 'all', include_orphaned: true, page_size: 2 },
    page: second.page,
  })
  equal(all.status, 'ok', 'google-docs list_comments all: status')
  equal(all.data.comments.length, 2, 'google-docs list_comments all: first page slice')
  equal(all.data.next_page_token, '2', 'google-docs list_comments all: offset token')
}

{
  // create_comment: the quote becomes quotedFileContent and the response is
  // mapped, replies included.
  const { requests, page } = gdocsPage(() => ({ status: 200, result: GDOC_COMMENT }))
  const result = await runTool('com.google-docs.main', 'create_comment', {
    input: { document_id: 'DOC1', content: 'Tighten this intro', quoted_text: 'Ship the port' },
    page,
  })
  equal(result.status, 'ok', 'google-docs create_comment: status')
  equal(result.data.comment.author, 'Grace Hopper', 'google-docs create_comment: author')
  equal(result.data.comment.anchor, 'kix.a1b2c3d4e5f6g7', 'google-docs create_comment: anchor')
  equal(requests[0].path, '/drive/v3/files/DOC1/comments', 'google-docs create_comment: comments endpoint')
  equal(requests[0].method, 'POST', 'google-docs create_comment: POST')
  const body = JSON.parse(requests[0].body)
  equal(body.content, 'Tighten this intro', 'google-docs create_comment: content')
  equal(body.quotedFileContent.value, 'Ship the port', 'google-docs create_comment: quoted text')
  equal(body.quotedFileContent.mimeType, 'text/plain', 'google-docs create_comment: quoted mime type')
}

{
  // reply_to_comment posts content plus the upstream reopen action.
  const { requests, page } = gdocsPage(() => ({
    status: 200,
    result: { id: 'r2', author: { displayName: 'Ada' }, content: 'Done', createdTime: '2026-11-11T00:00:00.000Z' },
  }))
  const result = await runTool('com.google-docs.main', 'reply_to_comment', {
    input: { document_id: 'DOC1', comment_id: 'c1', content: 'Done' },
    page,
  })
  equal(result.status, 'ok', 'google-docs reply_to_comment: status')
  equal(result.data.reply.id, 'r2', 'google-docs reply_to_comment: reply id')
  equal(result.data.reply.content, 'Done', 'google-docs reply_to_comment: reply content')
  equal(requests[0].path, '/drive/v3/files/DOC1/comments/c1/replies', 'google-docs reply_to_comment: replies endpoint')
  const body = JSON.parse(requests[0].body)
  equal(body.action, 'reopen', 'google-docs reply_to_comment: upstream action')
}

{
  // resolve_comment: a resolve reply, then a re-read of the thread.
  const { requests, page } = gdocsPage((options) => {
    if (String(options.path).endsWith('/replies')) return { status: 200, result: { id: 'r3', action: 'resolve' } }
    return { status: 200, result: { ...GDOC_COMMENT, resolved: true } }
  })
  const result = await runTool('com.google-docs.main', 'resolve_comment', {
    input: { document_id: 'DOC1', comment_id: 'c1' },
    page,
  })
  equal(result.status, 'ok', 'google-docs resolve_comment: status')
  equal(result.data.comment.resolved, true, 'google-docs resolve_comment: resolved in the mapped comment')
  equal(requests.length, 2, 'google-docs resolve_comment: reply then re-read')
  equal(JSON.parse(requests[0].body).action, 'resolve', 'google-docs resolve_comment: resolve action')
  equal(requests[0].method, 'POST', 'google-docs resolve_comment: posts the action reply')
  equal(requests[1].path, '/drive/v3/files/DOC1/comments/c1', 'google-docs resolve_comment: re-reads the thread')
  equal(requests[1].method, undefined, 'google-docs resolve_comment: re-read is a GET')
}

{
  // delete_comment / delete_reply: permanent DELETEs with the 204 rejection.
  const comment = gdocsPage(() => {
    const error = new Error('No Content')
    error.status = 204
    throw error
  })
  const commentResult = await runTool('com.google-docs.main', 'delete_comment', {
    input: { document_id: 'DOC1', comment_id: 'c1' },
    page: comment.page,
  })
  equal(commentResult.status, 'ok', 'google-docs delete_comment: status')
  equal(commentResult.data.success, true, 'google-docs delete_comment: success flag')
  equal(comment.requests[0].path, '/drive/v3/files/DOC1/comments/c1', 'google-docs delete_comment: endpoint')
  equal(comment.requests[0].method, 'DELETE', 'google-docs delete_comment: DELETE')

  const reply = gdocsPage(() => {
    const error = new Error('No Content')
    error.status = 204
    throw error
  })
  const replyResult = await runTool('com.google-docs.main', 'delete_reply', {
    input: { document_id: 'DOC1', comment_id: 'c1', reply_id: 'r1' },
    page: reply.page,
  })
  equal(replyResult.status, 'ok', 'google-docs delete_reply: status')
  equal(reply.requests[0].path, '/drive/v3/files/DOC1/comments/c1/replies/r1', 'google-docs delete_reply: endpoint')
}

{
  // No gapi on the tab: the same Drive path goes out as a same-origin fetch, and
  // Google's signed-out HTML is reported as AUTH instead of as data.
  const requests = []
  const result = await runTool('com.google-docs.main', 'get_document', {
    input: { document_id: 'DOC1' },
    page: {
      hostname: 'docs.google.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return htmlResponse('<!doctype html><html><head><title>Sign in - Google Accounts</title></head></html>')
      },
    },
  })
  equal(result.status, 'error', 'google-docs logged-out get_document: error status')
  equal(result.error_code, 'AUTH', 'google-docs logged-out get_document: AUTH')
  ok(String(result.message).includes('not ready'), 'google-docs logged-out get_document: explains the tab is not ready')
  ok(
    String(requests[0].url).startsWith('https://docs.google.com/drive/v3/files/DOC1?fields=') &&
      String(requests[0].url).includes('lastModifyingUser'),
    'google-docs logged-out get_document: same-origin Drive path',
  )
  equal(requests[0].init.credentials, 'include', 'google-docs logged-out get_document: sends credentials')

  // A signed-out editor HTML read is AUTH too, never an empty document.
  const text = await runTool('com.google-docs.main', 'get_document_text', {
    input: { document_id: 'DOC1' },
    page: {
      hostname: 'docs.google.com',
      fetch: async () => htmlResponse('<!doctype html><html><head><title>Sign in</title></head></html>'),
    },
  })
  equal(text.status, 'error', 'google-docs logged-out get_document_text: error status')
  equal(text.error_code, 'AUTH', 'google-docs logged-out get_document_text: AUTH')
}

{
  // A gapi call that rejects with 401 is classified, not thrown out of the
  // workflow, and keeps the upstream message.
  const { page } = gdocsPage(() => {
    const error = new Error('Invalid Credentials')
    error.status = 401
    error.result = { error: { code: 401, message: 'Invalid Credentials' } }
    throw error
  })
  const result = await runTool('com.google-docs.main', 'get_current_user', { input: {}, page })
  equal(result.status, 'error', 'google-docs gapi 401: error status')
  equal(result.error_code, 'AUTH', 'google-docs gapi 401: AUTH')
  equal(result.message, 'Invalid Credentials', 'google-docs gapi 401: upstream message')

  // 403 is AUTH as well; 404 keeps its own classification.
  const forbidden = gdocsPage(() => {
    const error = new Error('The caller does not have permission')
    error.status = 403
    error.result = { error: { code: 403, message: 'The caller does not have permission' } }
    throw error
  })
  const denied = await runTool('com.google-docs.main', 'get_document', { input: { document_id: 'DOC1' }, page: forbidden.page })
  equal(denied.error_code, 'AUTH', 'google-docs gapi 403: AUTH')

  const missing = gdocsPage(() => {
    const error = new Error('File not found')
    error.status = 404
    error.result = { error: { code: 404, message: 'File not found' } }
    throw error
  })
  const notFound = await runTool('com.google-docs.main', 'get_document', { input: { document_id: 'nope' }, page: missing.page })
  equal(notFound.error_code, 'NOT_FOUND', 'google-docs gapi 404: NOT_FOUND')
}

{
  // A tab on another Google host is refused before any request.
  const requests = []
  const result = await runTool('com.google-docs.main', 'get_current_user', {
    input: {},
    page: {
      hostname: 'drive.google.com',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return jsonResponse({})
      },
    },
  })
  equal(result.status, 'error', 'google-docs wrong host: error status')
  equal(result.error_code, 'UNSUPPORTED_PAGE', 'google-docs wrong host: UNSUPPORTED_PAGE')
  equal(requests.length, 0, 'google-docs wrong host: makes no request')
}

// --- 4b. Package-local test modules -----------------------------------------
//
// A package may ship its execution tests as scripts/tests/<package>.test.mjs
// exporting `default function (ctx)`. They run here, before the registry check,
// so a new package never has to edit this file (parallel ports never conflict).

const testsDir = path.join(root, 'scripts', 'tests')
if (existsSync(testsDir)) {
  const ctx = { ok, equal, section, runTool, root, packagesDir }
  for (const file of readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(testsDir, file)).href)
    await mod.default(ctx)
  }
}

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
