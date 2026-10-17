import pg from 'pg';
import { deployScenario } from './_deploy.js';
import { DATABASE_URL } from '../lib/config.js';

const SEED_EMAIL = 'warehouse-import@void.internal';

async function withDb(fn) {
  const c = new pg.Client({ connectionString: DATABASE_URL, application_name: 'warehouse-import' });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export default deployScenario({
  name: 'slow-query',
  category: 'slow query',
  summary: 'Deploy adds a per-product "sold" correlated subquery on order_items (no index on product_id), and a bulk import grows order_items to millions of rows.',
  symptoms: 'GET /api/products p95 in seconds, Postgres CPU high, pool waiting > 0, home/shop pages slow; product detail + auth unaffected at first.',
  fix: 'Roll back the deploy, or CREATE INDEX ON order_items(product_id).',
  commit: 'catalog: show units sold on product cards',
  edits: [{
    file: 'server/index.js',
    find: '`SELECT * FROM products ${where',
    replace: '`SELECT products.*, (SELECT COALESCE(SUM(qty), 0) FROM order_items oi WHERE oi.product_id = products.id)::int AS sold FROM products ${where',
  }],
  async afterInject(opts) {
    const rows = Number(opts.rows || 3_000_000);
    console.log(`  importing ${rows.toLocaleString()} historical order_items (warehouse backfill)…`);
    await withDb(async (c) => {
      const { rows: [u] } = await c.query(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Warehouse Import', '!') ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SEED_EMAIL]);
      const { rows: [o] } = await c.query(`INSERT INTO orders (user_id, total, address) VALUES ($1, 0, 'warehouse backfill') RETURNING id`, [u.id]);
      await c.query(`INSERT INTO order_items (order_id, product_id, size, qty, price)
                     SELECT $1, 1 + (g % 16), 7 + (g % 7), 1 + (g % 3), 100 FROM generate_series(1, $2) g`, [o.id, rows]);
      await c.query('ANALYZE order_items');
    });
    console.log('  import done.');
  },
  async beforeRecover() {
    console.log('  removing backfilled order_items…');
    await withDb((c) => c.query('DELETE FROM users WHERE email = $1', [SEED_EMAIL]));
  },
});
