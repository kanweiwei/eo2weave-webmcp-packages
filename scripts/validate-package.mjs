/** validate-package.mjs — validate one package directory (schema + urlRegex rules). Usage: node scripts/validate-package.mjs packages/com.example.main */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir || !existsSync(dir)) { console.error(`usage: node scripts/validate-package.mjs <package-dir>`); process.exit(2) }
const errors = []
const warnings = []

const manifestPath = path.join(dir, 'manifest.json')
if (!existsSync(manifestPath)) errors.push('manifest.json missing')
else {
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (e) { errors.push(`manifest.json parse error: ${e.message}`); manifest = null }
  if (manifest) {
    const pkgName = manifest.id ?? manifest.name
    if (pkgName !== path.basename(dir)) errors.push(`manifest.id "${pkgName}" != directory name "${path.basename(dir)}"`)
    if (!manifest.description) warnings.push('manifest.description empty')
    for (const t of manifest.tools ?? []) {
      for (const key of ['name', 'description', 'urlRegex', 'path']) {
        if (typeof t[key] !== 'string' || !t[key].trim()) errors.push(`tool "${t.name ?? '?'}": ${key} must be a nonempty string`)
      }
      if (typeof t.urlRegex === 'string') {
        if (!t.urlRegex.startsWith('^')) errors.push(`tool "${t.name}": urlRegex must start with ^`)
        if (!t.urlRegex.endsWith('$')) errors.push(`tool "${t.name}": urlRegex must end with $`)
        if (t.urlRegex.length > 2000) errors.push(`tool "${t.name}": urlRegex exceeds 2000 chars`)
        try { new RegExp(t.urlRegex) } catch (e) { errors.push(`tool "${t.name}": invalid regex — ${e.message}`) }
      }
    }
  }
}
if (!existsSync(path.join(dir, 'config.json'))) warnings.push('config.json missing (activation defaults)')
const wf = path.join(dir, 'workflows')
if (!existsSync(wf) || readdirSync(wf).filter(f => f.endsWith('.js')).length === 0) warnings.push('workflows/ has no .js files')

for (const e of errors) console.error(`ERROR: ${e}`)
for (const w of warnings) console.warn(`WARN: ${w}`)
if (errors.length) { console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) — FAILED`); process.exit(1) }
console.log(`OK — 0 errors, ${warnings.length} warning(s)`)
