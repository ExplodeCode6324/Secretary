// Only disposable fixture data is used. No runtime credential file is printed or committed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretary-native-probe-'));
fs.chmodSync(root, 0o700);
const hostile = path.join(root, 'redirect');
fs.mkdirSync(hostile, { mode: 0o700 });
let redirectsFollowed = 0;
const sink = http.createServer((_req, res) => { redirectsFollowed++; res.end('{}'); });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await listen(sink);
const redirect = http.createServer((_req, res) => {
  res.writeHead(302, { location: `http://127.0.0.1:${sink.address().port}/sink` });
  res.end();
});
await listen(redirect);
fs.writeFileSync(path.join(hostile, 'core-endpoint.json'), JSON.stringify({
  api_version: '1', url: `http://127.0.0.1:${redirect.address().port}`, token: 'a'.repeat(64),
  pid: process.pid, instance_id: randomUUID(), data_domain_id: randomUUID(),
}), { mode: 0o600 });
const env = { ...process.env, SECRETARY_MODE: 'fixture' };
for (const key of Object.keys(env)) if (key.startsWith('SECRETARY_') && key !== 'SECRETARY_MODE') delete env[key];
try {
  const executable = process.argv[2];
  assert.ok(executable && path.isAbsolute(executable), 'pass the absolute SecretaryProbe executable path');
  const child = spawn(executable, [process.execPath, process.cwd(), root, hostile], { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  assert.equal(code, 0, 'native integration probe failed');
  assert.equal(redirectsFollowed, 0, 'redirect leaked an authenticated request');
} finally {
  // A failed probe may leave its own detached fixture Core alive; stop only that endpoint.
  const endpointFile = path.join(root, 'core', 'core-endpoint.json');
  if (fs.existsSync(endpointFile)) {
    const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    await fetch(`${ep.url}/api/v1/core/stop`, { method: 'POST', headers: {
      Authorization: `Bearer ${ep.token}`, 'Content-Type': 'application/json', 'X-Secretary-API-Version': '1',
    }, body: JSON.stringify({ request_id: randomUUID() }), signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
  await new Promise(resolve => redirect.close(resolve));
  await new Promise(resolve => sink.close(resolve));
  // Keep any failed Core evidence private rather than deleting a possibly active writer's data.
  for (let i = 0; i < 50 && fs.existsSync(endpointFile); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(endpointFile)) fs.rmSync(root, { recursive: true });
}
