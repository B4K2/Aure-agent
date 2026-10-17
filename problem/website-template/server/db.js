import pg from 'pg';
import { products } from './products.js';

// NUMERIC comes back as a string by default; prices are small, so parse to float.
pg.types.setTypeParser(1700, parseFloat);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://void:void@localhost:5433/void',
  max: Number(process.env.PG_POOL_MAX || 10),
});

export const query = (text, params) => pool.query(text, params);

export async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      colorway TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      rating NUMERIC(2,1) NOT NULL,
      stock INTEGER NOT NULL,
      image TEXT NOT NULL,
      sizes INTEGER[] NOT NULL,
      description TEXT NOT NULL,
      history INTEGER[] NOT NULL,
      featured BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total NUMERIC(10,2) NOT NULL,
      address TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      size INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      price NUMERIC(10,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
    CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
  `);

  // Seed the catalog once; existing rows are left alone.
  for (const p of products) {
    await query(
      `INSERT INTO products (id, slug, name, category, colorway, price, rating, stock, image, sizes, description, history, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.slug, p.name, p.category, p.colorway, p.price, p.rating, p.stock, p.image, p.sizes, p.description, p.history, p.featured]
    );
  }
}
