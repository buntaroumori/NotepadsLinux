/**
 * app.js — Notepads for Linux, application shell.
 *
 * Contains the tab system, the command surface (menus, context menus, keyboard),
 * the find/replace card, the status bar, the settings pane, the dialogs, the
 * session snapshot and the window chrome. The text surface lives in editor.js and
 * every OS call goes through bridge.js.
 */

import { icon, iconNode, fileIconFor } from './icons.js';
import { EditorView } from './editor.js';
import { api, isTauri, registerDroppedFile, storage } from './bridge.js';
import { diffLines, diffStats } from './diff.js';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const basename = (p) => (p ? p.split(/[\\/]/).pop() : '');
const dirname = (p) => (p ? p.split(/[\\/]/).slice(0, -1).join('/') || '/' : '');
const toLF = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const nowStamp = () => new Date().toLocaleString();

const EOL_LABEL = { CRLF: 'Windows (CRLF)', LF: 'Unix (LF)', CR: 'Macintosh (CR)' };

/* ----------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light' | 'system'  — Theme Mode
  accent: '#0078d4', // Accent Color
  useSystemAccent: false, // "Use my Windows/Linux accent color"
  tintOpacity: 90, // Background tint opacity
  transparentWindow: false,
  fontFamily: 'mono', // 'mono' | 'serif' | 'ui'
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 4,
  lineNumbers: true,
  highlightCurrentLine: true,
  highlightModifiedLines: true,
  wordWrap: false,
  defaultEncoding: 'auto', // 'auto' | a codec label
  defaultLineEnding: 'auto', // 'auto' | 'CRLF' | 'LF' | 'CR'
  restoreSessionOnStartup: true, // Session snapshot
  showStatusBar: true,
  autoGuessEncoding: true,
  recentFiles: [],
  windowTitleStyle: 'tab',
};

const S = {
  settings: { ...DEFAULT_SETTINGS },
  tabs: [],
  activeId: null,
  uid: 0,
  encodings: [],
  flyouts: [],
  settingsOpen: false,
  settingsSection: 'personalization',
  unlisten: [],
  info: { version: '1.0.0', configDir: '—' },
  lastDir: null,
  diffOpen: false,
};

/* -------------------------------------------------------------------- theme */

function applyTheme() {
  const { theme } = S.settings;
  const dark =
    theme === 'system'
      ? (globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true)
      : theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 120, 212];
}

function applyAccent() {
  const rgb = hexToRgb(S.settings.accent);
  const root = document.documentElement.style;
  root.setProperty('--accent', S.settings.accent);
  root.setProperty('--accent-soft', `rgba(${rgb.join(',')},0.28)`);
  root.setProperty('--selection', `rgba(${rgb.join(',')},0.38)`);
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  root.setProperty('--accent-fg', lum > 0.62 ? '#101010' : '#ffffff');
}

function applySettingsToEditors() {
  S.editor.applySettings({
    fontFamily: S.settings.fontFamily,
    fontSize: S.settings.fontSize,
    lineHeight: S.settings.lineHeight,
    tabSize: S.settings.tabSize,
    wrap: S.settings.wordWrap,
    lineNumbers: S.settings.lineNumbers,
    highlightCurrentLine: S.settings.highlightCurrentLine,
  });
  $('#statusbar').classList.toggle('hidden', !S.settings.showStatusBar);
}

async function persistSettings() {
  try {
    await api.writeSettings(JSON.stringify(S.settings, null, 2));
  } catch (e) {
    console.warn('could not persist settings', e);
  }
}

function patchSettings(patch, { rerenderSettings = true } = {}) {
  S.settings = { ...S.settings, ...patch };
  applyTheme();
  applyAccent();
  applySettingsToEditors();
  persistSettings();
  updateStatusBar();
  if (rerenderSettings && S.settingsOpen) renderSettingsPane();
}

function pushRecent(path) {
  if (!path) return;
  const name = basename(path);
  const recent = [{ path, name }, ...S.settings.recentFiles.filter((r) => r.path !== path)].slice(0, 10);
  S.settings.recentFiles = recent;
  persistSettings();
}

/* --------------------------------------------------------------------- tabs */

function newDoc(opts = {}) {
  return {
    id: ++S.uid,
    path: opts.path ?? null,
    name: opts.name || (opts.path ? basename(opts.path) : 'Untitled.txt'),
    encoding: opts.encoding || 'UTF-8',
    lineEnding: opts.lineEnding || 'LF',
    encodingGuessed: !!opts.encodingGuessed,
    modified: false,
    readonly: !!opts.readonly,
    binary: !!opts.binary,
    size: opts.size || 0,
    diskModifiedMs: opts.diskModifiedMs || 0,
    diffBase: opts.diffBase ?? opts.text ?? '',
    // view state consumed by EditorView.load()/save()
    text: opts.text ?? '',
    undo: [],
    redo: [],
    scrollTop: 0,
    scrollLeft: 0,
    selStart: 0,
    selEnd: 0,
    search: null,
  };
}

function activeDoc() {
  return S.tabs.find((t) => t.id === S.activeId) || null;
}

function tabTitle(doc) {
  return doc.name + (doc.modified ? '*' : '');
}

function renderTabs() {
  const strip = $('#tabstrip');
  strip.textContent = '';
  for (const doc of S.tabs) {
    const fi = fileIconFor(doc.path, !doc.path);
    const iconEl = h('span', { class: 'tab-icon', style: `color:${doc.path ? fi.color : 'var(--fg-dim)'}` }, iconNode(fi.name, 14));
    const title = h('span', { class: 'tab-title', title: doc.path || doc.name, text: tabTitle(doc) });
    const dot = h('span', { class: 'dot' });
    const closeBtn = h(
      'button',
      {
        class: 'tab-close',
        title: 'Close tab (Ctrl+W)',
        'aria-label': `Close ${doc.name}`,
        onclick: (e) => {
          e.stopPropagation();
          closeTab(doc.id);
        },
      },
      dot,
      iconNode('close', 12),
    );
    const tab = h(
      'div',
      {
        class: `tab${doc.id === S.activeId ? ' active' : ''}${doc.modified ? ' modified' : ''}`,
        role: 'tab',
        tabindex: doc.id === S.activeId ? 0 : -1,
        'aria-selected': doc.id === S.activeId ? 'true' : 'false',
        title: doc.path ? `${doc.name}\n${doc.path}` : 'Untitled (not saved yet)',
        draggable: 'true',
        onclick: () => activateTab(doc.id),
        onauxclick: (e) => {
          if (e.button === 1) closeTab(doc.id);
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          showTabContextMenu(e, doc);
        },
        ondragstart: (e) => {
          e.dataTransfer.setData('text/notepads-tab', String(doc.id));
          tab.classList.add('dragging');
        },
        ondragend: () => tab.classList.remove('dragging'),
      },
      iconEl,
      title,
      closeBtn,
    );
    tab.dataset.id = String(doc.id);
    strip.append(tab);
  }
}

function activateTab(id) {
  const doc = S.tabs.find((t) => t.id === id);
  if (!doc || id === S.activeId) return;
  const prev = activeDoc();
  if (prev) S.editor.save(prev);
  S.activeId = id;
  S.editor.load(doc);
  S.editor.setReadonly(doc.readonly || doc.binary);
  renderTabs();
  updateStatusBar();
  updateWindowTitle();
  if (doc.binary) showBinaryOverlay(doc);
  else hideBinaryOverlay();
  scheduleSessionSave();
  S.editor.focus();
}

function addTab(doc, { activate = true } = {}) {
  S.tabs.push(doc);
  if (activate) {
    const prev = activeDoc();
    if (prev && prev.id !== doc.id) {
      // The editor still holds the previous document: persist it before swapping.
      S.editor.save(prev);
    }
    S.activeId = doc.id;
    S.editor.load(doc);
    S.editor.setReadonly(doc.readonly || doc.binary);
  }
  renderTabs();
  updateStatusBar();
  updateWindowTitle();
  scheduleSessionSave();
  return doc;
}

function updateWindowTitle() {
  const doc = activeDoc();
  const name = doc ? doc.name : 'Notepads';
  api.setWindowTitle(`${doc?.modified ? '*' : ''}${name} - Notepads`);
}

/* -------------------------------------------------------------- status bar */

function updateStatusBar() {
  const doc = activeDoc();
  if (!doc) return;
  $('#status-path').textContent = doc.path || doc.name;
  $('#status-path').title = doc.path || 'Unsaved document';
  $('#status-modified').classList.toggle('hidden', !doc.modified);
  const zoom = Math.round((S.settings.fontSize / 13) * 100);
  $('#status-zoom').textContent = `${zoom}%`;
  $('#status-eol').textContent = EOL_LABEL[doc.lineEnding] || doc.lineEnding;
  const enc = S.encodings.find((e) => e.label === doc.encoding);
  $('#status-encoding').textContent = enc ? enc.name : doc.encoding;
  $('#status-encoding').title = doc.encodingGuessed ? 'Encoding was guessed — click to change' : 'Encoding';
  const info = S.editor.cursorInfo();
  const sel = info.selected ? ` (${info.selected} selected)` : '';
  $('#status-pos').textContent = `Ln ${info.line}, Col ${info.col}${sel}`;
}

