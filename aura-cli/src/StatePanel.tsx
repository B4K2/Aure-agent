// /state: live graphs of the site's vitals from the agent's 5 s heartbeats (last 15 min).
import { Box, Text } from 'ink';
import type { AuraEvent } from './backend.js';

const BLOCKS = ' ▁▂▃▄▅▆▇█';

type Metric = {
  label: string;
  get: (b: AuraEvent) => number | null | undefined;
  fmt: (v: number) => string;
  warn: number;   // value at/above which the series turns red
  floor?: number; // minimum top of the y-axis, so a flat quiet line doesn't fill the chart
};

const METRICS: Metric[] = [
  { label: 'requests/s', get: (b) => b.rps, fmt: (v) => v.toFixed(1), warn: Infinity, floor: 5 },
  { label: 'p95 latency', get: (b) => b.p95, fmt: (v) => `${Math.round(v * 1000)}ms`, warn: 1, floor: 0.25 },
  { label: '5xx rate', get: (b) => b.err, fmt: (v) => `${(v * 100).toFixed(1)}%`, warn: 0.05, floor: 0.05 },
  { label: 'memory (RSS)', get: (b) => b.rss_mb, fmt: (v) => `${Math.round(v)}MB`, warn: 500, floor: 150 },
  { label: 'event loop lag', get: (b) => b.lag, fmt: (v) => `${Math.round(v * 1000)}ms`, warn: 0.2, floor: 0.05 },
  { label: 'db connections', get: (b) => b.db?.sessions, fmt: (v) => v.toFixed(0), warn: 90, floor: 10 },
  { label: 'pool waiting', get: (b) => b.pool_waiting, fmt: (v) => v.toFixed(0), warn: 3, floor: 3 },
];

/** Multi-row area chart: each row adds 8 levels, so height 3 gives 24 steps. */
function chart(values: (number | null)[], top: number, height: number): string[] {
  const rows: string[] = [];
  for (let r = height - 1; r >= 0; r--) {
    rows.push(values.map((v) => {
      if (v == null) return '·';
      const level = Math.round((Math.min(v, top) / top) * height * 8) - r * 8;
      return BLOCKS[Math.max(0, Math.min(8, level))];
    }).join(''));
  }
  return rows;
}

export function StatePanel({ beats, url }: { beats: AuraEvent[]; url?: string }) {
  const cols = process.stdout.columns || 100;
  const width = Math.max(20, cols - 46); // label 16 + value 8 + "  max 1234ms" 12 + border/padding 4
  const recent = beats.slice(-width);
  const pad = Array(width - recent.length).fill(null);
  const last = recent[recent.length - 1];
  const minutes = Math.round((recent.length * 5) / 60);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text>
        <Text bold color="cyan">Site state</Text>
        <Text dimColor>  {url} · last {minutes || '<1'} min · live · /state or Esc to close</Text>
      </Text>
      <Box>
        <Text>{'site up'.padEnd(16)}{'        '}</Text>
        <Text>
          {pad.map((_, i) => <Text key={`p${i}`} dimColor>·</Text>)}
          {recent.map((b, i) => <Text key={i} color={b.health?.up ? 'green' : 'red'}>█</Text>)}
        </Text>
        <Text color={last?.health?.up ? 'green' : 'red'}>  {last ? (last.health?.up ? 'up' : String(last.health?.status)) : '…'}</Text>
      </Box>
      {METRICS.map((m) => {
        const vals = [...pad, ...recent.map((b) => m.get(b) ?? null)] as (number | null)[];
        const nums = vals.filter((v): v is number => v != null);
        const cur = nums[nums.length - 1];
        const max = nums.length ? Math.max(...nums) : 0;
        const top = Math.max(max * 1.1, m.floor ?? 0, 1e-9);
        const color = cur != null && cur >= m.warn ? 'red' : max >= m.warn ? 'yellow' : 'green';
        const rows = chart(vals, top, 2);
        return (
          <Box key={m.label} flexDirection="column">
            {rows.map((row, r) => (
              <Text key={r}>
                <Text bold={r === 0}>{(r === 0 ? m.label : '').padEnd(16)}</Text>
                <Text color={color}>{(r === 0 && cur != null ? m.fmt(cur) : '').padStart(7)} </Text>
                <Text color={color}>{row}</Text>
                <Text dimColor>{r === 0 ? `  max ${m.fmt(max)}` : ''}</Text>
              </Text>
            ))}
          </Box>
        );
      })}
      <Text dimColor>
        db {last?.db?.up ? 'reachable' : 'DOWN'} · {last?.db?.sessions ?? '–'}/{last?.db?.max ?? '–'} conns · lock waits {last?.db?.lock_waits ?? '–'} · open incidents {last?.open ?? 0}
      </Text>
    </Box>
  );
}
