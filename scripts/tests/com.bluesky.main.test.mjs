// Execution tests for com.bluesky.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime reads the AT Protocol session from the bsky.app page
// (localStorage.BSKY_STORAGE → session.currentAccount) on every call, sends
// AppView queries to https://public.api.bsky.app/xrpc/<nsid> and repository /
// chat writes to the session's PDS, and maps the response with the upstream
// mappers. Every test asserts the exact request the workflow makes plus the
// parsed output.

const DID = 'did:plc:viewer123'
const PDS = 'https://bsky.social'
const APPVIEW = 'https://public.api.bsky.app'
const PAGE_URL = 'https://bsky.app/home'

const SESSION = {
  session: {
    currentAccount: {
      did: DID,
      handle: 'viewer.bsky.social',
      accessJwt: 'jwt-access-token',
      refreshJwt: 'jwt-refresh-token',
      pdsUrl: PDS,
      active: true,
    },
  },
}

const jsonResponse = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => headers[name.toLowerCase()] ?? 'application/json',
  },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
})

/** A stubbed bsky.app tab. */
function bskyPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'bsky.app',
      origin: 'https://bsky.app',
      href: PAGE_URL,
      localStorage: { BSKY_STORAGE: JSON.stringify(SESSION) },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

const post = (over = {}) => ({
  uri: 'at://did:plc:author1/app.bsky.feed.post/3kabc',
  cid: 'bafyrei-author1',
  author: {
    did: 'did:plc:author1',
    handle: 'author.bsky.social',
    displayName: 'Author One',
  },
  record: {
    text: 'hello world',
    createdAt: '2026-11-01T10:00:00.000Z',
  },
  replyCount: 2,
  repostCount: 3,
  likeCount: 4,
  quoteCount: 5,
  indexedAt: '2026-11-01T10:00:01.000Z',
  ...over,
})

const profile = (over = {}) => ({
  did: 'did:plc:author1',
  handle: 'author.bsky.social',
  displayName: 'Author One',
  description: 'bio text',
  avatar: 'https://cdn.bsky.app/avatar.jpg',
  banner: 'https://cdn.bsky.app/banner.jpg',
  followersCount: 10,
  followsCount: 20,
  postsCount: 30,
  indexedAt: '2026-11-01T09:00:00.000Z',
  viewer: {
    following: 'at://did:plc:viewer123/app.bsky.graph.follow/3kfollow',
    followedBy: '',
    muted: false,
    blockedBy: false,
  },
  ...over,
})