/** The maximize button doubles as a restore button, like the Windows original. */
async function refreshMaximizeIcon() {
  const maximized = await api.isMaximized();
  const btn = $('#win-max');
  if (!btn) return;
  btn.textContent = '';
  btn.append(iconNode(maximized ? 'windowRestore' : 'windowMax', 12));
  btn.title = maximized ? 'Restore' : 'Maximize';
}

/* --------------------------------------------------------------- find card */

function openFind({ replace = false } = {}) {
  const card = $('#find-card');
  card.classList.remove('hidden');
  $('#replace-row').classList.toggle('hidden', !replace);
  const input = $('#find-input');
  const doc = activeDoc();
  if (doc?.search?.query && !input.value) input.value = doc.search.query;
  if (input.value === '' && doc) {
    const { start, end } = S.editor.selectionRange;
    if (end > start && end - start < 200 && !doc.text.slice(start, end).includes('\n')) {
      input.value = doc.text.slice(start, end);
    }
  }
  input.focus();
  input.select();
  runSearch();
}

function closeFind() {
  $('#find-card').classList.add('hidden');
  S.editor.setSearch({ active: false, query: '' }, { silent: true });
  S.editor.focus();
}

function runSearch() {
  const query = $('#find-input').value;
  const opts = {
    active: query.length > 0,
    query,
    matchCase: $('#find-options [data-opt="matchCase"]').classList.contains('on'),
    wholeWord: $('#find-options [data-opt="wholeWord"]').classList.contains('on'),
    regex: $('#find-options [data-opt="regex"]').classList.contains('on'),
  };
  const res = S.editor.setSearch(opts);
  const status = $('#find-status');
  const idx = S.editor.activeMatchIndex;
  if (res.error) {
    status.textContent = 'Invalid regex';
    status.classList.add('error');
    status.title = res.error;
  } else {
    status.classList.remove('error');
    status.title = '';
    status.textContent = res.count ? `${idx + 1}/${res.count}` : query ? 'No results' : '';
  }
  updateStatusBar();
}

/** Replaces the hit the find card is currently parked on, then re-runs the search. */
function doReplace() {
  if ($('#replace-row').classList.contains('hidden')) return;
  const replacement = $('#replace-input').value;
  const ok = S.editor.replaceCurrent(replacement);
  if (!ok) {
    toast({ title: 'Nothing to replace', text: 'Search for something first.' });
    return;
  }
  runSearch();
  updateStatusBar();
}

/* -------------------------------------------------------------------- menus */

function closeFlyouts() {
  for (const f of S.flyouts.splice(0)) f.remove();
  $('#menu-btn').classList.remove('open');
}

function positionFlyout(el, anchor, { align = 'start', below = true } = {}) {
  el.style.visibility = 'hidden';
  el.style.left = '0px';
  el.style.top = '0px';
  // `anchor` is either an element or a raw viewport point (context menus).
  const r =
    typeof anchor === 'object' && 'getBoundingClientRect' in anchor
      ? anchor.getBoundingClientRect()
      : { left: anchor, right: anchor, top: anchor, bottom: anchor };
  const box = el.getBoundingClientRect();
  let left = align === 'end' ? r.right - box.width : r.left;
  let top = below ? r.bottom + 4 : r.top - box.height - 4;
  left = Math.max(6, Math.min(left, innerWidth - box.width - 6));
  top = Math.max(6, Math.min(top, innerHeight - box.height - 6));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.visibility = '';
}

/**
 * items: { label, keys, icon, action, sep, disabled, checked, submenu }
 */
function openFlyout(items, anchorEl, opts = {}) {
  closeFlyouts();
  const el = h('div', { class: 'flyout', role: 'menu' });
  for (const item of items) {
    if (item.sep) {
      el.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (item.header) {
      el.append(h('div', { class: 'menu-sep' }));
      el.append(h('div', { class: 'menu-item disabled', style: 'font-size:11px;padding:4px 10px' }, item.header));
      continue;
    }
    const main = h(
      'button',
      {
        class: `menu-item${item.disabled ? ' disabled' : ''}`,
        role: 'menuitem',
        onclick: async (e) => {
          if (item.disabled) return;
          if (item.submenu) {
            openFlyout(item.submenu(), e.currentTarget, { align: 'end' });
            return;
          }
          closeFlyouts();
          await item.action?.();
        },
      },
      h('span', { style: 'width:16px;display:flex' }, item.checked != null ? iconNode(item.checked ? 'check' : 'dash', 14) : item.icon ? iconNode(item.icon, 16) : null),
      h('span', { class: 'label', text: item.label }),
      item.keys ? h('span', { class: 'keys', text: item.keys }) : null,
      item.submenu ? iconNode('chevronRight', 12) : null,
    );
    el.append(main);
  }
  document.body.append(el);
  positionFlyout(el, anchorEl, opts);
  S.flyouts.push(el);
  return el;
}

function mainMenuItems() {
  const doc = activeDoc();
  const hasDoc = !!doc;
  return [
    { label: 'New tab', keys: 'Ctrl+N', icon: 'fileText', action: () => newTab() },
    { label: 'New window', keys: 'Ctrl+Shift+N', icon: 'newWindow', action: () => api.newWindow() },
    { label: 'Open file…', keys: 'Ctrl+O', icon: 'folder', action: () => openFileDialog() },
    {
      label: 'Open recent',
      icon: 'refresh',
      disabled: !S.settings.recentFiles.length,
      submenu: () => [
        ...S.settings.recentFiles.map((r) => ({
          label: r.name,
          action: () => openPath(r.path),
        })),
        { sep: true },
        {
          label: 'Clear recently opened',
          disabled: !S.settings.recentFiles.length,
          action: () => {
            S.settings.recentFiles = [];
            persistSettings();
            toast({ title: 'Recent files cleared' });
          },
        },
      ],
    },
    { sep: true },
    { label: 'Save', keys: 'Ctrl+S', icon: 'save', disabled: !hasDoc, action: () => saveDoc(activeDoc()) },
    { label: 'Save as…', keys: 'Ctrl+Shift+S', icon: 'save', disabled: !hasDoc, action: () => saveDoc(activeDoc(), { saveAs: true }) },
    { label: 'Save all', keys: 'Ctrl+Alt+S', icon: 'saveAll', action: () => saveAll() },
    { label: 'Rename…', keys: 'F2', icon: 'pencil', disabled: !doc?.path, action: () => renameDialog(activeDoc()) },
    { label: 'Revert all changes', icon: 'undo', disabled: !doc?.modified, action: () => revertDoc(activeDoc()) },
    { label: 'Reload file from disk', icon: 'refresh', disabled: !doc?.path, action: () => reloadDoc(activeDoc()) },
    { sep: true },
    { label: 'Find…', keys: 'Ctrl+F', icon: 'find', action: () => openFind() },
    { label: 'Replace…', keys: 'Ctrl+H', icon: 'replace', action: () => openFind({ replace: true }) },
    { label: 'Go to line…', keys: 'Ctrl+G', icon: 'arrowRight', action: () => goToLineDialog() },
    { sep: true },
    { label: 'Toggle preview split view', keys: 'Alt+P', icon: 'preview', disabled: true, action: () => {} },
    { label: 'Preview text changes (diff)', keys: 'Alt+D', icon: 'code', disabled: !hasDoc, action: () => toggleDiffView() },
    { label: 'Word wrap', keys: 'Alt+Z', icon: 'wordWrap', checked: S.settings.wordWrap, action: () => patchSettings({ wordWrap: !S.settings.wordWrap }) },
    { label: 'Show line numbers', icon: 'code', checked: S.settings.lineNumbers, action: () => patchSettings({ lineNumbers: !S.settings.lineNumbers }) },
    { sep: true },
    { label: 'Close tab', keys: 'Ctrl+W', disabled: !hasDoc, action: () => closeTab(S.activeId) },
    { label: 'Close window', keys: 'Ctrl+Shift+W', action: () => requestWindowClose() },
    { label: 'Exit', keys: 'Alt+F4', action: () => requestWindowClose() },
    { sep: true },
    { label: 'Settings', keys: 'Ctrl+,', icon: 'settings', action: () => toggleSettings(true) },
    { label: 'About', icon: 'info', action: () => showAboutDialog() },
  ];
}

function showEditorContextMenu(e) {
  const doc = activeDoc();
  if (!doc) return;
  const { start, end } = S.editor.selectionRange;
  const selected = end > start;
  const selectedText = selected ? doc.text.slice(start, end) : '';
  const word = selected ? selectedText : wordAt(S.editor.el.buffer.selectionStart);
  openFlyout(
    [
      { label: 'Cut', keys: 'Ctrl+X', icon: 'cut', disabled: !selected, action: () => document.execCommand('cut') },
      { label: 'Copy', keys: 'Ctrl+C', icon: 'copy', disabled: !selected, action: () => document.execCommand('copy') },
      { label: 'Paste', keys: 'Ctrl+V', icon: 'paste', action: () => document.execCommand('paste') },
      { label: 'Undo', keys: 'Ctrl+Z', icon: 'undo', action: () => S.editor.undo() },
      { label: 'Redo', keys: 'Ctrl+Shift+Z', icon: 'redo', action: () => S.editor.redo() },
      { label: 'Select all', keys: 'Ctrl+A', icon: 'selectAll', action: () => S.editor.selectAll() },
      { sep: true },
      { label: 'Right-to-Left reading order', action: () => toggleRtl() },
      { label: 'Word wrap', keys: 'Alt+Z', checked: S.settings.wordWrap, action: () => patchSettings({ wordWrap: !S.settings.wordWrap }) },
      { label: 'Search in web', keys: 'Ctrl+E', icon: 'globe', disabled: !word, action: () => api.webSearch(word || '') },
      { label: 'Go to line…', keys: 'Ctrl+G', action: () => goToLineDialog() },
      { sep: true },
      { label: 'Preview text changes (diff)', keys: 'Alt+D', icon: 'code', action: () => toggleDiffView() },
      { label: 'Revert all changes', icon: 'undo', disabled: !doc.modified, action: () => revertDoc(doc) },
      { label: 'Reload file from disk', icon: 'refresh', disabled: !doc.path, action: () => reloadDoc(doc) },
      { sep: true },
      {
        label: selected ? 'Share selected' : 'Copy full path',
        icon: 'share',
        disabled: !selected && !doc.path,
        action: async () => {
          await navigator.clipboard?.writeText(selected ? selectedText : doc.path);
          toast({ title: selected ? 'Selection copied' : 'Path copied' });
        },
      },
      { label: 'Open containing folder', icon: 'folder', disabled: !doc.path, action: () => doc.path && api.openInFileManager(doc.path) },
    ],
    e.clientX,
    e.clientY,
  ).style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;
}

function showTabContextMenu(e, doc) {
  const idx = S.tabs.findIndex((t) => t.id === doc.id);
  openFlyout(
    [
      { label: 'Close', keys: 'Ctrl+W', icon: 'close', action: () => closeTab(doc.id) },
      { label: 'Close others', disabled: S.tabs.length < 2, action: () => closeOthers(doc.id) },
      { label: 'Close to the right', disabled: idx >= S.tabs.length - 1, action: () => closeRight(doc.id) },
      { label: 'Close saved', disabled: S.tabs.every((t) => t.modified), action: closeSaved },
      { sep: true },
      {
        label: 'Copy full path',
        icon: 'link',
        disabled: !doc.path,
        action: async () => {
          await navigator.clipboard?.writeText(doc.path || '');
          toast({ title: 'Path copied' });
        },
      },
      { label: 'Open containing folder', icon: 'folder', disabled: !doc.path, action: () => doc.path && api.openInFileManager(doc.path) },
      { label: 'Rename…', keys: 'F2', icon: 'pencil', disabled: !doc.path, action: () => renameDialog(doc) },
    ],
    e.clientX,
    e.clientY,
  ).style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;
}

function wordAt(pos) {
  const text = activeDoc()?.text || '';
  const isWord = (c) => !!c && /[\w\u00C0-\u024F'’-]/.test(c);
  let s = pos;
  let e = pos;
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  return text.slice(s, e).trim();
}

function toggleRtl() {
  const b = S.editor.el.buffer;
  const rtl = b.dir === 'rtl';
  b.dir = rtl ? 'ltr' : 'rtl';
  S.editor.el.backdropInner.dir = rtl ? 'ltr' : 'rtl';
  toast({ title: rtl ? 'Left-to-right' : 'Right-to-left', text: 'Text flow direction changed' });
}

/* ---------------------------------------------------------- settings pane */

const SETTINGS_SECTIONS = [
  { id: 'personalization', icon: 'lab', label: 'Personalization' },
  { id: 'textEditor', icon: 'textFont', label: 'Text editor' },
  { id: 'advanced', icon: 'code', label: 'Advanced' },
  { id: 'about', icon: 'info', label: 'About' },
];

function toggleSettings(open) {
  S.settingsOpen = open ?? !S.settingsOpen;
  $('#settings').classList.toggle('hidden', !S.settingsOpen);
  if (S.settingsOpen) {
    renderSettingsPane();
    closeFlyouts();
  } else {
    S.editor.focus();
  }
}

function field(label, control, hint) {
  return h(
    'div',
    { class: 'field' },
    h('label', { text: label }),
    control,
    hint ? h('span', { class: 'hint', style: 'margin:0', text: hint }) : null,
  );
}

function radio(label, name, value, checked, onChange) {
  const input = h('input', { type: 'radio', name, checked, onchange: (e) => e.target.checked && onChange(value) });
  return h('label', { class: 'radio-row' }, input, h('span', { text: label }));
}

function toggleSwitch(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return h('span', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'knob' }));
}

