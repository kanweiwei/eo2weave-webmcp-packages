# Netlify WebMCP package (com.netlify.main 0.1.0)

Full port of the OpenTabs Netlify plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/netlify) into the
builtin WebMCP package format: **all 40 upstream tools, no subset** — every read
and every write, including the deploy, DNS, hook, deploy-key and form mutations.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-netlify@0.0.88` `dist/tools.json`): the tool host
reads that file in `npm test` and compares tool names, counts, input property
sets and `required` lists. The `inputSchema`/`outputSchema` in each workflow are
the upstream JSON Schemas verbatim (zod → JSON Schema as the plugin build emits
them), so `number` stays `number`, optional stays optional and `z.record` stays
`{type: object, additionalProperties: {}}`.

## Transport (same as the Netlify dashboard)

Every call runs inside the app.netlify.com tab:

- **API base** — `/access-control/bb-api/api/v1`, the same-origin BFF path the
  dashboard's own SPA calls. All 40 tools are relative to it, exactly like
  upstream's `API_BASE` in `src/netlify-api.ts`.
- **Auth** — Netlify's session cookies (`_nf-auth`, `connect.sid`) are HttpOnly,
  so nothing is read, copied or stored: each request is a same-origin `fetch`
  with `credentials: 'include'`. The login hint is the *non-HttpOnly*
  `_nf-auth-hint` cookie, which upstream's `isAuthenticated()` reads
  (`=== 'user-is-likely-authed'`).
- **CSRF** — none. Upstream sends no CSRF header for Netlify (the bb-api trusts
  the first-party cookies plus same-origin), so no header was invented here;
  writes carry only `Content-Type: application/json` when they have a body.
- **Bodies** — JSON, `JSON.stringify`d, and only when the handler supplies one:
  `create_site`, `update_site`, `create_env_vars`, `update_env_var`,
  `create_dns_zone`, `create_dns_record`, `create_build_hook` send a body; the
  lock/unlock/restore/create-build/create-deploy-key/delete calls are bodyless,
  exactly as upstream.
- **Pagination** — upstream's own: `page` and `per_page` travel as query
  parameters on `list_sites`, `list_deploys`, `list_builds`,
  `list_audit_events` and `list_form_submissions` (defaults are Netlify's
  server-side ones; undefined keys are dropped from the query string). The
  plugin never reads `Link`/`X-Total` headers, so neither does this port.
- **Envelopes** — `items`-style outputs are mapped field by field through the
  upstream `map*` functions (defensive `?? ''`/`0`/`[]`/`false`), not returned raw.
- **Error classification** — mirrors the SDK's `httpStatusToToolError`:
  401/403 → `AUTH`, 404 → `NOT_FOUND`, 429 → `RATE_LIMITED` (with `Retry-After`
  echoed), 400/422 → `VALIDATION`, 408 → `TIMEOUT`, everything else →
  `HTTP`; error bodies are truncated to 512 chars like `MAX_ERROR_BODY_LENGTH`.
  No page identity → `UNAUTHENTICATED`; wrong host → `UNSUPPORTED_PAGE`;
  aborted → `TIMEOUT`; transport failure → `NETWORK`.
- The in-page fetch aborts after **18s** so it always settles inside the
  adapter's 25s command window (upstream uses the SDK's 30s timeout).

## Tools (40)

| Tool | Type | Request (relative to `/access-control/bb-api/api/v1`) | Notes |
| --- | --- | --- | --- |
| `get_current_user` | Read | `GET /user` | upstream `api('/user')` |
| `list_accounts` | Read | `GET /accounts` | all accounts/teams the session can see |
| `get_account` | Read | `GET /accounts/:account_id` | account by ID |
| `list_audit_events` | Read | `GET /accounts/:account_id/audit` | `query`, `page`, `per_page` query params |
| `list_members` | Read | `GET /:account_slug/members` | account membership |
| `get_member` | Read | `GET /:account_slug/members/:member_id` | member by ID |
| `list_sites` | Read | `GET /:account_slug/sites` | `name`, `page`, `per_page` query params |
| `get_site` | Read | `GET /sites/:site_id` | site by ID |
| `create_site` | Write | `POST /:account_slug/sites` | body `{name}` |
| `update_site` | Write | `PATCH /sites/:site_id` | body only carries supplied fields; `repo_branch`/`build_cmd` become `build_settings` |
| `delete_site` | Write | `DELETE /sites/:site_id` | returns `{success:true}` |
| `list_deploys` | Read | `GET /sites/:site_id/deploys` | `page`, `per_page` query params |
| `get_deploy` | Read | `GET /deploys/:deploy_id` | deploy by ID |
| `lock_deploy` | Write | `POST /deploys/:deploy_id/lock` | bodyless POST |
| `unlock_deploy` | Write | `POST /deploys/:deploy_id/unlock` | bodyless POST |
| `restore_deploy` | Write | `POST /sites/:site_id/deploys/:deploy_id/restore` | creates a new deploy from an old one |
| `rollback_deploy` | Write | `PUT /sites/:site_id/rollback` | reverts to the previous published deploy |
| `list_builds` | Read | `GET /sites/:site_id/builds` | `page`, `per_page` query params |
| `create_build` | Write | `POST /sites/:site_id/builds` | bodyless POST — triggers a build/deploy |
| `list_env_vars` | Read | `GET /accounts/:account_id/env` | optional `site_id` scope |
| `get_env_var` | Read | `GET /accounts/:account_id/env/:key` | `encodeURIComponent(key)`, optional `site_id` |
| `create_env_vars` | Write | `POST /accounts/:account_id/env` | body is the `variables` array itself, optional `site_id` |
| `update_env_var` | Write | `PUT /accounts/:account_id/env/:key` | body `{values, scopes?, is_secret?}`, optional `site_id` |
| `delete_env_var` | Write | `DELETE /accounts/:account_id/env/:key` | optional `site_id`, returns `{success:true}` |
| `list_dns_zones` | Read | `GET /dns_zones` | optional `account_slug` filter |
| `get_dns_zone` | Read | `GET /dns_zones/:zone_id` | zone by ID |
| `create_dns_zone` | Write | `POST /dns_zones` | body `{account_slug, name, site_id?}` |
| `list_dns_records` | Read | `GET /dns_zones/:zone_id/dns_records` | records of one zone |
| `create_dns_record` | Write | `POST /dns_zones/:zone_id/dns_records` | body `{hostname, type, value, ttl?, priority?}` |
| `delete_dns_record` | Write | `DELETE /dns_zones/:zone_id/dns_records/:record_id` | returns `{success:true}` |
| `list_hooks` | Read | `GET /hooks?site_id=` | notification/outgoing webhooks |
| `delete_hook` | Write | `DELETE /hooks/:hook_id` | returns `{success:true}` |
| `list_build_hooks` | Read | `GET /sites/:site_id/build_hooks` | build-hook trigger URLs |
| `create_build_hook` | Write | `POST /sites/:site_id/build_hooks` | body `{title, branch}` |
| `delete_build_hook` | Write | `DELETE /sites/:site_id/build_hooks/:hook_id` | returns `{success:true}` |
| `list_deploy_keys` | Read | `GET /deploy_keys` | SSH keys of the user |
| `create_deploy_key` | Write | `POST /deploy_keys` | generates a key pair, returns the public key |
| `list_forms` | Read | `GET /sites/:site_id/forms` | Netlify Forms |
| `list_form_submissions` | Read | `GET /forms/:form_id/submissions` | `page`, `per_page` query params |
| `delete_submission` | Write | `DELETE /submissions/:submission_id` | returns `{success:true}` |

## Deviations from upstream

1. **Auth gate per call.** Upstream checks `isAuthenticated()` once in
   `isReady()` (waiting up to 5s) before any tool can run; the adapter has no
   `isReady` hook, so the same check runs at the top of `api()`. A missing
   `_nf-auth-hint` cookie returns `error_code: 'UNAUTHENTICATED'` (repo
   convention) and makes no request. A 401/403 from the API is still `AUTH`.
2. **No `Accept` header.** Upstream sends only `Content-Type` on bodies; adding
   `Accept: application/json` would be an invention, so requests carry exactly
   the headers upstream sets.
3. **`204` / empty bodies.** The SDK's `fetchJSON` returns `undefined` for
   `204 No Content`; here the envelope is `{ok: true, data: {}}`, which the
   delete tools ignore (they return `{success: true}`). An unparseable 2xx body
   is `PARSE` instead of `validation`.
4. **Tolerant list unwrap.** `listOf()` accepts a bare array (what every
   upstream handler assumes) and, defensively, an `{items: [...]}` wrapper, so a
   BFF response-shape change degrades to the mapped list rather than throwing.
   No endpoint or field was invented for this.
5. **Abort deadline.** 18s `AbortController` instead of the SDK's
   `AbortSignal.timeout(30_000)`; an aborted call is `TIMEOUT`.
6. **Error text.** Upstream surfaces `fetchFromPage: HTTP <status> for <url>:
   <body>`; this port emits the same classification with a shorter
   per-category message (`Auth error (401): /sites/:id — …`,
   `Not found: …`, `Rate limited: … (retry after N)`). `error_code` is what maps
   to the SDK category.
7. Everything else — paths, methods, query keys, bodies, `encodeURIComponent`
   on env-var keys only, defaults, mappers and their `||`/`??` fallbacks — is a
   straight translation of `src/netlify-api.ts`, `src/tools/schemas.ts` and the
   40 `src/tools/*.ts` handlers.

## Verification

- `node scripts/fetch-opentabs.mjs` caches
  `@opentabs-dev/opentabs-plugin-netlify@0.0.88`; `npm test` compares tool
  names, counts, input properties and `required` lists against it.
- `scripts/tests/com.netlify.main.test.mjs` executes the ported runtime against
  a stubbed `app.netlify.com` page: sites (list/detail/create/update/delete),
  deploys (list/detail/restore/lock), `create_build`, env vars
  (list/get/create/update/delete), hooks, build hooks, forms, submissions, DNS,
  deploy keys, audit events, user/accounts, pagination, `urlRegex` both ways,
  auth (missing cookie → `UNAUTHENTICATED`, 401 → `AUTH`), `404`/`429`/`422`/`5xx`
  classification, wrong-host refusal and network failure.
- `node scripts/validate-package.mjs packages/com.netlify.main` passes.
