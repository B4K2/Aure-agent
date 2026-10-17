import pg from 'pg';
import { spawnDetached, stop, terminateSessions } from '../lib/background.js';
import { DATABASE_URL, sleep } from '../lib/config.js';
import { restart, snapshot, healthy } from '../lib/server.js';

export default {
  name: 'db-connection-exhaustion',
  category: 'db exhaustion',
  kind: 'process',
  summary: 'A runaway "report-worker" opens almost every Postgres connection slot and sits on them.',
  symptoms: 'Default: the app is restarted while the worker holds every slot, fails to boot ("Failed to connect to Postgres: sorry, too many clients already") -> full outage. With --no-restart: 500s with "too many clients" once the app needs a new connection (traffic burst). pg_stat_activity is full of application_name=report-worker.',
  fix: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'report-worker'; then restart the app if it is down.",
  async inject(opts) {
    const c = new pg.Client(DATABASE_URL);
    await c.connect();
    const { rows: [r] } = await c.query(`SELECT current_setting('max_connections')::int AS max, current_setting('superuser_reserved_connections')::int AS reserved`);
    await c.end();
    const max = Number(opts.connections || r.max); // the void role is a superuser, so take the reserved slots too
    console.log(`  max_connections=${r.max}; worker will grab up to ${max}`);
    snapshot();
    const info = spawnDetached(this.name, 'lib/holder.js', ['connections', JSON.stringify({ max, appName: 'report-worker', seconds: opts.durationSec })]);
    // The app keeps its warm pool connections, so it only feels this once it needs a new one.
    // Restart it now (the worker grabs the slots it frees); --no-restart waits for a traffic burst instead.
    if (opts.restart !== false) { await sleep(3000); console.log('  restarting app so it has to reconnect…'); await restart({ expectDown: true, beforeStart: () => sleep(3000) }); }
    return info;
  },
  async recover(info) {
    await stop(info.pid);
    await terminateSessions('report-worker');
    await sleep(2000);
    if (!(await healthy())) { console.log('  app is not healthy — restarting it'); await restart(); }
  },
};