function renderSettingsPane() {
  const pane = $('#settings');
  pane.textContent = '';
  const rail = h('nav', { class: 'settings-rail', 'aria-label': 'Settings sections' });
  for (const s of SETTINGS_SECTIONS) {
    rail.append(
      h(
        'button',
        {
          class: `rail-btn${S.settingsSection === s.id ? ' active' : ''}`,
          title: s.label,
          'aria-label': s.label,
          onclick: () => {
            S.settingsSection = s.id;
            renderSettingsPane();
          },
        },
        iconNode(s.icon, 18),
      ),
    );
  }
  const body = h('div', { class: 'settings-body' });
  const sec = S.settingsSection;
  body.append(
    sec === 'personalization'
      ? personalizationSection()
      : sec === 'textEditor'
        ? textEditorSection()
        : sec === 'advanced'
          ? advancedSection()
          : aboutSection(),
  );
  pane.append(body, rail);
}

function personalizationSection() {
  const frag = document.createDocumentFragment();
  frag.append(h('h1', { class: 'settings-title', text: 'Personalization' }));

  const theme = h('div', { class: 'settings-section' }, h('h3', { text: 'Theme Mode' }));
  theme.append(
    radio('Light', 'theme', 'light', S.settings.theme === 'light', (v) => patchSettings({ theme: v })),
    radio('Dark', 'theme', 'dark', S.settings.theme === 'dark', (v) => patchSettings({ theme: v })),
    radio(
      'Use my system mode',
      'theme',
      'system',
      S.settings.theme === 'system',
      (v) => patchSettings({ theme: v }),
    ),
  );
  frag.append(theme);

  const tint = h('div', { class: 'settings-section' }, h('h3', { text: 'Background Tint Opacity' }));
  const range = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(S.settings.tintOpacity),
    oninput: (e) => {
      S.settings.tintOpacity = Number(e.target.value);
      tint.querySelector('.tint-value').textContent = `${e.target.value}%`;
      document.documentElement.style.setProperty('--tint-opacity', String(S.settings.tintOpacity / 100));
      persistSettings();
    },
  });
  tint.append(
    h('div', { class: 'field' }, range, h('span', { class: 'tint-value', text: `${S.settings.tintOpacity}%` })),
    h('div', { class: 'hint', text: 'Acrylic background tint opacity. On Linux the acrylic effect requires a compositor with RGBA support (KDE, GNOME on Wayland, most tiling WMs); enable window transparency below.' }),
    field(
      'Transparent window',
      toggleSwitch(S.settings.transparentWindow, (v) => {
        patchSettings({ transparentWindow: v });
        toast({ title: 'Restart Notepads', text: 'Window transparency is applied when a window is created.' });
      }),
      'Requires restart',
    ),
  );
  frag.append(tint);

  const accent = h('div', { class: 'settings-section' }, h('h3', { text: 'Accent Color' }));
  accent.append(
    field(
      'Use my system accent color',
      toggleSwitch(S.settings.useSystemAccent, (v) => {
        patchSettings({ useSystemAccent: v });
      }),
      'Reads the GTK/portal accent where available',
    ),
  );
  const swatches = h('div', { class: 'swatch-grid' });
  for (const c of ['#0078d4', '#038387', '#00b294', '#c30052', '#b15782', '#ff8c00', '#8e8cd8', '#2d7d9a', '#6b8e23', '#a4373a']) {
    swatches.append(
      h('button', {
        class: `swatch${S.settings.accent.toLowerCase() === c ? ' selected' : ''}`,
        style: `background:${c}`,
        title: c,
        'aria-label': `Accent ${c}`,
        onclick: () => patchSettings({ accent: c, useSystemAccent: false }),
      }),
    );
  }
  const preview = h('span', { class: 'accent-preview', style: `background:${S.settings.accent}` });
  const picker = h('input', {
    type: 'color',
    value: S.settings.accent,
    oninput: (e) => {
      preview.style.background = e.target.value;
      hex.value = e.target.value.toUpperCase();
      patchSettings({ accent: e.target.value, useSystemAccent: false }, { rerenderSettings: false });
    },
  });
  const hex = h('input', {
    type: 'text',
    value: S.settings.accent.toUpperCase(),
    style: 'width:110px;min-width:0',
    onchange: (e) => {
      const v = e.target.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(v)) {
        const val = v.startsWith('#') ? v : `#${v}`;
        patchSettings({ accent: val, useSystemAccent: false });
      } else renderSettingsPane();
    },
  });
  accent.append(swatches, h('div', { class: 'accent-foot' }, picker, hex, preview));
  frag.append(accent);
  return frag;
}

