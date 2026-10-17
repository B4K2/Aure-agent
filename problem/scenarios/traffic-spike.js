import { spawnDetached, stop } from '../lib/background.js';

export default {
  name: 'traffic-spike',
  category: 'load spike',
  kind: 'process',
  summary: 'Flash-sale: hundreds of extra virtual shoppers arrive within ~20s, hammering product pages, signups (bcrypt) and checkout.',
  symptoms: 'RPS several x baseline, CPU pegged, p95 latency up across routes, pool waiting > 0, some timeouts. No deploy correlates.',
  fix: 'Not a code bug: scale out / rate-limit / ride it out. The spike stops on its own after --duration (default 5m).',
  async inject(opts) {
    const users = String(opts.users || 300);
    return spawnDetached(this.name, 'traffic/simulate.js',
      ['--users', users, '--profile', 'flash-sale', '--ramp', '20s', '--duration', String(opts.duration || '5m'), '--tag', 'spike']);
  },
  async recover(info) { await stop(info.pid); },
};
