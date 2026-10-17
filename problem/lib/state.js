import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';

fs.mkdirSync(STATE_DIR, { recursive: true });
const FILE = path.join(STATE_DIR, 'active.json');

export const statePath = (name) => path.join(STATE_DIR, name);
export const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
export const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

export const active = () => readJSON(FILE, {});
export function setActive(name, info) {
  const all = active();
  if (info) all[name] = { startedAt: new Date().toISOString(), ...info };
  else delete all[name];
  writeJSON(FILE, all);
}

export const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
