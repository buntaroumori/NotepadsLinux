#!/usr/bin/env node
/**
 * scripts/serve.mjs — zero-dependency static server for src/.
 *
 * Serves the frontend exactly as Tauri would (same origin, same paths) so the
 * whole UI can be developed and verified in a normal browser:
 *
 *     npm run serve     →  http://localhost:5178
 *
 * `tauri dev` runs this same script through beforeDevCommand.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DIRS = [path.join(ROOT, 'src'), ROOT];
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  for (const dir of DIRS) {
    const candidate = path.join(dir, rel);
    if (!candidate.startsWith(dir)) continue; // no path traversal
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // SPA-ish fallback for the demo: anything unknown serves index.html
  const index = path.join(ROOT, 'src', 'index.html');
  return existsSync(index) ? index : null;
}

const server = createServer((req, res) => {
  const file = resolve(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
    // The Tauri webview loads from a custom scheme; allowing any origin keeps
    // the same files working under plain http:// during development.
    'access-control-allow-origin': '*',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Notepads for Linux — dev server`);
  console.log(`  serving ${path.join(ROOT, 'src')}`);
  console.log(`  http://localhost:${PORT}`);
});