function textEditorSection() {
  const frag = document.createDocumentFragment();
  frag.append(h('h1', { class: 'settings-title', text: 'Text editor' }));

  const font = h('div', { class: 'settings-section' }, h('h3', { text: 'Font' }));
  const familySelect = h(
    'select',
    {
      onchange: (e) => patchSettings({ fontFamily: e.target.value }),
    },
    h('option', { value: 'mono', selected: S.settings.fontFamily === 'mono', text: 'Monospace (editor default)' }),
    h('option', { value: 'serif', selected: S.settings.fontFamily === 'serif', text: 'Serif' }),
    h('option', { value: 'ui', selected: S.settings.fontFamily === 'ui', text: 'System UI font' }),
  );
  font.append(
    field('Font family', familySelect),
    field(
      'Font size',
      h('input', {
        type: 'number',
        min: '8',
        max: '60',
        value: String(S.settings.fontSize),
        oninput: (e) => patchSettings({ fontSize: Number(e.target.value) }, { rerenderSettings: false }),
      }),
      'px',
    ),
    field(
      'Line spacing',
      h('select', { onchange: (e) => patchSettings({ lineHeight: Number(e.target.value) }) },
        ...[1.2, 1.35, 1.5, 1.6, 1.8].map((v) =>
          h('option', { value: String(v), selected: S.settings.lineHeight === v, text: `${v} (${Math.round(v * 100)}%)` }),
        ),
      ),
    ),
    field(
      'Tab width',
      h('input', {
        type: 'number',
        min: '1',
        max: '16',
        value: String(S.settings.tabSize),
        oninput: (e) => patchSettings({ tabSize: Number(e.target.value) }, { rerenderSettings: false }),
      }),
    ),
  );
  frag.append(font);

  const display = h('div', { class: 'settings-section' }, h('h3', { text: 'Display' }));
  display.append(
    field('Line numbers', toggleSwitch(S.settings.lineNumbers, (v) => patchSettings({ lineNumbers: v }))),
    field('Word wrap', toggleSwitch(S.settings.wordWrap, (v) => patchSettings({ wordWrap: v })), 'Alt+Z'),
    field(
      'Highlight current line',
      toggleSwitch(S.settings.highlightCurrentLine, (v) => patchSettings({ highlightCurrentLine: v })),
    ),
    field('Show status bar', toggleSwitch(S.settings.showStatusBar, (v) => patchSettings({ showStatusBar: v }))),
  );
  frag.append(display);

  const files = h('div', { class: 'settings-section' }, h('h3', { text: 'Files' }));
  const encSelect = h(
    'select',
    { onchange: (e) => patchSettings({ defaultEncoding: e.target.value }) },
    h('option', { value: 'auto', selected: S.settings.defaultEncoding === 'auto', text: 'Auto guess encoding' }),
    ...S.encodings.map((e) => h('option', { value: e.label, selected: S.settings.defaultEncoding === e.label, text: e.name })),
  );
  files.append(
    field('Default encoding for new files', encSelect),
    field(
      'Default line endings',
      h('select', { onchange: (e) => patchSettings({ defaultLineEnding: e.target.value }) },
        ...[['auto', 'Keep as typed'], ['CRLF', 'Windows (CRLF)'], ['LF', 'Unix (LF)'], ['CR', 'Macintosh (CR)']].map(
          ([v, label]) => h('option', { value: v, selected: S.settings.defaultLineEnding === v, text: label }),
        ),
      ),
    ),
    field(
      'Session snapshot',
      toggleSwitch(S.settings.restoreSessionOnStartup, (v) => patchSettings({ restoreSessionOnStartup: v })),
      'Reopen the tabs you had when Notepads last closed',
    ),
  );
  frag.append(files);
  return frag;
}

function advancedSection() {
  const frag = document.createDocumentFragment();
  frag.append(h('h1', { class: 'settings-title', text: 'Advanced' }));
  const s = h('div', { class: 'settings-section' }, h('h3', { text: 'Application' }));
  s.append(
    field('Single instance', h('span', { text: 'Enabled' }), 'A second launch opens the file in the running window'),
    field('Command line', h('code', { class: 'kbd', text: 'notepads file.txt' }), 'Like the original winget/CLI entry point'),
    field(
      'Config folder',
      h('code', { class: 'kbd', text: S.info.configDir || '—', style: 'max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
      'settings.json and session.json live here',
    ),
    field(
      'Clear session snapshot',
      h('button', {
        class: 'btn',
        text: 'Clear',
        onclick: async () => {
          await api.clearSession();
          toast({ title: 'Session cleared', text: 'The next start will open a single empty tab.' });
        },
      }),
    ),
  );
  frag.append(s);

  const g = h('div', { class: 'settings-section' }, h('h3', { text: 'Input' }));
  g.append(
    field('Tab key inserts', h('span', { text: `${S.settings.tabSize} spaces wide tab character` })),
    field('Drag & drop', h('span', { text: 'Drop files anywhere in the window to open them' })),
    field('Middle click a tab', h('span', { text: 'Closes it' })),
  );
  frag.append(g);
  return frag;
}

function aboutSection() {
  const frag = document.createDocumentFragment();
  frag.append(h('h1', { class: 'settings-title', text: 'About' }));
  const card = h('div', { class: 'about-card' });
  card.append(
    h('h4', { text: 'Notepads for Linux' }),
    h('p', {
      text:
        'A modern, lightweight text editor with a minimalist design, rebuilt for GNU/Linux from the behaviour and design language of the Windows Notepads app.',
    }),
    h(
      'dl',
      {},
      h('dt', { text: 'Version' }),
      h('dd', { text: S.info.version }),
      h('dt', { text: 'Backend' }),
      h('dd', { text: isTauri ? 'Tauri 2 (Rust + WebKitGTK)' : 'Web demo build (no filesystem access)' }),
      h('dt', { text: 'License' }),
      h('dd', { text: 'MIT' }),
      h('dt', { text: 'Inspired by' }),
      h('dd', {}, h('span', { text: 'Notepads by Jackie (Jiaqi) Liu — ' })),
    ),
  );
  const link = h('button', {
    class: 'btn',
    text: 'Open the original project',
    onclick: () => api.openUrl('https://github.com/0x7c13/Notepads'),
  });
  const docs = h('button', {
    class: 'btn',
    text: 'Reverse engineering notes',
    onclick: () => api.openUrl('https://github.com/0x7c13/Notepads#readme'),
  });
  card.append(h('div', { style: 'display:flex;gap:8px;margin-top:4px' }, link, docs));
  frag.append(card);

  const keys = h('div', { class: 'settings-section' }, h('h3', { text: 'Keyboard shortcuts' }));
  const list = [
    ['Ctrl+N / Ctrl+T', 'New tab'],
    ['Ctrl+Shift+N', 'New window'],
    ['Ctrl+O', 'Open file'],
    ['Ctrl+S / Ctrl+Shift+S', 'Save / Save as'],
    ['Ctrl+Alt+S', 'Save all'],
    ['Ctrl+W', 'Close tab'],
    ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
    ['Ctrl+1…9', 'Go to tab N'],
    ['Ctrl+F / Ctrl+H', 'Find / Replace'],
    ['F3 / Shift+F3', 'Find next / previous'],
    ['Ctrl+G', 'Go to line'],
    ['Ctrl++ / Ctrl+- / Ctrl+0', 'Zoom in / out / reset'],
    ['Alt+Z', 'Toggle word wrap'],
    ['Alt+D', 'Toggle diff viewer'],
    ['Ctrl+E', 'Search selection in the web'],
    ['Ctrl+,', 'Settings'],
  ];
  const grid = h('div', { style: 'display:grid;grid-template-columns:230px 1fr;gap:6px 16px;max-width:620px' });
  for (const [k, v] of list) {
    grid.append(h('div', {}, h('span', { class: 'kbd', text: k })), h('div', { style: 'color:var(--fg-dim)', text: v }));
  }
  keys.append(grid);
  frag.append(keys);
  return frag;
}

/* ----------------------------------------------------------------- dialogs */

function dialog({ title, message, details, list, buttons, width }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
    if (width) box.style.width = `${width}px`;
    box.append(h('div', { class: 'dialog-head', text: title }));
    const body = h('div', { class: 'dialog-body' });
    if (message) body.append(h('div', { text: message }));
    if (details) body.append(h('div', { class: 'detail', text: details }));
    if (list?.length) {
      const ul = h('ul', { class: 'dialog-list' });
      for (const item of list) ul.append(h('li', { text: item }));
      body.append(ul);
    }
    box.append(body);
    const foot = h('div', { class: 'dialog-foot' });
    const done = (value) => {
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    for (const b of buttons) {
      foot.append(
        h('button', {
          class: `btn${b.primary ? ' primary' : ''}`,
          text: b.label,
          onclick: () => done(b.value),
        }),
      );
    }
    box.append(foot);
    scrim.append(box);
    document.body.append(scrim);
    const focusTarget = foot.querySelector('.btn.primary') || foot.querySelector('.btn');
    focusTarget?.focus();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(buttons.find((b) => b.cancel)?.value ?? 'cancel');
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const primary = foot.querySelector('.btn.primary');
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          done(buttons.find((b) => b.primary)?.value ?? 'ok');
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
  });
}

function promptDialog({ title, message, label, value = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    const input = h('input', { type: 'text', value, style: 'width:100%;margin-top:12px' });
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
    box.append(
      h('div', { class: 'dialog-head', text: title }),
      h('div', { class: 'dialog-body' }, h('div', { text: message }), label ? h('div', { class: 'detail', text: label }) : null, input),
    );
    const done = (v) => {
      scrim.remove();
      resolve(v);
    };
    box.append(
      h(
        'div',
        { class: 'dialog-foot' },
        h('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }),
        h('button', { class: 'btn primary', text: okLabel, onclick: () => done(input.value) }),
      ),
    );
    scrim.append(box);
    document.body.append(scrim);
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
  });
}

function toast({ title, text, kind = 'info', timeout = 3400 }) {
  const host = $('#toast-host');
  const node = h(
    'div',
    { class: `toast${kind === 'warn' ? ' warn' : ''}` },
    h('div', { class: 'toast-title', text: title }),
    text ? h('div', { class: 'toast-text', text }) : null,
  );
  host.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 200);
  }, timeout);
  return node;
}

