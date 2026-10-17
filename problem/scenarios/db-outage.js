import { execFileSync } from 'node:child_process';
import { DB_CONTAINER, sleep } from '../lib/config.js';
import { healthy, restart, snapshot } from '../lib/server.js';

const docker = (...a) => execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

export default {
  name: 'db-outage',
  category: 'dependency down',
  kind: 'infra',
  summary: 'The Postgres container stops.',
  symptoms: 'All DB-backed endpoints 500 / ECONNREFUSED, /api/health fails. Note: the app has no pool "error" handler, so it may crash too.',
  fix: `docker start ${DB_CONTAINER}, then restart the app if it died.`,
  async inject() {
    snapshot();
    console.log(`  docker stop ${DB_CONTAINER}`);
    docker('stop', DB_CONTAINER);
    return {};
  },
  async recover() {
    console.log(`  docker start ${DB_CONTAINER}`);
    docker('start', DB_CONTAINER);
    for (let i = 0; i < 40 && docker('inspect', '-f', '{{.State.Health.Status}}', DB_CONTAINER) !== 'healthy'; i++) await sleep(500);
    await sleep(1000);
    if (!(await healthy())) { console.log('  app is not healthy — restarting it'); await restart(); }
  },
};
