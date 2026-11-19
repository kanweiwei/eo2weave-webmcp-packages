# com.powerpoint.main — PowerPoint Online

Port of the OpenTabs `powerpoint` plugin (`@opentabs-dev/opentabs-plugin-powerpoint`,
39 tools) for EO2Weave / WebMCP. It drives **Microsoft Graph v1.0** from inside the
PowerPoint tab you already have open, using that tab's own Microsoft 365 session.

## Packages

| | |
|---|---|
| id | `com.powerpoint.main` |
| version | 0.1.0 |
| upstream | `plugins/powerpoint` @ opentabs-dev/opentabs |
| tools | 39 (full parity) |

## Pages

Every tool carries the same `urlRegex`:

```
^https://(?:powerpoint\.cloud\.microsoft/[^?#]*(?:\?[^#]*)?(?:#.*)?|[^/?#]+\.sharepoint\.com/[^?#]*(?::p:|\.(?:pptx?|pptm|ppsx?))[^?#]*(?:\?[^#]*)?(?:#.*)?)$
```

It matches the two hosts upstream activates on — `powerpoint.cloud.microsoft`
and `*.sharepoint.com` presentation URLs (`/:p:/`) — plus SharePoint direct-file
links to a `.ppt`/`.pptx`/`.pptm`/`.ppsx` file, which upstream's
`isPowerPointTab()` also accepts. URLs are matched in full (`^…$`), query and
fragment included.

## Transport and auth

- All calls are `https://graph.microsoft.com/v1.0/...` — the same endpoints,
  `$select` lists and mappers as upstream (`src/powerpoint-api.ts`,
  `src/tools/*.ts`). Nothing is proxied and no endpoint is invented.
- The Graph token comes from the tab: a Graph-scoped AAD token endpoint response
  or a `Bearer` header on a direct Graph call is captured (upstream's
  `pre-script.ts` interceptor) and mirrored to
  `localStorage['__opentabs_powerpoint_graph_token']`; the standalone
  `powerpoint.cloud.microsoft` app's plaintext MSAL entry is the second source.
- The drive id comes from `?driveId=`, the WOPI context
  (`_wopiContextJson.DriveId`), the MSAL active account, or Graph `/shares`
  for a SharePoint URL that exposes none.
- `reauthenticate` clears cached MSAL entries and reloads the tab so a fresh
  token is minted (silent, via SSO cookies).

Deviations from upstream, both deliberate:

1. **Token capture timing.** Upstream installs its interceptor at
   `document_start`. A WebMCP workflow cannot, so it installs on the first tool
   call. On a cold SharePoint tab the first call may return `AUTH` until the
   page mints a token; every later call reads the captured mirror. The mirror
   key is upstream's, so a page that did run OpenTabs' pre-script is picked up
   immediately.
2. **Presentation sessions** live in a page global
   (`globalThis.__opentabs_powerpoint_sessions`) instead of adapter module
   scope. Behaviour is the same — one tab, in-memory, 10-minute idle TTL,
   dropped on reload — it just survives the per-call injection.

`create_presentation` uploads upstream's embedded blank 16:9 deck (one empty
slide, notes master present), so new files are immediately editable by the slide
tools.

## Verification

`npm test` runs `scripts/tests/com.powerpoint.main.test.mjs`:

- a real (deflated) PPTX fixture served from the Graph download URL, parsed end to
  end: `get_slides`, `get_slide_content`, `get_slide_notes`, `get_slide_layout`;
- REST reads and writes with their upstream paths/bodies: `/me`, `/drives/{id}`,
  `.../children`, `root/search(q=...)`, `PATCH`/`POST`/`DELETE`, the binary
  `root:/name:/content` upload of the embedded blank deck;
- a batched session: `open_presentation` → `add_shape` / `update_shape` /
  `duplicate_shape` / `delete_shape` (no HTTP) → `commit_presentation` with
  `If-Match`, asserting the uploaded ZIP holds the edits;
