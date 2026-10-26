// Finds the running website process, remembers how it was launched, and restarts it
// (needed after code-patch scenarios — a "deploy"). Supports plain node and the docker-compose app.
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { BASE_URL, PORT, WEBSITE_DIR, APP_CONTAINER, RUNTIME, sleep } from './config.js';
import { deploy } from './k8s.js';
import { statePath, readJSON, writeJSON } from './state.js';

const LAUNCH = statePath('server-launch.json');
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };

export async function healthy(timeoutMs = 3000) {
  try { return (await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })).ok; } catch { return false; }
}

const dockerApp = () => sh('docker', ['ps', '--filter', `name=^${APP_CONTAINER}$`, '--format', '{{.Names}}']).trim();

function listeningPid() {
  const m = sh('ss', ['-ltnpH', `sport = :${PORT}`]).match(/pid=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Record how the server was started so we can start it again even after it crashed. */
export function snapshot() {
  if (RUNTIME === 'kubernetes') return null;
  const pid = listeningPid();
  if (!pid) return readJSON(LAUNCH, null);
  try {
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean)
      .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
    const ppid = Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
    const parent = fs.readFileSync(`/proc/${ppid}/cmdline`, 'utf8');
    const info = { pid, argv, cwd: fs.readlinkSync(`/proc/${pid}/cwd`), env, watch: parent.includes('--watch') };
    writeJSON(LAUNCH, info);
    return info;
  } catch { return readJSON(LAUNCH, null); }
}

async function waitFor(pred, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await pred()) return true;
  return false;
}

/** Restart (or start) the website. Returns true if it comes back healthy. */
export async function restart({ expectDown = false, beforeStart } = {}) {
  if (RUNTIME === 'kubernetes') {
    await beforeStart?.();
    deploy({ waitSec: expectDown ? 30 : 120 });
  } else if (dockerApp()) {
    console.log('  rebuilding docker app container (docker compose --profile app up -d --build app)…');
    execFileSync('docker', ['compose', '--profile', 'app', 'up', '-d', '--build', 'app'], { cwd: WEBSITE_DIR, stdio: 'inherit' });
  } else {
    const info = snapshot();
    if (!info) { console.log(`  ! no server on :${PORT} and no saved launch info — start the website yourself.`); return false; }
    if (info.watch && listeningPid()) {
      console.log('  server runs under node --watch; it reloads itself.');
    } else {
      const pid = listeningPid();
      if (pid) {
        process.kill(pid, 'SIGTERM');
        if (!(await waitFor(() => !listeningPid(), 8000))) { try { process.kill(pid, 'SIGKILL'); } catch {} await sleep(500); }
      }
      await beforeStart?.();
      const log = fs.openSync(statePath('server.log'), 'a');
      const child = spawn(info.argv[0], info.argv.slice(1), { cwd: info.cwd, env: info.env, detached: true, stdio: ['ignore', log, log] });
      child.unref();
      console.log(`  restarted website: pid ${child.pid} (${info.argv.join(' ')}) — logs: problem/.state/server.log`);
    }
  }
  const ok = await waitFor(() => healthy(1000), expectDown ? 8000 : 30000);
  console.log(ok ? '  website is healthy.' : '  ! website is NOT healthy after restart' + (expectDown ? ' (expected for this scenario).' : '.'));
  return ok;
}
