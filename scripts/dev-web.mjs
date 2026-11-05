import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
console.log('Waiting for the local backend and authentication setup…');
const deadline = Date.now() + 300_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const state = JSON.parse(await readFile(new URL('../.local/ready.json', import.meta.url), 'utf8'));
    process.kill(state.pid, 0);
    const response = await fetch('http://127.0.0.1:3210/version', { signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* First startup also downloads the local backend. */ }
  await setTimeout(500);
}
if (!ready) throw new Error('Local Convex did not become ready. Check the backend task output.');
const child = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