- notes creation for a slide that had none, `duplicate_slide`, and the
  `AUTH` / `UNSUPPORTED_PAGE` / `NOT_FOUND` failure paths.

Not exercised without a live tab: the AAD token capture on a signed-in SharePoint
page, real Graph responses (permissions, CORS, sharing links, thumbnails,
versions) and the HTTP 423 file-lock path when a deck is open in the editor.
Those need one manual run against a real presentation.

## Tools

### Account

| Tool | Description |
|---|---|
| `get_current_user` | Get the profile of the currently authenticated Microsoft 365 user including name, email, and user ID. |
| `reauthenticate` | Clear cached MSAL state and reload the SharePoint/OneDrive tab to force a fresh Microsoft Graph token. Use this when another PowerPoint tool returns an authentication error pointing at this tool. After invoking, wait ~5 seconds for the tab to finish reloading, then retry the original operation. |

### Drive

| Tool | Description |
|---|---|
| `get_drive` | Get OneDrive storage information including total capacity, used space, and remaining quota. |

### Files

| Tool | Description |
|---|---|
| `list_children` | List files and folders in a OneDrive folder. Defaults to the root folder. Returns file name, size, type, and modification info. |
| `list_recent` | List recently accessed files across OneDrive. Returns the most recently viewed or edited files with their metadata. |
| `search_files` | Search for files and folders in OneDrive by name. Returns matching items sorted by relevance. |
| `list_shared_with_me` | List files that other people have shared with you. Returns file metadata including who shared it. |
| `get_item` | Get detailed information about a file or folder by its item ID. Returns name, size, MIME type, creation/modification details, and web URL. |
| `get_download_url` | Get a temporary download URL for a file. The URL is pre-authenticated and expires after a short time. |
| `get_thumbnails` | Get thumbnail preview images for a file. Returns URLs for small, medium, and large thumbnails. Useful for previewing presentations without opening them. |
| `rename_item` | Rename a file or folder in OneDrive by its item ID. Returns the updated item details. |
| `delete_item` | Permanently delete a file or folder from OneDrive by its item ID. This action cannot be undone. |
| `copy_item` | Create a copy of a file in OneDrive. Optionally specify a new name and destination folder. The copy operation runs asynchronously. |
| `move_item` | Move a file or folder to a different folder in OneDrive. Returns the updated item details. |
| `create_folder` | Create a new folder in OneDrive. Specify a name and optional parent folder. Returns the created folder details. |
| `list_versions` | List version history of a file. Returns all saved versions with modifier, timestamp, and size. |

### Presentations

| Tool | Description |
|---|---|
| `create_presentation` | Create a new blank PowerPoint presentation (.pptx) with one empty slide in OneDrive. Specify a name and optional parent folder. Returns the created file details. The result is a valid, immediately editable presentation. |
| `get_preview_url` | Get an embeddable preview URL for a file. The URL can be used to embed a read-only preview of the presentation in an iframe. |

### Sessions

| Tool | Description |
|---|---|
| `open_presentation` | Open an edit session for a presentation. Downloads the PPTX once and caches it in memory so subsequent edit tools (add_shape, update_shape, delete_shape, add_image, duplicate_slide, etc.) run without round-tripping through Graph. Captures the file eTag so commit_presentation can detect concurrent edits via If-Match. Call commit_presentation when done, or discard_presentation to throw away pending changes. Sessions auto-expire after 10 minutes of inactivity. |
| `commit_presentation` | Flush a session's pending edits to the Graph API with an optimistic If-Match check against the eTag captured at open time. If the file changed in the browser since the session was opened, the commit is refused and pending edits are preserved — call discard_presentation to drop them, or inspect and commit anyway via a new session. If the session has no dirty edits, the commit is a no-op that just closes the session. |
| `discard_presentation` | Drop a presentation session without uploading. Any pending edits are lost. Idempotent — returns `discarded: false` if no session was open for the given item. |
| `list_presentation_sessions` | List all open presentation sessions in the current tab, including which items are cached, whether they have dirty edits, and how long they have been idle. Useful for recovering context after a long conversation or confirming a session is still alive before committing. |

