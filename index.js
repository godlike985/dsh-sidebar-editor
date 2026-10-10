/**
 * Host half of the sidebar editor bundle.
 *
 * Owns the one operation the browser half cannot perform itself: persisting an
 * editor buffer back to disk. The route is registered on Connection's exact
 * Fetch registry, so it sits under the `/api` prefix and is therefore already
 * behind `connection.admit(request)` — the Host/Origin fence plus the signed
 * browser-session cookie — before the handler runs.
 *
 * The write goes through `ctx.fs.writeText` with a
 * `{ kind: 'replaceIfVersion', version }` guard, which gives three things at
 * once: the atomic publish the backend already implements, the read-before-write
 * precondition (`FS_NOT_OBSERVED` without a guard), and optimistic concurrency
 * (`FS_STALE_VERSION` when the file changed since the client read it).
 *
 * The sandbox fence needs the CALLING SESSION, not just a path: the mounted
 * backend resolves a per-call policy, and an agentless call would fall back to
 * the deployment default root (`process.cwd()` of the host process) instead of
 * the session's workspace. So the client sends the Session id it read the file
 * through, the handler resolves that Session's live header, and
 * `ctx.sandboxPolicy.resolve({ session })` supplies both the workspace root and
 * the session's own mode override — meaning a Session switched to read-only
 * refuses the save here, exactly as it refuses every other confined write.
 *
 * It also answers the sidebar's file search: `searchWorkspace` walks the Session's
 * workspace through `fs.listDir` (the seam has no recursive listing) and reads text
 * files for a content search, both within fixed caps and inside the fence's root.
 *
 * The operations are plain functions (`saveWorkspaceFile`, `searchWorkspace`), so a
 * future agent tool can call exactly what the UI calls.
 *
 * @module dsh-sidebar-editor
 */

/** Exact Fetch route the browser half posts to. */
const SAVE_PATH = '/api/sidebarEditor/save';
/** Largest buffer this route accepts, in UTF-8 bytes. */
const MAX_SAVE_BYTES = 2 * 1024 * 1024;

/** The Host services this route cannot work without. */
export const inject = ['connection', 'fs'];

/**
 * Resolve the per-call sandbox policy for one Session.
 * @param ctx - context carrying `sessions` and `sandboxPolicy`.
 * @param sessionId - the Session the buffer was read through, when known.
 * @returns `{ policy, sessionResolved }`.
 */
function policyFor(ctx, sessionId) {
  const sessions = ctx.sessions;
  const session = typeof sessionId === 'string' && sessionId !== '' && sessions !== undefined
    && typeof sessions.get === 'function'
    ? sessions.get(sessionId)
    : undefined;
  return {
    policy: ctx.sandboxPolicy.resolve(session === undefined ? {} : { session: session }),
    // Reported so a denial can say whether it used the Session's workspace or
    // the deployment fallback: the two look identical in the fence's own error.
    sessionResolved: session !== undefined
  };
}

/**
 * Save one workspace file from an editor buffer.
 * @param ctx - context carrying `fs`, `sessions` and `sandboxPolicy`.
 * @param input - `{ sessionId, absolutePath, text, version }`.
 * @param signal - cancellation.
 * @returns `{ ok: true, version, operation, workspaceRoot }` on success, or a
 *   failure `{ status, code, workspaceRoot, sessionResolved }`.
 */
export async function saveWorkspaceFile(ctx, input, signal) {
  const { policy, sessionResolved } = policyFor(ctx, input.sessionId);
  if (policy.mode === 'read-only') {
    return { status: 403, code: 'read-only-mode', workspaceRoot: policy.workspaceRoot, sessionResolved: sessionResolved };
  }
  const target = await ctx.fs.resolve(input.absolutePath, { signal: signal });
  try {
    const result = await ctx.fs.writeText(
      target,
      input.text,
      { kind: 'replaceIfVersion', version: input.version },
      signal,
      policy
    );
    return {
      ok: true,
      version: result.version,
      operation: result.operation,
      workspaceRoot: policy.workspaceRoot,
      sessionResolved: sessionResolved
    };
  } catch (error) {
    const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
    // Report the root this call was actually fenced to, so a denial a user sees
    // names the directory the fence used instead of leaving it opaque.
    if (code === 'FS_SANDBOX_DENIED') {
      return {
        status: 403,
        code: 'sandbox-denied',
        workspaceRoot: policy.workspaceRoot,
        sessionResolved: sessionResolved
      };
    }
    throw error;
  }
}

