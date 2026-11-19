// Self-contained adapter workflow. Every CircleCI API v2 call stays inside the app.circleci.com
// tab: the HttpOnly session cookies ride along (credentials: 'include'), no token is read or
// copied, and the base is the same-origin /api/v2 path the CircleCI dashboard itself uses.
//
// Ported from the OpenTabs circleci plugin (plugins/circleci/src, MIT): same endpoint, same
// query/JSON body, same defensive mappers, same 200/202-vs-204 handling as list_pipelines.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "project_slug": {
        "type": "string",
        "description": "Project slug e.g. \"gh/org/repo\""
      },
      "branch": {
        "description": "Filter pipelines by VCS branch name",
        "type": "string"
      },
      "mine": {
        "description": "Only return pipelines triggered by the current user",
        "type": "boolean"
      },
      "page_token": {
        "description": "Pagination token from a previous response",
        "type": "string"
      }
    },
    "required": [
      "project_slug"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "pipelines": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Pipeline UUID"
            },
            "number": {
              "type": "number",
              "description": "Pipeline number"
            },
            "state": {
              "type": "string",
              "description": "Pipeline state (e.g., \"created\", \"errored\")"
            },
            "created_at": {
              "type": "string",
              "description": "ISO 8601 creation timestamp"
            },
            "updated_at": {
              "type": "string",
              "description": "ISO 8601 last update timestamp"
            },
            "project_slug": {
              "type": "string",
              "description": "Project slug (e.g., \"gh/org/repo\")"
            },
            "trigger_type": {
              "type": "string",
              "description": "Trigger type (e.g., \"webhook\", \"api\")"
            },
            "trigger_actor": {
              "type": "object",
              "properties": {
                "login": {
                  "type": "string",
                  "description": "Actor username"
                },
                "avatar_url": {
                  "type": "string",
                  "description": "Actor avatar URL"
                }
              },
              "required": [
                "login",
                "avatar_url"
              ],
              "additionalProperties": false,
              "description": "User who triggered the pipeline"
            },
            "vcs": {
              "type": "object",
              "properties": {
                "branch": {
                  "type": "string",
                  "description": "Branch name"
                },
                "revision": {
                  "type": "string",
                  "description": "Git commit SHA"
                },
                "commit_subject": {
                  "type": "string",
                  "description": "Commit message subject"
                },
                "provider_name": {
                  "type": "string",
                  "description": "VCS provider name"
                },
                "origin_repository_url": {
                  "type": "string",
                  "description": "Repository URL"
                }
              },
              "required": [
                "branch",
                "revision",
                "commit_subject",
                "provider_name",
                "origin_repository_url"
              ],
              "additionalProperties": false,
              "description": "VCS information"
            }
          },
          "required": [
            "id",
            "number",
            "state",
            "created_at",
            "updated_at",
            "project_slug",
            "trigger_type",
            "trigger_actor",
            "vcs"
          ],
          "additionalProperties": false
        },
        "description": "List of pipelines"
      },
      "next_page_token": {
        "type": "string",
        "description": "Token for the next page, empty if no more pages"
      }
    },
    "required": [
      "pipelines",
      "next_page_token"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_pipelines',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // --- CircleCI page runtime (translated from OpenTabs plugins/circleci/src/circleci-api.ts,
          //     src/tools/schemas.ts and the 33 tool handlers, MIT). Runs INSIDE the app.circleci.com
          //     tab. CircleCI authenticates the dashboard with HttpOnly session cookies, so no token
          //     is read, copied or stored: every call is a same-origin fetch to /api/v2 with
          //     credentials: 'include'. Upstream sends no CSRF header (its api()/apiVoid() add only
          //     Content-Type for bodies), so neither do we.
          var API_V2 = '/api/v2'

          function pick(value, fallback) {
            return value === undefined || value === null ? fallback : value
          }

          // Upstream's buildQueryString(): only `undefined` is dropped, everything else is
          // stringified — so `mine=false` still travels as an explicit boolean parameter.
          function buildQueryString(query) {
            if (!query) return ''
            var params = new URLSearchParams()
            var keys = Object.keys(query)
            for (var i = 0; i < keys.length; i++) {
              var value = query[keys[i]]
              if (value === undefined) continue
              params.append(keys[i], String(value))
            }
            return params.toString()
          }

          // Upstream's stripUndefined(): absent optional inputs never reach the API, so an
          // update only touches the fields the caller supplied.
          function stripUndefined(obj) {
            var out = {}
            var keys = Object.keys(obj || {})
            for (var i = 0; i < keys.length; i++) {
              if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]]
            }
            return out
          }

          function assertPage() {
            if (location.hostname !== 'app.circleci.com')
              return error('UNSUPPORTED_PAGE', 'Not on the CircleCI dashboard (app.circleci.com).')
            return null
          }

          // OpenTabs maps HTTP failures onto tool error codes; the adapter vocabulary is the same
          // set: 401/403 auth, 404 not_found, 429 rate_limit, 400/422 validation, 408 timeout.
          function classifyStatus(status) {
            if (status === 401 || status === 403) return 'AUTH'
            if (status === 404) return 'NOT_FOUND'
            if (status === 429) return 'RATE_LIMITED'
            if (status === 400 || status === 422) return 'VALIDATION'
            if (status === 408) return 'TIMEOUT'
            return 'HTTP'
          }

          function retryAfter(response) {
            try {
              var value = response.headers && response.headers.get ? response.headers.get('Retry-After') : null
              if (value === null || value === undefined) return null
              var text = String(value).replace(/^\s+|\s+$/g, '')
              return text || null
            } catch (e) {
              return null
            }
          }

          function describeHttpError(response, endpoint, detail) {
            var code = classifyStatus(response.status)
            var suffix = detail ? ' — ' + detail : ''
            if (code === 'AUTH')
              return (
                'CircleCI auth error (' +
                response.status +
                '): ' +
                endpoint +
                ' — your session may have expired, reload app.circleci.com' +
                suffix
              )
            if (code === 'NOT_FOUND') return 'Not found: ' + endpoint + suffix
            if (code === 'RATE_LIMITED') {
              var wait = retryAfter(response)
              return 'Rate limited: ' + endpoint + (wait ? ' (retry after ' + wait + ')' : '') + suffix
            }
            if (code === 'VALIDATION') return 'Validation error (' + response.status + '): ' + endpoint + suffix
            if (code === 'TIMEOUT') return 'Request timed out (' + response.status + '): ' + endpoint + suffix
            return 'CircleCI API error (' + response.status + '): ' + endpoint + suffix
          }

          // One same-origin fetch: page cookies, JSON in, JSON (or 204 → {}) out, aborted after 18s
          // so it always settles inside the adapter's 25s command deadline (upstream uses the SDK's
          // fetchJSON/fetchFromPage helpers with their own timeout).
          async function request(url, endpoint, init) {
            init = init || {}
            var headers = {}
            var body
            if (init.body !== undefined && init.body !== null) {
              headers['Content-Type'] = 'application/json'
              body = JSON.stringify(init.body)
            }
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {
                controller = null
              }
            }
            var timer = null
            if (controller) {
              timer = setTimeout(function () {
                try {
                  controller.abort()
                } catch (e) {}
              }, 18000)
            }
            var response
            try {
              response = await fetch(url, {
                method: init.method || 'GET',
                headers: headers,
                body: body,
                credentials: 'include',
                signal: controller ? controller.signal : undefined,
              })
            } catch (err) {
              if (timer !== null) clearTimeout(timer)
              var aborted =
                err &&
                (err.name === 'AbortError' ||
                  err.name === 'TimeoutError' ||
                  String(err).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'CircleCI request aborted after the 18s in-page deadline: ' + endpoint
                  : 'Network error calling the CircleCI API: ' + String(err),
              }
            }
            if (timer !== null) clearTimeout(timer)
            // 204 (and 200 with an empty body) mean "no content": cancel/delete endpoints.
            if (response.status === 204) return { ok: true, data: {} }
            if (!response.ok) {
              var text = ''
              try {
                text = await response.text()
              } catch (e) {}
              var detail = ''
              try {
                var parsed = JSON.parse(text)
                detail = parsed.message || parsed.error || ''
              } catch (e) {
                detail = String(text).substring(0, 512)
              }
              return {
                ok: false,
                error_code: classifyStatus(response.status),
                status: response.status,
                message: describeHttpError(response, endpoint, detail),
              }
            }
            var text2 = ''
            try {
              text2 = await response.text()
            } catch (e) {
              return { ok: true, data: {} }
            }
            if (!text2) return { ok: true, data: {} }
            try {
              return { ok: true, data: JSON.parse(text2) }
            } catch (e) {
              return {
                ok: false,
                error_code: 'HTTP',
                message: 'CircleCI returned invalid JSON for ' + endpoint,
              }
            }
          }

          // Upstream's api(): GET by default, JSON body + Content-Type when one is supplied.
          async function api(endpoint, options) {
            options = options || {}
            var qs = options.query ? buildQueryString(options.query) : ''
            var url = location.origin + API_V2 + endpoint + (qs ? '?' + qs : '')
            return request(url, endpoint, {
              method: options.method || 'GET',
              body: options.body,
            })
          }

          // Upstream's apiVoid(): POST by default, and the response body is consumed rather than
          // surfaced (cancel/approve/rerun answer 200/202 with no useful payload).
          async function apiVoid(endpoint, options) {
            options = options || {}
            var qs = options.query ? buildQueryString(options.query) : ''
            var url = location.origin + API_V2 + endpoint + (qs ? '?' + qs : '')
            var res = await request(url, endpoint, {
              method: options.method || 'POST',
              body: options.body,
            })
            if (!res.ok) return res
            return { ok: true, data: {} }
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }

          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }

          // --- mappers (OpenTabs tools/schemas.ts, defensive: a missing field becomes '' / 0 / []) ---
          function mapUser(u) {
            u = u || {}
            return {
              id: pick(u.id, ''),
              login: pick(u.login, ''),
              name: pick(u.name, ''),
              avatar_url: pick(u.avatar_url, ''),
            }
          }

          function mapCollaboration(c) {
            c = c || {}
            return {
              id: pick(c.id, ''),
              name: pick(c.name, ''),
              slug: pick(c.slug, ''),
              vcs_type: pick(c.vcs_type, ''),
              avatar_url: pick(c.avatar_url, ''),
            }
          }

          function mapPipeline(p) {
            p = p || {}
            var trigger = p.trigger || {}
            var actor = trigger.actor || {}
            var vcs = p.vcs || {}
            var commit = vcs.commit || {}
            return {
              id: pick(p.id, ''),
              number: pick(p.number, 0),
              state: pick(p.state, ''),
              created_at: pick(p.created_at, ''),
              updated_at: pick(p.updated_at, ''),
              project_slug: pick(p.project_slug, ''),
              trigger_type: pick(trigger.type, ''),
              trigger_actor: {
                login: pick(actor.login, ''),
                avatar_url: pick(actor.avatar_url, ''),
              },
              vcs: {
                branch: pick(vcs.branch, ''),
                revision: pick(vcs.revision, ''),
                commit_subject: pick(commit.subject, ''),
                provider_name: pick(vcs.provider_name, ''),
                origin_repository_url: pick(vcs.origin_repository_url, ''),
              },
            }
          }

          function mapWorkflow(w) {
            w = w || {}
            return {
              id: pick(w.id, ''),
              name: pick(w.name, ''),
              status: pick(w.status, ''),
              created_at: pick(w.created_at, ''),
              stopped_at: pick(w.stopped_at, ''),
              pipeline_id: pick(w.pipeline_id, ''),
              pipeline_number: pick(w.pipeline_number, 0),
              project_slug: pick(w.project_slug, ''),
              started_by: pick(w.started_by, ''),
            }
          }

          function mapJob(j) {
            j = j || {}
            var project = j.project || {}
            return {
              id: pick(j.id, ''),
              name: pick(j.name, ''),
              type: pick(j.type, ''),
              status: pick(j.status, ''),
              job_number: pick(j.job_number, pick(j.number, 0)),
              started_at: pick(j.started_at, ''),
              stopped_at: pick(j.stopped_at, ''),
              project_slug: pick(j.project_slug, pick(project.slug, '')),
            }
          }

          function mapJobDetail(j) {
            j = j || {}
            var out = mapJob(j)
            var organization = j.organization || {}
            var pipeline = j.pipeline || {}
            var workflow = j.latest_workflow || {}
            out.job_number = pick(j.job_number, pick(j.number, 0))
            out.duration = pick(j.duration, 0)
            out.web_url = pick(j.web_url, '')
            out.parallelism = pick(j.parallelism, 1)
            out.organization_name = pick(organization.name, '')
            out.pipeline_number = pick(pipeline.number, 0)
            out.workflow_name = pick(workflow.name, '')
            out.workflow_id = pick(workflow.id, '')
            return out
          }

          function mapProject(p) {
            p = p || {}
            return {
              id: pick(p.id, ''),
              slug: pick(p.slug, ''),
              name: pick(p.name, ''),
              organization_name: pick(p.organization_name, ''),
              organization_id: pick(p.organization_id, ''),
              organization_slug: pick(p.organization_slug, ''),
            }
          }

          function mapArtifact(a) {
            a = a || {}
            return {
              path: pick(a.path, ''),
              url: pick(a.url, ''),
              node_index: pick(a.node_index, 0),
            }
          }

          function mapTest(t) {
            t = t || {}
            return {
              name: pick(t.name, ''),
              classname: pick(t.classname, ''),
              result: pick(t.result, ''),
              message: pick(t.message, ''),
              run_time: pick(t.run_time, 0),
              source: pick(t.source, ''),
            }
          }

          function mapContext(c) {
            c = c || {}
            return {
              id: pick(c.id, ''),
              name: pick(c.name, ''),
              created_at: pick(c.created_at, ''),
            }
          }

          function mapContextEnvVar(e) {
            e = e || {}
            return {
              variable: pick(e.variable, ''),
              context_id: pick(e.context_id, ''),
              created_at: pick(e.created_at, ''),
              updated_at: pick(e.updated_at, ''),
            }
          }

          function mapEnvVar(e) {
            e = e || {}
            return {
              name: pick(e.name, ''),
              value: pick(e.value, ''),
            }
          }

          function mapWorkflowMetric(m) {
            m = m || {}
            var metrics = m.metrics || {}
            var duration = metrics.duration_metrics || {}
            return {
              name: pick(m.name, ''),
              window_start: pick(m.window_start, ''),
              window_end: pick(m.window_end, ''),
              total_runs: pick(metrics.total_runs, 0),
              successful_runs: pick(metrics.successful_runs, 0),
              failed_runs: pick(metrics.failed_runs, 0),
              success_rate: pick(metrics.success_rate, 0),
              throughput: pick(metrics.throughput, 0),
              mttr: pick(metrics.mttr, 0),
              duration_p50: pick(duration.median, 0),
              duration_p95: pick(duration.p95, 0),
            }
          }

          function mapWorkflowRun(r) {
            r = r || {}
            var branch = r.branch || {}
            return {
              id: pick(r.id, ''),
              status: pick(r.status, ''),
              duration: pick(r.duration, 0),
              created_at: pick(r.created_at, ''),
              stopped_at: pick(r.stopped_at, ''),
              branch: pick(branch.name, ''),
            }
          }

          function mapJobMetric(m) {
            m = m || {}
            var metrics = m.metrics || {}
            var duration = metrics.duration_metrics || {}
            return {
              name: pick(m.name, ''),
              window_start: pick(m.window_start, ''),
              window_end: pick(m.window_end, ''),
              total_runs: pick(metrics.total_runs, 0),
              successful_runs: pick(metrics.successful_runs, 0),
              failed_runs: pick(metrics.failed_runs, 0),
              success_rate: pick(metrics.success_rate, 0),
              throughput: pick(metrics.throughput, 0),
              duration_p50: pick(duration.median, 0),
              duration_p95: pick(duration.p95, 0),
            }
          }

          function mapFlakyTest(t) {
            t = t || {}
            return {
              test_name: pick(t.test_name, ''),
              classname: pick(t.classname, ''),
              pipeline_number: pick(t.pipeline_number, 0),
              workflow_name: pick(t.workflow_name, ''),
              job_name: pick(t.job_name, ''),
              times_flaked: pick(t.times_flaked, 0),
            }
          }

          function mapSchedule(s) {
            s = s || {}
            var timetable = s.timetable || {}
            return {
              id: pick(s.id, ''),
              name: pick(s.name, ''),
              description: pick(s.description, ''),
              timetable: {
                per_hour: pick(timetable.per_hour, 0),
                hours_of_day: pick(timetable.hours_of_day, []),
                days_of_week: pick(timetable.days_of_week, []),
                days_of_month: pick(timetable.days_of_month, []),
                months: pick(timetable.months, []),
              },
              created_at: pick(s.created_at, ''),
              updated_at: pick(s.updated_at, ''),
            }
          }
          var circleciToolImplementations = {
            async list_pipelines(args) {
              var pageError = assertPage()
              if (pageError) return pageError
              var res = await api('/project/' + args.project_slug + '/pipeline', {
                query: { branch: args.branch, mine: args.mine, 'page-token': args.page_token },
              })
              if (!res.ok) return error(res.error_code, res.message)
              var data = res.data || {}
              return ok({
                pipelines: (data.items || []).map(mapPipeline),
                next_page_token: pick(data.next_page_token, ''),
              })
            },
          }
          async function stdin_default(args) {
            return circleciToolImplementations['list_pipelines'](args)
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
        // Tab closed/navigated or the eval timed out: surface a stable workflow error instead of
        // letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The app.circleci.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'CircleCI API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The app.circleci.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