async function showAboutDialog() {
  await dialog({
    title: 'About Notepads for Linux',
    message: `Version ${S.info.version} — MIT licensed.`,
    details:
      'An independent, from-scratch Linux remake of the Windows Notepads app by Jackie (Jiaqi) Liu. ' +
      'No code from the original is included; its public documentation, string resources and screenshots were used as the specification.',
    buttons: [{ label: 'Close', value: 'close', primary: true, cancel: true }],
  });
}

async function goToLineDialog() {
  const value = await promptDialog({
    title: 'Go to line',
    message: `Enter a line number between 1 and ${S.editor.lineCount}.`,
    value: String(S.editor.cursorInfo().line),
    okLabel: 'Go',
  });
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1) S.editor.goToLine(n);
}

/* ------------------------------------------------------------ file commands */

async function newTab({ content = '', name, path = null, encoding, lineEnding } = {}) {
  const untitled = S.tabs.filter((t) => !t.path).length + 1;
  const doc = newDoc({
    content,
    name: name || (untitled > 1 ? `Untitled ${untitled}.txt` : 'Untitled.txt'),
    path,
    text: content,
    encoding: encoding || (S.settings.defaultEncoding === 'auto' ? 'UTF-8' : S.settings.defaultEncoding),
    lineEnding: lineEnding || (S.settings.defaultLineEnding === 'auto' ? 'LF' : S.settings.defaultLineEnding),
  });
  addTab(doc);
  S.editor.focus();
  return doc;
}

async function openFileDialog() {
  const paths = await api.pickOpenFile({ multiple: true });
  for (const p of paths) await openPath(p);
}

async function openPath(path, { forceEncoding = null } = {}) {
  const existing = S.tabs.find((t) => t.path === path);
  if (existing) {
    activateTab(existing.id);
    return existing;
  }
  try {
    const res = await api.readTextFile(path, { forceEncoding, allowBinary: false });
    if (res.content == null) {
      const doc = newDoc({
        path: res.path,
        text: '',
        binary: true,
        encoding: 'BINARY',
        size: res.size,
        readonly: true,
        lineEnding: 'LF',
      });
      addTab(doc);
      showBinaryOverlay(doc);
      return doc;
    }
    const text = toLF(res.content);
    const doc = newDoc({
      path: res.path,
      text,
      diffBase: text,
      encoding: res.encoding,
      encodingGuessed: res.encodingGuessed,
      lineEnding: res.lineEnding,
      size: res.size,
      readonly: res.readonly,
      diskModifiedMs: Date.now(),
    });
    addTab(doc);
    if (res.encodingGuessed) {
      toast({
        title: 'Encoding cannot be determined',
        text: `${basename(path)} was opened as ${res.encoding}. Use the status bar to reopen it with another encoding.`,
        kind: 'warn',
      });
    }
    if (res.largeFile) {
      toast({ title: 'Large file', text: 'Editing very large files may reduce responsiveness.' });
    }
    pushRecent(res.path);
    S.lastDir = dirname(res.path);
    return doc;
  } catch (e) {
    await dialog({
      title: 'Cannot open file',
      message: `${basename(path)} could not be opened.`,
      details: String(e?.message || e),
      buttons: [{ label: 'Close', value: 'close', primary: true, cancel: true }],
    });
    return null;
  }
}

async function saveDoc(doc, { saveAs = false, force = false } = {}) {
  if (!doc) return false;
  if (!doc.path || saveAs) {
    const picked = await api.pickSavePath(doc.path ? basename(doc.path) : doc.name);
    if (picked.cancelled || !picked.path) return false;
    doc.path = picked.path;
    doc.name = basename(picked.path);
  }
  try {
    const res = await api.saveTextFile(doc.path, doc.text, {
      encoding: doc.encoding === 'BINARY' ? 'UTF-8' : doc.encoding,
      lineEnding: doc.lineEnding,
      expectedModifiedMs: force ? null : doc.diskModifiedMs || null,
      force,
    });
    doc.modified = false;
    doc.size = res.size ?? doc.size;
    doc.diskModifiedMs = res.modifiedMs ?? Date.now();
    doc.diffBase = doc.text;
    if (S.tabs.find((t) => t.id === S.activeId)?.id === doc.id) {
      S.editor.save(doc);
    }
    renderTabs();
    updateStatusBar();
    updateWindowTitle();
    pushRecent(doc.path);
    scheduleSessionSave();
    if (res.downloaded) toast({ title: 'Downloaded', text: `${doc.name} was downloaded by the browser.` });
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('CONFLICT')) {
      const answer = await dialog({
        title: 'File modified outside of Notepads',
        message: `${basename(doc.path)} has changed on disk since you opened it.`,
        details: 'Overwriting will discard the version that is on disk right now.',
        buttons: [
          { label: 'Overwrite', value: 'overwrite', primary: true },
          { label: 'Reload from disk', value: 'reload' },
          { label: 'Cancel', value: 'cancel', cancel: true },
        ],
      });
      if (answer === 'overwrite') return saveDoc(doc, { saveAs: false, force: true });
      if (answer === 'reload') return reloadDoc(doc);
      return false;
    }
    await dialog({
      title: 'Cannot save file',
      message: `${doc.name} could not be saved.`,
      details: msg,
      buttons: [{ label: 'Close', value: 'close', primary: true, cancel: true }],
    });
    return false;
  }
}

async function saveAll() {
  for (const doc of S.tabs) {
    if (doc.modified) {
      const ok = await saveDoc(doc);
      if (!ok) return false;
    }
  }
  toast({ title: 'All files saved' });
  return true;
}

async function revertDoc(doc) {
  if (!doc?.modified) return;
  const answer = await dialog({
    title: 'Revert all changes?',
    message: `Unsaved changes in ${doc.name} will be lost.`,
    buttons: [
      { label: 'Revert', value: 'yes', primary: true },
      { label: 'Cancel', value: 'no', cancel: true },
    ],
  });
  if (answer !== 'yes') return;
  if (doc.path) {
    await reloadDoc(doc, { silent: true });
  } else {
    doc.text = doc.diffBase || '';
    doc.undo = [];
    doc.redo = [];
    doc.modified = false;
    if (S.activeId === doc.id) S.editor.load(doc);
    renderTabs();
    updateStatusBar();
  }
  toast({ title: 'Changes reverted' });
}

async function reloadDoc(doc, { silent = false } = {}) {
  if (!doc?.path) return false;
  try {
    const res = await api.readTextFile(doc.path, { forceEncoding: doc.encodingGuessed ? null : doc.encoding });
    if (res.content == null) return false;
    const text = toLF(res.content);
    doc.text = text;
    doc.diffBase = text;
    doc.modified = false;
    doc.encoding = res.encoding;
    doc.lineEnding = res.lineEnding;
    doc.diskModifiedMs = Date.now();
    if (S.activeId === doc.id) S.editor.load(doc);
    renderTabs();
    updateStatusBar();
    scheduleSessionSave();
    if (!silent) toast({ title: 'Reloaded', text: `${doc.name} was reloaded from disk.` });
    return true;
  } catch (e) {
    if (!silent) {
      await dialog({
        title: 'Cannot reload file',
        message: `${doc.name} could not be reloaded.`,
        details: String(e?.message || e),
        buttons: [{ label: 'Close', value: 'close', primary: true, cancel: true }],
      });
    }
    return false;
  }
}