/** Exact Fetch route the browser half searches through. */
const SEARCH_PATH = '/api/sidebarEditor/search';
/** Directory names never walked: dependency trees, build output and VCS storage. */
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', '.venv', 'venv', '__pycache__',
  '.tox', '.mypy_cache', '.pytest_cache', 'coverage', '.gradle', '.idea'
]);
/** Extensions a content search reads; anything else is skipped without reading. */
const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'cfg', 'cjs', 'clj', 'conf', 'cpp', 'cs', 'css', 'csv', 'cts', 'env', 'go', 'h',
  'hpp', 'html', 'ini', 'java', 'js', 'json', 'jsonc', 'jsx', 'kt', 'less', 'log', 'lua', 'md',
  'mjs', 'mts', 'php', 'pl', 'properties', 'ps1', 'py', 'r', 'rb', 'rs', 'rst', 'sass', 'scss',
  'sh', 'sql', 'svelte', 'swift', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh'
]);
/** One search stays bounded whatever the workspace looks like. */
const MAX_LISTED_FILES = 20000;
const MAX_DEPTH = 12;
const MAX_CONTENT_BYTES = 512 * 1024;
const MAX_MATCHES_PER_FILE = 3;
const MAX_MATCHES = 200;
const MAX_QUERY_LENGTH = 200;
/** How long one listed workspace is reused before walking again. */
const LIST_TTL_MS = 15000;
/** Roots kept in the listing cache; the sidebar shows one workspace at a time. */
const MAX_CACHED_ROOTS = 4;

/** @param value - a path. @returns the separator it already uses. */
function separatorOf(value) {
  return String(value).indexOf('\\') === -1 ? '/' : '\\';
}

/**
 * @param parent - an absolute directory.
 * @param name - a child name.
 * @returns the child's absolute path, using the parent's separator.
 */
function joinPath(parent, name) {
  const trimmed = String(parent).replace(/[/\\]+$/u, '');
  return trimmed + separatorOf(parent) + name;
}

/**
 * @param root - the workspace root.
 * @param absolute - a path under it.
 * @returns the workspace-relative path with `/` separators, as the `@` grammar
 *   and the sidebar's resource addresses spell it.
 */
function relativePathOf(root, absolute) {
  const trimmed = String(root).replace(/[/\\]+$/u, '');
  const rest = String(absolute).slice(trimmed.length).replace(/^[/\\]+/u, '');
  return rest.split(/[/\\]/u).join('/');
}

