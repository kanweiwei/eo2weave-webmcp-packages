// Execution tests for com.asana.main. The Asana web client keeps its session in
// HttpOnly cookies, so the port only relies on the same-origin /api/1.0 calls
// carrying `credentials: 'include'` plus the app's `X-Allow-Asana-Client`
// header on writes, and detects the signed-in user from the numeric
// `window.env._user_id` global.

const PKG = 'com.asana.main'
const ORIGIN = 'https://app.asana.com'
const USER_ID = 1200000000000001

const TASK_OPT_FIELDS =
  'name,completed,assignee.gid,assignee.name,due_on,due_at,start_on,notes,html_notes,projects.gid,projects.name,tags.gid,tags.name,parent.gid,num_subtasks,created_at,modified_at,permalink_url,resource_subtype'
const PROJECT_OPT_FIELDS =
  'name,archived,color,notes,owner.gid,owner.name,team.gid,team.name,created_at,modified_at,due_on,start_on,permalink_url,public'
const STORY_OPT_FIELDS = 'text,created_by.gid,created_by.name,created_at,resource_subtype,type'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

function noContent() {
  return {
    ok: true,
    status: 204,
    headers: { get: () => null },
    async text() {
      return ''
    },
    async json() {
      throw new Error('No Content')
    },
  }
}

/** A logged-in app.asana.com tab that records every request. */
function asanaPage(respond, { userId = USER_ID, hostname = 'app.asana.com' } = {}) {
  const requests = []
  const page = {
    hostname,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {}, path: String(url).replace(ORIGIN, '') })
      return respond(String(url), init, requests.length)
    },
  }
  if (userId !== null) page.globals = { env: { _user_id: userId } }
  return { page, requests }
}

const taskFixture = {
  gid: '1201',
  name: 'Ship the port',
  completed: false,
  assignee: { gid: '900', name: 'Ada Lovelace' },
  due_on: '2026-03-01',
  due_at: null,
  start_on: null,
  notes: 'Plain notes',
  html_notes: '<body>HTML notes</body>',
  projects: [{ gid: '555', name: 'Platform' }],
  tags: [{ gid: '77', name: 'backend' }],
  parent: null,
  num_subtasks: 2,
  created_at: '2026-02-01T09:00:00.000Z',
  modified_at: '2026-02-02T10:00:00.000Z',
  permalink_url: 'https://app.asana.com/0/555/1201',
  resource_subtype: 'default_task',
}

