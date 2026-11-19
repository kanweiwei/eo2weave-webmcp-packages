// Self-contained adapter workflow for Twilio Console (com.twilio.main).
//
// Ported from the OpenTabs twilio plugin (plugins/twilio/src, MIT): same
// endpoints, same query strings, same form bodies, same output mappers.
// Runs inside the current console.twilio.com tab: the Console session bootstraps
// the account SID + auth token from /console/api/v2/projects/info (cookie auth),
// then every REST call is the real api.twilio.com / messaging / verify / monitor
// request with Basic auth. Nothing is lifted out of the page.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "friendly_name": {
        "type": "string",
        "description": "Friendly name for the verify service"
      },
      "code_length": {
        "description": "Length of the verification code (default 6, range 4-10)",
        "type": "integer",
        "minimum": 4,
        "maximum": 10
      }
    },
    "required": [
      "friendly_name"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "status": {
        "type": "string"
      },
      "data": {
        "type": [
          "object",
          "null"
        ]
      },
      "message": {
        "type": [
          "string",
          "null"
        ]
      },
      "error_code": {
        "type": [
          "string",
          "null"
        ]
      }
    },
    "required": [
      "status",
      "data"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: "create_verify_service",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        // --- page runtime ---------------------------------------------------
        // Ported from the OpenTabs twilio plugin (plugins/twilio/src, MIT).
        // Runs INSIDE the console.twilio.com tab. The account SID + auth token
        // are bootstrapped from the Console's own project-info endpoint (same
        // session cookie) and never leave page context; every REST call is the
        // real api.twilio.com / <product>.twilio.com request with Basic auth.
        var DEFAULT_TIMEOUT_MS = 18000
        var MAX_ERROR_BODY_LENGTH = 512

        function ToolError(message, code, opts) {
          this.name = 'ToolError'
          this.message = message
          this.code = code
          this.retryable = !!(opts && opts.retryable)
          this.category = opts && opts.category
        }
        ToolError.prototype = Object.create(Error.prototype)
        ToolError.prototype.constructor = ToolError
        ToolError.auth = function (message) {
          return new ToolError(message, 'AUTH_ERROR', { category: 'auth' })
        }
        ToolError.notFound = function (message) {
          return new ToolError(message, 'NOT_FOUND', { category: 'not_found' })
        }
        ToolError.rateLimited = function (message) {
          return new ToolError(message, 'RATE_LIMITED', { category: 'rate_limit', retryable: true })
        }
        ToolError.validation = function (message) {
          return new ToolError(message, 'VALIDATION_ERROR', { category: 'validation' })
        }
        ToolError.timeout = function (message) {
          return new ToolError(message, 'TIMEOUT', { category: 'timeout', retryable: true })
        }

        function ok(data) {
          return { status: 'ok', data: data, message: null }
        }
        function error(code, message) {
          return { status: 'error', data: null, error_code: code, message: message }
        }
        function assertPage() {
          var host = ''
          try {
            host = String(location.hostname || '')
          } catch (e) {
            host = ''
          }
          if (!/(^|\.)console\.twilio\.com$/.test(host))
            return error('UNSUPPORTED_PAGE', 'Not on a console.twilio.com page.')
          return null
        }

        function buildQueryString(query) {
          var params = new URLSearchParams()
          var keys = Object.keys(query || {})
          for (var i = 0; i < keys.length; i++) {
            var value = query[keys[i]]
            if (value === undefined || value === null) continue
            params.append(keys[i], String(value))
          }
          return params.toString()
        }

        // --- auth -----------------------------------------------------------
        var cachedAuth = null

        function getCachedAuth() {
          if (cachedAuth && cachedAuth.accountSid && cachedAuth.authToken) return cachedAuth
          return null
        }

        async function fetchProjectInfo() {
          var response
          try {
            response = await fetch('https://www.twilio.com/console/api/v2/projects/info', {
              method: 'GET',
              credentials: 'include',
            })
          } catch (e) {
            return null
          }
          if (!response || !response.ok) return null
          var data
          try {
            data = await response.json()
          } catch (e) {
            return null
          }
          if (data && data.projectSid && data.authToken) {
            return { accountSid: data.projectSid, authToken: data.authToken }
          }
          return null
        }

        async function ensureAuth() {
          var cached = getCachedAuth()
          if (cached) return cached
          var auth = await fetchProjectInfo()
          if (auth) {
            cachedAuth = auth
            return auth
          }
          throw ToolError.auth('Not authenticated \u2014 please log in to Twilio Console.')
        }

        function base64Encode(value) {
          // Basic auth over "SID:token" is ASCII; encode without relying on the
          // page's btoa (the adapter sandbox and some frames do not expose it).
          var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
          var bytes = []
          for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i)
            if (code < 128) bytes.push(code)
            else if (code < 2048) {
              bytes.push(192 | (code >> 6), 128 | (code & 63))
            } else {
              bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63))
            }
          }
          var out = ''
          for (var j = 0; j < bytes.length; j += 3) {
            var b0 = bytes[j]
            var b1 = j + 1 < bytes.length ? bytes[j + 1] : -1
            var b2 = j + 2 < bytes.length ? bytes[j + 2] : -1
            out += chars.charAt(b0 >> 2)
            out += chars.charAt(((b0 & 3) << 4) | (b1 === -1 ? 0 : b1 >> 4))
            out += b1 === -1 ? '=' : chars.charAt(((b1 & 15) << 2) | (b2 === -1 ? 0 : b2 >> 6))
            out += b2 === -1 ? '=' : chars.charAt(b2 & 63)
          }
          return out
        }

        function buildBasicAuth(auth) {
          return base64Encode(auth.accountSid + ':' + auth.authToken)
        }

        // --- transport ------------------------------------------------------
        function parseRetryAfterMs(value) {
          var seconds = Number(value)
          if (!isNaN(seconds) && seconds >= 0) return seconds * 1000
          return undefined
        }

        async function fetchJSON(url, init) {
          init = init || {}
          var timeout = init.timeout || DEFAULT_TIMEOUT_MS
          var controller = null
          if (typeof AbortController === 'function') {
            try {
              controller = new AbortController()
            } catch (e) {
              controller = null
            }
          }
          var timer =
            controller !== null
              ? setTimeout(function () {
                  try {
                    controller.abort()
                  } catch (e) {}
                }, timeout)
              : null
          if (controller !== null) init.signal = controller.signal

          var response
          try {
            response = await fetch(url, init)
          } catch (e) {
            if (timer !== null) clearTimeout(timer)
            var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
            if (aborted) throw ToolError.timeout('Twilio API request timed out after ' + timeout + 'ms for ' + url)
            throw new ToolError('Network error calling the Twilio API for ' + url + ': ' + String(e), 'network_error', {
              category: 'internal',
              retryable: true,
            })
          }
          if (timer !== null) clearTimeout(timer)

          if (response.status === 204) return {}

          if (!response.ok) {
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            var errorText = text.length > MAX_ERROR_BODY_LENGTH ? text.slice(0, MAX_ERROR_BODY_LENGTH) + '\u2026' : text
            var detail = ''
            try {
              var parsed = JSON.parse(text)
              detail = (parsed && (parsed.message || parsed.detail)) || ''
            } catch (e) {}
            var message =
              'Twilio API error (' + response.status + ') for ' + url + ': ' + (detail || errorText)
            if (response.status === 401 || response.status === 403) throw ToolError.auth(message)
            if (response.status === 404) throw ToolError.notFound(message)
            if (response.status === 429) {
              var retryAfter = response.headers && typeof response.headers.get === 'function' ? response.headers.get('Retry-After') : null
              throw ToolError.rateLimited(message, retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined)
            }
            if (response.status === 400 || response.status === 422) throw ToolError.validation(message)
            if (response.status === 408) throw ToolError.timeout(message)
            throw new ToolError(message, 'http_error', {
              category: 'internal',
              retryable:
                response.status === 500 ||
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504,
            })
          }

          try {
            return await response.json()
          } catch (e) {
            throw ToolError.validation('Twilio API returned invalid JSON for ' + url)
          }
        }

        /**
         * Call the Twilio REST API (api.twilio.com) with Basic auth.
         * Twilio POST/PUT bodies are application/x-www-form-urlencoded.
         */
        async function api(endpoint, options) {
          options = options || {}
          var auth = await ensureAuth()
          var method = options.method || 'GET'
          var baseUrl = options.baseUrl || 'https://api.twilio.com/2010-04-01/Accounts/' + auth.accountSid
          var qs = options.query ? buildQueryString(options.query) : ''
          var url = qs ? baseUrl + endpoint + '?' + qs : baseUrl + endpoint

          var headers = { Authorization: 'Basic ' + buildBasicAuth(auth) }
          var init = { method: method, headers: headers, credentials: 'omit' }

          if (options.body && method !== 'GET') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            init.body = new URLSearchParams(options.body).toString()
          }

          return fetchJSON(url, init)
        }

        // Sub-product APIs (messaging, verify, monitor) share the transport.
        async function subApi(baseUrl, endpoint, options) {
          var merged = { method: options && options.method, body: options && options.body, query: options && options.query, baseUrl: baseUrl }
          return api(endpoint, merged)
        }

        // --- mappers (OpenTabs tools/schemas.ts) -----------------------------
        function mapAccount(a) {
          a = a || {}
          return {
            sid: a.sid || '',
            friendly_name: a.friendly_name || '',
            status: a.status || '',
            type: a.type || '',
            date_created: a.date_created || '',
            date_updated: a.date_updated || '',
            owner_account_sid: a.owner_account_sid || '',
          }
        }
        function mapBalance(b) {
          b = b || {}
          return {
            account_sid: b.account_sid || '',
            balance: b.balance === undefined || b.balance === null ? '0' : b.balance,
            currency: b.currency || 'USD',
          }
        }
        function mapCapabilities(c) {
          c = c || {}
          return { voice: !!c.voice, sms: !!c.sms, mms: !!c.mms, fax: !!c.fax }
        }
        function mapPhoneNumber(n) {
          n = n || {}
          return {
            sid: n.sid || '',
            phone_number: n.phone_number || '',
            friendly_name: n.friendly_name || '',
            capabilities: mapCapabilities(n.capabilities),
            status: n.status || '',
            voice_url: n.voice_url || '',
            voice_method: n.voice_method || '',
            sms_url: n.sms_url || '',
            sms_method: n.sms_method || '',
            status_callback: n.status_callback || '',
            date_created: n.date_created || '',
          }
        }
        function mapAvailableNumber(n) {
          n = n || {}
          return {
            phone_number: n.phone_number || '',
            friendly_name: n.friendly_name || '',
            locality: n.locality || '',
            region: n.region || '',
            iso_country: n.iso_country || '',
            capabilities: mapCapabilities(n.capabilities),
            address_requirements: n.address_requirements || 'none',
          }
        }
        function mapCallerId(c) {
          c = c || {}
          return {
            sid: c.sid || '',
            phone_number: c.phone_number || '',
            friendly_name: c.friendly_name || '',
            date_created: c.date_created || '',
            date_updated: c.date_updated || '',
          }
        }
        function mapMessage(m) {
          m = m || {}
          return {
            sid: m.sid || '',
            from: m.from || '',
            to: m.to || '',
            body: m.body || '',
            status: m.status || '',
            direction: m.direction || '',
            price: m.price === undefined || m.price === null ? '0' : m.price,
            price_unit: m.price_unit || 'USD',
            num_segments: m.num_segments || '0',
            date_created: m.date_created || '',
            date_sent: m.date_sent === undefined || m.date_sent === null ? '' : m.date_sent,
            error_code: m.error_code === undefined ? null : m.error_code,
            error_message: m.error_message === undefined || m.error_message === null ? '' : m.error_message,
          }
        }
        function mapCall(c) {
          c = c || {}
          return {
            sid: c.sid || '',
            from: c.from || '',
            to: c.to || '',
            status: c.status || '',
            direction: c.direction || '',
            duration: c.duration === undefined || c.duration === null ? '0' : c.duration,
            price: c.price === undefined || c.price === null ? '0' : c.price,
            price_unit: c.price_unit || 'USD',
            start_time: c.start_time === undefined || c.start_time === null ? '' : c.start_time,
            end_time: c.end_time === undefined || c.end_time === null ? '' : c.end_time,
            date_created: c.date_created || '',
          }
        }
        function mapRecording(r) {
          r = r || {}
          return {
            sid: r.sid || '',
            call_sid: r.call_sid || '',
            duration: r.duration || '0',
            channels: r.channels === undefined ? 1 : r.channels,
            source: r.source || '',
            status: r.status || '',
            price: r.price === undefined || r.price === null ? '0' : r.price,
            price_unit: r.price_unit || 'USD',
            date_created: r.date_created || '',
          }
        }
        function mapUsageRecord(u) {
          u = u || {}
          return {
            category: u.category || '',
            description: u.description || '',
            count: u.count || '0',
            count_unit: u.count_unit || '',
            usage: u.usage || '0',
            usage_unit: u.usage_unit || '',
            price: u.price || '0',
            price_unit: u.price_unit || 'USD',
            start_date: u.start_date || '',
            end_date: u.end_date || '',
          }
        }
        function mapUsageTrigger(t) {
          t = t || {}
          return {
            sid: t.sid || '',
            friendly_name: t.friendly_name || '',
            usage_category: t.usage_category || '',
            trigger_value: t.trigger_value || '',
            current_value: t.current_value || '',
            recurring: t.recurring || '',
            callback_url: t.callback_url || '',
            date_created: t.date_created || '',
          }
        }
        function mapMessagingService(s) {
          s = s || {}
          return {
            sid: s.sid || '',
            friendly_name: s.friendly_name || '',
            inbound_request_url: s.inbound_request_url || '',
            inbound_method: s.inbound_method || 'POST',
            fallback_url: s.fallback_url || '',
            status_callback: s.status_callback || '',
            sticky_sender: !!s.sticky_sender,
            smart_encoding: !!s.smart_encoding,
            area_code_geomatch: !!s.area_code_geomatch,
            validity_period: s.validity_period === undefined ? 14400 : s.validity_period,
            date_created: s.date_created || '',
            date_updated: s.date_updated || '',
          }
        }
        function mapVerifyService(s) {
          s = s || {}
          return {
            sid: s.sid || '',
            friendly_name: s.friendly_name || '',
            code_length: s.code_length === undefined ? 6 : s.code_length,
            lookup_enabled: !!s.lookup_enabled,
            do_not_share_warning_enabled: !!s.do_not_share_warning_enabled,
            push_enabled: !!s.push_enabled,
            totp_enabled: !!s.totp_enabled,
            date_created: s.date_created || '',
            date_updated: s.date_updated || '',
          }
        }
        function mapAlert(a) {
          a = a || {}
          return {
            sid: a.sid || '',
            error_code: a.error_code || '',
            log_level: a.log_level || '',
            alert_text: a.alert_text || '',
            resource_sid: a.resource_sid || '',
            request_url: a.request_url || '',
            request_method: a.request_method || '',
            date_created: a.date_created || '',
            date_updated: a.date_updated || '',
          }
        }
        function mapApiKey(k) {
          k = k || {}
          return {
            sid: k.sid || '',
            friendly_name: k.friendly_name || '',
            date_created: k.date_created || '',
            date_updated: k.date_updated || '',
          }
        }
        function mapNewApiKey(k) {
          k = k || {}
          return {
            sid: k.sid || '',
            friendly_name: k.friendly_name || '',
            secret: k.secret || '',
            date_created: k.date_created || '',
          }
        }
        function mapApplication(a) {
          a = a || {}
          return {
            sid: a.sid || '',
            friendly_name: a.friendly_name || '',
            voice_url: a.voice_url || '',
            voice_method: a.voice_method || 'POST',
            voice_fallback_url: a.voice_fallback_url || '',
            sms_url: a.sms_url || '',
            sms_method: a.sms_method || 'POST',
            status_callback: a.status_callback || '',
            status_callback_method: a.status_callback_method || 'POST',
            date_created: a.date_created || '',
            date_updated: a.date_updated || '',
          }
        }

        var ERROR_CODES = {
          AUTH_ERROR: 'AUTH',
          NOT_FOUND: 'NOT_FOUND',
          RATE_LIMITED: 'RATE_LIMITED',
          VALIDATION_ERROR: 'VALIDATION',
          TIMEOUT: 'TIMEOUT',
          network_error: 'NETWORK',
          http_error: 'HTTP',
        }
        function toEnvelopeError(e) {
          if (e && e.name === 'ToolError') {
            return {
              status: 'error',
              data: null,
              message: e.message || 'Twilio API call failed',
              error_code: ERROR_CODES[e.code] || String(e.code || 'ERROR').toUpperCase(),
            }
          }
          return {
            status: 'error',
            data: null,
            message: String((e && e.message) || e || 'Twilio API call failed'),
            error_code: 'UNKNOWN',
          }
        }

        var twilioToolImplementations = {
          async get_current_user(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/.json')
              return ok({ account: mapAccount(data) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_subaccounts(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('.json', {
                baseUrl: 'https://api.twilio.com/2010-04-01/Accounts',
                query: { PageSize: args.page_size === undefined ? 50 : args.page_size },
              })
              return ok({ accounts: (data.accounts || []).map(mapAccount) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_balance(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Balance.json')
              return ok({ balance: mapBalance(data) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_phone_numbers(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/IncomingPhoneNumbers.json', {
                query: { PageSize: args.page_size === undefined ? 50 : args.page_size },
              })
              return ok({ phone_numbers: (data.incoming_phone_numbers || []).map(mapPhoneNumber) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_phone_number(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/IncomingPhoneNumbers/' + args.sid + '.json')
              return ok({ phone_number: mapPhoneNumber(data) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async update_phone_number(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = {}
              if (args.friendly_name !== undefined) body.FriendlyName = args.friendly_name
              if (args.voice_url !== undefined) body.VoiceUrl = args.voice_url
              if (args.voice_method !== undefined) body.VoiceMethod = args.voice_method
              if (args.sms_url !== undefined) body.SmsUrl = args.sms_url
              if (args.sms_method !== undefined) body.SmsMethod = args.sms_method
              if (args.status_callback !== undefined) body.StatusCallback = args.status_callback
              var data = await api('/IncomingPhoneNumbers/' + args.sid + '.json', { method: 'POST', body: body })
              return ok({ phone_number: mapPhoneNumber(data) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async search_available_numbers(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var country = args.country === undefined ? 'US' : args.country
              var query = { PageSize: args.page_size === undefined ? 50 : args.page_size }
              if (args.area_code !== undefined) query.AreaCode = args.area_code
              if (args.contains !== undefined) query.Contains = args.contains
              var data = await api('/AvailablePhoneNumbers/' + country + '/Local.json', { query: query })
              return ok({ available_phone_numbers: (data.available_phone_numbers || []).map(mapAvailableNumber) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_caller_ids(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/OutgoingCallerIds.json', {
                query: { PageSize: args.page_size === undefined ? 50 : args.page_size },
              })
              return ok({ caller_ids: (data.outgoing_caller_ids || []).map(mapCallerId) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_messages(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.to) query.To = args.to
              if (args.from) query.From = args.from
              if (args.date_sent) query.DateSent = args.date_sent
              var data = await api('/Messages.json', { query: query })
              return ok({ messages: (data.messages || []).map(mapMessage) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_message(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Messages/' + args.sid + '.json')
              return ok(mapMessage(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async send_message(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { To: args.to, From: args.from, Body: args.body }
              if (args.media_url) body.MediaUrl = args.media_url
              var data = await api('/Messages.json', { method: 'POST', body: body })
              return ok(mapMessage(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async delete_message(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              await api('/Messages/' + args.sid + '.json', { method: 'DELETE' })
              return ok({ success: true })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_calls(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.to) query.To = args.to
              if (args.from) query.From = args.from
              if (args.status) query.Status = args.status
              var data = await api('/Calls.json', { query: query })
              return ok({ calls: (data.calls || []).map(mapCall) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_call(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Calls/' + args.sid + '.json')
              return ok(mapCall(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async create_call(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { To: args.to, From: args.from, Url: args.url }
              if (args.method) body.Method = args.method
              if (args.status_callback) body.StatusCallback = args.status_callback
              if (args.status_callback_method) body.StatusCallbackMethod = args.status_callback_method
              var data = await api('/Calls.json', { method: 'POST', body: body })
              return ok(mapCall(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async update_call(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = {}
              if (args.url) body.Url = args.url
              if (args.method) body.Method = args.method
              if (args.status) body.Status = args.status
              var data = await api('/Calls/' + args.sid + '.json', { method: 'POST', body: body })
              return ok(mapCall(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_recordings(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.call_sid) query.CallSid = args.call_sid
              var data = await api('/Recordings.json', { query: query })
              return ok({ recordings: (data.recordings || []).map(mapRecording) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_recording(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Recordings/' + args.sid + '.json')
              return ok(mapRecording(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async delete_recording(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              await api('/Recordings/' + args.sid + '.json', { method: 'DELETE' })
              return ok({ success: true })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_usage_records(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.category) query.Category = args.category
              if (args.start_date) query.StartDate = args.start_date
              if (args.end_date) query.EndDate = args.end_date
              var data = await api('/Usage/Records.json', { query: query })
              return ok({ usage_records: (data.usage_records || []).map(mapUsageRecord) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_usage_triggers(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Usage/Triggers.json', {
                query: { PageSize: args.page_size === undefined ? 20 : args.page_size },
              })
              return ok({ usage_triggers: (data.usage_triggers || []).map(mapUsageTrigger) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_messaging_services(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await subApi('https://messaging.twilio.com/v1', '/Services', {
                query: { PageSize: args.page_size === undefined ? 20 : args.page_size },
              })
              return ok({ services: (data.services || []).map(mapMessagingService) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_messaging_service(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await subApi('https://messaging.twilio.com/v1', '/Services/' + args.sid)
              return ok(mapMessagingService(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async create_messaging_service(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { FriendlyName: args.friendly_name }
              if (args.inbound_request_url !== undefined) body.InboundRequestUrl = args.inbound_request_url
              if (args.status_callback !== undefined) body.StatusCallback = args.status_callback
              if (args.sticky_sender !== undefined) body.StickySender = String(args.sticky_sender)
              var data = await subApi('https://messaging.twilio.com/v1', '/Services', { method: 'POST', body: body })
              return ok(mapMessagingService(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_verify_services(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await subApi('https://verify.twilio.com/v2', '/Services', {
                query: { PageSize: args.page_size === undefined ? 20 : args.page_size },
              })
              return ok({ services: (data.services || []).map(mapVerifyService) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_verify_service(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await subApi('https://verify.twilio.com/v2', '/Services/' + args.sid)
              return ok(mapVerifyService(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async create_verify_service(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { FriendlyName: args.friendly_name }
              if (args.code_length !== undefined) body.CodeLength = String(args.code_length)
              var data = await subApi('https://verify.twilio.com/v2', '/Services', { method: 'POST', body: body })
              return ok(mapVerifyService(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_alerts(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.log_level) query.LogLevel = args.log_level
              var data = await subApi('https://monitor.twilio.com/v1', '/Alerts', { query: query })
              return ok({ alerts: (data.alerts || []).map(mapAlert) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_alert(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await subApi('https://monitor.twilio.com/v1', '/Alerts/' + args.sid)
              return ok(mapAlert(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_api_keys(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Keys.json', {
                query: { PageSize: args.page_size === undefined ? 20 : args.page_size },
              })
              return ok({ keys: (data.keys || []).map(mapApiKey) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async create_api_key(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { FriendlyName: args.friendly_name }
              var data = await api('/Keys.json', { method: 'POST', body: body })
              return ok(mapNewApiKey(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async delete_api_key(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              await api('/Keys/' + args.sid + '.json', { method: 'DELETE' })
              return ok({ success: true })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async list_applications(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var query = { PageSize: args.page_size === undefined ? 20 : args.page_size }
              if (args.friendly_name) query.FriendlyName = args.friendly_name
              var data = await api('/Applications.json', { query: query })
              return ok({ applications: (data.applications || []).map(mapApplication) })
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async get_application(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var data = await api('/Applications/' + args.sid + '.json')
              return ok(mapApplication(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },

          async create_application(args) {
            var pageError = assertPage()
            if (pageError) return pageError
            try {
              var body = { FriendlyName: args.friendly_name }
              if (args.voice_url !== undefined) body.VoiceUrl = args.voice_url
              if (args.voice_method !== undefined) body.VoiceMethod = args.voice_method
              if (args.sms_url !== undefined) body.SmsUrl = args.sms_url
              if (args.sms_method !== undefined) body.SmsMethod = args.sms_method
              if (args.status_callback !== undefined) body.StatusCallback = args.status_callback
              var data = await api('/Applications.json', { method: 'POST', body: body })
              return ok(mapApplication(data))
            } catch (e) {
              return toEnvelopeError(e)
            }
          },
        }

        return twilioToolImplementations["create_verify_service"](args || {})
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
            'The console.twilio.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Twilio API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The console.twilio.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
