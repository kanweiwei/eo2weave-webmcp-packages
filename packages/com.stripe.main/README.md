# Stripe WebMCP package (com.stripe.main 0.1.0)

Full port of the OpenTabs Stripe plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/stripe) into the
builtin WebMCP package format: all 30 upstream tools, no subset.

Every call runs inside the `dashboard.stripe.com` tab. The dashboard proxies the
Stripe API at `/v1/*` and normally lets its service worker inject the session
credential; adapter-originated fetches add it explicitly, exactly like the
upstream transport:

- `Authorization: Bearer <PRELOADED.session_api_key>`
- `Stripe-Account: <PRELOADED.merchant.id>`
- `Stripe-Livemode: true|false`, derived from the tab path (`/test/…` = test mode)
- `Stripe-Version: window.STRIPE_VERSION` (falls back to `2025-06-30.basil`)
- `x-stripe-csrf-token: <PRELOADED.csrf_token>`
- `Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`,
  `X-Requested-With: XMLHttpRequest`
- `credentials: 'include'` on every request; writes are form-encoded with Stripe
  bracket notation for nested params (`metadata[key]=value`,
  `recurring[interval]=month`)

All four values are re-read from the page's `PRELOADED` bootstrap object on
every call and never leave page context, so an account or mode switch in a live
tab cannot reuse the previous session's key or CSRF token. A tab without
`PRELOADED.session_api_key` is reported as `UNAUTHENTICATED` before any request
is made. `get_account` reads `PRELOADED.merchant` and makes no fetch at all
(upstream behaviour), so it answers instantly.

Credentials travel only in request headers — never in the URL, the body or the
tool output.

## Tools

| Tool | Kind | Mechanics | Dashboard endpoint |
| --- | --- | --- | --- |
| `get_account` | read | page bootstrap only, no fetch | `PRELOADED.merchant` |
| `list_customers` | read | GET + `limit`/`starting_after`/`email` | `GET /v1/customers` |
| `get_customer` | read | GET by id | `GET /v1/customers/:id` |
| `create_customer` | **write** | form POST | `POST /v1/customers` |
| `update_customer` | **write** | form POST, supplied fields only | `POST /v1/customers/:id` |
| `delete_customer` | **write** | DELETE | `DELETE /v1/customers/:id` |
| `search_customers` | read | GET + Stripe search `query` | `GET /v1/customers/search` |
| `list_products` | read | GET + `limit`/`starting_after`/`active` | `GET /v1/products` |
| `get_product` | read | GET by id | `GET /v1/products/:id` |
| `create_product` | **write** | form POST | `POST /v1/products` |
| `update_product` | **write** | form POST, supplied fields only | `POST /v1/products/:id` |
| `list_prices` | read | GET + `product`/`active`/`type` | `GET /v1/prices` |
| `get_price` | read | GET by id | `GET /v1/prices/:id` |
| `create_price` | **write** | form POST + nested `recurring[…]` | `POST /v1/prices` |
| `list_payment_intents` | read | GET + `customer` filter | `GET /v1/payment_intents` |
| `get_payment_intent` | read | GET by id | `GET /v1/payment_intents/:id` |
| `search_payment_intents` | read | GET + Stripe search `query` | `GET /v1/payment_intents/search` |
| `list_invoices` | read | GET + `customer`/`status` | `GET /v1/invoices` |
| `get_invoice` | read | GET by id | `GET /v1/invoices/:id` |
| `create_invoice` | **write** | form POST (draft) | `POST /v1/invoices` |
| `finalize_invoice` | **write** | POST, empty body | `POST /v1/invoices/:id/finalize` |
| `void_invoice` | **write** | POST, empty body | `POST /v1/invoices/:id/void` |
| `search_invoices` | read | GET + Stripe search `query` | `GET /v1/invoices/search` |
| `list_subscriptions` | read | GET + `customer`/`status` | `GET /v1/subscriptions` |
| `get_subscription` | read | GET by id | `GET /v1/subscriptions/:id` |
| `search_subscriptions` | read | GET + Stripe search `query` | `GET /v1/subscriptions/search` |
| `get_balance` | read | GET | `GET /v1/balance` |
| `list_balance_transactions` | read | GET + `type` (charge, refund, payout…) | `GET /v1/balance_transactions` |
| `list_events` | read | GET + `type` filter | `GET /v1/events` |
| `get_event` | read | GET by id | `GET /v1/events/:id` |

Every response is mapped through the upstream `tools/schemas.ts` mappers, which
flatten expanded objects to ids (`customer.id` → `customer`,
`default_price.id` → `default_price`, `source.id` → `source`,
`request.id` → `request_id`) and default missing fields instead of dropping the
key.

## Errors

| `error_code` | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | no `PRELOADED.session_api_key`/`csrf_token` — the tab is logged out |
| `AUTH` | Stripe answered 401/403 |
| `NOT_FOUND` | Stripe answered 404 |
| `RATE_LIMITED` | Stripe answered 429 |
| `HTTP` | any other non-2xx (or a non-JSON body); message carries Stripe's `error.message` |
| `NETWORK` / `TIMEOUT` | fetch failed, or was aborted at the 18s in-page deadline |
| `VALIDATION` | a required input was missing |
| `UNSUPPORTED_PAGE` | the tab is not on `dashboard.stripe.com` |
| `INTERNAL` | `PRELOADED.merchant` absent on `get_account` (upstream behaviour) |
| `TAB_UNAVAILABLE` | the tab closed or navigated during the call |

The in-page fetch is aborted after 18s, before the 25s browser command deadline,
so a hung request cannot outlive the tool call.

## Not ported

The upstream plugin has no refund, payout or charge-mutation tool: refunds are
only visible as `list_balance_transactions` rows with `type: "refund"` and as
`list_events` entries. Nothing was added beyond the upstream tool set.
