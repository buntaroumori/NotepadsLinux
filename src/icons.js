/**
 * icons.js — the Codicon-style 16x16 stroke icon set used across the UI.
 * Original artwork for this project (see NOTICE), inspired by the icon set the
 * Windows app uses through the Windows Community Toolkit.
 */
const P = {
  menu: 'M2 4h12M2 8h12M2 12h12',
  plus: 'M8 2.5v11M2.5 8h11',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  find: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM14 14l-3.2-3.2',
  chevronUp: 'M4 10l4-4 4 4',
  chevronDown: 'M4 6l4 4 4-4',
  chevronRight: 'M6 4l4 4-4 4',
  arrowUp: 'M8 13V3M4.5 6.5L8 3l3.5 3.5',
  arrowDown: 'M8 3v10M4.5 9.5L8 13l3.5-3.5',
  arrowLeft: 'M13 8H3M6.5 4.5L3 8l3.5 3.5',
  arrowRight: 'M3 8h10M9.5 4.5L13 8l-3.5 3.5',
  replace: 'M3 5h7M7.5 2.5L10 5 7.5 7.5M13 11H6M8.5 8.5L6 11l2.5 2.5',
  replaceAll: 'M2.5 5h6M6 2.5L8.5 5 6 7.5M2.5 11h6M6 8.5L8.5 11 6 13.5M11 8l2 2 2.5-3.5',
  ellipsis: 'M3 8h.01M8 8h.01M13 8h.01',
  cut: 'M4 3l6.5 8.5M12 3L5.5 11.5M3.5 13.5a1.8 1.8 0 1 0 0-.01M12.5 13.5a1.8 1.8 0 1 0 0-.01',
  copy: 'M5.5 5.5h7v7h-7zM3 10.5V3.5h7',
  paste: 'M5 3.5h6v1.5H5zM3.5 4.5h9v8h-9zM6 8h4M6 10.5h4',
  undo: 'M4 6.5h5.5a3 3 0 1 1 0 6H7M4 6.5L6.5 4M4 6.5L6.5 9',
  redo: 'M12 6.5H6.5a3 3 0 1 0 0 6H9M12 6.5L9.5 4M12 6.5L9.5 9',
  selectAll: 'M2.5 4a1.5 1.5 0 0 1 1.5-1.5h1M8 2.5h1M11 2.5h1.5A1.5 1.5 0 0 1 14 4v1M14 8v1M14 11v1a1.5 1.5 0 0 1-1.5 1.5h-1M8 13.5H7M4 13.5H3a1.5 1.5 0 0 1-1.5-1.5v-1M2.5 8V7M2.5 11V10',
  wordWrap: 'M2.5 4h11M2.5 8h7.5a2 2 0 0 1 0 4H7M7 10.5L5.5 12 7 13.5M2.5 12h2',
  globe: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2.2 6.5h11.6M2.2 9.5h11.6M8 2c1.6 1.6 2.4 3.6 2.4 6S9.6 12.4 8 14c-1.6-1.6-2.4-3.6-2.4-6S6.4 3.6 8 2z',
  preview: 'M2 4.5h8.5v7H2zM11.5 7l2.5-1.5v5L11.5 9z',
  share: 'M8 10V2M5 5l3-3 3 3M3 9v3.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2.5V6H10',
  folder: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2L7 4.5h5.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z',
  save: 'M3 3h8l2 2v8H3zM5.5 3v3.5h5V3M5.5 13V9h5v4',
  saveAll: 'M2.5 2.5h7l1.8 1.8V11h-8.8zM5 2.5v3h4v-3M12 5.5h1.5v8h-8V12',
  print: 'M4.5 6V2.5h7V6M3 6h10a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1.5M3 6a1 1 0 0 0-1 1v3.5a1 1 0 0 0 1 1h1.5M4.5 9.5h7v4h-7z',
  settings: 'M6.6 1.8h2.8l.4 1.8 1.6.9 1.7-.7 1.4 2.4-1.3 1.3v1.8l1.3 1.3-1.4 2.4-1.7-.7-1.6.9-.4 1.8H6.6l-.4-1.8-1.6-.9-1.7.7-1.4-2.4 1.3-1.3V7.5L1.5 6.2l1.4-2.4 1.7.7 1.6-.9zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7v4M8 5.2h.01',
  palette: 'M8 14a6 6 0 1 1 0-12c3.3 0 6 2.2 6 5 0 1.7-1.4 2.5-2.8 2.5h-.9c-.7 0-1.3.6-1.3 1.3 0 .3.1.6.3.9.2.3.3.6.3.9 0 .8-.7 1.4-1.6 1.4zM5 7h.01M7.5 5h.01M10.5 6h.01',
  code: 'M6 4L2.5 8 6 12M10 4l3.5 4L10 12',
  textFont: 'M3.5 13l4-10 4 10M5 10h5.5M12 3.5h2M13 3.5V13',
  lab: 'M6.5 2v4L3 12.2A1 1 0 0 0 3.9 13.7h8.2a1 1 0 0 0 .9-1.5L9.5 6V2M5.5 2h5M5 9.5h6',
  pin: 'M8 1.5l2 3.5 3 .8-2.2 2.3.4 3.2L8 9.8l-3.2 1.5.4-3.2L3 5.8l3-.8zM8 9.8v4.7',
  check: 'M3 8.5l3.5 3.5L13 5',
  dash: 'M3 8h10',
  dot: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  warn: 'M8 2.5l6 11H2zM8 6.5v3.5M8 11.7h.01',
  link: 'M6.5 9.5l3-3M6 11.5H4.5a2.5 2.5 0 0 1 0-5H6M10 4.5h1.5a2.5 2.5 0 0 1 0 5H10',
  external: 'M9 3h4v4M13 3L7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5',
  pencil: 'M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3',
  newWindow: 'M3 3.5h7v7H3zM6.5 12.5h6.5v-6.5h-1.5M9 7.5V6M11.5 7.5H10',
  windowMin: 'M2.5 8h11',
  windowMax: 'M2.5 2.5h11v11h-11z',
  windowRestore: 'M5 2.5h8.5V11M2.5 5h8.5v8.5H2.5z',
  zoomIn: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.5 10.5L14 14M7 5v4M5 7h4',
  zoomOut: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.5 10.5L14 14M5 7h4',
  fileText: 'M4 1.5h5L12 4.5v10H4zM9 1.5v3h3M6 8h4M6 10.5h4',
  fileCode: 'M4 1.5h5L12 4.5v10H4zM9 1.5v3h3M7 8.5l-1.2 1.5L7 11.5M9 8.5l1.2 1.5L9 11.5',
  fileMd: 'M4 1.5h5L12 4.5v10H4zM9 1.5v3h3M5.8 12v-3l1.2 1.6L8.2 9v3M9.8 9h1.6v3M9.8 12h1.2',
  fileData: 'M4 1.5h5L12 4.5v10H4zM9 1.5v3h3M6 8.5h4M6 10.5h4M6 12.5h2',
};