async function renameDialog(doc) {
  if (!doc?.path) return;
  const current = basename(doc.path);
  const value = await promptDialog({
    title: 'Rename file',
    message: 'Enter a new name for this file (this renames it on disk).',
    label: current,
    value: current,
    okLabel: 'Rename',
  });
  if (!value || value === current) return;
  const target = `${dirname(doc.path)}/${value}`;
  try {
    await api.renameFile(doc.path, target);
    doc.path = target;
    doc.name = basename(target);
    renderTabs();
    updateStatusBar();
    updateWindowTitle();
    scheduleSessionSave();
    toast({ title: 'Renamed', text: doc.name });
  } catch (e) {
    await dialog({
      title: 'Cannot rename file',
      message: `Could not rename ${current}.`,
      details: String(e?.message || e),
      buttons: [{ label: 'Close', value: 'close', primary: true, cancel: true }],
    });
  }
}

function closeOthers(id) {
  for (const doc of [...S.tabs]) {
    if (doc.id !== id) closeTab(doc.id, { focus: false });
  }
  activateTab(id);
}

function closeRight(id) {
  const idx = S.tabs.findIndex((t) => t.id === id);
  for (const doc of S.tabs.slice(idx + 1)) closeTab(doc.id, { focus: false });
  activateTab(id);
}

function closeSaved() {
  for (const doc of [...S.tabs]) {
    if (!doc.modified) closeTab(doc.id, { focus: false });
  }
}

async function closeTab(id, { force = false, focus = true } = {}) {
  const idx = S.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return true;
  const doc = S.tabs[idx];
  if (doc.modified && !force) {
    const answer = await dialog({
      title: 'Save your changes?',
      message: `Do you want to save the changes you made to ${doc.name}?`,
      details: 'Your changes will be lost if you don\u2019t save them.',
      buttons: [
        { label: 'Save', value: 'save', primary: true },
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
    });
    if (answer === 'cancel') return false;
    if (answer === 'save') {
      const ok = await saveDoc(doc);
      if (!ok) return false;
    }
  }
  const active = S.activeId === id;
  S.tabs.splice(idx, 1);
  if (S.tabs.length === 0) {
    newTab();
  } else if (active && focus) {
    const next = S.tabs[Math.min(idx, S.tabs.length - 1)];
    S.activeId = next.id;
    S.editor.load(next);
    S.editor.setReadonly(next.readonly || next.binary);
  }
  renderTabs();
  updateStatusBar();
  updateWindowTitle();
  scheduleSessionSave();
  return true;
}

/* ------------------------------------------------------------------ diff UI */

function toggleDiffView() {
  const doc = activeDoc();
  if (!doc) return;
  if (S.diffOpen) return closeDiffView();
  const rows = diffLines(doc.diffBase ?? '', doc.text);
  const stats = diffStats(rows);

  const left = h('div', { class: 'col' }, h('h4', { text: 'Saved version' }));
  const right = h('div', { class: 'col' }, h('h4', { text: 'Unsaved changes' }));
  for (const r of rows) {
    left.append(
      h(
        'div',
        { class: `diff-line ${r.type === 'del' ? 'del' : r.left == null ? 'pad' : ''}` },
        h('span', { class: 'num', text: r.leftNo ? String(r.leftNo) : '' }),
        r.left ?? '',
      ),
    );
    right.append(
      h(
        'div',
        { class: `diff-line ${r.type === 'add' ? 'add' : r.right == null ? 'pad' : ''}` },
        h('span', { class: 'num', text: r.rightNo ? String(r.rightNo) : '' }),
        r.right ?? '',
      ),
    );
  }
  const view = h(
    'div',
    { class: 'diff-view' },
    h(
      'header',
      {},
      iconNode('code', 14),
      h('span', { text: `${stats.added} added · ${stats.removed} removed · ${stats.rows} rows` }),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'icon-btn', title: 'Close diff view (Alt+D)', onclick: () => closeDiffView() }, iconNode('close', 14)),
    ),
    h('div', { class: 'cols' }, left, right),
  );
  $('#workspace').append(view);
  S.diffOpen = true;
}

function closeDiffView() {
  $('.diff-view')?.remove();
  S.diffOpen = false;
  S.editor.focus();
}

/* --------------------------------------------------------------- overlays */

function showBinaryOverlay(doc) {
  hideBinaryOverlay();
  const overlay = h(
    'div',
    { class: 'binary-overlay' },
    h(
      'div',
      { class: 'inner' },
      h('h2', { text: 'Binary file' }),
      h('p', {
        text: `${doc.name} does not look like a text file and was not loaded into the editor. This protects the file from being corrupted by a text editor.`,
      }),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn',
          text: 'Open anyway (read only)',
          onclick: async () => {
            doc.binary = false;
            doc.readonly = true;
            await reloadDoc(doc);
            S.editor.setReadonly(true);
            hideBinaryOverlay();
          },
        }),
        h('button', {
          class: 'btn primary',
          text: 'Close tab',
          onclick: () => {
            hideBinaryOverlay();
            closeTab(doc.id, { force: true });
          },
        }),
      ),
    ),
  );
  $('#editor').append(overlay);
}

function hideBinaryOverlay() {
  $('.binary-overlay')?.remove();
}

/* ----------------------------------------------------------------- window */

async function requestWindowClose() {
  const dirty = S.tabs.filter((t) => t.modified);
  if (dirty.length) {
    const answer = await dialog({
      title: 'Save your changes?',
      message: 'These files have unsaved changes:',
      list: dirty.map((d) => d.name),
      buttons: [
        { label: 'Save all', value: 'save', primary: true },
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel', cancel: true },
      ],
    });
    if (answer === 'cancel') return;
    if (answer === 'save' && !(await saveAll())) return;
  }
  await clearSessionEntry();
  await api.confirmClose();
}

async function clearSessionEntry() {
  try {
    const existing = JSON.parse((await api.readSession()) || '{}');
    const windows = Array.isArray(existing.windows)
      ? existing.windows.filter((w) => w.label !== api.label)
      : [];
    await api.writeSession(JSON.stringify({ ...existing, windows }, null, 2));
  } catch {
    /* nothing we can do, and nothing critical */
  }
}

/* -------------------------------------------------------------- session */

let sessionTimer = null;
function scheduleSessionSave() {
  if (!S.settings.restoreSessionOnStartup) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 900);
}

async function saveSession() {
  if (!S.settings.restoreSessionOnStartup) return;
  const active = activeDoc();
  if (active) S.editor.save(active);
  const entry = {
    label: api.label,
    files: S.tabs.map((t) => ({
      path: t.path,
      encoding: t.encoding,
      lineEnding: t.lineEnding,
      name: t.name,
      text: t.path ? undefined : t.text.slice(0, 200000),
      isActive: t.id === S.activeId,
      cursor: { line: 1, col: 1 },
    })),
    maximized: false,
    savedAt: nowStamp(),
  };
  try {
    const existing = JSON.parse((await api.readSession()) || '{}');
    const list = Array.isArray(existing.windows) ? existing.windows.filter((w) => w.label !== api.label) : [];
    list.push(entry);
    await api.writeSession(JSON.stringify({ windows: list }, null, 2));
  } catch {
    /* ignore */
  }
}