export default async function ({ ok, equal, section, runTool, root, packagesDir }) {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.bluesky.main', 'manifest.json'), 'utf8'),
  )

  section('bluesky: urlRegex matches bsky.app and nothing else')

  {
    const re = new RegExp(manifest.tools[0].urlRegex)
    const matches = (href) => {
      const m = re.exec(href)
      return Boolean(m) && m.index === 0 && m[0].length === href.length
    }
    for (const tool of manifest.tools) {
      ok(tool.urlRegex === manifest.tools[0].urlRegex, `bluesky: ${tool.name} shares the page regex`)
    }
    ok(matches('https://bsky.app/'), 'bluesky urlRegex: matches the home page')
    ok(matches('https://bsky.app/home'), 'bluesky urlRegex: matches /home')
    ok(
      matches('https://bsky.app/profile/author.bsky.social/post/3kabc?tab=replies#reply'),
      'bluesky urlRegex: matches a post page with query and hash',
    )
    ok(matches('https://www.bsky.app/search?q=hello'), 'bluesky urlRegex: matches www')
    ok(!matches('https://bsky.app.evil.test/home'), 'bluesky urlRegex: rejects a lookalike suffix host')
    ok(!matches('https://evilbsky.app/home'), 'bluesky urlRegex: rejects an unescaped-dot lookalike')
    ok(!matches('https://bskyapp.com/home'), 'bluesky urlRegex: rejects bskyapp.com')
    ok(!matches('https://notbsky.app/'), 'bluesky urlRegex: rejects a prefixed host')
  }

  section('bluesky: timeline, profile, thread and search reads')

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ feed: [{ post: post() }, { post: post({ uri: 'at://x/2' }) }], cursor: 'next-1' }),
    )
    const result = await runTool('com.bluesky.main', 'get_timeline', {
      input: { cursor: 'abc', limit: 20 },
      page,
    })
    equal(result.status, 'ok', 'bluesky get_timeline: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.feed.getTimeline?cursor=abc&limit=20`,
      'bluesky get_timeline: request URL',
    )
    equal(requests[0].init.method, 'GET', 'bluesky get_timeline: GET')
    equal(
      requests[0].init.headers.Authorization,
      'Bearer jwt-access-token',
      'bluesky get_timeline: bearer token from the page session',
    )
    equal(requests[0].init.credentials, 'omit', 'bluesky get_timeline: cross-origin credential mode')
    equal(requests[0].init.body, undefined, 'bluesky get_timeline: no body')
    equal(result.data.posts.length, 2, 'bluesky get_timeline: two posts')
    equal(result.data.cursor, 'next-1', 'bluesky get_timeline: cursor passthrough')
    const first = result.data.posts[0]
    equal(first.uri, 'at://did:plc:author1/app.bsky.feed.post/3kabc', 'bluesky get_timeline: uri')
    equal(first.author_handle, 'author.bsky.social', 'bluesky get_timeline: author handle')
    equal(first.author_display_name, 'Author One', 'bluesky get_timeline: display name')
    equal(first.text, 'hello world', 'bluesky get_timeline: text')
    equal(first.like_count, 4, 'bluesky get_timeline: like count')
    equal(first.quote_count, 5, 'bluesky get_timeline: quote count')
    equal(first.is_reply, false, 'bluesky get_timeline: not a reply')
    equal(first.has_media, false, 'bluesky get_timeline: no media')
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({
        feed: [
          {
            post: post({
              embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't' }] },
              record: {
                text: 'with a picture',
                createdAt: '2026-11-02T00:00:00.000Z',
                reply: {
                  parent: { uri: 'at://did:plc:p/app.bsky.feed.post/3kp' },
                  root: { uri: 'at://did:plc:r/app.bsky.feed.post/3kr' },
                },
              },
            }),
          },
        ],
      }),
    )
    const result = await runTool('com.bluesky.main', 'get_author_feed', {
      input: { actor: 'author.bsky.social', filter: 'posts_with_media' },
      page,
    })
    equal(result.status, 'ok', 'bluesky get_author_feed: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=author.bsky.social&filter=posts_with_media&limit=50`,
      'bluesky get_author_feed: request URL with default limit',
    )
    equal(result.data.posts[0].has_media, true, 'bluesky get_author_feed: media detected')
    equal(result.data.posts[0].is_reply, true, 'bluesky get_author_feed: reply detected')
    equal(result.data.cursor, '', 'bluesky get_author_feed: empty cursor when absent')
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse(profile()))
    const result = await runTool('com.bluesky.main', 'get_user_profile', {
      input: { actor: 'author.bsky.social' },
      page,
    })
    equal(result.status, 'ok', 'bluesky get_user_profile: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=author.bsky.social`,
      'bluesky get_user_profile: request URL',
    )
    const p = result.data.profile
    equal(p.did, 'did:plc:author1', 'bluesky get_user_profile: did')
    equal(p.followers_count, 10, 'bluesky get_user_profile: followers')
    equal(p.is_following, true, 'bluesky get_user_profile: viewer following')
    equal(p.is_followed_by, false, 'bluesky get_user_profile: viewer followedBy')
    equal(p.is_blocked, false, 'bluesky get_user_profile: viewer blocking')
  }

  {
    // The viewer's own profile is fetched by the session DID, never by a caller
    // supplied actor.
    const { page, requests } = bskyPage(() =>
      jsonResponse(profile({ did: DID, handle: 'viewer.bsky.social', viewer: {} })),
    )
    const result = await runTool('com.bluesky.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'bluesky get_current_user: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(DID)}`,
      'bluesky get_current_user: request URL uses the session DID',
    )
    equal(result.data.profile.handle, 'viewer.bsky.social', 'bluesky get_current_user: handle')
    equal(result.data.profile.is_muted, false, 'bluesky get_current_user: muted default')
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({
        thread: {
          post: post(),
          replies: [
            {
              post: post({ uri: 'at://did:plc:r1/app.bsky.feed.post/1', replyCount: 1 }),
              replies: [
                {
                  post: post({
                    uri: 'at://did:plc:r2/app.bsky.feed.post/2',
                    record: {
                      text: 'nested',
                      createdAt: '2026-11-01T11:00:00.000Z',
                      reply: {
                        parent: { uri: 'at://did:plc:r1/app.bsky.feed.post/1' },
                        root: { uri: 'at://did:plc:author1/app.bsky.feed.post/3kabc' },
                      },
                    },
                  }),
                },
              ],
            },
          ],
        },
      }),
    )
    const result = await runTool('com.bluesky.main', 'get_post_thread', {
      input: { uri: 'at://did:plc:author1/app.bsky.feed.post/3kabc', depth: 2 },
      page,
    })
    equal(result.status, 'ok', 'bluesky get_post_thread: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent('at://did:plc:author1/app.bsky.feed.post/3kabc')}&depth=2&parentHeight=80`,
      'bluesky get_post_thread: request URL with defaults',
    )
    equal(result.data.thread.length, 3, 'bluesky get_post_thread: nested replies flattened')
    equal(
      result.data.thread[2].uri,
      'at://did:plc:r2/app.bsky.feed.post/2',
      'bluesky get_post_thread: depth-first order',
    )
    equal(
      result.data.thread[2].reply_root_uri,
      'at://did:plc:author1/app.bsky.feed.post/3kabc',
      'bluesky get_post_thread: reply root uri',
    )
    equal(
      result.data.thread[2].reply_parent_uri,
      'at://did:plc:r1/app.bsky.feed.post/1',
      'bluesky get_post_thread: reply parent uri',
    )
    equal(result.data.thread[0].reply_root_uri, '', 'bluesky get_post_thread: root has no parent')
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse({ posts: [post(), post({ uri: 'at://x/2' })] }))
    const result = await runTool('com.bluesky.main', 'get_posts', {
      input: { uris: ['at://a/1', 'at://b/2'] },
      page,
    })
    equal(result.status, 'ok', 'bluesky get_posts: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fa%2F1&uris=at%3A%2F%2Fb%2F2`,
      'bluesky get_posts: repeated uris parameter',
    )
    equal(result.data.posts.length, 2, 'bluesky get_posts: two posts')
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ posts: [post()], cursor: 'page-2' }),
    )
    const result = await runTool('com.bluesky.main', 'search_posts', {
      input: { q: 'hello world', sort: 'top', lang: 'en', tag: 'ai', limit: 5 },
      page,
    })
    equal(result.status, 'ok', 'bluesky search_posts: status')
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.feed.searchPosts?q=hello+world&sort=top&lang=en&tag=ai&limit=5`,
      'bluesky search_posts: request URL with filters',
    )
    equal(result.data.posts.length, 1, 'bluesky search_posts: posts parsed')
    equal(result.data.cursor, 'page-2', 'bluesky search_posts: cursor')
  }

  section('bluesky: writes (create, like, repost, delete) hit the session PDS')

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ uri: 'at://did:plc:viewer123/app.bsky.feed.post/3knew', cid: 'bafy-new' }),
    )
    const result = await runTool('com.bluesky.main', 'create_post', {
      input: {
        text: 'new post',
        reply_to_uri: 'at://did:plc:p/app.bsky.feed.post/3kparent',
        reply_to_cid: 'bafy-parent',
      },
      page,
    })
    equal(result.status, 'ok', 'bluesky create_post: status')
    equal(
      requests[0].url,
      `${PDS}/xrpc/com.atproto.repo.createRecord`,
      'bluesky create_post: repository write goes to the PDS',
    )
    equal(requests[0].init.method, 'POST', 'bluesky create_post: POST')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/json',
      'bluesky create_post: JSON content type',
    )
    equal(
      requests[0].init.headers.Authorization,
      'Bearer jwt-access-token',
      'bluesky create_post: bearer token',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(body.repo, DID, 'bluesky create_post: repo is the session DID')
    equal(body.collection, 'app.bsky.feed.post', 'bluesky create_post: collection')
    equal(body.record.$type, 'app.bsky.feed.post', 'bluesky create_post: record type')
    equal(body.record.text, 'new post', 'bluesky create_post: text')
    ok(
      typeof body.record.createdAt === 'string' && body.record.createdAt.endsWith('Z'),
      'bluesky create_post: ISO createdAt',
    )
    equal(body.record.langs[0], 'en', 'bluesky create_post: language tag')
    equal(
      body.record.reply.parent.uri,
      'at://did:plc:p/app.bsky.feed.post/3kparent',
      'bluesky create_post: reply parent uri',
    )
    equal(body.record.reply.parent.cid, 'bafy-parent', 'bluesky create_post: reply parent cid')
    equal(
      body.record.reply.root.uri,
      'at://did:plc:p/app.bsky.feed.post/3kparent',
      'bluesky create_post: root defaults to the parent',
    )
    equal(result.data.uri, 'at://did:plc:viewer123/app.bsky.feed.post/3knew', 'bluesky create_post: uri')
    equal(result.data.cid, 'bafy-new', 'bluesky create_post: cid')
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ uri: 'at://did:plc:viewer123/app.bsky.feed.post/3kplain', cid: 'bafy-plain' }),
    )
    await runTool('com.bluesky.main', 'create_post', { input: { text: 'plain' }, page })
    const body = JSON.parse(requests[0].init.body)
    equal(body.record.reply, undefined, 'bluesky create_post: no reply block for a top-level post')
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ uri: 'at://did:plc:viewer123/app.bsky.feed.like/3klike', cid: 'bafy-like' }),
    )
    const result = await runTool('com.bluesky.main', 'like_post', {
      input: { uri: 'at://did:plc:a/app.bsky.feed.post/3ktarget', cid: 'bafy-target' },
      page,
    })
    equal(result.status, 'ok', 'bluesky like_post: status')
    equal(requests[0].url, `${PDS}/xrpc/com.atproto.repo.createRecord`, 'bluesky like_post: URL')
    const body = JSON.parse(requests[0].init.body)
    equal(body.collection, 'app.bsky.feed.like', 'bluesky like_post: collection')
    equal(body.record.$type, 'app.bsky.feed.like', 'bluesky like_post: record type')
    equal(body.record.subject.uri, 'at://did:plc:a/app.bsky.feed.post/3ktarget', 'bluesky like_post: subject')
    equal(body.record.subject.cid, 'bafy-target', 'bluesky like_post: subject cid')
    equal(
      result.data.like_uri,
      'at://did:plc:viewer123/app.bsky.feed.like/3klike',
      'bluesky like_post: like_uri',
    )
  }

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({ uri: 'at://did:plc:viewer123/app.bsky.feed.repost/3krepost', cid: 'bafy-rp' }),
    )
    const result = await runTool('com.bluesky.main', 'repost', {
      input: { uri: 'at://did:plc:a/app.bsky.feed.post/3ktarget', cid: 'bafy-target' },
      page,
    })
    equal(result.status, 'ok', 'bluesky repost: status')
    const body = JSON.parse(requests[0].init.body)
    equal(body.collection, 'app.bsky.feed.repost', 'bluesky repost: collection')
    equal(body.record.$type, 'app.bsky.feed.repost', 'bluesky repost: record type')
    equal(body.record.subject.cid, 'bafy-target', 'bluesky repost: subject cid')
    equal(
      result.data.repost_uri,
      'at://did:plc:viewer123/app.bsky.feed.repost/3krepost',
      'bluesky repost: repost_uri',
    )
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse({}, 200))
    const result = await runTool('com.bluesky.main', 'delete_post', {
      input: { uri: 'at://did:plc:viewer123/app.bsky.feed.post/3kgone' },
      page,
    })
    equal(result.status, 'ok', 'bluesky delete_post: status')
    equal(requests[0].url, `${PDS}/xrpc/com.atproto.repo.deleteRecord`, 'bluesky delete_post: URL')
    equal(requests[0].init.method, 'POST', 'bluesky delete_post: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.repo, DID, 'bluesky delete_post: repo')
    equal(body.collection, 'app.bsky.feed.post', 'bluesky delete_post: collection')
    equal(body.rkey, '3kgone', 'bluesky delete_post: rkey extracted from the AT URI')
    equal(result.data.success, true, 'bluesky delete_post: success flag')
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse({}, 200))
    const result = await runTool('com.bluesky.main', 'unlike_post', {
      input: { like_uri: 'at://did:plc:viewer123/app.bsky.feed.like/3klike' },
      page,
    })
    equal(result.status, 'ok', 'bluesky unlike_post: status')
    const body = JSON.parse(requests[0].init.body)
    equal(body.collection, 'app.bsky.feed.like', 'bluesky unlike_post: collection')
    equal(body.rkey, '3klike', 'bluesky unlike_post: rkey')
    equal(result.data.success, true, 'bluesky unlike_post: success')
  }

  section('bluesky: app.bsky writes still go to the PDS, not the AppView')

  {
    // muteActor lives in the app.bsky namespace but is a repository write.
    const { page, requests } = bskyPage(() => jsonResponse({}, 200))
    const result = await runTool('com.bluesky.main', 'mute_actor', {
      input: { actor: 'did:plc:noisy' },
      page,
    })
    equal(result.status, 'ok', 'bluesky mute_actor: status')
    equal(
      requests[0].url,
      `${PDS}/xrpc/app.bsky.graph.muteActor`,
      'bluesky mute_actor: app.bsky write goes to the PDS',
    )
    equal(requests[0].init.method, 'POST', 'bluesky mute_actor: POST')
    equal(
      JSON.parse(requests[0].init.body).actor,
      'did:plc:noisy',
      'bluesky mute_actor: body actor',
    )
    equal(result.data.success, true, 'bluesky mute_actor: success flag')
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse({}, 200))
    await runTool('com.bluesky.main', 'mark_notifications_seen', { input: {}, page })
    equal(
      requests[0].url,
      `${PDS}/xrpc/app.bsky.notification.updateSeen`,
      'bluesky mark_notifications_seen: PDS write',
    )
    const body = JSON.parse(requests[0].init.body)
    ok(
      typeof body.seenAt === 'string' && body.seenAt.endsWith('Z'),
      'bluesky mark_notifications_seen: ISO seenAt',
    )
  }

  {
    const { page, requests } = bskyPage(() => jsonResponse({ count: 7 }))
    const result = await runTool('com.bluesky.main', 'get_unread_count', { input: {}, page })
    equal(
      requests[0].url,
      `${APPVIEW}/xrpc/app.bsky.notification.getUnreadCount`,
      'bluesky get_unread_count: AppView read',
    )
    equal(result.data.count, 7, 'bluesky get_unread_count: count')
  }

  section('bluesky: chat goes through the PDS chat proxy')

  {
    const { page, requests } = bskyPage(() =>
      jsonResponse({
        convos: [
          {
            id: 'convo-1',
            unreadCount: 2,
            lastMessage: { text: 'hi there', sentAt: '2026-11-03T00:00:00.000Z' },
            members: [{ did: 'did:plc:peer', handle: 'peer.bsky.social', displayName: 'Peer' }],
            muted: false,
          },
        ],
        cursor: 'c-2',
      }),
    )
    const result = await runTool('com.bluesky.main', 'list_conversations', { input: {}, page })
    equal(result.status, 'ok', 'bluesky list_conversations: status')
    equal(
      requests[0].url,
      `${PDS}/xrpc/chat.bsky.convo.listConvos?limit=25`,
      'bluesky list_conversations: chat XRPC on the PDS',
    )
    equal(
      requests[0].init.headers['atproto-proxy'],
      'did:web:api.bsky.chat#bsky_chat',
      'bluesky list_conversations: atproto-proxy header',
    )
    equal(result.data.conversations[0].unread_count, 2, 'bluesky list_conversations: unread count')
    equal(
      result.data.conversations[0].last_message_text,
      'hi there',
      'bluesky list_conversations: last message',
    )
    equal(
      result.data.conversations[0].members[0].handle,
      'peer.bsky.social',
      'bluesky list_conversations: member mapping',
    )
  }

  section('bluesky: failures are classified, never thrown')

  {
    // No session in the page: no request may leave the tab.
    const { page, requests } = bskyPage(() => jsonResponse({}), {
      localStorage: {},
    })
    const result = await runTool('com.bluesky.main', 'get_timeline', { input: {}, page })
    equal(result.status, 'error', 'bluesky logged-out get_timeline: status')
    equal(result.error_code, 'AUTH', 'bluesky logged-out get_timeline: AUTH')
    equal(requests.length, 0, 'bluesky logged-out get_timeline: makes no request')
  }

  {
    // An inactive account in BSKY_STORAGE is a logged-out tab.
    const { page, requests } = bskyPage(() => jsonResponse({}), {
      localStorage: {
        BSKY_STORAGE: JSON.stringify({
          session: { currentAccount: { ...SESSION.session.currentAccount, active: false } },
        }),
      },
    })
    const result = await runTool('com.bluesky.main', 'create_post', {
      input: { text: 'nope' },
      page,
    })
    equal(result.status, 'error', 'bluesky inactive account create_post: status')
    equal(result.error_code, 'AUTH', 'bluesky inactive account create_post: AUTH')
    equal(requests.length, 0, 'bluesky inactive account create_post: makes no request')
  }

  {
    // AT Protocol reports an expired access token as HTTP 400 {"error":"ExpiredToken"}.
    const { page } = bskyPage(() =>
      jsonResponse({ error: 'ExpiredToken', message: 'Token has expired' }, 400),
    )
    const result = await runTool('com.bluesky.main', 'get_timeline', { input: {}, page })
    equal(result.status, 'error', 'bluesky expired token: status')
    equal(result.error_code, 'AUTH', 'bluesky expired token: AUTH not VALIDATION')
    ok(
      String(result.message).includes('Token has expired'),
      'bluesky expired token: upstream body kept in the message',
    )
  }

  {
    const { page } = bskyPage(() =>
      jsonResponse({ error: 'RateLimitExceeded' }, 429, { 'retry-after': '30' }),
    )
    const result = await runTool('com.bluesky.main', 'search_posts', {
      input: { q: 'x' },
      page,
    })
    equal(result.status, 'error', 'bluesky rate limited: status')
    equal(result.error_code, 'RATE_LIMITED', 'bluesky rate limited: RATE_LIMITED')
    equal(result.retry_after_ms, 30000, 'bluesky rate limited: Retry-After parsed')
  }

  {
    const { page } = bskyPage(() => jsonResponse({ error: 'NotFound' }, 404))
    const result = await runTool('com.bluesky.main', 'get_user_profile', {
      input: { actor: 'ghost.bsky.social' },
      page,
    })
    equal(result.error_code, 'NOT_FOUND', 'bluesky 404: NOT_FOUND')
  }

  {
    const { page } = bskyPage(() => jsonResponse({ error: 'InvalidRequest' }, 400))
    const result = await runTool('com.bluesky.main', 'create_post', {
      input: { text: 'x' },
      page,
    })
    equal(result.error_code, 'VALIDATION', 'bluesky 400 InvalidRequest: VALIDATION')
  }

  {
    // A tab on another host is refused before the session or the network.
    const { page, requests } = bskyPage(() => jsonResponse({}), {
      hostname: 'example.com',
      origin: 'https://example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.bluesky.main', 'get_timeline', { input: {}, page })
    equal(result.status, 'error', 'bluesky wrong host: status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'bluesky wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'bluesky wrong host: makes no request')
  }
}
