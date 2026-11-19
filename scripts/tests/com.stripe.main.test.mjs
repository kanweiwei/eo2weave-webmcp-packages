// Execution tests for com.stripe.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime speaks the dashboard's own Stripe proxy: same-origin
// /v1/* requests carrying the tab's PRELOADED session API key, merchant id,
// livemode flag and CSRF token, with form-encoded bodies for writes. Every test
// stubs the dashboard page (PRELOADED + fetch), asserts the exact request the
// workflow made and then asserts the mapped output.

const MERCHANT = {
  id: 'acct_1NtestAcct',
  business_name: 'Acme Inc',
  primary_email: 'ops@acme.test',
  country: 'US',
  default_currency: 'usd',
  business_type: 'company',
  timezone: 'America/New_York',
}

const SESSION_KEY = 'sk_test_51_session_api_key'
const CSRF = 'csrf_token_from_preloaded'

const CUSTOMER = {
  id: 'cus_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+15550100',
  description: 'Founding customer',
  currency: 'usd',
  balance: -1250,
  created: 1700000000,
  livemode: false,
  delinquent: true,
  metadata: { tier: 'pro', owner: 'sales' },
  // Expanded relations must flatten to ids.
  default_source: { id: 'card_1' },
}

const PRODUCT = {
  id: 'prod_1',
  name: 'Widget',
  description: 'A widget',
  active: true,
  created: 1700000100,
  livemode: false,
  default_price: { id: 'price_1' },
  metadata: { sku: 'W-1' },
}

const PRICE = {
  id: 'price_1',
  product: { id: 'prod_1' },
  active: true,
  currency: 'usd',
  unit_amount: 2500,
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 3 },
  billing_scheme: 'per_unit',
  created: 1700000200,
  livemode: false,
  metadata: {},
}

const PAYMENT_INTENT = {
  id: 'pi_1',
  amount: 2500,
  currency: 'usd',
  status: 'succeeded',
  customer: { id: 'cus_1' },
  description: 'Widget subscription',
  payment_method: 'pm_1',
  created: 1700000300,
  livemode: false,
  metadata: { order: '42' },
}

const INVOICE = {
  id: 'in_1',
  number: 'ACME-0001',
  customer: { id: 'cus_1' },
  status: 'draft',
  currency: 'usd',
  amount_due: 2500,
  amount_paid: 0,
  amount_remaining: 2500,
  total: 2500,
  due_date: 1700600000,
  created: 1700000400,
  livemode: false,
  hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
  metadata: {},
}

const SUBSCRIPTION = {
  id: 'sub_1',
  customer: { id: 'cus_1' },
  status: 'active',
  currency: 'usd',
  current_period_start: 1700000500,
  current_period_end: 1702592500,
  cancel_at_period_end: false,
  canceled_at: null,
  created: 1700000500,
  livemode: false,
  metadata: { plan: 'pro' },
}

const BALANCE = {
  available: [{ amount: 12345, currency: 'usd' }],
  pending: [{ amount: 678, currency: 'usd' }],
  livemode: false,
}

const BALANCE_TXN_CHARGE = {
  id: 'txn_1',
  amount: 2500,
  currency: 'usd',
  net: 2175,
  fee: 325,
  type: 'charge',
  status: 'available',
  description: 'Charge for prod_1',
  source: { id: 'ch_1' },
  created: 1700000600,
  available_on: 1700087000,
}

const BALANCE_TXN_REFUND = {
  id: 'txn_2',
  amount: -2500,
  currency: 'usd',
  net: -2500,
  fee: 0,
  type: 'refund',
  status: 'available',
  description: 'REFUND FOR CHARGE ch_1',
  source: 're_1',
  created: 1700000700,
  available_on: 1700087000,
}

const EVENT = {
  id: 'evt_1',
  type: 'customer.created',
  created: 1700000800,
  livemode: false,
  request: { id: 'req_1', idempotency_key: 'key-1' },
}

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
  async json() {
    return typeof payload === 'string' ? JSON.parse(payload) : payload
  },
})

const emptyResponse = (status = 204) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  async text() {
    return ''
  },
  async json() {
    throw new Error('no content')
  },
})

/**
 * A dashboard.stripe.com tab: PRELOADED bootstrap + a recording fetch.
 * `handler(url, init)` answers each request.
 */
