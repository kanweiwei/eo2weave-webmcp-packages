/**
 * Execution tests for com.twilio.main.
 *
 * The ported runtime is upstream's Twilio plugin code (translated to a
 * self-contained page runtime), so these tests assert the *requests* it makes —
 * the Console project-info bootstrap, the api.twilio.com / messaging / verify /
 * monitor URLs, query strings, Basic auth header and form bodies — plus the
 * mapped output and the failure classification.
 */
export default async function register({ ok, equal, section, runTool }) {
  const HOST = 'console.twilio.com'
  // Not a real SID: 'x' is not hexadecimal, so secret scanners do not flag
  // the fixture, and the runtime only uses it as a path segment.
  const ACCOUNT_SID = 'AC' + 'x'.repeat(32)
  const AUTH_TOKEN = 'auth-token-abc123'
  const API_BASE = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`

  const jsonResponse = (payload, status = 200, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  })

  /**
   * Minimal page: a console.twilio.com tab whose session answers the Console
   * project-info bootstrap. `routes` is keyed by `"<METHOD> <full url>"`; the
   * bootstrap is answered automatically unless `authenticated: false`.
   */
  function makePage({ hostname = HOST, authenticated = true, routes = {} } = {}) {
    const calls = []
    return {
      calls,
      hostname,
      href: `https://${hostname}/`,
      origin: `https://${hostname}`,
      fetch: async (url, init = {}) => {
        const method = init.method ?? 'GET'
        const parsed = new URL(url, `https://${hostname}/`)
        calls.push({ url: String(url), parsed, method, init })
        if (parsed.href === 'https://www.twilio.com/console/api/v2/projects/info') {
          if (!authenticated) return jsonResponse({ message: 'Unauthorized' }, 401)
          return jsonResponse({ projectSid: ACCOUNT_SID, authToken: AUTH_TOKEN })
        }
        const route = routes[`${method} ${parsed.href}`] ?? routes[`${method} ${parsed.origin}${parsed.pathname}`]
        if (route === undefined) return jsonResponse({ message: 'no route' }, 404)
        if (typeof route === 'function') return route(parsed, init)
        return typeof route === 'number' ? jsonResponse({ message: 'failed' }, route) : jsonResponse(route)
      },
    }
  }

  const apiCalls = (page) => page.calls.filter((call) => !call.parsed.hostname.endsWith('www.twilio.com'))

  // --- urlRegex ---------------------------------------------------------------

  section('urlRegex: com.twilio.main scopes to console.twilio.com')
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(
    await readFile(new URL('../../packages/com.twilio.main/manifest.json', import.meta.url), 'utf8'),
  )
  equal(manifest.tools.length, 35, 'twilio: 35 tools in the manifest')
  const regexes = new Set(manifest.tools.map((tool) => tool.urlRegex))
  equal(regexes.size, 1, 'twilio: every tool shares one host-scoped urlRegex')
  const re = new RegExp(manifest.tools[0].urlRegex)
  const matches = (href) => {
    const m = href.match(re)
    return Boolean(m) && m.index === 0 && m[0].length === href.length
  }
  ok(matches('https://console.twilio.com/'), 'matches the console root')
  ok(matches('https://console.twilio.com/us1/account/AC123/phone-numbers?filter=PN#list'), 'matches a console page with query and hash')
  ok(!matches('https://console.twilio.com.evil.example/us1'), 'rejects a look-alike suffix')
  ok(!matches('https://console.twilio.com.evil.example'), 'rejects a look-alike host')
  ok(!matches('http://console.twilio.com/us1'), 'rejects plain http')
  ok(!matches('https://www.twilio.com/console'), 'rejects the marketing host')
  ok(!matches('https://api.twilio.com/2010-04-01/Accounts'), 'rejects the REST host')

  // --- Account read -----------------------------------------------------------

  section('execution: account read boots the Console session and maps the account')
  {
    const page = makePage({
      routes: {
        [`GET ${API_BASE}/.json`]: {
          sid: ACCOUNT_SID,
          friendly_name: 'Acme Prod',
          status: 'active',
          type: 'Full',
          date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
          date_updated: 'Tue, 02 Jan 2024 00:00:00 +0000',
          owner_account_sid: ACCOUNT_SID,
        },
      },
    })
    const result = await runTool('com.twilio.main', 'get_current_user', { page })
    equal(result.status, 'ok', 'twilio get_current_user: status')
    equal(result.data.account.friendly_name, 'Acme Prod', 'twilio get_current_user: friendly name')
    equal(result.data.account.type, 'Full', 'twilio get_current_user: account type')
    equal(result.data.account.sid, ACCOUNT_SID, 'twilio get_current_user: account sid')

    const bootstrap = page.calls[0]
    equal(bootstrap.parsed.href, 'https://www.twilio.com/console/api/v2/projects/info', 'twilio get_current_user: bootstraps from the Console project-info endpoint')
    equal(bootstrap.init.credentials, 'include', 'twilio get_current_user: bootstrap sends the console cookie')

    const apiCall = apiCalls(page)[0]
    equal(apiCall.url, `${API_BASE}/.json`, 'twilio get_current_user: calls the account resource')
    equal(apiCall.init.credentials, 'omit', 'twilio get_current_user: REST calls omit cookies (Basic auth only)')
    equal(
      apiCall.init.headers.Authorization,
      `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
      'twilio get_current_user: sends the derived Basic auth header',
    )
  }

  // --- Phone numbers ----------------------------------------------------------

  section('execution: phone number, message, call and alert reads carry Twilio query params')
  {
    const page = makePage({
      routes: {
        [`GET ${API_BASE}/IncomingPhoneNumbers.json`]: {
          incoming_phone_numbers: [
            {
              sid: 'PN0123456789abcdef0123456789abcdef',
              phone_number: '+15551234567',
              friendly_name: 'Support line',
              capabilities: { voice: true, sms: true, mms: false, fax: false },
              status: 'in-use',
              voice_url: 'https://example.com/voice',
              voice_method: 'POST',
              sms_url: 'https://example.com/sms',
              sms_method: 'POST',
              status_callback: '',
              date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
            },
          ],
        },
      },
    })
    const result = await runTool('com.twilio.main', 'list_phone_numbers', { page })
    equal(result.status, 'ok', 'twilio list_phone_numbers: status')
    equal(result.data.phone_numbers.length, 1, 'twilio list_phone_numbers: one number')
    equal(result.data.phone_numbers[0].phone_number, '+15551234567', 'twilio list_phone_numbers: E.164 number')
    equal(result.data.phone_numbers[0].capabilities.sms, true, 'twilio list_phone_numbers: sms capability')
    equal(result.data.phone_numbers[0].capabilities.mms, false, 'twilio list_phone_numbers: mms capability')
    equal(result.data.phone_numbers[0].voice_method, 'POST', 'twilio list_phone_numbers: voice method')

    const call = apiCalls(page)[0]
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/IncomingPhoneNumbers.json`, 'twilio list_phone_numbers: account-scoped path')
    equal(call.parsed.searchParams.get('PageSize'), '50', 'twilio list_phone_numbers: default page size 50')
  }

  // --- Messages ---------------------------------------------------------------

  {
    const page = makePage({
      routes: {
        [`GET ${API_BASE}/Messages.json`]: {
          messages: [
            {
              sid: 'SM0123456789abcdef0123456789abcdef',
              from: '+15551234567',
              to: '+15559876543',
              body: 'hello',
              status: 'delivered',
              direction: 'outbound-api',
              price: '-0.0075',
              price_unit: 'USD',
              num_segments: '1',
              date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
              date_sent: 'Mon, 01 Jan 2024 00:00:01 +0000',
              error_code: null,
              error_message: null,
            },
          ],
        },
      },
    })
    const result = await runTool('com.twilio.main', 'list_messages', {
      input: { to: '+15559876543', from: '+15551234567', date_sent: '2024-01-01', page_size: 100 },
      page,
    })
    equal(result.status, 'ok', 'twilio list_messages: status')
    equal(result.data.messages[0].sid, 'SM0123456789abcdef0123456789abcdef', 'twilio list_messages: message sid')
    equal(result.data.messages[0].error_message, '', 'twilio list_messages: null error message becomes empty string')
    equal(result.data.messages[0].error_code, null, 'twilio list_messages: null error code stays null')

    const call = apiCalls(page)[0]
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, 'twilio list_messages: messages path')
    equal(call.parsed.searchParams.get('PageSize'), '100', 'twilio list_messages: page size passed through')
    equal(call.parsed.searchParams.get('To'), '+15559876543', 'twilio list_messages: To filter')
    equal(call.parsed.searchParams.get('From'), '+15551234567', 'twilio list_messages: From filter')
    equal(call.parsed.searchParams.get('DateSent'), '2024-01-01', 'twilio list_messages: DateSent filter')
  }

  // --- Calls ------------------------------------------------------------------

  {
    const page = makePage({
      routes: {
        [`GET ${API_BASE}/Calls.json`]: {
          calls: [
            {
              sid: 'CA0123456789abcdef0123456789abcdef',
              from: '+15551234567',
              to: '+15559876543',
              status: 'completed',
              direction: 'outbound-api',
              duration: '42',
              price: '-0.013',
              price_unit: 'USD',
              start_time: 'Mon, 01 Jan 2024 00:00:00 +0000',
              end_time: 'Mon, 01 Jan 2024 00:00:42 +0000',
              date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
            },
          ],
        },
      },
    })
    const result = await runTool('com.twilio.main', 'list_calls', {
      input: { status: 'completed', to: '+15559876543', page_size: 5 },
      page,
    })
    equal(result.status, 'ok', 'twilio list_calls: status')
    equal(result.data.calls[0].duration, '42', 'twilio list_calls: duration')
    equal(result.data.calls[0].status, 'completed', 'twilio list_calls: status field')

    const call = apiCalls(page)[0]
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`, 'twilio list_calls: calls path')
    equal(call.parsed.searchParams.get('Status'), 'completed', 'twilio list_calls: Status filter')
    equal(call.parsed.searchParams.get('PageSize'), '5', 'twilio list_calls: page size passed through')
  }

  // --- Alerts (Monitor logs) --------------------------------------------------

  {
    const page = makePage({
      routes: {
        'GET https://monitor.twilio.com/v1/Alerts': {
          alerts: [
            {
              sid: 'NO0123456789abcdef0123456789abcdef',
              error_code: '11200',
              log_level: 'error',
              alert_text: 'HTTP retrieval failure',
              resource_sid: 'CA0123456789abcdef0123456789abcdef',
              request_url: 'https://example.com/hook',
              request_method: 'POST',
              date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
              date_updated: 'Mon, 01 Jan 2024 00:00:00 +0000',
            },
          ],
        },
      },
    })
    const result = await runTool('com.twilio.main', 'list_alerts', {
      input: { log_level: 'error', page_size: 10 },
      page,
    })
    equal(result.status, 'ok', 'twilio list_alerts: status')
    equal(result.data.alerts[0].error_code, '11200', 'twilio list_alerts: error code')
    equal(result.data.alerts[0].log_level, 'error', 'twilio list_alerts: log level')

    const call = apiCalls(page)[0]
    equal(call.parsed.origin, 'https://monitor.twilio.com', 'twilio list_alerts: uses the Monitor API host')
    equal(call.parsed.pathname, '/v1/Alerts', 'twilio list_alerts: Monitor alerts path')
    equal(call.parsed.searchParams.get('LogLevel'), 'error', 'twilio list_alerts: LogLevel filter')
    equal(call.parsed.searchParams.get('PageSize'), '10', 'twilio list_alerts: page size passed through')
    equal(call.init.headers['Content-Type'], undefined, 'twilio list_alerts: GET has no form content type')
  }

  // --- Write: send_message ----------------------------------------------------

  section('execution: writes post form bodies to the real Twilio endpoints')
  {
    const page = makePage({
      routes: {
        [`POST ${API_BASE}/Messages.json`]: {
          sid: 'SMfedcba9876543210fedcba9876543210',
          from: '+15551234567',
          to: '+15559876543',
          body: 'ping',
          status: 'queued',
          direction: 'outbound-api',
          price: null,
          price_unit: 'USD',
          num_segments: '1',
          date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
          date_sent: null,
          error_code: null,
          error_message: null,
        },
      },
    })
    const result = await runTool('com.twilio.main', 'send_message', {
      input: { to: '+15559876543', from: '+15551234567', body: 'ping', media_url: 'https://example.com/a.png' },
      page,
    })
    equal(result.status, 'ok', 'twilio send_message: status')
    equal(result.data.sid, 'SMfedcba9876543210fedcba9876543210', 'twilio send_message: message sid')
    equal(result.data.status, 'queued', 'twilio send_message: queued status')
    equal(result.data.price, '0', 'twilio send_message: null price defaults to 0')
    equal(result.data.date_sent, '', 'twilio send_message: null date_sent defaults to empty string')

    const call = apiCalls(page)[0]
    equal(call.method, 'POST', 'twilio send_message: POST')
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, 'twilio send_message: messages path')
    equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded', 'twilio send_message: form-encoded body')
    const body = new URLSearchParams(call.init.body)
    equal(body.get('To'), '+15559876543', 'twilio send_message: To body field')
    equal(body.get('From'), '+15551234567', 'twilio send_message: From body field')
    equal(body.get('Body'), 'ping', 'twilio send_message: Body field')
    equal(body.get('MediaUrl'), 'https://example.com/a.png', 'twilio send_message: MediaUrl field')
  }

  // --- Write: update_call -----------------------------------------------------

  {
    const CALL_SID = 'CA0123456789abcdef0123456789abcdef'
    const page = makePage({
      routes: {
        [`POST ${API_BASE}/Calls/${CALL_SID}.json`]: {
          sid: CALL_SID,
          from: '+15551234567',
          to: '+15559876543',
          status: 'completed',
          direction: 'outbound-api',
          duration: '7',
          price: null,
          price_unit: 'USD',
          start_time: null,
          end_time: null,
          date_created: 'Mon, 01 Jan 2024 00:00:00 +0000',
        },
      },
    })
    const result = await runTool('com.twilio.main', 'update_call', {
      input: { sid: CALL_SID, status: 'completed' },
      page,
    })
    equal(result.status, 'ok', 'twilio update_call: status')
    equal(result.data.sid, CALL_SID, 'twilio update_call: call sid')
    equal(result.data.status, 'completed', 'twilio update_call: completed status')

    const call = apiCalls(page)[0]
    equal(call.method, 'POST', 'twilio update_call: POST')
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${CALL_SID}.json`, 'twilio update_call: call resource path')
    const body = new URLSearchParams(call.init.body)
    equal(body.get('Status'), 'completed', 'twilio update_call: Status form field')
    equal(body.get('Url'), null, 'twilio update_call: omits unset Url')
  }

  // --- Write: delete_recording (DELETE, 204) ----------------------------------

  {
    const RECORDING_SID = 'RE0123456789abcdef0123456789abcdef'
    const page = makePage({
      routes: {
        [`DELETE ${API_BASE}/Recordings/${RECORDING_SID}.json`]: () => jsonResponse('', 204),
      },
    })
    const result = await runTool('com.twilio.main', 'delete_recording', { input: { sid: RECORDING_SID }, page })
    equal(result.status, 'ok', 'twilio delete_recording: status')
    equal(result.data.success, true, 'twilio delete_recording: success flag')
    const call = apiCalls(page)[0]
    equal(call.method, 'DELETE', 'twilio delete_recording: DELETE')
    equal(call.parsed.pathname, `/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${RECORDING_SID}.json`, 'twilio delete_recording: recording path')
    equal(call.init.body, undefined, 'twilio delete_recording: no body')
  }

  // --- Failure paths ----------------------------------------------------------

  section('execution: auth and HTTP failures are classified, not thrown')
  {
    const page = makePage({ authenticated: false })
    const result = await runTool('com.twilio.main', 'get_current_user', { page })
    equal(result.status, 'error', 'twilio auth failure: error status')
    equal(result.error_code, 'AUTH', 'twilio auth failure: AUTH')
    ok(/log in to Twilio Console/i.test(result.message), 'twilio auth failure: message points at the console login')
    equal(apiCalls(page).length, 0, 'twilio auth failure: never calls api.twilio.com')
  }

  {
    const page = makePage({
      routes: { [`GET ${API_BASE}/Messages/SMdoesnotexist.json`]: 404 },
    })
    const result = await runTool('com.twilio.main', 'get_message', { input: { sid: 'SMdoesnotexist' }, page })
    equal(result.status, 'error', 'twilio 404: error status')
    equal(result.error_code, 'NOT_FOUND', 'twilio 404: NOT_FOUND')
  }

  {
    const page = makePage({
      routes: { [`POST ${API_BASE}/Messages.json`]: 400 },
    })
    const result = await runTool('com.twilio.main', 'send_message', {
      input: { to: '+1555', from: '+15551234567', body: 'x' },
      page,
    })
    equal(result.status, 'error', 'twilio 400: error status')
    equal(result.error_code, 'VALIDATION', 'twilio 400: VALIDATION')
  }

  {
    const page = makePage()
    page.hostname = 'www.twilio.com'
    const result = await runTool('com.twilio.main', 'get_balance', { page })
    equal(result.status, 'error', 'twilio wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'twilio wrong host: UNSUPPORTED_PAGE')
    equal(page.calls.length, 0, 'twilio wrong host: makes no request')
  }
}
