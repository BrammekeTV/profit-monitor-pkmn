import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-data-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUID: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { base, dataDir, stop: () => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

const put = (base, body, headers = {}) => fetch(`${base}/api/state`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('server stores state on disk, enforces revisions and keeps it across restarts', async () => {
  const first = await startServer();
  try {
    let res = await fetch(`${first.base}/api/state`);
    assert.deepEqual(await res.json(), { revision: 0, updatedAt: null, state: null });

    res = await put(first.base, { state: { tabs: [{ id: 't1', name: 'Main' }] }, baseRevision: 0 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).revision, 1);

    // A stale writer gets a conflict with the current copy.
    res = await put(first.base, { state: { tabs: [] }, baseRevision: 0 });
    assert.equal(res.status, 409);
    const conflict = await res.json();
    assert.equal(conflict.revision, 1);
    assert.equal(conflict.state.tabs[0].name, 'Main');

    // ...unless it forces the write.
    res = await put(first.base, { state: { tabs: [{ id: 't2', name: 'Forced' }] }, baseRevision: 0, force: true });
    assert.equal(res.status, 200);

    // Second save of the day wrote a backup of the previous version.
    const backups = fs.readdirSync(path.join(first.dataDir, 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^profit-monitor-\d{4}-\d{2}-\d{2}\.json$/);

    assert.equal((await put(first.base, { state: 'nope', baseRevision: 2 })).status, 400);
  } finally {
    await first.stop();
  }

  const second = await startServer({ DATA_DIR: first.dataDir });
  try {
    const body = await (await fetch(`${second.base}/api/state`)).json();
    assert.equal(body.revision, 2);
    assert.equal(body.state.tabs[0].name, 'Forced');
  } finally {
    await second.stop();
  }
});

test('server only serves the app files', async () => {
  const server = await startServer();
  try {
    const index = await fetch(`${server.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(`${server.base}/profit-monitor-core.mjs`)).status, 200);
    assert.equal((await fetch(`${server.base}/assets/grading/psa.svg`)).status, 200);
    assert.equal((await fetch(`${server.base}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${server.base}/assets/../server.mjs`)).status, 404);
    assert.equal((await fetch(`${server.base}/assets/%2e%2e/server.mjs`)).status, 404);
  } finally {
    await server.stop();
  }
});

test('optional basic auth protects the app but not the health check', async () => {
  const server = await startServer({ AUTH_USER: 'bram', AUTH_PASSWORD: 'secret' });
  try {
    assert.equal((await fetch(`${server.base}/api/health`)).status, 200);
    assert.equal((await fetch(`${server.base}/`)).status, 401);
    assert.equal((await fetch(`${server.base}/api/state`)).status, 401);
    const auth = { Authorization: `Basic ${Buffer.from('bram:secret').toString('base64')}` };
    assert.equal((await fetch(`${server.base}/api/state`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${server.base}/`, { headers: { Authorization: `Basic ${Buffer.from('bram:wrong').toString('base64')}` } })).status, 401);
  } finally {
    await server.stop();
  }
});
