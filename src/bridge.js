/**
 * bridge.js — the only module that knows whether we are running inside Tauri or
 * inside a plain browser.
 *
 * Under Tauri every call goes to the Rust commands in src-tauri/src/lib.rs
 * (real filesystem, real encodings, real dialogs). In a browser it degrades to
 * the File System Access API / <input type=file> / downloads plus localStorage,
 * which is exactly what the hosted demo build uses. The rest of the UI code is
 * identical in both cases.
 */

const T = globalThis.__TAURI__;
export const isTauri = !!(T && T.core && typeof T.core.invoke === 'function');

const ws = (() => {
  try {
    return T?.window?.getCurrentWindow ? T.window.getCurrentWindow() : null;
  } catch {
    return null;
  }
})();

/* ------------------------------------------------------------------ browser VFS */

const vfs = new Map(); // pseudo path -> { content, handle, lastModified }

/**
 * Storage that works even inside a sandboxed iframe, where touching
 * localStorage throws a SecurityError. Falls back to an in-memory map, so the
 * hosted demo never breaks; it just forgets things when you reload.
 */
export const storage = (() => {
  try {
    const probe = '__notepads_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => void mem.set(k, String(v)),
      removeItem: (k) => void mem.delete(k),
    };
  }
})();
let untitledSeq = 0;

function pseudoPath(name) {
  return `/home/demo/${name}`;
}

/* ------------------------------------------------------------------- API */

