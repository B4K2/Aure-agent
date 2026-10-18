// Code-level "deploys": exact find/replace edits on the website source, reversible.
// Every apply/revert is appended to .state/deploys.jsonl and, if test-website is a git repo,
// committed with a normal-looking commit message (so the agent has to correlate, not read a label).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WEBSITE_DIR } from './config.js';
import { statePath } from './state.js';

const count = (hay, needle) => hay.split(needle).length - 1;

function plan(edits, reverse) {
  const files = new Map();
  for (const e of reverse ? [...edits].reverse() : edits) {
    const file = path.join(WEBSITE_DIR, e.file);
    const src = files.get(file) ?? fs.readFileSync(file, 'utf8');
    const [from, to] = reverse ? [e.replace, e.find] : [e.find, e.replace];
    if (count(src, to) === 1 && count(src, from) === 0) { files.set(file, src); continue; } // already applied / reverted
    if (count(src, from) !== 1)
      throw new Error(`${e.file}: expected exactly one match for edit, found ${count(src, from)}.\n` +
        `The website code changed since this scenario was written, or it is already ${reverse ? 'reverted' : 'applied'}.\n--- looking for ---\n${from}`);
    files.set(file, src.replace(from, () => to));
  }
  return files;
}

export function applyEdits(edits) { writeAll(plan(edits, false)); }
export function revertEdits(edits) { writeAll(plan(edits, true)); }
function writeAll(files) { for (const [f, src] of files) fs.writeFileSync(f, src); }

export function recordDeploy({ scenario, action, message, edits }) {
  const files = [...new Set(edits.map((e) => e.file))];
  const entry = { at: new Date().toISOString(), scenario, action, message, files,
    added: edits.reduce((s, e) => s + (action === 'apply' ? e.replace : e.find).split('\n').length, 0),
    removed: edits.reduce((s, e) => s + (action === 'apply' ? e.find : e.replace).split('\n').length, 0) };
  fs.appendFileSync(statePath('deploys.jsonl'), JSON.stringify(entry) + '\n');
  if (fs.existsSync(path.join(WEBSITE_DIR, '.git'))) {
    try {
      execFileSync('git', ['-C', WEBSITE_DIR, 'add', ...files]);
      execFileSync('git', ['-C', WEBSITE_DIR, 'commit', '-q', '-m', message, '--', ...files]);
      entry.commit = execFileSync('git', ['-C', WEBSITE_DIR, 'rev-parse', '--short', 'HEAD']).toString().trim();
      console.log(`  committed ${entry.commit}: ${message}`);
    } catch (e) { console.warn(`  (git commit skipped: ${e.message.split('\n')[0]})`); }
  }
  return entry;
}
