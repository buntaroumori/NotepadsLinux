/**
 * tests/smoke.test.mjs — headless smoke test for the frontend.
 *
 * Runs the real index.html + app.js inside jsdom with the browser bridge (no
 * Tauri), then drives the same code paths a user would: typing, searching,
 * replacing, undo, tabs, themes, session and the diff viewer.
 *
 *   npm install && npm test
 *
 * jsdom has no layout engine, so anything that depends on measured pixels is
 * asserted structurally (elements exist, numbers are finite) instead of visually.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

async function bootApp() {
  const html = readFileSync(path.join(srcDir, 'index.html'), 'utf8').replace(
    /<script[^>]*><\/script>/,
    '',
  );
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.navigator = window.navigator;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Blob = window.Blob;
  globalThis.location = window.location;
  globalThis.matchMedia = undefined;

  // Import the modules with the jsdom globals in place.
  const { EditorView } = await import(path.join(srcDir, 'editor.js'));
  const { diffLines, diffStats } = await import(path.join(srcDir, 'diff.js'));
  const { icon, fileIconFor } = await import(path.join(srcDir, 'icons.js'));
  return { window, dom, EditorView, diffLines, diffStats, icon, fileIconFor };
}

test('editor: text, line numbers, cursor info and undo/redo', async (t) => {
  const { window, EditorView } = await bootApp();
  const root = window.document.createElement('div');
  window.document.body.append(root);
  const editor = new EditorView(root, {});

  editor.setValue('alpha\nbeta\ngamma');
  assert.equal(editor.lineCount, 3);
  assert.equal(editor.getLine(1), 'beta');

  editor.setSelection(8);
  const info = editor.cursorInfo();
  assert.equal(info.line, 2);
  assert.equal(info.col, 3, 'caret after "be" is column 3');

  editor.setSelection(0, 5);
  assert.equal(editor.cursorInfo().selected, 5);

  editor.insertText('X');
  assert.equal(editor.getValue(), 'X\nbeta\ngamma');
  assert.equal(editor.undo(), true);
  assert.equal(editor.getValue(), 'alpha\nbeta\ngamma');
  assert.equal(editor.redo(), true);
  assert.equal(editor.getValue(), 'X\nbeta\ngamma');

  editor.applySettings({ lineNumbers: true, wrap: false });
  editor.setSelection(0);
  assert.ok(editor.el.gutterLines.innerHTML.includes('1'));
});

test('editor: find / replace with literal, whole word, case and regex', async (t) => {
  const { window, EditorView } = await bootApp();
  const root = window.document.createElement('div');
  window.document.body.append(root);
  const editor = new EditorView(root, {});
  editor.setValue('cat catalog Cat\ncat');

  let res = editor.setSearch({ active: true, query: 'cat' });
  assert.equal(res.count, 4, 'substring matching by default');
  assert.equal(res.error, null);

  res = editor.setSearch({ active: true, query: 'cat', wholeWord: true });
  assert.equal(res.count, 3);

  res = editor.setSearch({ active: true, query: 'cat', wholeWord: true, matchCase: true });
  assert.equal(res.count, 2);

  res = editor.setSearch({ active: true, query: 'c.t', regex: true, wholeWord: false, matchCase: false });
  assert.equal(res.count, 4);

  res = editor.setSearch({ active: true, query: '(', regex: true, wholeWord: false, matchCase: false });
  assert.ok(res.error, 'invalid regex is reported, not thrown');

  res = editor.setSearch({ active: true, query: 'cat', regex: false, wholeWord: true, matchCase: true });
  assert.equal(res.count, 2);
  editor.findNext(1);
  assert.ok(editor.activeMatchIndex >= 0 && editor.activeMatchIndex < editor.matches.length);

  const n = editor.replaceAll('dog');
  assert.equal(n, 2);
  assert.equal(editor.getValue(), 'dog catalog Cat\ndog');
});

test('editor: wrap mode still reports a consistent gutter', async (t) => {
  const { window, EditorView } = await bootApp();
  const root = window.document.createElement('div');
  window.document.body.append(root);
  const editor = new EditorView(root, {});
  editor.setValue(Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'));
  editor.setWrap(true);
  editor.setSelection(0);
  const numbers = [...editor.el.gutterLines.children].map((n) => n.textContent);
  assert.ok(numbers.length > 0);
  assert.equal(numbers[0], '1');
  assert.equal(editor.setWrap(false), false);
});

test('diff: line diffing produces aligned rows', async (t) => {
  const { diffLines, diffStats } = await bootApp();
  const rows = diffLines('a\nb\nc', 'a\nB\nc');
  const stats = diffStats(rows);
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 1);
  assert.equal(rows[0].type, 'same');
  assert.equal(rows.length, 4, 'one removal row plus one addition row');
});

test('app: boots, opens tabs, searches, themes and snapshots the session', async (t) => {
  await bootApp();
  const app = (await import(path.join(srcDir, 'app.js'))).internals;
  // app.js boots itself on import; jsdom needs a tick for the async boot.
  await new Promise((r) => setTimeout(r, 120));

  const doc = globalThis.document;
  assert.equal(doc.querySelectorAll('#tabstrip .tab').length, 1, 'one welcome tab');
  assert.ok(doc.querySelector('#status-encoding').textContent.length > 0);

  // Theme + accent through the real settings path.
  app.patchSettings({ theme: 'light', accent: '#b15782' });
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(doc.documentElement.style.getPropertyValue('--accent'), '#b15782');

  // Tabs: open, switch, close.
  const first = app.activeDoc();
  const second = await app.newTab({ name: 'notes.md', content: '# hi\nsome text' });
  assert.equal(app.S.tabs.length, 2);
  assert.equal(app.activeDoc().name, 'notes.md');
  app.activateTab(first.id);
  assert.equal(app.activeDoc().id, first.id);
  app.activateTab(second.id);

  // Search through the editor surface, exactly as the find card does.
  app.S.editor.setSearch({ active: true, query: 'text' });
  assert.equal(app.S.editor.matches.length, 1);
  assert.equal(app.S.editor.replaceAll('words'), 1);
  assert.ok(app.activeDoc().text.includes('words'));

  // Word count of the tab list, then close.
  await app.closeTab(second.id, { force: true });
  assert.equal(app.S.tabs.length, 1);

  // Session snapshot round-trip through the bridge (localStorage in the browser).
  await app.saveSession();
  const raw = JSON.parse(globalThis.localStorage.getItem('notepads.session') || '{}');
  assert.ok(Array.isArray(raw.windows));
  assert.equal(raw.windows.length, 1);
  assert.ok(raw.windows[0].files.length >= 1);
});

test('icons: every icon name used by the UI resolves to real markup', async (t) => {
  const { icon, fileIconFor } = await bootApp();
  for (const name of ['menu', 'plus', 'close', 'find', 'chevronDown', 'replace', 'replaceAll', 'save', 'settings']) {
    assert.ok(icon(name, 16).includes('<svg'), `${name} renders`);
  }
  assert.equal(fileIconFor('/tmp/readme.md').name, 'fileMd');
  assert.equal(fileIconFor('/tmp/notes.txt').name, 'fileText');
  assert.equal(fileIconFor(null, true).name, 'fileText');
});
