// Self-contained adapter workflow. The Stripe Dashboard session (PRELOADED
// merchant id, session API key and CSRF token) and every /v1 fetch stay inside
// the dashboard.stripe.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Product name"
      },
      "description": {
        "description": "Product description",
        "type": "string"
      },
      "active": {
        "description": "Whether the product is available for purchase (default true)",
        "type": "boolean"
      },
      "metadata": {
        "description": "Arbitrary key-value metadata",
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {
          "type": "string"
        }
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
      },
      data: {
        type: ['object', 'null'],
      },
      message: {
        type: ['string', 'null'],
      },
      error_code: {
        type: ['string', 'null'],
      },
    },
    required: ['status', 'data'],
    additionalProperties: false,
  },
  tree: {
    type: 'action',
    description: 'create_product',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Stripe Dashboard runtime, translated from the OpenTabs stripe
          // plugin (stripe-api.ts + tools/*.ts + tools/schemas.ts, MIT). Runs INSIDE
          // the dashboard.stripe.com tab: the session API key and CSRF token are read
          // from the dashboard's own PRELOADED bootstrap object on every call and
          // never leave page context.
          function getPageGlobal(path) {
            try {
              var parts = path.split('.')
              var node = globalThis
              for (var i = 0; i < parts.length; i++) {
                if (node === null || node === undefined) return undefined
                node = node[parts[i]]
              }
              return node
            } catch (e) {
              return undefined
            }
          }
          // location.pathname is not always exposed to an eval'd page function, so
          // the path is derived from href when needed (test mode lives under /test/).
          function currentPath() {
            if (typeof location.pathname === 'string' && location.pathname)
              return location.pathname
            var href = location.href
            if (typeof href !== 'string') href = ''
            var origin = location.origin
            if (typeof origin !== 'string') origin = ''
            var rest = href
            if (origin && rest.indexOf(origin) === 0) rest = rest.slice(origin.length)
            var cut = rest.search(/[?#]/)
            if (cut !== -1) rest = rest.slice(0, cut)
            return rest || '/'
          }
          function isTestMode() {
            return currentPath().indexOf('/test/') !== -1
          }
          function getAuth() {
            // Re-read on every call, never cache: an account switch in a live tab
            // must not keep sending the previous account's session key or CSRF token.
            var merchant = getPageGlobal('PRELOADED.merchant')
            var csrfToken = getPageGlobal('PRELOADED.csrf_token')
            var sessionApiKey = getPageGlobal('PRELOADED.session_api_key')
            if (!merchant || !merchant.id || !csrfToken || !sessionApiKey) return null
            return {
              merchantId: merchant.id,
              csrfToken: csrfToken,
              sessionApiKey: sessionApiKey,
              livemode: !isTestMode(),
            }
          }
          function buildQueryString(query) {
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value !== undefined && value !== null)
                params.append(keys[i], String(value))
            }
            return params.toString()
          }
          // x-www-form-urlencoded with Stripe's bracket notation for nested params
          // (`metadata[key]=value`, `recurring[interval]=month`), exactly like the
          // upstream dashboard transport.
          function encodeBody(obj, prefix) {
            var parts = []
            var keys = Object.keys(obj || {})
            for (var i = 0; i < keys.length; i++) {
              var key = keys[i]
              var val = obj[key]
              if (val === undefined || val === null) continue
              var fullKey = prefix ? prefix + '[' + key + ']' : key
              if (Array.isArray(val)) {
                for (var j = 0; j < val.length; j++)
                  parts.push(
                    encodeURIComponent(fullKey + '[]') +
                      '=' +
                      encodeURIComponent(String(val[j])),
                  )
              } else if (typeof val === 'object') {
                var nested = encodeBody(val, fullKey)
                if (nested) parts.push(nested)
              } else {
                parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(String(val)))
              }
            }
            return parts.join('&')
          }
          // The dashboard proxies the Stripe API at /v1/* with the session API key
          // from PRELOADED.session_api_key. The dashboard service worker normally
          // injects it; adapter-originated fetches add it explicitly.
          async function api(endpoint, options) {
            options = options || {}
            var auth = getAuth()
            if (!auth)
              return error('UNAUTHENTICATED', 'Not authenticated — please log in to Stripe Dashboard.')
            var qs = options.query ? buildQueryString(options.query) : ''
            var url = qs ? '/v1' + endpoint + '?' + qs : '/v1' + endpoint
            var method = options.method || 'GET'
            var headers = {
              Accept: 'application/json',
              Authorization: 'Bearer ' + auth.sessionApiKey,
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              'Stripe-Account': auth.merchantId,
              'Stripe-Livemode': String(auth.livemode),
              'Stripe-Version': getPageGlobal('STRIPE_VERSION') || '2025-06-30.basil',
              'x-stripe-csrf-token': auth.csrfToken,
            }
            var init = { method: method, headers: headers, credentials: 'include' }
            if (options.body && method !== 'GET') init.body = encodeBody(options.body)
            // Abort the in-page fetch before the 25s browser command deadline can
            // orphan it, so a timed-out call does not leave the request running.
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var abortTimer =
              abortController !== null
                ? setTimeout(function () {
                    try {
                      abortController.abort()
                    } catch (e) {}
                  }, 18000)
                : null
            function clearTimer() {
              if (abortTimer !== null) clearTimeout(abortTimer)
            }
            if (abortController) init.signal = abortController.signal
            var response
            try {
              response = await fetch(url, init)
            } catch (e) {
              clearTimer()
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return error(
                aborted ? 'TIMEOUT' : 'NETWORK',
                aborted
                  ? 'Stripe API request aborted after the 18s in-page deadline.'
                  : 'Network error calling the Stripe API: ' + String(e),
              )
            }
            if (response.status === 204) {
              clearTimer()
              return { status: 'ok', data: {} }
            }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              clearTimer()
              var detail = ''
              try {
                var parsed = JSON.parse(text)
                detail =
                  (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || ''
                if (!detail && parsed && parsed.message) detail = parsed.message
              } catch (e) {}
              var code = 'HTTP'
              if (response.status === 401 || response.status === 403) code = 'AUTH'
              else if (response.status === 404) code = 'NOT_FOUND'
              else if (response.status === 429) code = 'RATE_LIMITED'
              return error(
                code,
                'Stripe API error (' + response.status + '): ' + (detail || String(text).slice(0, 512)),
              )
            }
            try {
              var data = await response.json()
              clearTimer()
              return { status: 'ok', data: data }
            } catch (e) {
              clearTimer()
              var abortedBody = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return error(
                abortedBody ? 'TIMEOUT' : 'HTTP',
                abortedBody
                  ? 'Stripe API response aborted after the 18s in-page deadline.'
                  : 'Stripe API returned invalid JSON',
              )
            }
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapCustomer(c) {
            c = c || {}
            return {
              id: c.id || '',
              name: c.name || '',
              email: c.email || '',
              phone: c.phone || '',
              description: c.description || '',
              currency: c.currency || '',
              balance: c.balance === undefined || c.balance === null ? 0 : c.balance,
              created: c.created === undefined || c.created === null ? 0 : c.created,
              livemode: c.livemode === undefined || c.livemode === null ? false : !!c.livemode,
              delinquent:
                c.delinquent === undefined || c.delinquent === null ? false : !!c.delinquent,
              metadata: c.metadata || {},
            }
          }
          function mapProduct(p) {
            p = p || {}
            var defaultPrice = p.default_price
            return {
              id: p.id || '',
              name: p.name || '',
              description: p.description || '',
              active: p.active === undefined || p.active === null ? false : !!p.active,
              created: p.created === undefined || p.created === null ? 0 : p.created,
              livemode: p.livemode === undefined || p.livemode === null ? false : !!p.livemode,
              default_price:
                typeof defaultPrice === 'string' ? defaultPrice : (defaultPrice && defaultPrice.id) || '',
              metadata: p.metadata || {},
            }
          }
          function mapPrice(p) {
            p = p || {}
            var product = p.product
            var recurring = p.recurring || {}
            return {
              id: p.id || '',
              product: typeof product === 'string' ? product : (product && product.id) || '',
              active: p.active === undefined || p.active === null ? false : !!p.active,
              currency: p.currency || '',
              unit_amount: p.unit_amount === undefined ? null : p.unit_amount,
              type: p.type || '',
              recurring_interval: recurring.interval || '',
              recurring_interval_count:
                recurring.interval_count === undefined || recurring.interval_count === null
                  ? 0
                  : recurring.interval_count,
              billing_scheme: p.billing_scheme || '',
              created: p.created === undefined || p.created === null ? 0 : p.created,
              livemode: p.livemode === undefined || p.livemode === null ? false : !!p.livemode,
              metadata: p.metadata || {},
            }
          }
          function mapPaymentIntent(pi) {
            pi = pi || {}
            var customer = pi.customer
            var paymentMethod = pi.payment_method
            return {
              id: pi.id || '',
              amount: pi.amount === undefined || pi.amount === null ? 0 : pi.amount,
              currency: pi.currency || '',
              status: pi.status || '',
              customer: typeof customer === 'string' ? customer : (customer && customer.id) || '',
              description: pi.description || '',
              payment_method:
                typeof paymentMethod === 'string' ? paymentMethod : (paymentMethod && paymentMethod.id) || '',
              created: pi.created === undefined || pi.created === null ? 0 : pi.created,
              livemode: pi.livemode === undefined || pi.livemode === null ? false : !!pi.livemode,
              metadata: pi.metadata || {},
            }
          }
          function mapInvoice(i) {
            i = i || {}
            var customer = i.customer
            return {
              id: i.id || '',
              number: i.number || '',
              customer: typeof customer === 'string' ? customer : (customer && customer.id) || '',
              status: i.status || '',
              currency: i.currency || '',
              amount_due: i.amount_due === undefined || i.amount_due === null ? 0 : i.amount_due,
              amount_paid: i.amount_paid === undefined || i.amount_paid === null ? 0 : i.amount_paid,
              amount_remaining:
                i.amount_remaining === undefined || i.amount_remaining === null ? 0 : i.amount_remaining,
              total: i.total === undefined || i.total === null ? 0 : i.total,
              due_date: i.due_date === undefined ? null : i.due_date,
              created: i.created === undefined || i.created === null ? 0 : i.created,
              livemode: i.livemode === undefined || i.livemode === null ? false : !!i.livemode,
              hosted_invoice_url: i.hosted_invoice_url || '',
              metadata: i.metadata || {},
            }
          }
          function mapSubscription(s) {
            s = s || {}
            var customer = s.customer
            return {
              id: s.id || '',
              customer: typeof customer === 'string' ? customer : (customer && customer.id) || '',
              status: s.status || '',
              currency: s.currency || '',
              current_period_start:
                s.current_period_start === undefined || s.current_period_start === null
                  ? 0
                  : s.current_period_start,
              current_period_end:
                s.current_period_end === undefined || s.current_period_end === null
                  ? 0
                  : s.current_period_end,
              cancel_at_period_end:
                s.cancel_at_period_end === undefined || s.cancel_at_period_end === null
                  ? false
                  : !!s.cancel_at_period_end,
              canceled_at: s.canceled_at === undefined ? null : s.canceled_at,
              created: s.created === undefined || s.created === null ? 0 : s.created,
              livemode: s.livemode === undefined || s.livemode === null ? false : !!s.livemode,
              metadata: s.metadata || {},
            }
          }
          function mapBalance(b) {
            b = b || {}
            return {
              available: (b.available || []).map(function (a) {
                a = a || {}
                return {
                  amount: a.amount === undefined || a.amount === null ? 0 : a.amount,
                  currency: a.currency || '',
                }
              }),
              pending: (b.pending || []).map(function (p) {
                p = p || {}
                return {
                  amount: p.amount === undefined || p.amount === null ? 0 : p.amount,
                  currency: p.currency || '',
                }
              }),
              livemode: b.livemode === undefined || b.livemode === null ? false : !!b.livemode,
            }
          }
          function mapBalanceTransaction(bt) {
            bt = bt || {}
            var source = bt.source
            return {
              id: bt.id || '',
              amount: bt.amount === undefined || bt.amount === null ? 0 : bt.amount,
              currency: bt.currency || '',
              net: bt.net === undefined || bt.net === null ? 0 : bt.net,
              fee: bt.fee === undefined || bt.fee === null ? 0 : bt.fee,
              type: bt.type || '',
              status: bt.status || '',
              description: bt.description || '',
              source: typeof source === 'string' ? source : (source && source.id) || '',
              created: bt.created === undefined || bt.created === null ? 0 : bt.created,
              available_on:
                bt.available_on === undefined || bt.available_on === null ? 0 : bt.available_on,
            }
          }
          function mapEvent(e) {
            e = e || {}
            return {
              id: e.id || '',
              type: e.type || '',
              created: e.created === undefined || e.created === null ? 0 : e.created,
              livemode: e.livemode === undefined || e.livemode === null ? false : !!e.livemode,
              request_id: (e.request && e.request.id) || '',
            }
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return {
              status: 'error',
              data: null,
              error_code: code,
              message: message,
              page_url: location.href,
            }
          }
          function assertPage() {
            if (location.hostname !== 'dashboard.stripe.com')
              return error('UNSUPPORTED_PAGE', 'Not on a dashboard.stripe.com page.')
            return null
          }
          // The upstream tools validate their zod input before the handler runs;
          // required ids are checked here so a missing one is a VALIDATION error
          // rather than a request to /v1/undefined.
          function requireId(value, name) {
            if (typeof value !== 'string' || !value.trim())
              return error('VALIDATION', name + ' is required')
            return null
          }

          var stripeToolImplementations = {
            async get_account(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var merchant = getPageGlobal('PRELOADED.merchant')
              if (!merchant) return error('INTERNAL', 'Account data not available')
              return ok({
                id: merchant.id || '',
                business_name: merchant.business_name || '',
                email: merchant.primary_email || '',
                country: merchant.country || '',
                default_currency: merchant.default_currency || '',
                business_type: merchant.business_type || '',
                livemode: !isTestMode(),
                timezone: merchant.timezone || '',
              })
            },
            async list_customers(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/customers', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  email: args.email,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                customers: (data.data || []).map(mapCustomer),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_customer(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.customer_id, 'customer_id')
              if (missing) return missing
              var res = await api('/customers/' + args.customer_id)
              if (res.status === 'error') return res
              return ok({ customer: mapCustomer(res.data) })
            },
            async create_customer(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var body = {}
              if (args.email !== undefined) body.email = args.email
              if (args.name !== undefined) body.name = args.name
              if (args.phone !== undefined) body.phone = args.phone
              if (args.description !== undefined) body.description = args.description
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/customers', { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ customer: mapCustomer(res.data) })
            },
            async update_customer(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.customer_id, 'customer_id')
              if (missing) return missing
              var body = {}
              if (args.email !== undefined) body.email = args.email
              if (args.name !== undefined) body.name = args.name
              if (args.phone !== undefined) body.phone = args.phone
              if (args.description !== undefined) body.description = args.description
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/customers/' + args.customer_id, { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ customer: mapCustomer(res.data) })
            },
            async delete_customer(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.customer_id, 'customer_id')
              if (missing) return missing
              var res = await api('/customers/' + args.customer_id, { method: 'DELETE' })
              if (res.status === 'error') return res
              return ok({ success: true })
            },
            async search_customers(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.query, 'query')
              if (missing) return missing
              var res = await api('/customers/search', {
                query: { query: args.query, limit: args.limit },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                customers: (data.data || []).map(mapCustomer),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async list_products(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/products', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  active: args.active,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                products: (data.data || []).map(mapProduct),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_product(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.product_id, 'product_id')
              if (missing) return missing
              var res = await api('/products/' + args.product_id)
              if (res.status === 'error') return res
              return ok({ product: mapProduct(res.data) })
            },
            async create_product(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              if (typeof args.name !== 'string' || !args.name.trim())
                return error('VALIDATION', 'name is required')
              var body = { name: args.name }
              if (args.description !== undefined) body.description = args.description
              if (args.active !== undefined) body.active = args.active
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/products', { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ product: mapProduct(res.data) })
            },
            async update_product(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.product_id, 'product_id')
              if (missing) return missing
              var body = {}
              if (args.name !== undefined) body.name = args.name
              if (args.description !== undefined) body.description = args.description
              if (args.active !== undefined) body.active = args.active
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/products/' + args.product_id, { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ product: mapProduct(res.data) })
            },
            async list_prices(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/prices', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  product: args.product,
                  active: args.active,
                  type: args.type,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                prices: (data.data || []).map(mapPrice),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_price(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.price_id, 'price_id')
              if (missing) return missing
              var res = await api('/prices/' + args.price_id)
              if (res.status === 'error') return res
              return ok({ price: mapPrice(res.data) })
            },
            async create_price(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.product, 'product')
              if (missing) return missing
              if (typeof args.currency !== 'string' || !args.currency.trim())
                return error('VALIDATION', 'currency is required')
              if (typeof args.unit_amount !== 'number')
                return error('VALIDATION', 'unit_amount is required')
              var body = {
                product: args.product,
                unit_amount: args.unit_amount,
                currency: args.currency,
              }
              if (args.recurring_interval !== undefined) {
                body.recurring = {
                  interval: args.recurring_interval,
                  interval_count:
                    args.recurring_interval_count === undefined
                      ? 1
                      : args.recurring_interval_count,
                }
              }
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/prices', { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ price: mapPrice(res.data) })
            },
            async list_payment_intents(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/payment_intents', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  customer: args.customer,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                payment_intents: (data.data || []).map(mapPaymentIntent),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_payment_intent(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.payment_intent_id, 'payment_intent_id')
              if (missing) return missing
              var res = await api('/payment_intents/' + args.payment_intent_id)
              if (res.status === 'error') return res
              return ok({ payment_intent: mapPaymentIntent(res.data) })
            },
            async search_payment_intents(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.query, 'query')
              if (missing) return missing
              var res = await api('/payment_intents/search', {
                query: { query: args.query, limit: args.limit },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                payment_intents: (data.data || []).map(mapPaymentIntent),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async list_invoices(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/invoices', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  customer: args.customer,
                  status: args.status,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                invoices: (data.data || []).map(mapInvoice),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_invoice(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.invoice_id, 'invoice_id')
              if (missing) return missing
              var res = await api('/invoices/' + args.invoice_id)
              if (res.status === 'error') return res
              return ok({ invoice: mapInvoice(res.data) })
            },
            async create_invoice(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.customer, 'customer')
              if (missing) return missing
              var body = { customer: args.customer }
              if (args.description !== undefined) body.description = args.description
              if (args.collection_method !== undefined)
                body.collection_method = args.collection_method
              if (args.days_until_due !== undefined) body.days_until_due = args.days_until_due
              if (args.metadata !== undefined) body.metadata = args.metadata
              var res = await api('/invoices', { method: 'POST', body: body })
              if (res.status === 'error') return res
              return ok({ invoice: mapInvoice(res.data) })
            },
            async finalize_invoice(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.invoice_id, 'invoice_id')
              if (missing) return missing
              var res = await api('/invoices/' + args.invoice_id + '/finalize', {
                method: 'POST',
                body: {},
              })
              if (res.status === 'error') return res
              return ok({ invoice: mapInvoice(res.data) })
            },
            async void_invoice(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.invoice_id, 'invoice_id')
              if (missing) return missing
              var res = await api('/invoices/' + args.invoice_id + '/void', {
                method: 'POST',
                body: {},
              })
              if (res.status === 'error') return res
              return ok({ invoice: mapInvoice(res.data) })
            },
            async search_invoices(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.query, 'query')
              if (missing) return missing
              var res = await api('/invoices/search', {
                query: { query: args.query, limit: args.limit },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                invoices: (data.data || []).map(mapInvoice),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async list_subscriptions(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/subscriptions', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  customer: args.customer,
                  status: args.status,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                subscriptions: (data.data || []).map(mapSubscription),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_subscription(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.subscription_id, 'subscription_id')
              if (missing) return missing
              var res = await api('/subscriptions/' + args.subscription_id)
              if (res.status === 'error') return res
              return ok({ subscription: mapSubscription(res.data) })
            },
            async search_subscriptions(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.query, 'query')
              if (missing) return missing
              var res = await api('/subscriptions/search', {
                query: { query: args.query, limit: args.limit },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                subscriptions: (data.data || []).map(mapSubscription),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_balance(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/balance')
              if (res.status === 'error') return res
              return ok({ balance: mapBalance(res.data) })
            },
            async list_balance_transactions(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/balance_transactions', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  type: args.type,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                transactions: (data.data || []).map(mapBalanceTransaction),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async list_events(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/events', {
                query: {
                  limit: args.limit,
                  starting_after: args.starting_after,
                  type: args.type,
                },
              })
              if (res.status === 'error') return res
              var data = res.data || {}
              return ok({
                events: (data.data || []).map(mapEvent),
                has_more: data.has_more === undefined ? false : !!data.has_more,
              })
            },
            async get_event(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var missing = requireId(args.event_id, 'event_id')
              if (missing) return missing
              var res = await api('/events/' + args.event_id)
              if (res.status === 'error') return res
              return ok({ event: mapEvent(res.data) })
            },
          }

          async function stdin_default(args) {
            return stripeToolImplementations['create_product'](args)
          }
          return stdin_default
        })()

        return workflow(args)
      }
      let response
      try {
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(input) + ')',
          options,
        )
      } catch (error) {
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The dashboard.stripe.com tab could not run the tool (it may have closed or navigated away): ' +
            String(error),
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      if (response.tabId !== target.tabId) {
        state.result = {
          status: 'error',
          data: null,
          message: 'Browser returned another tab',
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      const result = response.result
      if (result && result.status === 'ok')
        state.result = { status: 'ok', data: result.data, message: null }
      else if (result)
        state.result = {
          status: 'error',
          data: null,
          message: result.message || 'Stripe API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The dashboard.stripe.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