### Slides

| Tool | Description |
|---|---|
| `get_slides` | Get all slides from a PowerPoint presentation with their text content. Downloads the PPTX file, parses it, and extracts text from each slide. |
| `get_slide_content` | Get detailed text content and speaker notes for a specific slide by number (1-indexed). Downloads the PPTX file and extracts all text and notes. |
| `get_slide_layout` | Return the full structural layout of a slide — every shape, text box, placeholder, picture, table, and chart — with position, size, rotation, fill color, and text formatting. All positions and sizes are in inches. Use this to understand what is on a slide before editing. Each shape has a stable `id` that future edit tools will use as a handle. |
| `add_text_box` | Add a new text box to a slide at the given position. Positions and sizes are in inches. Optional formatting controls font size, weight, color, font family, and alignment. Returns the new shape id, which can be passed to `update_shape` for further tweaks. |
| `add_shape` | Add a new preset shape (rectangle, ellipse, arrow, star, callout, ...) to a slide. Positions and sizes are in inches. Optional fill color, rotation, and centered text. The `preset` parameter accepts any DrawingML preset geometry name — common choices are listed in the enum. Returns the new shape id for follow-up edits via `update_shape`. |
| `add_image` | Insert an image onto a slide. Accepts base64-encoded image bytes (with or without a data: URI prefix) and a format hint. Positions and sizes are in inches. Supported formats: png, jpeg, jpg, gif, bmp, tiff, svg. Returns the new picture shape id for follow-up edits via `update_shape`. |
| `update_slide_text` | Replace the text of a slide's first text box, one paragraph per line. Use \n to separate lines. Targets the first text box that already has content, falling back to the first (often empty) placeholder — it does not specifically resolve the title placeholder, so on slides where another text box comes first that box is edited. For precise control over a specific shape, use `update_shape` with a shape id from `get_slide_layout` instead. |
| `update_shape` | Modify an existing shape on a slide — change its text, position, size, rotation, and/or solid fill color. Find the shape id via `get_slide_layout`. Any field you omit is left unchanged. Positions and sizes are in inches; rotation is in degrees (clockwise). Fill accepts a hex color like "FFCC00" or "#ffcc00" and cannot be applied to picture shapes. |
| `delete_shape` | Remove a shape from a slide. Find the shape id via `get_slide_layout`. Deleting a group removes all of its child shapes. |
| `duplicate_shape` | Clone an existing shape on a slide. The copy is placed just below-right of the original with a small offset so it is visible. Returns the new shape id which can be passed to `update_shape` to customize it. Internal cNvPr ids are reassigned to avoid collisions. |
| `get_slide_notes` | Get the speaker notes for a specific slide by number. Downloads the PPTX and extracts the notes text. |
| `update_slide_notes` | Set the speaker notes for a specific slide. Downloads the PPTX, writes the notes XML, and re-uploads. If the slide has no notes yet, an empty notes part is created automatically. Use \n for line breaks. |
| `delete_slide` | Delete a slide from a PowerPoint presentation by number (1-indexed). Downloads the PPTX, removes the slide and updates all references, then re-uploads. |
| `duplicate_slide` | Clone an existing slide. Copies the slide XML and its relationships (including an independent copy of any speaker notes) and registers the new slide in the presentation index. Use this to template new slides from existing ones. By default the clone is appended to the end of the deck — pass `insert_at` (1-indexed) to place it at a specific position. |

### Sharing

| Tool | Description |
|---|---|
| `list_permissions` | List all permissions and sharing links for a file or folder. Shows who has access and what role they have. |
| `create_sharing_link` | Create a sharing link for a file or folder. Supports view-only and edit links with anonymous or organization scope. |
| `delete_permission` | Remove a sharing permission or revoke a sharing link from a file or folder. |

