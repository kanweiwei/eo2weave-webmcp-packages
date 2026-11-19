// Execution tests for com.tumblr.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime lives inside the tumblr.com tab: it reads the redpop
// session out of the page's <script id="___INITIAL_STATE___"> blob, calls the
// same-origin /api/v2 endpoints with `Authorization: Bearer <page token>`,
// `X-Version: redpop/3/0//redpop/`, camelCase JSON and an `x-csrf` header on
// every write. Every fixture below reproduces that page, and every test asserts
// the request the workflow makes plus the parsed output.

const PAGE_ORIGIN = 'https://www.tumblr.com'
const API_TOKEN = 'page-api-token'

/** A stubbed tumblr.com page whose ___INITIAL_STATE___ blob carries the session. */
function tumblrPage({ state = { apiFetchStore: { API_TOKEN }, csrfToken: 'csrf-from-state' }, fetch, hostname = 'www.tumblr.com', href, origin } = {}) {
  const requests = []
  const document = {
    cookie: '',
    getElementById: (id) => (id === '___INITIAL_STATE___' && state ? { textContent: JSON.stringify(state) } : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const page = {
    hostname,
    origin: origin ?? (hostname === 'www.tumblr.com' ? PAGE_ORIGIN : `https://${hostname}`),
    href: href ?? (hostname === 'www.tumblr.com' ? `${PAGE_ORIGIN}/dashboard` : `https://${hostname}/`),
    globals: { document },
    fetch: async (url, init) => {
      requests.push({ url, init })
      return fetch(url, init, requests.length)
    },
  }
  return { page, requests }
}

/** A Tumblr v2 answer: { meta, response }. */
function tumblrResponse(payload, status = 200, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => lower[String(name).toLowerCase()] ?? null,
    },
    async text() {
      if (payload === undefined) return ''
      return typeof payload === 'string' ? payload : JSON.stringify({ meta: { status, msg: 'OK' }, response: payload })
    },
  }
}

function noContent(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: true,
    status: 204,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    async text() {
      return ''
    },
  }
}

const POST = {
  id: 81726354,
  idString: '81726354',
  type: 'text',
  blogName: 'staff',
  postUrl: 'https://staff.tumblr.com/post/81726354/a-post',
  shortUrl: 'https://tmblr.co/Zabc123',
  timestamp: 1735689600,
  date: '2025-01-01 00:00:00 GMT',
  state: 'published',
  tags: ['art', 'photography'],
  summary: 'A post about art',
  noteCount: 12,
  reblogKey: 'reblog-key-1',
  liked: false,
  followed: true,
  canLike: true,
  canReblog: true,
  canReply: true,
  content: [
    { type: 'text', text: 'First paragraph' },
    { type: 'image', media: [] },
    { type: 'text', text: 'Second paragraph' },
  ],
}

const BLOG = {
  name: 'staff',
  title: 'Staff',
  description: 'The official Tumblr blog',
  url: 'https://staff.tumblr.com/',
  posts: 4321,
  followers: 987654,
  isAdult: false,
  ask: true,
  followed: true,
  avatar: [{ url: 'https://64.media.tumblr.com/avatar_staff.png', width: 128, height: 128 }],
}

