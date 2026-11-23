# OpenTabs → WebMCP porting status

Upstream: 118 `@opentabs-dev/opentabs-plugin-*` packages on npm.
**Done: 60 packages / 1480 tools (main `e91cd91`, harness 39436/39436 green).**
Remaining: 58.

## Completed

Batches 1–11 (39 packages): github, notion, linear, grafana, cloudflare, stripe,
slack, reddit, npm, clickup, hackernews, airtable, calendly, zendesk, docker-hub
+ 24 more. PRs #17–#25.

Batch A (PR #26, docs #27): sentry (21), newrelic (22), amplitude (15),
google-analytics (8).

Batch B (PR #28): google-cloud (30), azure (26), aws-console (16),
mongodb-atlas (20).

Batch B remainder (PR #30): snowflake (14), supabase (26), clickhouse (9),
cockroachdb (18), temporal-cloud (8), sqlpad (12).

Batch C (PR #31): figma (14), vercel (8), webflow (15), leetcode (26),
shortcut (27), hex (27), google-maps (16).

## Next up

D (office): outlook, onenote, teams, excel-online, microsoft-word.
E (finance): coinbase, robinhood, fidelity, carta, ynab.
F (social/content): youtube, youtube-music, spotify, twitch, medium, pinterest,
telegram, whatsapp, facebook, instagram, tiktok, steam, netflix.
G (e-commerce/travel/local): airbnb, booking, expedia, priceline, tripadvisor,
uber, doordash, instacart, chipotle, dominos, panda-express, starbucks, bestbuy,
costco, homedepot, target, walmart, ebay, craigslist, redfin, zillow, yelp,
tinder, fiverr, onlyfans.

## Skipped / caveats

- datadog: already on main from an earlier batch.
- Generator lives in `/tmp/webmcp-gen/gen_plugin.py` — NOT committed to the
  repo. Session fixes (getSessionStorage, globalThis auth cache for AWS
  credential survival, no-op log) will be lost when /tmp is wiped. Consider
  committing a copy under `scripts/` before the next batch.
