# OpenTabs → WebMCP porting status

Upstream: 118 `@opentabs-dev/opentabs-plugin-*` packages on npm.
**Done: 65 packages / 1584 tools — 50 on `main` (1230 tools), 15 on `extended`
(354 tools); harness 41566/41566 green.**
Remaining: 53.

Why the split: extension builds up to 1.2.x cap a registry manifest at 50 entries
(`MAX_REGISTRY_PACKAGES`) and fail the whole manifest above it, so `main` ships the
50-package catalog and the 15 infrastructure ports live on `extended` until a build
with the raised cap ships. See README "Why this branch lists 50 and not 65".

## Completed

Batches 1–11 (39 packages): github, notion, linear, grafana, cloudflare, stripe,
slack, reddit, npm, clickup, hackernews, airtable, calendly, zendesk, docker-hub
+ 24 more. PRs #17–#25.

Batch A (PR #26, docs #27): sentry (21), newrelic (22), amplitude (15),
google-analytics (8).

Batch B (PR #28): google-cloud (30), azure (26), aws-console (16),
mongodb-atlas (20).

Batch B remainder (PR #30, docs #29): snowflake (14), supabase (26),
clickhouse (9), cockroachdb (18), temporal-cloud (8), sqlpad (12) — 87 tools.

Batch C (PR #31, docs #33): figma (14), vercel (8), webflow (15),
leetcode (26), shortcut (27), hex (27), google-maps (16) — 133 tools.

Batch D (PR #34): outlook (24), onenote (12), teams (11),
excel-online (29), microsoft-word (28) — 104 tools.

## Next up

E (finance): coinbase, robinhood, fidelity, carta, ynab.
F (social/content): youtube, youtube-music, spotify, twitch, medium, pinterest,
telegram, whatsapp, facebook, instagram, tiktok, steam, netflix.
G (e-commerce/travel/local): airbnb, booking, expedia, priceline, tripadvisor,
uber, doordash, instacart, chipotle, dominos, panda-express, starbucks, bestbuy,
costco, homedepot, target, walmart, ebay, craigslist, redfin, zillow, yelp,
tinder, fiverr, onlyfans.

## Skipped / caveats

- datadog: already on main from an earlier batch.
- Generator lives in `scripts/porting/gen-plugin.py` (committed as of batch C).
  Session fixes now recorded in the committed generator:
  - **hex cross-module inlining** — `project-query` / `hex-authoring` /
    `hex-runtime` helpers are inlined into the importing module instead of
    emitting unresolved cross-module imports.
  - **shortcut auth-name aliasing** — the auth helper is emitted as
    `waitForShortcutAuth` where the upstream source aliases the import name.
  - **href value indirection** — `window['location'].href` reads are rewritten
    through a value-indirection helper so the extracted value flows correctly.
  - **SDK helpers `postJSON` + `querySelectorAll`** added to the emitted
    runtime.
  Earlier session fixes (getSessionStorage, globalThis auth cache for AWS
  credential survival, no-op log) are carried in the committed file.
