# eo2weave-mcp-packages

External-site WebMCP packages for [CreatorWeave / EO2Weave](https://github.com/nutstore/eo2weave) —
site adapters (Discord, Reddit, ...) that users can install without waiting for an extension release.

## Why this repo exists

Builtin packages (`builtin-webmcp/` in the main repo) ship inside every extension release:
adding a site adapter means an extension bump + Chrome/Edge store review (1-3 days, two independent
timelines). This repo decouples that: packages here are installable on demand, and a broken site
adapter never blocks an extension release.

## Package format

Each package is a directory under `packages/` with the same declarative format as builtin packages:

```
packages/com.example.main/
├── manifest.json     # package metadata + tool declarations (urlRegex per tool)
├── config.json       # activation defaults
└── workflows/        # declarative per-tool endpoint mappings (no arbitrary JS execution)
```

The declarative workflow format is the security boundary: packages can only declare HTTP endpoint
mappings, never execute arbitrary code in the page.

## Layout

```
packages/            # one directory per site package
scripts/
└── validate-package.mjs   # schema + urlRegex lint (ci gate)
manifest.json        # registry manifest: name / version / urlRegex / sha256 (generated)
```

## Migration notes

`com.discord.main` is the pilot port (from OpenTabs, MIT). Further OpenTabs migrations are done
manually for now — a converter script may be added later if batch demand materializes.

## Related

- Main repo: https://github.com/nutstore/eo2weave
- Package opt-in prompt: nutstore/eo2weave#100
- Discord pilot PR: nutstore/eo2weave#92
