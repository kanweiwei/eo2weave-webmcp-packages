/**
 * fetch-opentabs.mjs — cache the upstream OpenTabs plugin manifests.
 *
 * The published npm packages are the source of truth for the ports in this
 * repo: same tool names, same input schemas. Their `dist/tools.json` is
 * cached under `.cache/opentabs/` so `npm test` can assert that parity
 * without network access.
 *
 * Usage: node scripts/fetch-opentabs.mjs
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'opentabs')

// The plugin name is the middle segment of the package id (com.google-docs.main →
// google-docs), so every package is cached automatically. EXPLICIT wins when a
// package id does not map 1:1 to its upstream plugin name.
const EXPLICIT = {
  github: '@opentabs-dev/opentabs-plugin-github',
  notion: '@opentabs-dev/opentabs-plugin-notion',
  linear: '@opentabs-dev/opentabs-plugin-linear',
  hackernews: '@opentabs-dev/opentabs-plugin-hackernews',
  npm: '@opentabs-dev/opentabs-plugin-npm',
  jira: '@opentabs-dev/opentabs-plugin-jira',
  slack: '@opentabs-dev/opentabs-plugin-slack',
  reddit: '@opentabs-dev/opentabs-plugin-reddit',
  todoist: '@opentabs-dev/opentabs-plugin-todoist',
  stackoverflow: '@opentabs-dev/opentabs-plugin-stackoverflow',
  'google-calendar': '@opentabs-dev/opentabs-plugin-google-calendar',
  wikipedia: '@opentabs-dev/opentabs-plugin-wikipedia',
  'google-drive': '@opentabs-dev/opentabs-plugin-google-drive',
  'google-docs': '@opentabs-dev/opentabs-plugin-google-docs',
}

const packagesDir = path.join(root, 'packages')
const DERIVED = Object.fromEntries(
  readdirSync(packagesDir)
    .filter((id) => existsSync(path.join(packagesDir, id, 'manifest.json')))
    .map((id) => [id.split('.')[1], `@opentabs-dev/opentabs-plugin-${id.split('.')[1]}`]),
)

const PLUGINS = { ...DERIVED, ...EXPLICIT }

async function fetchWithRetry(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw lastError
}

await mkdir(cacheDir, { recursive: true })

for (const [plugin, pkg] of Object.entries(PLUGINS)) {
  try {
  const registry = await (await fetchWithRetry(`https://registry.npmjs.org/${pkg}`)).json()
  const version = registry['dist-tags'].latest
  const tarball = registry.versions[version].dist.tarball
  const tarballPath = path.join(cacheDir, `${plugin}.tgz`)
  const response = await fetchWithRetry(tarball)
  await writeFile(tarballPath, Buffer.from(await response.arrayBuffer()))
  const extracted = path.join(cacheDir, 'tools.json')
  execFileSync('tar', ['xzf', tarballPath, '-C', cacheDir, '--strip-components=2', 'package/dist/tools.json'])
  await writeFile(path.join(cacheDir, `${plugin}-tools.json`), await readFile(extracted, 'utf8'))
  await rm(extracted, { force: true })
  await rm(tarballPath, { force: true })
  console.log(`${plugin}: cached ${pkg}@${version}`)
  } catch (error) {
    console.log(`${plugin}: skipped (${error.message.split('\n')[0]})`)
  }
}