function stripePage(handler, options = {}) {
  const requests = []
  const page = {
    hostname: options.hostname ?? 'dashboard.stripe.com',
    href: options.href ?? 'https://dashboard.stripe.com/acct_1NtestAcct/dashboard',
    globals: {},
    fetch: async (url, init) => {
      requests.push({ url, init })
      return handler(url, init)
    },
  }
  if (options.loggedOut) {
    page.globals.PRELOADED = {}
  } else {
    page.globals.PRELOADED = {
      merchant: options.merchant ?? MERCHANT,
      csrf_token: options.csrf ?? CSRF,
      session_api_key: options.apiKey ?? SESSION_KEY,
    }
  }
  page.globals.STRIPE_VERSION = options.version ?? '2025-06-30.basil'
  if (options.dropVersion) delete page.globals.STRIPE_VERSION
  return { requests, page }
}

/** Parse an x-www-form-urlencoded body into a plain object of raw pairs. */
function formPairs(body) {
  const out = []
  for (const part of String(body ?? '').split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    out.push([
      decodeURIComponent(part.slice(0, eq)),
      decodeURIComponent(part.slice(eq + 1)),
    ])
  }
  return out
}

function formBody(init) {
  const pairs = formPairs(init.body)
  return Object.fromEntries(pairs)
}