const ICON_CACHE = new Map();

/** Returns an <svg> string for the given icon name. */
export function icon(name, size = 16) {
  const d = P[name];
  if (!d) return '';
  return (
    `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" ` +
    `stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
  );
}

/** Builds the DOM node for an icon (cached markup). */
export function iconNode(name, size = 16) {
  const key = `${name}:${size}`;
  let html = ICON_CACHE.get(key);
  if (!html) {
    html = icon(name, size);
    ICON_CACHE.set(key, html);
  }
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** File-type badge used by tabs. Markdown gets the pink badge of the original. */
export function fileIconFor(path, isUntitled) {
  const name = (path || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const map = {
    md: ['fileMd', '#c0608f'],
    markdown: ['fileMd', '#c0608f'],
    txt: ['fileText', '#8a9299'],
    log: ['fileText', '#8a9299'],
    json: ['fileCode', '#d9a13b'],
    yml: ['fileCode', '#d9a13b'],
    yaml: ['fileCode', '#d9a13b'],
    toml: ['fileCode', '#d9a13b'],
    ini: ['fileCode', '#d9a13b'],
    conf: ['fileCode', '#d9a13b'],
    cfg: ['fileCode', '#d9a13b'],
    xml: ['fileCode', '#63c07d'],
    html: ['fileCode', '#e06a4d'],
    css: ['fileCode', '#5b9bdd'],
    js: ['fileCode', '#dcb54b'],
    ts: ['fileCode', '#5b9bdd'],
    py: ['fileCode', '#5b9bdd'],
    rs: ['fileCode', '#e06a4d'],
    c: ['fileCode', '#5b9bdd'],
    h: ['fileCode', '#5b9bdd'],
    cpp: ['fileCode', '#5b9bdd'],
    sh: ['fileCode', '#63c07d'],
    csv: ['fileData', '#63c07d'],
    env: ['fileData', '#63c07d'],
  };
  const [iconName, color] = isUntitled
    ? ['fileText', 'currentColor']
    : map[ext] || ['fileText', 'currentColor'];
  return { name: iconName, color };
}

export const ICONS = P;
