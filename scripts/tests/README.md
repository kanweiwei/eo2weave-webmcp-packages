# Package-local tests

Drop a `com.<site>.main.test.mjs` here and `npm test` runs it automatically —
no edits to `scripts/test-packages.mjs`, so parallel ports never conflict.

```js
export default async function register({ ok, equal, section, runTool }) {
  section('execution: Notion tools against a stubbed page')
  const result = await runTool('com.notion.main', 'search', {
    input: { query: 'roadmap' },
    page: /* the page object the runtime will see */,
  })
  equal(result.status, 'ok', 'notion search: status')
}
```

`ctx` carries `ok`, `equal`, `section`, `runTool`, `root`, `packagesDir`.
Fixtures live in the test module itself (happy-dom is available in the repo).

Rules:

- Test the ported runtime, not the stub: assert the request the workflow makes
  (URL, method, query/body) plus the parsed output.
- Cover every write/auth path the package has, and one failure path
  (`AUTH` / `NOT_FOUND` / `VALIDATION`).
- Parity (tool count, tool-name set, per-tool input schema) is asserted
  centrally in `scripts/test-packages.mjs` from `.cache/opentabs/*-tools.json`,
  so do not duplicate it here.
