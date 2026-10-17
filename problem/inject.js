#!/usr/bin/env node
// Failure injection CLI for the VOID test website.
//   node inject.js list
//   node inject.js <scenario> [--duration 5m] [--no-restart] [scenario options]
//   node inject.js status
//   node inject.js recover <scenario|all>
import fs from 'node:fs';
import path from 'node:path';
import { PROBLEM_DIR, parseDuration } from './lib/config.js';
import { active, setActive, isAlive } from './lib/state.js';
import { healthy } from './lib/server.js';

const dir = path.join(PROBLEM_DIR, 'scenarios');
const scenarios = Object.fromEntries(await Promise.all(fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .map(async (f) => { const s = (await import(path.join(dir, f))).default; return [s.name, s]; })));

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--no-')) opts[a.slice(5)] = false;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(a);
  }
  return { pos, opts };
}

// A background injector that died (duration elapsed, or the agent killed its sessions) is no longer active.
function liveState() {
  const all = active();
  for (const [name, info] of Object.entries(all))
    if (info.pid && !isAlive(info.pid)) { console.log(`(${name}: background process ${info.pid} has exited — marking ended)`); setActive(name, null); delete all[name]; }
  return all;
}

const { pos: [cmd, arg], opts } = parseArgs(process.argv.slice(2));

if (!cmd || cmd === 'list' || cmd === 'help') {
  console.log('Scenarios:\n');
  for (const s of Object.values(scenarios)) console.log(`  ${s.name.padEnd(26)} [${s.category}]\n  ${' '.repeat(26)} ${s.summary}\n`);
  console.log('Usage: node inject.js <scenario> [--duration 5m] [--no-restart] | status | recover <scenario|all>');
  console.log('       node inject.js show <scenario>   # symptoms + expected fix (answer key, keep it from the agent)');
} else if (cmd === 'show') {
  const s = scenarios[arg];
  if (!s) throw new Error(`Unknown scenario "${arg}"`);
  console.log(`${s.name} [${s.category}]\n\n${s.summary}\n\nSymptoms: ${s.symptoms}\nFix:      ${s.fix}`);
} else if (cmd === 'status') {
  const all = liveState();
  console.log(`website: ${(await healthy()) ? 'healthy' : 'DOWN / unhealthy'}`);
  if (!Object.keys(all).length) console.log('no active problems');
  for (const [name, info] of Object.entries(all)) console.log(`  ${name.padEnd(26)} since ${info.startedAt}${info.pid ? `  pid ${info.pid}  log ${info.log}` : ''}`);
} else if (cmd === 'recover') {
  const all = liveState();
  const names = arg === 'all' ? Object.keys(all) : [arg];
  if (!arg) throw new Error('recover what? give a scenario name or "all"');
  for (const name of names) {
    const s = scenarios[name];
    if (!s) throw new Error(`Unknown scenario "${name}"`);
    console.log(`recovering ${name}…`);
    await s.recover(all[name] || {}, opts);
    setActive(name, null);
  }
  if (!names.length) console.log('nothing active');
} else {
  const s = scenarios[cmd];
  if (!s) { console.error(`Unknown scenario "${cmd}". Run: node inject.js list`); process.exit(1); }
  if (liveState()[cmd]) { console.error(`${cmd} is already active. Recover it first: node inject.js recover ${cmd}`); process.exit(1); }
  if (opts.duration) opts.durationSec = parseDuration(opts.duration) / 1000;
  console.log(`injecting ${s.name}…`);
  const info = await s.inject(opts);
  setActive(s.name, info);
  if (info.pid) console.log(`  background pid ${info.pid}, log ${info.log}${opts.duration ? `, auto-stops after ${opts.duration}` : ''}`);
  console.log(`done. Undo with: node inject.js recover ${s.name}`);
}
