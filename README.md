# eo2weave-webmcp-packages

External-site WebMCP packages for [CreatorWeave / EO2Weave](https://github.com/nutstore/eo2weave) —
site adapters (Discord, GitHub, Notion, Linear, ...) that users can install without waiting for an
extension release.

## Why this repo exists

Builtin packages (`builtin-webmcp/` in the main repo) ship inside every extension release:
adding a site adapter means an extension bump + Chrome/Edge store review (1-3 days, two independent
timelines). This repo decouples that: packages here are installable on demand, and a broken site
adapter never blocks an extension release.

## Package format

Each package is a directory under `packages/` with the same format as builtin packages:

```
packages/com.example.main/
├── manifest.json     # package metadata + tool declarations (urlRegex per tool)
├── config.json       # activation defaults
├── README.md         # tool tables, mechanics, i18n descriptions
└── workflows/        # one self-contained workflow per tool
```

A workflow declares its `inputSchema`/`outputSchema` and runs inside the logged-in site tab
(`browser.eval`), so the site's own session authenticates every call: the credentials never leave
the page context.

## Layout

```
packages/            # one directory per site package
scripts/
├── validate-package.mjs   # schema + urlRegex lint (ci gate)
├── test-packages.mjs      # functional tests: contract, upstream parity, execution
├── fetch-opentabs.mjs     # caches the upstream OpenTabs plugin manifests
└── generate-manifest.mjs  # regenerates the registry manifest.json
manifest.json        # registry manifest: name / version / urlRegex / sha256 (generated)
```

## Adding / updating a package

1. Create or edit `packages/<id>/` (manifest.json + config.json + workflows/ + README.md)
2. Regenerate the registry manifest: `npm run generate-manifest` (fills root `manifest.json` with file lists + sha256)
3. Run the tests: `npm test` (and `npm run fetch-opentabs` first, to cache the upstream plugin manifests)
4. Commit and push — the registry is served from raw.githubusercontent.com automatically

## Testing

`npm test` runs three functional layers — no rendering tests, no snapshots:

1. **Contract** — every manifest and workflow parses, tool names are unique, `urlRegex` compiles and
   is anchored, workflows declare the required `{inputSchema, outputSchema, tree, result}` shape,
   perform no page navigation, and send credentials with the request.
2. **Parity** — each ported package carries exactly the tool set of the upstream OpenTabs plugin it
   was ported from, with the same input properties and the same required inputs
   (`npm run fetch-opentabs` caches the upstream manifests for this check).
3. **Execution** — representative tools of each package are executed against a stubbed page
   (in-page `fetch`, `document`, storage), so the ported runtime really runs and its parsed output
   is asserted.

## Packages

| Package | Tools | Source |
| --- | --- | --- |
| `com.discord.main` | 8 | OpenTabs Discord plugin (MIT) — pilot port |
| `com.github.main` | 35 | OpenTabs GitHub plugin (MIT) |
| `com.notion.main` | 18 | OpenTabs Notion plugin (MIT) |
| `com.linear.main` | 59 | OpenTabs Linear plugin (MIT) |

The GitHub, Notion and Linear packages are **full-fidelity 1:1 ports**: every upstream tool is
present under the same name, with the same input schema and the same endpoint mechanics, write
tools included. Each package's README documents the mechanics, the error contract, the complete
tool table and the four-locale (zh-CN / en-US / ja-JP / ko-KR) tool descriptions.

## Migration notes

`com.discord.main` is the pilot port (from OpenTabs, MIT). The GitHub, Notion and Linear packages
are full ports of the corresponding OpenTabs plugins. Further OpenTabs migrations are done
manually for now — a converter script may be added later if batch demand materializes.

## Related

- Main repo: https://github.com/nutstore/eo2weave
- Package opt-in prompt: nutstore/eo2weave#100
- Discord pilot PR: nutstore/eo2weave#92
