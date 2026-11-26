// Seeds a synthetic demo budget into the anonymous local Convex deployment.
// Run while `pnpm dev` is up: `pnpm seed`. Re-running is safe: an existing demo
// workspace is reported (and re-validated) instead of being duplicated.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { formatBigIntAsDecimal } from '../convex/lib/serialization.ts';
import { assertLocalDeployment } from './local-config.mjs';
import { buildDemoBudget, DEMO_CURRENCY, DEMO_EMAIL, DEMO_PASSWORD, DEMO_WORKSPACE_NAME } from './seed-data.mjs';

const LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const APP_URL = 'http://127.0.0.1:4200';
const root = fileURLToPath(new URL('../', import.meta.url));

function fail(message) {
  console.error(`pnpm seed: ${message}`);
  process.exit(1);
}
const errorText = (error) => (error instanceof Error ? error.message : String(error));
const run = promisify(execFile);

// Dev-only internal mutation, run with the local CLI's admin access (argv, no shell).
async function completeOnboarding(workspaceId) {
  try {
    await run(
      process.execPath,
      [
        'node_modules/convex/bin/main.js',
        'run',
        'devSeed:completeSeededUserOnboarding',
        JSON.stringify({ workspaceId, name: 'Demo' }),
        '--env-file',
        '.env.local',
      ],
      { cwd: root }
    );
  } catch (error) {
    fail(`Seeded the workspace but could not skip user onboarding: ${errorText(error).split('\n')[0]}`);
  }
}

try {
  assertLocalDeployment(root);
} catch (error) {
  fail(`${errorText(error)} The demo seed only runs against anonymous local Convex.`);
}
try {
  const response = await fetch(`${LOCAL_CONVEX_URL}/version`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch {
  fail(`No local Convex backend at ${LOCAL_CONVEX_URL}. Start \`pnpm dev\` first, then rerun \`pnpm seed\`.`);
}

const client = new ConvexHttpClient(LOCAL_CONVEX_URL, { logger: false });
async function authenticate() {
  const attempt = (flow) =>
    client.action(anyApi.auth.signIn, {
      provider: 'password',
      params: { email: DEMO_EMAIL, password: DEMO_PASSWORD, flow },
    });
  let created = false;
  let result = await attempt('signIn').catch(() => null);
  if (!result?.tokens?.token) {
    try {
      result = await attempt('signUp');
      created = true;
    } catch (error) {
      fail(
        `Could not sign in or sign up ${DEMO_EMAIL} (${errorText(error)}). If the demo user's password was ` +
          'changed, sign in with it in the app or use a fresh local database.'
      );
    }
  }
  if (!result?.tokens?.token) fail(`Could not obtain a session for ${DEMO_EMAIL}.`);
  client.setAuth(result.tokens.token);
  await client.mutation(anyApi.userProfiles.ensureCurrentProfile, {});
  return created;
}

function printCredentials() {
  console.log(`\n  Open:     ${APP_URL}/login`);
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log('  (Synthetic local-only credentials; never reuse them on a shared deployment.)\n');
}

async function validate(workspaceId) {
  const result = await client.query(anyApi.validation.validateWorkspacePublic, { workspaceId });
  const issues = result?.issues ?? [];
  if (!result?.isValid || issues.length) {
    console.error(`Data integrity check found ${issues.length} issue(s):`);
    for (const issue of issues.slice(0, 10)) console.error(`  - ${issue.description ?? issue.type}`);
    process.exit(1);
  }
  console.log('Data integrity check passed (balances, category activity, credit card, Ready to Assign).');
}

const createdUser = await authenticate();
console.log(createdUser ? `Created demo user ${DEMO_EMAIL}.` : `Demo user ${DEMO_EMAIL} already exists.`);

const workspaces = await client.query(anyApi.workspaces.getUserWorkspaces, {});
const existing = workspaces.find((w) => w?.name === DEMO_WORKSPACE_NAME && !w.isDeleted && !w.isArchived);
if (existing) {
  console.log(`Demo workspace "${DEMO_WORKSPACE_NAME}" already exists; no data was added.`);
  console.log('To start over, delete the workspace in Settings and rerun `pnpm seed`.');
  await validate(existing._id);
  await completeOnboarding(existing._id);
  printCredentials();
  await client.action(anyApi.auth.signOut, {});
  process.exit(0);
}

const { files, summary } = buildDemoBudget();
const workspaceId = await client
  .action(anyApi.kualiaImport.restore, {
    files,
    name: DEMO_WORKSPACE_NAME,
    currency: DEMO_CURRENCY,
    requestId: `demo-seed-${randomUUID()}`,
  })
  .catch((error) => fail(`Import failed: ${errorText(error)}`));

console.log(
  `Seeded "${DEMO_WORKSPACE_NAME}" (${summary.months[0]}–${summary.months.at(-1)}): ` +
    `${summary.accounts.length} accounts, ${summary.categoryCount} categories, ${summary.transactionCount} transactions ` +
    `(${summary.splitCount} splits, ${summary.transferCount} transfers). Ready to Assign: ${formatBigIntAsDecimal(summary.readyToAssign, 2)} ${DEMO_CURRENCY}.`
);
await validate(workspaceId);
await completeOnboarding(workspaceId);
printCredentials();
await client.action(anyApi.auth.signOut, {});