export default async function register({ ok, equal, section, runTool }) {
  section('execution: com.tumblr.main against a stubbed tumblr.com tab')

  {
    // get_dashboard: same-origin /api/v2/user/dashboard with the page token as a
    // bearer credential, redpop version header, no csrf on a read.
    const { page, requests } = tumblrPage({
      state: { apiFetchStore: { API_TOKEN }, csrfToken: 'csrf-from-state' },
      fetch: async () => tumblrResponse({ posts: [POST] }),
    })
    const result = await runTool('com.tumblr.main', 'get_dashboard', { input: { limit: 20, offset: 0 }, page })
    equal(result.status, 'ok', 'tumblr get_dashboard: status')
    equal(result.data.posts.length, 1, 'tumblr get_dashboard: post count')
    equal(result.data.posts[0].id, '81726354', 'tumblr get_dashboard: 64-bit id kept as a string')
    equal(result.data.posts[0].blog_name, 'staff', 'tumblr get_dashboard: blog name')
    equal(result.data.posts[0].note_count, 12, 'tumblr get_dashboard: note count numeric')
    equal(result.data.posts[0].reblog_key, 'reblog-key-1', 'tumblr get_dashboard: reblog key')
    equal(result.data.posts[0].content_text, 'First paragraph\nSecond paragraph', 'tumblr get_dashboard: NPF text blocks joined')
    equal(requests.length, 1, 'tumblr get_dashboard: one request')
    equal(requests[0].url, '/api/v2/user/dashboard?npf=true&limit=20&offset=0', 'tumblr get_dashboard: dashboard endpoint with npf/limit/offset')
    equal(requests[0].init.method, 'GET', 'tumblr get_dashboard: GET')
    equal(requests[0].init.headers.Authorization, `Bearer ${API_TOKEN}`, 'tumblr get_dashboard: sends the page API token')
    equal(requests[0].init.headers.Accept, 'application/json;format=camelcase', 'tumblr get_dashboard: asks for camelCase JSON')
    equal(requests[0].init.headers['X-Version'], 'redpop/3/0//redpop/', 'tumblr get_dashboard: sends the redpop version')
    equal(requests[0].init.headers['X-Csrf'], undefined, 'tumblr get_dashboard: no csrf header on a read')
    equal(requests[0].init.body, undefined, 'tumblr get_dashboard: read has no body')
    equal(requests[0].init.credentials, 'include', 'tumblr get_dashboard: sends the page cookies')
  }

  {
    // get_blog_info + get_blog_posts: blog reads map the camelCase blog fields
    // and the optional type/tag filters travel on the query string.
    const { page, requests } = tumblrPage({
      fetch: async (url) => {
        if (String(url).indexOf('/info') !== -1) return tumblrResponse({ blog: BLOG })
        return tumblrResponse({ posts: [POST], totalPosts: 4321, blog: { posts: 4321 } })
      },
    })
    const info = await runTool('com.tumblr.main', 'get_blog_info', { input: { blog_name: 'staff.tumblr.com' }, page })
    equal(info.status, 'ok', 'tumblr get_blog_info: status')
    equal(info.data.blog.name, 'staff', 'tumblr get_blog_info: blog name')
    equal(info.data.blog.followers, 987654, 'tumblr get_blog_info: follower count')
    equal(info.data.blog.avatar_url, 'https://64.media.tumblr.com/avatar_staff.png', 'tumblr get_blog_info: avatar url')
    equal(info.data.blog.ask, true, 'tumblr get_blog_info: ask flag')
    equal(requests[0].url, '/api/v2/blog/staff.tumblr.com/info', 'tumblr get_blog_info: blog info endpoint')

    const posts = await runTool('com.tumblr.main', 'get_blog_posts', {
      input: { blog_name: 'staff', limit: 5, tag: 'art', type: 'text' },
      page,
    })
    equal(posts.status, 'ok', 'tumblr get_blog_posts: status')
    equal(posts.data.posts[0].post_url, 'https://staff.tumblr.com/post/81726354/a-post', 'tumblr get_blog_posts: post url')
    equal(posts.data.total_posts, 4321, 'tumblr get_blog_posts: total post count')
    equal(requests[1].url, '/api/v2/blog/staff/posts?npf=true&limit=5&type=text&tag=art', 'tumblr get_blog_posts: filters on the query string')
  }

  {
    // get_post: per-post read with npf=true, mapping only that post.
    const { page, requests } = tumblrPage({ fetch: async () => tumblrResponse(POST) })
    const result = await runTool('com.tumblr.main', 'get_post', { input: { blog_name: 'staff', post_id: '81726354' }, page })
    equal(result.status, 'ok', 'tumblr get_post: status')
    equal(result.data.post.id, '81726354', 'tumblr get_post: id')
    equal(result.data.post.type, 'text', 'tumblr get_post: type')
    equal(result.data.post.tags.join(','), 'art,photography', 'tumblr get_post: tags')
    equal(result.data.post.can_reblog, true, 'tumblr get_post: can_reblog')
    equal(requests[0].url, '/api/v2/blog/staff/posts/81726354?npf=true', 'tumblr get_post: post endpoint')
  }

  {
    // create_post: JSON NPF body, page csrf header, published by default.
    const { page, requests } = tumblrPage({ fetch: async () => tumblrResponse({ id: 90011223, state: 'published' }) })
    const result = await runTool('com.tumblr.main', 'create_post', {
      input: { blog_name: 'myblog', content: 'hello tumblr', tags: 'art, photography' },
      page,
    })
    equal(result.status, 'ok', 'tumblr create_post: status')
    equal(result.data.id, '90011223', 'tumblr create_post: created id as a string')
    equal(result.data.state, 'published', 'tumblr create_post: default state')
    equal(requests.length, 1, 'tumblr create_post: one request (csrf came from the page)')
    equal(requests[0].url, '/api/v2/blog/myblog/posts', 'tumblr create_post: posts endpoint')
    equal(requests[0].init.method, 'POST', 'tumblr create_post: POST')
    equal(requests[0].init.headers['X-Csrf'], 'csrf-from-state', 'tumblr create_post: sends the page csrf token')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'tumblr create_post: JSON body')
    const body = JSON.parse(requests[0].init.body)
    equal(body.content.length, 1, 'tumblr create_post: one NPF block')
    equal(body.content[0].type, 'text', 'tumblr create_post: NPF text block')
    equal(body.content[0].text, 'hello tumblr', 'tumblr create_post: NPF text')
    equal(body.tags, 'art, photography', 'tumblr create_post: comma-separated tags pass through')
    equal(body.state, 'published', 'tumblr create_post: state in the body')
  }

  {
    // create_post with an expired csrf token: the runtime refreshes it from the
    // x-csrf response header of GET /api/v2/user/info before the write.
    const { page, requests } = tumblrPage({
      state: { apiFetchStore: { API_TOKEN }, csrfToken: '' },
      fetch: async (url, init) => {
        if (String(url) === '/api/v2/user/info' && init.method === 'GET') return tumblrResponse({ user: { name: 'ada' } }, 200, { 'x-csrf': 'fresh-csrf' })
        return tumblrResponse({ id: 5 })
      },
    })
    const result = await runTool('com.tumblr.main', 'create_post', {
      input: { blog_name: 'myblog', content: 'draft me', state: 'draft' },
      page,
    })
    equal(result.status, 'ok', 'tumblr create_post csrf refresh: status')
    equal(result.data.state, 'draft', 'tumblr create_post csrf refresh: draft state')
    equal(requests.length, 2, 'tumblr create_post csrf refresh: refresh then write')
    equal(requests[0].url, '/api/v2/user/info', 'tumblr create_post csrf refresh: refreshes from /user/info')
    equal(requests[0].init.headers['X-Csrf'], undefined, 'tumblr create_post csrf refresh: refresh GET carries no csrf')
    equal(requests[1].init.headers['X-Csrf'], 'fresh-csrf', 'tumblr create_post csrf refresh: write uses the fresh token')
  }

  {
    // reblog_post: the parent tumblelog, post id, reblog key and NPF comment go
    // into the posts body — the same shape the redpop composer posts.
    const { page, requests } = tumblrPage({ fetch: async () => tumblrResponse({ id: 44445555 }) })
    const result = await runTool('com.tumblr.main', 'reblog_post', {
      input: {
        blog_name: 'myblog',
        parent_blog_name: 'staff',
        parent_post_id: '81726354',
        reblog_key: 'reblog-key-1',
        comment: 'nice one',
      },
      page,
    })
    equal(result.status, 'ok', 'tumblr reblog_post: status')
    equal(result.data.id, '44445555', 'tumblr reblog_post: new post id')
    equal(requests[0].url, '/api/v2/blog/myblog/posts', 'tumblr reblog_post: posts endpoint')
    equal(requests[0].init.method, 'POST', 'tumblr reblog_post: POST')
    equal(requests[0].init.headers['X-Csrf'], 'csrf-from-state', 'tumblr reblog_post: sends csrf')
    const body = JSON.parse(requests[0].init.body)
    equal(body.parent_tumblelog_uuid, 'staff', 'tumblr reblog_post: parent blog')
    equal(body.parent_post_id, '81726354', 'tumblr reblog_post: parent post id')
    equal(body.reblog_key, 'reblog-key-1', 'tumblr reblog_post: reblog key')
    equal(body.content[0].text, 'nice one', 'tumblr reblog_post: comment as NPF text')
    equal(body.state, 'published', 'tumblr reblog_post: published')
  }

  {
    // like_post / unlike_post: /api/v2/user/like and /unlike with id+reblog_key.
    const { page, requests } = tumblrPage({ fetch: async () => tumblrResponse({}) })
    const liked = await runTool('com.tumblr.main', 'like_post', { input: { post_id: '81726354', reblog_key: 'reblog-key-1' }, page })
    equal(liked.status, 'ok', 'tumblr like_post: status')
    equal(liked.data.success, true, 'tumblr like_post: success flag')
    equal(requests[0].url, '/api/v2/user/like', 'tumblr like_post: like endpoint')
    equal(JSON.parse(requests[0].init.body).id, '81726354', 'tumblr like_post: post id')
    equal(JSON.parse(requests[0].init.body).reblog_key, 'reblog-key-1', 'tumblr like_post: reblog key')

    const unliked = await runTool('com.tumblr.main', 'unlike_post', { input: { post_id: '81726354', reblog_key: 'reblog-key-1' }, page })
    equal(unliked.status, 'ok', 'tumblr unlike_post: status')
    equal(requests[1].url, '/api/v2/user/unlike', 'tumblr unlike_post: unlike endpoint')
    equal(requests[1].init.headers['X-Csrf'], 'csrf-from-state', 'tumblr unlike_post: sends csrf')
  }

  {
    // delete_post: /api/v2/blog/<blog>/post/delete with the post id, and a 204
    // bodyless success.
    const { page, requests } = tumblrPage({ fetch: async () => noContent() })
    const result = await runTool('com.tumblr.main', 'delete_post', { input: { blog_name: 'myblog', post_id: '81726354' }, page })
    equal(result.status, 'ok', 'tumblr delete_post: status')
    equal(result.data.success, true, 'tumblr delete_post: success flag')
    equal(requests[0].url, '/api/v2/blog/myblog/post/delete', 'tumblr delete_post: delete endpoint')
    equal(requests[0].init.method, 'POST', 'tumblr delete_post: POST')
    equal(requests[0].init.headers['X-Csrf'], 'csrf-from-state', 'tumblr delete_post: sends csrf')
    equal(JSON.parse(requests[0].init.body).id, '81726354', 'tumblr delete_post: post id in the body')
  }

  {
    // Auth failure: a page with no ___INITIAL_STATE___ session fails AUTH before
    // any request; a rejected token (401) is AUTH too, with upstream's message.
    const anonymous = tumblrPage({ state: null, fetch: async () => tumblrResponse({}) })
    const deferred = await runTool('com.tumblr.main', 'get_dashboard', { input: {}, page: anonymous.page })
    equal(deferred.status, 'error', 'tumblr logged out: is an error')
    equal(deferred.error_code, 'AUTH', 'tumblr logged out: is AUTH')
    equal(anonymous.requests.length, 0, 'tumblr logged out: makes no request')

    const rejected = tumblrPage({ fetch: async () => tumblrResponse('Not authorized', 401) })
    const unauthorized = await runTool('com.tumblr.main', 'get_current_user', { input: {}, page: rejected.page })
    equal(unauthorized.status, 'error', 'tumblr 401: is an error')
    equal(unauthorized.error_code, 'AUTH', 'tumblr 401: is AUTH')
    ok(String(unauthorized.message).includes('401'), 'tumblr 401: keeps the status in the message')
  }

  {
    // Failure classification + the wrong-tab guard: 404 → NOT_FOUND, and a
    // non-tumblr host is refused before touching the session or the network.
    const missing = tumblrPage({ fetch: async () => tumblrResponse('Not found', 404) })
    const notFound = await runTool('com.tumblr.main', 'get_post', { input: { blog_name: 'staff', post_id: '1' }, page: missing.page })
    equal(notFound.error_code, 'NOT_FOUND', 'tumblr 404: NOT_FOUND')

    const elsewhere = tumblrPage({ hostname: 'example.com', fetch: async () => tumblrResponse({}) })
    const wrongTab = await runTool('com.tumblr.main', 'get_dashboard', { input: {}, page: elsewhere.page })
    equal(wrongTab.status, 'error', 'tumblr wrong host: is an error')
    equal(wrongTab.error_code, 'UNSUPPORTED_PAGE', 'tumblr wrong host: UNSUPPORTED_PAGE')
    equal(elsewhere.requests.length, 0, 'tumblr wrong host: makes no request')
  }
}
