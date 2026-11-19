// Execution tests for com.x.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime speaks X's GraphQL API the way the web client does:
// https://x.com/i/api/graphql/<queryId>/<operation>, GET for queries and POST
// for mutations, authorised by the tab's ct0 cookie plus the static web client
// bearer token. Query hashes are discovered from the page's webpack chunk
// registry on every call (X rotates them), so every test supplies a stub
// registry and asserts the exact request the workflow makes plus the parsed
// output.

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const CT0 = 'csrf-token-abc'

const jsonResponse = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => headers[String(name).toLowerCase()] ?? 'application/json',
  },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
})

/** The query hashes the stub webpack registry "publishes". */
const HASHES = {
  HomeTimeline: 'hash-home-timeline',
  HomeLatestTimeline: 'hash-home-latest',
  UserTweets: 'hash-user-tweets',
  TweetResultByRestId: 'hash-tweet-result',
  CreateTweet: 'hash-create-tweet',
  DeleteTweet: 'hash-delete-tweet',
  TweetDetail: 'hash-tweet-detail',
  PinTweet: 'hash-pin-tweet',
  UserByScreenName: 'hash-user-by-screen-name',
  UserByRestId: 'hash-user-by-rest-id',
  Following: 'hash-following',
  Likes: 'hash-likes',
  FavoriteTweet: 'hash-favorite',
  UnfavoriteTweet: 'hash-unfavorite',
  CreateRetweet: 'hash-create-retweet',
  DeleteRetweet: 'hash-delete-retweet',
  CreateBookmark: 'hash-create-bookmark',
  DeleteBookmark: 'hash-delete-bookmark',
  Favoriters: 'hash-favoriters',
  Retweeters: 'hash-retweeters',
  Bookmarks: 'hash-bookmarks',
  ExploreSidebar: 'hash-explore-sidebar',
  SearchTimeline: 'hash-search-timeline',
  ListByRestId: 'hash-list-by-rest-id',
  CreateList: 'hash-create-list',
  UpdateList: 'hash-update-list',
  DeleteList: 'hash-delete-list',
  ListRankedTweetsTimeline: 'hash-list-ranked',
  ListAddMember: 'hash-list-add-member',
  ListRemoveMember: 'hash-list-remove-member',
}

/**
 * A stub of X's webpack chunk registry. The runtime scans module sources for
 * `queryId:"…",operationName:"…"` markers and for the transaction-id signer
 * module (`jJ:()=>`), then uses `chunks.push([...], {}, runtime)` to obtain a
 * require function — all of which this reproduces.
 */
function makeChunkRegistry({ hashes = HASHES, signed = true } = {}) {
  const modules = {}
  let id = 100
  for (const [op, hash] of Object.entries(hashes)) {
    modules[id++] = new Function(`return {queryId:"${hash}",operationName:"${op}"}`)
  }
  if (signed) modules[42] = new Function('return "jJ:()=>sign"')
  const chunks = [[1, modules]]
  chunks.push = function (entry) {
    Array.prototype.push.call(chunks, entry)
    const runtime = entry[2]
    if (typeof runtime === 'function') {
      runtime((moduleId) => (moduleId === 42 ? { jJ: async () => 'tx-id-1' } : {}))
    }
  }
  return chunks
}

/** A stubbed x.com tab. */
function xPage(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'x.com',
      origin: 'https://x.com',
      href: 'https://x.com/home',
      cookie: `auth_token=session-token; ct0=${CT0}; lang=en`,
      globals: { webpackChunk_twitter_responsive_web: makeChunkRegistry() },
      fetch: async (url, init) => {
        requests.push({ url: String(url), init })
        return handler(String(url), init, requests.length)
      },
      ...overrides,
    },
  }
}

const USER_RESULT = {
  __typename: 'User',
  rest_id: '9',
  is_blue_verified: true,
  core: { name: 'Ada Lovelace', screen_name: 'ada', created_at: '2009-03-21T00:00:00.000Z' },
  legacy: {
    followers_count: 1200,
    friends_count: 34,
    statuses_count: 5678,
    description: 'legacy bio',
    profile_image_url_https: 'https://pbs.twimg.com/ada_normal.jpg',
    profile_banner_url: 'https://pbs.twimg.com/banner.jpg',
    location: 'London',
    url: 'https://ada.example',
  },
  profile_bio: { description: 'Analytical engines' },
  avatar: { image_url: 'https://pbs.twimg.com/ada.jpg' },
}

const TWEET = {
  __typename: 'Tweet',
  rest_id: '111',
  core: { user_results: { result: USER_RESULT } },
  legacy: {
    full_text: 'hello x',
    created_at: '2026-11-01T10:00:00.000Z',
    reply_count: 2,
    retweet_count: 3,
    favorite_count: 4,
    quote_count: 5,
    bookmark_count: 6,
    lang: 'en',
    conversation_id_str: '111',
    in_reply_to_status_id_str: '99',
    in_reply_to_user_id_str: '8',
  },
  views: { count: '1234' },
}

