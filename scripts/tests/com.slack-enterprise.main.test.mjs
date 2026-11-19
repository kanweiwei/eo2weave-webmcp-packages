// Execution tests for com.slack-enterprise.main.
//
// Upstream (OpenTabs plugins/slack-enterprise) is the Enterprise Grid sibling of
// plugins/slack: the tab is app.slack.com, the credential is an xoxc- workspace
// token plus the xoxp- org token, and every call is a form-encoded same-origin
// POST to /api/<method> carrying the web client's _x_* metadata. These tests
// stub exactly those seams: localStorage.localConfig_v2 with an E-prefix org and
// a T-prefix workspace, the boot_data fallback, and the /api/ responses.

const PKG = 'com.slack-enterprise.main'
const HOST = 'app.slack.com'
const HREF = 'https://app.slack.com/client/E012345/T012345'
const WORKSPACE_TOKEN = 'xoxc-ws-token'
const ENTERPRISE_TOKEN = 'xoxp-ent-token'

const LOCAL_CONFIG = JSON.stringify({
  teams: {
    E012345: { token: ENTERPRISE_TOKEN, url: 'https://acme.slack.com/' },
    T012345: { token: WORKSPACE_TOKEN, url: 'https://acme.slack.com/' },
  },
})

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

/** An app.slack.com tab that records every request. */
function slackPage(
  respond,
  { localStorage = { localConfig_v2: LOCAL_CONFIG }, hostname = HOST, globals } = {},
) {
  const requests = []
  const page = {
    hostname,
    href: `https://${hostname}/client/E012345/T012345`,
    origin: `https://${hostname}`,
    localStorage,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      return respond(String(url), init ?? {}, requests.length)
    },
  }
  if (globals) page.globals = globals
  return { page, requests }
}

function formOf(request) {
  return new URLSearchParams(request.init.body)
}

const CHANNEL_FIXTURE = {
  id: 'C0123',
  name: 'eng-platform',
  is_channel: true,
  is_private: false,
  num_members: 42,
  topic: { value: 'Platform work' },
  purpose: { value: 'Ship the port' },
}

