// Background DB troublemaker. Run detached by scenarios:
//   node lib/holder.js connections '{"max":95,"appName":"report-worker"}'
//   node lib/holder.js lock '{"table":"orders","appName":"migrate_orders_add_status"}'
// Exits on its own when its sessions are killed (pg_terminate_backend) — that's a valid fix.
import pg from 'pg';
import { DATABASE_URL, sleep } from './config.js';

const [mode, raw = '{}'] = process.argv.slice(2);
const opts = JSON.parse(raw);
const log = (...a) => console.log(new Date().toISOString(), `[${mode}]`, ...a);
const clients = new Set();
const connect = async () => {
  const c = new pg.Client({ connectionString: DATABASE_URL, application_name: opts.appName });
  await c.connect();
  clients.add(c);
  c.on('error', (e) => { log('session lost:', e.message); clients.delete(c); if (!clients.size) { log('all sessions gone, exiting'); process.exit(0); } });
  return c;
};
const shutdown = async () => { log('stopping'); await Promise.allSettled([...clients].map((c) => c.end())); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (mode === 'connections') {
  // Grab slots for a while (the app's idle pool connections time out after ~10s and free theirs).
  const until = Date.now() + (opts.grabMs ?? 30000);
  while (Date.now() < until && clients.size < opts.max) {
    try { await connect(); } catch (e) { await sleep(200); }
  }
  log(`holding ${clients.size} connections`);
  // Look like a busy worker: each session runs a short query now and then.
  setInterval(() => { for (const c of clients) c.query('SELECT count(*) FROM products').catch(() => {}); }, 15000);
} else if (mode === 'lock') {
  const c = await connect();
  await c.query('BEGIN');
  await c.query(`LOCK TABLE ${opts.table} IN ACCESS EXCLUSIVE MODE`);
  log(`holding ACCESS EXCLUSIVE lock on ${opts.table}`);
  // Long "migration" statement keeps the session active (visible in pg_stat_activity).
  c.query(`SELECT pg_sleep(${Math.ceil((opts.seconds ?? 86400))})`).catch(() => {});
} else {
  console.error('unknown mode', mode);
  process.exit(1);
}
if (opts.seconds) setTimeout(shutdown, opts.seconds * 1000);
