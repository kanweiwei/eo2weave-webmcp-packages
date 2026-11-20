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

39 packages, 1102 tools. Every one is a **full-fidelity 1:1 port**: every upstream tool is present
under the same name, with the same input properties and `required` list (asserted against the
cached upstream manifest), the same endpoint mechanics, write tools included. Each package's own
README documents its transport, error contract, deviations and complete tool table.

| Package | Tools | Source |
| --- | --- | --- |
| `com.datadog.main` | 75 | OpenTabs plugin (MIT) |
| `com.linear.main` | 59 | OpenTabs plugin (MIT) |
| `com.slack-enterprise.main` | 54 | OpenTabs plugin (MIT) |
| `com.retool.main` | 50 | OpenTabs plugin (MIT) |
| `com.netlify.main` | 40 | OpenTabs plugin (MIT) |
| `com.powerpoint.main` | 39 | OpenTabs plugin (MIT) |
| `com.bluesky.main` | 38 | OpenTabs plugin (MIT) |
| `com.posthog.main` | 38 | OpenTabs plugin (MIT) |
| `com.terraform-cloud.main` | 38 | OpenTabs plugin (MIT) |
| `com.github.main` | 35 | OpenTabs plugin (MIT) |
| `com.twilio.main` | 35 | OpenTabs plugin (MIT) |
| `com.circleci.main` | 33 | OpenTabs plugin (MIT) |
| `com.todoist.main` | 33 | OpenTabs plugin (MIT) |
| `com.tumblr.main` | 32 | OpenTabs plugin (MIT) |
| `com.grafana.main` | 29 | OpenTabs plugin (MIT) |
| `com.x.main` | 31 | OpenTabs plugin (MIT) |
| `com.cloudflare.main` | 30 | OpenTabs plugin (MIT) |
| `com.stripe.main` | 30 | OpenTabs plugin (MIT) |
| `com.bitbucket.main` | 27 | OpenTabs plugin (MIT) |
| `com.discord.main` | 26 | OpenTabs plugin (MIT) |
| `com.asana.main` | 24 | OpenTabs plugin (MIT) |
| `com.reddit.main` | 23 | OpenTabs plugin (MIT) |
| `com.gitlab.main` | 22 | OpenTabs plugin (MIT) |
| `com.slack.main` | 22 | OpenTabs plugin (MIT) |
| `com.confluence.main` | 21 | OpenTabs plugin (MIT) |
| `com.jira.main` | 20 | OpenTabs plugin (MIT) |
| `com.stackoverflow.main` | 20 | OpenTabs plugin (MIT) |
| `com.google-docs.main` | 19 | OpenTabs plugin (MIT) |
| `com.wikipedia.main` | 19 | OpenTabs plugin (MIT) |
| `com.google-calendar.main` | 18 | OpenTabs plugin (MIT) |
| `com.notion.main` | 18 | OpenTabs plugin (MIT) |
| `com.google-drive.main` | 17 | OpenTabs plugin (MIT) |
| `com.npm.main` | 14 | OpenTabs plugin (MIT) |
| `com.clickup.main` | 11 | OpenTabs plugin (MIT) |
| `com.hackernews.main` | 10 | OpenTabs plugin (MIT) |
| `com.airtable.main` | 8 | OpenTabs plugin (MIT) |
| `com.calendly.main` | 15 | OpenTabs plugin (MIT) |
| `com.zendesk.main` | 17 | OpenTabs plugin (MIT) |
| `com.docker-hub.main` | 12 | OpenTabs plugin (MIT) |

## Migration notes

Each upstream OpenTabs plugin is ported on its own branch (`feat/<plugin>-port`) in its own
worktree and merged through a PR; the batch PRs (#1–#16) carried several ports each. The upstream
manifests are the source of truth for parity: `npm run fetch-opentabs` caches them under
`.cache/opentabs/` (gitignored), and `npm test` compares the tool set, input properties and
`required` list of every package against the cached manifest — a package whose manifest is not
cached is skipped with a notice rather than failing the suite.

`com.discord.main` started as the pilot port and is a full 26-tool port today.

## Related

- Main repo: https://github.com/nutstore/eo2weave
- Package opt-in prompt: nutstore/eo2weave#100
- Discord pilot PR: nutstore/eo2weave#92