export default async function ({ ok, equal, section, runTool }) {
  const P = 'com.stripe.main'

  // --- reads: account, customers, products, prices -------------------------

  section('execution: stripe account and customer reads')

  {
    // get_account answers from the page bootstrap without any request.
    const { requests, page } = stripePage(() => jsonResponse({}))
    const result = await runTool(P, 'get_account', { input: {}, page })
    equal(result.status, 'ok', 'stripe get_account: status')
    equal(result.message, null, 'stripe get_account: null message on success')
    equal(result.data.id, 'acct_1NtestAcct', 'stripe get_account: account id')
    equal(result.data.business_name, 'Acme Inc', 'stripe get_account: business name')
    equal(result.data.email, 'ops@acme.test', 'stripe get_account: primary email mapped')
    equal(result.data.default_currency, 'usd', 'stripe get_account: default currency')
    equal(result.data.business_type, 'company', 'stripe get_account: business type')
    equal(result.data.timezone, 'America/New_York', 'stripe get_account: timezone')
    equal(result.data.livemode, true, 'stripe get_account: live mode outside /test/')
    equal(requests.length, 0, 'stripe get_account: makes no request')

    // A /test/ tab is test mode.
    const test = stripePage(() => jsonResponse({}), {
      href: 'https://dashboard.stripe.com/test/acct_1NtestAcct/dashboard',
    })
    const testResult = await runTool(P, 'get_account', { input: {}, page: test.page })
    equal(testResult.data.livemode, false, 'stripe get_account: test mode under /test/')
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ object: 'list', data: [CUSTOMER], has_more: true }),
    )
    const result = await runTool(P, 'list_customers', {
      input: { limit: 2, starting_after: 'cus_0', email: 'ada@example.com' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_customers: status')
    equal(result.data.customers.length, 1, 'stripe list_customers: result count')
    equal(result.data.has_more, true, 'stripe list_customers: has_more')
    equal(result.data.customers[0].id, 'cus_1', 'stripe list_customers: id')
    equal(result.data.customers[0].balance, -1250, 'stripe list_customers: negative balance kept')
    equal(result.data.customers[0].delinquent, true, 'stripe list_customers: delinquent flag')
    equal(result.data.customers[0].metadata.tier, 'pro', 'stripe list_customers: metadata')
    equal(
      requests[0].url,
      '/v1/customers?limit=2&starting_after=cus_0&email=ada%40example.com',
      'stripe list_customers: dashboard path and query',
    )
    equal(requests[0].init.method, 'GET', 'stripe list_customers: GET')
    equal(requests[0].init.credentials, 'include', 'stripe list_customers: sends credentials')
    equal(requests[0].init.body, undefined, 'stripe list_customers: GET has no body')
    equal(
      requests[0].init.headers.Authorization,
      'Bearer ' + SESSION_KEY,
      'stripe list_customers: session API key in the Authorization header',
    )
    equal(
      requests[0].init.headers['Stripe-Account'],
      'acct_1NtestAcct',
      'stripe list_customers: Stripe-Account header',
    )
    equal(
      requests[0].init.headers['Stripe-Livemode'],
      'true',
      'stripe list_customers: Stripe-Livemode header',
    )
    equal(
      requests[0].init.headers['x-stripe-csrf-token'],
      CSRF,
      'stripe list_customers: CSRF header',
    )
    equal(
      requests[0].init.headers['Stripe-Version'],
      '2025-06-30.basil',
      'stripe list_customers: page Stripe-Version',
    )
    equal(
      requests[0].init.headers['X-Requested-With'],
      'XMLHttpRequest',
      'stripe list_customers: XHR header',
    )
    equal(
      requests[0].init.headers['Content-Type'],
      'application/x-www-form-urlencoded',
      'stripe list_customers: form content type',
    )
    ok(
      !String(requests[0].url).includes(SESSION_KEY),
      'stripe list_customers: session key never in the URL',
    )

    // An omitted filter is dropped from the query string, not sent as "undefined".
    const bare = stripePage(() => jsonResponse({ data: [], has_more: false }))
    const bareResult = await runTool(P, 'list_customers', { input: {}, page: bare.page })
    equal(bareResult.status, 'ok', 'stripe list_customers bare: status')
    equal(bareResult.data.has_more, false, 'stripe list_customers bare: has_more default')
    equal(bare.requests[0].url, '/v1/customers', 'stripe list_customers bare: no query string')
  }

  {
    const { requests, page } = stripePage(() => jsonResponse(CUSTOMER))
    const result = await runTool(P, 'get_customer', {
      input: { customer_id: 'cus_1' },
      page,
    })
    equal(result.status, 'ok', 'stripe get_customer: status')
    equal(result.data.customer.name, 'Ada Lovelace', 'stripe get_customer: name')
    equal(result.data.customer.description, 'Founding customer', 'stripe get_customer: description')
    equal(requests[0].url, '/v1/customers/cus_1', 'stripe get_customer: by-id path')
    equal(requests[0].init.method, 'GET', 'stripe get_customer: GET')
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [CUSTOMER], has_more: false }),
    )
    const result = await runTool(P, 'search_customers', {
      input: { query: "email:'ada@example.com'", limit: 5 },
      page,
    })
    equal(result.status, 'ok', 'stripe search_customers: status')
    equal(result.data.customers[0].email, 'ada@example.com', 'stripe search_customers: email')
    equal(
      requests[0].url,
      '/v1/customers/search?query=email%3A' + '%27ada%40example.com%27&limit=5',
      'stripe search_customers: search endpoint with the encoded query',
    )
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [PRODUCT], has_more: false }),
    )
    const result = await runTool(P, 'list_products', {
      input: { limit: 10, active: true },
      page,
    })
    equal(result.status, 'ok', 'stripe list_products: status')
    equal(result.data.products[0].name, 'Widget', 'stripe list_products: name')
    equal(
      result.data.products[0].default_price,
      'price_1',
      'stripe list_products: expanded default_price flattened to an id',
    )
    equal(result.data.products[0].metadata.sku, 'W-1', 'stripe list_products: metadata')
    equal(
      requests[0].url,
      '/v1/products?limit=10&active=true',
      'stripe list_products: active filter as a string',
    )

    const one = stripePage(() => jsonResponse(PRODUCT))
    const got = await runTool(P, 'get_product', {
      input: { product_id: 'prod_1' },
      page: one.page,
    })
    equal(got.data.product.id, 'prod_1', 'stripe get_product: id')
    equal(got.data.product.active, true, 'stripe get_product: active flag')
    equal(one.requests[0].url, '/v1/products/prod_1', 'stripe get_product: by-id path')
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [PRICE], has_more: false }),
    )
    const result = await runTool(P, 'list_prices', {
      input: { product: 'prod_1', type: 'recurring' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_prices: status')
    equal(result.data.prices[0].unit_amount, 2500, 'stripe list_prices: unit amount')
    equal(result.data.prices[0].product, 'prod_1', 'stripe list_prices: product flattened')
    equal(result.data.prices[0].recurring_interval, 'month', 'stripe list_prices: interval')
    equal(
      result.data.prices[0].recurring_interval_count,
      3,
      'stripe list_prices: interval count',
    )
    equal(
      requests[0].url,
      '/v1/prices?product=prod_1&type=recurring',
      'stripe list_prices: product and type filters',
    )

    const one = stripePage(() => jsonResponse({ ...PRICE, type: 'one_time', recurring: null }))
    const got = await runTool(P, 'get_price', { input: { price_id: 'price_1' }, page: one.page })
    equal(got.data.price.id, 'price_1', 'stripe get_price: id')
    equal(got.data.price.recurring_interval, '', 'stripe get_price: no interval for one-time')
    equal(got.data.price.recurring_interval_count, 0, 'stripe get_price: interval count 0')
    equal(one.requests[0].url, '/v1/prices/price_1', 'stripe get_price: by-id path')
  }

  // --- reads: payments, invoices, subscriptions, balance, events -----------

  section('execution: stripe payment, invoice, subscription, balance and event reads')

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [PAYMENT_INTENT], has_more: false }),
    )
    const result = await runTool(P, 'list_payment_intents', {
      input: { limit: 3, customer: 'cus_1' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_payment_intents: status')
    equal(result.data.payment_intents[0].amount, 2500, 'stripe list_payment_intents: amount')
    equal(
      result.data.payment_intents[0].customer,
      'cus_1',
      'stripe list_payment_intents: expanded customer flattened',
    )
    equal(
      result.data.payment_intents[0].payment_method,
      'pm_1',
      'stripe list_payment_intents: payment method id',
    )
    equal(
      requests[0].url,
      '/v1/payment_intents?limit=3&customer=cus_1',
      'stripe list_payment_intents: customer filter',
    )

    const one = stripePage(() => jsonResponse(PAYMENT_INTENT))
    const got = await runTool(P, 'get_payment_intent', {
      input: { payment_intent_id: 'pi_1' },
      page: one.page,
    })
    equal(got.data.payment_intent.status, 'succeeded', 'stripe get_payment_intent: status')
    equal(one.requests[0].url, '/v1/payment_intents/pi_1', 'stripe get_payment_intent: path')

    const search = stripePage(() => jsonResponse({ data: [PAYMENT_INTENT], has_more: true }))
    const found = await runTool(P, 'search_payment_intents', {
      input: { query: "status:'succeeded'", limit: 1 },
      page: search.page,
    })
    equal(found.data.has_more, true, 'stripe search_payment_intents: has_more')
    equal(
      search.requests[0].url,
      '/v1/payment_intents/search?query=status%3A%27succeeded%27&limit=1',
      'stripe search_payment_intents: search endpoint',
    )
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [INVOICE], has_more: false }),
    )
    const result = await runTool(P, 'list_invoices', {
      input: { limit: 5, customer: 'cus_1', status: 'draft' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_invoices: status')
    equal(result.data.invoices[0].number, 'ACME-0001', 'stripe list_invoices: number')
    equal(
      result.data.invoices[0].amount_remaining,
      2500,
      'stripe list_invoices: amount remaining',
    )
    equal(
      result.data.invoices[0].hosted_invoice_url,
      'https://invoice.stripe.com/i/in_1',
      'stripe list_invoices: hosted url',
    )
    equal(
      requests[0].url,
      '/v1/invoices?limit=5&customer=cus_1&status=draft',
      'stripe list_invoices: filters',
    )

    const one = stripePage(() => jsonResponse(INVOICE))
    const got = await runTool(P, 'get_invoice', { input: { invoice_id: 'in_1' }, page: one.page })
    equal(got.data.invoice.id, 'in_1', 'stripe get_invoice: id')
    equal(one.requests[0].url, '/v1/invoices/in_1', 'stripe get_invoice: by-id path')

    const search = stripePage(() => jsonResponse({ data: [INVOICE], has_more: false }))
    const found = await runTool(P, 'search_invoices', {
      input: { query: 'total>5000' },
      page: search.page,
    })
    equal(found.data.invoices.length, 1, 'stripe search_invoices: result count')
    equal(
      search.requests[0].url,
      '/v1/invoices/search?query=total%3E5000',
      'stripe search_invoices: search endpoint',
    )
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [SUBSCRIPTION], has_more: false }),
    )
    const result = await runTool(P, 'list_subscriptions', {
      input: { limit: 10, customer: 'cus_1', status: 'active' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_subscriptions: status')
    equal(result.data.subscriptions[0].status, 'active', 'stripe list_subscriptions: status field')
    equal(
      result.data.subscriptions[0].current_period_end,
      1702592500,
      'stripe list_subscriptions: period end',
    )
    equal(
      result.data.subscriptions[0].canceled_at,
      null,
      'stripe list_subscriptions: null canceled_at preserved',
    )
    equal(
      requests[0].url,
      '/v1/subscriptions?limit=10&customer=cus_1&status=active',
      'stripe list_subscriptions: filters',
    )

    const one = stripePage(() => jsonResponse(SUBSCRIPTION))
    const got = await runTool(P, 'get_subscription', {
      input: { subscription_id: 'sub_1' },
      page: one.page,
    })
    equal(got.data.subscription.metadata.plan, 'pro', 'stripe get_subscription: metadata')
    equal(one.requests[0].url, '/v1/subscriptions/sub_1', 'stripe get_subscription: by-id path')

    const search = stripePage(() => jsonResponse({ data: [SUBSCRIPTION], has_more: false }))
    const found = await runTool(P, 'search_subscriptions', {
      input: { query: "customer:'cus_1'", limit: 2 },
      page: search.page,
    })
    equal(found.data.subscriptions[0].id, 'sub_1', 'stripe search_subscriptions: id')
    equal(
      search.requests[0].url,
      '/v1/subscriptions/search?query=customer%3A%27cus_1%27&limit=2',
      'stripe search_subscriptions: search endpoint',
    )
  }

  {
    // Balance plus the charge/refund ledger: the only charge/refund visibility
    // upstream exposes (there is no refund tool).
    const { requests, page } = stripePage(() => jsonResponse(BALANCE))
    const result = await runTool(P, 'get_balance', { input: {}, page })
    equal(result.status, 'ok', 'stripe get_balance: status')
    equal(result.data.balance.available[0].amount, 12345, 'stripe get_balance: available')
    equal(result.data.balance.pending[0].currency, 'usd', 'stripe get_balance: pending currency')
    equal(result.data.balance.livemode, false, 'stripe get_balance: livemode')
    equal(requests[0].url, '/v1/balance', 'stripe get_balance: balance endpoint')
    equal(requests[0].init.method, 'GET', 'stripe get_balance: GET')

    const ledger = stripePage(() =>
      jsonResponse({ data: [BALANCE_TXN_CHARGE, BALANCE_TXN_REFUND], has_more: true }),
    )
    const txns = await runTool(P, 'list_balance_transactions', {
      input: { limit: 2, type: 'charge' },
      page: ledger.page,
    })
    equal(txns.status, 'ok', 'stripe list_balance_transactions: status')
    equal(txns.data.transactions.length, 2, 'stripe list_balance_transactions: rows')
    equal(txns.data.transactions[0].net, 2175, 'stripe list_balance_transactions: net after fee')
    equal(txns.data.transactions[0].fee, 325, 'stripe list_balance_transactions: fee')
    equal(
      txns.data.transactions[0].source,
      'ch_1',
      'stripe list_balance_transactions: expanded source flattened',
    )
    equal(
      txns.data.transactions[1].type,
      'refund',
      'stripe list_balance_transactions: refund row type',
    )
    equal(txns.data.has_more, true, 'stripe list_balance_transactions: has_more')
    equal(
      ledger.requests[0].url,
      '/v1/balance_transactions?limit=2&type=charge',
      'stripe list_balance_transactions: type filter',
    )
  }

  {
    const { requests, page } = stripePage(() =>
      jsonResponse({ data: [EVENT], has_more: false }),
    )
    const result = await runTool(P, 'list_events', {
      input: { limit: 10, type: 'customer.created' },
      page,
    })
    equal(result.status, 'ok', 'stripe list_events: status')
    equal(result.data.events[0].type, 'customer.created', 'stripe list_events: event type')
    equal(
      result.data.events[0].request_id,
      'req_1',
      'stripe list_events: request id from request.id',
    )
    equal(
      requests[0].url,
      '/v1/events?limit=10&type=customer.created',
      'stripe list_events: type filter',
    )

    const one = stripePage(() => jsonResponse(EVENT))
    const got = await runTool(P, 'get_event', { input: { event_id: 'evt_1' }, page: one.page })
    equal(got.data.event.id, 'evt_1', 'stripe get_event: id')
    equal(one.requests[0].url, '/v1/events/evt_1', 'stripe get_event: by-id path')
  }

  // --- writes --------------------------------------------------------------

  section('execution: stripe writes (create, update, delete, invoice lifecycle)')

  {
    // create_customer: form POST, bracket-encoded metadata, omitted fields absent.
    const { requests, page } = stripePage(() => jsonResponse(CUSTOMER, 200))
    const result = await runTool(P, 'create_customer', {
      input: { name: 'Ada Lovelace', email: 'ada@example.com', metadata: { tier: 'pro' } },
      page,
    })
    equal(result.status, 'ok', 'stripe create_customer: status')
    equal(result.data.customer.id, 'cus_1', 'stripe create_customer: mapped id')
    equal(requests[0].url, '/v1/customers', 'stripe create_customer: collection path')
    equal(requests[0].init.method, 'POST', 'stripe create_customer: POST')
    equal(
      requests[0].init.body,
      'email=ada%40example.com&name=Ada%20Lovelace&metadata%5Btier%5D=pro',
      'stripe create_customer: form body with bracket metadata',
    )
    equal(
      requests[0].init.headers['Stripe-Livemode'],
      'true',
      'stripe create_customer: live-mode header',
    )

    // update_customer: POST (not PATCH) to the object path, supplied fields only.
    const update = stripePage(() => jsonResponse({ ...CUSTOMER, name: 'Ada King' }))
    const updated = await runTool(P, 'update_customer', {
      input: { customer_id: 'cus_1', name: 'Ada King' },
      page: update.page,
    })
    equal(updated.status, 'ok', 'stripe update_customer: status')
    equal(updated.data.customer.name, 'Ada King', 'stripe update_customer: new name')
    equal(update.requests[0].url, '/v1/customers/cus_1', 'stripe update_customer: object path')
    equal(update.requests[0].init.method, 'POST', 'stripe update_customer: dashboard uses POST')
    equal(update.requests[0].init.body, 'name=Ada%20King', 'stripe update_customer: only the name')
  }

  {
    // delete_customer: DELETE with no body; Stripe's 204 is a success, not an error.
    const { requests, page } = stripePage(() => emptyResponse(204))
    const result = await runTool(P, 'delete_customer', {
      input: { customer_id: 'cus_1' },
      page,
    })
    equal(result.status, 'ok', 'stripe delete_customer: status')
    equal(result.data.success, true, 'stripe delete_customer: success flag')
    equal(requests[0].url, '/v1/customers/cus_1', 'stripe delete_customer: object path')
    equal(requests[0].init.method, 'DELETE', 'stripe delete_customer: DELETE')
    equal(requests[0].init.body, undefined, 'stripe delete_customer: no body')

    // The API's own {deleted:true} body is also a success.
    const deleted = stripePage(() => jsonResponse({ id: 'cus_1', object: 'customer', deleted: true }))
    const again = await runTool(P, 'delete_customer', {
      input: { customer_id: 'cus_1' },
      page: deleted.page,
    })
    equal(again.data.success, true, 'stripe delete_customer: deleted body is a success')
  }

  {
    // create_product / update_product.
    const { requests, page } = stripePage(() => jsonResponse(PRODUCT))
    const result = await runTool(P, 'create_product', {
      input: { name: 'Widget', active: true, metadata: { sku: 'W-1' } },
      page,
    })
    equal(result.status, 'ok', 'stripe create_product: status')
    equal(result.data.product.id, 'prod_1', 'stripe create_product: id')
    equal(
      requests[0].init.body,
      'name=Widget&active=true&metadata%5Bsku%5D=W-1',
      'stripe create_product: form body',
    )
    equal(requests[0].url, '/v1/products', 'stripe create_product: collection path')

    const update = stripePage(() => jsonResponse({ ...PRODUCT, active: false }))
    const updated = await runTool(P, 'update_product', {
      input: { product_id: 'prod_1', active: false },
      page: update.page,
    })
    equal(updated.data.product.active, false, 'stripe update_product: active flag')
    equal(update.requests[0].url, '/v1/products/prod_1', 'stripe update_product: object path')
    equal(update.requests[0].init.method, 'POST', 'stripe update_product: POST')
    equal(update.requests[0].init.body, 'active=false', 'stripe update_product: only active')
  }

  {
    // create_price: the nested recurring object becomes bracket notation, and a
    // missing interval_count defaults to 1.
    const { requests, page } = stripePage(() => jsonResponse(PRICE))
    const result = await runTool(P, 'create_price', {
      input: {
        product: 'prod_1',
        unit_amount: 2500,
        currency: 'usd',
        recurring_interval: 'month',
      },
      page,
    })
    equal(result.status, 'ok', 'stripe create_price: status')
    equal(result.data.price.recurring_interval, 'month', 'stripe create_price: interval')
    equal(
      requests[0].init.body,
      'product=prod_1&unit_amount=2500&currency=usd&recurring%5Binterval%5D=month&recurring%5Binterval_count%5D=1',
      'stripe create_price: nested recurring body and default interval count',
    )
    equal(requests[0].url, '/v1/prices', 'stripe create_price: collection path')

    // One-time price: no recurring block at all.
    const oneTime = stripePage(() => jsonResponse({ ...PRICE, type: 'one_time', recurring: null }))
    await runTool(P, 'create_price', {
      input: { product: 'prod_1', unit_amount: 900, currency: 'eur' },
      page: oneTime.page,
    })
    equal(
      oneTime.requests[0].init.body,
      'product=prod_1&unit_amount=900&currency=eur',
      'stripe create_price: one-time price omits recurring',
    )
  }

  {
    // Invoice lifecycle: create (draft) → finalize → void, each a form POST.
    const create = stripePage(() => jsonResponse(INVOICE))
    const created = await runTool(P, 'create_invoice', {
      input: {
        customer: 'cus_1',
        collection_method: 'send_invoice',
        days_until_due: 30,
      },
      page: create.page,
    })
    equal(created.status, 'ok', 'stripe create_invoice: status')
    equal(created.data.invoice.status, 'draft', 'stripe create_invoice: draft status')
    equal(create.requests[0].url, '/v1/invoices', 'stripe create_invoice: collection path')
    equal(create.requests[0].init.method, 'POST', 'stripe create_invoice: POST')
    equal(
      create.requests[0].init.body,
      'customer=cus_1&collection_method=send_invoice&days_until_due=30',
      'stripe create_invoice: form body',
    )

    const finalize = stripePage(() => jsonResponse({ ...INVOICE, status: 'open' }))
    const finalized = await runTool(P, 'finalize_invoice', {
      input: { invoice_id: 'in_1' },
      page: finalize.page,
    })
    equal(finalized.status, 'ok', 'stripe finalize_invoice: status')
    equal(finalized.data.invoice.status, 'open', 'stripe finalize_invoice: open status')
    equal(
      finalize.requests[0].url,
      '/v1/invoices/in_1/finalize',
      'stripe finalize_invoice: finalize action path',
    )
    equal(finalize.requests[0].init.method, 'POST', 'stripe finalize_invoice: POST')
    equal(finalize.requests[0].init.body, '', 'stripe finalize_invoice: empty form body')

    const voided = stripePage(() => jsonResponse({ ...INVOICE, status: 'void' }))
    const voidResult = await runTool(P, 'void_invoice', {
      input: { invoice_id: 'in_1' },
      page: voided.page,
    })
    equal(voidResult.status, 'ok', 'stripe void_invoice: status')
    equal(voidResult.data.invoice.status, 'void', 'stripe void_invoice: void status')
    equal(
      voided.requests[0].url,
      '/v1/invoices/in_1/void',
      'stripe void_invoice: void action path',
    )
    equal(voided.requests[0].init.method, 'POST', 'stripe void_invoice: POST')
  }

  // --- auth, host and error paths ------------------------------------------

  section('execution: stripe auth and error paths')

  {
    // Logged-out tab: no PRELOADED session key, so nothing is requested.
    const { requests, page } = stripePage(() => jsonResponse({}), { loggedOut: true })
    const result = await runTool(P, 'list_customers', { input: {}, page })
    equal(result.status, 'error', 'stripe logged-out: error status')
    equal(result.error_code, 'UNAUTHENTICATED', 'stripe logged-out: UNAUTHENTICATED')
    equal(requests.length, 0, 'stripe logged-out: makes no request')
    ok(
      String(result.message).includes('log in'),
      'stripe logged-out: message asks the user to log in',
    )

    // A tab with the merchant but without the session API key is logged out too.
    const partial = stripePage(() => jsonResponse({}), { apiKey: '' })
    const partialResult = await runTool(P, 'get_balance', { input: {}, page: partial.page })
    equal(partialResult.error_code, 'UNAUTHENTICATED', 'stripe missing session key: UNAUTHENTICATED')
    equal(partial.requests.length, 0, 'stripe missing session key: makes no request')

    // 401 from the proxy is classified as AUTH and keeps Stripe's message.
    const denied = stripePage(() =>
      jsonResponse({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } }, 401),
    )
    const deniedResult = await runTool(P, 'get_customer', {
      input: { customer_id: 'cus_1' },
      page: denied.page,
    })
    equal(deniedResult.status, 'error', 'stripe 401: error status')
    equal(deniedResult.error_code, 'AUTH', 'stripe 401: AUTH')
    equal(deniedResult.data, null, 'stripe 401: no data')
    ok(
      String(deniedResult.message).includes('Invalid API Key provided'),
      'stripe 401: carries Stripe error.message',
    )
    equal(deniedResult.message.startsWith('Stripe API error (401)'), true, 'stripe 401: status code in message')

    // 403 is AUTH as well; 404 keeps its own classification.
    const forbidden = stripePage(() =>
      jsonResponse({ error: { message: 'You do not have permission' } }, 403),
    )
    const forbiddenResult = await runTool(P, 'get_balance', {
      input: {},
      page: forbidden.page,
    })
    equal(forbiddenResult.error_code, 'AUTH', 'stripe 403: AUTH')

    const missing = stripePage(() =>
      jsonResponse({ error: { type: 'invalid_request_error', message: 'No such customer: cus_x' } }, 404),
    )
    const missingResult = await runTool(P, 'get_customer', {
      input: { customer_id: 'cus_x' },
      page: missing.page,
    })
    equal(missingResult.error_code, 'NOT_FOUND', 'stripe 404: NOT_FOUND')

    const limited = stripePage(() => jsonResponse({ error: { message: 'Too many requests' } }, 429))
    const limitedResult = await runTool(P, 'list_customers', { input: {}, page: limited.page })
    equal(limitedResult.error_code, 'RATE_LIMITED', 'stripe 429: RATE_LIMITED')

    // A non-JSON 500 body still yields a readable HTTP error.
    const broken = stripePage(() => jsonResponse('<html>upstream error</html>', 500))
    const brokenResult = await runTool(P, 'list_products', { input: {}, page: broken.page })
    equal(brokenResult.error_code, 'HTTP', 'stripe 500 html: HTTP')
    ok(
      String(brokenResult.message).includes('upstream error'),
      'stripe 500 html: body excerpt in the message',
    )

    // A missing required id is a VALIDATION error, not /v1/undefined.
    const noRequest = stripePage(() => jsonResponse({}))
    const invalid = await runTool(P, 'get_customer', { input: {}, page: noRequest.page })
    equal(invalid.error_code, 'VALIDATION', 'stripe missing id: VALIDATION')
    equal(noRequest.requests.length, 0, 'stripe missing id: makes no request')

    // A tab on another host is refused before any request.
    const foreign = stripePage(() => jsonResponse({}), { hostname: 'stripe.com' })
    const foreignResult = await runTool(P, 'get_account', { input: {}, page: foreign.page })
    equal(foreignResult.error_code, 'UNSUPPORTED_PAGE', 'stripe wrong host: UNSUPPORTED_PAGE')
    equal(foreign.requests.length, 0, 'stripe wrong host: makes no request')
  }

  {
    // The Stripe-Version header falls back to the upstream baseline when the page
    // does not expose STRIPE_VERSION, and the JSON body is read once.
    const { requests, page } = stripePage(() => jsonResponse(CUSTOMER), { dropVersion: true })
    await runTool(P, 'get_customer', { input: { customer_id: 'cus_1' }, page })
    equal(
      requests[0].init.headers['Stripe-Version'],
      '2025-06-30.basil',
      'stripe version header: default version',
    )
  }

  // --- urlRegex: dashboard.stripe.com both ways ----------------------------

  section('urlRegex probe: dashboard.stripe.com')

  {
    const manifest = (await import('node:fs')).readFileSync(
      new URL(`../../packages/${P}/manifest.json`, import.meta.url),
      'utf8',
    )
    const parsed = JSON.parse(manifest)
    equal(parsed.tools.length, 30, 'stripe manifest: 30 tools')
    const mustMatch = [
      'https://dashboard.stripe.com/',
      'https://dashboard.stripe.com/acct_1NtestAcct/dashboard',
      'https://dashboard.stripe.com/test/acct_1NtestAcct/customers',
      'https://dashboard.stripe.com/acct_1NtestAcct/customers/cus_1?expand%5B%5D=default_source',
      'https://dashboard.stripe.com/acct_1NtestAcct/subscriptions?status=active#row-3',
    ]
    const mustNotMatch = [
      'http://dashboard.stripe.com/acct_1NtestAcct/dashboard',
      'https://dashboard.stripe.com.evil.example/acct/dashboard',
      'https://evildashboard.stripe.com/acct/dashboard',
      'https://dashboard.stripe.com:8443/acct/dashboard',
      'https://dashboard.stripe.com.evil.example/',
      'https://stripe.com/acct/dashboard',
      'https://api.stripe.com/v1/customers',
      'https://dashboard.stripe.community/acct/dashboard',
    ]
    for (const tool of parsed.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch)
        ok(regex.test(url), `stripe urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch)
        ok(!regex.test(url), `stripe urlRegex rejects ${url} (${tool.name})`)
    }
  }
}
