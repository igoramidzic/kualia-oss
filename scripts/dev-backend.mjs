import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertLocalDeployment } from './local-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Convex Node actions require Node 24. Run nvm use before pnpm dev.');
assertLocalDeployment(root);
await mkdir(new URL('../.local/', import.meta.url), { recursive: true, mode: 0o700 });
await rm(new URL('../.local/ready.json', import.meta.url), { force: true });
console.log('Target: anonymous local Convex at http://127.0.0.1:3210. Data stays in .convex/.');
const child = spawn(process.execPath, [
  'node_modules/convex/bin/main.js', 'dev', '--local-cloud-port', '3210', '--local-site-port', '3211',
  '--start', 'node scripts/local-ready.mjs',
], { cwd: root, stdio: 'inherit', env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous', KUALIA_DEV_PID: String(process.pid) } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', async (code) => {
  await rm(new URL('../.local/ready.json', import.meta.url), { force: true });
  process.exit(code ?? 0);
});
