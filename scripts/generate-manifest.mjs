/** generate-manifest.mjs — regenerate the registry manifest.json from packages/. Run: node scripts/generate-manifest.mjs */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const packagesDir = path.join(root, 'packages')
const RUNTIME_EXCLUDE = new Set(['README.md'])

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

const packages = []
for (const entry of (await readdir(packagesDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const pkgDir = path.join(packagesDir, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(pkgDir, 'manifest.json'), 'utf8'))
  } catch (e) {
    console.error(`SKIP ${entry.name}: cannot read manifest.json — ${e.message}`)
    continue
  }
  const files = []
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { await walk(full); continue }
      if (RUNTIME_EXCLUDE.has(e.name) || e.name.endsWith('.pyc')) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      files.push({ path: rel, sha256: sha256(await readFile(full)) })
    }
  }
  await walk(pkgDir)
  files.sort((a, b) => a.path.localeCompare(b.path))
  packages.push({
    id: manifest.id ?? entry.name,
    version: manifest.version ?? '0.0.0',
    description: manifest.description ?? '',
    toolCount: (manifest.tools ?? []).length,
    files,
  })
}

const manifestOut = { generatedAt: new Date().toISOString(), packages }
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifestOut, null, 2) + '\n')
console.log(`manifest.json regenerated: ${packages.length} package(s), ${packages.reduce((n, p) => n + p.files.length, 0)} files`)