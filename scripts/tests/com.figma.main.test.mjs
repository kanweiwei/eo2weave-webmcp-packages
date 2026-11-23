/**
 * com.figma.main — execution tests against a stubbed Figma tab.
 *
 * Identity is the `__Host-figma.authn-state=1` cookie plus the fuid/teamId
 * decoded from the `recent_user_data` cookie (URL-encoded JSON string wrapping
 * base64 JSON) — exactly what the ported transport extracts. The API is
 * same-origin at https://www.figma.com/api with `fuid=` auto-appended.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

const RECENT_USER_DATA = Buffer.from(
  JSON.stringify({ fileBrowserUserId: '42', userIdToPlan: { '42': ['pro', '777'] } }),
).toString('base64')

/** A signed-in Figma tab: authn cookie + recent_user_data fuid/teamId. */
function figmaPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'figma.com',
    href: 'https://www.figma.com/files/team/777',
    cookie: `__Host-figma.authn-state=1; recent_user_data=${encodeURIComponent(JSON.stringify(RECENT_USER_DATA))}`,
    // Figma's transport calls AbortSignal.timeout / DOMException inside its
    // fetch wrapper — the sandbox only gets them when the page provides them.
    globals: { AbortSignal: globalThis.AbortSignal, DOMException: globalThis.DOMException },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.figma.main: identity')

  {
    const { requests, page } = figmaPage(() => jsonResponse({}), { cookie: '' })
    const result = await runTool('com.figma.main', 'list_files', { input: { folder_id: 'f1' }, page })
    equal(result.status, 'error', 'figma signed out: error status')
    equal(result.error_code, 'AUTH', 'figma signed out: AUTH')
    equal(requests.length, 0, 'figma signed out: makes no request')
  }

  section('com.figma.main: reads')

  {
    const { requests, page } = figmaPage(() =>
      jsonResponse({
        meta: {
          files: [
            {
              key: 'abc123',
              name: 'Landing',
              description: null,
              editor_type: 'design',
              team_id: '777',
              folder_id: 'f1',
              creator_id: '42',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              thumbnail_url: null,
              url: 'https://www.figma.com/file/abc123/Landing',
              link_access: 'view',
              trashed_at: null,
            },
          ],
        },
      }),
    )
    const result = await runTool('com.figma.main', 'list_files', { input: { folder_id: 'f1' }, page })
    if (result.status !== 'ok') console.log('FIGMA FILES', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'figma list_files: ok')
    equal(result.data.files.length, 1, 'figma list_files: one file')
    equal(result.data.files[0].key, 'abc123', 'figma list_files: key mapped')
    equal(result.data.files[0].editor_type, 'design', 'figma list_files: editor_type mapped')
    equal(requests.length, 1, 'figma list_files: one request')
    ok(
      requests[0].url.startsWith('https://www.figma.com/api/folders/f1/files'),
      'figma: same-origin /api path with folder id',
    )
    ok(requests[0].url.includes('fuid=42'), 'figma: fuid auto-appended')
    equal(requests[0].init.credentials, 'include', 'figma: cookies sent')
  }

  {
    const { page } = figmaPage(() =>
      jsonResponse({
        meta: {
          users: [
            { id: '42', name: 'Ada', handle: 'ada', email: 'ada@example.com', img_url: '', created_at: '2026-01-01' },
          ],
        },
      }),
    )
    const result = await runTool('com.figma.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('FIGMA USER', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'figma get_current_user: ok')
    equal(result.data.user.id, '42', 'figma get_current_user: id from session state')
    equal(result.data.user.handle, 'ada', 'figma get_current_user: handle mapped')
  }

  section('com.figma.main: writes')

  {
    const { requests, page } = figmaPage(() =>
      jsonResponse({
        meta: { id: 991, message: 'hello', user_id: '42', user_handle: 'Ada', created_at: '2026-01-03', resolved_at: null, parent_id: null },
      }),
    )
    const result = await runTool('com.figma.main', 'post_comment', {
      input: { file_key: 'abc123', message: 'hello' },
      page,
    })
    equal(result.status, 'ok', 'figma post_comment: ok')
    equal(result.data.comment.message, 'hello', 'figma post_comment: comment mapped')
    equal(requests[0].init.method, 'POST', 'figma post_comment: POST')
    equal(JSON.parse(requests[0].init.body).message, 'hello', 'figma post_comment: message body')
    ok(
      requests[0].url.startsWith('https://www.figma.com/api/file/abc123/comments'),
      'figma post_comment: file-scoped comments path',
    )
  }

  section('com.figma.main: failures')

  {
    const { page } = figmaPage(() => jsonResponse({ error: true, status: 403, message: 'nope' }, 200))
    const result = await runTool('com.figma.main', 'list_files', { input: { folder_id: 'f1' }, page })
    equal(result.status, 'error', 'figma 403 envelope: error status')
    equal(result.error_code, 'AUTH', 'figma 403 envelope: AUTH')
  }

  section('com.figma.main: wrong page')

  {
    const { page } = figmaPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.figma.main', 'list_files', { input: { folder_id: 'f1' }, page })
    equal(result.status, 'error', 'figma wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'figma wrong host: UNSUPPORTED_PAGE')
  }
}
