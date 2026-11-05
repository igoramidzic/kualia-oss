import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalDeployment } from './local-config.mjs';

test('local launcher rejects remote targets and permits only anonymous deployments', () => {
  const root = mkdtempSync(join(tmpdir(), 'kualia-config-'));
  try {
    assert.doesNotThrow(() => assertLocalDeployment(root, {}));
    for (const name of ['CONVEX_DEPLOY_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY']) {
      assert.throws(() => assertLocalDeployment(root, { [name]: 'configured' }));
    }
    for (const target of ['prod:example', 'dev:example', 'local:example']) {
      assert.throws(() => assertLocalDeployment(root, { CONVEX_DEPLOYMENT: target }));
      writeFileSync(join(root, '.env.local'), `CONVEX_DEPLOYMENT="${target}"\n`);
      assert.throws(() => assertLocalDeployment(root, {}));
    }
    writeFileSync(join(root, '.env.local'), 'CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n');
    assert.doesNotThrow(() => assertLocalDeployment(root, { CONVEX_DEPLOYMENT: 'anonymous:anonymous-agent' }));
    writeFileSync(join(root, '.env'), 'export CONVEX_DEPLOY_KEY=example\n');
    assert.throws(() => assertLocalDeployment(root, {}));
  } finally { rmSync(root, { recursive: true }); }
});