/** One URT timeline page: one tweet entry plus a bottom cursor. */
function timeline(tweets = [TWEET], cursor = 'cursor-bottom-1') {
  const entries = tweets.map((tweet, index) => ({
    entryId: `tweet-${index}`,
    content: { itemContent: { tweet_results: { result: tweet } } },
  }))
  if (cursor) entries.push({ entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } })
  return { instructions: [{ type: 'TimelineAddEntries', entries }] }
}

const LIST = {
  id_str: '77',
  legacy: {
    name: 'Builders',
    description: 'people who ship',
    member_count: 12,
    subscriber_count: 3,
    mode: 'Private',
    created_at: '2026-01-01T00:00:00.000Z',
  },
}

const bodyOf = (request) => JSON.parse(request.init.body)

export default async function register({ ok, equal, section, runTool, root, packagesDir }) {
  // --- urlRegex ------------------------------------------------------------
  section('urlRegex probe: x.com')

  {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const manifest = JSON.parse(
      readFileSync(path.join(packagesDir, 'com.x.main', 'manifest.json'), 'utf8'),
    )
    const mustMatch = [
      'https://x.com/home',
      'https://x.com/',
      'https://x.com',
      'https://x.com/ada/status/111',
      'https://x.com/ada/status/111?s=20',
      'https://x.com/search?q=%23webmcp&src=typed_query',
      'https://x.com/i/lists/77',
      'https://x.com/i/web/status/111#replies',
      'https://www.x.com/home',
      'http://x.com/home',
      'https://mobile.x.com/ada',
    ]
    const mustNotMatch = [
      'https://x.com.evil.example/home',
      'https://notx.com/home',
      'https://evilx.com/home',
      'https://x.co/home',
      'https://twitter.com/home',
      'https://example.com/?next=https://x.com/home',
      'https://x.com@evil.example/home',
    ]
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch) ok(regex.test(url), `x urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch) ok(!regex.test(url), `x urlRegex rejects ${url} (${tool.name})`)
    }
  }

  // --- reads ---------------------------------------------------------------
  section('execution: X reads')

  {
    // get_home_timeline: a POST (HomeTimeline is a "mutation"-shaped call in the
    // web client), first page carries latestControlAvailable.
    const { requests, page } = xPage(() => jsonResponse({ data: { home: { home_timeline_urt: timeline() } } }))
    const result = await runTool('com.x.main', 'get_home_timeline', { input: {}, page })
    equal(result.status, 'ok', 'x get_home_timeline: status')
    equal(result.message, null, 'x get_home_timeline: null message')
    equal(result.data.tweets.length, 1, 'x get_home_timeline: one tweet')
    equal(result.data.tweets[0].id, '111', 'x get_home_timeline: tweet id')
    equal(result.data.tweets[0].text, 'hello x', 'x get_home_timeline: tweet text')
    equal(result.data.tweets[0].author_screen_name, 'ada', 'x get_home_timeline: author handle')
    equal(result.data.tweets[0].author_name, 'Ada Lovelace', 'x get_home_timeline: author name')
    equal(result.data.tweets[0].author_id, '9', 'x get_home_timeline: author id')
    equal(result.data.tweets[0].like_count, 4, 'x get_home_timeline: like count mapped from favorite_count')
    equal(result.data.tweets[0].retweet_count, 3, 'x get_home_timeline: retweet count')
    equal(result.data.tweets[0].view_count, '1234', 'x get_home_timeline: view count is a string')
    equal(result.data.tweets[0].is_reply, true, 'x get_home_timeline: reply flag')
    equal(result.data.tweets[0].in_reply_to_user_id, '8', 'x get_home_timeline: reply target')
    equal(result.data.cursor, 'cursor-bottom-1', 'x get_home_timeline: bottom cursor')
    equal(requests.length, 1, 'x get_home_timeline: one request')
    equal(
      requests[0].url,
      `https://x.com/i/api/graphql/${HASHES.HomeTimeline}/HomeTimeline`,
      'x get_home_timeline: GraphQL URL',
    )
    equal(requests[0].init.method, 'POST', 'x get_home_timeline: POST')
    equal(requests[0].init.credentials, 'include', 'x get_home_timeline: sends credentials')
    equal(requests[0].init.headers.authorization, `Bearer ${BEARER}`, 'x get_home_timeline: web bearer')
    equal(requests[0].init.headers['x-csrf-token'], CT0, 'x get_home_timeline: ct0 as csrf token')
    equal(requests[0].init.headers['x-twitter-auth-type'], 'OAuth2Session', 'x get_home_timeline: auth type header')
    const body = bodyOf(requests[0])
    equal(body.queryId, HASHES.HomeTimeline, 'x get_home_timeline: body queryId')
    equal(body.variables.count, 20, 'x get_home_timeline: default count')
    equal(body.variables.includePromotedContent, false, 'x get_home_timeline: no promoted content')
    equal(body.variables.withCommunity, true, 'x get_home_timeline: withCommunity')
    equal(body.variables.latestControlAvailable, true, 'x get_home_timeline: first page flag')
    ok(body.features && body.features.longform_notetweets_rich_text_read_enabled === true, 'x get_home_timeline: default feature flags')
    ok(!('cursor' in body.variables), 'x get_home_timeline: no cursor on the first page')
  }

  {
    // get_latest_timeline with a cursor: different operation, seenTweetIds.
    const { requests, page } = xPage(() => jsonResponse({ data: { home: { home_timeline_urt: timeline() } } }))
    const result = await runTool('com.x.main', 'get_latest_timeline', {
      input: { cursor: 'page-2', count: 5 },
      page,
    })
    equal(result.status, 'ok', 'x get_latest_timeline: status')
    equal(
      requests[0].url,
      `https://x.com/i/api/graphql/${HASHES.HomeLatestTimeline}/HomeLatestTimeline`,
      'x get_latest_timeline: HomeLatestTimeline operation',
    )
    const body = bodyOf(requests[0])
    equal(body.variables.count, 5, 'x get_latest_timeline: explicit count')
    equal(body.variables.cursor, 'page-2', 'x get_latest_timeline: cursor echoed')
    equal(JSON.stringify(body.variables.seenTweetIds), '[]', 'x get_latest_timeline: seenTweetIds on a paged call')
    ok(!('latestControlAvailable' in body.variables), 'x get_latest_timeline: no first-page flag on a paged call')
  }

  {
    // get_user_profile: a GET with USER_FEATURES + fieldToggles.
    const { requests, page } = xPage(() => jsonResponse({ data: { user: { result: USER_RESULT } } }))
    const result = await runTool('com.x.main', 'get_user_profile', {
      input: { screen_name: 'ada' },
      page,
    })
    equal(result.status, 'ok', 'x get_user_profile: status')
    equal(result.data.user.id, '9', 'x get_user_profile: id')
    equal(result.data.user.screen_name, 'ada', 'x get_user_profile: handle')
    equal(result.data.user.name, 'Ada Lovelace', 'x get_user_profile: name')
    equal(result.data.user.description, 'Analytical engines', 'x get_user_profile: profile_bio wins')
    equal(result.data.user.followers_count, 1200, 'x get_user_profile: followers')
    equal(result.data.user.following_count, 34, 'x get_user_profile: following')
    equal(result.data.user.tweet_count, 5678, 'x get_user_profile: tweets')
    equal(result.data.user.verified, true, 'x get_user_profile: blue verified')
    equal(result.data.user.profile_image_url, 'https://pbs.twimg.com/ada.jpg', 'x get_user_profile: avatar.image_url wins')
    equal(result.data.user.location, 'London', 'x get_user_profile: location falls back to legacy')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.UserByScreenName}/UserByScreenName`, 'x get_user_profile: GraphQL path')
    equal(url.searchParams.get('variables'), '{"screen_name":"ada","withGrokTranslatedBio":false}', 'x get_user_profile: variables')
    const features = JSON.parse(url.searchParams.get('features'))
    equal(features.highlights_tweets_tab_ui_enabled, true, 'x get_user_profile: USER_FEATURES sent')
    ok(!('communities_web_enable_tweet_community_results_fetch' in features), 'x get_user_profile: no default features')
    equal(
      url.searchParams.get('fieldToggles'),
      '{"withPayments":false,"withAuxiliaryUserLabels":false}',
      'x get_user_profile: fieldToggles',
    )
    equal(requests[0].init.method, 'GET', 'x get_user_profile: GET')
    equal(requests[0].init.body, undefined, 'x get_user_profile: no body')
  }

  {
    // get_tweet: TweetWithVisibilityResults is unwrapped.
    const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: TWEET }
    const { requests, page } = xPage(() => jsonResponse({ data: { tweetResult: { result: wrapped } } }))
    const result = await runTool('com.x.main', 'get_tweet', { input: { tweet_id: '111' }, page })
    equal(result.status, 'ok', 'x get_tweet: status')
    equal(result.data.tweet.id, '111', 'x get_tweet: unwrapped tweet id')
    equal(result.data.tweet.conversation_id, '111', 'x get_tweet: conversation id')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.TweetResultByRestId}/TweetResultByRestId`, 'x get_tweet: operation')
    equal(
      url.searchParams.get('variables'),
      '{"tweetId":"111","withCommunity":true,"includePromotedContent":false,"withVoice":false}',
      'x get_tweet: variables',
    )
  }

  {
    // get_tweet_replies: TweetDetail, threaded_conversation_with_injections_v2.
    const { requests, page } = xPage(() =>
      jsonResponse({ data: { threaded_conversation_with_injections_v2: timeline([TWEET], 'cursor-bottom-2') } }),
    )
    const result = await runTool('com.x.main', 'get_tweet_replies', {
      input: { tweet_id: '111', cursor: 'c1' },
      page,
    })
    equal(result.status, 'ok', 'x get_tweet_replies: status')
    equal(result.data.tweets.length, 1, 'x get_tweet_replies: thread tweets')
    equal(result.data.cursor, 'cursor-bottom-2', 'x get_tweet_replies: cursor')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.TweetDetail}/TweetDetail`, 'x get_tweet_replies: operation')
    const variables = JSON.parse(url.searchParams.get('variables'))
    equal(variables.focalTweetId, '111', 'x get_tweet_replies: focal tweet')
    equal(variables.rankingMode, 'Relevance', 'x get_tweet_replies: ranking mode')
    equal(variables.withBirdwatchNotes, true, 'x get_tweet_replies: birdwatch notes')
    equal(variables.cursor, 'c1', 'x get_tweet_replies: cursor')
  }

  {
    // search_tweets: SearchTimeline, signed, product default Top.
    const { requests, page } = xPage(() =>
      jsonResponse({ data: { search_by_raw_query: { search_timeline: { timeline: timeline() } } } }),
    )
    const result = await runTool('com.x.main', 'search_tweets', {
      input: { query: 'from:ada webmcp', product: 'Latest' },
      page,
    })
    equal(result.status, 'ok', 'x search_tweets: status')
    equal(result.data.tweets[0].text, 'hello x', 'x search_tweets: parsed tweet')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.SearchTimeline}/SearchTimeline`, 'x search_tweets: operation')
    const variables = JSON.parse(url.searchParams.get('variables'))
    equal(variables.rawQuery, 'from:ada webmcp', 'x search_tweets: rawQuery')
    equal(variables.product, 'Latest', 'x search_tweets: product')
    equal(variables.querySource, 'typed_query', 'x search_tweets: querySource')
    equal(variables.count, 20, 'x search_tweets: default count')
    equal(
      requests[0].init.headers['x-client-transaction-id'],
      'tx-id-1',
      'x search_tweets: signed transaction id',
    )
  }

  {
    // get_trending: ExploreSidebar items mapped to trends.
    const sidebar = {
      data: {
        explore_sidebar: {
          timeline: {
            instructions: [
              {
                entries: [
                  {
                    content: {
                      items: [
                        {
                          item: {
                            itemContent: {
                              name: '#webmcp',
                              // Upstream's mapTrend pulls the query out of a
                              // `query=` parameter, so that is the form X's
                              // ExploreSidebar payload carries.
                              trend_url: { url: 'https://x.com/search?query=%23webmcp&src=trend_click' },
                              trend_metadata: { domain_context: 'Technology · Trending' },
                            },
                          },
                        },
                        {
                          item: {
                            itemContent: {
                              name: 'Something',
                              trend_metadata: {
                                domain_context: '',
                                url: { url: 'https://x.com/explore?noqueryhere=1' },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    }
    const { requests, page } = xPage(() => jsonResponse(sidebar))
    const result = await runTool('com.x.main', 'get_trending', { input: {}, page })
    equal(result.status, 'ok', 'x get_trending: status')
    equal(result.data.trends.length, 2, 'x get_trending: trend count')
    equal(result.data.trends[0].name, '#webmcp', 'x get_trending: trend name')
    equal(result.data.trends[0].domain_context, 'Technology · Trending', 'x get_trending: domain context')
    equal(result.data.trends[0].url, 'https://x.com/search?q=%23webmcp', 'x get_trending: search url')
    equal(result.data.trends[1].url, '', 'x get_trending: no query parameter means no search url')
    equal(requests[0].url.startsWith(`https://x.com/i/api/graphql/${HASHES.ExploreSidebar}/ExploreSidebar?`), true, 'x get_trending: operation URL') // prettier-ignore
    const trendUrl = new URL(requests[0].url)
    equal(trendUrl.searchParams.get('variables'), '{}', 'x get_trending: empty variables')
  }

  {
    // get_bookmarks: bookmark_timeline_v2.
    const { requests, page } = xPage(() =>
      jsonResponse({ data: { bookmark_timeline_v2: { timeline: timeline() } } }),
    )
    const result = await runTool('com.x.main', 'get_bookmarks', { input: { count: 10 }, page })
    equal(result.status, 'ok', 'x get_bookmarks: status')
    equal(result.data.tweets[0].id, '111', 'x get_bookmarks: tweet')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.Bookmarks}/Bookmarks`, 'x get_bookmarks: operation')
    equal(JSON.parse(url.searchParams.get('variables')).count, 10, 'x get_bookmarks: count')
  }

  {
    // get_likers: Favoriters timeline → users.
    const users = {
      instructions: [
        {
          entries: [
            { content: { itemContent: { user_results: { result: USER_RESULT } } } },
            { content: { cursorType: 'Bottom', value: 'users-cursor' } },
          ],
        },
      ],
    }
    const { requests, page } = xPage(() => jsonResponse({ data: { favoriters_timeline: { timeline: users } } }))
    const result = await runTool('com.x.main', 'get_likers', { input: { tweet_id: '111' }, page })
    equal(result.status, 'ok', 'x get_likers: status')
    equal(result.data.users.length, 1, 'x get_likers: user count')
    equal(result.data.users[0].screen_name, 'ada', 'x get_likers: user handle')
    equal(result.data.cursor, 'users-cursor', 'x get_likers: cursor')
    const url = new URL(requests[0].url)
    equal(url.pathname, `/i/api/graphql/${HASHES.Favoriters}/Favoriters`, 'x get_likers: operation')
    equal(JSON.parse(url.searchParams.get('variables')).tweetId, '111', 'x get_likers: tweetId')
  }

  {
    // get_list / get_list_tweets: list reads.
    const listPage = xPage(() => jsonResponse({ data: { list: LIST } }))
    const listResult = await runTool('com.x.main', 'get_list', { input: { list_id: '77' }, page: listPage.page })
    equal(listResult.status, 'ok', 'x get_list: status')
    equal(listResult.data.list.name, 'Builders', 'x get_list: name')
    equal(listResult.data.list.member_count, 12, 'x get_list: member count')
    equal(listResult.data.list.is_private, true, 'x get_list: private mode')
    equal(
      new URL(listPage.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.ListByRestId}/ListByRestId`,
      'x get_list: operation',
    )

    const tweetsPage = xPage(() =>
      jsonResponse({ data: { list: { tweets_timeline: { timeline: timeline() } } } }),
    )
    const tweetsResult = await runTool('com.x.main', 'get_list_tweets', {
      input: { list_id: '77' },
      page: tweetsPage.page,
    })
    equal(tweetsResult.status, 'ok', 'x get_list_tweets: status')
    equal(tweetsResult.data.tweets[0].id, '111', 'x get_list_tweets: tweet')
    equal(
      new URL(tweetsPage.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.ListRankedTweetsTimeline}/ListRankedTweetsTimeline`,
      'x get_list_tweets: operation',
    )
  }

  // --- writes --------------------------------------------------------------
  section('execution: X writes')

  {
    // create_tweet: plain post.
    const { requests, page } = xPage(() =>
      jsonResponse({ data: { create_tweet: { tweet_results: { result: TWEET } } } }),
    )
    const result = await runTool('com.x.main', 'create_tweet', { input: { text: 'hello from webmcp' }, page })
    equal(result.status, 'ok', 'x create_tweet: status')
    equal(result.data.tweet.id, '111', 'x create_tweet: returned tweet')
    equal(result.data.tweet.text, 'hello x', 'x create_tweet: mapped tweet text')
    equal(requests[0].url, `https://x.com/i/api/graphql/${HASHES.CreateTweet}/CreateTweet`, 'x create_tweet: URL')
    equal(requests[0].init.method, 'POST', 'x create_tweet: POST')
    const body = bodyOf(requests[0])
    equal(body.queryId, HASHES.CreateTweet, 'x create_tweet: queryId')
    equal(body.variables.tweet_text, 'hello from webmcp', 'x create_tweet: tweet_text')
    equal(body.variables.dark_request, false, 'x create_tweet: dark_request')
    equal(JSON.stringify(body.variables.media), '{"media_entities":[],"possibly_sensitive":false}', 'x create_tweet: media envelope')
    equal(JSON.stringify(body.variables.semantic_annotation_ids), '[]', 'x create_tweet: annotation ids')
    ok(!('reply' in body.variables), 'x create_tweet: no reply block for a top-level post')
  }

  {
    // create_tweet: reply.
    const { requests, page } = xPage(() =>
      jsonResponse({ data: { create_tweet: { tweet_results: { result: TWEET } } } }),
    )
    const result = await runTool('com.x.main', 'create_tweet', {
      input: { text: 'replying', reply_to_tweet_id: '111' },
      page,
    })
    equal(result.status, 'ok', 'x create_tweet reply: status')
    const body = bodyOf(requests[0])
    equal(
      JSON.stringify(body.variables.reply),
      '{"in_reply_to_tweet_id":"111","exclude_reply_user_ids":[]}',
      'x create_tweet reply: reply block',
    )
  }

  {
    // create_tweet: empty tweet_results is ambiguous, never retried blindly.
    const { page } = xPage(() => jsonResponse({ data: { create_tweet: { tweet_results: {} } } }))
    const result = await runTool('com.x.main', 'create_tweet', { input: { text: 'maybe' }, page })
    equal(result.status, 'error', 'x create_tweet empty result: error status')
    equal(result.error_code, 'EMPTY_RESULT_AMBIGUOUS', 'x create_tweet empty result: ambiguous code')
    ok(String(result.message).includes('double-post'), 'x create_tweet empty result: warns about a double post')

    // GraphQL errors are surfaced verbatim.
    const errored = xPage(() => jsonResponse({ errors: [{ message: 'Tweet needs to be shorter' }] }))
    const failed = await runTool('com.x.main', 'create_tweet', { input: { text: 'x' }, page: errored.page })
    equal(failed.status, 'error', 'x create_tweet graphql error: error status')
    equal(failed.error_code, 'INTERNAL', 'x create_tweet graphql error: INTERNAL')
    equal(failed.message, 'Tweet needs to be shorter', 'x create_tweet graphql error: upstream message')
  }

  {
    // quote_tweet: resolve the author handle, then CreateTweet with attachment_url.
    const { requests, page } = xPage((url) =>
      url.includes('/CreateTweet')
        ? jsonResponse({ data: { create_tweet: { tweet_results: { result: TWEET } } } })
        : jsonResponse({ data: { tweetResult: { result: TWEET } } }),
    )
    const result = await runTool('com.x.main', 'quote_tweet', {
      input: { quoted_tweet_id: '111', text: 'worth reading' },
      page,
    })
    equal(result.status, 'ok', 'x quote_tweet: status')
    equal(requests.length, 2, 'x quote_tweet: resolve then create')
    equal(
      new URL(requests[0].url).pathname,
      `/i/api/graphql/${HASHES.TweetResultByRestId}/TweetResultByRestId`,
      'x quote_tweet: resolves the quoted tweet',
    )
    equal(requests[1].init.method, 'POST', 'x quote_tweet: create is a POST')
    const body = bodyOf(requests[1])
    equal(body.variables.tweet_text, 'worth reading', 'x quote_tweet: text')
    equal(
      body.variables.attachment_url,
      'https://x.com/ada/status/111',
      'x quote_tweet: attachment_url carries the author handle',
    )
  }

  {
    // like / retweet / bookmark / unretweet: one mutation each, exact variable names.
    const like = xPage(() => jsonResponse({ data: { favorite_tweet: 'Done' } }))
    const likeResult = await runTool('com.x.main', 'like_tweet', { input: { tweet_id: '111' }, page: like.page })
    equal(likeResult.status, 'ok', 'x like_tweet: status')
    equal(likeResult.data.success, true, 'x like_tweet: success flag')
    equal(like.requests[0].url, `https://x.com/i/api/graphql/${HASHES.FavoriteTweet}/FavoriteTweet`, 'x like_tweet: URL')
    equal(like.requests[0].init.method, 'POST', 'x like_tweet: POST')
    equal(bodyOf(like.requests[0]).variables.tweet_id, '111', 'x like_tweet: tweet_id')

    const unlike = xPage(() => jsonResponse({ data: { unfavorite_tweet: 'Done' } }))
    const unlikeResult = await runTool('com.x.main', 'unlike_tweet', { input: { tweet_id: '111' }, page: unlike.page })
    equal(unlikeResult.data.success, true, 'x unlike_tweet: success')
    equal(
      new URL(unlike.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.UnfavoriteTweet}/UnfavoriteTweet`,
      'x unlike_tweet: operation',
    )

    const retweet = xPage(() => jsonResponse({ data: { create_retweet: { retweet_results: {} } } }))
    const retweetResult = await runTool('com.x.main', 'retweet', { input: { tweet_id: '111' }, page: retweet.page })
    equal(retweetResult.data.success, true, 'x retweet: success')
    equal(
      retweet.requests[0].url,
      `https://x.com/i/api/graphql/${HASHES.CreateRetweet}/CreateRetweet`,
      'x retweet: URL',
    )
    equal(JSON.stringify(bodyOf(retweet.requests[0]).variables), '{"tweet_id":"111","dark_request":false}', 'x retweet: variables')

    const unretweet = xPage(() => jsonResponse({ data: { unretweet: 'Done' } }))
    const unretweetResult = await runTool('com.x.main', 'unretweet', { input: { tweet_id: '111' }, page: unretweet.page })
    equal(unretweetResult.data.success, true, 'x unretweet: success')
    equal(
      JSON.stringify(bodyOf(unretweet.requests[0]).variables),
      '{"source_tweet_id":"111","dark_request":false}',
      'x unretweet: source_tweet_id',
    )

    const bookmark = xPage(() => jsonResponse({ data: { tweet_bookmark_put: 'Done' } }))
    const bookmarkResult = await runTool('com.x.main', 'bookmark_tweet', { input: { tweet_id: '111' }, page: bookmark.page })
    equal(bookmarkResult.data.success, true, 'x bookmark_tweet: success')
    equal(
      new URL(bookmark.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.CreateBookmark}/CreateBookmark`,
      'x bookmark_tweet: operation',
    )

    const removeBookmark = xPage(() => jsonResponse({ data: { tweet_bookmark_delete: 'Done' } }))
    const removed = await runTool('com.x.main', 'remove_bookmark', { input: { tweet_id: '111' }, page: removeBookmark.page })
    equal(removed.data.success, true, 'x remove_bookmark: success')
    equal(
      new URL(removeBookmark.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.DeleteBookmark}/DeleteBookmark`,
      'x remove_bookmark: operation',
    )
  }

  {
    // delete_tweet / pin_tweet / list membership / create_list.
    const del = xPage(() => jsonResponse({ data: { delete_tweet: {} } }))
    const delResult = await runTool('com.x.main', 'delete_tweet', { input: { tweet_id: '111' }, page: del.page })
    equal(delResult.status, 'ok', 'x delete_tweet: status')
    equal(delResult.data.success, true, 'x delete_tweet: success flag')
    equal(del.requests[0].url, `https://x.com/i/api/graphql/${HASHES.DeleteTweet}/DeleteTweet`, 'x delete_tweet: URL')
    equal(JSON.stringify(bodyOf(del.requests[0]).variables), '{"tweet_id":"111","dark_request":false}', 'x delete_tweet: variables')

    const pin = xPage(() => jsonResponse({ data: { pin_tweet: 'Done' } }))
    const pinResult = await runTool('com.x.main', 'pin_tweet', { input: { tweet_id: '111' }, page: pin.page })
    equal(pinResult.data.success, true, 'x pin_tweet: success')
    equal(
      JSON.stringify(bodyOf(pin.requests[0]).variables),
      '{"tweet_id":"111"}',
      'x pin_tweet: no dark_request',
    )

    const add = xPage(() => jsonResponse({ data: { list_add_member: 'Done' } }))
    const addResult = await runTool('com.x.main', 'add_list_member', {
      input: { list_id: '77', user_id: '9' },
      page: add.page,
    })
    equal(addResult.data.success, true, 'x add_list_member: success')
    equal(
      new URL(add.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.ListAddMember}/ListAddMember`,
      'x add_list_member: operation',
    )
    equal(
      JSON.stringify(bodyOf(add.requests[0]).variables),
      '{"listId":"77","userId":"9"}',
      'x add_list_member: variables',
    )

    const removeMember = xPage(() => jsonResponse({ data: { list_remove_member: 'Done' } }))
    await runTool('com.x.main', 'remove_list_member', { input: { list_id: '77', user_id: '9' }, page: removeMember.page })
    equal(
      JSON.stringify(bodyOf(removeMember.requests[0]).variables),
      '{"listId":"77","userId":"9"}',
      'x remove_list_member: variables',
    )

    const created = xPage(() => jsonResponse({ data: { list: { list: LIST } } }))
    const createResult = await runTool('com.x.main', 'create_list', { input: { name: 'Builders' }, page: created.page })
    equal(createResult.status, 'ok', 'x create_list: status')
    equal(createResult.data.list.id, '77', 'x create_list: created list')
    equal(
      JSON.stringify(bodyOf(created.requests[0]).variables),
      '{"name":"Builders","description":"","isPrivate":false}',
      'x create_list: defaults for description and privacy',
    )

    const updated = xPage(() => jsonResponse({ data: { list_update: { list: LIST } } }))
    const updateResult = await runTool('com.x.main', 'update_list', {
      input: { list_id: '77', is_private: false },
      page: updated.page,
    })
    equal(updateResult.status, 'ok', 'x update_list: status')
    equal(
      JSON.stringify(bodyOf(updated.requests[0]).variables),
      '{"listId":"77","isPrivate":false}',
      'x update_list: only the supplied fields',
    )

    const deleted = xPage(() => jsonResponse({ data: { list_delete: 'Done' } }))
    const deleteListResult = await runTool('com.x.main', 'delete_list', { input: { list_id: '77' }, page: deleted.page })
    equal(deleteListResult.data.success, true, 'x delete_list: success')
    equal(
      new URL(deleted.requests[0].url).pathname,
      `/i/api/graphql/${HASHES.DeleteList}/DeleteList`,
      'x delete_list: operation',
    )
  }

  // --- failures ------------------------------------------------------------
  section('execution: X failure modes')

  {
    // No ct0 (logged out): AUTH before any request.
    const { requests, page } = xPage(() => jsonResponse({}), { cookie: 'auth_token=stale' })
    const result = await runTool('com.x.main', 'get_home_timeline', { input: {}, page })
    equal(result.status, 'error', 'x logged-out: error status')
    equal(result.error_code, 'AUTH', 'x logged-out: AUTH')
    equal(result.message, 'Not authenticated — please log in to X.', 'x logged-out: upstream message')
    equal(requests.length, 0, 'x logged-out: makes no request')
  }

  {
    // 401 from the API is AUTH and keeps the body.
    const { page } = xPage(() => jsonResponse({ message: 'Could not authenticate you' }, 401))
    const result = await runTool('com.x.main', 'get_tweet', { input: { tweet_id: '111' }, page })
    equal(result.error_code, 'AUTH', 'x 401: AUTH')
    ok(String(result.message).startsWith('Auth error (401):'), 'x 401: classified message')
    ok(String(result.message).includes('Could not authenticate you'), 'x 401: body preserved')
  }

  {
    // 429 → RATE_LIMITED with retry_after_ms derived from x-rate-limit-reset.
    const resetAt = Math.floor(Date.now() / 1000) + 120
    const { page } = xPage(() => jsonResponse({}, 429, { 'x-rate-limit-reset': String(resetAt) }))
    const result = await runTool('com.x.main', 'like_tweet', { input: { tweet_id: '111' }, page })
    equal(result.status, 'error', 'x 429: error status')
    equal(result.error_code, 'RATE_LIMITED', 'x 429: RATE_LIMITED')
    equal(result.message, 'Rate limited: FavoriteTweet', 'x 429: upstream message')
    ok(
      typeof result.retry_after_ms === 'number' &&
        result.retry_after_ms > 60_000 &&
        result.retry_after_ms <= 120_000,
      'x 429: retry_after_ms from x-rate-limit-reset',
    )
  }

  {
    // 404 → NOT_FOUND.
    const { page } = xPage(() => jsonResponse({}, 404))
    const result = await runTool('com.x.main', 'delete_tweet', { input: { tweet_id: '111' }, page })
    equal(result.error_code, 'NOT_FOUND', 'x 404: NOT_FOUND')
  }

  {
    // A page whose bundle does not publish the operation hash: INTERNAL, no
    // request. This is upstream's getOpHash failure path.
    const { requests, page } = xPage(() => jsonResponse({}), {
      globals: { webpackChunk_twitter_responsive_web: makeChunkRegistry({ hashes: {} }) },
    })
    const result = await runTool('com.x.main', 'get_home_timeline', { input: {}, page })
    equal(result.status, 'error', 'x unknown operation: error status')
    equal(result.error_code, 'INTERNAL', 'x unknown operation: INTERNAL')
    ok(
      String(result.message).includes('GraphQL operation "HomeTimeline" not found in X client bundle'),
      'x unknown operation: upstream message',
    )
    equal(requests.length, 0, 'x unknown operation: makes no request')
  }

  {
    // A tab on another host is refused before any request.
    const { requests, page } = xPage(() => jsonResponse({}), { hostname: 'twitter.com' })
    const result = await runTool('com.x.main', 'get_home_timeline', { input: {}, page })
    equal(result.status, 'error', 'x wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'x wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'x wrong host: makes no request')
  }

  {
    // Network failure is NETWORK, not a page throw.
    const { page } = xPage(() => {
      throw new Error('connection reset')
    })
    const result = await runTool('com.x.main', 'get_bookmarks', { input: {}, page })
    equal(result.status, 'error', 'x network error: error status')
    equal(result.error_code, 'NETWORK', 'x network error: NETWORK')
    ok(String(result.message).includes('connection reset'), 'x network error: cause preserved')
  }

  {
    // The signer is optional: without a `jJ` module the request still goes out
    // (unsigned), exactly as upstream degrades.
    const { requests, page } = xPage(
      () => jsonResponse({ data: { search_by_raw_query: { search_timeline: { timeline: timeline() } } } }),
      { globals: { webpackChunk_twitter_responsive_web: makeChunkRegistry({ signed: false }) } },
    )
    const result = await runTool('com.x.main', 'search_tweets', { input: { query: 'webmcp' }, page })
    equal(result.status, 'ok', 'x search without signer: status')
    ok(!('x-client-transaction-id' in requests[0].init.headers), 'x search without signer: no signature header')
  }
}
