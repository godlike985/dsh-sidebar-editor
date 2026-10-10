/**
 * Browser half of the sidebar editor bundle.
 *
 * Registers one document-preview implementation for code suffixes (the
 * `extension` band, so it becomes the default renderer for those files while
 * the shipped read-only "Code" renderer stays selectable in the same
 * dropdown), plus the matching body in the keyed `sidebar.right.tab.document`
 * slot. The body renders a plain editable surface with a line gutter, keeps a
 * read-only highlighted view, and references the selected line range into the
 * composer as one `@path L10-L20` token.
 *
 * Deliberate constraints:
 * - Plain classic script, no build step: the package's `./client` file is read
 *   verbatim and served as `text/javascript`, so only the browser module table
 *   (react, react-dom, cordis, client-store, ui-slots, ...) may be required.
 * - No Shiki, no CodeMirror: the editor and its light read-only highlighter are
 *   self-contained, and every color comes from a `--dsw-alias-*` / `--shiki-*`
 *   theme token.
 * - The composer is a Lexical editor owned by ui-conversation; this plugin only
 *   uses its documented `inputActions` standard prop and never touches its DOM.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-editor',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /**
     * Exact Fetch route the Host half registers on Connection.
     *
     * The browser side must spell it WITHOUT the leading slash: the desktop app
     * loads the shell over `file://` and bridges fetch over IPC, so a rooted
     * path would resolve against the filesystem root. The first-party
     * deliverables plugin converts its route the same way.
     */
    const SAVE_PATH = 'api/sidebarEditor/save';

    /**
     * Whether this panel offers its editable surface.
     *
     * The panel is a reader first: a faithful, colorized view of a file plus
     * one-click line references into the composer. Editing a file inside a
     * sidebar is a worse experience than doing it in a real editor — a
     * controlled `<textarea>` loses the browser's own undo stack, so Ctrl+Z
     * does nothing there — so the editable surface is off by default and the
     * preview/reference surface is what ships enabled.
     *
     * The editor, the save route and the conflict handling all stay in the
     * bundle behind this switch, because turning it on is the whole distance
     * back to a working editor. The host-side global override exists so the
     * offline harness can exercise both shapes in one run; in the app no such
     * global is defined and the panel is a previewer.
     *
     * @returns whether the editable surface is offered.
     */
    const editingEnabled = () =>
      (typeof __DSH_SIDEBAR_EDITOR_EDITING__ === 'boolean' ? __DSH_SIDEBAR_EDITOR_EDITING__ : false);

    /** This implementation's identity in the document-preview registry and its body slot key. */
    const IMPLEMENTATION_ID = 'dsh-sidebar-editor/code';
    /** Locale namespace this plugin registers and binds. */
    const NS = 'sidebarEditor';
    /** Row height shared by the gutter, the editor and the read-only view, in px. */
    /**
     * Code text size, in px, and the ratio that turns it into a row height.
     *
     * The application's own font-size setting (`dsh-client-ui-theme`, 10–22 px,
     * default 14) deliberately leaves code at a fixed size, so the panel carries
     * its own control with the same range. The gutter, the editor and the
     * read-only rows must all use the same line height or the numbers stop
     * lining up with the text.
     */
    const CODE_FONT_DEFAULT = 13;
    const CODE_FONT_MIN = 10;
    const CODE_FONT_MAX = 22;
    const LINE_HEIGHT_RATIO = 21 / 13;
    /** Where a chosen size is remembered, when this document has storage. */
    const FONT_SIZE_KEY = 'dsh-sidebar-editor.code-font-size';

    /** @param size - a code font size in px. @returns the row height that keeps rows aligned. */
    const lineHeightOf = (size) => Math.round(size * LINE_HEIGHT_RATIO);

    /** @returns the remembered size, or the default when nothing valid is stored. */
    function readFontSize() {
      try {
        const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY));
        if (Number.isInteger(stored) && stored >= CODE_FONT_MIN && stored <= CODE_FONT_MAX) return stored;
      } catch (error) {
        // A document without storage simply starts at the default.
      }
      return CODE_FONT_DEFAULT;
    }

    /** Remember one size, ignoring a document that forbids storage. */
    function writeFontSize(size) {
      try {
        window.localStorage.setItem(FONT_SIZE_KEY, String(size));
      } catch (error) {
        // Nothing to do: the panel keeps the size for this mount.
      }
    }
    /** Largest file the editor offers to edit; bigger files open read-only. */
    const MAX_EDIT_BYTES = 512 * 1024;
    /** Largest line count the editor offers to edit. */
    const MAX_EDIT_LINES = 20000;
    /**
     * Largest line count the read-only view colorizes. Each colored line is a
     * DOM node carrying several spans, so a many-thousand-line file would
     * otherwise build a DOM large enough to make the panel feel heavy; past
     * this bound the text renders plain, which keeps it responsive.
     */
    const MAX_HIGHLIGHT_LINES = 4000;
    /**
     * Column ceiling for the editor's width. A `MAX_EDIT_BYTES` buffer cannot
     * produce more columns than it has characters, and that many `ch` units stay
     * far below the browser's own layout limit, so this bound never clips a line
     * the editor is allowed to open — it only guards a future cap increase.
     */
    const MAX_RENDER_COLUMNS = 600000;

    /**
     * Suffixes the editor claims.
     *
     * The rule: claim every suffix the shipped Code renderer claims, minus the
     * ones another shipped renderer already presents specially. That makes this
     * editor the default for exactly the files that would otherwise open in the
     * read-only Code view, and guarantees the renderer dropdown still lists that
     * Code view beside it, so the Shiki reader stays one click away.
     *
     * The list mirrors `@deepseek-ai/dsh-util-code-language` (the table behind
     * the Code renderer). It is inlined because a plain-JS plugin may only
     * require the browser module table, which does not carry that package.
     *
     * Deliberately absent, because another renderer owns the address:
     * `md`/`markdown` (Markdown preview), `html`/`htm` (sandboxed HTML preview),
     * `svg` (image), `pdf`, the bitmap image set, `xlsx`/`xls`/`csv`/`tsv`
     * (spreadsheet), and the Office set.
     *
     * The trailing entries are extras the Code table does not list. For those
     * files this editor is the only candidate, so the dropdown does not appear;
     * the in-panel read-only toggle is the way back to a plain view.
     */
    const CODE_EXTENSIONS = [
      'ts', 'tsx', 'mts', 'cts',
      'js', 'jsx', 'mjs', 'cjs',
      'sh', 'bash', 'zsh', 'fish',
      'json', 'jsonc', 'jsonl', 'ndjson', 'ipynb',
      'py', 'pyw', 'pyi',
      'rb', 'rake', 'gemspec',
      'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx',
      'cs', 'kt', 'kts', 'swift', 'php',
      'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env',
      'log', 'diff', 'patch', 'http', 'mdx', 'rst',
      'tex', 'sty', 'cls', 'bib', 'adoc', 'xhtml',
      'css', 'scss', 'less', 'sql',
      'xml', 'xsd', 'xsl', 'xslt', 'plist',
      'lua', 'bat', 'cmd', 'ps1', 'psm1', 'psd1',
      'r', 'jl', 'dart', 'scala',
      'clj', 'cljs', 'edn', 'erl', 'hrl', 'ex', 'exs', 'hs',
      'fs', 'fsi', 'fsx', 'vb', 'pl', 'pm', 'v', 'sv', 'svh',
      'graphql', 'gql', 'proto', 'tf', 'tfvars', 'hcl', 'nix',
      'vue', 'svelte', 'makefile', 'mk', 'cmake', 'gradle', 'groovy',
      // Extras this editor adds beyond the Code table.
      'm', 'mm', 'pas', 'astro', 'thrift', 'json5', 'sass', 'styl', 'tpl', 'txt',
      'lock', 'gitignore', 'editorconfig', 'npmrc'
    ];

    /** Suffixes whose `#` starts a line comment. */
    const HASH_COMMENT_EXTENSIONS = new Set([
      'py', 'pyw', 'pyi', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1',
      'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env',
      'r', 'pl', 'pm', 'rb', 'rake', 'gemspec', 'makefile', 'mk', 'cmake',
      'gitignore', 'editorconfig', 'npmrc', 'tf', 'tfvars', 'hcl', 'nix', 'jl', 'ex', 'exs'
    ]);

    /** Suffixes whose `--` starts a line comment. */
    const DASH_COMMENT_EXTENSIONS = new Set(['sql', 'hs', 'lua', 'adb', 'ads']);

    /** Suffixes that carry markup, where `<tag attr="…">` gets its own coloring. */
    const MARKUP_EXTENSIONS = new Set(['vue', 'svelte', 'astro', 'xhtml', 'xml', 'xsd', 'xsl', 'xslt', 'plist', 'tpl']);

    /** Suffixes with triple-quoted strings, so a docstring colors as one string. */
    const TRIPLE_QUOTE_EXTENSIONS = new Set(['py', 'pyw', 'pyi']);

    /**
     * Keywords the read-only highlighter tints. One shared cross-language set:
     * the read-only view is a reading aid, not a grammar.
     */
    const KEYWORDS = new Set([
      'abstract', 'and', 'as', 'assert', 'async', 'await', 'base', 'begin', 'break', 'case', 'catch',
      'class', 'const', 'constructor', 'continue', 'def', 'default', 'defer', 'del', 'delete', 'do',
      'elif', 'else', 'elsif', 'end', 'enum', 'except', 'export', 'extends', 'extern',
      'final', 'finally', 'fn', 'for', 'foreach', 'from', 'func', 'function', 'global', 'go', 'if',
      'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'lambda', 'let', 'local',
      'match', 'module', 'mut', 'namespace', 'new', 'not', 'object', 'or',
      'override', 'package', 'pass', 'private', 'protected', 'public', 'raise', 'readonly', 'record',
      'return', 'self', 'static', 'struct', 'super', 'switch', 'synchronized', 'then', 'this',
      'throw', 'trait', 'try', 'type', 'typeof', 'undef', 'union', 'unless', 'until',
      'use', 'using', 'var', 'virtual', 'void', 'when', 'where', 'while', 'with', 'yield'
    ]);

    /** Literals tinted as constants, checked before the keyword set. */
    const LITERALS = new Set([
      'true', 'false', 'null', 'undefined', 'none', 'nil', 'nan', 'inf',
      'True', 'False', 'None', 'Nil', 'NaN', 'Inf', 'TRUE', 'FALSE', 'NULL', 'NONE'
    ]);

    /** Declaration words whose following identifier is a type or class name. */
    const DECLARATION_KEYWORDS = new Set([
      'class', 'interface', 'struct', 'enum', 'trait', 'type', 'record', 'union', 'namespace', 'module'
    ]);

    /**
     * The editor's right-click menu, which carries the standard edit actions as
     * well as the reference action: suppressing the browser's menu with
     * `preventDefault` would otherwise take copy, cut and paste away with it.
     * The read-only surface has no editable buffer, so it offers only what
     * applies there.
     */
    const MENU_LAYOUT = {
      edit: ['reference', 'referenceFile', 'referenceDirectory', 'separator', 'cut', 'copy', 'paste', 'selectAll'],
      read: ['reference', 'referenceDirectory', 'referenceFile', 'separator', 'copy']
    };

    /** Menu item id to locale key. */
    const MENU_LABEL_KEYS = {
      reference: 'action.reference',
      referenceFile: 'action.referenceFile',
      referenceDirectory: 'action.referenceDirectory',
      cut: 'action.cut',
      copy: 'action.copy',
      paste: 'action.paste',
      selectAll: 'action.selectAll'
    };

    //#region address grammar (mirrors @deepseek-ai/dsh-util-workspace-path)
    /** The scheme and type every file address opens with. */
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

    /**
     * Read a `dsh-resource://file/session/<id>/<path>` address back into its
     * parts. Only the session scope is handled: an `absolute` address carries no
     * authorized Session, so this plugin cannot read or reference through it.
     * @param address - a candidate resource address.
     * @returns `{ sessionId, path }`, or `undefined` when the address is not a
     *   session-scoped file address.
     */
    function parseFileAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
      const end = address.search(/[?#]/);
      const segments = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/');
      const scope = segments.shift();
      if (scope !== 'session') return undefined;
      const id = segments.shift();
      if (id === undefined || id === '' || segments.length === 0) return undefined;
      try {
        return {
          sessionId: decodeURIComponent(id),
          path: segments.map(decodeURIComponent).join('/')
        };
      } catch (error) {
        return undefined;
      }
    }

    /**
     * Format a path as the shared `@file` mention (mirrors the seam's formatter).
     * @param path - workspace-relative or absolute path.
     * @returns the mention text, or `undefined` for a path the grammar cannot
     *   represent safely.
     */
    function formatMention(path) {
      if (typeof path !== 'string' || path === '') return undefined;
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;
      return /\s/u.test(path) ? '@"' + path + '"' : '@' + path;
    }

    /** @param path - any path spelling. @returns its final non-empty segment. */
    function baseNameOf(path) {
      const trimmed = String(path).replace(/[/\\]+$/u, '');
      const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      return trimmed.slice(cut + 1);
    }

    /**
     * @param path - a workspace-relative path.
     * @returns its directory part, or an empty string at the workspace root.
     */
    function parentPathOf(path) {
      const trimmed = String(path).replace(/[/\\]+$/u, '');
      const cut = trimmed.lastIndexOf('/');
      return cut <= 0 ? '' : trimmed.slice(0, cut);
    }
    //#endregion

    //#region line and selection helpers
    /** @param text - whole document text. @returns its line count (a trailing newline adds no line). */
    function lineCountOf(text) {
      if (text === '') return 1;
      let count = 1;
      for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) count += 1;
      return text.charCodeAt(text.length - 1) === 10 ? count - 1 : count;
    }

    /**
     * The 1-based line holding one character offset.
     * @param text - whole document text.
     * @param offset - character offset.
     * @returns the 1-based line number.
     */
    function lineAt(text, offset) {
      let line = 1;
      const limit = Math.max(0, Math.min(offset, text.length));
      for (let index = 0; index < limit; index += 1) if (text.charCodeAt(index) === 10) line += 1;
      return line;
    }

    /**
     * Turn a text-range selection into a 1-based inclusive line range. A
     * collapsed selection names the caret's line; a selection ending exactly at
     * a line start does not include that line.
     * @param text - whole document text.
     * @param start - selection start offset.
     * @param end - selection end offset.
     * @returns `{ start, end }`, both 1-based and inclusive.
     */
    function lineRangeOf(text, start, end) {
      const low = Math.max(0, Math.min(start, end));
      const high = Math.max(0, Math.max(start, end));
      if (low === high) {
        const line = lineAt(text, low);
        return { start: line, end: line };
      }
      const head = high > low && text.charCodeAt(high - 1) === 10 ? high - 1 : high;
      return { start: lineAt(text, low), end: lineAt(text, head) };
    }

    /**
     * @param range - a 1-based inclusive line range.
     * @returns its display label, in the conventional `L10` / `L10-L20` spelling.
     */
    function rangeLabelOf(range) {
      if (range === null || range === undefined) return '';
      return range.start === range.end
        ? 'L' + range.start
        : 'L' + range.start + '-L' + range.end;
    }
    //#endregion

    //#region read-only highlighter
    /** @param value - raw text. @returns HTML-escaped text. */
    function escapeHtml(value) {
      return String(value)
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;');
    }

    /** @param kind - token class suffix. @param value - raw token text. @returns one escaped span. */
    function tokenSpan(kind, value) {
      return '<span class="dsh-se-' + kind + '">' + escapeHtml(value) + '</span>';
    }

    const IDENTIFIER_START = /[A-Za-z_$]/;
    const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
    const DIGIT = /[0-9]/;
    /** Punctuation tinted separately from identifiers and operators. */
    const PUNCTUATION = '(){}[];,';
    /** Markup tag openers: `<div`, `</div`, `<!--`, `<?xml`. */
    const TAG_OPEN = /[A-Za-z_/!?]/;

    /**
     * Highlight one line into escaped HTML.
     *
     * This is a reading aid, deliberately a single-pass tokenizer rather than a
     * grammar: it distinguishes comments, strings (including Python
     * triple-quoted blocks carried across lines), numeric and literal constants,
     * keywords, function calls and definitions, decorators, class and type
     * names, properties after `.`, markup tags and attributes, and punctuation.
     * Every emitted character goes through {@link escapeHtml}, so file content
     * can never close one of these spans or open a tag of its own.
     *
     * @param line - one raw source line, without its terminator.
     * @param options - `{ hashComment, dashComment, markup, triple }` for the suffix.
     * @param state - carry across lines: `{ mode, delimiter }`.
     * @returns escaped HTML for one rendered line.
     */
    function highlightLine(line, options, state) {
      let out = '';
      let index = 0;
      /** The previous meaningful character, for `.property` and declaration context. */
      let previous = '';
      let inTag = false;
      let tagNameTaken = false;
      /** Set by a declaration keyword so the next identifier reads as a type name. */
      let expectTypeName = false;

      while (index < line.length) {
        // A block comment or triple-quoted string carried in from an earlier line.
        if (state.mode !== null) {
          const close = line.indexOf(state.delimiter, index);
          const kind = state.mode === 'block' ? 'comment' : 'string';
          if (close === -1) return out + tokenSpan(kind, line.slice(index));
          out += tokenSpan(kind, line.slice(index, close + state.delimiter.length));
          index = close + state.delimiter.length;
          state.mode = null;
          state.delimiter = '';
          continue;
        }

        const char = line[index];
        const next = line[index + 1];
        const third = line[index + 2];

        if (char === '/' && next === '/') return out + tokenSpan('comment', line.slice(index));
        if (char === '#' && options.hashComment) return out + tokenSpan('comment', line.slice(index));
        if (char === '-' && next === '-' && options.dashComment) return out + tokenSpan('comment', line.slice(index));
        if (char === '/' && next === '*') {
          const close = line.indexOf('*/', index + 2);
          if (close === -1) {
            state.mode = 'block';
            state.delimiter = '*/';
            return out + tokenSpan('comment', line.slice(index));
          }
          out += tokenSpan('comment', line.slice(index, close + 2));
          index = close + 2;
          previous = '/';
          continue;
        }

        if (options.triple && (char === '"' || char === "'") && next === char && third === char) {
          const delimiter = char + char + char;
          const close = line.indexOf(delimiter, index + 3);
          if (close === -1) {
            state.mode = 'triple';
            state.delimiter = delimiter;
            return out + tokenSpan('string', line.slice(index));
          }
          out += tokenSpan('string', line.slice(index, close + 3));
          index = close + 3;
          previous = char;
          continue;
        }

        if (char === '"' || char === "'" || char === '`') {
          let cursor = index + 1;
          while (cursor < line.length) {
            if (line[cursor] === '\\') {
              cursor += 2;
              continue;
            }
            if (line[cursor] === char) {
              cursor += 1;
              break;
            }
            cursor += 1;
          }
          const stop = Math.min(cursor, line.length);
          out += tokenSpan('string', line.slice(index, stop));
          index = stop;
          previous = char;
          continue;
        }

        // Markup: color the tag name once, then every other word as an attribute.
        if (options.markup && char === '<' && TAG_OPEN.test(next === undefined ? '' : next)) {
          out += tokenSpan('punctuation', char);
          inTag = true;
          tagNameTaken = false;
          index += 1;
          previous = char;
          continue;
        }
        if (inTag && char === '>') {
          out += tokenSpan('punctuation', char);
          inTag = false;
          index += 1;
          previous = char;
          continue;
        }

        if (DIGIT.test(char)) {
          let cursor = index;
          while (cursor < line.length && /[0-9A-Za-z_.]/u.test(line[cursor])) cursor += 1;
          out += tokenSpan('constant', line.slice(index, cursor));
          index = cursor;
          previous = char;
          continue;
        }

        // A decorator or annotation: `@name`, `#[…]`, `[Attribute]`-style `@`.
        if (char === '@' && IDENTIFIER_START.test(next === undefined ? '' : next)) {
          out += tokenSpan('punctuation', char);
          let cursor = index + 1;
          while (cursor < line.length && IDENTIFIER_PART.test(line[cursor])) cursor += 1;
          out += tokenSpan('name', line.slice(index + 1, cursor));
          index = cursor;
          previous = 'e';
          continue;
        }

        if (IDENTIFIER_START.test(char)) {
          let cursor = index;
          while (cursor < line.length && IDENTIFIER_PART.test(line[cursor])) cursor += 1;
          const word = line.slice(index, cursor);
          let lookahead = cursor;
          while (lookahead < line.length && line[lookahead] === ' ') lookahead += 1;
          const declared = expectTypeName || DECLARATION_KEYWORDS.has(previous);
          // Inside a markup tag every word is a tag or attribute name, so the
          // language keyword set must not claim `class` / `for` / `type` there.
          if (inTag) out += tokenSpan(tagNameTaken ? 'parameter' : 'name', word);
          else if (LITERALS.has(word)) out += tokenSpan('constant', word);
          else if (KEYWORDS.has(word)) out += tokenSpan('keyword', word);
          else if (declared || previous === '.') out += tokenSpan('name', word);
          else if (line[lookahead] === '(') out += tokenSpan('function', word);
          else out += escapeHtml(word);
          if (inTag && !tagNameTaken) tagNameTaken = true;
          expectTypeName = DECLARATION_KEYWORDS.has(word);
          index = cursor;
          previous = word;
          continue;
        }

        if (PUNCTUATION.indexOf(char) !== -1) {
          out += tokenSpan('punctuation', char);
          index += 1;
          previous = char;
          continue;
        }

        out += escapeHtml(char);
        if (char !== ' ') previous = char;
        index += 1;
      }
      return out;
    }

    /**
     * Highlight a whole document, one HTML string per line.
     * @param text - whole document text.
     * @param extension - the file's final suffix.
     * @returns one escaped HTML string per line.
     */
    function highlightLines(text, extension) {
      const options = {
        hashComment: HASH_COMMENT_EXTENSIONS.has(extension),
        dashComment: DASH_COMMENT_EXTENSIONS.has(extension),
        markup: MARKUP_EXTENSIONS.has(extension),
        triple: TRIPLE_QUOTE_EXTENSIONS.has(extension)
      };
      const state = { mode: null, delimiter: '' };
      return text.split('\n').map((line) => highlightLine(line, options, state));
    }
    //#endregion

    //#region composer insertion
    /**
     * Insert one `@path L10-L20` reference token into the composer.
     *
     * The primary path is the documented `inputActions` standard prop of a
     * session-scoped slot entry: `captureInsertion()` snapshots the caret span
     * and `insertText(text, span)` splices plain text there, which the composer
     * then re-scans into a styled reference token. The fallback only fills an
     * empty draft through the resident input shell, because replacing a
     * non-empty draft would drop the chips already in it.
     *
     * A chip (input shell `addFiles`) is deliberately NOT used: send-time
     * serialization rebuilds each chip's text from its `ref` through the source
     * codec, so a line range carried on a chip would never reach the model.
     *
     * @param props - the slot entry's props.
     * @param ctx - this plugin's Client context.
     * @param sessionId - the Session the reference belongs to.
     * @param text - the serialized reference text, without a trailing space.
     * @returns `true` when inserted, `'busy'` when the composer refused, and
     *   `'unavailable'` when no insertion surface was found.
     */
    function insertReference(props, ctx, sessionId, text) {
      const actions = props.inputActions;
      if (actions && typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
        try {
          return actions.insertText(text + ' ', actions.captureInsertion()) ? true : 'busy';
        } catch (error) {
          // Fall through to the resident shell.
        }
      }
      try {
        const conversation = ctx.get('conversation');
        const input = conversation && conversation.input;
        if (input && typeof input.shell === 'function') {
          const shell = input.shell(sessionId);
          if (shell) {
            const draft = shell.snapshot && typeof shell.snapshot.draft === 'string' ? shell.snapshot.draft : '';
            if (draft.trim() === '' && typeof shell.setDraft === 'function') {
              shell.setDraft(text + ' ');
              return true;
            }
            return 'busy';
          }
        }
      } catch (error) {
        return 'unavailable';
      }
      return 'unavailable';
    }
    //#endregion

    //#region save failures
    /**
     * Turn one save failure into a localized sentence. The Host answers with a
     * stable code, so this branches on the code and never on message text.
     * @param t - the bound translator.
     * @param code - the Host's error code, or an empty string.
     * @param status - the HTTP status.
     * @param root - the workspace root the Host fenced the write to, when reported.
     * @param resolved - whether the Host resolved the Session (false means the
     *   deployment fallback root decided, which is a different bug to chase).
     * @returns the sentence to show.
     */
    function saveFailureText(t, code, status, root, resolved) {
      switch (code) {
        case 'stale-version':
          return t('error.stale');
        case 'read-only-mode':
          return t('error.readOnlyMode');
        case 'sandbox-denied':
          if (root === '') return t('error.denied');
          return resolved ? t('error.deniedRoot', { root: root }) : t('error.deniedUnresolved', { root: root });
        case 'not-observed':
          return t('error.notObserved');
        case 'not-found':
          return t('error.notFound');
        case 'not-regular-file':
          return t('error.notRegularFile');
        case 'too-large':
          return t('error.tooLarge');
        case 'bad-request':
          return t('error.badRequest');
        default:
          // A missing route means the host half never mounted, which is a
          // different problem from a refusal and deserves its own sentence.
          if (status === 404) return t('error.noRoute');
          return t('error.saveFailed', { status: status });
      }
    }
    //#endregion

    //#region styles
    /** Plugin-scoped stylesheet text, mounted on the document by `mountStyleSheet`. */
    const CSS = [
      '.dsh-se-root{display:flex;flex:auto;flex-direction:column;min-height:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}',
      '.dsh-se-bar{display:flex;flex:none;align-items:center;gap:6px;height:32px;padding:0 8px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-se-seg{display:flex;align-items:center;gap:2px}',
      '.dsh-se-seg>button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;height:22px;padding:0 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dsh-se-seg>button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-se-seg>button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-se-range{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.dsh-se-hint{font-size:12px;color:var(--dsw-alias-label-quaternary);white-space:nowrap}',
      '.dsh-se-size{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.dsh-se-spacer{flex:1 1 auto}',
      '.dsh-se-btn{display:inline-flex;align-items:center;border:0;border-radius:var(--dsw-radius-sm);font:inherit;font-size:12px;line-height:18px;height:24px;padding:0 10px;cursor:pointer;background:var(--dsw-alias-button-tool-bar-fill);color:var(--dsw-alias-label-primary)}',
      '.dsh-se-btn:hover:not(:disabled){background:var(--dsw-alias-button-tool-bar-hover)}',
      '.dsh-se-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.dsh-se-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.dsh-se-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.dsh-se-banner{display:flex;flex:none;align-items:center;gap:8px;flex-wrap:wrap;margin:0;padding:6px 12px;font-size:12px;line-height:18px;border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-se-banner[data-kind="warn"]{color:var(--dsw-alias-state-warn-label)}',
      '.dsh-se-banner[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-se-scroll{flex:1 1 auto;min-height:0;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
      '.dsh-se-grid{display:flex;align-items:flex-start;min-width:100%;width:max-content}',
      '.dsh-se-gutter{position:sticky;left:0;z-index:1;flex:none;margin:0;padding:8px 10px 8px 12px;text-align:right;user-select:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:var(--dsh-se-size);line-height:var(--dsh-se-line);white-space:pre}',
      '.dsh-se-area{flex:1 1 auto;display:block;margin:0;border:0;outline:none;resize:none;overflow:hidden;padding:8px 12px;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:var(--dsh-se-size);line-height:var(--dsh-se-line);tab-size:4;white-space:pre}',
      '.dsh-se-pre{flex:1 1 auto;margin:0;padding:8px 12px;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:var(--dsh-se-size);line-height:var(--dsh-se-line);white-space:pre}',
      '.dsh-se-row{min-height:var(--dsh-se-line)}',
      '.dsh-se-row[data-selected="true"]{background:var(--dsw-alias-bg-document-selection)}',
      '.dsh-se-comment{color:var(--shiki-token-comment,var(--dsw-alias-label-tertiary))}',
      '.dsh-se-string{color:var(--shiki-token-string,var(--dsw-alias-state-success-primary))}',
      '.dsh-se-constant{color:var(--shiki-token-constant,var(--dsw-alias-state-warn-primary))}',
      '.dsh-se-keyword{color:var(--shiki-token-keyword,var(--dsw-alias-brand-primary))}',
      '.dsh-se-name{color:var(--shiki-token-name,var(--dsw-alias-state-business-primary))}',
      '.dsh-se-function{color:var(--shiki-token-function,var(--dsw-alias-link))}',
      '.dsh-se-parameter{color:var(--shiki-token-parameter,var(--dsw-alias-label-secondary))}',
      '.dsh-se-punctuation{color:var(--shiki-token-punctuation,var(--dsw-alias-label-tertiary))}',
      '.dsh-se-menu{position:fixed;z-index:40;min-width:150px;padding:4px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-bg-mask-2)}',
      '.dsh-se-menu>button{display:block;width:100%;text-align:start;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:6px 10px;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dsh-se-menu>button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-se-menu>button[disabled]{color:var(--dsw-alias-label-quaternary);cursor:default}',
      '.dsh-se-menu>button[disabled]:hover{background:transparent}',
      '.dsh-se-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2)}',
      '.dsh-se-menu-note{padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-se-menu-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '[data-se-tree-hit]{outline:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff) !important;outline-offset:-1px;background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff) 22%, transparent) !important;border-radius:var(--dsw-radius-sm)}',
      '.dsh-se-note{max-width:420px;padding:6px 10px;font-size:12px;line-height:16px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 4px 14px rgba(0,0,0,.28)}',
      '.dsh-se-note[data-se-search-note=pending]{opacity:.85}',
      '.dsh-se-note[data-se-search-note=bad]{border-color:var(--dsw-alias-status-error-color, #d9534f)}',
      '.dsh-se-files-search{display:flex;align-items:center;min-width:0;order:-1;margin-right:12px}',
      '.dsh-se-files-input{width:132px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;height:20px;padding:0 6px;outline:none}',
      '.dsh-se-files-input:focus{width:180px}',
      '.dsh-se-search{display:flex;flex:auto;flex-direction:column;min-height:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}',
      '.dsh-se-search-bar{flex:none;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-se-search-modes{display:flex;gap:2px;margin-bottom:6px}',
      '.dsh-se-search-mode{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;padding:2px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dsh-se-search-mode[data-on=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-se-search-text{color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-se-find{display:flex;align-items:center;gap:6px;flex:none;padding:3px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.dsh-se-find-input{flex:1 1 auto;min-width:0;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:2px 6px;outline:none}',
      '.dsh-se-find-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-se-row[data-se-match=true]{background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff) 14%, transparent)}',
      '.dsh-se-row[data-se-current=true]{background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff) 26%, transparent);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4c8dff)}',
      '.dsh-se-root{outline:none}',
      '.dsh-se-search-input{width:100%;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;padding:5px 8px;outline:none}',
      '.dsh-se-search-status{flex:none;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-se-search-list{flex:auto;min-height:0;overflow:auto;padding:4px 6px 10px}',
      '.dsh-se-search-row{display:flex;align-items:center;gap:4px;border-radius:var(--dsw-radius-sm)}',
      '.dsh-se-search-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-se-search-hit{display:flex;flex:auto;min-width:0;align-items:baseline;gap:8px;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:start;padding:4px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dsh-se-search-name{font-family:var(--ds-font-family-code,ui-monospace,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-se-search-dir{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-se-search-ref{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;padding:2px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dsh-se-search-ref:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
    ].join('\n');

    /**
     * Mount this plugin's stylesheet on the document, once, for as long as the
     * plugin lives. It is not a component: the tree menu can open while no
     * document panel is mounted, and it needs the same rules.
     * @returns a disposer that removes the element.
     */
    function mountStyleSheet() {
      if (typeof document === 'undefined' || document.head === undefined) return () => {};
      const element = document.createElement('style');
      element.setAttribute('data-plugin', 'dsh-sidebar-editor');
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        if (typeof element.remove === 'function') element.remove();
        else if (document.head.removeChild !== undefined) document.head.removeChild(element);
      };
    }
    //#endregion

    /** @returns the document's clipboard API, when it has one. */
    function clipboardOf() {
      return typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    }

    /**
     * Write text to the clipboard.
     *
     * Both menus have to carry the standard edit actions themselves: a plugin
     * cannot add an item to the application's own context menu, and letting both
     * menus appear at the pointer would stack them. So `preventDefault` is only
     * honest if the menu replaces what it suppressed.
     *
     * @param text - the text to place on the clipboard.
     * @returns whether a route succeeded.
     */
    async function writeClipboard(text) {
      const api = clipboardOf();
      if (api !== undefined && typeof api.writeText === 'function') {
        try {
          await api.writeText(text);
          return true;
        } catch (error) {
          // Fall through to the document-level command.
        }
      }
      try {
        const scratch = document.createElement('textarea');
        scratch.value = text;
        scratch.setAttribute('readonly', 'readonly');
        scratch.style.position = 'fixed';
        scratch.style.opacity = '0';
        document.body.appendChild(scratch);
        scratch.select();
        const copied = document.execCommand('copy') === true;
        document.body.removeChild(scratch);
        return copied;
      } catch (error) {
        return false;
      }
    }

    /** @returns the clipboard text, or `undefined` when the document forbids reading it. */
    async function readClipboard() {
      const api = clipboardOf();
      if (api === undefined || typeof api.readText !== 'function') return undefined;
      try {
        return await api.readText();
      } catch (error) {
        return undefined;
      }
    }
    /**
     * @returns the line range the browser's own text selection covers inside this
     *   panel, or `undefined` when the selection is collapsed or elsewhere.
     *
     * Selecting lines by dragging is the natural gesture in a read-only view, and
     * it produces a DOM selection rather than a click, so the range has to be read
     * back from it. Rows carry `data-se-line`; the attribute is unique to this
     * panel, so a selection in another view can never be mistaken for one here.
     */
    function selectedLineRange() {
      if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return undefined;
      const selection = window.getSelection();
      if (selection === null || selection === undefined) return undefined;
      if (selection.isCollapsed === true || selection.rangeCount === 0) return undefined;
      const range = selection.getRangeAt(0);
      const rowOf = (node) => {
        if (node === null || node === undefined) return null;
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (element === null || element === undefined || typeof element.closest !== 'function') return null;
        return element.closest('[data-se-line]');
      };
      const first = rowOf(range.startContainer);
      const last = rowOf(range.endContainer);
      if (first === null || last === null) return undefined;
      const a = Number(first.getAttribute('data-se-line'));
      const b = Number(last.getAttribute('data-se-line'));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    //#endregion

    //#region body
    /**
     * One document body: the editable surface, its gutter, its read-only view
     * and the reference action.
     * @param props - document body props plus this plugin's context.
     * @returns the body element tree.
     */
    function EditorBody(props) {
      const t = props.t;
      const ctx = props.pluginCtx;
      const address = props.resourceAddress;
      const file = React.useMemo(() => parseFileAddress(address), [address]);
      const loaded = props.content && props.content.kind === 'text';
      const source = loaded ? props.content.text : '';
      const complete = loaded ? props.content.eof !== false : false;

      // The standard `useResource` root keyed hook names the file's live
      // metadata: the absolute path to write and the opaque version the save
      // guard compares against.
      const meta = typeof props.useResource === 'function' ? props.useResource(address) : undefined;
      const metaValue = meta !== undefined && meta !== null && meta.value !== undefined && meta.value !== null
        ? meta.value
        : undefined;
      const diskVersion = metaValue === undefined ? undefined : metaValue.version;
      const absolutePath = metaValue === undefined ? undefined : metaValue.absolutePath;

      const [mode, setMode] = React.useState('edit');
      const [draft, setDraft] = React.useState(source);
      const [savedText, setSavedText] = React.useState(source);
      const [baseVersion, setBaseVersion] = React.useState(diskVersion);
      const [caretRange, setCaretRange] = React.useState({ start: 1, end: 1 });
      const [pickedRange, setPickedRange] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      // Find inside the open file: the bar, the term, and which hit is current.
      const [findOpen, setFindOpen] = React.useState(false);
      const [findTerm, setFindTerm] = React.useState('');
      const [findAt, setFindAt] = React.useState(0);
      const findInputRef = React.useRef(null);
      /** Line number → its row element, so a hit can be scrolled to. */
      const rowNodes = React.useRef({});
      const [saving, setSaving] = React.useState(false);
      /** The editor's own right-click menu, in viewport coordinates. */
      const [menu, setMenu] = React.useState(null);
      /** Code text size, remembered per document when storage is available. */
      const [fontSize, setFontSize] = React.useState(readFontSize);
      const lineHeight = lineHeightOf(fontSize);
      const areaRef = React.useRef(null);
      /** Mirror of the buffer, so the adopt effect need not depend on it. */
      const draftRef = React.useRef(source);
      /** Mirror of the last text known to be on disk. */
      const savedRef = React.useRef(source);
      /**
       * The disk text our own last write replaced. Until the reader reports
       * anything else it is still serving the pre-write read, so adopting it
       * would revert the save we just made.
       */
      const staleRef = React.useRef(undefined);
      draftRef.current = draft;
      savedRef.current = savedText;

      const readerBehind = staleRef.current !== undefined && source === staleRef.current;

      // Adopt the shared reader's text and version only while the buffer has no
      // unsaved edits and the reader is not echoing what our own write replaced.
      React.useEffect(() => {
        if (draftRef.current !== savedRef.current) return;
        if (staleRef.current !== undefined && source === staleRef.current) return;
        staleRef.current = undefined;
        draftRef.current = source;
        savedRef.current = source;
        setDraft(source);
        setSavedText(source);
        if (diskVersion !== undefined) setBaseVersion(diskVersion);
      }, [source, diskVersion]);

      const lines = React.useMemo(() => draft.split('\n'), [draft]);
      const oversize = source.length > MAX_EDIT_BYTES || lineCountOf(source) > MAX_EDIT_LINES;
      // Editing waits for the whole text: a partially loaded buffer would drop
      // the unread tail on save. It is also off entirely by default.
      const readOnly = !editingEnabled() || oversize || !complete;
      // Colorizing every line builds one node per line; past the cap the text
      // stays plain so a huge file cannot make the panel heavy.
      const plainForSize = lines.length > MAX_HIGHLIGHT_LINES;

      React.useEffect(() => {
        if (readOnly) setMode('read');
      }, [readOnly]);

      const dirty = draft !== savedText;
      // The disk moved past the version this buffer was based on: a save would
      // silently drop somebody else's edit, so it asks first.
      const diskMoved = !readerBehind && baseVersion !== undefined && diskVersion !== undefined
        && String(diskVersion) !== String(baseVersion);
      const saveable = dirty && !readOnly && absolutePath !== undefined && baseVersion !== undefined && !saving;
      // Say why the Save button is dim instead of leaving it unexplained.
      const saveHint = !dirty
        ? t('hint.saveClean')
        : (absolutePath === undefined || baseVersion === undefined ? t('error.noBaseline') : t('hint.saveReady'));
      const range = mode === 'read' && pickedRange !== null ? pickedRange : caretRange;
      const rangeText = rangeLabelOf(range);
      /** Whether this file has a directory to reference. */
      const hasParent = file !== undefined && parentPathOf(file.path) !== '';

      /** Recompute the caret's line range from the live selection. */
      const syncSelection = React.useCallback(() => {
        const area = areaRef.current;
        if (area === null) return;
        setCaretRange(lineRangeOf(area.value, area.selectionStart, area.selectionEnd));
      }, []);

      /** Keep the editor's menu inside the viewport when the pointer sits at an edge. */
      const clampToViewport = (value, limit, size) =>
        (typeof limit === 'number' && limit > size ? Math.min(value, limit - size) : value);

      /** @returns the text selected right now, in whichever surface is mounted. */
      const selectedText = () => {
        const area = areaRef.current;
        if (area !== null) return area.value.slice(area.selectionStart, area.selectionEnd);
        if (typeof window.getSelection !== 'function') return '';
        const selection = window.getSelection();
        return selection === null || selection === undefined ? '' : String(selection.toString());
      };

      /**
       * Splice text into the buffer at the caret, the way typing does: the draft
       * and its ref move together, and the caret is restored after the
       * controlled value re-renders.
       * @param insert - the replacement for the current selection.
       */
      const spliceAtCaret = (insert) => {
        const area = areaRef.current;
        if (area === null) return;
        const start = area.selectionStart;
        const next = draftRef.current.slice(0, start) + insert + draftRef.current.slice(area.selectionEnd);
        const caret = start + insert.length;
        draftRef.current = next;
        setDraft(next);
        setCaretRange(lineRangeOf(next, caret, caret));
        setTimeout(() => {
          const restored = areaRef.current;
          if (restored === null) return;
          restored.focus();
          restored.setSelectionRange(caret, caret);
        }, 0);
      };

      /** Copy the selection, reporting a refusal instead of failing silently. */
      const copySelection = async () => {
        const text = selectedText();
        if (text === '') return;
        if (!(await writeClipboard(text))) setNotice({ kind: 'error', text: t('error.clipboardWrite') });
      };

      /** Cut the selection: place it on the clipboard, then splice it out. */
      const cutSelection = async () => {
        const text = selectedText();
        if (text === '') return;
        if (!(await writeClipboard(text))) {
          setNotice({ kind: 'error', text: t('error.clipboardWrite') });
          return;
        }
        spliceAtCaret('');
      };

      /** Paste at the caret. The browser may refuse to read the clipboard. */
      const pasteSelection = async () => {
        const text = await readClipboard();
        if (text === undefined) {
          setNotice({ kind: 'error', text: t('error.clipboardRead') });
          return;
        }
        spliceAtCaret(text);
      };

      /** Select the whole buffer, in whichever surface is mounted. */
      const selectAll = () => {
        const area = areaRef.current;
        if (area === null) return;
        area.focus();
        area.select();
        setCaretRange(lineRangeOf(area.value, 0, area.value.length));
      };

      /** Step the code font size within its bounds and remember it. */
      const changeFontSize = (delta) => {
        const next = Math.min(CODE_FONT_MAX, Math.max(CODE_FONT_MIN, fontSize + delta));
        if (next === fontSize) return;
        setFontSize(next);
        writeFontSize(next);
      };

      /** Open the editor's own right-click menu at the pointer. */
      const openMenu = (event) => {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        setNotice(null);
        setMenu({
          x: clampToViewport(event.clientX, window.innerWidth, 180),
          y: clampToViewport(event.clientY, window.innerHeight, 48),
          hasSelection: selectedText() !== ''
        });
      };

      // The menu closes on any interaction outside it. A mousedown INSIDE it
      // must not dismiss: dismissing unmounts the menu before the browser
      // dispatches the click, so the item's action would never run.
      React.useEffect(() => {
        if (menu === null) return undefined;
        const close = (event) => {
          const target = event === undefined ? undefined : event.target;
          const inside = target !== undefined && target !== null && typeof target.closest === 'function'
            ? target.closest('.dsh-se-menu') !== null
            : false;
          if (inside) return;
          setMenu(null);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setMenu(null);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', close);
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', close);
        };
      }, [menu]);

      const maxColumns = React.useMemo(() => {
        let widest = 0;
        for (const line of lines) {
          const width = line.indexOf('\t') === -1 ? line.length : line.replace(/\t/gu, '    ').length;
          if (width > widest) widest = width;
        }
        return Math.max(40, Math.min(widest + 4, MAX_RENDER_COLUMNS));
      }, [lines]);

      const highlighted = React.useMemo(
        () => (mode === 'read' && !oversize && !plainForSize ? highlightLines(draft, extensionOf(file)) : null),
        [mode, draft, oversize, plainForSize, file]
      );

      /** Select one line, extending from the existing anchor when Shift is held. */
      const pickLine = (line, extend) => {
        setNotice(null);
        if (extend && pickedRange !== null) {
          setPickedRange({ start: Math.min(pickedRange.start, line), end: Math.max(pickedRange.end, line) });
          return;
        }
        setPickedRange({ start: line, end: line });
      };

      /**
       * Adopt a dragged-out text selection as the picked range.
       *
       * A click lands after the drag that made the selection, so the row's click
       * handler asks here first: a multi-line selection outranks the line it
       * happened to finish on.
       */
      const adoptSelection = () => {
        const selected = selectedLineRange();
        if (selected === undefined) return false;
        setPickedRange(selected);
        return true;
      };

      /** The directory this file sits in, as a workspace-relative path, or empty at the root. */
      const parentPath = () => (file === undefined ? '' : parentPathOf(file.path));

      /**
       * Insert one reference token into the composer.
       * @param text - the mention text, exactly as the `@` grammar spells it.
       * @param label - the referenced thing, for the confirmation notice.
       */
      const referenceText = (text, label) => {
        setNotice(null);
        if (file === undefined) {
          setNotice({ kind: 'error', text: t('error.address') });
          return;
        }
        const outcome = insertReference(props, ctx, file.sessionId, text);
        if (outcome === true) {
          setNotice({ kind: 'info', text: t('notice.referenced', { range: label }) });
          return;
        }
        setNotice({ kind: 'error', text: outcome === 'busy' ? t('error.busy') : t('error.unavailable') });
      };

      /**
       * Build the mention for one path, refusing a path the grammar cannot spell.
       * @param path - workspace-relative path, with its trailing slash for a directory.
       * @returns the mention text, or `undefined`.
       */
      const mentionFor = (path) => {
        const mention = formatMention(path);
        if (mention === undefined) setNotice({ kind: 'error', text: t('error.path') });
        return mention;
      };

      /** Reference the current line range into the composer. */
      const reference = () => {
        if (file === undefined) {
          setNotice({ kind: 'error', text: t('error.address') });
          return;
        }
        const mention = mentionFor(file.path);
        if (mention === undefined) return;
        referenceText(mention + ' ' + rangeText, rangeText);
      };

      /** Reference the whole file, with no line range. */
      const referenceWholeFile = () => {
        if (file === undefined) {
          setNotice({ kind: 'error', text: t('error.address') });
          return;
        }
        const mention = mentionFor(file.path);
        if (mention === undefined) return;
        // `insertReference` appends the separating space itself.
        referenceText(mention, t('range.wholeFile'));
      };

      /** Reference the directory this file sits in. */
      const referenceDirectory = () => {
        const parent = parentPath();
        if (parent === '') {
          setNotice({ kind: 'error', text: t('error.noParent') });
          return;
        }
        // A directory mention is the path with a trailing slash, inside the
        // quotes when the path needs them.
        const mention = mentionFor(parent + '/');
        if (mention === undefined) return;
        referenceText(mention, t('range.directory'));
      };

      /**
       * Write the buffer to disk through this bundle's authenticated Host route.
       * @param force - overwrite whatever is on disk now instead of guarding
       *   against the version this buffer was based on.
       */
      const save = async (force) => {
        setNotice(null);
        const version = force ? diskVersion : baseVersion;
        if (file === undefined) {
          setNotice({ kind: 'error', text: t('error.address') });
          return;
        }
        if (absolutePath === undefined || version === undefined) {
          setNotice({ kind: 'error', text: t('error.noBaseline') });
          return;
        }
        setSaving(true);
        try {
          const response = await fetch(SAVE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // The Session travels with the buffer: the Host fences the write to
            // that Session's workspace root and mode, which an address alone
            // cannot express.
            body: JSON.stringify({
              sessionId: file.sessionId,
              absolutePath: absolutePath,
              text: draftRef.current,
              version: version
            })
          });
          const payload = await response.json().catch(() => null);
          if (response.ok && payload !== null && payload.ok === true) {
            // Remember what this write replaced so a read already in flight
            // cannot put it back.
            staleRef.current = source;
            savedRef.current = draftRef.current;
            setSavedText(draftRef.current);
            if (payload.version !== undefined) setBaseVersion(payload.version);
            setNotice({ kind: 'info', text: t('notice.saved') });
            return;
          }
          const code = payload !== null && typeof payload.error === 'string' ? payload.error : '';
          const root = payload !== null && typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot : '';
          const resolved = payload === null || payload.sessionResolved !== false;
          setNotice({ kind: 'error', text: saveFailureText(t, code, response.status, root, resolved) });
        } catch (error) {
          setNotice({
            kind: 'error',
            text: t('error.saveUnreachable', { message: error instanceof Error ? error.message : String(error) })
          });
        } finally {
          setSaving(false);
        }
      };

      /** Drop the buffer and take the loaded disk text as the new baseline. */
      const reloadDisk = () => {
        staleRef.current = undefined;
        draftRef.current = source;
        savedRef.current = source;
        setDraft(source);
        setSavedText(source);
        if (diskVersion !== undefined) setBaseVersion(diskVersion);
        setNotice({ kind: 'info', text: t('notice.reloaded') });
      };

      if (!loaded) {
        return h('div', { className: 'dsh-se-root', 'data-sidebar-editor': true },
          h('p', { className: 'dsh-se-banner' }, t('notice.notText'))
        );
      }

      const banners = [];
      if (notice !== null) {
        banners.push(h('p', { key: 'notice', className: 'dsh-se-banner', 'data-kind': notice.kind }, notice.text));
      }
      if (oversize) {
        banners.push(h('p', { key: 'oversize', className: 'dsh-se-banner', 'data-kind': 'warn' }, t('notice.oversize')));
      }
      if (!complete) {
        banners.push(h('p', { key: 'partial', className: 'dsh-se-banner' }, t('notice.partial')));
      }
      if (dirty && diskMoved) {
        banners.push(h('div', { key: 'conflict', className: 'dsh-se-banner', 'data-kind': 'warn' },
          h('span', null, t('notice.conflict')),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            disabled: saving,
            onClick: reloadDisk
          }, t('action.reload')),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            disabled: saving,
            onClick: () => save(true)
          }, t('action.overwrite'))
        ));
      } else if (dirty && !readOnly) {
        banners.push(h('p', { key: 'dirty', className: 'dsh-se-banner', 'data-kind': 'warn' }, t('notice.unsaved')));
      } else if (diskMoved && !readOnly) {
        banners.push(h('div', { key: 'moved', className: 'dsh-se-banner' },
          h('span', null, t('notice.diskMoved')),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            onClick: reloadDisk
          }, t('action.reload'))
        ));
      }

      // Find-in-file: matching lines, the current hit, and the jump that the
      // panel's own row markup can perform.
      const found = findInText(draft, findOpen ? findTerm : '');
      const hitLines = found.lines;
      const hitSet = new Set(hitLines);
      const currentHit = hitLines.length === 0 ? 0 : hitLines[Math.min(findAt, hitLines.length - 1)];

      /** Bring one line into view and make it the selected range. */
      const goToLine = (line) => {
        if (typeof line !== 'number' || line <= 0) return;
        setPickedRange({ start: line, end: line });
        setCaretRange({ start: line, end: line });
        const node = rowNodes.current[line];
        if (node !== undefined && node !== null && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'center' });
        }
      };

      /** @param delta - +1 for the next hit, -1 for the previous one; wraps. */
      const stepHit = (delta) => {
        if (hitLines.length === 0) return;
        const from = Math.min(findAt, hitLines.length - 1);
        const next = ((from + delta) % hitLines.length + hitLines.length) % hitLines.length;
        setFindAt(next);
        goToLine(hitLines[next]);
      };

      React.useEffect(() => {
        setFindAt(0);
        if (findOpen && hitLines.length > 0) goToLine(hitLines[0]);
      }, [findTerm, findOpen]);

      React.useEffect(() => {
        if (!findOpen) return undefined;
        const input = findInputRef.current;
        if (input !== null && input !== undefined && typeof input.focus === 'function') input.focus();
        return undefined;
      }, [findOpen]);
      const gutter = h('pre', { className: 'dsh-se-gutter', 'aria-hidden': 'true' },
        lines.map((line, index) => index + 1).join('\n')
      );

      const surface = mode === 'edit' && !readOnly
        ? h('textarea', {
            ref: areaRef,
            className: 'dsh-se-area',
            value: draft,
            rows: lines.length,
            wrap: 'off',
            spellCheck: false,
            'aria-label': t('editor.label'),
            style: { width: maxColumns + 'ch' },
            onChange: (event) => {
              draftRef.current = event.target.value;
              setDraft(event.target.value);
              setCaretRange(lineRangeOf(event.target.value, event.target.selectionStart, event.target.selectionEnd));
            },
            onSelect: syncSelection,
            onKeyUp: syncSelection,
            onClick: syncSelection,
            onContextMenu: (event) => {
              syncSelection();
              openMenu(event);
            }
          })
        : h('pre', {
            className: 'dsh-se-pre',
            // A drag-selection is finished by mouseup; Shift+Arrow by keyup. Either
            // becomes the picked range, so the readout and the reference follow it.
            onMouseUp: adoptSelection,
            onKeyUp: adoptSelection
          },
            lines.map((line, index) => {
              const number = index + 1;
              const selected = number >= range.start && number <= range.end;
              return h('div', {
                key: number,
                className: 'dsh-se-row',
                'data-se-line': number,
                'data-selected': selected ? 'true' : undefined,
                'data-se-match': hitSet.has(number) ? 'true' : undefined,
                'data-se-current': number === currentHit ? 'true' : undefined,
                ref: (node) => {
                  if (node === null || node === undefined) delete rowNodes.current[number];
                  else rowNodes.current[number] = node;
                },
                onClick: (event) => {
                  // A click that ends a drag must not shrink the range to one line.
                  if (adoptSelection()) return;
                  pickLine(number, event.shiftKey);
                },
                onContextMenu: (event) => {
                  // Right-clicking a row with nothing picked adopts that row.
                  if (pickedRange === null && selectedLineRange() === undefined) {
                    setPickedRange({ start: number, end: number });
                  }
                  openMenu(event);
                }
              }, highlighted === null
                ? line
                : h('span', { dangerouslySetInnerHTML: { __html: highlighted[index] } }));
            })
          );

      return h('div', {
        className: 'dsh-se-root',
        'data-sidebar-editor': true,
        'data-code-preview': true,
        tabIndex: 0,
        onKeyDown: (event) => {
          if ((event.ctrlKey === true || event.metaKey === true) && (event.key === 'f' || event.key === 'F')) {
            event.preventDefault();
            setFindOpen(true);
          }
        },
        // One pair of variables drives every code surface, so the gutter and the
        // text can never disagree about the row height.
        style: { '--dsh-se-size': fontSize + 'px', '--dsh-se-line': lineHeight + 'px' }
      },
        h('div', { className: 'dsh-se-bar' },
          editingEnabled() ? h('div', { className: 'dsh-se-seg', role: 'group', 'aria-label': t('mode.label') },
            h('button', {
              type: 'button',
              'aria-pressed': mode === 'edit' && !readOnly ? 'true' : 'false',
              disabled: readOnly,
              onClick: () => setMode('edit')
            }, t('mode.edit')),
            h('button', {
              type: 'button',
              'aria-pressed': mode === 'read' ? 'true' : 'false',
              onClick: () => setMode('read')
            }, t('mode.read'))
          ) : null,
          h('span', { className: 'dsh-se-range' }, t('range.label', { range: rangeText })),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            'data-se-find-toggle': true,
            'aria-pressed': findOpen ? 'true' : 'false',
            title: t('find.toggle'),
            onClick: () => setFindOpen((open) => !open)
          }, t('find.label')),
          plainForSize ? h('span', { className: 'dsh-se-hint' }, t('hint.plainBigFile')) : null,
          h('span', { className: 'dsh-se-spacer' }),
          h('span', { className: 'dsh-se-size' }, t('font.value', { size: fontSize })),
          h('div', { className: 'dsh-se-seg', role: 'group', 'aria-label': t('font.label') },
            h('button', {
              type: 'button',
              'data-font-step': 'down',
              disabled: fontSize <= CODE_FONT_MIN,
              title: t('font.smaller'),
              onClick: () => changeFontSize(-1)
            }, 'A−'),
            h('button', {
              type: 'button',
              'data-font-step': 'up',
              disabled: fontSize >= CODE_FONT_MAX,
              title: t('font.larger'),
              onClick: () => changeFontSize(1)
            }, 'A+')
          ),
          editingEnabled() ? h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            disabled: !saveable,
            title: saveHint,
            onClick: () => save(false)
          }, saving ? t('action.saving') : t('action.save')) : null,
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            title: t('action.referenceFile'),
            onClick: referenceWholeFile
          }, t('action.referenceFile')),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn dsh-se-btn-primary',
            onClick: reference
          }, t('action.reference'))
        ),
        banners,
        findOpen ? h('div', { className: 'dsh-se-find', 'data-se-find': true },
          h('input', {
            ref: findInputRef,
            className: 'dsh-se-find-input',
            type: 'search',
            value: findTerm,
            placeholder: t('find.placeholder'),
            'aria-label': t('find.placeholder'),
            spellCheck: false,
            'data-se-find-input': true,
            onChange: (event) => setFindTerm(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stepHit(event.shiftKey === true ? -1 : 1);
                return;
              }
              if (event.key === 'Escape') {
                setFindOpen(false);
                setFindTerm('');
              }
            }
          }),
          h('span', { className: 'dsh-se-find-count', 'data-se-find-count': true },
            hitLines.length === 0
              ? t('find.none')
              : t('find.count', { at: String(Math.min(findAt, hitLines.length - 1) + 1), total: String(hitLines.length) })),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            'data-se-find-prev': true,
            disabled: hitLines.length === 0,
            title: t('find.previous'),
            onClick: () => stepHit(-1)
          }, '↑'),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            'data-se-find-next': true,
            disabled: hitLines.length === 0,
            title: t('find.next'),
            onClick: () => stepHit(1)
          }, '↓'),
          h('button', {
            type: 'button',
            className: 'dsh-se-btn',
            'data-se-find-close': true,
            title: t('find.close'),
            onClick: () => {
              setFindOpen(false);
              setFindTerm('');
            }
          }, '×')
        ) : null,
        h('div', {
          className: 'dsh-se-scroll',
          ref: props.scrollportRef,
          onScroll: () => {
            if (menu !== null) setMenu(null);
          }
        },
          h('div', { className: 'dsh-se-grid' }, gutter, surface)
        ),
        menu === null ? null : h('div', {
          className: 'dsh-se-menu',
          role: 'menu',
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onMouseDown: (event) => {
            // Keep the composer's focus and the editor's selection, and keep the
            // event away from the document-level dismissal listener.
            event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
          }
        }, MENU_LAYOUT[mode === 'edit' ? 'edit' : 'read']
          // A file at the workspace root has no directory to point at.
          .filter((item) => item !== 'referenceDirectory' || hasParent)
          .map((item, at) => {
            if (item === 'separator') return h('div', { key: 'sep-' + at, className: 'dsh-se-menu-sep' });
            const disabled = (item === 'cut' || item === 'copy') && menu.hasSelection !== true;
            return h('button', {
              key: item,
              type: 'button',
              role: 'menuitem',
              'data-menu-item': item,
              disabled: disabled,
              onClick: () => {
                setMenu(null);
                if (disabled) return;
                if (item === 'reference') reference();
                else if (item === 'referenceFile') referenceWholeFile();
                else if (item === 'referenceDirectory') referenceDirectory();
                else if (item === 'cut') void cutSelection();
                else if (item === 'copy') void copySelection();
                else if (item === 'paste') void pasteSelection();
                else selectAll();
              }
            }, t(MENU_LABEL_KEYS[item]));
          }))
      );
    }

    /** @param file - parsed address parts, or undefined. @returns the file's final suffix, lowercased. */
    function extensionOf(file) {
      if (file === undefined) return '';
      const name = baseNameOf(file.path).toLowerCase();
      const cut = name.lastIndexOf('.');
      return cut === -1 ? name : name.slice(cut + 1);
    }

    /**
     * Guard around the body: a throwing renderer blanks its slot entry, so
     * failures become a readable line instead of an empty panel.
     */
    class BodyBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error: error };
      }

      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'dsh-se-root', 'data-sidebar-editor': true },
              h('p', { className: 'dsh-se-banner', 'data-kind': 'error' },
              'sidebar editor failed: ' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error))
          );
        }
        return this.props.children;
      }
    }
    //#endregion

    //#region tree menu
    /** Menu item id to locale key, for the Files-tab row menu. */
    const TREE_LABEL_KEYS = {
      referenceFile: 'action.referenceFile',
      referenceDirectory: 'action.referenceDirectory',
      copyAbsolutePath: 'action.copyAbsolutePath'
    };

    /** @param value - a path in either separator spelling. @returns it with `/` and no trailing slash. */
    function normalizeSlashes(value) {
      return String(value).replace(/\\/gu, '/').replace(/\/+$/u, '');
    }

    /**
     * @param node - a tree row element.
     * @returns `{ relative, absolute }` — the workspace-relative path and the
     *   absolute path spelled with the root's own separator — or `undefined`
     *   when the row is the root itself or sits outside the workspace root.
     */
    function rowInfoOf(node) {
      const raw = typeof node.getAttribute === 'function' ? node.getAttribute('data-files-path') : null;
      const container = typeof node.closest === 'function' ? node.closest('[data-files-root]') : null;
      const root = container === null ? null : container.getAttribute('data-files-root');
      // The tab header labels the root with `data-files-path="true"`; rows carry
      // the real path, and `data-files-entry` is what tells them apart.
      if (raw === null || root === null || raw === 'true' || root === '') return undefined;
      const full = normalizeSlashes(raw);
      const base = normalizeSlashes(root);
      if (full === base || !full.startsWith(base + '/')) return undefined;
      return {
        relative: full.slice(base.length + 1),
        // Rows join names with `/` onto an absolute root, so a Windows path
        // arrives mixed; spell it the way the root is spelled.
        absolute: String(root).indexOf('\\') === -1 ? full : full.replace(/\//gu, '\\')
      };
    }

    /**
     * The Files-tab companion: right-click a row to reference that file or
     * folder into the composer.
     *
     * The tree exposes no row seat and shows no menu of its own, but its rows
     * carry `data-files-entry` and `data-files-path` while the scroll container
     * carries `data-files-root`. A document-level listener therefore recognises
     * a row without reading or writing the tree's DOM, and the menu is portalled
     * to `document.body` so no composer ancestor can clip or reposition it.
     *
     * It is mounted from the session's composer dock: that seat is session
     * scoped, so the documented `inputActions` prop comes with it, and it is
     * mounted for exactly the sessions whose files tab can be right-clicked.
     *
     * @param props - seat props plus this plugin's context.
     * @returns the menu while it is open, otherwise nothing.
     */
    function TreeRowMenu(props) {
      const t = props.t;
      const [menu, setMenu] = React.useState(null);

      React.useEffect(() => {
        const onContextMenu = (event) => {
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== 'function') return;
          const row = target.closest('[data-files-entry]');
          if (row === null) return;
          const info = rowInfoOf(row);
          if (info === undefined) return;
          event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          setMenu({
            x: Math.min(event.clientX, typeof window.innerWidth === 'number' ? window.innerWidth - 200 : event.clientX),
            y: event.clientY,
            directory: row.getAttribute('data-files-entry') === 'directory',
            path: info.relative,
            absolute: info.absolute
          });
        };
        document.addEventListener('contextmenu', onContextMenu);
        return () => document.removeEventListener('contextmenu', onContextMenu);
      }, []);

      // Any press outside the menu, Escape, or a scroll closes it; a press
      // inside must not, or the item's click would never land.
      React.useEffect(() => {
        if (menu === null) return undefined;
        const close = (event) => {
          const target = event === undefined ? undefined : event.target;
          const inside = target !== undefined && target !== null && typeof target.closest === 'function'
            ? target.closest('.dsh-se-menu') !== null
            : false;
          if (inside) return;
          setMenu(null);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setMenu(null);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', close);
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', close);
        };
      }, [menu]);

      if (menu === null) return null;

      /** Run one item, then close. */
      const run = (item) => {
        setMenu(null);
        if (item === 'copyAbsolutePath') {
          void writeClipboard(menu.absolute);
          return;
        }
        // A directory mention is the path with its trailing slash.
        const mention = formatMention(item === 'referenceDirectory' ? menu.path + '/' : menu.path);
        if (mention === undefined) return;
        insertReference(props, props.pluginCtx, undefined, mention);
      };

      const items = menu.directory
        ? ['referenceDirectory', 'copyAbsolutePath']
        : ['referenceFile', 'copyAbsolutePath'];

      return ReactDOM.createPortal(
        h('div', {
          className: 'dsh-se-menu',
          role: 'menu',
          'data-tree-menu': true,
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onMouseDown: (event) => {
            event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
          }
        }, items.map((item, at) => [
          at === 1 ? h('div', { key: 'sep', className: 'dsh-se-menu-sep' }) : null,
          h('button', {
            key: item,
            type: 'button',
            role: 'menuitem',
            'data-tree-item': item,
            onClick: () => run(item)
          }, t(TREE_LABEL_KEYS[item]))
        ])),
        document.body
      );
    }
    //#endregion

    //#region sidebar chrome
    /** The dockkit's scrollable tab row carries this attribute on every strip. */
    const STRIP_TABS_SELECTOR = '[data-dockkit-strip-tabs]';
    /** The chip a strip marks as current. */
    const ACTIVE_TAB_SELECTOR = '[role="tab"][aria-selected="true"]';

    /** @param node - any node. @returns the strip it sits in, or undefined. */
    function stripOf(node) {
      if (node === null || node === undefined || typeof node.closest !== 'function') return undefined;
      return node.closest(STRIP_TABS_SELECTOR) ?? undefined;
    }

    /** @param strip - a tab row. @returns how far it can still scroll. */
    function stripRemaining(strip) {
      return Math.max(0, Number(strip.scrollWidth) - Number(strip.clientWidth));
    }

    /**
     * Bring a strip's current chip into view.
     *
     * The row has no scrollbar (`scrollbar-width: none` plus a hidden
     * `::-webkit-scrollbar`) and nothing in this build scrolls it, so a tab
     * opened beyond the right edge would stay there unseen. `block: "nearest"`
     * keeps this from scrolling anything vertically.
     *
     * @param strip - a tab row.
     */
    function revealActiveTab(strip) {
      if (strip === undefined || typeof strip.querySelector !== 'function') return;
      const active = strip.querySelector(ACTIVE_TAB_SELECTOR);
      if (active === null || typeof active.scrollIntoView !== 'function') return;
      active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }

    /**
     * Let the wheel scroll a tab row sideways.
     *
     * The row scrolls (`overflow-x: auto`) but a plain wheel does not move it:
     * Chromium only maps a vertical wheel to horizontal scrolling with Shift
     * held, and the strip draws no scrollbar to drag. This listener runs in the
     * capture phase and is registered as non-passive on purpose — React's own
     * `onWheel` is passive, so a handler written as a prop could not prevent the
     * sidebar from also scrolling vertically.
     *
     * @param event - the wheel event.
     * @returns nothing.
     */
    function scrollStripByWheel(event) {
      if (event.defaultPrevented === true || event.ctrlKey === true) return;
      // A horizontal wheel, or Shift+wheel which Chromium already converts, is
      // the browser's own business.
      if (Math.abs(Number(event.deltaX)) >= Math.abs(Number(event.deltaY))) return;
      const strip = stripOf(event.target);
      if (strip === undefined) return;
      const max = stripRemaining(strip);
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, Number(strip.scrollLeft) + Number(event.deltaY)));
      // At either end, leave the event alone so the page keeps its own scrolling.
      if (next === Number(strip.scrollLeft)) return;
      strip.scrollLeft = next;
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    /**
     * Install both behaviours and return their disposer.
     *
     * @returns a function undoing the installation.
     */
    function installStripBehaviour() {
      document.addEventListener('wheel', scrollStripByWheel, { capture: true, passive: false });
      let observer;
      if (typeof MutationObserver === 'function' && document.body !== null && document.body !== undefined) {
        observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.attributeName !== 'aria-selected') continue;
            revealActiveTab(stripOf(record.target));
          }
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
      }
      return () => {
        document.removeEventListener('wheel', scrollStripByWheel, { capture: true });
        if (observer !== undefined) observer.disconnect();
      };
    }
    /**
     * A file-name search box inside the file manager's own toolbar.
     *
     * The file panel renders `sidebar.right.tab.files.actions` in the row that
     * carries the path bar and the reload control, so an entry here sits exactly
     * where a search box belongs — no asar patch, no second panel. Results are
     * portalled (the toolbar clips) and reuse the menu's styling; picking one
     * opens the file in the sidebar, which reuses the tree's own destination.
     *
     * @param props - entry props: the session, the translator, and this plugin's scope.
     * @returns the search box plus, while open, its results.
     */
    function FilesSearchAction(props) {
      const t = props.t;
      const ctx = props.pluginCtx;
      const sessionId = props.sessionId;
      const [query, setQuery] = React.useState('');
      const [listing, setListing] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      const [open, setOpen] = React.useState(false);
      const [active, setActive] = React.useState(0);
      const [note, setNote] = React.useState(null);
      const boxRef = React.useRef(null);
      const popRef = React.useRef(null);
      /** The pending delayed open, so a second click replaces the first one's timer. */
      const openTimer = React.useRef(null);
      const [anchor, setAnchor] = React.useState(null);

      // The listing is fetched once (the Host caches the walk too) and filtered
      // here, so every keystroke after the first is free.
      React.useEffect(() => {
        if (sessionId === undefined || open !== true || listing !== null) return undefined;
        const controller = new AbortController();
        requestWorkspaceSearch(sessionId, 'name', '', controller.signal).then((result) => {
          if (controller.signal.aborted) return;
          if (result.ok === true) {
            setListing(result);
            setFailed(false);
            return;
          }
          setListing(null);
          setFailed(result.error);
        });
        return () => controller.abort();
      }, [sessionId, open, listing]);

      React.useEffect(() => {
        setActive(0);
      }, [query]);

      // The outcome note is a passing message, not a fixture of the panel.
      React.useEffect(() => {
        if (note === null) return undefined;
        const timer = setTimeout(() => setNote(null), 6000);
        return () => clearTimeout(timer);
      }, [note]);

      /** Keep the results under the box, in viewport coordinates. */
      const place = () => {
        const node = boxRef.current;
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return;
        const rect = node.getBoundingClientRect();
        setAnchor({ left: rect.left, top: rect.bottom + 4, width: Math.max(240, rect.width) });
      };

      React.useEffect(() => {
        if (open !== true) return undefined;
        place();
        // The sidebar scrolls and resizes; the portalled list has to follow.
        const follow = () => place();
        window.addEventListener('resize', follow);
        window.addEventListener('scroll', follow, true);
        return () => {
          window.removeEventListener('resize', follow);
          window.removeEventListener('scroll', follow, true);
        };
      }, [open]);

      React.useEffect(() => {
        if (open !== true) return undefined;
        const dismiss = (event) => {
          const target = event.target;
          if (target === null || target === undefined) return;
          // A press inside the box or the list is not a dismissal: React
          // unmounts the list on mousedown otherwise, before the click lands.
          if (typeof target.closest === 'function' &&
            (target.closest('[data-se-files-search]') !== null || target.closest('.dsh-se-portal') !== null)) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', dismiss);
        return () => document.removeEventListener('mousedown', dismiss);
      }, [open]);

      /**
       * Open a result and locate it in the file tree, the way an IDE's search does.
       *
       * A file result is opened first and unconditionally — picking a search hit
       * means "show me that file" — and only then is the tree asked to expand down
       * to it and highlight its row. A directory result opens nothing: locating and
       * highlighting the folder is the whole outcome.
       */
      const open_ = (row) => {
        if (row === null || row === undefined || typeof row.path !== 'string') {
          setNote({ kind: 'bad', text: t('search.badRow') });
          return;
        }
        setOpen(false);
        // Say something before the work starts: if the walk dies silently, this
        // at least proves the click arrived, and the reason replaces it.
        setNote({ kind: 'pending', text: t('search.locating', { path: row.path }) });
        const root = listing === null || listing.workspaceRoot === undefined ? undefined : listing.workspaceRoot;
        if (typeof root !== 'string' || root === '') {
          setNote({ kind: 'bad', text: t('search.noRoot') });
          return;
        }
        const directory = row.kind === 'directory';
        /** Open the file the search landed on; directories have nothing to open. */
        const openFile = () => {
          if (directory || sessionId === undefined) return;
          try {
            ctx.sidebarRight.openResource(fileAddressOf(sessionId, row.path));
          } catch (error) {
            // The walk already wrote the note the user reads; a throw here must not
            // replace it with a tree failure that never happened.
          }
        };
        /**
         * Open once the outcome has been painted and can be read. The open is what
         * unmounts this box, so it cannot share a tick with the note it would erase.
         */
        const openAfterNote = () => {
          if (openTimer.current !== null) clearTimeout(openTimer.current);
          openTimer.current = setTimeout(() => {
            openTimer.current = null;
            openFile();
          }, NOTE_READ_MS);
        };
        let walk;
        try {
          walk = revealInFileTree(joinTreePath(root, row.path), 2000);
        } catch (error) {
          setNote({ kind: 'bad', text: t('search.notLocated', { reason: 'throw:' + String(error && error.message ? error.message : error) }) });
          openAfterNote();
          return;
        }
        // Locating comes first on purpose. Opening a file puts its document tab in
        // front, which hides the files tab and unmounts this very search box: a walk
        // started after the open would expand a tree nobody is looking at, and the
        // note reporting it would have no component left to render into.
        walk.then((revealed) => {
          if (revealed.ok === true) {
            rememberLocatedRow(revealed.path);
            setNote({ kind: 'good', text: t(directory ? 'search.located' : 'search.opened', { path: row.path }) });
          } else {
            // Naming the stage that failed is what turns "nothing happened" into
            // something the user can report; the reason is the walk's own step.
            setNote({ kind: 'bad', text: revealed.reason === 'no-tree'
              ? t('search.noTree')
              : t('search.notLocated', { reason: revealed.reason }) });
          }
          openAfterNote();
        }, (error) => {
          setNote({ kind: 'bad', text: t('search.notLocated', { reason: 'reject:' + String(error && error.message ? error.message : error) }) });
          openAfterNote();
        });
      };
      const list = listing === null ? [] : rankWorkspaceRows(rowsOfListing(listing), query, SEARCH_LIMIT);
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          return;
        }
        if (list.length === 0) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive((at) => Math.min(at + 1, list.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((at) => Math.max(at - 1, 0));
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          open_(list[Math.min(active, list.length - 1)]);
        }
      };

      const popover = open === true && anchor !== null
        ? ReactDOM.createPortal(
            h('div', {
              className: 'dsh-se-portal dsh-se-menu',
              'data-se-files-search-results': true,
              style: {
                position: 'fixed',
                left: anchor.left + 'px',
                top: anchor.top + 'px',
                minWidth: anchor.width + 'px',
                maxHeight: '50vh',
                overflowY: 'auto'
              },
              onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
              }
            },
              list.length === 0
                ? h('div', { className: 'dsh-se-menu-note' }, failed ? t('search.failed') : t('search.none'))
                : list.map((candidate, index) => {
                    const path = typeof candidate.path === 'string' ? candidate.path : '';
                    const directory = candidate.kind === 'directory';
                    return h('button', {
                      key: path + (directory ? '/' : ''),
                      type: 'button',
                      className: 'dsh-se-menu-item',
                      'data-active': index === active ? 'true' : undefined,
                      'data-se-files-search-open': path,
                      title: path,
                      onClick: () => open_(candidate)
                    }, baseNameOfSearch(path) + (directory ? '/' : '') +
                      (parentOfSearch(path) === '' ? '' : '  ' + parentOfSearch(path)));
                  })
            ),
            document.body
          )
        : null;

      const notePortal = note === null || anchor === null
        ? null
        : ReactDOM.createPortal(
            h('div', {
              className: 'dsh-se-portal dsh-se-note',
              'data-se-search-note': note.kind,
              style: { position: 'fixed', left: anchor.left + 'px', top: anchor.top + 'px', maxWidth: '420px' }
            }, note.text),
            document.body
          );

      return h('div', { className: 'dsh-se-files-search', 'data-se-files-search': true, ref: boxRef },
        h('input', {
          className: 'dsh-se-files-input',
          type: 'text',
          value: query,
          placeholder: t('search.short'),
          'aria-label': t('search.placeholder'),
          spellCheck: false,
          onFocus: () => setOpen(true),
          onChange: (event) => {
            setQuery(event.target.value);
            setOpen(true);
          },
          onKeyDown: onKeyDown
        }),
        popover,
        notePortal
      );
    }
    //#endregion

    //#region find in file

    /**
     * @param text - the file's text.
     * @param term - what the user typed.
     * @returns `{ lines, occurrences }`: the distinct 1-based line numbers holding
     *   a match, and how many occurrences they hold in total. Case-insensitive.
     *
     * Lines are the unit because a line is what this panel can both mark and
     * scroll to, which is what "jump to the line" needs.
     */
    function findInText(text, term) {
      const needle = String(term).toLowerCase();
      if (needle === '') return { lines: [], occurrences: 0 };
      const lines = [];
      let occurrences = 0;
      const all = String(text).split('\n');
      for (let at = 0; at < all.length; at += 1) {
        const lower = all[at].toLowerCase();
        let hit = lower.indexOf(needle);
        if (hit === -1) continue;
        while (hit !== -1) {
          occurrences += 1;
          hit = lower.indexOf(needle, hit + needle.length);
        }
        lines.push(at + 1);
      }
      return { lines: lines, occurrences: occurrences };
    }
    //#endregion

    //#region file tree reveal

    /** A tree row: the element also carries its absolute path. */
    const FILES_ROW_SELECTOR = '[data-files-entry][data-files-path]';
    /** The tree panel's root element, which names the workspace it lists. */
    const FILES_ROOT_SELECTOR = '[data-files-root]';

    /** @param value - any path spelling. @returns one spelling both sides can be compared in. */
    function comparableTreePath(value) {
      return String(value)
        .replace(/\\/gu, '/')
        .replace(/\/{2,}/gu, '/')
        .replace(/\/+$/u, '')
        .toLowerCase();
    }

    /**
     * @param base - a directory path. @param segment - a child name. @returns the joined path.
     */
    function joinTreePath(base, segment) {
      const trimmed = String(base).replace(/[/\\]+$/u, '');
      // The tree appends /name to whatever root it was given, so a child reads
      // with mixed separators; spelling it the same way keeps the walk in step.
      return trimmed + '/' + segment;
    }

    /**
     * @param root - the tree root.
     * @param path - an absolute path.
     * @returns its row when rendered, or undefined.
     *
     * Rows are compared by value rather than through an attribute selector: the
     * tree builds a child's path by appending /name to the root it was given, so
     * the same file reads E:\DSH/hyh/data in the DOM and E:\DSH\hyh\data here.
     * Comparing normalized values accepts either spelling.
     */
    function treeRowOf(root, path) {
      if (root === undefined || typeof root.getAttribute !== 'function') return undefined;
      const wanted = comparableTreePath(path);
      // The root element may *be* the first row: data-files-root is declared
      // once in the tree, and if it sits on that row then a descendant-only
      // search would never see it. So the element itself is a candidate too.
      const candidates = [];
      if (root.getAttribute('data-files-path') !== null) candidates.push(root);
      if (typeof root.querySelectorAll === 'function') {
        for (const row of root.querySelectorAll('[data-files-entry][data-files-path]')) candidates.push(row);
      }
      for (const row of candidates) {
        if (row === null || row === undefined || typeof row.getAttribute !== 'function') continue;
        if (comparableTreePath(row.getAttribute('data-files-path')) === wanted) return row;
      }
      return undefined;
    }
    /** @returns the tree root the user can see, or undefined when no tree is mounted. */
    function visibleTreeRoot() {
      if (typeof document.querySelectorAll !== 'function') return undefined;
      const roots = document.querySelectorAll(FILES_ROOT_SELECTOR);
      for (const root of roots) {
        if (typeof root.getClientRects === 'function' && root.getClientRects().length === 0) continue;
        return root;
      }
      return roots.length > 0 ? roots[0] : undefined;
    }

    /** @returns a promise resolving after the next paint has had a chance to happen. */
    const settleFrame = () => new Promise((resolve) => setTimeout(resolve, 40));

    /**
     * @param root - the tree root.
     * @param path - the absolute path being waited for.
     * @param deadline - how long to wait, in ms.
     * @returns the row, or undefined when it never appeared.
     */
    async function waitForTreeRow(root, path, deadline) {
      const until = Date.now() + deadline;
      for (;;) {
        const row = treeRowOf(root, path);
        if (row !== undefined) return row;
        if (Date.now() >= until) return undefined;
        await settleFrame();
      }
    }

    /**
     * Reveal one absolute path inside the file tree: expand its ancestors, then
     * select its row.
     *
     * The tree renders lazily and owns its expansion state, so the only door in
     * from another bundle is the tree's own markup: each directory row is a
     * `<button aria-expanded>` whose click toggles that directory, and the panel
     * renders the next level once its listing arrives. So this walks down one
     * level at a time — the same clicks a user would make — and only then scrolls
     * the target into view and selects it.
     *
     * @param absolutePath - the path to reveal.
     * @param deadline - how long each level may take, in ms.
     * @returns a promise resolving to whether the target row was reached.
     */
    async function revealInFileTree(absolutePath, deadline) {
      const root = visibleTreeRoot();
      if (root === undefined) return { ok: false, reason: 'no-tree' };
      if (typeof absolutePath !== 'string' || absolutePath === '') return { ok: false, reason: 'no-path' };
      const base = typeof root.getAttribute === 'function' ? root.getAttribute('data-files-root') : undefined;
      if (typeof base !== 'string' || base === '') return { ok: false, reason: 'no-root-attribute' };
      const trimmed = base.replace(/[/\\]+$/u, '');
      const relative = String(absolutePath).slice(trimmed.length).replace(/^[/\\]+/u, '');
      const segments = relative.split(/[/\\]/u).filter((segment) => segment !== '');
      if (segments.length === 0) return { ok: false, reason: 'no-segments' };

      // Walk down one level at a time. Every ancestor of the target has to be
      // expanded before the next level renders — including the target's own
      // parent, which is the level the target is rendered from.
      //
      // The root is the one level without a row: `data-files-root` sits on the tree's
      // container, and the container carries no `data-files-path` of its own (the only
      // other `data-files-path` in the header is the title label, whose value is the
      // literal string "true"). Its children are listed as soon as the panel mounts and
      // there is no toggle to press, so the first segment is awaited directly instead of
      // being reached through an ancestor row. Looking up a row for the root is what
      // made every reveal fail with `no-row:<root>` before this branch existed.
      let current = base;
      for (let at = 0; at < segments.length; at += 1) {
        const childPath = joinTreePath(current, segments[at]);
        if (at === 0) {
          if ((await waitForTreeRow(root, childPath, deadline)) === undefined) {
            return { ok: false, reason: 'timeout:' + childPath };
          }
          current = childPath;
          continue;
        }
        const parent = treeRowOf(root, current);
        if (parent === undefined) return { ok: false, reason: 'no-row:' + current };
        const button = typeof parent.querySelector === 'function' ? parent.querySelector('button') : undefined;
        if (button === null || button === undefined) return { ok: false, reason: 'no-toggle:' + current };
        const expanded = typeof button.getAttribute === 'function' && button.getAttribute('aria-expanded') === 'true';
        const last = at === segments.length - 1;
        if (!expanded) {
          if (typeof button.click !== 'function') return { ok: false, reason: 'no-click:' + current };
          button.click();
          if ((await waitForTreeRow(root, childPath, deadline)) === undefined) {
            return { ok: false, reason: 'timeout:' + childPath };
          }
        } else if (!last) {
          if ((await waitForTreeRow(root, childPath, deadline)) === undefined) {
            return { ok: false, reason: 'timeout:' + childPath };
          }
        }
        current = childPath;
      }

      const target = treeRowOf(root, current);
      if (target === undefined) return { ok: false, reason: 'no-target:' + current };
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
      const targetButton = typeof target.querySelector === 'function' ? target.querySelector('button') : undefined;
      if (targetButton !== null && targetButton !== undefined && typeof targetButton.click === 'function') {
        const entryType = typeof target.getAttribute === 'function' ? target.getAttribute('data-files-entry') : undefined;
        const alreadyOpen = typeof targetButton.getAttribute === 'function' &&
          targetButton.getAttribute('aria-expanded') === 'true';
        // A file row's click only opens the resource, which the caller has already
        // done; clicking it here would open the same file twice. A directory's click
        // is its expansion, which is the locate — and one already open is left open
        // rather than toggled shut under the user.
        if (entryType === 'directory' && !alreadyOpen) targetButton.click();
      }
      markTreeRow(target);
      return { ok: true, row: target, path: current };
    }

    /**
     * Mark the row a search landed on, the way find-in-file marks its lines.
     *
     * The tree belongs to another package, so this is a mark of this plugin's own
     * making: an attribute plus a rule from this bundle's stylesheet. The previous
     * mark is cleared first, so only one row ever carries it.
     *
     * @param row - the row element to mark.
     */
    function markTreeRow(row) {
      if (typeof document.querySelectorAll !== 'function') return;
      for (const previous of document.querySelectorAll('[data-se-tree-hit]')) {
        if (previous !== null && previous !== undefined && typeof previous.removeAttribute === 'function') {
          previous.removeAttribute('data-se-tree-hit');
        }
      }
      if (row !== null && row !== undefined && typeof row.setAttribute === 'function') {
        row.setAttribute('data-se-tree-hit', 'true');
      }
    }

    /**
     * The row a reveal last landed on, remembered past the search box's own life.
     *
     * Opening a file puts its document tab in front of the files tab, so the tree and
     * this mark leave the screen together with the box that made them. The row element
     * is rebuilt when the tab comes back and an attribute does not survive that, so the
     * path is held here and the mark is re-applied whenever the tree renders it again.
     * The tree's own tab store keeps the expansion, so no second walk is needed.
     */
    let locatedRowPath;
    let markKeeperInstalled = false;

    /**
     * Remember one row as the search's landing point, and keep it marked from now on.
     * @param absolutePath - the path the reveal reached.
     */
    function rememberLocatedRow(absolutePath) {
      if (typeof absolutePath !== 'string' || absolutePath === '') return;
      locatedRowPath = absolutePath;
      if (markKeeperInstalled || typeof MutationObserver !== 'function') return;
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return;
      markKeeperInstalled = true;
      let queued = false;
      const remark = () => {
        queued = false;
        if (locatedRowPath === undefined) return;
        const root = visibleTreeRoot();
        if (root === undefined) return;
        const row = treeRowOf(root, locatedRowPath);
        if (row === undefined) return;
        if (typeof row.getAttribute === 'function' && row.getAttribute('data-se-tree-hit') === 'true') return;
        markTreeRow(row);
      };
      // Rows appear as the tree re-renders. Only structure is observed, so the mark's
      // own attribute writes cannot feed the observer back into itself.
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(remark, 0);
      }).observe(document.body, { childList: true, subtree: true });
    }

    /** The file panel's search input, as this bundle's toolbar entry renders it. */
    const FILES_SEARCH_INPUT = '[data-se-files-search] input';
    /** How long the command waits for the files tab to mount its search box. */
    const FILES_SEARCH_FOCUS_MS = 2200;

    /**
     * Focus the file panel's search box, waiting for the tab that renders it.
     *
     * The command opens the files tab first, and a sidebar tab mounts asynchronously,
     * so the input is not on screen yet on the same tick. The wait is bounded, so a tab
     * that never arrives leaves nothing spinning behind it.
     *
     * @param deadline - how long to keep looking, in ms.
     */
    function focusFilesSearchBox(deadline) {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
      const until = Date.now() + deadline;
      const tryFocus = () => {
        const input = document.querySelector(FILES_SEARCH_INPUT);
        if (input === null || input === undefined || typeof input.focus !== 'function') return false;
        input.focus();
        // Selecting what is already there makes the key a "type over the old query"
        // gesture, which is what a search box key is expected to do.
        if (typeof input.select === 'function') input.select();
        return true;
      };
      if (tryFocus()) return;
      const tick = () => {
        if (!tryFocus() && Date.now() < until) setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }    //#endregion

    //#region search panel
    /** How long typing settles before a content search is issued. */
    const SEARCH_DEBOUNCE_MS = 120;
    /**
     * How long the outcome note stays on screen before a file result is opened.
     *
     * Opening a file puts its document tab in front, and that unmounts the very box
     * the note is rendered by. Firing `setNote` and the open in the same tick — which
     * is what this used to do — therefore erased the outcome before a single frame
     * drew it, so even a failed locate looked like nothing happened at all.
     */
    const NOTE_READ_MS = 900;
    /** The Host route the listing and the content search read through. */
    const SEARCH_ROUTE = 'api/sidebarEditor/search';
    /** Rows the panel offers at once. */
    const SEARCH_LIMIT = 200;
    /** The file manager's toolbar seat this plugin adds its search box to. */
    const FILES_ACTIONS_SEAT = 'sidebar.right.tab.files.actions';

    /** @param path - a workspace-relative path. @returns its final segment. */
    function baseNameOfSearch(path) {
      const cut = String(path).lastIndexOf('/');
      return cut < 0 ? String(path) : String(path).slice(cut + 1);
    }

    /** @param path - a workspace-relative path. @returns everything above it, or ''. */
    function parentOfSearch(path) {
      const cut = String(path).lastIndexOf('/');
      return cut <= 0 ? '' : String(path).slice(0, cut);
    }

    /**
     * @param sessionId - the Session whose workspace owns the path.
     * @param path - a workspace-relative path.
     * @returns the `dsh-resource://` address the right sidebar opens.
     */
    function fileAddressOf(sessionId, path) {
      return FILE_ADDRESS_PREFIX + 'session/' + encodeURIComponent(sessionId) + '/' + path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    }

    /**
     * Ask the Host to list or search one Session's workspace.
     *
     * The listing is the Host's own walk (`fs.listDir` inside the fence's root),
     * not the `fileReferences` Remote. That seam wants a mounted provider and an
     * agent it can resolve, and on this profile it answers nothing at all — which
     * is indistinguishable from "no matches" in the panel. Doing the walk in this
     * bundle's own Host half also keeps the workspace root and the sandbox fence
     * where the Session lives.
     *
     * @param sessionId - the Session whose workspace is searched.
     * @param mode - `'name'` for the listing, `'content'` for a text search.
     * @param query - the content query; ignored while listing.
     * @param signal - aborts the call when the query moves on.
     * @returns a promise of the Host payload, or `{ ok: false, error }`.
     */
    async function requestWorkspaceSearch(sessionId, mode, query, signal) {
      let response;
      try {
        response = await fetch(SEARCH_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, mode: mode, query: query }),
          signal: signal
        });
      } catch (error) {
        return { ok: false, error: 'unreachable' };
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        return { ok: false, error: 'bad-response' };
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const reason = payload !== null && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : 'http-' + String(response.status);
        return { ok: false, error: reason };
      }
      return payload;
    }

    /** @param listing - a Host listing payload. @returns every row it holds. */
    function rowsOfListing(listing) {
      const rows = [];
      const directories = listing.directories === undefined ? [] : listing.directories;
      const files = listing.files === undefined ? [] : listing.files;
      for (const path of directories) rows.push({ path: path, kind: 'directory' });
      for (const path of files) rows.push({ path: path, kind: 'file' });
      return rows;
    }

    /**
     * Rank rows against what was typed.
     *
     * A hit inside the file name outranks a hit in a parent folder, which is what
     * makes typing `client` offer `client.js` before `client/old.js`.
     *
     * @param rows - candidate rows.
     * @param query - the typed text.
     * @param limit - how many rows to return.
     * @returns the ranked rows, empty for an empty query.
     */
    function rankWorkspaceRows(rows, query, limit) {
      const needle = String(query).trim().toLowerCase();
      if (needle === '') return [];
      const named = [];
      const nested = [];
      for (const row of rows) {
        const lower = String(row.path).toLowerCase();
        const at = lower.indexOf(needle);
        if (at === -1) continue;
        if (at >= lower.lastIndexOf('/') + 1) named.push(row);
        else nested.push(row);
        if (named.length + nested.length >= limit * 4) break;
      }
      return named.concat(nested).slice(0, limit);
    }

    //#region plugin
    const zh = {
      'meta.title': '侧栏代码引用搜索工具',
      'viewer.title': '编辑器',
      'mode.label': '查看模式',
      'mode.edit': '编辑',
      'mode.read': '只读',
      'hint.plainBigFile': '（行数过多，已关闭着色）',
      'font.label': '代码字号',
      'font.smaller': '减小代码字号',
      'font.larger': '增大代码字号',
      'font.value': '{size}px',
      'range.label': '已选 {range}',
      'find.label': '查找',
      'find.toggle': '在文件内查找（Ctrl+F）',
      'find.placeholder': '在文件内查找…',
      'find.count': '{at}/{total} 行',
      'find.none': '没有匹配',
      'find.previous': '上一处（Shift+Enter）',
      'find.next': '下一处（Enter）',
      'find.close': '关闭查找',      'search.placeholder': '按名字搜索工作区文件…',
      'search.located': '已在文件树中定位到 {path}',
      'search.opened': '已打开并在文件树中定位到 {path}',
      'search.command': '搜索工作区文件',
      'search.commandNoSession': '请先选择会话',
      'search.badRow': '这条结果没有路径。',
      'search.locating': '正在定位 {path} …',
      'search.noTree': '没有打开文件树：请在右侧打开「文件」面板后再试。',
      'search.notLocated': '无法在文件树中定位（{reason}）',
      'search.noRoot': '读不到工作区根目录，无法定位。',
      'search.short': '搜索文件名…',
      'search.none': '没有匹配的文件',
      'search.failed': '搜索失败：没能读取工作区文件列表。',
      'action.reference': '引用选中行',
      'action.referenceFile': '引用整个文件',
      'action.referenceDirectory': '引用所在目录',
      'action.copyAbsolutePath': '复制绝对路径',
      'range.wholeFile': '整个文件',
      'range.directory': '所在目录',
      'error.noParent': '这个文件就在工作区根目录下，没有上层目录可引用。',
      'action.cut': '剪切',
      'action.copy': '复制',
      'action.paste': '粘贴',
      'action.selectAll': '全选',
      'error.clipboardWrite': '复制失败：无法写入剪贴板。',
      'error.clipboardRead': '粘贴失败：无法读取剪贴板，请直接用 Ctrl+V。',
      'action.save': '保存',
      'action.saving': '保存中…',
      'action.reload': '重新载入',
      'action.overwrite': '强制覆盖',
      'editor.label': '代码编辑器',
      'hint.saveReady': '保存到磁盘（带版本校验）。',
      'hint.saveClean': '没有未保存的改动。',
      'notice.notText': '该内容不是可编辑的文本。',
      'notice.partial': '文件尚未完全载入：滚动到底部可继续加载。',
      'notice.oversize': '文件较大，已切换为只读；可用「代码」渲染器查看完整高亮。',
      'notice.unsaved': '有未保存的改动。',
      'notice.saved': '已保存。',
      'notice.reloaded': '已重新载入磁盘版本。',
      'notice.conflict': '磁盘上的文件已被改动：',
      'notice.diskMoved': '磁盘上的文件已更新，当前缓冲区仍是旧内容。',
      'notice.referenced': '已引用 {range}。',
      'error.address': '无法解析文件地址。',
      'error.path': '该路径无法写成 @ 引用。',
      'error.busy': '输入框正忙，请稍后重试。',
      'error.unavailable': '无法插入引用：输入框接口不可用。',
      'error.noBaseline': '尚未取到文件版本，无法保存。',
      'error.stale': '保存失败：文件已被其它改动覆盖，请重新载入或强制覆盖。',
      'error.denied': '保存失败：该路径不在可写工作区内（沙箱拒绝）。',
      'error.deniedRoot': '保存失败：该路径不在可写工作区内（沙箱拒绝）。当前可写根：{root}',
      'error.deniedUnresolved': '保存失败：该路径不在可写工作区内。当前可写根：{root}（未能解析会话，按部署默认根判定）',
      'error.readOnlyMode': '保存失败：当前会话处于只读模式。',
      'error.noRoute': '保存失败：宿主保存路由未注册（宿主半边未加载或未生效，重启应用后重试）。',
      'error.notObserved': '保存失败：覆盖前必须先读取该文件。',
      'error.notFound': '保存失败：文件已不存在。',
      'error.notRegularFile': '保存失败：目标不是普通文件。',
      'error.tooLarge': '保存失败：内容超过 2 MiB 上限。',
      'error.badRequest': '保存失败：请求无效。',
      'error.saveFailed': '保存失败（HTTP {status}）。',
      'error.saveUnreachable': '保存请求未能送达：{message}'
    };

    const en = {
      'meta.title': 'Sidebar Code Reference & Search',
      'viewer.title': 'Editor',
      'mode.label': 'View mode',
      'mode.edit': 'Edit',
      'mode.read': 'Read',
      'hint.plainBigFile': '(too many lines: coloring off)',
      'font.label': 'Code font size',
      'font.smaller': 'Smaller code text',
      'font.larger': 'Larger code text',
      'font.value': '{size}px',
      'range.label': 'Selected {range}',
      'find.label': 'Find',
      'find.toggle': 'Find in file (Ctrl+F)',
      'find.placeholder': 'Find in file…',
      'find.count': '{at}/{total} lines',
      'find.none': 'No match',
      'find.previous': 'Previous match (Shift+Enter)',
      'find.next': 'Next match (Enter)',
      'find.close': 'Close find',      'search.placeholder': 'Search workspace files by name…',
      'search.located': 'Located {path} in the file tree',
      'search.opened': 'Opened and located {path} in the file tree',
      'search.command': 'Search workspace files',
      'search.commandNoSession': 'Select a session first',
      'search.badRow': 'That result carries no path.',
      'search.locating': 'Locating {path} …',
      'search.noTree': 'No file tree is open: open the Files panel in the sidebar and try again.',
      'search.notLocated': 'Could not locate it in the file tree ({reason})',
      'search.noRoot': 'The workspace root could not be read, so it cannot be located.',
      'search.short': 'Search file names…',
      'search.none': 'No matching file',
      'search.failed': 'Search failed: the workspace listing could not be read.',
      'action.reference': 'Reference lines',
      'action.referenceFile': 'Reference whole file',
      'action.referenceDirectory': 'Reference containing folder',
      'action.copyAbsolutePath': 'Copy absolute path',
      'range.wholeFile': 'whole file',
      'range.directory': 'containing folder',
      'error.noParent': 'This file sits in the workspace root, so there is no folder above it to reference.',
      'action.cut': 'Cut',
      'action.copy': 'Copy',
      'action.paste': 'Paste',
      'action.selectAll': 'Select all',
      'error.clipboardWrite': 'Copy failed: the clipboard could not be written.',
      'error.clipboardRead': 'Paste failed: the clipboard could not be read; use Ctrl+V instead.',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.reload': 'Reload',
      'action.overwrite': 'Overwrite',
      'editor.label': 'Code editor',
      'hint.saveReady': 'Write to disk, checked against the version that was read.',
      'hint.saveClean': 'Nothing to save.',
      'notice.notText': 'This content is not editable text.',
      'notice.partial': 'The file is not fully loaded yet; scroll to the bottom to load more.',
      'notice.oversize': 'Large file: switched to read-only. Use the "Code" renderer for full highlighting.',
      'notice.unsaved': 'Unsaved changes.',
      'notice.saved': 'Saved.',
      'notice.reloaded': 'Reloaded from disk.',
      'notice.conflict': 'The file changed on disk:',
      'notice.diskMoved': 'The file changed on disk; this buffer still holds the older text.',
      'notice.referenced': 'Referenced {range}.',
      'error.address': 'Could not parse the file address.',
      'error.path': 'This path cannot be written as an @ reference.',
      'error.busy': 'The composer is busy; try again in a moment.',
      'error.unavailable': 'Could not insert the reference: no composer insertion surface.',
      'error.noBaseline': 'No file version yet, so nothing can be saved.',
      'error.stale': 'Save failed: the file changed since it was read. Reload or overwrite.',
      'error.denied': 'Save failed: the path is outside the writable workspace (sandbox denied).',
      'error.deniedRoot': 'Save failed: the path is outside the writable workspace (sandbox denied). The writable root is {root}',
      'error.deniedUnresolved': 'Save failed: the path is outside the writable workspace. The writable root is {root} (the Session could not be resolved, so the deployment default decided)',
      'error.readOnlyMode': 'Save failed: this session is in read-only mode.',
      'error.noRoute': 'Save failed: the host save route is not registered (the host half is not loaded or not in effect; restart the app and retry).',
      'error.notObserved': 'Save failed: the file must be read before it can be overwritten.',
      'error.notFound': 'Save failed: the file no longer exists.',
      'error.notRegularFile': 'Save failed: the target is not a regular file.',
      'error.tooLarge': 'Save failed: the buffer exceeds the 2 MiB limit.',
      'error.badRequest': 'Save failed: invalid request.',
      'error.saveFailed': 'Save failed (HTTP {status}).',
      'error.saveUnreachable': 'The save request never arrived: {message}'
    };

    /**
     * Client plugin body: register the preview metadata, its body, and the
     * dictionaries that name both.
     * @param ctx - the Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'sidebar-editor: dictionaries');
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.documentPreviews.register({
        id: IMPLEMENTATION_ID,
        extensions: CODE_EXTENSIONS,
        priority: 'extension',
        title: () => t('viewer.title'),
        loading: 'text-pages',
        wrap: false
      }), 'sidebar-editor: preview metadata');

      const Boundary = (props) => h(BodyBoundary, null, h(EditorBody, Object.assign({ pluginCtx: ctx }, props)));

      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
        name: 'sidebar.right.tab.document',
        key: IMPLEMENTATION_ID,
        locale: NS
      }, Boundary)), 'sidebar-editor: preview body');

      ctx.effect(() => mountStyleSheet(), 'sidebar-editor: stylesheet');

      // The tree menu lives in the session's composer dock: that seat is
      // session scoped, so the documented `inputActions` prop arrives with it,
      // and it is mounted whenever the user can right-click a tree row.
      const TreeBoundary = (props) => h(BodyBoundary, null, h(TreeRowMenu, Object.assign({ pluginCtx: ctx }, props)));

      ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'sidebar-editor-tree',
        order: 40,
        locale: NS
      }, TreeBoundary)), 'sidebar-editor: tree row menu');

      ctx.effect(installStripBehaviour, 'sidebar-editor: tab strip wheel and reveal');

      // The file manager's toolbar row carries the path bar, so the search box
      // that belongs to the file panel is registered there. It needs only the
      // sidebar's navigation face (the fallback that opens a file when no tree
      // is on screen): the listing comes from this bundle's own Host route, not
      // from the file-reference Remote, which answers nothing without a mounted
      // provider and a resolvable agent.
      ctx.inject(['sidebarRight'], (scope) => {
        const FilesSearchEntry = (props) =>
          h(BodyBoundary, null, h(FilesSearchAction, Object.assign({ pluginCtx: scope }, props)));

        scope.effect(() => scope.slots.inject(FILES_ACTIONS_SEAT, () => scope.slots.register({
          name: FILES_ACTIONS_SEAT,
          id: 'sidebar-editor-search',
          order: 30,
          locale: NS,
          inject: (sessionId) => ({ sessionId: sessionId })
        }, FilesSearchEntry)), 'sidebar-editor: files toolbar search');
      });

      // The file panel's search box carries no key of its own: `Mod+P` belongs to the
      // file tree, and this bundle keeps no private copy of the keys. DSH's shortcuts
      // service owns the binding, so the command ships a default and `设置 → 快捷键`
      // (or `Mod+/`) records, clears, or restores it — the user's choice lands in the
      // platform's own keybinding store (`dsh.keybindings.v1` on Web, `keybindings.json`
      // on Desktop), never in this plugin.
      ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
        scope.effect(() => scope.shortcuts.register({
          id: 'sidebarEditor.filesearch',
          label: () => t('search.command'),
          aliases: ['search files', 'file search', 'search workspace files'],
          defaults: {
            'desktop:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'desktop:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'desktop:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift', 'alt'] },
            'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift', 'alt'] }
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: ({ target: element }) => {
            const target = scope.sidebarRight.commandTarget(element);
            if (target === undefined) return { status: 'blocked', reason: t('search.commandNoSession') };
            return {
              status: 'handled',
              run: () => {
                scope.sidebarRight.openTabFromTarget('files', target);
                focusFilesSearchBox(FILES_SEARCH_FOCUS_MS);
              }
            };
          }
        }), 'sidebar-editor: filesearch shortcut');
      });
    }

    return {
      inject: ['slots', 'documentPreviews', 'locale'],
      apply: apply
    };
    //#endregion
  }
});
