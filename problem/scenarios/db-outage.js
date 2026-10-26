import { execFileSync } from 'node:child_process';
import { DB_CONTAINER, RUNTIME, sleep } from '../lib/config.js';
import { healthy, restart, snapshot } from '../lib/server.js';
import { scaleDb } from '../lib/k8s.js';

const docker = (...a) => execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

export default {
  name: 'db-outage',
  category: 'dependency down',
  kind: 'infra',
  summary: 'The Postgres container stops (on Kubernetes: the void-db StatefulSet is scaled to 0).',
  symptoms: 'All DB-backed endpoints 500 / ECONNREFUSED, /api/health fails. Note: the app has no pool "error" handler, so it may crash too.',
  fix: `docker start ${DB_CONTAINER} (Kubernetes: scale statefulset/void-db to 1), then restart the app if it died.`,
  async inject() {
    snapshot();
    if (RUNTIME === 'kubernetes') { scaleDb(0); return {}; }
    console.log(`  docker stop ${DB_CONTAINER}`);
    docker('stop', DB_CONTAINER);
    return {};
  },
  async recover() {
    if (RUNTIME === 'kubernetes') scaleDb(1);
    else await startContainer();
    await sleep(1000);
    if (!(await healthy())) { console.log('  app is not healthy — restarting it'); await restart(); }
  },
};

async function startContainer() {
  console.log(`  docker start ${DB_CONTAINER}`);
  docker('start', DB_CONTAINER);
  for (let i = 0; i < 40 && docker('inspect', '-f', '{{.State.Health.Status}}', DB_CONTAINER) !== 'healthy'; i++) await sleep(500);
}
