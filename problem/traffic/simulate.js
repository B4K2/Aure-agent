#!/usr/bin/env node
// Virtual users for the VOID store. Each user is a browser session that behaves like the real SPA:
// a full page load (HTML + JS + CSS + favicon), then client-side navigation that only calls the APIs
// the React pages call, loads product images once per session, types in search (one request per
// keystroke, like Shop.jsx), signs up / logs in, builds a cart, checks out or abandons, and retries
// or bounces when the site misbehaves. Think times are log-normal, so the load is bursty like real traffic.
//
//   node traffic/simulate.js [--users 20] [--duration 10m] [--ramp 30s] [--profile normal|flash-sale] [--url http://localhost:4000]
import { BASE_URL, parseDuration, sleep } from '../lib/config.js';
import { statePath, readJSON, writeJSON } from '../lib/state.js';

// ---------- options ----------
const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map((kv) => {
  const [k, ...v] = kv.trim().split(/\s+/);
  return [k, v.join(' ') || true];
}));
const URL_ = (args.url || BASE_URL).replace(/\/$/, '');
const USERS = Number(args.users || 20);
const DURATION = parseDuration(args.duration || 0);
const RAMP = parseDuration(args.ramp || '30s');
const PROFILE = args.profile || 'normal';
const TAG = args.tag || 'traffic';
const QUIET = !!args.quiet;

const PROFILES = {
  // persona weights + think-time median (ms)
  normal: { think: 2500, personas: { browser: 45, shopper: 25, buyer: 18, returning: 10, clumsy: 2 } },
  'flash-sale': { think: 600, personas: { browser: 15, shopper: 25, buyer: 45, returning: 15, clumsy: 0 } },
};
const prof = PROFILES[PROFILE] || PROFILES.normal;

// ---------- helpers ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const int = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const weighted = (obj) => {
  let r = Math.random() * Object.values(obj).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(obj)) if ((r -= w) <= 0) return k;
  return Object.keys(obj)[0];
};
// log-normal think time around the profile median
const think = (scale = 1) => sleep(Math.min(30000, prof.think * scale * Math.exp(0.6 * (Math.random() + Math.random() + Math.random() - 1.5) * 2)));

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
];
const FIRST = ['ava', 'liam', 'noah', 'emma', 'mia', 'kai', 'zoe', 'arjun', 'priya', 'leo', 'sara', 'omar', 'yuki', 'nina', 'ravi', 'chloe', 'mateo', 'aisha'];
const LAST = ['smith', 'khan', 'patel', 'garcia', 'kim', 'nguyen', 'brown', 'rossi', 'sato', 'mehta', 'lopez', 'cohen', 'singh', 'muller'];
const SEARCHES = ['run', 'max', 'low', 'dunk', 'phantom', 'court', 'trail', 'knit', 'hi', 'glide', 'retro', 'zoom', 'air'];
const CATEGORIES = ['Running', 'Lifestyle', 'Basketball', 'Skate', 'Training', 'Trail'];
const STREETS = ['Market St', 'Oak Ave', 'Elm Rd', 'MG Road', 'King St', 'Baker St', 'Sunset Blvd'];
const CITIES = ['Austin', 'Pune', 'Berlin', 'Toronto', 'Leeds', 'Osaka', 'Lisbon'];

// Accounts persist across runs so "returning" users can log in.
const ACCOUNTS_FILE = statePath('accounts.json');
const accounts = readJSON(ACCOUNTS_FILE, []);
let accountsDirty = false;
setInterval(() => { if (accountsDirty) { writeJSON(ACCOUNTS_FILE, accounts.slice(-5000)); accountsDirty = false; } }, 5000).unref();

// ---------- stats ----------
const win = { n: 0, err5: 0, err4: 0, fail: 0, lat: [] };
const tot = { n: 0, err5: 0, err4: 0, fail: 0, sessions: 0, orders: 0, signups: 0, abandoned: 0, bounced: 0 };
let activeUsers = 0;
const t0 = Date.now();
function report() {
  const s = [...win.lat].sort((a, b) => a - b);
  const q = (p) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : 0);
  const secs = 10;
  console.log(`${new Date().toISOString()} [${TAG}] users=${activeUsers} rps=${(win.n / secs).toFixed(1)} ` +
    `p50=${q(0.5)}ms p95=${q(0.95)}ms p99=${q(0.99)}ms 5xx=${win.err5} 4xx=${win.err4} timeouts/conn=${win.fail} | ` +
    `total req=${tot.n} sessions=${tot.sessions} signups=${tot.signups} orders=${tot.orders} abandoned=${tot.abandoned} bounced=${tot.bounced}`);
  Object.assign(win, { n: 0, err5: 0, err4: 0, fail: 0, lat: [] });
}
if (!QUIET) setInterval(report, 10000).unref();

class SiteError extends Error {}

// ---------- one browser session ----------
class VirtualUser {
  constructor() {
    this.ua = pick(UAS);
    this.mobile = /iPhone|Android/.test(this.ua);
    this.token = null;
    this.account = null;
    this.cart = [];
    this.loadedImages = new Set();
    this.catalog = [];
    this.patience = int(1, 3); // failures tolerated before leaving
  }

