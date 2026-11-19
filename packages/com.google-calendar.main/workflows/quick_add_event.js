// Self-contained adapter workflow. Every Google Calendar API call (gapi's
// SAPISIDHASH-signed client, or the same-origin fallback fetch) and the session
// it rides on stay inside the calendar.google.com tab.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "calendar_id": {
        "description": "Calendar ID (default \"primary\")",
        "type": "string"
      },
      "text": {
        "type": "string",
        "description": "Natural language text describing the event (e.g., \"Lunch with Sarah tomorrow at noon\")"
      },
      "send_updates": {
        "description": "Who to send notifications to (default \"none\")",
        "type": "string",
        "enum": [
          "all",
          "externalOnly",
          "none"
        ]
      }
    },
    "required": [
      "text"
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
    description: 'quick_add_event',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Google Calendar runtime (translated from OpenTabs
          // google-calendar-api.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // calendar.google.com tab: gapi derives SAPISIDHASH from the tab's own session
          // cookies, so no credential is ever read out of the page or returned.
          var API_BASE = '/calendar/v3'
          var API_DEADLINE_MS = 18000

          function getPageGlobal(path) {
            try {
              var parts = String(path).split('.')
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
          function toolError(code, message) {
            var error = new Error(message)
            error.__toolError = code
            return error
          }
          // Upstream detects auth readiness exactly this way: the Calendar web app loads
          // gapi and exposes gapi.client.request, which signs calls with the session.
          function getGapiRequest() {
            var requestFn = getPageGlobal('gapi.client.request')
            return typeof requestFn === 'function' ? requestFn : null
          }
          function isAuthenticated() {
            return getGapiRequest() !== null
          }
          function cleanParams(params) {
            if (!params) return undefined
            var out = {}
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value !== undefined) out[keys[i]] = value
            }
            return out
          }
          function buildQueryString(params) {
            if (!params) return ''
            var search = new URLSearchParams()
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined || value === null) continue
              search.append(keys[i], String(value))
            }
            return search.toString()
          }
          // Google's JSON endpoints used to answer with an XSSI guard line; stripping it
          // keeps the parse correct instead of turning a valid payload into a parse error.
          function stripXssiPrefix(text) {
            var body = String(text === undefined || text === null ? '' : text)
            if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
            if (body.indexOf(")]}'") === 0) {
              var newline = body.indexOf('\n')
              body = newline === -1 ? '' : body.slice(newline + 1)
            }
            return body
          }
          // Same classification as upstream api(): 401/403 auth, 404 not found, 429 rate
          // limited, 400/422 validation, everything else internal.
          function classifyStatus(status, message) {
            if (status === 401 || status === 403) return toolError('AUTH', message)
            if (status === 404) return toolError('NOT_FOUND', message)
            if (status === 429) return toolError('RATE_LIMITED', message)
            if (status === 400 || status === 422) return toolError('VALIDATION', message)
            return toolError('INTERNAL', '(' + (status === undefined ? 'unknown' : status) + ') ' + message)
          }
          // gapi returns a promise of { status, result, body, headers } and rejects with
          // the same shape. A deadline keeps a stalled request from outliving the 25s
          // browser-eval budget, whichever transport answered.
          function gapiRequest(requestFn, options) {
            return new Promise(function (resolve, reject) {
              var settled = false
              var timer = setTimeout(function () {
                if (settled) return
                settled = true
                reject(toolError('TIMEOUT', 'Google Calendar request timed out after the 18s in-page deadline.'))
              }, API_DEADLINE_MS)
              function finish(fn, value) {
                if (settled) return
                settled = true
                clearTimeout(timer)
                fn(value)
              }
              try {
                requestFn(options).then(
                  function (response) {
                    finish(resolve, response)
                  },
                  function (error) {
                    finish(reject, error)
                  },
                )
              } catch (e) {
                finish(reject, e)
              }
            })
          }
          // Fallback transport for a tab where the Calendar app has not exposed gapi yet:
          // the identical path/method/params go out as a same-origin fetch with the tab's
          // cookies. Google answers an unknown /calendar/v3 path on this host with the
          // marketing HTML page, which is reported as "not ready" instead of as data.
          async function fetchApi(path, options, endpoint, body) {
            var url = location.origin + path
            var query = buildQueryString(options.params)
            if (query) url += '?' + query
            var headers = {}
            if (body !== undefined) headers['Content-Type'] = 'application/json'
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
                  }, API_DEADLINE_MS)
                : null
            var response
            try {
              response = await fetch(url, {
                method: options.method || 'GET',
                headers: headers,
                body: body,
                credentials: 'include',
                signal: controller ? controller.signal : undefined,
              })
            } catch (e) {
              if (timer !== null) clearTimeout(timer)
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (aborted) throw toolError('TIMEOUT', 'Google Calendar request aborted after the 18s in-page deadline.')
              throw toolError('NETWORK', 'Network error calling Google Calendar: ' + String(e))
            }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (timer !== null) clearTimeout(timer)
            if (response.status === 204) return {}
            var payload = stripXssiPrefix(text)
            var data = null
            if (payload) {
              try {
                data = JSON.parse(payload)
              } catch (e) {
                data = null
              }
            }
            if (response.status < 200 || response.status >= 300) {
              var detail = (data && data.error && data.error.message) || payload.slice(0, 512)
              throw classifyStatus(response.status, detail || 'API error: ' + endpoint)
            }
            if (data === null) {
              throw toolError('AUTH', 'Google Calendar is not ready — please open Google Calendar and sign in.')
            }
            return data
          }
          async function api(endpoint, options) {
            options = options || {}
            var path = API_BASE + endpoint
            var body = options.body ? JSON.stringify(options.body) : undefined
            var requestFn = getGapiRequest()
            if (requestFn) {
              var response
              try {
                response = await gapiRequest(requestFn, {
                  path: path,
                  method: options.method,
                  params: cleanParams(options.params),
                  body: body,
                })
              } catch (error) {
                if (error && error.__toolError) throw error
                var status = error && error.status
                var message =
                  (error && error.result && error.result.error && error.result.error.message) ||
                  'API error: ' + endpoint
                throw classifyStatus(status, message)
              }
              return response && response.result !== undefined && response.result !== null ? response.result : {}
            }
            return await fetchApi(path, options, endpoint, body)
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapDateTime(dt) {
            dt = dt || {}
            return {
              date_time: dt.dateTime === undefined || dt.dateTime === null ? '' : dt.dateTime,
              date: dt.date === undefined || dt.date === null ? '' : dt.date,
              time_zone: dt.timeZone === undefined || dt.timeZone === null ? '' : dt.timeZone,
            }
          }
          function mapAttendee(a) {
            a = a || {}
            return {
              email: a.email === undefined || a.email === null ? '' : a.email,
              display_name: a.displayName === undefined || a.displayName === null ? '' : a.displayName,
              response_status:
                a.responseStatus === undefined || a.responseStatus === null ? 'needsAction' : a.responseStatus,
              is_self: a.self === undefined || a.self === null ? false : !!a.self,
              is_organizer: a.organizer === undefined || a.organizer === null ? false : !!a.organizer,
              is_optional: a.optional === undefined || a.optional === null ? false : !!a.optional,
            }
          }
          function mapReminder(r) {
            r = r || {}
            return {
              method: r.method === undefined || r.method === null ? 'popup' : r.method,
              minutes: typeof r.minutes === 'number' ? r.minutes : 0,
            }
          }
          function mapEvent(e) {
            e = e || {}
            var creator = e.creator || {}
            var organizer = e.organizer || {}
            var reminders = e.reminders || {}
            var overrides = reminders.overrides || []
            var entryPoints = (e.conferenceData && e.conferenceData.entryPoints) || []
            var conferenceUri = ''
            for (var i = 0; i < entryPoints.length; i++) {
              var point = entryPoints[i]
              if (point && point.entryPointType === 'video' && point.uri) {
                conferenceUri = point.uri
                break
              }
            }
            var attendees = []
            var rawAttendees = e.attendees || []
            for (var j = 0; j < rawAttendees.length; j++) attendees.push(mapAttendee(rawAttendees[j]))
            var mappedReminders = []
            for (var k = 0; k < overrides.length; k++) mappedReminders.push(mapReminder(overrides[k]))
            return {
              id: e.id === undefined || e.id === null ? '' : e.id,
              status: e.status === undefined || e.status === null ? 'confirmed' : e.status,
              html_url: e.htmlLink === undefined || e.htmlLink === null ? '' : e.htmlLink,
              summary: e.summary === undefined || e.summary === null ? '' : e.summary,
              description: e.description === undefined || e.description === null ? '' : e.description,
              location: e.location === undefined || e.location === null ? '' : e.location,
              creator_email: creator.email === undefined || creator.email === null ? '' : creator.email,
              organizer_email: organizer.email === undefined || organizer.email === null ? '' : organizer.email,
              start: mapDateTime(e.start),
              end: mapDateTime(e.end),
              created_at: e.created === undefined || e.created === null ? '' : e.created,
              updated_at: e.updated === undefined || e.updated === null ? '' : e.updated,
              recurring_event_id:
                e.recurringEventId === undefined || e.recurringEventId === null ? '' : e.recurringEventId,
              attendees: attendees,
              reminders: mappedReminders,
              uses_default_reminders: reminders.useDefault === undefined || reminders.useDefault === null ? true : !!reminders.useDefault,
              color_id: e.colorId === undefined || e.colorId === null ? '' : e.colorId,
              transparency: e.transparency === undefined || e.transparency === null ? 'opaque' : e.transparency,
              visibility: e.visibility === undefined || e.visibility === null ? 'default' : e.visibility,
              event_type: e.eventType === undefined || e.eventType === null ? 'default' : e.eventType,
              hangout_link: e.hangoutLink === undefined || e.hangoutLink === null ? '' : e.hangoutLink,
              conference_uri: conferenceUri,
              recurrence: e.recurrence || [],
            }
          }
          function mapCalendarListEntry(c) {
            c = c || {}
            return {
              id: c.id === undefined || c.id === null ? '' : c.id,
              summary: c.summary === undefined || c.summary === null ? '' : c.summary,
              description: c.description === undefined || c.description === null ? '' : c.description,
              location: c.location === undefined || c.location === null ? '' : c.location,
              time_zone: c.timeZone === undefined || c.timeZone === null ? '' : c.timeZone,
              color_id: c.colorId === undefined || c.colorId === null ? '' : c.colorId,
              background_color: c.backgroundColor === undefined || c.backgroundColor === null ? '' : c.backgroundColor,
              foreground_color: c.foregroundColor === undefined || c.foregroundColor === null ? '' : c.foregroundColor,
              selected: c.selected === undefined || c.selected === null ? false : !!c.selected,
              access_role: c.accessRole === undefined || c.accessRole === null ? '' : c.accessRole,
              is_primary: c.primary === undefined || c.primary === null ? false : !!c.primary,
            }
          }
          function mapCalendar(c) {
            c = c || {}
            return {
              id: c.id === undefined || c.id === null ? '' : c.id,
              summary: c.summary === undefined || c.summary === null ? '' : c.summary,
              description: c.description === undefined || c.description === null ? '' : c.description,
              location: c.location === undefined || c.location === null ? '' : c.location,
              time_zone: c.timeZone === undefined || c.timeZone === null ? '' : c.timeZone,
            }
          }
          function mapSetting(s) {
            s = s || {}
            return {
              id: s.id === undefined || s.id === null ? '' : s.id,
              value: s.value === undefined || s.value === null ? '' : s.value,
            }
          }
          function mapColorEntry(id, c) {
            c = c || {}
            return {
              id: id,
              background: c.background === undefined || c.background === null ? '' : c.background,
              foreground: c.foreground === undefined || c.foreground === null ? '' : c.foreground,
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
            if (location.hostname !== 'calendar.google.com')
              return error('UNSUPPORTED_PAGE', 'Not on a calendar.google.com page.')
            return null
          }

          var googleCalendarToolImplementations = {
            async quick_add_event(args) {
              var calendarId = encodeURIComponent(args.calendar_id === undefined || args.calendar_id === null ? 'primary' : args.calendar_id)
              var data = await api('/calendars/' + calendarId + '/events/quickAdd', {
                method: 'POST',
                params: {
                  text: args.text,
                  sendUpdates: args.send_updates || 'none',
                },
              })
              return { event: mapEvent(data) }
            }
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await googleCalendarToolImplementations['quick_add_event'](args)
              return ok(data)
            } catch (e) {
              return error(
                e && e.__toolError ? e.__toolError : 'UNKNOWN',
                e && e.message ? e.message : String(e),
              )
            }
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
            'The calendar.google.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Calendar API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The calendar.google.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
