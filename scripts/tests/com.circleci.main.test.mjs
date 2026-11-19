// Package-local execution tests for com.circleci.main. Auto-loaded by
// scripts/test-packages.mjs; each block runs the real workflow against a
// stubbed app.circleci.com page and asserts the request + parsed output.

import { readFileSync } from 'node:fs'
import path from 'node:path'

function json(payload, status = 200) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return body
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

/**
 * One stub tab on app.circleci.com. `respond(url, init)` returns a Response
 * stub; every request is recorded so the test can assert the exact URL, method,
 * headers and body the port produced.
 */
function circleciPage(respond, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'app.circleci.com',
      origin: 'https://app.circleci.com',
      href: 'https://app.circleci.com/pipelines/gh/acme/web',
      fetch: async (url, init) => {
        requests.push({ url, init })
        return respond(url, init)
      },
      ...overrides,
    },
  }
}

export default async function ({ ok, equal, section, runTool, packagesDir }) {
  section('circleci: pipelines, workflows, jobs, writes, auth')

  // --- Reads: pipelines ------------------------------------------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        items: [
          {
            id: 'pipe-1',
            number: 42,
            state: 'created',
            created_at: '2026-11-18T10:00:00Z',
            updated_at: '2026-11-18T10:01:00Z',
            project_slug: 'gh/acme/web',
            trigger: { type: 'webhook', actor: { login: 'octocat', avatar_url: 'https://a/1.png' } },
            vcs: {
              branch: 'main',
              revision: 'abc123',
              commit: { subject: 'fix: flaky test' },
              provider_name: 'GitHub',
              origin_repository_url: 'https://github.com/acme/web',
            },
          },
        ],
        next_page_token: 'tok-2',
      }),
    )
    const result = await runTool('com.circleci.main', 'list_pipelines', {
      input: { project_slug: 'gh/acme/web', branch: 'main', mine: false },
      page,
    })
    equal(result.status, 'ok', 'circleci list_pipelines: ok status')
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/project/gh/acme/web/pipeline?branch=main&mine=false',
      'circleci list_pipelines: same-origin /api/v2 URL with query params',
    )
    equal(requests[0].init.method, 'GET', 'circleci list_pipelines: GET')
    equal(requests[0].init.credentials, 'include', 'circleci list_pipelines: sends credentials')
    equal(result.data.pipelines.length, 1, 'circleci list_pipelines: maps one pipeline')
    equal(result.data.pipelines[0].number, 42, 'circleci list_pipelines: pipeline number')
    equal(result.data.pipelines[0].trigger_type, 'webhook', 'circleci list_pipelines: trigger type')
    equal(result.data.pipelines[0].trigger_actor.login, 'octocat', 'circleci list_pipelines: trigger actor')
    equal(result.data.pipelines[0].vcs.commit_subject, 'fix: flaky test', 'circleci list_pipelines: commit subject')
    equal(result.data.next_page_token, 'tok-2', 'circleci list_pipelines: next_page_token')
  }

  // --- Reads: pipeline workflows + pagination -------------------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        items: [
          {
            id: 'wf-1',
            name: 'build-and-deploy',
            status: 'success',
            created_at: '2026-11-18T10:00:00Z',
            stopped_at: '2026-11-18T10:05:00Z',
            pipeline_id: 'pipe-1',
            pipeline_number: 42,
            project_slug: 'gh/acme/web',
            started_by: 'user-1',
          },
        ],
        next_page_token: null,
      }),
    )
    const result = await runTool('com.circleci.main', 'get_pipeline_workflows', {
      input: { pipeline_id: 'pipe-1', page_token: 'abc' },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/pipeline/pipe-1/workflow?page-token=abc',
      'circleci get_pipeline_workflows: page-token query param',
    )
    equal(result.status, 'ok', 'circleci get_pipeline_workflows: ok status')
    equal(result.data.workflows[0].name, 'build-and-deploy', 'circleci get_pipeline_workflows: name')
    equal(result.data.workflows[0].pipeline_number, 42, 'circleci get_pipeline_workflows: pipeline number')
    equal(result.data.next_page_token, '', 'circleci get_pipeline_workflows: empty next token when absent')
  }

  // --- Reads: workflow jobs --------------------------------------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        items: [
          {
            id: 'job-uuid-1',
            name: 'test',
            type: 'build',
            status: 'running',
            number: 7,
            started_at: '2026-11-18T10:01:00Z',
            stopped_at: null,
            project: { slug: 'gh/acme/web' },
          },
        ],
        next_page_token: 'jobs-2',
      }),
    )
    const result = await runTool('com.circleci.main', 'get_workflow_jobs', {
      input: { workflow_id: 'wf-1' },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/workflow/wf-1/job',
      'circleci get_workflow_jobs: workflow job URL (no token when not supplied)',
    )
    equal(result.data.jobs[0].job_number, 7, 'circleci get_workflow_jobs: job_number falls back to number')
    equal(result.data.jobs[0].project_slug, 'gh/acme/web', 'circleci get_workflow_jobs: project slug fallback')
    equal(result.data.jobs[0].stopped_at, '', 'circleci get_workflow_jobs: null stopped_at becomes ""')
    equal(result.data.next_page_token, 'jobs-2', 'circleci get_workflow_jobs: next_page_token')
  }

  // --- Reads: job detail (log link), artifacts, tests -----------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        id: 'job-uuid-1',
        name: 'test',
        type: 'build',
        status: 'failed',
        number: 7,
        job_number: 7,
        started_at: '2026-11-18T10:01:00Z',
        stopped_at: '2026-11-18T10:04:00Z',
        duration: 180000,
        web_url: 'https://app.circleci.com/pipelines/gh/acme/web/42/workflows/wf-1/jobs/7',
        parallelism: 2,
        organization: { name: 'acme' },
        pipeline: { number: 42 },
        latest_workflow: { id: 'wf-1', name: 'build-and-deploy' },
        project: { slug: 'gh/acme/web' },
      }),
    )
    const result = await runTool('com.circleci.main', 'get_job', {
      input: { project_slug: 'gh/acme/web', job_number: 7 },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/project/gh/acme/web/job/7',
      'circleci get_job: project job URL',
    )
    equal(result.data.job.duration, 180000, 'circleci get_job: duration in ms')
    equal(result.data.job.parallelism, 2, 'circleci get_job: parallelism')
    equal(result.data.job.workflow_id, 'wf-1', 'circleci get_job: latest workflow id')
    ok(
      result.data.job.web_url.includes('/jobs/7'),
      'circleci get_job: web_url points at the job log page',
    )
  }

  {
    const { requests, page } = circleciPage(() =>
      json({
        items: [{ path: 'logs/test.log', url: 'https://artifacts/logs/test.log', node_index: 1 }],
        next_page_token: '',
      }),
    )
    const artifacts = await runTool('com.circleci.main', 'get_job_artifacts', {
      input: { project_slug: 'gh/acme/web', job_number: 7 },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/project/gh/acme/web/7/artifacts',
      'circleci get_job_artifacts: artifacts URL',
    )
    equal(artifacts.data.artifacts[0].path, 'logs/test.log', 'circleci get_job_artifacts: artifact path')
    equal(artifacts.data.artifacts[0].node_index, 1, 'circleci get_job_artifacts: node index')
  }

  {
    const { requests, page } = circleciPage(() =>
      json({
        items: [
          {
            name: 'test_adds_user',
            classname: 'tests.UserTest',
            result: 'failure',
            message: 'expected 200, got 500',
            run_time: 1.25,
            source: 'tests/user_test.py',
          },
        ],
        next_page_token: '',
      }),
    )
    const tests = await runTool('com.circleci.main', 'get_job_tests', {
      input: { project_slug: 'gh/acme/web', job_number: 7 },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/project/gh/acme/web/7/tests',
      'circleci get_job_tests: tests URL',
    )
    equal(tests.data.tests[0].classname, 'tests.UserTest', 'circleci get_job_tests: classname')
    equal(tests.data.tests[0].message, 'expected 200, got 500', 'circleci get_job_tests: failure message')
    equal(tests.data.tests[0].run_time, 1.25, 'circleci get_job_tests: run time')
  }

  // --- Write: trigger_pipeline ----------------------------------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        id: 'pipe-new',
        number: 43,
        state: 'created',
        created_at: '2026-11-19T09:00:00Z',
        updated_at: '2026-11-19T09:00:00Z',
        project_slug: 'gh/acme/web',
        trigger: { type: 'api', actor: { login: 'octocat', avatar_url: '' } },
        vcs: { branch: 'main', revision: '', commit: {}, provider_name: 'GitHub' },
      }),
    )
    const result = await runTool('com.circleci.main', 'trigger_pipeline', {
      input: {
        project_slug: 'gh/acme/web',
        branch: 'main',
        parameters: { deploy_env: 'staging', retries: 2 },
      },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/project/gh/acme/web/pipeline',
      'circleci trigger_pipeline: POST URL',
    )
    equal(requests[0].init.method, 'POST', 'circleci trigger_pipeline: POST')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/json',
      'circleci trigger_pipeline: JSON content type',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(JSON.stringify(body), JSON.stringify({ branch: 'main', parameters: { deploy_env: 'staging', retries: 2 } }),
      'circleci trigger_pipeline: body carries branch + typed parameters, omits unset tag')
    equal(result.data.pipeline.number, 43, 'circleci trigger_pipeline: returns the created pipeline')
    equal(result.data.pipeline.trigger_type, 'api', 'circleci trigger_pipeline: trigger type')
  }

  // --- Write: update_schedule (PATCH, only provided fields) ------------------
  {
    const { requests, page } = circleciPage(() =>
      json({
        id: 'sched-1',
        name: 'nightly',
        description: '',
        timetable: { per_hour: 1, hours_of_day: [3], days_of_week: ['MON'], days_of_month: [], months: [] },
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-19T09:00:00Z',
      }),
    )
    const result = await runTool('com.circleci.main', 'update_schedule', {
      input: {
        schedule_id: 'sched-1',
        attribution_actor: 'system',
        timetable: { per_hour: 1, hours_of_day: [3], days_of_week: ['MON'] },
      },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/schedule/sched-1',
      'circleci update_schedule: PATCH URL',
    )
    equal(requests[0].init.method, 'PATCH', 'circleci update_schedule: PATCH')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/json',
      'circleci update_schedule: JSON content type',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(
      JSON.stringify(Object.keys(body).sort()),
      JSON.stringify(['attribution-actor', 'timetable']),
      'circleci update_schedule: body keeps only the supplied fields',
    )
    equal(body['attribution-actor'], 'system', 'circleci update_schedule: attribution-actor key')
    equal(body.timetable.days_of_week[0], 'MON', 'circleci update_schedule: timetable array preserved')
    equal(result.data.schedule.timetable.hours_of_day[0], 3, 'circleci update_schedule: mapped timetable')
    equal(result.data.schedule.updated_at, '2026-11-19T09:00:00Z', 'circleci update_schedule: updated_at')
  }

  // --- Write: cancel_workflow (POST, 202 with empty body) -------------------
  {
    const { requests, page } = circleciPage(() => ({
      ok: true,
      status: 202,
      headers: { get: () => 'application/json' },
      async text() {
        return '{"message":"Accepted."}'
      },
    }))
    const result = await runTool('com.circleci.main', 'cancel_workflow', {
      input: { workflow_id: 'wf-1' },
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/workflow/wf-1/cancel',
      'circleci cancel_workflow: cancel URL',
    )
    equal(requests[0].init.method, 'POST', 'circleci cancel_workflow: POST')
    equal(requests[0].init.body, undefined, 'circleci cancel_workflow: no body')
    equal(result.status, 'ok', 'circleci cancel_workflow: ok status')
    equal(result.data.success, true, 'circleci cancel_workflow: success flag')
  }

  // --- Auth failure: 401 is AUTH, never a fabricated success ----------------
  {
    const { requests, page } = circleciPage(() => json({ message: 'Unauthorized' }, 401))
    const result = await runTool('com.circleci.main', 'get_current_user', {
      input: {},
      page,
    })
    equal(
      requests[0].url,
      'https://app.circleci.com/api/v2/me',
      'circleci get_current_user: /me URL',
    )
    equal(result.status, 'error', 'circleci auth failure: error status')
    equal(result.error_code, 'AUTH', 'circleci auth failure: AUTH code')
    equal(result.data, null, 'circleci auth failure: no data')
    ok(
      result.message.includes('401') && result.message.includes('/me'),
      'circleci auth failure: message names the status and endpoint',
    )
  }

  // --- 404 keeps its own classification ------------------------------------
  {
    const { page } = circleciPage(() => json({ message: 'Project not found' }, 404))
    const result = await runTool('com.circleci.main', 'get_project', {
      input: { project_slug: 'gh/acme/missing' },
      page,
    })
    equal(result.error_code, 'NOT_FOUND', 'circleci get_project 404: NOT_FOUND')
  }

  // --- Other hosts are refused before any request ---------------------------
  {
    const { requests, page } = circleciPage(() => json({}), { hostname: 'circleci.com' })
    const result = await runTool('com.circleci.main', 'list_pipelines', {
      input: { project_slug: 'gh/acme/web' },
      page,
    })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'circleci wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'circleci wrong host: makes no request')
  }

  // --- urlRegex matches the dashboard (with tail) and nothing else ----------
  {
    const manifest = JSON.parse(
      readFileSync(path.join(packagesDir, 'com.circleci.main', 'manifest.json'), 'utf8'),
    )
    equal(manifest.id, 'com.circleci.main', 'circleci manifest id')
    equal(manifest.version, '0.1.0', 'circleci manifest version')
    equal(manifest.tools.length, 33, 'circleci manifest tool count')
    const tool = manifest.tools[0]
    const regex = new RegExp(tool.urlRegex)
    const matches = [
      'https://app.circleci.com/pipelines/gh/acme/web',
      'https://app.circleci.com/pipelines/gh/acme/web?branch=main',
      'https://app.circleci.com/pipelines/gh/acme/web/42/workflows/wf-1/jobs/7#step-1',
      'https://app.circleci.com/',
    ]
    for (const href of matches) ok(regex.test(href), `circleci urlRegex matches ${href}`)
    const misses = [
      'https://circleci.com/pipelines/gh/acme/web',
      'https://www.circleci.com/pipelines/gh/acme/web',
      'https://app.circleci.com.evil.example/pipelines',
      'http://app.circleci.com/pipelines',
      'https://app.circleci.com',
    ]
    for (const href of misses) ok(!regex.test(href), `circleci urlRegex rejects ${href}`)
  }
}