  async req(path, { method = 'GET', body, json = true, auth = false } = {}) {
    const start = performance.now();
    let res;
    try {
      res = await fetch(URL_ + path, {
        method,
        headers: {
          'User-Agent': this.ua,
          Accept: json ? 'application/json' : '*/*',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          Referer: URL_ + '/',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const data = json ? await res.json().catch(() => ({})) : await res.arrayBuffer().then(() => null);
      this.record(performance.now() - start, res.status);
      if (res.status >= 500) throw new SiteError(`${method} ${path} -> ${res.status}`);
      return { status: res.status, data, res };
    } catch (e) {
      if (e instanceof SiteError) throw e;
      this.record(performance.now() - start, 0);
      throw new SiteError(`${method} ${path} -> ${e.name === 'TimeoutError' ? 'timeout' : e.cause?.code || e.message}`);
    }
  }

  record(ms, status) {
    win.n++; tot.n++; win.lat.push(ms);
    if (status === 0) { win.fail++; tot.fail++; }
    else if (status >= 500) { win.err5++; tot.err5++; }
    else if (status >= 400) { win.err4++; tot.err4++; }
  }

  // Browser fetches in parallel (~6 connections per host).
  async parallel(tasks, limit = 6) {
    const queue = [...tasks];
    const results = [];
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) results.push(await queue.shift()().catch((e) => e));
    }));
    const err = results.find((r) => r instanceof SiteError);
    if (err) throw err;
    return results;
  }

  async images(products) {
    const todo = products.map((p) => p.image).filter((src) => src && !this.loadedImages.has(src));
    todo.forEach((s) => this.loadedImages.add(s));
    // images failing don't break the page, but they do count as traffic
    await this.parallel(todo.map((src) => () => this.req(src, { json: false }).catch(() => {})));
  }

  // Hard navigation: HTML + bundle. No caching on this site, so everything is re-downloaded.
  async fullLoad(path) {
    const { res } = await this.req(path, { json: false });
    if (!res.ok) throw new SiteError(`page ${path} -> ${res.status}`);
    if (!VirtualUser.assets) {
      const html = await (await fetch(URL_ + '/')).text();
      VirtualUser.assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg))"/g)].map((m) => m[1]);
    }
    await this.parallel(VirtualUser.assets.map((a) => () => this.req(a, { json: false })));
  }

  // Each page = the API calls its React component makes on mount.
  async home() {
    const [p] = await this.parallel([() => this.req('/api/products'), () => this.req('/api/stats')]);
    this.catalog = Array.isArray(p.data) ? p.data : this.catalog;
    await this.images(this.catalog.slice(0, this.mobile ? 4 : 8));
  }

  async shop() {
    let category = 'All', sort = '', q = '';
    const list = () => this.req(`/api/products?${new URLSearchParams({ category, sort, q })}`);
    let { data } = await list();
    await this.images(data);
    if (chance(0.4)) { await think(0.5); category = pick(CATEGORIES); ({ data } = await list()); await this.images(data); }
    if (chance(0.25)) { await think(0.4); sort = pick(['price-asc', 'price-desc']); ({ data } = await list()); }
    if (chance(0.35)) {
      // typing: one request per keystroke (useEffect on q)
      category = 'All';
      const term = pick(SEARCHES);
      for (const ch of term) { q += ch; await sleep(rnd(90, 260)); ({ data } = await list()); }
      await this.images(data);
    }
    if (Array.isArray(data) && data.length) this.catalog = data;
  }

  async product(p) {
    const ref = chance(0.5) ? p.slug : p.id;
    const { data, status } = await this.req(`/api/products/${ref}`);
    if (status === 200) await this.images([data]);
    return status === 200 ? data : null;
  }

  async browseProducts(n) {
    let last = null;
    for (let i = 0; i < n && this.catalog.length; i++) {
      await think();
      last = (await this.product(pick(this.catalog))) || last;
    }
    return last;
  }

  addToCart(p) {
    const size = pick(p.sizes || [9, 10]);
    const ex = this.cart.find((x) => x.id === p.id && x.size === size);
    if (ex) ex.qty++; else this.cart.push({ id: p.id, size, qty: 1 });
  }

  async signup() {
    const f = pick(FIRST), l = pick(LAST);
    const acct = { email: `${f}.${l}${int(1, 99999)}@${pick(['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com'])}`,
      password: `${pick(LAST)}${int(100, 9999)}!`, name: `${f[0].toUpperCase() + f.slice(1)} ${l[0].toUpperCase() + l.slice(1)}` };
    await think(1.5); // filling the form
    const { status, data } = await this.req('/api/auth/signup', { method: 'POST', body: acct });
    if (status === 201) { this.token = data.token; this.account = acct; accounts.push(acct); accountsDirty = true; tot.signups++; }
    return status === 201;
  }

  async login(acct = pick(accounts)) {
    if (!acct) return this.signup();
    await think(0.8);
    const typo = chance(0.06);
    const { status, data } = await this.req('/api/auth/login', { method: 'POST', body: { email: acct.email, password: typo ? acct.password + 'x' : acct.password } });
    if (status === 200) { this.token = data.token; this.account = acct; return true; }
    if (typo) { await think(0.6); return this.login(acct); }
    return false;
  }

  async ensureAuth() {
    if (this.token) return true;
    return chance(accounts.length > 20 ? 0.5 : 0.1) ? this.login() : this.signup();
  }

  async checkout() {
    if (!this.cart.length) return false;
    if (!(await this.ensureAuth())) return false;
    await this.req('/api/auth/me', { auth: true });
    await think(2); // typing the address
    const { status } = await this.req('/api/orders', { method: 'POST', auth: true,
      body: { items: this.cart, address: `${int(1, 999)} ${pick(STREETS)}, ${pick(CITIES)} ${int(10000, 99999)}` } });
    if (status === 201) { tot.orders++; this.cart = []; return true; }
    return false;
  }

  async viewOrders() {
    if (!this.token) return;
    await this.req('/api/orders', { auth: true });
  }

  // ---------- personas ----------
  async run(persona) {
    const entry = weighted({ '/': 60, '/shop': 20, [`/product/${int(1, 16)}`]: 20 });
    await this.fullLoad(entry);
    if (entry === '/shop') await this.shop(); else await this.home();
    if (entry.startsWith('/product')) await this.product({ id: entry.split('/').pop(), slug: entry.split('/').pop() });
    if (chance(0.12)) { tot.bounced++; return; }

    switch (persona) {
      case 'browser': {
        await think(); await this.shop();
        await this.browseProducts(int(1, 4));
        if (chance(0.3)) { await think(); await this.home(); }
        break;
      }
      case 'shopper': {
        await think(); await this.shop();
        const p = await this.browseProducts(int(2, 5));
        if (p) this.addToCart(p);
        if (chance(0.4)) { const q = await this.browseProducts(1); if (q) this.addToCart(q); }
        if (chance(0.35)) await this.checkout(); else tot.abandoned++;
        break;
      }
      case 'buyer': {
        if (PROFILE === 'flash-sale') {
          // everyone wants the featured drop
          const featured = this.catalog.filter((p) => p.featured);
          const p = await this.product(pick(featured.length ? featured : this.catalog));
          if (p) this.addToCart(p);
        } else {
          if (chance(0.6)) { await think(); await this.shop(); }
          const p = await this.browseProducts(int(1, 3));
          if (p) this.addToCart(p);
        }
        if (await this.checkout()) { await think(0.5); await this.viewOrders(); }
        break;
      }
      case 'returning': {
        if (!(await this.login())) break;
        await think(); await this.viewOrders();
        if (chance(0.5)) {
          const p = await this.browseProducts(int(1, 3));
          if (p && chance(0.6)) { this.addToCart(p); await this.checkout(); }
        }
        break;
      }
      case 'clumsy': {
        // the long tail of real traffic: dead links, bad logins, junk input
        await this.req(`/api/products/${pick(['air-max-90', '9999', 'undefined', 'null'])}`);
        await this.req('/api/auth/login', { method: 'POST', body: { email: `${pick(FIRST)}@example.com`, password: 'password' } });
        await this.req('/api/orders', { auth: true });
        await this.req('/api/auth/signup', { method: 'POST', body: { email: 'not-an-email', password: '123' } });
        break;
      }
    }
    if (this.token && chance(0.15)) { await think(); await this.home(); } // poke around after
  }

  async session() {
    const persona = weighted(prof.personas);
    for (;;) {
      try { await this.run(persona); return; } catch (e) {
        if (!(e instanceof SiteError)) throw e;
        if (--this.patience < 0) { tot.bounced++; return; }
        await sleep(rnd(1000, 4000)); // annoyed user hits refresh
      }
    }
  }
}

// ---------- driver ----------
let stopping = false;
async function slot(delay) {
  await sleep(delay);
  while (!stopping) {
    activeUsers++; tot.sessions++;
    try { await new VirtualUser().session(); } catch (e) { console.error('bug in simulator:', e); }
    activeUsers--;
    await sleep(rnd(200, prof.think)); // next visitor arrives
  }
}

console.log(`[${TAG}] ${USERS} virtual users (${PROFILE}) -> ${URL_}, ramp ${RAMP / 1000}s, duration ${DURATION ? DURATION / 1000 + 's' : 'until Ctrl-C'}`);
const slots = Array.from({ length: USERS }, (_, i) => slot((RAMP * i) / USERS + rnd(0, 500)));
const finish = () => {
  if (stopping) process.exit(0);
  stopping = true;
  report();
  if (accountsDirty) writeJSON(ACCOUNTS_FILE, accounts.slice(-5000));
  console.log(`[${TAG}] stopping (sessions finishing; Ctrl-C again to force)`);
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', finish);
process.on('SIGTERM', finish);
if (DURATION) setTimeout(finish, DURATION);
await Promise.all(slots);
process.exit(0);