export const api = {
  isTauri,
  label: ws?.label || 'browser',

  /* ---- files ---- */

  async readTextFile(path, { forceEncoding = null, allowBinary = false } = {}) {
    if (isTauri) {
      return T.core.invoke('read_text_file', {
        path,
        forceEncoding,
        allowBinary,
      });
    }
    const entry = vfs.get(path);
    if (!entry) throw new Error(`no such file: ${path}`);
    const text = entry.content;
    return {
      path,
      content: text,
      encoding: entry.encoding || 'UTF-8',
      encodingGuessed: false,
      lineEnding: text.includes('\r\n') ? 'CRLF' : 'LF',
      size: new Blob([text]).size,
      largeFile: false,
      readonly: false,
    };
  },

  async saveTextFile(
    path,
    contents,
    { encoding = 'UTF-8', lineEnding = 'LF', expectedModifiedMs = null, force = false } = {},
  ) {
    if (isTauri) {
      return T.core.invoke('save_text_file', {
        path,
        contents,
        encoding,
        lineEnding,
        expectedModifiedMs,
        force,
      });
    }
    const entry = vfs.get(path);
    if (entry?.handle) {
      const w = await entry.handle.createWritable();
      await w.write(new Blob([contents], { type: 'text/plain' }));
      await w.close();
    }
    vfs.set(path, { ...(entry || {}), content: contents, encoding, lastModified: Date.now() });
    const dl = entry?.handle ? null : downloadFile(path.split('/').pop(), contents);
    return {
      path,
      size: new Blob([contents]).size,
      modifiedMs: Date.now(),
      downloaded: !!dl,
    };
  },

  async fileMetadata(path) {
    if (isTauri) return T.core.invoke('file_metadata', { path });
    const e = vfs.get(path);
    return { exists: !!e, size: e ? new Blob([e.content]).size : 0, modifiedMs: e?.lastModified || 0, readonly: false };
  },

  async renameFile(from, to) {
    if (isTauri) return T.core.invoke('rename_file', { from, to });
    const e = vfs.get(from);
    if (e) {
      vfs.set(to, e);
      vfs.delete(from);
    }
  },

  async deleteFile(path) {
    if (isTauri) return T.core.invoke('delete_file', { path });
    vfs.delete(path);
  },

  async listEncodings() {
    if (isTauri) return T.core.invoke('list_encodings');
    return [
      { label: 'UTF-8', name: 'UTF-8', group: 'Unicode' },
      { label: 'UTF-8-BOM', name: 'UTF-8 with BOM', group: 'Unicode' },
      { label: 'UTF-16LE', name: 'UTF-16 LE', group: 'Unicode' },
      { label: 'UTF-16BE', name: 'UTF-16 BE', group: 'Unicode' },
      { label: 'ASCII', name: 'ASCII', group: 'Western' },
      { label: 'WINDOWS-1252', name: 'ANSI (Windows-1252)', group: 'Western' },
      { label: 'ISO-8859-1', name: 'Western European (ISO-8859-1)', group: 'Western' },
      { label: 'ISO-8859-15', name: 'Western European (ISO-8859-15)', group: 'Western' },
      { label: 'WINDOWS-1251', name: 'Cyrillic (Windows-1251)', group: 'Cyrillic' },
      { label: 'KOI8-R', name: 'Cyrillic (KOI8-R)', group: 'Cyrillic' },
    ];
  },

  /* ---- pickers ---- */

  async pickOpenFile({ multiple = true } = {}) {
    if (isTauri) return T.core.invoke('pick_open_file', { multiple });

    if (!multiple) {
      const one = await pickWithFileInput(false);
      return one.map((f) => loadBrowserFile(f));
    }
    // Inside a sandboxed iframe (the hosted preview) the File System Access API
    // throws on call, so fall back to a plain <input type=file> there.
    const sandboxed = globalThis.origin === 'null' || !globalThis.showOpenFilePicker;
    if (globalThis.showOpenFilePicker && !sandboxed) {
      try {
        const handles = await showOpenFilePicker({ multiple: true });
        const paths = [];
        for (const h of handles) {
          const file = await h.getFile();
          const p = pseudoPath(file.name);
          const content = await file.text();
          vfs.set(p, { content, handle: h, lastModified: file.lastModified, encoding: 'UTF-8' });
          paths.push(p);
        }
        return paths;
      } catch (e) {
        if (e?.name === 'AbortError') return [];
      }
    }
    const files = await pickWithFileInput(true);
    return files.map((f) => loadBrowserFile(f));
  },

  async pickSavePath(suggested) {
    if (isTauri) return T.core.invoke('pick_save_path', { suggested });
    return { path: pseudoPath(suggested || `Untitled-${++untitledSeq}.txt`), cancelled: false };
  },

  async pickFolder(defaultPath) {
    if (isTauri) return T.core.invoke('pick_folder', { defaultPath });
    return '/home/demo';
  },

  /* ---- shell ---- */

  async openUrl(url) {
    if (isTauri) return T.core.invoke('open_url', { url });
    window.open(url, '_blank', 'noopener');
  },

  async webSearch(query) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    if (isTauri) return T.core.invoke('web_search', { query });
    window.open(url, '_blank', 'noopener');
  },

  async openInFileManager(path) {
    if (isTauri) return T.core.invoke('open_in_file_manager', { path });
    toastless('In the browser demo there is no file manager to open.');
  },

  /* ---- windows ---- */

  async newWindow(files = []) {
    if (isTauri) return T.core.invoke('new_window', { files });
    window.open(location.href, '_blank');
    return 'browser';
  },

  async windowAction(action) {
    if (!isTauri) {
      if (action === 'close') window.close();
      return;
    }
    return T.core.invoke('window_action', { action });
  },

  async isMaximized() {
    if (!isTauri) return false;
    return T.core.invoke('window_is_maximized').catch(() => false);
  },

  async setWindowTitle(title) {
    document.title = title;
    if (isTauri) await T.core.invoke('set_window_title', { title }).catch(() => {});
  },

  async confirmClose() {
    if (isTauri) return T.core.invoke('confirm_close');
    window.close();
  },

  async exitApp() {
    if (isTauri) return T.core.invoke('exit_app');
  },

  async requestQuit() {
    if (isTauri) return T.core.invoke('request_quit');
    window.close();
  },

  async takeLaunchFiles() {
    if (!isTauri) return [];
    return T.core.invoke('take_launch_files', { label: ws.label }).catch(() => []);
  },

  async on(event, handler) {
    if (!isTauri) return () => {};
    const un = await T.event.listen(event, (e) => handler(e.payload));
    return un;
  },

  async appInfo() {
    if (isTauri) return T.core.invoke('app_info');
    return {
      version: '1.0.0',
      name: 'Notepads for Linux (web demo)',
      configDir: 'localStorage',
      platform: navigator.platform || 'browser',
    };
  },

  /* ---- settings & session (localStorage in the browser build) ---- */

  async readSettings() {
    if (isTauri) {
      const raw = await T.core.invoke('read_settings');
      return raw || '{}';
    }
    return storage.getItem('notepads.settings') || '{}';
  },

  async writeSettings(json) {
    if (isTauri) return T.core.invoke('write_settings', { json });
    storage.setItem('notepads.settings', json);
  },

  async readSession() {
    if (isTauri) return T.core.invoke('read_session');
    return storage.getItem('notepads.session') || '{}';
  },

  async writeSession(json) {
    if (isTauri) return T.core.invoke('write_session', { json });
    storage.setItem('notepads.session', json);
  },

  async clearSession() {
    if (isTauri) return T.core.invoke('clear_session');
    storage.removeItem('notepads.session');
  },
};

/* ---------------------------------------------------------------- helpers */

function pickWithFileInput(multiple) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = 'text/*,.txt,.md,.log,.json,.ini,.conf,.cfg,.yml,.yaml,.toml,.csv,.sh,.js,.ts,.py,.rs,.c,.h,.cpp,.xml,.html,.css';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

function loadBrowserFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const p = pseudoPath(file.name);
      vfs.set(p, { content: String(reader.result), lastModified: file.lastModified, encoding: 'UTF-8' });
      resolve(p);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function downloadFile(name, contents) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || 'untitled.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return a;
}

function toastless(message) {
  // Avoid a hard dependency on the UI layer for this one informational case.
  console.info('[Notepads]', message);
}

/** Registers a dropped file into the virtual FS (browser drag & drop). */
export async function registerDroppedFile(file) {
  if (isTauri) return file.path;
  return loadBrowserFile(file);
}
