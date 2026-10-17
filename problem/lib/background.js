// Spawn long-running injector processes (connection hogs, lock holders, traffic) detached from the CLI.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROBLEM_DIR } from './config.js';
import { statePath, isAlive } from './state.js';
import { sleep } from './config.js';

export function spawnDetached(name, script, args = []) {
  const logFile = statePath(`${name}.log`);
  const log = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(PROBLEM_DIR, script), ...args], { cwd: PROBLEM_DIR, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return { pid: child.pid, log: path.relative(process.cwd(), logFile) };
}

export async function stop(pid) {
  if (!pid || !isAlive(pid)) return;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 20 && isAlive(pid); i++) await sleep(250);
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
}

// Killing a client doesn't end its Postgres backend (a running pg_sleep keeps the lock), so terminate server-side too.
export async function terminateSessions(appName) {
  const { default: pg } = await import('pg');
  const { DATABASE_URL } = await import('./config.js');
  const c = new pg.Client(DATABASE_URL);
  await c.connect();
  const { rowCount } = await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()', [appName]);
  await c.end();
  if (rowCount) console.log(`  terminated ${rowCount} postgres session(s) of ${appName}`);
}
