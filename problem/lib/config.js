import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROBLEM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEBSITE_DIR = path.resolve(process.env.VOID_WEBSITE_DIR || path.join(PROBLEM_DIR, '..', 'test-website'));
export const STATE_DIR = path.join(PROBLEM_DIR, '.state');

export const BASE_URL = (process.env.VOID_URL || 'http://localhost:4000').replace(/\/$/, '');
export const PORT = Number(new URL(BASE_URL).port || 80);
export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://void:void@localhost:5433/void';
export const DB_CONTAINER = process.env.VOID_DB_CONTAINER || 'test-website-db-1';
export const APP_CONTAINER = process.env.VOID_APP_CONTAINER || 'test-website-app-1';

export function parseDuration(s) {
  if (s == null || s === '' || s === true) return 0;
  const m = String(s).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) throw new Error(`Bad duration "${s}" (use e.g. 30s, 5m, 1h)`);
  return Number(m[1]) * { ms: 1, s: 1e3, m: 60e3, h: 3600e3 }[m[2] || 's'];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
