# VOID — Sneaker store (test target)

Black & white sneaker storefront: React (Vite) frontend + Node/Express backend + PostgreSQL.
Meant as a demo app for Aura to watch and break.

## Run
```bash
docker compose up -d db   # Postgres 17 on localhost:5433 (user/pass/db: void)
npm run install:all
npm start                 # builds client, serves everything on http://localhost:4000
```
The server creates the tables and seeds the 16 products on startup. Connection string comes from
`DATABASE_URL` (default `postgres://void:void@localhost:5433/void`); pool size from `PG_POOL_MAX` (default 10).

Tables: `users`, `products`, `orders`, `order_items`.
Inspect: `docker exec -it test-website-db-1 psql -U void -d void`

Whole stack in Docker: `docker compose --profile app up -d --build`
Dev mode (hot reload): `npm run dev:server` + `npm run dev:client` (http://localhost:5173, proxies /api).


## Endpoints
- `GET /api/products`, `/api/products/:id`, `/api/stats`
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/orders`, `GET /api/orders` (Bearer token)
- `GET /api/health` (also pings the DB), `GET /metrics` (Prometheus: `http_request_duration_seconds`, `orders_total`, `signups_total`, `pg_pool_connections`, process metrics)

## No caching
Every response (HTML, JS, CSS, images, API) is sent with `Cache-Control: no-store`; ETag and Last-Modified are disabled, so the
browser re-downloads everything on every visit (no 304s). Frontend fetches also use `cache: 'no-store'`.