export default async function ({ ok, equal, section, runTool, root, packagesDir }) {
  const { readFileSync, existsSync } = await import('node:fs')
  const path = await import('node:path')

  section('slack-enterprise: workspace / user / channel admin reads')

  {
    // get_my_profile resolves the enterprise session through localConfig_v2 and
    // calls auth.test with the workspace token, never the org token.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        user_id: 'U07ADA',
        user: 'ada',
        team: 'Acme Grid',
        team_id: 'T012345',
        enterprise_id: 'E012345',
      }),
    )
    const result = await runTool(PKG, 'get_my_profile', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee get_my_profile: status')
    equal(result.data.user_id, 'U07ADA', 'slack-ee get_my_profile: user id')
    equal(result.data.team, 'Acme Grid', 'slack-ee get_my_profile: team name')
    equal(result.data.enterprise_id, 'E012345', 'slack-ee get_my_profile: enterprise id')
    equal(requests.length, 1, 'slack-ee get_my_profile: one request')
    equal(requests[0].url, '/api/auth.test', 'slack-ee get_my_profile: same-origin /api/auth.test')
    equal(requests[0].init.method, 'POST', 'slack-ee get_my_profile: POST')
    equal(requests[0].init.credentials, 'include', 'slack-ee get_my_profile: sends credentials')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/x-www-form-urlencoded',
      'slack-ee get_my_profile: form-encoded body',
    )
    const form = formOf(requests[0])
    equal(form.get('token'), WORKSPACE_TOKEN, 'slack-ee get_my_profile: workspace xoxc- token')
    equal(form.get('_x_team_id'), 'T012345', 'slack-ee get_my_profile: _x_team_id is the workspace')
    equal(form.get('_x_reason'), 'api_call', 'slack-ee get_my_profile: client _x_reason metadata')
    equal(form.get('_x_app_name'), 'client', 'slack-ee get_my_profile: client _x_app_name metadata')
  }

  {
    // list_channels applies the schema defaults (types/limit/exclude_archived)
    // and maps topic/purpose to plain strings.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        channels: [CHANNEL_FIXTURE, { id: 'C0456', name: 'secret', is_channel: false, is_private: true }],
        response_metadata: { next_cursor: 'cursor-2' },
      }),
    )
    const result = await runTool(PKG, 'list_channels', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee list_channels: status')
    equal(requests[0].url, '/api/conversations.list', 'slack-ee list_channels: endpoint')
    const form = formOf(requests[0])
    equal(form.get('types'), 'public_channel,private_channel', 'slack-ee list_channels: default types')
    equal(form.get('limit'), '100', 'slack-ee list_channels: default limit 100')
    equal(form.get('exclude_archived'), 'true', 'slack-ee list_channels: excludes archived by default')
    equal(result.data.channels.length, 2, 'slack-ee list_channels: channel count')
    equal(result.data.channels[0].topic, 'Platform work', 'slack-ee list_channels: topic is a string')
    equal(result.data.channels[0].purpose, 'Ship the port', 'slack-ee list_channels: purpose is a string')
    equal(result.data.channels[0].num_members, 42, 'slack-ee list_channels: member count')
    equal(result.data.channels[1].is_private, true, 'slack-ee list_channels: private flag')
    equal(result.data.channels[1].num_members, 0, 'slack-ee list_channels: missing count defaults to 0')
    equal(result.data.pagination.next_cursor, 'cursor-2', 'slack-ee list_channels: next cursor')
  }

  {
    // get_channel_info: an admin read of a single channel.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true, channel: CHANNEL_FIXTURE }))
    const result = await runTool(PKG, 'get_channel_info', { input: { channel: 'C0123' }, page })
    equal(result.status, 'ok', 'slack-ee get_channel_info: status')
    equal(requests[0].url, '/api/conversations.info', 'slack-ee get_channel_info: endpoint')
    equal(formOf(requests[0]).get('channel'), 'C0123', 'slack-ee get_channel_info: channel param')
    equal(result.data.channel.name, 'eng-platform', 'slack-ee get_channel_info: name')
    equal(result.data.channel.topic, 'Platform work', 'slack-ee get_channel_info: topic')
    equal(result.data.channel.is_channel, true, 'slack-ee get_channel_info: public flag')
  }

  {
    // list_users: user admin read with cursor pagination and profile fallbacks.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        members: [
          { id: 'U1', name: 'ada', real_name: 'Ada Lovelace', is_admin: true, is_bot: false },
          { id: 'U2', name: 'grace', profile: { display_name: 'Grace H' }, is_bot: true },
        ],
        response_metadata: { next_cursor: '' },
      }),
    )
    const result = await runTool(PKG, 'list_users', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee list_users: status')
    equal(requests[0].url, '/api/users.list', 'slack-ee list_users: endpoint')
    equal(formOf(requests[0]).get('limit'), '100', 'slack-ee list_users: default limit 100')
    equal(result.data.users[0].is_admin, true, 'slack-ee list_users: admin flag')
    equal(result.data.users[1].real_name, 'Grace H', 'slack-ee list_users: display_name fallback')
    equal(result.data.users[1].is_bot, true, 'slack-ee list_users: bot flag')
    equal(result.data.pagination.next_cursor, '', 'slack-ee list_users: empty cursor surfaced')
  }

  {
    // search_channels is one of the two org-token calls (slackEnterpriseApi):
    // the xoxp- token travels with _x_team_id = the E-prefix org id.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        items: {
          C0123: {
            id: 'C0123',
            name: 'eng-platform',
            member_count: 42,
            is_member: true,
            purpose: { value: 'Platform work' },
            timestamp: 1763500000,
          },
        },
        pagination: { total_count: 1, page: 1, page_count: 1 },
      }),
    )
    const result = await runTool(PKG, 'search_channels', { input: { query: 'platform' }, page })
    equal(result.status, 'ok', 'slack-ee search_channels: status')
    equal(requests[0].url, '/api/search.modules', 'slack-ee search_channels: endpoint')
    const form = formOf(requests[0])
    equal(form.get('token'), ENTERPRISE_TOKEN, 'slack-ee search_channels: org xoxp- token')
    equal(form.get('_x_team_id'), 'E012345', 'slack-ee search_channels: org team id')
    equal(form.get('module'), 'channels', 'slack-ee search_channels: module filter')
    equal(form.get('count'), '20', 'slack-ee search_channels: default count 20')
    equal(result.data.channels[0].member_count, 42, 'slack-ee search_channels: member count')
    equal(result.data.channels[0].purpose, 'Platform work', 'slack-ee search_channels: purpose')
    equal(result.data.channels[0].timestamp, 1763500000, 'slack-ee search_channels: timestamp')
    equal(result.data.total, 1, 'slack-ee search_channels: total')
  }

  {
    // list_channel_members: channel membership read with cap on limit.
    const { page, requests } = slackPage(() =>
      jsonResponse({ ok: true, members: ['U1', 'U2'], response_metadata: { next_cursor: 'c2' } }),
    )
    const result = await runTool(PKG, 'list_channel_members', {
      input: { channel: 'C0123', limit: 5000 },
      page,
    })
    equal(result.status, 'ok', 'slack-ee list_channel_members: status')
    equal(requests[0].url, '/api/conversations.members', 'slack-ee list_channel_members: endpoint')
    equal(formOf(requests[0]).get('limit'), '1000', 'slack-ee list_channel_members: limit capped at 1000')
    equal(result.data.members.length, 2, 'slack-ee list_channel_members: member ids')
    equal(result.data.pagination.next_cursor, 'c2', 'slack-ee list_channel_members: cursor')
  }

  section('slack-enterprise: writes')

  {
    // send_message: form-encoded chat.postMessage on the workspace token.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        message: { type: 'message', user: 'U07ADA', text: 'hello grid', ts: '1763500000.000100' },
      }),
    )
    const result = await runTool(PKG, 'send_message', {
      input: { channel: 'C0123', text: 'hello grid' },
      page,
    })
    equal(result.status, 'ok', 'slack-ee send_message: status')
    equal(requests[0].url, '/api/chat.postMessage', 'slack-ee send_message: endpoint')
    const form = formOf(requests[0])
    equal(form.get('channel'), 'C0123', 'slack-ee send_message: channel')
    equal(form.get('text'), 'hello grid', 'slack-ee send_message: text')
    equal(form.get('token'), WORKSPACE_TOKEN, 'slack-ee send_message: workspace token')
    equal(result.data.message.ts, '1763500000.000100', 'slack-ee send_message: message ts')
  }

  {
    // create_channel is an admin write that must carry team_id, then applies the
    // optional topic with a second call.
    const { page, requests } = slackPage((url) => {
      if (String(url) === '/api/conversations.create') {
        return jsonResponse({
          ok: true,
          channel: { id: 'C0999', name: 'new-team', is_channel: false, is_private: true, num_members: 1 },
        })
      }
      return jsonResponse({ ok: true, channel: { id: 'C0999' }, topic: { value: 'launch' } })
    })
    const result = await runTool(PKG, 'create_channel', {
      input: { name: 'new-team', is_private: true, topic: 'launch' },
      page,
    })
    equal(result.status, 'ok', 'slack-ee create_channel: status')
    equal(requests.length, 2, 'slack-ee create_channel: create + topic calls')
    const create = formOf(requests[0])
    equal(requests[0].url, '/api/conversations.create', 'slack-ee create_channel: endpoint')
    equal(create.get('name'), 'new-team', 'slack-ee create_channel: name')
    equal(create.get('is_private'), 'true', 'slack-ee create_channel: private flag')
    equal(create.get('team_id'), 'T012345', 'slack-ee create_channel: workspace team_id')
    equal(requests[1].url, '/api/conversations.setTopic', 'slack-ee create_channel: setTopic follows')
    equal(formOf(requests[1]).get('channel'), 'C0999', 'slack-ee create_channel: topic targets new channel')
    equal(result.data.channel.id, 'C0999', 'slack-ee create_channel: returned channel id')
    equal(result.data.channel.is_private, true, 'slack-ee create_channel: returned private flag')
  }

  {
    // set_status sends the profile as a JSON string inside the form body, exactly
    // like the Slack web client (nested form encoding).
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }))
    const result = await runTool(PKG, 'set_status', {
      input: { status_text: 'Porting', status_emoji: ':hammer:' },
      page,
    })
    equal(result.status, 'ok', 'slack-ee set_status: status')
    equal(requests[0].url, '/api/users.profile.set', 'slack-ee set_status: endpoint')
    const profile = JSON.parse(formOf(requests[0]).get('profile'))
    equal(profile.status_text, 'Porting', 'slack-ee set_status: status_text')
    equal(profile.status_emoji, ':hammer:', 'slack-ee set_status: status_emoji')
    equal(profile.status_expiration, 0, 'slack-ee set_status: default expiration')
    equal(result.data.success, true, 'slack-ee set_status: success flag')
  }

  {
    // upload_file: the three-step external upload. The pre-signed POST goes to
    // files.slack.com without credentials (auth is in the URL), the body is raw
    // bytes, and the completion call carries the file id as JSON.
    const { page, requests } = slackPage((url) => {
      if (String(url) === '/api/files.getUploadURLExternal') {
        return jsonResponse({
          ok: true,
          upload_url: 'https://files.slack.com/upload/v1/abc',
          file_id: 'F0123',
        })
      }
      if (String(url) === 'https://files.slack.com/upload/v1/abc') {
        return { ok: true, status: 200, headers: { get: () => null } }
      }
      return jsonResponse({
        ok: true,
        files: [{ id: 'F0123', title: 'notes.txt', permalink: 'https://acme.slack.com/files/F0123' }],
      })
    })
    const result = await runTool(PKG, 'upload_file', {
      input: {
        channel: 'C0123',
        content: 'hello upload',
        filename: 'notes.txt',
        is_base64: false,
        initial_comment: 'report attached',
      },
      page,
    })
    equal(result.status, 'ok', 'slack-ee upload_file: status')
    equal(requests.length, 3, 'slack-ee upload_file: url + bytes + complete')
    const first = formOf(requests[0])
    equal(first.get('filename'), 'notes.txt', 'slack-ee upload_file: filename')
    equal(first.get('length'), '12', 'slack-ee upload_file: byte length')
    equal(requests[1].url, 'https://files.slack.com/upload/v1/abc', 'slack-ee upload_file: pre-signed URL')
    equal(requests[1].init.credentials, undefined, 'slack-ee upload_file: no credentials on the upload')
    equal(requests[1].init.body.length, 12, 'slack-ee upload_file: raw byte body')
    equal(requests[1].init.body[0], 104, 'slack-ee upload_file: body starts with "h"')
    const complete = formOf(requests[2])
    equal(requests[2].url, '/api/files.completeUploadExternal', 'slack-ee upload_file: complete endpoint')
    equal(JSON.parse(complete.get('files'))[0].id, 'F0123', 'slack-ee upload_file: file id as JSON')
    equal(complete.get('channel_id'), 'C0123', 'slack-ee upload_file: channel_id')
    equal(complete.get('initial_comment'), 'report attached', 'slack-ee upload_file: initial comment')
    equal(result.data.file_id, 'F0123', 'slack-ee upload_file: result file id')
    equal(result.data.permalink, 'https://acme.slack.com/files/F0123', 'slack-ee upload_file: permalink')
  }

  {
    // A blocked extension is refused before any request leaves the tab.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }))
    const result = await runTool(PKG, 'upload_file', {
      input: { channel: 'C0123', content: 'x', filename: 'setup.exe', is_base64: false },
      page,
    })
    equal(result.status, 'error', 'slack-ee upload_file .exe: error')
    equal(result.error_code, 'VALIDATION', 'slack-ee upload_file .exe: VALIDATION')
    equal(requests.length, 0, 'slack-ee upload_file .exe: no request sent')
  }

  {
    // archive_channel: a bare write that returns the {success:true} shorthand.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }))
    const result = await runTool(PKG, 'archive_channel', { input: { channel: 'C0123' }, page })
    equal(result.status, 'ok', 'slack-ee archive_channel: status')
    equal(requests[0].url, '/api/conversations.archive', 'slack-ee archive_channel: endpoint')
    equal(formOf(requests[0]).get('channel'), 'C0123', 'slack-ee archive_channel: channel')
    equal(result.data.success, true, 'slack-ee archive_channel: success flag')
  }

  section('slack-enterprise: auth')

  {
    // A standard (non-enterprise) workspace has no E-prefix team: this plugin
    // refuses it instead of calling the org APIs with a workspace token.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }), {
      localStorage: { localConfig_v2: JSON.stringify({ teams: { T012345: { token: WORKSPACE_TOKEN } } }) },
    })
    const result = await runTool(PKG, 'get_my_profile', { input: {}, page })
    equal(result.status, 'error', 'slack-ee non-enterprise: error')
    equal(result.error_code, 'AUTH', 'slack-ee non-enterprise: AUTH')
    ok(String(result.message).includes('enterprise'), 'slack-ee non-enterprise: message names the requirement')
    equal(requests.length, 0, 'slack-ee non-enterprise: no request sent')
  }

  {
    // Logged out: no localConfig, no boot_data.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }), { localStorage: {} })
    const result = await runTool(PKG, 'list_channels', { input: {}, page })
    equal(result.status, 'error', 'slack-ee logged out: error')
    equal(result.error_code, 'AUTH', 'slack-ee logged out: AUTH')
    equal(requests.length, 0, 'slack-ee logged out: no request sent')
  }

  {
    // boot_data fallback: api_token + enterprise_id is enough to authenticate,
    // and team_id becomes _x_team_id.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true, user_id: 'U9', team_id: 'T9' }), {
      localStorage: {},
      globals: { boot_data: { api_token: 'xoxc-boot-token', team_id: 'T9', enterprise_id: 'E9' } },
    })
    const result = await runTool(PKG, 'get_my_profile', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee boot_data: status')
    equal(formOf(requests[0]).get('token'), 'xoxc-boot-token', 'slack-ee boot_data: token')
    equal(formOf(requests[0]).get('_x_team_id'), 'T9', 'slack-ee boot_data: team id')
    equal(result.data.user_id, 'U9', 'slack-ee boot_data: parsed user id')
  }

  {
    // Slack's own {ok:false,error} envelope maps invalid_auth to AUTH.
    const { page } = slackPage(() => jsonResponse({ ok: false, error: 'invalid_auth' }))
    const result = await runTool(PKG, 'get_my_profile', { input: {}, page })
    equal(result.status, 'error', 'slack-ee invalid_auth: error')
    equal(result.error_code, 'AUTH', 'slack-ee invalid_auth: AUTH')
    ok(String(result.message).includes('invalid_auth'), 'slack-ee invalid_auth: keeps the Slack error code')
  }

  {
    // HTTP 403 is an auth failure, not an internal one.
    const { page } = slackPage(() => jsonResponse('forbidden', 403))
    const result = await runTool(PKG, 'get_my_profile', { input: {}, page })
    equal(result.status, 'error', 'slack-ee 403: error')
    equal(result.error_code, 'AUTH', 'slack-ee 403: AUTH')
    ok(String(result.message).includes('403'), 'slack-ee 403: status stays visible')
  }

  {
    // list_stars prefers the org-level saved.list and maps its items.
    const { page, requests } = slackPage(() =>
      jsonResponse({
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C0123',
            message: { ts: '1763500000.000100', text: 'pinned thought' },
            date_create: 1763500100,
          },
        ],
        response_metadata: { next_cursor: 'more' },
      }),
    )
    const result = await runTool(PKG, 'list_stars', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee list_stars: status')
    equal(requests[0].url, '/api/saved.list', 'slack-ee list_stars: org saved.list first')
    equal(formOf(requests[0]).get('token'), ENTERPRISE_TOKEN, 'slack-ee list_stars: org token')
    equal(formOf(requests[0]).get('limit'), '50', 'slack-ee list_stars: default count 50')
    equal(result.data.items[0].message_text, 'pinned thought', 'slack-ee list_stars: message text')
    equal(result.data.items[0].date_create, 1763500100, 'slack-ee list_stars: starred timestamp')
    equal(result.data.has_more, true, 'slack-ee list_stars: has_more from next_cursor')
  }

  {
    // A non-auth failure on saved.list falls back to the workspace stars.list.
    const { page, requests } = slackPage((url) => {
      if (String(url) === '/api/saved.list') return jsonResponse({ ok: false, error: 'unknown_method' })
      return jsonResponse({ ok: true, items: [], paging: { page: 1, pages: 1 } })
    })
    const result = await runTool(PKG, 'list_stars', { input: {}, page })
    equal(result.status, 'ok', 'slack-ee list_stars fallback: status')
    equal(requests.length, 2, 'slack-ee list_stars fallback: two calls')
    equal(requests[1].url, '/api/stars.list', 'slack-ee list_stars fallback: workspace stars.list')
    equal(formOf(requests[1]).get('token'), WORKSPACE_TOKEN, 'slack-ee list_stars fallback: workspace token')
    equal(result.data.has_more, false, 'slack-ee list_stars fallback: no more pages')
  }

  {
    // Tools only run on a slack.com tab.
    const { page, requests } = slackPage(() => jsonResponse({ ok: true }), { hostname: 'example.com' })
    const result = await runTool(PKG, 'list_channels', { input: {}, page })
    equal(result.status, 'error', 'slack-ee wrong host: error')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'slack-ee wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'slack-ee wrong host: no request sent')
  }

  section('slack-enterprise: parity and urlRegex')

  {
    // Set comparison against the published upstream manifest (what the registry
    // serves), never a count-only check.
    const cacheFile = path.join(root, '.cache', 'opentabs', 'slack-enterprise-tools.json')
    if (existsSync(cacheFile)) {
      const upstream = JSON.parse(readFileSync(cacheFile, 'utf8')).tools.map((tool) => tool.name).sort()
      const ours = JSON.parse(readFileSync(path.join(packagesDir, PKG, 'manifest.json'), 'utf8'))
        .tools.map((tool) => tool.name)
        .sort()
      equal(ours.join(','), upstream.join(','), 'slack-ee: tool set matches the upstream plugin')
      equal(upstream.length, 54, 'slack-ee: upstream publishes 54 tools')
    } else {
      ok(false, 'slack-ee: upstream manifest cache missing (run scripts/fetch-opentabs.mjs)')
    }

    const manifest = JSON.parse(readFileSync(path.join(packagesDir, PKG, 'manifest.json'), 'utf8'))
    const mustMatch = [
      'https://app.slack.com/',
      'https://app.slack.com/client/E012345',
      'https://app.slack.com/client/E012345/T012345',
      'https://app.slack.com/client/E012345/T012345/c/C0123?thread_ts=1763500000.000100#reply',
    ]
    const mustNotMatch = [
      'https://slack.com/client/E012345',
      'https://acme.slack.com/client/E012345',
      'http://app.slack.com/client/E012345',
      'https://app.slack.com.evil.example/client/E012345',
      'https://evil.app.slack.com/client/E012345',
      'https://user@app.slack.com/client/E012345',
      'https://app.slack.com:8443/client/E012345',
    ]
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch) ok(regex.test(url), `slack-ee urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch) ok(!regex.test(url), `slack-ee urlRegex rejects ${url} (${tool.name})`)
    }
  }
}