export default async function ({ ok, equal, section, runTool, root, packagesDir }) {
  const { readFileSync } = await import('node:fs')
  const pathMod = await import('node:path')

  section('execution: asana reads against a stubbed app.asana.com tab')

  {
    // list_workspaces: GET /api/1.0/workspaces, no query at all.
    const { page, requests } = asanaPage(() =>
      jsonResponse({ data: [{ gid: '1200', name: 'Acme' }, { gid: '1300', name: 'Personal' }] }),
    )
    const result = await runTool(PKG, 'list_workspaces', { input: {}, page })
    equal(result.status, 'ok', 'asana list_workspaces: status')
    equal(result.data.workspaces.length, 2, 'asana list_workspaces: workspace count')
    equal(result.data.workspaces[1].name, 'Personal', 'asana list_workspaces: workspace name')
    equal(requests[0].url, `${ORIGIN}/api/1.0/workspaces`, 'asana list_workspaces: same-origin /api/1.0 path')
    equal(requests[0].init.method, 'GET', 'asana list_workspaces: GET')
    equal(requests[0].init.credentials, 'include', 'asana list_workspaces: sends credentials')
    equal(requests[0].init.headers.Accept, 'application/json', 'asana list_workspaces: asks for JSON')
    equal(
      requests[0].init.headers['X-Allow-Asana-Client'],
      undefined,
      'asana list_workspaces: no client header on a read',
    )
  }

  {
    // list_projects: workspace filter, default limit, archived omitted when
    // unset, next_page offset surfaced, full project mapping.
    const { page, requests } = asanaPage(() =>
      jsonResponse({
        data: [
          {
            gid: '555',
            name: 'Platform',
            archived: false,
            color: 'light-green',
            notes: 'Roadmap',
            owner: { gid: '900', name: 'Ada Lovelace' },
            team: { gid: '42', name: 'Core' },
            created_at: '2026-01-01T00:00:00.000Z',
            modified_at: '2026-01-02T00:00:00.000Z',
            due_on: '2026-06-30',
            start_on: '2026-01-15',
            permalink_url: 'https://app.asana.com/0/555',
            public: true,
          },
        ],
        next_page: { offset: 'eyJvZmZzZXQiOjF9', path: '/projects' },
      }),
    )
    const result = await runTool(PKG, 'list_projects', { input: { workspace_gid: '1200' }, page })
    equal(result.status, 'ok', 'asana list_projects: status')
    equal(result.data.projects[0].name, 'Platform', 'asana list_projects: project name')
    equal(result.data.projects[0].owner_name, 'Ada Lovelace', 'asana list_projects: owner')
    equal(result.data.projects[0].team_gid, '42', 'asana list_projects: team gid')
    equal(result.data.projects[0].color, 'light-green', 'asana list_projects: color')
    equal(result.data.projects[0].public, true, 'asana list_projects: public flag')
    equal(result.data.next_page, 'eyJvZmZzZXQiOjF9', 'asana list_projects: next_page offset')
    const query = new URL(requests[0].url).searchParams
    equal(requests[0].path.split('?')[0], '/api/1.0/projects', 'asana list_projects: /projects endpoint')
    equal(query.get('workspace'), '1200', 'asana list_projects: sends workspace')
    equal(query.get('opt_fields'), PROJECT_OPT_FIELDS, 'asana list_projects: upstream project opt_fields')
    equal(query.get('limit'), '20', 'asana list_projects: default limit 20')
    equal(query.get('archived'), null, 'asana list_projects: omits an unset archived filter')
  }

  {
    // get_tasks_for_project: limit/offset forwarded, tasks mapped, next_page
    // null when Asana sends no offset.
    const { page, requests } = asanaPage(() => jsonResponse({ data: [taskFixture] }))
    const result = await runTool(PKG, 'get_tasks_for_project', {
      input: { project_gid: '555', limit: 2, offset: 'tok-1' },
      page,
    })
    equal(result.status, 'ok', 'asana get_tasks_for_project: status')
    equal(result.data.tasks[0].gid, '1201', 'asana get_tasks_for_project: task gid')
    equal(result.data.tasks[0].assignee_gid, '900', 'asana get_tasks_for_project: assignee gid')
    equal(result.data.tasks[0].assignee_name, 'Ada Lovelace', 'asana get_tasks_for_project: assignee name')
    equal(result.data.tasks[0].completed, false, 'asana get_tasks_for_project: completed flag')
    equal(result.data.tasks[0].projects[0].name, 'Platform', 'asana get_tasks_for_project: project pair')
    equal(result.data.tasks[0].tags[0].gid, '77', 'asana get_tasks_for_project: tag pair')
    equal(result.data.tasks[0].parent_gid, '', 'asana get_tasks_for_project: no parent')
    equal(result.data.tasks[0].num_subtasks, 2, 'asana get_tasks_for_project: subtask count is a number')
    equal(result.data.tasks[0].resource_subtype, 'default_task', 'asana get_tasks_for_project: subtype')
    equal(result.data.next_page, null, 'asana get_tasks_for_project: no next page')
    const query = new URL(requests[0].url).searchParams
    equal(requests[0].path.split('?')[0], '/api/1.0/projects/555/tasks', 'asana get_tasks_for_project: endpoint')
    equal(query.get('limit'), '2', 'asana get_tasks_for_project: limit')
    equal(query.get('offset'), 'tok-1', 'asana get_tasks_for_project: offset')
    equal(query.get('opt_fields'), TASK_OPT_FIELDS, 'asana get_tasks_for_project: upstream task opt_fields')
  }

  {
    // get_task: caller-supplied opt_fields replace the default set verbatim.
    const { page, requests } = asanaPage(() =>
      jsonResponse({ data: { ...taskFixture, html_notes: 'x'.repeat(3000) } }),
    )
    const result = await runTool(PKG, 'get_task', {
      input: { task_gid: '1201', opt_fields: 'name,notes' },
      page,
    })
    equal(result.status, 'ok', 'asana get_task: status')
    equal(result.data.task.name, 'Ship the port', 'asana get_task: name')
    equal(result.data.task.notes, 'Plain notes', 'asana get_task: notes')
    equal(result.data.task.html_notes.length, 2000, 'asana get_task: html_notes truncated to 2000')
    equal(result.data.task.permalink_url, 'https://app.asana.com/0/555/1201', 'asana get_task: permalink')
    const query = new URL(requests[0].url).searchParams
    equal(requests[0].path.split('?')[0], '/api/1.0/tasks/1201', 'asana get_task: /tasks/:gid endpoint')
    equal(query.get('opt_fields'), 'name,notes', 'asana get_task: caller opt_fields win')
  }

  {
    // get_task without opt_fields falls back to the upstream default list.
    const { page, requests } = asanaPage(() => jsonResponse({ data: taskFixture }))
    await runTool(PKG, 'get_task', { input: { task_gid: '1201' }, page })
    equal(
      new URL(requests[0].url).searchParams.get('opt_fields'),
      TASK_OPT_FIELDS,
      'asana get_task: default opt_fields',
    )
  }

  {
    // search_tasks: dotted API filter names, limit default 20, text passthrough.
    const { page, requests } = asanaPage(() => jsonResponse({ data: [taskFixture] }))
    const result = await runTool(PKG, 'search_tasks', {
      input: {
        workspace_gid: '1200',
        text: 'ship',
        assignee_gid: '900',
        completed: true,
        due_on_before: '2026-03-01',
        due_on_after: '2026-02-01',
        projects_any: '555,556',
      },
      page,
    })
    equal(result.status, 'ok', 'asana search_tasks: status')
    equal(result.data.tasks.length, 1, 'asana search_tasks: result count')
    equal(result.data.tasks[0].gid, '1201', 'asana search_tasks: task gid')
    const query = new URL(requests[0].url).searchParams
    equal(
      requests[0].path.split('?')[0],
      '/api/1.0/workspaces/1200/tasks/search',
      'asana search_tasks: workspace search endpoint',
    )
    equal(query.get('text'), 'ship', 'asana search_tasks: text')
    equal(query.get('assignee.any'), '900', 'asana search_tasks: assignee.any filter')
    equal(query.get('completed'), 'true', 'asana search_tasks: completed filter')
    equal(query.get('due_on.before'), '2026-03-01', 'asana search_tasks: due_on.before filter')
    equal(query.get('due_on.after'), '2026-02-01', 'asana search_tasks: due_on.after filter')
    equal(query.get('projects.any'), '555,556', 'asana search_tasks: projects.any filter')
    equal(query.get('limit'), '20', 'asana search_tasks: default limit 20')
    equal(query.get('opt_fields'), TASK_OPT_FIELDS, 'asana search_tasks: task opt_fields')
    equal(requests[0].init.credentials, 'include', 'asana search_tasks: sends credentials')
  }

  {
    // create_task: POST with a {data:{...}} envelope, only the supplied
    // optional fields, and the app's write header.
    const { page, requests } = asanaPage(() =>
      jsonResponse({ data: { ...taskFixture, gid: '1300', name: 'New task' } }),
    )
    const result = await runTool(PKG, 'create_task', {
      input: {
        name: 'New task',
        workspace: '1200',
        projects: ['555'],
        due_on: '2026-03-05',
        notes: 'from the port',
      },
      page,
    })
    equal(result.status, 'ok', 'asana create_task: status')
    equal(result.data.task.gid, '1300', 'asana create_task: created gid')
    equal(requests[0].path.split('?')[0], '/api/1.0/tasks', 'asana create_task: /tasks endpoint')
    equal(requests[0].init.method, 'POST', 'asana create_task: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'asana create_task: JSON body')
    equal(requests[0].init.headers['X-Allow-Asana-Client'], '1', 'asana create_task: sends the client header')
    equal(requests[0].init.credentials, 'include', 'asana create_task: sends credentials')
    equal(
      new URL(requests[0].url).searchParams.get('opt_fields'),
      TASK_OPT_FIELDS,
      'asana create_task: opt_fields in query',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(body.data.name, 'New task', 'asana create_task: body name')
    equal(body.data.workspace, '1200', 'asana create_task: body workspace')
    equal(body.data.projects.join(','), '555', 'asana create_task: body projects')
    equal(body.data.due_on, '2026-03-05', 'asana create_task: body due_on')
    equal(body.data.notes, 'from the port', 'asana create_task: body notes')
    equal('assignee' in body.data, false, 'asana create_task: omits an unset assignee')
    equal('parent' in body.data, false, 'asana create_task: omits an unset parent')
  }

  {
    // update_task: PUT partial body — completing a task sends only `completed`.
    const { page, requests } = asanaPage(() =>
      jsonResponse({ data: { ...taskFixture, completed: true } }),
    )
    const result = await runTool(PKG, 'update_task', {
      input: { task_gid: '1201', completed: true },
      page,
    })
    equal(result.status, 'ok', 'asana update_task: status')
    equal(result.data.task.completed, true, 'asana update_task: completed flag')
    equal(requests[0].path.split('?')[0], '/api/1.0/tasks/1201', 'asana update_task: /tasks/:gid endpoint')
    equal(requests[0].init.method, 'PUT', 'asana update_task: PUT')
    equal(requests[0].init.headers['X-Allow-Asana-Client'], '1', 'asana update_task: sends the client header')
    const body = JSON.parse(requests[0].init.body)
    equal(body.data.completed, true, 'asana update_task: completed stays a boolean')
    equal(Object.keys(body.data).length, 1, 'asana update_task: only the supplied field')
  }

  {
    // delete_task: DELETE, 204 No Content is a success, never a parse error.
    const { page, requests } = asanaPage(() => noContent())
    const result = await runTool(PKG, 'delete_task', { input: { task_gid: '1201' }, page })
    equal(result.status, 'ok', 'asana delete_task: status')
    equal(result.data.success, true, 'asana delete_task: success flag')
    equal(requests[0].path, '/api/1.0/tasks/1201', 'asana delete_task: /tasks/:gid endpoint')
    equal(requests[0].init.method, 'DELETE', 'asana delete_task: DELETE')
    equal(requests[0].init.headers['X-Allow-Asana-Client'], '1', 'asana delete_task: sends the client header')
    equal(requests[0].init.body, undefined, 'asana delete_task: no body')
  }

  {
    // add_followers: POST addFollowers with the follower gid array.
    const { page, requests } = asanaPage(() => jsonResponse({ data: taskFixture }))
    const result = await runTool(PKG, 'add_followers', {
      input: { task_gid: '1201', followers: ['900', '901'] },
      page,
    })
    equal(result.status, 'ok', 'asana add_followers: status')
    equal(result.data.task.gid, '1201', 'asana add_followers: task gid')
    equal(requests[0].path.split('?')[0], '/api/1.0/tasks/1201/addFollowers', 'asana add_followers: endpoint')
    equal(requests[0].init.method, 'POST', 'asana add_followers: POST')
    equal(JSON.parse(requests[0].init.body).data.followers.join(','), '900,901', 'asana add_followers: followers')
  }

  {
    // get_subtasks + get_tasks_for_section + get_stories_for_task: the three
    // remaining limit/offset list reads.
    const subtasks = asanaPage(() => jsonResponse({ data: [taskFixture], next_page: { offset: 's-2' } }))
    const subtaskResult = await runTool(PKG, 'get_subtasks', { input: { task_gid: '1201' }, page: subtasks.page })
    equal(subtaskResult.status, 'ok', 'asana get_subtasks: status')
    equal(subtaskResult.data.subtasks[0].gid, '1201', 'asana get_subtasks: subtask gid')
    equal(subtaskResult.data.next_page, 's-2', 'asana get_subtasks: next_page')
    equal(subtasks.requests[0].path.split('?')[0], '/api/1.0/tasks/1201/subtasks', 'asana get_subtasks: endpoint')

    const sectionTasks = asanaPage(() => jsonResponse({ data: [taskFixture] }))
    const sectionResult = await runTool(PKG, 'get_tasks_for_section', {
      input: { section_gid: '888' },
      page: sectionTasks.page,
    })
    equal(sectionResult.status, 'ok', 'asana get_tasks_for_section: status')
    equal(sectionResult.data.tasks.length, 1, 'asana get_tasks_for_section: task count')
    equal(sectionTasks.requests[0].path.split('?')[0], '/api/1.0/sections/888/tasks', 'asana get_tasks_for_section: endpoint')

    const stories = asanaPage(() =>
      jsonResponse({
        data: [
          {
            gid: '3001',
            text: 'looks good',
            created_by: { gid: '900', name: 'Ada Lovelace' },
            created_at: '2026-02-03T09:00:00.000Z',
            resource_subtype: 'comment_added',
            type: 'comment',
          },
        ],
      }),
    )
    const storyResult = await runTool(PKG, 'get_stories_for_task', { input: { task_gid: '1201' }, page: stories.page })
    equal(storyResult.status, 'ok', 'asana get_stories_for_task: status')
    equal(storyResult.data.stories[0].text, 'looks good', 'asana get_stories_for_task: text')
    equal(storyResult.data.stories[0].created_by_name, 'Ada Lovelace', 'asana get_stories_for_task: author')
    equal(storyResult.data.stories[0].type, 'comment', 'asana get_stories_for_task: type')
    equal(new URL(stories.requests[0].url).searchParams.get('opt_fields'), STORY_OPT_FIELDS, 'asana get_stories_for_task: story opt_fields')
  }

  {
    // create_story (comment): POST /tasks/:gid/stories with {data:{text}}.
    const { page, requests } = asanaPage(() =>
      jsonResponse({
        data: { gid: '3002', text: 'on it', created_by: { gid: '900', name: 'Ada' }, type: 'comment', resource_subtype: 'comment_added', created_at: '2026-02-03T10:00:00.000Z' },
      }),
    )
    const result = await runTool(PKG, 'create_story', {
      input: { task_gid: '1201', text: 'on it' },
      page,
    })
    equal(result.status, 'ok', 'asana create_story: status')
    equal(result.data.story.gid, '3002', 'asana create_story: story gid')
    equal(result.data.story.text, 'on it', 'asana create_story: story text')
    equal(requests[0].path.split('?')[0], '/api/1.0/tasks/1201/stories', 'asana create_story: stories endpoint')
    equal(requests[0].init.method, 'POST', 'asana create_story: POST')
    equal(JSON.parse(requests[0].init.body).data.text, 'on it', 'asana create_story: body text')
    equal(requests[0].init.headers['X-Allow-Asana-Client'], '1', 'asana create_story: sends the client header')
  }

  {
    // get_project + sections: detail read, list, create, and addTask.
    const project = asanaPage(() =>
      jsonResponse({ data: { gid: '555', name: 'Platform', archived: false, color: 'dark-blue', team: { gid: '42', name: 'Core' } } }),
    )
    const projectResult = await runTool(PKG, 'get_project', { input: { project_gid: '555' }, page: project.page })
    equal(projectResult.status, 'ok', 'asana get_project: status')
    equal(projectResult.data.project.color, 'dark-blue', 'asana get_project: color')
    equal(projectResult.data.project.team_name, 'Core', 'asana get_project: team name')
    equal(project.page.hostname, 'app.asana.com', 'asana get_project: page host')
    equal(project.requests[0].path.split('?')[0], '/api/1.0/projects/555', 'asana get_project: endpoint')

    const sections = asanaPage(() =>
      jsonResponse({ data: [{ gid: '888', name: 'To do', created_at: '2026-01-01T00:00:00.000Z', project: { gid: '555' } }] }),
    )
    const listResult = await runTool(PKG, 'list_sections', { input: { project_gid: '555' }, page: sections.page })
    equal(listResult.status, 'ok', 'asana list_sections: status')
    equal(listResult.data.sections[0].name, 'To do', 'asana list_sections: section name')
    equal(listResult.data.sections[0].project_gid, '555', 'asana list_sections: project gid')
    equal(sections.requests[0].path.split('?')[0], '/api/1.0/projects/555/sections', 'asana list_sections: endpoint')

    const created = asanaPage(() => jsonResponse({ data: { gid: '889', name: 'Doing', project: { gid: '555' } } }))
    const createResult = await runTool(PKG, 'create_section', {
      input: { project_gid: '555', name: 'Doing' },
      page: created.page,
    })
    equal(createResult.status, 'ok', 'asana create_section: status')
    equal(createResult.data.section.gid, '889', 'asana create_section: section gid')
    equal(created.requests[0].init.method, 'POST', 'asana create_section: POST')
    equal(JSON.parse(created.requests[0].init.body).data.name, 'Doing', 'asana create_section: body name')

    const moved = asanaPage(() => jsonResponse({ data: {} }))
    const movedResult = await runTool(PKG, 'add_task_to_section', {
      input: { section_gid: '888', task_gid: '1201' },
      page: moved.page,
    })
    equal(movedResult.status, 'ok', 'asana add_task_to_section: status')
    equal(movedResult.data.success, true, 'asana add_task_to_section: success flag')
    equal(moved.requests[0].path.split('?')[0], '/api/1.0/sections/888/addTask', 'asana add_task_to_section: endpoint')
    equal(JSON.parse(moved.requests[0].init.body).data.task, '1201', 'asana add_task_to_section: body task')
  }

  {
    // create_project + update_project: write envelope, only supplied fields.
    const created = asanaPage(() =>
      jsonResponse({ data: { gid: '556', name: 'Launch', archived: false, public: false } }),
    )
    const createResult = await runTool(PKG, 'create_project', {
      input: { workspace_gid: '1200', name: 'Launch', team: '42', public: false },
      page: created.page,
    })
    equal(createResult.status, 'ok', 'asana create_project: status')
    equal(createResult.data.project.gid, '556', 'asana create_project: project gid')
    equal(created.requests[0].path.split('?')[0], '/api/1.0/projects', 'asana create_project: /projects endpoint')
    equal(created.requests[0].init.method, 'POST', 'asana create_project: POST')
    const createdBody = JSON.parse(created.requests[0].init.body)
    equal(createdBody.data.workspace, '1200', 'asana create_project: body workspace')
    equal(createdBody.data.name, 'Launch', 'asana create_project: body name')
    equal(createdBody.data.team, '42', 'asana create_project: body team')
    equal(createdBody.data.public, false, 'asana create_project: body public false is kept')
    equal('color' in createdBody.data, false, 'asana create_project: omits an unset color')

    const updated = asanaPage(() => jsonResponse({ data: { gid: '556', name: 'Launch', archived: true } }))
    const updateResult = await runTool(PKG, 'update_project', {
      input: { project_gid: '556', archived: true },
      page: updated.page,
    })
    equal(updateResult.status, 'ok', 'asana update_project: status')
    equal(updateResult.data.project.archived, true, 'asana update_project: archived flag')
    equal(updated.requests[0].init.method, 'PUT', 'asana update_project: PUT')
    equal(JSON.parse(updated.requests[0].init.body).data.archived, true, 'asana update_project: body archived')
  }

  {
    // get_current_user: /users/me plus the workspaces nested in the response.
    const { page, requests } = asanaPage(() =>
      jsonResponse({
        data: {
          gid: '900',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          workspaces: [{ gid: '1200', name: 'Acme' }],
        },
      }),
    )
    const result = await runTool(PKG, 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'asana get_current_user: status')
    equal(result.data.user.email, 'ada@example.com', 'asana get_current_user: email')
    equal(result.data.workspaces[0].gid, '1200', 'asana get_current_user: workspace gid')
    equal(requests[0].path.split('?')[0], '/api/1.0/users/me', 'asana get_current_user: /users/me endpoint')
    equal(
      new URL(requests[0].url).searchParams.get('opt_fields'),
      'name,email,workspaces.gid,workspaces.name',
      'asana get_current_user: opt_fields include workspaces',
    )
  }

  {
    // get_user, list_users_for_workspace, list_tags, list_teams.
    const user = asanaPage(() => jsonResponse({ data: { gid: '900', name: 'Ada', email: 'ada@example.com' } }))
    const userResult = await runTool(PKG, 'get_user', { input: { user_gid: '900' }, page: user.page })
    equal(userResult.status, 'ok', 'asana get_user: status')
    equal(userResult.data.user.name, 'Ada', 'asana get_user: name')
    equal(user.requests[0].path.split('?')[0], '/api/1.0/users/900', 'asana get_user: endpoint')

    const users = asanaPage(() => jsonResponse({ data: [{ gid: '901', name: 'Grace' }] }))
    const usersResult = await runTool(PKG, 'list_users_for_workspace', {
      input: { workspace_gid: '1200', limit: 50 },
      page: users.page,
    })
    equal(usersResult.status, 'ok', 'asana list_users_for_workspace: status')
    equal(usersResult.data.users[0].name, 'Grace', 'asana list_users_for_workspace: user name')
    equal(usersResult.data.next_page, null, 'asana list_users_for_workspace: no next page')
    equal(new URL(users.requests[0].url).searchParams.get('limit'), '50', 'asana list_users_for_workspace: limit')

    const tags = asanaPage(() => jsonResponse({ data: [{ gid: '77', name: 'backend', color: 'red' }] }))
    const tagsResult = await runTool(PKG, 'list_tags', { input: { workspace_gid: '1200' }, page: tags.page })
    equal(tagsResult.status, 'ok', 'asana list_tags: status')
    equal(tagsResult.data.tags[0].color, 'red', 'asana list_tags: color')
    equal(tags.requests[0].path.split('?')[0], '/api/1.0/workspaces/1200/tags', 'asana list_tags: endpoint')

    const teams = asanaPage(() => jsonResponse({ data: [{ gid: '42', name: 'Core', description: 'Platform team' }] }))
    const teamsResult = await runTool(PKG, 'list_teams', { input: { workspace_gid: '1200' }, page: teams.page })
    equal(teamsResult.status, 'ok', 'asana list_teams: status')
    equal(teamsResult.data.teams[0].description, 'Platform team', 'asana list_teams: description')
    equal(new URL(teams.requests[0].url).searchParams.get('opt_fields'), 'name,description', 'asana list_teams: opt_fields')
  }

  section('execution: asana failure paths')

  {
    // No signed-in user on the tab: AUTH, and no request leaves the page.
    const { page, requests } = asanaPage(() => jsonResponse({ data: [] }), { userId: null })
    const result = await runTool(PKG, 'list_workspaces', { input: {}, page })
    equal(result.status, 'error', 'asana logged-out: error status')
    equal(result.error_code, 'AUTH', 'asana logged-out: AUTH')
    ok(String(result.message).includes('log in to Asana'), 'asana logged-out: explains the missing session')
    equal(requests.length, 0, 'asana logged-out: makes no request')
  }

  {
    // A rejected session (401) is AUTH; keep Asana's own error text.
    const { page } = asanaPage(() =>
      jsonResponse({ errors: [{ message: 'Not Authorized' }] }, 401),
    )
    const result = await runTool(PKG, 'get_task', { input: { task_gid: '1201' }, page })
    equal(result.status, 'error', 'asana 401: error status')
    equal(result.error_code, 'AUTH', 'asana 401: AUTH')
    ok(String(result.message).includes('Not Authorized'), 'asana 401: keeps the Asana error message')
  }

  {
    // 404 is NOT_FOUND, 400 is VALIDATION, 429 is RATE_LIMITED.
    const missing = await runTool(PKG, 'get_task', {
      input: { task_gid: 'nope' },
      page: asanaPage(() => jsonResponse({ errors: [{ message: 'Unknown object' }] }, 404)).page,
    })
    equal(missing.error_code, 'NOT_FOUND', 'asana 404: NOT_FOUND')

    const invalid = await runTool(PKG, 'create_task', {
      input: { name: '', workspace: '1200' },
      page: asanaPage(() => jsonResponse({ errors: [{ message: 'name: must not be blank' }] }, 400)).page,
    })
    equal(invalid.error_code, 'VALIDATION', 'asana 400: VALIDATION')

    const limited = await runTool(PKG, 'search_tasks', {
      input: { workspace_gid: '1200' },
      page: asanaPage(() => jsonResponse('rate limited', 429)).page,
    })
    equal(limited.error_code, 'RATE_LIMITED', 'asana 429: RATE_LIMITED')
  }

  {
    // A tab on another host is refused before any request.
    const { page, requests } = asanaPage(() => jsonResponse({ data: [] }), { hostname: 'asana.com' })
    const result = await runTool(PKG, 'list_workspaces', { input: {}, page })
    equal(result.status, 'error', 'asana wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'asana wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'asana wrong host: makes no request')
  }

  section('contract: asana urlRegex')

  {
    // Every tool declares the same app.asana.com matcher: it must accept the
    // app at any path with an optional query/fragment tail and reject lookalike
    // hosts and other schemes.
    const manifest = JSON.parse(
      readFileSync(pathMod.join(packagesDir, PKG, 'manifest.json'), 'utf8'),
    )
    equal(manifest.id, 'com.asana.main', 'asana manifest id')
    equal(manifest.version, '0.1.0', 'asana manifest version')
    equal(manifest.tools.length, 24, 'asana tool count')
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      ok(regex.test('https://app.asana.com/0/1200/1201'), `asana urlRegex: accepts a task url (${tool.name})`)
      ok(
        regex.test('https://app.asana.com/0/inbox/1200?foo=bar#comment-1'),
        `asana urlRegex: accepts query and fragment (${tool.name})`,
      )
      ok(
        regex.test('https://app.asana.com/'),
        `asana urlRegex: accepts the app root (${tool.name})`,
      )
      ok(
        !regex.test('https://app.asana.com.evil.example/0/1'),
        `asana urlRegex: rejects a lookalike host (${tool.name})`,
      )
      ok(!regex.test('http://app.asana.com/0/1'), `asana urlRegex: rejects plain http (${tool.name})`)
      ok(
        !regex.test('https://evil.example/?next=https://app.asana.com/'),
        `asana urlRegex: rejects another origin (${tool.name})`,
      )
    }
  }
}
