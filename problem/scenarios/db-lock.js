import { spawnDetached, stop, terminateSessions } from '../lib/background.js';

export default {
  name: 'db-lock',
  category: 'db lock contention',
  kind: 'process',
  summary: 'A "migration" takes an ACCESS EXCLUSIVE lock on orders and never commits.',
  symptoms: 'Checkout, account orders and /api/stats (home page) hang; pool fills with waiting queries, then the whole site slows; pg_locks shows waiters behind application_name=migrate_orders_add_status.',
  fix: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'migrate_orders_add_status';",
  async inject(opts) {
    const table = opts.table || 'orders';
    return spawnDetached(this.name, 'lib/holder.js', ['lock', JSON.stringify({ table, appName: 'migrate_orders_add_status', seconds: opts.durationSec })]);
  },
  async recover(info) { await stop(info.pid); await terminateSessions('migrate_orders_add_status'); },
};
