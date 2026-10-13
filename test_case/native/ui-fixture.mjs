// Local GUI acceptance only. Requires an unlocked macOS graphical session and build-for-testing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretary-native-ui-'));
fs.chmodSync(root, 0o700);
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('SECRETARY_')) delete env[key];
env.SECRETARY_MODE = 'fixture';
env.SECRETARY_DATA = path.join(root, 'core');
const endpointFile = path.join(env.SECRETARY_DATA, 'core-endpoint.json');
async function run(command, args, environment) {
  const child = spawn(command, args, { env: environment, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGINT'), 240_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject); child.on('exit', resolve);
    });
    assert.equal(code, 0, `${path.basename(command)} failed`);
  } finally { clearTimeout(timer); }
}
let passed = false;
try {
  await run(process.execPath, ['--import', 'tsx', 'src/pi_secretary/src/core-cli.ts', 'start'], env);
  assert.ok(fs.existsSync(endpointFile), 'fixture Core must publish inside its isolated data directory');
  const testEnv = { ...process.env, TEST_RUNNER_SECRETARY_UI_FIXTURE_DIR: root };
  await run('xcodebuild', ['-project', 'src/secretary_macos/Secretary.xcodeproj', '-scheme', 'Secretary',
    '-destination', 'platform=macOS', '-derivedDataPath', '.build/native',
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '45',
    '-maximum-test-execution-time-allowance', '60', ...process.argv.slice(2), 'test-without-building'], testEnv);
  console.log('PASS: isolated native window recovery and chat UI acceptance');
  passed = true;
} finally {
  if (fs.existsSync(endpointFile)) {
    const ep = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    await fetch(`${ep.url}/api/v1/core/stop`, { method: 'POST', headers: {
      Authorization: `Bearer ${ep.token}`, 'Content-Type': 'application/json', 'X-Secretary-API-Version': '1',
    }, body: JSON.stringify({ request_id: randomUUID() }), signal: AbortSignal.timeout(3000) }).catch(() => {});
  }
  for (let i = 0; i < 50 && fs.existsSync(endpointFile); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (passed && !fs.existsSync(endpointFile)) fs.rmSync(root, { recursive: true });
  else console.log(`Retained private failed UI fixture: ${root}`);
}
