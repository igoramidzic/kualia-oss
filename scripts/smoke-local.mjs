// Run against the disposable local database while pnpm dev is running.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { assertLocalDeployment } from './local-config.mjs';

assertLocalDeployment(process.cwd());
const client = () => new ConvexHttpClient('http://127.0.0.1:3210', { logger: false });
const alice = client();
const bob = client();
const guest = client();
const email = `smoke-${randomUUID()}@example.test`;
const password = randomUUID().slice(0, 8);
async function signIn(c, address, flow = 'signUp', secret = password) {
  const result = await c.action(anyApi.auth.signIn, { provider: 'password', params: { email: address, password: secret, flow } });
  assert.ok(result.tokens?.token);
  c.setAuth(result.tokens.token);
  await c.mutation(anyApi.userProfiles.ensureCurrentProfile, {});
  return result.tokens;
}
await assert.rejects(() => signIn(guest, `short-${email}`, 'signUp', '1234567'), /at least 8 characters/);
let tokens = await signIn(alice, email);
const identity = await alice.query(anyApi.auth.getCurrentUser, {});
const workspaceId = await alice.mutation(anyApi.workspaces.createWorkspace, { name: 'Local smoke test' });
assert.equal((await alice.query(anyApi.appAccess.getCurrentAppAccess, {})).hasAppAccess, true);
await signIn(bob, `other-${email}`);
await assert.rejects(() => bob.query(anyApi.workspaces.getWorkspace, { workspaceId }), /Access denied/);
await assert.rejects(() => guest.query(anyApi.workspaces.getWorkspace, { workspaceId }), /Authentication required/);
await assert.rejects(() => guest.action(anyApi.auth.signIn, { provider: 'password', params: { email, password: 'incorrect-password', flow: 'signIn' } }));
const refreshed = await guest.action(anyApi.auth.signIn, { refreshToken: tokens.refreshToken });
assert.ok(refreshed.tokens?.token);
tokens = refreshed.tokens;
alice.setAuth(tokens.token);
assert.equal((await alice.query(anyApi.auth.getCurrentUser, {})).id, identity.id);
await alice.action(anyApi.auth.signOut, {});
const invalidated = await guest.action(anyApi.auth.signIn, { refreshToken: tokens.refreshToken }).catch(() => null);
assert.ok(!invalidated?.tokens);
tokens = await signIn(alice, email, 'signIn');
assert.equal((await alice.query(anyApi.auth.getCurrentUser, {})).id, identity.id);
assert.equal((await alice.query(anyApi.workspaces.getWorkspace, { workspaceId }))._id, workspaceId);
await alice.action(anyApi.auth.signOut, {});
await bob.action(anyApi.auth.signOut, {});
console.log('PASS: signup, password rejection, profile, free access, workspace isolation, refresh, logout, and stable ownership after re-login.');
console.log('Synthetic smoke-test accounts/workspace remain only in the ignored local database.');
