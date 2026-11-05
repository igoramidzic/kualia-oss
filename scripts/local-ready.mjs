import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { assertLocalDeployment } from './local-config.mjs';

assertLocalDeployment(process.cwd());
const run = promisify(execFile);
const keyPath = new URL('../.local/auth-keys.json', import.meta.url);
let keys;
try { keys = JSON.parse(await readFile(keyPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const pair = await generateKeyPair('RS256', { extractable: true });
  keys = {
    JWT_PRIVATE_KEY: (await exportPKCS8(pair.privateKey)).trimEnd().replace(/\n/g, ' '),
    JWKS: JSON.stringify({ keys: [{ use: 'sig', ...await exportJWK(pair.publicKey) }] }),
  };
  await writeFile(keyPath, JSON.stringify(keys), { mode: 0o600 });
}
for (const [name, value] of Object.entries({ ...keys, SITE_URL: 'http://127.0.0.1:4200', SELF_HOSTED: 'true' })) {
  // Use argv rather than a shell so key contents cannot be interpreted as code.
  try {
    await run(process.execPath, ['node_modules/convex/bin/main.js', 'env', 'set', `${name}=${value}`, '--env-file', '.env.local']);
  } catch {
    throw new Error(`Unable to configure local ${name}. Restart pnpm dev to retry.`);
  }
}
await writeFile(new URL('../.local/ready.json', import.meta.url), JSON.stringify({ pid: Number(process.env.KUALIA_DEV_PID) }));
console.log('Local auth ready. Open http://127.0.0.1:4200/signup to create your account.');
