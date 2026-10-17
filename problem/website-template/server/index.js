import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import client from 'prom-client';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, pool, init } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ---------- Metrics (Prometheus) ----------
client.collectDefaultMetrics();
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
const ordersTotal = new client.Counter({ name: 'orders_total', help: 'Orders placed' });
const signupsTotal = new client.Counter({ name: 'signups_total', help: 'Accounts created' });
new client.Gauge({
  name: 'pg_pool_connections',
  help: 'Postgres pool connections by state',
  labelNames: ['state'],
  collect() {
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
  },
});

const app = express();
app.disable('etag'); // no 304s — every request returns a full body
app.disable('x-powered-by');
app.use(express.json());

// Disable ALL caching so every page load hits the server from scratch.
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path || (req.path.startsWith('/images') ? '/images' : req.path.startsWith('/api') ? req.path : 'static');
    end({ method: req.method, route, status: res.statusCode });
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

const staticOpts = { etag: false, lastModified: false, cacheControl: false, maxAge: 0 };
app.use('/images', express.static(path.join(__dirname, 'images'), staticOpts));

// Express 4 doesn't catch rejected promises — forward them to the error handler.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- Auth helpers ----------
const sign = (u) => jwt.sign({ id: u.id, email: u.email, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

// ---------- API ----------
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1');
  res.json({ status: 'ok', db: 'ok', uptime: process.uptime() });
}));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id, email, name`,
    [email.toLowerCase(), name || email.split('@')[0], hash]
  );
  if (!rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
  signupsTotal.inc();
  res.status(201).json({ token: sign(rows[0]), user: rows[0] });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password || '', row.password_hash)))
    return res.status(401).json({ error: 'Invalid email or password' });
  const user = { id: row.id, email: row.email, name: row.name };
  res.json({ token: sign(user), user });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/products', wrap(async (req, res) => {
  const { category, q, sort } = req.query;
  const where = [];
  const params = [];
  if (category && category !== 'All') {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`name ILIKE $${params.length}`);
  }
  const order = sort === 'price-asc' ? 'price ASC' : sort === 'price-desc' ? 'price DESC' : 'id ASC';
  const { rows } = await query(
    `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`,
    params
  );
  res.json(rows);
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM products WHERE id::text = $1 OR slug = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.get('/api/stats', wrap(async (req, res) => {
  // Fake "market" curve for the homepage chart, plus real counts from the DB.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const { rows } = await query(
    `SELECT (SELECT COUNT(*) FROM orders)::int AS orders,
            (SELECT COUNT(*) FROM users)::int AS users,
            (SELECT COUNT(*) FROM products)::int AS products`
  );
  res.json({
    drops: months.map((m, i) => ({ month: m, value: Math.round(40 + i * 9 + Math.sin(i) * 18) })),
    ...rows[0],
  });
}));

app.post('/api/orders', auth, wrap(async (req, res) => {
  const { items, address } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
  if (!address) return res.status(400).json({ error: 'Shipping address required' });

  const ids = items.map((it) => Number(it.id));
  const { rows: found } = await query('SELECT id, name, image, price FROM products WHERE id = ANY($1)', [ids]);
  const byId = new Map(found.map((p) => [p.id, p]));
  if (ids.some((id) => !byId.has(id))) return res.status(400).json({ error: 'Unknown product in cart' });

  const clean = items.map(({ id, size, qty }) => {
    const p = byId.get(Number(id));
    return { id: p.id, name: p.name, image: p.image, price: p.price, size: Number(size), qty: Math.max(1, Number(qty) || 1) };
  });
  const total = clean.reduce((s, it) => s + it.price * it.qty, 0);

  // Order + its line items go in one transaction.
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query(
      'INSERT INTO orders (user_id, total, address) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, total, address]
    );
    const orderId = rows[0].id;
    for (const it of clean) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, size, qty, price) VALUES ($1, $2, $3, $4, $5)',
        [orderId, it.id, it.size, it.qty, it.price]
      );
    }
    await conn.query('COMMIT');
    ordersTotal.inc();
    res.status(201).json({ id: orderId, total, items: clean });
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}));

app.get('/api/orders', auth, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.total, o.address, o.created_at,
            COALESCE(json_agg(json_build_object(
              'id', p.id, 'name', p.name, 'image', p.image,
              'price', oi.price, 'size', oi.size, 'qty', oi.qty
            ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.id DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// ---------- Frontend (built React app) ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { ...staticOpts, index: false }));
  app.get(/^\/(?!api|images|metrics).*/, (req, res) => res.sendFile(path.join(dist, 'index.html'), { etag: false, lastModified: false }));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

init()
  .then(() =>
    app
      .listen(PORT, () => console.log(`VOID sneakers server on http://localhost:${PORT}`))
      .on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use — another server is running. Stop it with: kill $(lsof -t -i:${PORT})`);
          process.exit(1);
        }
        throw err;
      })
  )
  .catch((err) => {
    console.error('Failed to connect to Postgres:', err.message);
    process.exit(1);
  });