/** @param value - a path. @returns its lowercased extension without the dot. */
function extensionOf(value) {
  const name = String(value).split(/[/\\]/u).pop();
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Listings of workspaces already walked, so a panel reopening is instant. */
const listingCache = new Map();

/**
 * Walk one workspace, breadth first, within fixed caps.
 *
 * `fs` deliberately has no recursive listing, so the walk is explicit. It never
 * reads file contents and never leaves the root it was given.
 *
 * @param ctx - context carrying `fs`.
 * @param root - the absolute workspace root to walk.
 * @param signal - cancellation.
 * @returns `{ files, truncated }`, files being `{ path, absolute, size }`.
 */
async function listWorkspace(ctx, root, signal) {
  const cached = listingCache.get(root);
  if (cached !== undefined && Date.now() - cached.at < LIST_TTL_MS) return cached.listed;
  const files = [];
  const directories = [];
  const queue = [{ path: root, depth: 0 }];
  let truncated = false;
  while (queue.length > 0 && files.length < MAX_LISTED_FILES) {
    const directory = queue.shift();
    let target;
    try {
      target = await ctx.fs.resolve(directory.path, { signal: signal });
    } catch (error) {
      continue;
    }
    let children;
    try {
      children = await ctx.fs.listDir(target, signal);
    } catch (error) {
      continue;
    }
    for (const child of children) {
      if (child === null || typeof child !== 'object' || typeof child.name !== 'string') continue;
      const absolute = joinPath(directory.path, child.name);
      if (child.type === 'directory') {
        if (SKIP_DIRECTORIES.has(child.name)) continue;
        if (directory.depth + 1 > MAX_DEPTH) continue;
        // Directories are returned too: a result can name a folder, and picking
        // one drills into it the way the `@` menu does.
        if (directories.length < MAX_LISTED_FILES) directories.push(relativePathOf(root, absolute));
        queue.push({ path: absolute, depth: directory.depth + 1 });
        continue;
      }
      if (child.type !== 'file') continue;
      if (files.length >= MAX_LISTED_FILES) {
        truncated = true;
        break;
      }
      files.push({
        path: relativePathOf(root, absolute),
        absolute: absolute,
        size: typeof child.size === 'number' ? child.size : undefined
      });
    }
  }
  const listed = { files: files, directories: directories, truncated: truncated };
  listingCache.set(root, { at: Date.now(), listed: listed });
  while (listingCache.size > MAX_CACHED_ROOTS) {
    const oldest = listingCache.keys().next().value;
    listingCache.delete(oldest);
  }
  return listed;
}

/**
 * Find a substring in the workspace's text files.
 * @param ctx - context carrying `fs`.
 * @param root - the absolute workspace root.
 * @param query - the substring to look for, matched case-insensitively.
 * @param signal - cancellation.
 * @returns `{ files, matches, scanned, truncated }`.
 */
async function searchWorkspaceContent(ctx, root, query, signal) {
  const listed = await listWorkspace(ctx, root, signal);
  const needle = query.toLowerCase();
  const matches = [];
  let scanned = 0;
  for (const file of listed.files) {
    if (matches.length >= MAX_MATCHES) break;
    if (!TEXT_EXTENSIONS.has(extensionOf(file.path))) continue;
    if (file.size !== undefined && file.size > MAX_CONTENT_BYTES) continue;
    let target;
    try {
      target = await ctx.fs.resolve(file.absolute, { signal: signal });
    } catch (error) {
      continue;
    }
    let text;
    try {
      // `readText` answers null for binary, oversized, or unreadable files
      // instead of throwing, which is exactly the filter this walk wants.
      text = await ctx.fs.readText(target, signal);
    } catch (error) {
      continue;
    }
    if (typeof text !== 'string') continue;
    scanned += 1;
    const lines = text.split('\n');
    let found = 0;
    for (let at = 0; at < lines.length && found < MAX_MATCHES_PER_FILE; at += 1) {
      if (lines[at].toLowerCase().indexOf(needle) === -1) continue;
      matches.push({
        path: file.path,
        line: at + 1,
        text: lines[at].length > 240 ? lines[at].slice(0, 240) : lines[at]
      });
      found += 1;
      if (matches.length >= MAX_MATCHES) break;
    }
  }
  return { files: listed.files.length, matches: matches, scanned: scanned, truncated: listed.truncated };
}

/**
 * Search one Session's workspace, by file name or by file content.
 *
 * @param ctx - context carrying `fs`, `sessions` and `sandboxPolicy`.
 * @param input - `{ sessionId, mode, query }`.
 * @param signal - cancellation.
 * @returns `{ ok: true, ... }` or a failure `{ status, code, workspaceRoot, sessionResolved }`.
 */
export async function searchWorkspace(ctx, input, signal) {
  const { policy, sessionResolved } = policyFor(ctx, input.sessionId);
  const root = policy.workspaceRoot;
  if (typeof root !== 'string' || root === '') {
    return { status: 400, code: 'no-workspace', workspaceRoot: root, sessionResolved: sessionResolved };
  }
  const started = Date.now();
  if (input.mode === 'content') {
    const found = await searchWorkspaceContent(ctx, root, input.query, signal);
    return {
      ok: true,
      mode: 'content',
      workspaceRoot: root,
      sessionResolved: sessionResolved,
      matches: found.matches,
      fileCount: found.files,
      scanned: found.scanned,
      truncated: found.truncated,
      elapsedMs: Date.now() - started
    };
  }
  const listed = await listWorkspace(ctx, root, signal);
  return {
    ok: true,
    mode: 'name',
    workspaceRoot: root,
    sessionResolved: sessionResolved,
    files: listed.files.map((file) => file.path),
    directories: listed.directories,
    truncated: listed.truncated,
    elapsedMs: Date.now() - started
  };
}

/**
 * Read and validate a search request.
 * @param request - the Fetch request.
 * @returns `{ value }` or `{ status, code }`.
 */
async function parseSearchRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return { status: 400, code: 'bad-request' };
  }
  if (body === null || typeof body !== 'object') return { status: 400, code: 'bad-request' };
  const { sessionId, mode, query } = body;
  if (typeof sessionId !== 'string' || sessionId === '') return { status: 400, code: 'bad-request' };
  if (mode !== 'name' && mode !== 'content') return { status: 400, code: 'bad-request' };
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) return { status: 400, code: 'bad-request' };
  if (mode === 'content' && query.trim() === '') return { status: 400, code: 'empty-query' };
  return { value: { sessionId: sessionId, mode: mode, query: query } };
}

