/**
 * editor.js — the text surface.
 *
 * Design: a real <textarea> is the input device (native caret, native selection,
 * native IME, native scrolling, zero per-keystroke layout cost), and a mirrored
 * "backdrop" layer underneath paints everything the textarea cannot: find/replace
 * hits and the current-line band. The two layers share font, padding, wrap mode
 * and scrollbar compensation, so they stay pixel-locked.
 *
 * Line numbers are plain text in a gutters column; when word wrap is on they are
 * positioned from the measured height of every logical line in the backdrop.
 */

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class EditorView {
  /**
   * @param {HTMLElement} root   element that will host the editor DOM
   * @param {{onInput:Function, onCursor:Function, onScroll:Function, onUndoState:Function}} hooks
   */
  constructor(root, hooks = {}) {
    this.hooks = hooks;
    this.root = root;

    this.text = '';
    this.settings = {
      fontFamily: 'mono',
      fontSize: 13,
      lineHeight: 1.5,
      tabSize: 4,
      wrap: false,
      lineNumbers: true,
      highlightCurrentLine: true,
    };

    this.undoStack = [];
    this.redoStack = [];
    this.lastUndoPush = 0;
    this.lastInputKind = null;
    this.readonly = false;

    this.search = { active: false, query: '', matchCase: false, wholeWord: false, regex: false };
    this.matches = [];
    this.activeMatch = -1;
    this.lineStarts = [0];

    this.#buildDom();
    this.#bind();
  }

  // ------------------------------------------------------------------ DOM

  #buildDom() {
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    const gutterLines = document.createElement('div');
    gutterLines.className = 'gutter-lines';
    gutter.appendChild(gutterLines);

    const panes = document.createElement('div');
    panes.className = 'panes';

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const backdropInner = document.createElement('div');
    backdropInner.className = 'backdrop-inner';
    backdrop.appendChild(backdropInner);

    const band = document.createElement('div');
    band.className = 'current-line-band';

    const buffer = document.createElement('textarea');
    buffer.className = 'buffer';
    buffer.spellcheck = false;
    buffer.setAttribute('autocapitalize', 'off');
    buffer.setAttribute('autocorrect', 'off');
    buffer.wrap = 'soft';
    buffer.setAttribute('aria-label', 'Text editor');

    panes.append(backdrop, band, buffer);
    this.root.append(gutter, panes);

    this.el = { root: this.root, gutter, gutterLines, panes, backdrop, backdropInner, band, buffer };
  }

  #bind() {
    const b = this.el.buffer;

    b.addEventListener('input', () => {
      const prev = this.text;
      this.text = b.value;
      this.#recomputeLines();
      this.#pushUndo(prev, 'insert');
      this.#refresh({ textChanged: true });
      this.hooks.onInput?.();
    });

    const cursor = () => {
      this.#refreshCursor();
      this.hooks.onCursor?.(this.cursorInfo());
    };
    b.addEventListener('keyup', cursor);
    b.addEventListener('click', cursor);
    b.addEventListener('select', cursor);

    b.addEventListener('scroll', () => {
      this.syncScroll();
      this.hooks.onScroll?.(this.getScroll());
    });

    // Keep the mirrored layers glued to the native scroll.
    b.addEventListener('keydown', (e) => this.#handleKey(e));
  }

  #handleKey(e) {
    // Tab inserts a real tab character instead of moving focus, like the original.
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !this.readonly) {
      e.preventDefault();
      this.insertText('\t', { undoable: true, kind: 'tab' });
      return;
    }
    // Alt+Z toggles word wrap (original shortcut).
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      this.setWrap(!this.settings.wrap);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.readonly) {
      e.preventDefault();
      this.opts?.onToggleReadonly?.();
    }
  }

  // --------------------------------------------------------------- geometry

  get lineHeightPx() {
    const cs = getComputedStyle(this.el.buffer);
    const size = parseFloat(cs.fontSize) || this.settings.fontSize || 13;
    let lh = parseFloat(cs.lineHeight);
    if (Number.isNaN(lh)) lh = size * (this.settings.lineHeight || 1.5);
    return lh;
  }

  get padY() {
    return parseFloat(getComputedStyle(this.el.buffer).paddingTop) || 0;
  }

  get scrollbarWidth() {
    const b = this.el.buffer;
    return Math.max(0, b.offsetWidth - b.clientWidth - (this.#borderX(b) || 0));
  }

  #borderX(el) {
    const cs = getComputedStyle(el);
    return (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  }

  // -------------------------------------------------------------- documents

  /** Loads a document state into the view (used when switching tabs). */
  load(state) {
    this.text = state.text ?? '';
    this.undoStack = state.undo || [];
    this.redoStack = state.redo || [];
    this.lastUndoPush = 0;
    this.activeMatch = -1;
    this.el.buffer.value = this.text;
    this.readonly = !!state.readonly;
    this.el.buffer.readOnly = this.readonly;
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.el.buffer.scrollTop = state.scrollTop || 0;
    this.el.buffer.scrollLeft = state.scrollLeft || 0;
    this.syncScroll();
    const start = state.selStart ?? 0;
    const end = state.selEnd ?? start;
    this.setSelection(start, end, { scrollIntoView: false, silent: true });
    if (state.search) this.setSearch(state.search, { silent: true });
  }

  /** Extracts the mutable state back into the tab object. */
  save(state) {
    state.text = this.text;
    state.undo = this.undoStack;
    state.redo = this.redoStack;
    state.scrollTop = this.el.buffer.scrollTop;
    state.scrollLeft = this.el.buffer.scrollLeft;
    state.selStart = this.el.buffer.selectionStart;
    state.selEnd = this.el.buffer.selectionEnd;
    state.search = { ...this.search };
    return state;
  }

  setReadonly(flag) {
    this.readonly = !!flag;
    this.el.buffer.readOnly = this.readonly;
  }

  // ------------------------------------------------------------- text edits

  getValue() {
    return this.text;
  }

  setValue(text, { keepCursor = false, resetUndo = false } = {}) {
    const prev = this.text;
    if (resetUndo) {
      this.undoStack = [];
      this.redoStack = [];
    } else {
      this.#pushUndo(prev, 'setValue');
    }
    this.text = text;
    this.el.buffer.value = text;
    if (!keepCursor) this.el.buffer.setSelectionRange(0, 0);
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.#refreshCursor();
    this.hooks.onInput?.();
  }

  /** Replaces the current selection (or inserts at the caret). */
  insertText(str, { kind = 'insert' } = {}) {
    if (this.readonly) return;
    const b = this.el.buffer;
    const prev = this.text;
    const start = b.selectionStart;
    const end = b.selectionEnd;
    const next = prev.slice(0, start) + str + prev.slice(end);

    // Native undo is disabled on purpose: we own the history so that
    // programmatic edits and keystrokes share one stack.
    b.value = next;
    this.text = next;
    const caret = start + str.length;
    b.setSelectionRange(caret, caret);
    this.#pushUndo(prev, kind);
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.#refreshCursor();
    this.hooks.onInput?.();
  }

  replaceRange(start, end, str, { kind = 'replace', select = false } = {}) {
    if (this.readonly) return;
    const b = this.el.buffer;
    const prev = this.text;
    const next = prev.slice(0, start) + str + prev.slice(end);
    b.value = next;
    this.text = next;
    if (select) b.setSelectionRange(start, start + str.length);
    else {
      const caret = start + str.length;
      b.setSelectionRange(caret, caret);
    }
    this.#pushUndo(prev, kind);
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.#refreshCursor();
    this.hooks.onInput?.();
  }

  #pushUndo(prevText, kind) {
    if (prevText === this.text) return;
    const now = performance.now();
    const coalesce =
      this.undoStack.length > 0 &&
      now - this.lastUndoPush < 700 &&
      kind === 'insert' &&
      this.lastInputKind === 'insert';
    if (coalesce) {
      this.undoStack[this.undoStack.length - 1].at = now;
    } else {
      this.undoStack.push({
        text: prevText,
        selStart: this.el.buffer.selectionStart,
        selEnd: this.el.buffer.selectionEnd,
        at: now,
      });
      if (this.undoStack.length > 300) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastUndoPush = now;
    this.lastInputKind = kind;
    this.hooks.onUndoState?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push({
      text: this.text,
      selStart: this.el.buffer.selectionStart,
      selEnd: this.el.buffer.selectionEnd,
      at: performance.now(),
    });
    this.text = entry.text;
    this.el.buffer.value = entry.text;
    this.el.buffer.setSelectionRange(entry.selStart ?? 0, entry.selEnd ?? 0);
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.hooks.onInput?.();
    this.hooks.onUndoState?.(this.undoStack.length > 0, true);
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({
      text: this.text,
      selStart: this.el.buffer.selectionStart,
      selEnd: this.el.buffer.selectionEnd,
      at: performance.now(),
    });
    this.text = entry.text;
    this.el.buffer.value = entry.text;
    this.el.buffer.setSelectionRange(entry.selStart ?? 0, entry.selEnd ?? 0);
    this.#recomputeLines();
    this.#refresh({ textChanged: true });
    this.hooks.onInput?.();
    this.hooks.onUndoState?.(true, this.redoStack.length > 0);
    return true;
  }

  // --------------------------------------------------------------- selection

  setSelection(start, end = start, { scrollIntoView = true, silent = false } = {}) {
    const b = this.el.buffer;
    const len = this.text.length;
    b.setSelectionRange(clamp(start, 0, len), clamp(end, 0, len));
    if (scrollIntoView) this.scrollCaretIntoView();
    this.#refreshCursor();
    if (!silent) this.hooks.onCursor?.(this.cursorInfo());
  }

  selectAll() {
    this.setSelection(0, this.text.length);
  }

  get selectionRange() {
    const b = this.el.buffer;
    return { start: b.selectionStart, end: b.selectionEnd };
  }

  /** Line / column / selection size, in the exact wording of the original app. */
  cursorInfo() {
    const b = this.el.buffer;
    const pos = b.selectionEnd;
    const line = this.#lineIndexAt(pos);
    const col = pos - this.lineStarts[line] + 1;
    const selLen = Math.abs(b.selectionEnd - b.selectionStart);
    return { line: line + 1, col, selected: selLen, lineCount: this.lineStarts.length };
  }

  goToLine(lineNumber) {
    const idx = clamp(lineNumber - 1, 0, this.lineStarts.length - 1);
    this.setSelection(this.lineStarts[idx], this.lineStarts[idx]);
    this.scrollCaretIntoView();
  }

  // ------------------------------------------------------------------ search

  /**
   * Recomputes the hit list. Returns `{count, error}`; `error` is a message when
   * a regex does not compile (the original shows InvalidRegularExpression).
   */
  setSearch(opts, { silent = false } = {}) {
    this.search = { ...this.search, ...opts };
    const { query, matchCase, wholeWord, regex, active } = this.search;
    this.matches = [];
    this.activeMatch = -1;
    let error = null;

    if (active && query) {
      if (regex) {
        try {
          const base = matchCase ? query : query;
          const re = new RegExp(base, matchCase ? 'gm' : 'gim');
          this.matches = this.#collectRegex(re, wholeWord);
        } catch (e) {
          error = String(e.message || e);
        }
      } else {
        this.matches = this.#collectLiteral(query, matchCase, wholeWord);
      }
    }

    if (this.matches.length) {
      // Start from the first hit at or after the caret.
      const caret = this.el.buffer.selectionStart;
      const idx = this.matches.findIndex((m) => m.start >= caret);
      this.activeMatch = idx === -1 ? 0 : idx;
    }

    this.#refresh({ textChanged: false });
    if (!silent) this.#scrollActiveMatchIntoView();
    return { count: this.matches.length, error };
  }

  #collectLiteral(query, matchCase, wholeWord) {
    const hay = matchCase ? this.text : this.text.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    const out = [];
    if (!needle) return out;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(needle, from);
      if (i === -1) break;
      const end = i + needle.length;
      if (!wholeWord || this.#isWordBoundary(i, end)) out.push({ start: i, end });
      from = i + Math.max(1, needle.length);
      if (out.length > 200000) break;
    }
    return out;
  }

  #collectRegex(re, wholeWord) {
    const out = [];
    let m;
    let guard = 0;
    while ((m = re.exec(this.text)) !== null && guard++ < 200000) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex = start + 1;
        continue;
      }
      if (!wholeWord || this.#isWordBoundary(start, end)) out.push({ start, end });
    }
    return out;
  }

  #isWordBoundary(start, end) {
    const isWord = (c) => !!c && /[\w\u00C0-\u024F]/.test(c);
    return !isWord(this.text[start - 1]) && !isWord(this.text[end]);
  }

  findNext(dir = 1) {
    if (!this.matches.length) return false;
    this.activeMatch = (this.activeMatch + dir + this.matches.length) % this.matches.length;
    this.#refresh({ textChanged: false });
    this.#scrollActiveMatchIntoView();
    return true;
  }

  get activeMatchIndex() {
    return this.activeMatch;
  }

  replaceCurrent(replacement) {
    if (this.activeMatch < 0 || !this.matches.length) return false;
    const m = this.matches[this.activeMatch];
    this.replaceRange(m.start, m.end, replacement, { kind: 'replace' });
    this.setSearch({}, { silent: true });
    return true;
  }

  replaceAll(replacement) {
    if (!this.matches.length) return 0;
    const matches = [...this.matches];
    let next = this.text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      next = next.slice(0, m.start) + replacement + next.slice(m.end);
    }
    const count = matches.length;
    this.setValue(next, { keepCursor: true });
    this.setSearch({}, { silent: true });
    return count;
  }

  #scrollActiveMatchIntoView() {
    const m = this.matches[this.activeMatch];
    if (!m) return;
    const line = this.#lineIndexAt(m.start);
    this.scrollLineIntoView(line, m.end);
  }

  scrollLineIntoView(lineIdx, caretPos) {
    const b = this.el.buffer;
    const lh = this.lineHeightPx;
    let top;
    if (!this.settings.wrap) {
      top = this.padY + lineIdx * lh;
      const view = b.clientHeight;
      if (top - b.scrollTop < 0) b.scrollTop = top - this.padY;
      else if (top + lh - b.scrollTop > view) b.scrollTop = top + lh - view + this.padY;
    } else {
      const el = this.el.backdropInner.children[lineIdx];
      if (el) {
        top = el.offsetTop;
        const view = b.clientHeight;
        if (top - b.scrollTop < 0) b.scrollTop = top - lh;
        else if (top + el.offsetHeight - b.scrollTop > view) {
          b.scrollTop = top + el.offsetHeight - view + lh * 0.5;
        }
      }
    }
    // Horizontal: only when wrapping is off can a long line hide the caret.
    if (!this.settings.wrap && caretPos != null) {
      const after = this.text.slice(this.lineStarts[lineIdx], caretPos);
      const width = this.#measureWidth(after);
      const view = b.clientWidth;
      if (width - b.scrollLeft > view - 40) b.scrollLeft = width - view + 60;
      else if (width < b.scrollLeft) b.scrollLeft = 0;
    }
    this.syncScroll();
  }

  #measure(widthOf) {
    if (!this._measureEl) {
      const el = document.createElement('span');
      el.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;pointer-events:none';
      document.body.appendChild(el);
      this._measureEl = el;
    }
    const cs = getComputedStyle(this.el.buffer);
    this._measureEl.style.font = cs.font;
    this._measureEl.style.fontFamily = cs.fontFamily;
    this._measureEl.style.fontSize = cs.fontSize;
    this._measureEl.style.letterSpacing = cs.letterSpacing;
    this._measureEl.style.tabSize = this.settings.tabSize;
    return widthOf;
  }

  #measureWidth(str) {
    const el = this.#measureElFor(str);
    el.textContent = str;
    return el.getBoundingClientRect().width;
  }

  #measureElFor() {
    if (!this._measureEl) {
      const el = document.createElement('span');
      el.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;pointer-events:none';
      document.body.appendChild(el);
      this._measureEl = el;
    }
    const cs = getComputedStyle(this.el.buffer);
    this._measureEl.style.fontFamily = cs.fontFamily;
    this._measureEl.style.fontSize = cs.fontSize;
    this._measureEl.style.letterSpacing = cs.letterSpacing;
    this._measureEl.style.tabSize = this.settings.tabSize;
    return this._measureEl;
  }

  scrollCaretIntoView() {
    const info = this.cursorInfo();
    this.scrollLineIntoView(info.line - 1, this.el.buffer.selectionEnd);
  }

  // ------------------------------------------------------------------ render

  #recomputeLines() {
    const starts = [0];
    const t = this.text;
    for (let i = 0; i < t.length; i++) {
      if (t.charCodeAt(i) === 10) starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  #lineIndexAt(pos) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get lineCount() {
    return this.lineStarts.length;
  }

  getLine(i) {
    const start = this.lineStarts[i];
    if (start == null) return '';
    const end = i + 1 < this.lineStarts.length ? this.lineStarts[i + 1] - 1 : this.text.length;
    return this.text.slice(start, end);
  }

  /** True when the mirrored backdrop has to exist (search hits or wrapped lines). */
  get #needsBackdrop() {
    return this.search.active || this.settings.wrap || this.text.length < 400000;
  }

  #refresh({ textChanged }) {
    const b = this.el.buffer;
    b.classList.toggle('nowrap', !this.settings.wrap);
    this.el.backdropInner.classList.toggle('nowrap', !this.settings.wrap);
    b.style.tabSize = String(this.settings.tabSize);
    this.el.backdropInner.style.tabSize = String(this.settings.tabSize);

    // Scrollbar compensation: the textarea loses width to its scrollbar, the
    // backdrop must lose exactly the same so wrapped lines break in the same spot.
    const sb = this.scrollbarWidth;
    this.el.backdropInner.style.paddingRight = `calc(var(--editor-pad-x) + ${sb}px)`;

    if (this.#needsBackdrop) this.#renderBackdrop();
    else this.el.backdropInner.textContent = '';

    this.#renderGutter();
    this.#updateBand();
    this.syncScroll();
    if (textChanged) this.hooks.onUndoState?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  #renderBackdrop() {
    const inner = this.el.backdropInner;
    const matches = this.search.active && this.search.query && !this.matches.length ? [] : this.matches;
    const byLineStart = matches.length ? this.#matchesByLine(matches) : null;
    const lines = this.lineStarts.length;
    const chunks = new Array(lines);

    for (let i = 0; i < lines; i++) {
      const start = this.lineStarts[i];
      const end = i + 1 < lines ? this.lineStarts[i + 1] - 1 : this.text.length;
      const lineText = this.text.slice(start, end);
      const lineMatches = byLineStart?.get(i);
      if (!lineMatches || !lineMatches.length) {
        chunks[i] = `<div class="ln">${escHtml(lineText) || '&#8203;'}</div>`;
        continue;
      }
      let html = '';
      let cursor = 0;
      for (const m of lineMatches) {
        const s = m.start - start;
        const e = m.end - start;
        if (s > cursor) html += escHtml(lineText.slice(cursor, s));
        html += `<mark class="${m.index === this.activeMatch ? 'active' : ''}">${escHtml(
          lineText.slice(s, e),
        )}</mark>`;
        cursor = e;
      }
      html += escHtml(lineText.slice(cursor));
      chunks[i] = `<div class="ln">${html || '&#8203;'}</div>`;
    }
    // A single innerHTML write keeps large documents to one reflow.
    inner.innerHTML = chunks.join('');
  }

  /** Groups hits by line and clamps multi-line regex hits into each line. */
  #matchesByLine(matches) {
    const map = new Map();
    matches.forEach((m, index) => {
      let lineIdx = this.#lineIndexAt(m.start);
      let cursor = m.start;
      for (;;) {
        const lineEnd =
          lineIdx + 1 < this.lineStarts.length ? this.lineStarts[lineIdx + 1] - 1 : this.text.length;
        map.set(lineIdx, map.get(lineIdx) || []);
        map.get(lineIdx).push({
          start: cursor,
          end: Math.min(m.end, lineEnd),
          index,
        });
        if (m.end <= lineEnd) break;
        lineIdx++;
        cursor = lineEnd + 1;
      }
    });
    return map;
  }

  #renderGutter() {
    const g = this.el.gutterLines;
    const n = this.lineStarts.length;
    if (!this.settings.lineNumbers) {
      g.textContent = '';
      this.el.gutter.classList.add('hidden');
      return;
    }
    this.el.gutter.classList.remove('hidden');
    const lh = this.lineHeightPx;
    const scrollTop = this.el.buffer.scrollTop;
    const viewH = this.el.buffer.clientHeight;
    const current = this.#lineIndexAt(this.el.buffer.selectionEnd);

    if (!this.settings.wrap) {
      // Exact arithmetic: with wrapping off every line is exactly one row tall.
      const first = Math.max(0, Math.floor((scrollTop - this.padY) / lh) - 1);
      const last = Math.min(n - 1, Math.ceil((scrollTop + viewH) / lh) + 1);
      let html = '';
      for (let i = first; i <= last; i++) {
        html += `<div class="gutter-line ${i === current ? 'current' : ''}">${i + 1}</div>`;
      }
      g.innerHTML = html;
      g.style.transform = `translateY(${scrollTop}px)`;
      g.dataset.first = String(first);
    } else {
      // Wrapping on: y positions come from the measured backdrop blocks.
      const blocks = this.el.backdropInner.children;
      let html = '';
      for (let i = 0; i < blocks.length; i++) {
        const blk = blocks[i];
        const top = blk.offsetTop;
        if (top > scrollTop + viewH) break;
        if (top + blk.offsetHeight < scrollTop) continue;
        html += `<div class="gutter-line ${i === current ? 'current' : ''}" style="height:${
          blk.offsetHeight
        }px">${i + 1}</div>`;
      }
      g.innerHTML = html;
      g.style.transform = `translateY(${scrollTop}px)`;
    }
  }

  #updateBand() {
    const band = this.el.band;
    if (!this.settings.highlightCurrentLine || this.readonly) {
      band.classList.remove('on');
      return;
    }
    const lineIdx = this.#lineIndexAt(this.el.buffer.selectionEnd);
    const lh = this.lineHeightPx;
    let top;
    let height = lh;
    if (!this.settings.wrap) {
      top = this.padY + lineIdx * lh;
    } else {
      const blk = this.el.backdropInner.children[lineIdx];
      if (!blk) {
        band.classList.remove('on');
        return;
      }
      top = blk.offsetTop;
      height = blk.offsetHeight;
    }
    band.classList.add('on');
    band.style.height = `${height}px`;
    band.style.transform = `translateY(${top - this.el.buffer.scrollTop}px)`;
  }

  /** Mirrors the native scroll into the backdrop, gutter and line band. */
  syncScroll() {
    const b = this.el.buffer;
    this.el.backdropInner.style.transform = `translate(${-b.scrollLeft}px, ${-b.scrollTop}px)`;
    if (!this.settings.wrap) {
      this.el.gutterLines.style.transform = `translateY(${b.scrollTop}px)`;
    } else {
      this.el.gutterLines.style.transform = `translateY(${b.scrollTop}px)`;
    }
    this.#updateBand();
    if (this.settings.wrap && this.settings.lineNumbers) this.#renderGutter();
  }

  #refreshCursor() {
    this.#updateBand();
    if (this.settings.wrap && this.settings.lineNumbers) this.#renderGutter();
  }

  // ---------------------------------------------------------------- settings

  applySettings(s) {
    Object.assign(this.settings, s);
    const style = this.root.style;
    style.setProperty('--editor-font-size', `${this.settings.fontSize}px`);
    style.setProperty('--editor-line-height', String(this.settings.lineHeight));
    const family =
      this.settings.fontFamily === 'mono'
        ? 'var(--font-mono)'
        : this.settings.fontFamily === 'serif'
          ? 'Georgia, "Noto Serif", "DejaVu Serif", serif'
          : '"NotepadsUI", system-ui, sans-serif';
    this.el.buffer.style.fontFamily = family;
    this.el.backdropInner.style.fontFamily = family;
    this.el.gutter.style.fontFamily = family;
    this.#refresh({ textChanged: false });
    this.syncScroll();
  }

  setWrap(flag) {
    this.settings.wrap = !!flag;
    this.#refresh({ textChanged: false });
    this.#refreshCursor();
    return this.settings.wrap;
  }

  setLineNumbers(flag) {
    this.settings.lineNumbers = !!flag;
    this.#refresh({ textChanged: false });
    return this.settings.lineNumbers;
  }

  setHighlightCurrentLine(flag) {
    this.settings.highlightCurrentLine = !!flag;
    this.#updateBand();
  }

  setZoom(delta, min = 8, max = 60) {
    this.settings.fontSize = clamp(this.settings.fontSize + delta, min, max);
    this.applySettings({});
    return this.settings.fontSize;
  }

  resetZoom() {
    this.settings.fontSize = 13;
    this.applySettings({});
    return this.settings.fontSize;
  }

  focus() {
    this.el.buffer.focus();
  }

  getScroll() {
    return { top: this.el.buffer.scrollTop, left: this.el.buffer.scrollLeft };
  }
}
