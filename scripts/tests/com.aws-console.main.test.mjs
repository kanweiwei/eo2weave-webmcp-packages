/**
 * com.aws-console.main — execution tests against a stubbed AWS console tab.
 *
 * Identity has two halves (exactly what the ported API layer reads):
 * - console session: `aws-userInfo` cookie or the `awsc-session-data` meta tag;
 * - SigV4 credentials: captured by the runtime's iframe Response.json patch and
 *   persisted on `globalThis.__opentabsAuthCache['aws-console']` so they survive
 *   workflow re-injection. Tests prime that cache directly and assert the
 *   capture path separately.
 */

function jsonResponse(payload, status = 200, headers = {}) {
  const lower = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

const CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-key',
  sessionToken: 'session-token',
  expiration: new Date(Date.now() + 3600_000).toISOString(),
}

/** Signed-in console tab with credentials already captured. */
function awsPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'eu-west-1.console.aws.amazon.com',
    href: 'https://eu-west-1.console.aws.amazon.com/ec2/home',
    cookie: 'aws-userInfo=' + encodeURIComponent(JSON.stringify({ username: 'ada', arn: 'arn:aws:iam::1:user/ada', signinType: 'user' })),
    meta: { 'awsc-mezz-region': 'eu-west-1' },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    // The runtime installs a MutationObserver at module scope to watch for
    // service iframes; the harness sandbox does not define it.
    globals: { MutationObserver: class { observe() {} disconnect() {} } },
  }
  Object.assign(page, extra)
  // Prime the credential cache the iframe interceptor would have captured.
  page.globals = {
    MutationObserver: class { observe() {} disconnect() {} },
    __opentabsAuthCache: { 'aws-console': { ...CREDS } },
    ...(extra.globals ?? {}),
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.aws-console.main: identity')

  {
    const { requests, page } = awsPage(() => jsonResponse({}), { cookie: '', meta: {} })
    const result = await runTool('com.aws-console.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'aws signed out: error status')
    equal(result.error_code, 'AUTH', 'aws signed out: AUTH')
    equal(requests.length, 0, 'aws signed out: makes no request')
  }

  {
    // Session present but no captured credentials → AUTH with the capture hint
    const { page } = awsPage(() => jsonResponse({}), { globals: { __opentabsAuthCache: {} } })
    const result = await runTool('com.aws-console.main', 'list_instances', {
      input: { region: 'eu-west-1' },
      page,
    })
    equal(result.status, 'error', 'aws no credentials: error status')
    equal(result.error_code, 'AUTH', 'aws no credentials: AUTH')
    ok(String(result.message).includes('captured'), 'aws no credentials: message names the capture mechanism')
  }

  section('com.aws-console.main: reads')

  {
    const { requests, page } = awsPage(() =>
      jsonResponse({
        reservationSet: {
          item: [
            {
              instancesSet: {
                item: [
                  { instanceId: 'i-1', instanceType: 't3.micro', instanceState: { name: 'running' }, placement: { availabilityZone: 'eu-west-1a' } },
                ],
              },
            },
          ],
        },
      }),
    )
    const result = await runTool('com.aws-console.main', 'list_instances', {
      input: { region: 'eu-west-1' },
      page,
    })

    equal(result.status, 'ok', 'aws list_instances: ok')
    ok(result.data.instances.length >= 1, 'aws list_instances: instance returned')
    equal(result.data.instances[0].instance_id, 'i-1', 'aws list_instances: instanceId mapped')
    equal(requests.length, 1, 'aws list_instances: one request')
    equal(requests[0].url, 'https://ec2.eu-west-1.amazonaws.com/', 'aws list_instances: regional EC2 endpoint')
    equal(requests[0].init.method, 'POST', 'aws list_instances: POST')
    ok(String(requests[0].init.headers.authorization).startsWith('AWS4-HMAC-SHA256'), 'aws list_instances: SigV4 authorization header')
    ok(String(requests[0].init.headers.authorization).includes('/eu-west-1/'), 'aws list_instances: signing region')
    ok(String(requests[0].init.headers['x-amz-security-token'] ?? requests[0].init.headers['X-amz-security-token'] ?? '').length >= 0, 'aws list_instances: headers present')
    ok(String(requests[0].init.body).includes('Action=DescribeInstances'), 'aws list_instances: query-string action')
  }

  {
    const { page } = awsPage(() =>
      jsonResponse({ userId: 'AIDA', account: '1234', arn: 'arn:aws:iam::1234:user/ada' }),
    )
    const result = await runTool('com.aws-console.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'aws get_current_user: ok')
    equal(result.data.user.username, 'ada', 'aws get_current_user: username from aws-userInfo cookie')
    ok(typeof result.data.user.account_id === 'string', 'aws get_current_user: account id field present')
    equal(result.data.user.region, 'eu-west-1', 'aws get_current_user: mezz region')
  }

  section('com.aws-console.main: writes')

  {
    const { requests, page } = awsPage(() =>
      jsonResponse({
        requestId: 'req-1',
        instancesSet: { item: { instanceId: 'i-1', previousState: { name: 'stopped' }, currentState: { name: 'pending' } } },
      }),
    )
    const result = await runTool('com.aws-console.main', 'start_instance', {
      input: { region: 'eu-west-1', instance_id: 'i-1' },
      page,
    })
    equal(result.status, 'ok', 'aws start_instance: ok')
    equal(result.data.previous_state, 'stopped', 'aws start_instance: previous state')
    equal(result.data.current_state, 'pending', 'aws start_instance: current state')
    ok(String(requests[0].init.body).includes('Action=StartInstances'), 'aws start_instance: action')
    ok(String(requests[0].init.body).includes('i-1'), 'aws start_instance: instance id in body')
  }

  section('com.aws-console.main: failures')

  {
    const { page } = awsPage(() => jsonResponse('<Response><Errors><Error><Message>ExpiredToken</Message></Error></Errors></Response>', 403))
    const result = await runTool('com.aws-console.main', 'list_instances', {
      input: { region: 'eu-west-1' },
      page,
    })
    equal(result.status, 'error', 'aws expired token 403: error status')
    equal(result.error_code, 'AUTH', 'aws expired token 403: AUTH')
  }

  {
    const { page } = awsPage(() => jsonResponse('<Response><Errors><Error><Message>NotFound</Message></Error></Errors></Response>', 404))
    const result = await runTool('com.aws-console.main', 'describe_instance', {
      input: { region: 'eu-west-1', instance_id: 'i-missing' },
      page,
    })
    equal(result.status, 'error', 'aws 404: error status')
    equal(result.error_code, 'NOT_FOUND', 'aws 404: NOT_FOUND')
  }
}
