import { readFileSync, existsSync } from 'node:fs';

export function assertLocalDeployment(root, env = process.env) {
  const names = ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'];
  for (const name of names) {
    if (name === 'CONVEX_DEPLOYMENT' && env[name]?.startsWith('anonymous:')) continue;
    if (env[name]) throw new Error(`Unset ${name} before starting local development.`);
  }
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(`${root}/${file}`)) continue;
    const contents = readFileSync(`${root}/${file}`, 'utf8');
    for (const name of names) {
      const value = contents.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*([^\\n#]*)`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (!value) continue;
      if (name === 'CONVEX_DEPLOYMENT' && value.startsWith('anonymous:')) continue;
      throw new Error(`${file} contains ${name}; local development refuses configured remote deployments.`);
    }
  }
}
