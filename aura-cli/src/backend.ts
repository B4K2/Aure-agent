// Connection to the Aura agent server (Python, ../agent). Starts it if it isn't running,
// reconnects forever, and hands every pushed event to the UI.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = process.env.AURA_AGENT_DIR || path.resolve(here, '..', '..', 'agent');

// ~/.aura/config.json → { "url": "http://host:8700", "token": "...", "web": "http://host:5173" }; env wins
// (§15: config, not hardcoding). With no token configured, a local CLI uses the one the agent generated.
function loadConfig() {
  let file: { url?: string; token?: string; web?: string } = {};
  try { file = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.aura', 'config.json'), 'utf8')); } catch {}
  const url = (process.env.AURA_URL || file.url || 'http://127.0.0.1:8700').replace(/\/$/, '');
  const web = (process.env.AURA_WEB_URL || file.web || 'http://localhost:5173').replace(/\/$/, '');
  return { url, web, token: process.env.AURA_API_TOKEN || file.token || '', local: /127\.0\.0\.1|localhost/.test(url) };
}

/** Re-read on every connect: a server we just spawned writes this file on its first boot. */
function agentToken(): string {
  try { return fs.readFileSync(path.join(AGENT_DIR, '.aura_state', 'api_token'), 'utf8').trim(); } catch { return ''; }
}

export type AuraEvent = { type: string; at?: string; [k: string]: any };

export class Backend {
  cfg = loadConfig();
  private ws?: WebSocket;
  private spawnedAt = 0; // last time we booted the agent server ourselves
  private closed = false;

  constructor(private onEvent: (e: AuraEvent) => void, private onStatus: (s: string) => void) {}

  start() { this.connect(); }

  stop() { this.closed = true; this.ws?.close(); }

  send(msg: object) {
    if (this.ws?.readyState !== WebSocket.OPEN) { this.onEvent({ type: 'error', message: 'not connected to the Aura server yet' }); return; }
    this.ws.send(JSON.stringify(msg));
  }

  /** The token this CLI connects with: configured, or (local agent) the one the agent generated. */
  token(): string { return this.cfg.token || (this.cfg.local ? agentToken() : ''); }

  /** Dashboard link that signs the browser in; the token rides in the fragment, which is never sent to a server. */
  webLink(): string { return `${this.cfg.web}/dashboard#token=${encodeURIComponent(this.token())}`; }

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(`${this.cfg.url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(this.token())}`);
    this.ws = ws;
    ws.on('open', () => this.onStatus('connected'));
    ws.on('message', (data) => { try { this.onEvent(JSON.parse(data.toString())); } catch {} });
    ws.on('close', (code) => {
      if (code === 4401) { this.onStatus('bad token'); return; }
      this.onStatus(Date.now() - this.spawnedAt < 30000 ? 'starting agent…' : 'reconnecting…');
      setTimeout(() => this.connect(), 1500);
    });
    ws.on('error', (err: any) => {
      // Boot (or re-boot, if it died or was restarted) the local server; give a boot 30 s before retrying.
      if (err.code === 'ECONNREFUSED' && this.cfg.local && Date.now() - this.spawnedAt > 30000) this.spawnServer();
    });
  }

  /** Local dev: boot the Python agent ourselves so `aura` is the only command you need. */
  private spawnServer() {
    this.spawnedAt = Date.now();
    this.onStatus('starting agent…');
    fs.mkdirSync(path.join(AGENT_DIR, '.aura_state'), { recursive: true });
    const log = fs.openSync(path.join(AGENT_DIR, '.aura_state', 'server.out'), 'a');
    const child = spawn('uv', ['run', 'python', '-m', 'aura.main'], { cwd: AGENT_DIR, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    this.onEvent({ type: 'system', text: `started agent server (pid ${child.pid}); logs: agent/.aura_state/aura.log` });
  }
}
