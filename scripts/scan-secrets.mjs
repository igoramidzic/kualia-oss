import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw new Error('No tracked files to scan. Stage the intended source files first.');
const forbidden = /(^|\/)(?:\.env(?:\..*)?|\.convex|\.local|node_modules|dist|xcuserdata)(?:\/|$)|\.(?:p8|p12|pem|key|mobileprovision|sqlite3?|ipa|log)$/;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{60}/,
  /\b(?:sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/,
  /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  /\b(?:phc_|rcb_|appl_)[A-Za-z0-9_-]{20,}\b/,
];
let failed = false;
for (const file of files) {
  if (forbidden.test(file) && !file.endsWith('.env.example')) {
    console.error(`Sensitive/generated path: ${file}`); failed = true;
  }
  const content = readFileSync(file, 'utf8');
  // Generated instructions contain example key encodings, not key material.
  if (patterns.some((pattern) => pattern.test(content))) {
    console.error(`Potential credential: ${file} (value redacted)`); failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Checked ${files.length} tracked files: no forbidden paths or credential-pattern matches. Run Gitleaks for a broader scan.`);