/**
 * Serve one search request.
 * @param ctx - context carrying the search dependencies.
 * @param request - the Fetch request.
 * @returns the Fetch response.
 */
async function handleSearch(ctx, request) {
  const parsed = await parseSearchRequest(request);
  if (parsed.value === undefined) {
    return jsonResponse(parsed.status, { ok: false, error: parsed.code });
  }
  try {
    const result = await searchWorkspace(ctx, parsed.value, request.signal);
    if (result.ok !== true) {
      return jsonResponse(result.status, {
        ok: false,
        error: result.code,
        workspaceRoot: result.workspaceRoot,
        sessionResolved: result.sessionResolved
      });
    }
    return jsonResponse(200, result);
  } catch (error) {
    const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
    return jsonResponse(500, {
      ok: false,
      error: code === undefined ? 'search-failed' : 'fenced-failure',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Map one filesystem failure onto an HTTP status and a stable wire code.
 * @param error - the thrown value.
 * @returns `{ status, code }`.
 */
function failureOf(error) {
  const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
  switch (code) {
    case 'FS_STALE_VERSION':
      return { status: 409, code: 'stale-version' };
    case 'FS_NOT_OBSERVED':
      return { status: 428, code: 'not-observed' };
    case 'FS_SANDBOX_DENIED':
      return { status: 403, code: 'sandbox-denied' };
    case 'FS_NOT_FOUND':
      return { status: 404, code: 'not-found' };
    case 'FS_NOT_REGULAR_FILE':
      return { status: 400, code: 'not-regular-file' };
    default:
      return { status: 500, code: 'write-failed' };
  }
}

/**
 * Read and validate the request envelope.
 * @param request - the Fetch request.
 * @returns `{ value }` or `{ status, code }`.
 */
async function parseSaveRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return { status: 400, code: 'bad-request' };
  }
  if (body === null || typeof body !== 'object') return { status: 400, code: 'bad-request' };
  const { sessionId, absolutePath, text, version } = body;
  if (typeof sessionId !== 'string' || sessionId === '') return { status: 400, code: 'bad-request' };
  if (typeof absolutePath !== 'string' || absolutePath === '') return { status: 400, code: 'bad-request' };
  if (typeof text !== 'string') return { status: 400, code: 'bad-request' };
  if (typeof version !== 'string' && typeof version !== 'number') return { status: 400, code: 'bad-request' };
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) return { status: 413, code: 'too-large' };
  return { value: { sessionId: sessionId, absolutePath: absolutePath, text: text, version: version } };
}

/** @param status - HTTP status. @param payload - JSON body. @returns the response. */
function jsonResponse(status, payload) {
  return Response.json(payload, { status: status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Serve one save request.
 * @param ctx - context carrying the save dependencies.
 * @param request - the Fetch request.
 * @returns the Fetch response.
 */
async function handleSave(ctx, request) {
  const parsed = await parseSaveRequest(request);
  if (parsed.value === undefined) {
    return jsonResponse(parsed.status, { ok: false, error: parsed.code });
  }
  try {
    const result = await saveWorkspaceFile(ctx, parsed.value, request.signal);
    if (result.ok !== true) {
      return jsonResponse(result.status, {
        ok: false,
        error: result.code,
        workspaceRoot: result.workspaceRoot,
        sessionResolved: result.sessionResolved
      });
    }
    return jsonResponse(200, { ok: true, version: result.version, operation: result.operation });
  } catch (error) {
    const failure = failureOf(error);
    return jsonResponse(failure.status, {
      ok: false,
      error: failure.code,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Mount the save route for as long as this plugin is active.
 *
 * The route waits for the two Session-aware services the sandbox fence needs.
 * They ship in every composed profile, but keeping them out of the plugin's own
 * `inject` means a profile without them still gets the editor and the reference
 * action instead of losing the whole bundle.
 *
 * @param ctx - owning Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['sessions', 'sandboxPolicy'], (scope) => {
    scope.effect(() => ctx.connection.fetch.register({
      path: SAVE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleSave(scope, request)
    }), 'sidebar-editor: save route');
    scope.effect(() => ctx.connection.fetch.register({
      path: SEARCH_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleSearch(scope, request)
    }), 'sidebar-editor: search route');
  });
}