async function restoreSession() {
  if (!isTauri) {
    // Browser demo: keep the tabs of the previous visit in localStorage.
    try {
      const raw = JSON.parse(storage.getItem('notepads.restore') || 'null');
      if (raw?.files?.length) {
        for (const f of raw.files) {
          await newTab({ name: f.name, content: f.text || '' });
        }
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
  return false;
}

/* -------------------------------------------------------------- shortcuts */

function tabByIndex(n) {
  return S.tabs[n - 1];
}

function handleShortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (e.key === 'Escape') {
    if (S.flyouts.length) {
      closeFlyouts();
      return true;
    }
    if (S.diffOpen) {
      closeDiffView();
      return true;
    }
    if (!$('#find-card').classList.contains('hidden')) {
      closeFind();
      return true;
    }
    if (S.settingsOpen) {
      toggleSettings(false);
      return true;
    }
    return false;
  }

  if (mod && e.shiftKey && lower === 'n') return void (api.newWindow(), true);
  if (mod && !e.shiftKey && (lower === 'n' || lower === 't')) return void (newTab(), true);
  if (mod && lower === 'o') return void (openFileDialog(), true);
  if (mod && e.shiftKey && lower === 's') return void (saveDoc(activeDoc(), { saveAs: true }), true);
  if (mod && e.altKey && lower === 's') return void (saveAll(), true);
  if (mod && !e.shiftKey && lower === 's') return void (saveDoc(activeDoc()), true);
  if (mod && lower === 'w') return void (closeTab(S.activeId), true);
  if (mod && e.shiftKey && lower === 'w') return void (requestWindowClose(), true);
  if (mod && lower === 'f') return void (openFind(), true);
  if (mod && lower === 'h') return void (openFind({ replace: true }), true);
  if (mod && lower === 'g') return void (goToLineDialog(), true);
  if (mod && lower === ',') return void (toggleSettings(), true);
  if (mod && lower === 'e') {
    const { start, end } = S.editor.selectionRange;
    const doc = activeDoc();
    const q = end > start ? doc.text.slice(start, end) : wordAt(start);
    if (q) return void (api.webSearch(q), true);
    return false;
  }
  if (mod && e.altKey && lower === 's') return void (saveAll(), true);
  if (mod && (key === '+' || key === '=' || key === 'Add')) return void zoomBy(1), true;
  if (mod && (key === '-' || key === 'Subtract')) return void zoomBy(-1), true;
  if (mod && key === '0') return void resetZoom(), true;
  if (mod && key === 'Tab') return void switchTab(e.shiftKey ? -1 : 1), true;
  if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(key)) {
    const doc = tabByIndex(Number(key));
    if (doc) activateTab(doc.id);
    return true;
  }
  if (e.altKey && lower === 'z') return void patchSettings({ wordWrap: !S.settings.wordWrap }), true;
  if (e.altKey && lower === 'd') return void toggleDiffView(), true;
  if (e.altKey && lower === 'p') {
    toast({ title: 'Not implemented yet', text: 'Markdown split preview is on the roadmap (see docs/FEATURES.md).' });
    return true;
  }
  if (e.key === 'F2' && activeDoc()?.path) return void renameDialog(activeDoc()), true;
  if (e.key === 'F3') {
    S.editor.findNext(e.shiftKey ? -1 : 1);
    runSearchStatusOnly();
    return true;
  }
  if (mod && lower === 'z' && !e.shiftKey) return void S.editor.undo(), true;
  if (mod && (lower === 'y' || (e.shiftKey && lower === 'z'))) return void S.editor.redo(), true;
  if (e.altKey && key === 'F4') return void requestWindowClose(), true;
  return false;
}

function runSearchStatusOnly() {
  const status = $('#find-status');
  const idx = S.editor.activeMatchIndex;
  const total = S.editor.matches.length;
  if (total) status.textContent = `${idx + 1}/${total}`;
  updateStatusBar();
}

function switchTab(dir) {
  if (S.tabs.length < 2) return;
  const idx = S.tabs.findIndex((t) => t.id === S.activeId);
  const next = (idx + dir + S.tabs.length) % S.tabs.length;
  activateTab(S.tabs[next].id);
}

function zoomBy(delta) {
  const size = S.editor.setZoom(delta);
  S.settings.fontSize = size;
  persistSettings();
  updateStatusBar();
}

function resetZoom() {
  S.settings.fontSize = S.editor.resetZoom();
  persistSettings();
  updateStatusBar();
}

/* ------------------------------------------------------------------ flyouts */

function eolFlyout(anchor) {
  openFlyout(
    [
      { header: 'Line endings' },
      ...['CRLF', 'LF', 'CR'].map((eol) => ({
        label: EOL_LABEL[eol],
        checked: activeDoc()?.lineEnding === eol,
        action: () => {
          const doc = activeDoc();
          doc.lineEnding = eol;
          updateStatusBar();
          scheduleSessionSave();
        },
      })),
    ],
    anchor,
    { align: 'end', below: false },
  );
}

async function encodingFlyout(anchor) {
  const doc = activeDoc();
  const items = [];
  items.push({ header: 'Encoding' });
  items.push({
    label: 'Auto guess encoding',
    icon: 'refresh',
    action: async () => {
      if (!doc.path) return;
      const res = await api.readTextFile(doc.path);
      doc.encoding = res.encoding;
      doc.encodingGuessed = res.encodingGuessed;
      doc.text = toLF(res.content ?? '');
      doc.lineEnding = res.lineEnding;
      doc.modified = false;
      doc.diffBase = doc.text;
      S.editor.load(doc);
      updateStatusBar();
      toast({ title: 'Encoding detected', text: `${doc.name} → ${doc.encoding}` });
    },
  });
  items.push({ sep: true });
  if (doc.path) {
    items.push({ header: 'Reopen with encoding' });
    for (const enc of S.encodings) {
      items.push({
        label: enc.name,
        checked: doc.encoding === enc.label,
        action: () => openPathWithEncoding(doc, enc.label),
      });
    }
    items.push({ sep: true });
  }
  items.push({ header: 'Save with encoding' });
  for (const enc of S.encodings) {
    items.push({
      label: enc.name,
      checked: doc.encoding === enc.label,
      action: () => {
        doc.encoding = enc.label;
        doc.encodingGuessed = false;
        updateStatusBar();
        toast({ title: 'Encoding set', text: `Next save of ${doc.name} uses ${enc.name}.` });
      },
    });
  }
  openFlyout(items, anchor, { align: 'end', below: false });
}

async function openPathWithEncoding(doc, label) {
  if (!doc.path) return;
  try {
    const res = await api.readTextFile(doc.path, { forceEncoding: label });
    doc.text = toLF(res.content ?? '');
    doc.encoding = label;
    doc.encodingGuessed = false;
    doc.lineEnding = res.lineEnding;
    doc.modified = false;
    doc.diffBase = doc.text;
    if (S.activeId === doc.id) S.editor.load(doc);
    renderTabs();
    updateStatusBar();
  } catch (e) {
    toast({ title: 'Cannot reopen file', text: String(e?.message || e), kind: 'warn' });
  }
}

function zoomFlyout(anchor) {
  openFlyout(
    [
      { label: 'Zoom in', keys: 'Ctrl++', icon: 'zoomIn', action: () => zoomBy(1) },
      { label: 'Zoom out', keys: 'Ctrl+-', icon: 'zoomOut', action: () => zoomBy(-1) },
      { label: 'Restore default zoom', keys: 'Ctrl+0', action: () => resetZoom() },
    ],
    anchor,
    { align: 'end', below: false },
  );
}

/* ------------------------------------------------------------------- chrome */

function setupChrome() {
  $('#menu-btn').append(iconNode('menu', 16));
  $('#new-tab-btn').append(iconNode('plus', 16));
  $('#win-min').append(iconNode('windowMin', 12));
  $('#win-max').append(iconNode('windowMax', 12));
  $('#win-close').append(iconNode('close', 12));
  $('#find-options-toggle').append(iconNode('ellipsis', 16));
  $('#find-prev').append(iconNode('arrowUp', 16));
  $('#find-next').append(iconNode('arrowDown', 16));
  $('#find-close').append(iconNode('close', 16));
  $('#replace-toggle').append(iconNode('chevronDown', 14));
  $('#replace-one').append(iconNode('replace', 16));
  $('#replace-all').append(iconNode('replaceAll', 16));

  $('#menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (S.flyouts.length) return closeFlyouts();
    $('#menu-btn').classList.add('open');
    openFlyout(mainMenuItems(), $('#menu-btn'));
  });

  $('#new-tab-btn').addEventListener('click', () => newTab());
  $('#win-min').addEventListener('click', () => api.windowAction('minimize'));
  $('#win-max').addEventListener('click', async () => {
    await api.windowAction('toggle-maximize');
    refreshMaximizeIcon();
  });
  $('#win-close').addEventListener('click', () => requestWindowClose());
  window.addEventListener('resize', () => refreshMaximizeIcon());
  refreshMaximizeIcon();

  // Double click on the empty chrome maximizes, like any GTK/Windows app.
  $('#titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab') || e.target.closest('button')) return;
    api.windowAction('toggle-maximize');
  });

  // Find card wiring
  $('#find-input').addEventListener('input', runSearch);
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      S.editor.findNext(e.shiftKey ? -1 : 1);
      runSearchStatusOnly();
    }
  });
  $('#find-next').addEventListener('click', () => {
    S.editor.findNext(1);
    runSearchStatusOnly();
  });
  $('#find-prev').addEventListener('click', () => {
    S.editor.findNext(-1);
    runSearchStatusOnly();
  });
  $('#find-close').addEventListener('click', closeFind);
  $('#find-options-toggle').addEventListener('click', () => {
    $('#find-options').classList.toggle('hidden');
  });
  $('#replace-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    openFlyout(
      [
        {
          label: 'Replace mode',
          checked: !$('#replace-row').classList.contains('hidden'),
          action: () => $('#replace-row').classList.remove('hidden'),
        },
        {
          label: 'Find only',
          checked: $('#replace-row').classList.contains('hidden'),
          action: () => $('#replace-row').classList.add('hidden'),
        },
      ],
      e.currentTarget,
    );
  });
  for (const chip of $('#find-options').querySelectorAll('[data-opt]')) {
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      chip.querySelector('.box').textContent = chip.classList.contains('on') ? '✓' : '';
      runSearch();
    });
  }
  $('#replace-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doReplace();
  });
  $('#replace-one').addEventListener('click', doReplace);
  $('#replace-all').addEventListener('click', () => {
    const replacement = $('#replace-input').value;
    const count = S.editor.replaceAll(replacement);
    runSearch();
    toast({ title: count ? `${count} replaced` : 'Nothing to replace' });
  });

  // Status bar flyouts
  $('#status-zoom').addEventListener('click', (e) => zoomFlyout(e.currentTarget));
  $('#status-eol').addEventListener('click', (e) => eolFlyout(e.currentTarget));
  $('#status-encoding').addEventListener('click', (e) => encodingFlyout(e.currentTarget));

  // Editor context menu + close flyouts on outside click
  $('#editor').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showEditorContextMenu(e);
  });
  document.addEventListener('mousedown', (e) => {
    if (S.flyouts.length && !e.target.closest('.flyout') && !e.target.closest('.menu-btn') && !e.target.closest('.status-item')) {
      closeFlyouts();
    }
  });
  window.addEventListener('resize', closeFlyouts);

  // Drag & drop files onto the window
  const hint = h('div', { class: 'drop-hint hidden', text: 'Drop files to open them' });
  $('#app').append(hint);
  let dragDepth = 0;
  $('#app').addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth++;
    hint.classList.remove('hidden');
  });
  $('#app').addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      hint.classList.add('hidden');
    }
  });
  $('#app').addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  $('#app').addEventListener('drop', async (e) => {
    hint.classList.add('hidden');
    dragDepth = 0;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      const path = await registerDroppedFile(f);
      if (!path) continue;
      if (isTauri || f.path) await openPath(f.path || path);
      else {
        const text = await f.text();
        await newTab({ name: f.name, content: toLF(text), path });
        const doc = activeDoc();
        doc.diffBase = doc.text;
      }
    }
  });

  // Tab strip drag & drop reordering
  $('#tabstrip').addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/notepads-tab')) return;
    e.preventDefault();
    const over = e.target.closest('.tab');
    for (const t of $('#tabstrip').querySelectorAll('.tab')) t.classList.remove('drop-before', 'drop-after');
    if (!over) return;
    const r = over.getBoundingClientRect();
    over.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  });
  $('#tabstrip').addEventListener('drop', (e) => {
    const id = Number(e.dataTransfer.getData('text/notepads-tab'));
    const over = e.target.closest('.tab');
    for (const t of $('#tabstrip').querySelectorAll('.tab')) t.classList.remove('drop-before', 'drop-after');
    if (!over) return;
    e.preventDefault();
    const from = S.tabs.findIndex((t) => t.id === id);
    const to = S.tabs.findIndex((t) => t.id === Number(over.dataset.id));
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = S.tabs.splice(from, 1);
    const r = over.getBoundingClientRect();
    const after = e.clientX >= r.left + r.width / 2;
    const insertAt = to + (after ? 1 : 0) - (from < to ? 1 : 0);
    S.tabs.splice(Math.max(0, Math.min(insertAt, S.tabs.length)), 0, moved);
    renderTabs();
    scheduleSessionSave();
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const inDialog = !!document.querySelector('.scrim');
    if (inDialog && !e.ctrlKey && !e.altKey) return;
    if (handleShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (S.settings.restoreSessionOnStartup) {
      const active = activeDoc();
      if (active) S.editor.save(active);
      try {
        storage.setItem(
          'notepads.restore',
          JSON.stringify({
            files: S.tabs.map((t) => ({ name: t.name, text: t.path ? '' : t.text.slice(0, 200000) })),
          }),
        );
      } catch {
        /* ignore */
      }
      saveSession();
    }
  });
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  // Settings + encodings first: they drive every later decision.
  try {
    const raw = await api.readSettings();
    S.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw || '{}') };
  } catch {
    S.settings = { ...DEFAULT_SETTINGS };
  }
  try {
    S.encodings = await api.listEncodings();
  } catch {
    S.encodings = [{ label: 'UTF-8', name: 'UTF-8', group: 'Unicode' }];
  }
  S.info = await api.appInfo().catch(() => S.info);

  // Deep links, handy for screenshots, bug reports and the docs:
  //   index.html?theme=light&accent=%23b15782&settings=1&find=hello&wrap=1&quiet=1
  // They are applied on top of the stored settings and never persisted.
  // `quiet=1` also silences the web-demo notice (used by the docs screenshots).
  const params = new URLSearchParams(globalThis.location?.search || '');
  const overrides = {};
  if (params.get('theme')) overrides.theme = params.get('theme');
  if (params.get('accent')) overrides.accent = params.get('accent');
  if (params.get('wrap')) overrides.wordWrap = params.get('wrap') === '1';
  if (params.get('numbers')) overrides.lineNumbers = params.get('numbers') === '1';
  if (params.get('tabwidth')) overrides.tabSize = Number(params.get('tabwidth'));
  if (params.get('fontsize')) overrides.fontSize = Number(params.get('fontsize'));
  S.settings = { ...S.settings, ...overrides };

  applyTheme();
  applyAccent();
  document.documentElement.style.setProperty('--tint-opacity', String(S.settings.tintOpacity / 100));
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (S.settings.theme === 'system') applyTheme();
  });

  // Editor surface
  S.editor = new EditorView($('#editor'), {
    onInput: () => {
      const doc = activeDoc();
      if (!doc) return;
      S.editor.save(doc);
      if (!doc.modified) {
        doc.modified = true;
        renderTabs();
      }
      updateStatusBar();
      updateWindowTitle();
      scheduleSessionSave();
    },
    onCursor: () => updateStatusBar(),
    onScroll: () => {},
    onUndoState: () => {},
  });
  applySettingsToEditors();

  setupChrome();

  // Inter-process messages from the Rust side.
  S.unlisten.push(
    await api.on('notepads://open-files', async (paths) => {
      for (const p of paths || []) await openPath(p);
    }),
  );
  S.unlisten.push(await api.on('notepads://close-requested', () => requestWindowClose()));
  S.unlisten.push(
    await api.on('notepads://quit-requested', async () => {
      await requestWindowClose();
    }),
  );

  // Launch files (CLI arguments) → session → empty document.
  const launch = await api.takeLaunchFiles();
  if (launch?.length) {
    for (const p of launch) await openPath(p);
  } else if (isTauri) {
    newTab();
  } else if (!(await restoreSession())) {
    await newTab({ content: DEMO_CONTENT });
  }

  renderTabs();
  updateStatusBar();
  updateWindowTitle();
  S.editor.focus();
  scheduleSessionSave();

  // `?demo=edited` seeds a few unsaved edits so the diff viewer has something to
  // show. Used by the docs screenshots and by manual UI checks.
  if (params.get('demo') === 'edited') {
    const doc = activeDoc();
    if (doc) {
      doc.text = `${doc.text}\n## Preview your changes\n\nPress Alt+D to compare this against the last saved revision.\n`;
      S.editor.setValue(doc.text, { keepCursor: true });
      doc.modified = true;
      renderTabs();
      updateStatusBar();
    }
  }
  if (params.get('diff') === '1') toggleDiffView();
  if (params.get('settings') === '1') toggleSettings(true);
  if (params.get('find')) {
    openFind({ replace: params.get('replace') === '1' });
    $('#find-input').value = params.get('find');
    runSearch();
  }

  if (!isTauri && !params.get('quiet')) {
    // The hosted demo has no CLI: explain the restrictions once.
    toast({
      title: 'Web demo build',
      text: 'Files opened here stay in your browser. Install the Tauri build for real filesystem access.',
      timeout: 7000,
    });
  }
}

