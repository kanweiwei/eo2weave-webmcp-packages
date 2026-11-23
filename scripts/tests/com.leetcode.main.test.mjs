/**
 * com.leetcode.main — execution tests against a stubbed LeetCode tab.
 *
 * Identity is the non-HttpOnly `csrftoken` cookie (sent as `x-csrftoken`);
 * the session cookie itself is HttpOnly. GraphQL goes to
 * https://leetcode.com/graphql/, REST endpoints to https://leetcode.com/...
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

function leetcodePage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'leetcode.com',
    href: 'https://leetcode.com/',
    cookie: 'csrftoken=csrf-tok-1',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.leetcode.main: identity')

  {
    const { requests, page } = leetcodePage(() => jsonResponse({}), { cookie: '' })
    const result = await runTool('com.leetcode.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'leetcode signed out: error status')
    equal(result.error_code, 'AUTH', 'leetcode signed out: AUTH')
    equal(requests.length, 0, 'leetcode signed out: makes no request')
  }

  section('com.leetcode.main: reads')

  {
    const { requests, page } = leetcodePage(() =>
      jsonResponse({
        data: {
          userStatus: {
            userId: 7,
            username: 'ada',
            avatar: 'https://avatars.leetcode.com/ada',
            isSignedIn: true,
            isPremium: false,
            isVerified: true,
            checkedInToday: false,
            notificationStatus: { lastModified: 'x', numUnread: 3 },
          },
        },
      }),
    )
    const result = await runTool('com.leetcode.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('LEET USER', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'leetcode get_current_user: ok')
    equal(result.data.user.userId, 7, 'leetcode get_current_user: userId mapped')
    equal(result.data.user.username, 'ada', 'leetcode get_current_user: username mapped')
    equal(result.data.user.numUnread, 3, 'leetcode get_current_user: numUnread flattened')
    equal(requests.length, 1, 'leetcode get_current_user: one request')
    equal(requests[0].url, 'https://leetcode.com/graphql/', 'leetcode: GraphQL endpoint')
    equal(requests[0].init.method, 'POST', 'leetcode: GraphQL via POST')
    equal(requests[0].init.headers['x-csrftoken'], 'csrf-tok-1', 'leetcode: csrftoken header')
    const body = JSON.parse(requests[0].init.body)
    ok(String(body.query).includes('userStatus'), 'leetcode: GraphQL query body')
  }

  {
    const { requests, page } = leetcodePage(() =>
      jsonResponse({
        data: {
          problemsetQuestionList: {
            totalNum: 1,
            data: [
              {
                frontendQuestionId: '1',
                title: 'Two Sum',
                titleSlug: 'two-sum',
                difficulty: 'Easy',
                acRate: 49.9,
                status: 'AC',
                isFavor: false,
                isPaidOnly: false,
                hasSolution: true,
                hasVideoSolution: false,
                topicTags: [{ name: 'Array', slug: 'array' }],
              },
            ],
          },
        },
      }),
    )
    const result = await runTool('com.leetcode.main', 'list_problems', { input: { limit: 1 }, page })
    equal(result.status, 'ok', 'leetcode list_problems: ok')
    equal(result.data.total, 1, 'leetcode list_problems: totalNum mapped')
    equal(result.data.questions[0].frontendId, '1', 'leetcode list_problems: frontendId mapped')
    equal(result.data.questions[0].topicTags[0].slug, 'array', 'leetcode list_problems: tags mapped')
  }

  section('com.leetcode.main: writes')

  {
    const { requests, page } = leetcodePage((url) => {
      if (String(url).includes('/interpret_solution/')) {
        return jsonResponse({ interpret_id: 'run-9' })
      }
      return jsonResponse({ state: 'SUCCESS', status_code: 15, correct_answer: true, total_correct: 1, total_testcases: 1 })
    })
    const result = await runTool('com.leetcode.main', 'run_code', {
      input: { titleSlug: 'two-sum', questionId: '1', lang: 'python3', typedCode: 'class Solution:pass', dataInput: '[2,7,11,15]\n9' },
      page,
    })
    if (result.status !== 'ok') console.log('LEET RUN', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'leetcode run_code: ok')
    equal(result.data.result.state, 'SUCCESS', 'leetcode run_code: terminal state polled')
    equal(result.data.result.correctAnswer, true, 'leetcode run_code: correct_answer mapped')
    equal(requests[0].init.method, 'POST', 'leetcode run_code: POST')
    ok(
      requests[0].url.startsWith('https://leetcode.com/problems/two-sum/interpret_solution/'),
      'leetcode run_code: interpret_solution path',
    )
    equal(requests[0].init.headers.Referer, 'https://leetcode.com', 'leetcode run_code: Referer header')
    equal(JSON.parse(requests[0].init.body).question_id, '1', 'leetcode run_code: question_id body')
    ok(
      requests[requests.length - 1].url.includes('/submissions/detail/run-9/check/'),
      'leetcode run_code: polls check endpoint',
    )
  }

  section('com.leetcode.main: failures')

  {
    const { page } = leetcodePage(() =>
      jsonResponse({ errors: [{ message: 'not authenticated' }], data: null }),
    )
    const result = await runTool('com.leetcode.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'leetcode GraphQL errors: error status')
    ok(result.error_code !== undefined, 'leetcode GraphQL errors: stable error_code')
  }

  section('com.leetcode.main: wrong page')

  {
    const { page } = leetcodePage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.leetcode.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'leetcode wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'leetcode wrong host: UNSUPPORTED_PAGE')
  }
}
