# com.github.main — live verification report

Scope: all 35 tools in `packages/com.github.main/manifest.json`.
Method: every tool was invoked for real through the extension (`browser webmcp exec` on a
github.com tab) and the result was checked against an **independent** source — `gh` CLI,
a raw page payload, or a second page read — never against the tool's own output.

Test target for writes: the private repo `kanweiwei/eo2weave-webmcp-adapter-test`
(`repositoryId: R_kgDOV8VWQQ`). No other repository was written to. Test data was removed
afterwards (see "Cleanup"); two merged pull requests (#15, #16) remain as history because a
merge cannot be undone.

Status: **34 / 35 verified live**, 1 permanently blocked (single-account limit).

| # | Tool | Status | Evidence |
|---|---|---|---|
| 1 | `list_repos` | ✅ | repo list fields compared with `gh repo list` |
| 2 | `get_repo` | ✅ | description/visibility/stars matched `gh api repos/...` |
| 3 | `list_commits` | ✅ | commit SHAs/messages matched `gh api .../commits` |
| 4 | `compare_commits` | ✅ | ahead/behind/file list matched the compare page |
| 5 | `list_releases` | ✅ | published/draft/prerelease flags matched `gh api .../releases` |
| 6 | `list_issues` | ✅ | numbers/titles/comments matched the issues index |
| 7 | `get_issue` | ✅ | body length + state matched the issue page |
| 8 | `search_issues` | ✅ | hits matched a real query result page |
| 9 | `list_labels` | ✅ | 10 default labels matched `gh api .../labels` |
| 10 | `list_pull_requests` | ✅ | PR numbers/state matched `gh api .../pulls` |
| 11 | `get_pull_request` | ✅ | title/state/head branch matched `gh api .../pulls/N` |
| 12 | `get_pull_request_diff` | ✅ | diff hunks matched the `.diff` body |
| 13 | `list_pull_request_files` | ✅ | paths/additions matched `gh api .../pulls/N/files` |
| 14 | `list_comments` | ✅ | 3 comments on issue #5 with ids |
| 15 | `get_user_profile` | ✅ | login/id/repos matched the profile page |
| 16 | `list_org_members` | ✅ | members matched the org people page |
| 17 | `list_branches` | ✅ | branch list matched `gh api .../branches` |
| 18 | `get_file_content` | ✅ | file body matched `/raw/...` byte-for-byte |
| 19 | `list_workflow_runs` | ✅ | run ids/conclusions matched the Actions page |
| 20 | `get_workflow_run` | ✅ | run `45354144750` jobs matched the run page |
| 21 | `search_repos` | ✅ | results matched a real repository search |
| 22 | `list_notifications` | ✅ | notifications matched the inbox page |
| 23 | `create_label` | ✅ | label `e2e-webmcp` (id 13233119098) confirmed by `list_labels` + `gh` |
| 24 | `create_issue` | ✅ | issue #5, body read back by `get_issue` |
| 25 | `create_comment` | ✅ | comment id 7186614675, listed by `list_comments` |
| 26 | `update_issue` | ✅ | `updated: ["body","title","state"]`, each field re-read |
| 27 | `add_reaction` | ✅ | `viewerHasReacted: true` in the reaction payload |
| 28 | `create_or_update_file` | ✅ | created then updated `adapter/notes.md`, content re-read from `/raw` |
| 29 | `delete_file` | ✅ | `/raw` turned 404; a second delete reports `NOT_FOUND` |
| 30 | `create_pull_request` | ✅ | PR #14 `{number:14, head_ref, additions:1, changed_files:1}` confirmed by `gh` |
| 31 | `update_pull_request` | ✅ | title+body then state closed→open, each confirmed by `gh` (`closed_at` set, then null) |
| 32 | `merge_pull_request` | ✅ | PR #16 squash-merged, `merge_commit_sha c7eecfa…` has exactly 1 parent, commit title honoured |
| 33 | `create_release` | ✅ | draft / published / prerelease all confirmed by `gh` (see "Release semantics") |
| 34 | `request_pull_request_review` | ⚪ blocked | endpoint implemented from a captured payload; positive result is impossible with one account |
| 35 | `create_repo` | ✅ | created `kanweiwei/e2e-webmcp-tool` (private, `auto_init`), confirmed by `gh api repos/...`; a duplicate name answers `CREATE_FAILED` |

## `create_repo` protocol

The new-repository page is a React form whose inputs have **no `name` attributes**; the browser
builds a JSON body instead of posting the form. Captured request:

```
POST /repositories          (Accept+Content-Type: application/json, GitHub-Verified-Fetch: true,
                             X-Requested-With: XMLHttpRequest, X-Fetch-Nonce: v2:<uuid>)
{ owner: "<login>", template_repository_id: "", include_all_branches: "0",
  repository: { name, visibility: "private"|"public", description,
                auto_init: "1"|"0", license_template: "", gitignore_template: "" } }
=> 200 {"data":{"redirect":"/<owner>/<name>"}}
```

Verification: fetch the redirect path and require HTTP 200 + the full name in the markup; the
`Private`/`Public` badge on that page yields the real visibility (and `matches_request` tells the
caller whether what was asked for is what exists). Live evidence:

```
tool: {name:"e2e-webmcp-tool", private:true, visibility:"private", matches_request:true,
       page_title:"kanweiwei/e2e-webmcp-tool: created by adapter"}
gh:   name=e2e-webmcp-tool private=true desc="created by adapter" id=1473017369 default_branch=main
      contents -> ["README.md"]        (auto_init honoured)
```

Duplicate name → `CREATE_FAILED` with GitHub's own reason:
`{"data":{"error":"Repository creation failed."},"code":422}`.

## Release semantics (previous "bug" was a misreading)

A draft release keeps its `tag_name` but **GitHub only creates the git tag when the draft is
published**; its `html_url` is `.../releases/tag/untagged-<hash>` by design. Verified:

```
draft=true  -> tool: {tag_name:"e2e-v10", draft:true,  tag_created:false}
               gh:   {tag:"e2e-v10", draft:true} + git/refs/tags empty
published   -> tool: {tag_name:"e2e-v11", draft:false, tag_created:true}
               gh:   {tag:"e2e-v11", draft:false} + refs/tags/e2e-v11 -> ef86ebbf
prerelease  -> gh:   {tag:"e2e-v12", prepublish:true}
```

Consequences for the implementation: the whole `/releases/new` form body is copied (token,
honeypots and the empty path/line fields included), `release[target_commitish]` is taken from
the **checked** radio only (11 candidates exist, one checked), `release[draft]` is sent as
`1`/`0`, and success is only claimed after the landed release page shows the title.

## Why `request_pull_request_review` is blocked

GitHub refuses to request a review from the pull request author, and answers **HTTP 200** while
silently doing nothing. With a single account there is no way to produce a positive result, so
the tool is written to fail loudly instead of pretending:

```
$ webmcp exec com.github.main.request_pull_request_review \
    '{"owner":"kanweiwei","repo":"eo2weave-webmcp-adapter-test","pull_number":16,"reviewers":["kanweiwei"]}'
{"status":"error","error_code":"UNCONFIRMED_WRITE",
 "message":"GitHub accepted the request but kanweiwei do not appear as requested reviewers on #16."}
```

Guard rails verified live as well:

- `reviewers: []` → `INVALID_INPUT: Provide at least one reviewer login.`
- unknown login → `NOT_FOUND: Could not resolve the GitHub user "no-such-user-zzz-9f2".`
- `team_reviewers` → `UNSUPPORTED_INPUT` (the page endpoint only accepts numeric user ids)

How to close this item with a second account:

1. Add the second account as a collaborator on the test repo (or use a repo that already has two).
2. Open a PR from a branch that the second account authored (or by either account — only the
   author cannot review).
3. `webmcp exec com.github.main.request_pull_request_review '{"owner":...,"repo":...,"pull_number":N,"reviewers":["<second-login>"]}'`
   → expect `{"status":"ok","reviewers":[...]}`.
4. Independently confirm: `gh api repos/{owner}/{repo}/pulls/N --jq .requested_reviewers`.

## Captured write endpoints (for future repairs)

| Action | Endpoint | Notes |
|---|---|---|
| close / reopen PR | `POST /{o}/{r}/pull/{n}/comment?sticky=true` | urlencoded, copy the page form's hidden inputs, set `comment_and_close=1` or `comment_and_open=1` |
| PR title / body | `POST /{o}/{r}/issues/{n}` | urlencoded, `_method=put`, `issue[title]` / `issue[body]`; PRs are **not** Issue nodes, so the JSON `/issues/{n}` PATCH used by `update_issue` answers NOT_FOUND |
| merge PR | `POST /{o}/{r}/pull/{n}/page_data/merge` | JSON `{bypassBranchProtections:false, commitTitle, commitMessage, mergeMethod}` |
| request review | `POST /{o}/{r}/pull/{n}/review-requests` | urlencoded; the token must come from **that** form (other tokens 422) |
| create release | `POST /{o}/{r}/releases` | urlencoded; copy the entire form body |

All of these were captured by hooking `window.fetch` **and** `XMLHttpRequest.prototype` on the
real page (the title editor uses XHR, not fetch).

## Reproducing the checks

```bash
node scripts/generate-manifest.mjs
node scripts/validate-package.mjs packages/com.github.main     # OK — 0 errors, 0 warnings
env GITHUB_SMOKE_ONLY=1 node scripts/test-packages.mjs         # 25795/25795 checks passed
```

The adapter package must be copied to the extension mount before it can be exercised:
`cp -r packages/com.github.main /external/webmcp/com.github.main` then
`cw-webmcp-adapter validate /external/webmcp/com.github.main`.

## Cleanup

Releases, tags, issues, labels, branches and probe files created during verification were deleted;
the test repo is back to `main` + `README.md`. Two merged pull requests (#15, #16) remain in the
history because merges cannot be undone — they are the price of verifying `merge_pull_request`
against a real remote.

Three throwaway repositories were created while verifying `create_repo` and have since been deleted
(`gh repo delete` + `gh repo list` shows none left): `e2e-webmcp-created` (public, made while capturing
the UI payload), `e2e-webmcp-probe1` (private, made while probing the endpoint) and
`e2e-webmcp-tool` (private, the tool's own verified creation).

Deleting a repository is **not** something the adapter can or should do: the web form lands on
GitHub's sudo re-authentication page (`<title>Confirm access</title>`), and the REST call needs the
`delete_repo` scope. Clean them up by hand:

```
gh auth refresh -h github.com -s delete_repo     # one device-code flow + sudo re-auth
gh repo delete <owner>/<name> --yes
```
