// Creates test-website/ from website-template/ as its own local git repo with a baseline commit.
// The repo is local-only: deploy scenarios commit "bad pushes" to it for Aura to correlate.
// Usage: node setup-website.js [--force]   (--force wipes an existing test-website/ first)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROBLEM_DIR, WEBSITE_DIR } from './lib/config.js';

const TEMPLATE_DIR = path.join(PROBLEM_DIR, 'website-template');
const force = process.argv.includes('--force');

if (fs.existsSync(WEBSITE_DIR)) {
  if (!force) {
    console.log(`${WEBSITE_DIR} already exists (use --force to recreate it from the template).`);
    process.exit(0);
  }
  fs.rmSync(WEBSITE_DIR, { recursive: true, force: true });
}

fs.cpSync(TEMPLATE_DIR, WEBSITE_DIR, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', WEBSITE_DIR, ...args], { stdio: 'inherit' });
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=void-dev', '-c', 'user.email=dev@void.shop', 'commit', '-q', '-m', 'Initial commit: VOID shop');
console.log(`Created ${WEBSITE_DIR} (git repo with baseline commit). Next: cd ${path.relative(process.cwd(), WEBSITE_DIR) || '.'} && npm install`);
