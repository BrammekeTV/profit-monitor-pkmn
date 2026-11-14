// Profit Monitor – self-hosted server.
//
// Serves the static app and stores the whole workspace as one JSON file in
// DATA_DIR, so the data lives on the host (e.g. an Unraid appdata share)
// instead of in the browser. No dependencies besides Node itself.
//
// Environment:
//   PORT           port to listen on                       (default 8080)
//   DATA_DIR       where the data file and backups go      (default ./data-store, /data in Docker)
//   BACKUP_KEEP    number of daily backups to keep         (default 30)
//   PUID / PGID    when started as root: owner of the data files, and the
//                  user the server drops to                (Docker image: 99 / 100, Unraid's nobody:users)
//   AUTH_USER / AUTH_PASSWORD   optional HTTP basic auth for the whole app

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, 'data-store'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_FILE = path.join(DATA_DIR, 'profit-monitor.json');
const BACKUP_KEEP = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || '30', 10) || 30);
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';

// Only these paths are served; everything else in the image (server code,
// tests, Flask files) stays private.
const STATIC_FILES = new Set(['/index.html', '/profit-monitor-core.mjs']);
const STATIC_DIRS = ['/assets/', '/data/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ── storage ──────────────────────────────────────────────────────────

let current = { revision: 0, updatedAt: null, state: null };
let writeChain = Promise.resolve();

function loadStateFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      current = {
        revision: Number.isInteger(parsed.revision) ? parsed.revision : 1,
        updatedAt: parsed.updatedAt || null,
        state: parsed.state,
      };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Keep the unreadable file aside instead of overwriting it later.
      const aside = `${STATE_FILE}.corrupt-${Date.now()}`;
      try { fs.renameSync(STATE_FILE, aside); } catch { /* ignore */ }
      log(`Could not read ${STATE_FILE} (${error.message}); moved it to ${aside}. Restore a backup from ${BACKUP_DIR} if needed.`);
    }
  }
}

async function writeAtomic(file, contents) {
  const tmp = `${file}.tmp-${process.pid}`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, file);
}

function localDay(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// One backup per day: the first save of a day copies the previous version.
async function backupPreviousVersion() {
  if (!fs.existsSync(STATE_FILE)) return;
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `profit-monitor-${localDay()}.json`);
  if (!fs.existsSync(target)) {
    await fsp.copyFile(STATE_FILE, target);
    log(`Backup written: ${target}`);
  }
  const backups = (await fsp.readdir(BACKUP_DIR))
    .filter(name => /^profit-monitor-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  for (const name of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) {
    await fsp.unlink(path.join(BACKUP_DIR, name)).catch(() => {});
  }
}

function saveState(state, baseRevision, force) {
  const job = writeChain.then(async () => {
    if (!force && baseRevision !== current.revision) {
      return { conflict: true, ...current };
    }
    await backupPreviousVersion();
    const next = { revision: current.revision + 1, updatedAt: new Date().toISOString(), state };
    await writeAtomic(STATE_FILE, JSON.stringify(next));
    current = next;
    return { conflict: false, revision: next.revision, updatedAt: next.updatedAt };
  });
  writeChain = job.catch(() => {});
  return job;
}

// ── http helpers ─────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  if (!AUTH_USER && !AUTH_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;
  return safeEqual(decoded.slice(0, separator), AUTH_USER)
    && safeEqual(decoded.slice(separator + 1), AUTH_PASSWORD);
}

async function serveStatic(req, res, pathname) {
  let urlPath = pathname === '/' ? '/index.html' : pathname;
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const allowed = STATIC_FILES.has(urlPath) || STATIC_DIRS.some(dir => urlPath.startsWith(dir));
  const filePath = path.join(APP_DIR, urlPath);
  if (!allowed || urlPath.includes('\0') || !filePath.startsWith(APP_DIR + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      // The app shell must always be fresh after an image update.
      'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, revision: current.revision, updatedAt: current.updatedAt });
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Profit Monitor", charset="UTF-8"' }).end('Login required');
    return;
  }

  if (pathname === '/api/state') {
    if (req.method === 'GET') {
      sendJson(res, 200, current);
      return;
    }
    if (req.method === 'PUT') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (error) {
        sendJson(res, error.status || 400, { error: error.status ? error.message : 'Invalid JSON' });
        return;
      }
      if (!body || typeof body.state !== 'object' || body.state === null || Array.isArray(body.state)) {
        sendJson(res, 400, { error: 'Body must be { state: {...}, baseRevision: n }' });
        return;
      }
      const result = await saveState(body.state, body.baseRevision, body.force === true);
      if (result.conflict) {
        sendJson(res, 409, { error: 'conflict', revision: result.revision, updatedAt: result.updatedAt, state: result.state });
        return;
      }
      sendJson(res, 200, result);
      return;
    }
    res.writeHead(405, { Allow: 'GET, PUT' }).end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  await serveStatic(req, res, pathname);
}

// ── startup ──────────────────────────────────────────────────────────

function prepareDataDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Started as root (the Docker default): hand the data folder to PUID:PGID
  // and drop privileges, so files on the share are not owned by root.
  if (typeof process.getuid === 'function' && process.getuid() === 0 && process.env.PUID) {
    const uid = Number.parseInt(process.env.PUID, 10);
    const gid = Number.parseInt(process.env.PGID || process.env.PUID, 10);
    const chownTree = target => {
      fs.chownSync(target, uid, gid);
      if (fs.statSync(target).isDirectory()) {
        for (const name of fs.readdirSync(target)) chownTree(path.join(target, name));
      }
    };
    chownTree(DATA_DIR);
    process.setgid(gid);
    process.setuid(uid);
    log(`Running as uid ${uid}, gid ${gid}`);
  }

  // Fail early with a clear message if the folder is not writable.
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
}

export function startServer({ port = PORT } = {}) {
  prepareDataDir();
  loadStateFile();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      log('Request failed:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
      else res.end();
    });
  });
  server.listen(port, () => {
    log(`Profit Monitor listening on port ${server.address().port}`);
    log(`Data file: ${STATE_FILE} (revision ${current.revision})`);
    if (AUTH_USER || AUTH_PASSWORD) log('Basic auth is enabled');
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = startServer();
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