/** Content of the welcome tab of the web demo / first run. */
const DEMO_CONTENT = `# Notepads for Linux

A modern, lightweight text editor with a minimalist design — rebuilt for Linux.

This window is running the **web demo build**: everything works, but files are
kept in your browser instead of your disk. The Tauri build ships the same UI
with a Rust backend for real files, real encodings and real dialogs.

## What works here

* Fluent design with a built-in tab system (Ctrl+N).
* Light and dark themes plus accent colour (Ctrl+,).
* Line numbers, word wrap (Alt+Z) and font zoom (Ctrl+ +/-).
* Find and replace with match case, whole word and regex (Ctrl+F / Ctrl+H).
* Encodings: UTF-8, UTF-8 BOM, UTF-16 LE/BE, ASCII, Windows-1252/1251, ISO-8859-*,
  KOI8-R — with auto detection and "reopen with encoding".
* Line endings: Windows (CRLF), Unix (LF), Macintosh (CR).
* Diff viewer for unsaved changes (Alt+D).
* Session snapshot: close the window and the tabs come back.

## Try it

1. Type something, then press Ctrl+F and search for a word.
2. Press Alt+Z to toggle word wrap and watch the gutter stay aligned.
3. Press Alt+D to see the diff against the last saved revision.
4. Open the menu (top left) or right-click the editor.

Keyboard shortcuts: Ctrl+N new tab, Ctrl+W close tab, Ctrl+Tab switch,
Ctrl+1..9 jump to tab, Ctrl+G go to line, Ctrl+E search selection in the web.

See docs/REVERSE_ENGINEERING.md for the full feature inventory of the original
Windows app and how each part maps onto this port.
`;

/**
 * Test surface. The smoke test in tests/ drives the application through these
 * handles instead of reaching into module-private state; nothing else imports it.
 */
export const internals = {
  S,
  get editor() {
    return S.editor;
  },
  patchSettings,
  newTab,
  activateTab,
  closeTab,
  activeDoc,
  saveSession,
  restoreSession,
  openPath,
  applyTheme,
};

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:24px;color:#f88;font:13px monospace">Notepads failed to start.\n\n${escapeHtml(
    e?.stack || e,
  )}</pre>`;
});
