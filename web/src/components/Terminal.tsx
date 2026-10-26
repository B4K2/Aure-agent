// A pretend Aura CLI: replays one incident when it scrolls into view, then takes commands.
// Everything is scripted in the browser (no agent behind it); scenarios mirror problem/inject.js.
import { useInView } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

type Tone = 'dim' | 'bright' | 'prompt' | 'ok' | 'bad'
type Line = { text: string; tone?: Tone; pause?: number }
type Entry = Line | { state: true }
type Metrics = { rps: number; p95: number; err: number; rss: number; db: number }

const BASE: Metrics = { rps: 42, p95: 120, err: 0.2, rss: 180, db: 14 }

type Scenario = {
  summary: string
  metrics: Partial<Metrics>
  detect: Line[]
  action: string
  resolved: string
}

const SCENARIOS: Record<string, Scenario> = {
  'bad-deploy-checkout-500': {
    summary: 'renamed column, every checkout 500s',
    metrics: { err: 31, p95: 340 },
    detect: [
      { text: '● anomaly  5xx 0.2% → 31% · POST /api/orders 500', tone: 'bright', pause: 500 },
      { text: '  logs           column "shipping_address" of relation "orders" does not exist', tone: 'dim' },
      { text: '  change         deploy f63edba "orders: store address as shipping_address" 2m before onset', tone: 'dim' },
      { text: '  memory         1 similar incident · INC-0087 (0.81)', tone: 'dim', pause: 600 },
      { text: '◆ hypothesis     f63edba writes a column that does not exist → every checkout fails', tone: 'bright' },
      { text: '  confidence     0.90', tone: 'dim' },
    ],
    action: 'rollback → deployment/void-app previous revision',
    resolved: '✓ rolled back · 5xx 31% → 0.1% · incident written to memory',
  },
  'memory-leak': {
    summary: 'response buffer never trims, RSS climbs ~3 MB/s',
    metrics: { rss: 920, p95: 410 },
    detect: [
      { text: '● anomaly  RSS 180 → 920 MB in ~4 min (3.1 MB/s), not flattening', tone: 'bright', pause: 500 },
      { text: '  metrics        event-loop lag p99 12ms → 180ms · GC pauses rising', tone: 'dim' },
      { text: '  change         deploy 9c1e7a0 "observability: capture response bodies" 6m before onset', tone: 'dim' },
      { text: '  memory         restart alone recurred last time (INC-0112, rejected)', tone: 'dim', pause: 600 },
      { text: '◆ hypothesis     the capture buffer in 9c1e7a0 is never trimmed → unbounded heap growth', tone: 'bright' },
      { text: '  confidence     0.84', tone: 'dim' },
    ],
    action: 'rollback → deployment/void-app previous revision (a restart only buys time)',
    resolved: '✓ rolled back · RSS steady at 185 MB · incident written to memory',
  },
  'db-lock': {
    summary: 'a "migration" holds ACCESS EXCLUSIVE on orders',
    metrics: { p95: 4800, err: 6, db: 61 },
    detect: [
      { text: '● anomaly  9 sessions waiting on locks, longest 41s', tone: 'bright', pause: 500 },
      { text: '  postgres       blocked by pid 4182 application_name=schema-migrate (idle in transaction)', tone: 'dim' },
      { text: '  change         no deploy within 15 min of onset', tone: 'dim' },
      { text: '  memory         runbook "lock contention" · 2 past incidents', tone: 'dim', pause: 600 },
      { text: '◆ hypothesis     schema-migrate holds ACCESS EXCLUSIVE on orders; checkout and stats queue behind it', tone: 'bright' },
      { text: '  confidence     0.88', tone: 'dim' },
    ],
    action: 'terminate_db_sessions → application_name = schema-migrate',
    resolved: '✓ 1 session terminated · lock waits 9 → 0 · p95 back to 130 ms',
  },
  'db-outage': {
    summary: 'Postgres goes away',
    metrics: { err: 100, rps: 6, db: 0 },
    detect: [
      { text: '● anomaly  /api/health unreachable · statefulset void-db is not running', tone: 'bright', pause: 500 },
      { text: '  logs           ECONNREFUSED 10.96.4.12:5432 · Unhandled "error" event on BoundPool', tone: 'dim' },
      { text: '  change         no deploy within 15 min of onset', tone: 'dim', pause: 600 },
      { text: '◆ hypothesis     the database is down and took the app with it', tone: 'bright' },
      { text: '  confidence     0.95', tone: 'dim' },
    ],
    action: 'start_db → scale statefulset/void-db to 1, then restart the app',
    resolved: '✓ void-db ready · app restarted · health ok for 3 checks',
  },
  'traffic-spike': {
    summary: 'flash sale, 300 extra shoppers',
    metrics: { rps: 380, p95: 900, err: 1.4, db: 48 },
    detect: [
      { text: '● anomaly  p95 120ms → 900ms while rps 42 → 380', tone: 'bright', pause: 500 },
      { text: '  metrics        5xx 1.4% · pg pool waiting 6', tone: 'dim' },
      { text: '  change         no deploy within 15 min of onset', tone: 'dim', pause: 600 },
      { text: '◆ hypothesis     real load, not a regression: capacity is the limit', tone: 'bright' },
      { text: '  confidence     0.79', tone: 'dim' },
    ],
    action: 'scale (advisory) → add replicas; nothing destructive to run',
    resolved: '✓ noted · traffic tapering · incident written to memory',
  },
}

/** A command-table row. No-break padding: TermLine leaves it alone (it only splits on plain spaces). */
const row = (left: string, right: string, width = 22) => `  ${left.padEnd(width, '\u00a0')}${right}`

const INTRO = 'bad-deploy-checkout-500'
const HELP: Line[] = [
  { text: 'commands', tone: 'bright' },
  { text: row('/scenarios', 'what you can break'), tone: 'dim' },
  { text: row('/inject <scenario>', 'break the demo shop and watch Aura respond'), tone: 'dim' },
  { text: row('/approve', 'run the proposed fix'), tone: 'dim' },
  { text: row('/reject <reason>', 'decline it; the reason is stored in memory'), tone: 'dim' },
  { text: row('/state', 'live graphs: traffic, latency, errors, memory, db'), tone: 'dim' },
  { text: row('/incidents', 'what Aura handled this session'), tone: 'dim' },
  { text: row('/clear', 'clear the screen'), tone: 'dim' },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BARS = '▁▂▃▄▅▆▇█'

function spark(values: number[]) {
  const max = Math.max(...values), min = Math.min(...values)
  return values.map((v) => BARS[max === min ? 0 : Math.round(((v - min) / (max - min)) * 7)]).join('')
}

/** Live /state panel: it keeps ticking while it's the newest thing on screen. */
function StatePanel({ target, live }: { target: Metrics; live: boolean }) {
  const [hist, setHist] = useState<Metrics[]>(() => Array.from({ length: 32 }, () => jitter(BASE)))
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setHist((h) => [...h.slice(1), jitter(ease(h[h.length - 1], target))]), 450)
    return () => clearInterval(t)
  }, [live, target])
  const now = hist[hist.length - 1]
  const rows: [string, keyof Metrics, (v: number) => string, number][] = [
    ['traffic', 'rps', (v) => `${v.toFixed(0)} rps`, 0],
    ['p95', 'p95', (v) => `${v.toFixed(0)} ms`, 800],
    ['5xx', 'err', (v) => `${v.toFixed(1)}%`, 5],
    ['memory', 'rss', (v) => `${v.toFixed(0)} MB`, 600],
    ['db conns', 'db', (v) => `${v.toFixed(0)}/100`, 40],
  ]
  return (
    <div className="my-1">
      {rows.map(([label, key, fmt, warn]) => (
        <div key={key} className="flex gap-3 sm:gap-4">
          <span className="w-16 shrink-0 text-neutral-500 sm:w-20">{label}</span>
          {/* right-aligned in a clipping box: narrow screens drop the oldest bars, not the newest */}
          <span className="flex min-w-0 justify-end overflow-hidden">
            <span className={warn && now[key] > warn ? 'text-red-400' : 'text-white'}>{spark(hist.map((m) => m[key]))}</span>
          </span>
          <span className="w-18 shrink-0 text-neutral-400">{fmt(now[key])}</span>
        </div>
      ))}
    </div>
  )
}

function ease(cur: Metrics, target: Metrics): Metrics {
  const out = { ...cur }
  for (const k of Object.keys(target) as (keyof Metrics)[]) out[k] = cur[k] + (target[k] - cur[k]) * 0.35
  return out
}

function jitter(m: Metrics): Metrics {
  const j = (v: number, f: number) => Math.max(0, v * (1 + (Math.random() - 0.5) * f))
  return { rps: j(m.rps, 0.15), p95: j(m.p95, 0.2), err: j(m.err, 0.3), rss: j(m.rss, 0.02), db: j(m.db, 0.1) }
}

/** "  label       value" rows become two columns, so a value that wraps stays under its column. */
function TermLine({ text, className }: { text: string; className: string }) {
  const m = text.match(/^(\S? *\S+)( {3,})(.*)$/)
  if (!m) return <div className={className}>{text}</div>
  return (
    <div className={`flex ${className}`}>
      <span className="w-[13ch] shrink-0 whitespace-pre sm:w-[17ch]">{m[1]}</span>
      <span className="min-w-0">{m[3]}</span>
    </div>
  )
}

export default function Terminal() {
  const ref = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLPreElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const inView = useInView(ref, { once: true, margin: '-120px' })
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(true)
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histPos, setHistPos] = useState(-1)
  const [pending, setPending] = useState<string | null>(null) // scenario awaiting approval
  const [active, setActive] = useState<string | null>(null) // scenario currently breaking the shop
  const [handled, setHandled] = useState<string[]>([])
  const cancelled = useRef(false)

  const target = useMemo<Metrics>(() => ({ ...BASE, ...(active ? SCENARIOS[active].metrics : {}) }), [active])

  async function type(lines: Line[]) {
    for (const line of lines) {
      if (cancelled.current) return
      const idx = await new Promise<number>((r) => setEntries((prev) => (r(prev.length), [...prev, { ...line, text: '' }])))
      for (let c = 1; c <= line.text.length && !cancelled.current; c += 2) {
        setEntries((prev) => prev.map((e, i) => (i === idx ? { ...line, text: line.text.slice(0, c) } : e)))
        await sleep(10)
      }
      setEntries((prev) => prev.map((e, i) => (i === idx ? line : e)))
      await sleep(line.pause ?? 200)
    }
  }

  const print = (lines: Line[]) => setEntries((prev) => [...prev, ...lines])

  async function inject(name: string) {
    const s = SCENARIOS[name]
    setActive(name)
    await type([...s.detect, { text: `  proposed       ${s.action}   (requires approval)`, tone: 'bright', pause: 300 }])
    setPending(name)
  }

  async function run(raw: string) {
    const [c, ...rest] = raw.trim().split(/\s+/)
    const arg = rest.join(' ')
    print([{ text: `› ${raw.trim()}`, tone: 'prompt' }])
    setBusy(true)
    if (c === '/help' || c === 'help') print(HELP)
    else if (c === '/clear') setEntries([])
    else if (c === '/scenarios')
      print(Object.entries(SCENARIOS).map(([n, s]) => ({ text: row(n, s.summary, 24), tone: 'dim' as Tone })))
    else if (c === '/state') setEntries((prev) => [...prev, { state: true }])
    else if (c === '/incidents')
      print(handled.length ? handled.map((h, i) => ({ text: `  INC-${String(i + 1).padStart(4, '0')}  ${h}`, tone: 'dim' as Tone }))
        : [{ text: '  none yet: try /inject db-lock', tone: 'dim' }])
    else if (c === '/inject') {
      if (pending) print([{ text: `  ${pending} is waiting on you: /approve or /reject <reason>`, tone: 'bad' }])
      else if (!SCENARIOS[arg]) print([{ text: `  unknown scenario "${arg}": see /scenarios`, tone: 'bad' }])
      else await inject(arg)
    } else if (c === '/approve' || c === '/reject') {
      if (!pending) print([{ text: '  nothing awaiting approval', tone: 'dim' }])
      else if (c === '/reject' && !arg) print([{ text: '  give a reason: /reject <why>', tone: 'bad' }])
      else {
        const s = SCENARIOS[pending]
        setPending(null)
        if (c === '/approve') {
          await type([{ text: '  executing…  verifying for 3 healthy checks', tone: 'dim', pause: 900 }])
          setActive(null)
          await type([{ text: s.resolved, tone: 'ok' }])
          setHandled((h) => [...h, `${pending} · resolved`])
        } else {
          setActive(null)
          await type([{ text: `✗ rejected: "${arg}" · stored so the next RCA weighs it`, tone: 'bad' }])
          setHandled((h) => [...h, `${pending} · rejected (${arg})`])
        }
      }
    } else if (c) print([{ text: `  unknown command "${c}": try /help`, tone: 'bad' }])
    setBusy(false)
  }

  useEffect(() => {
    if (!inView) return
    cancelled.current = false
    ;(async () => {
      await inject(INTRO)
      await sleep(700)
      await type([{ text: '› /approve', tone: 'prompt', pause: 700 }])
      setPending(null)
      setActive(null)
      await type([{ text: SCENARIOS[INTRO].resolved, tone: 'ok', pause: 500 }])
      setHandled([`${INTRO} · resolved`])
      await type([{ text: 'your turn: /help, /state, or /inject db-lock', tone: 'dim' }])
      setBusy(false)
    })()
    return () => {
      cancelled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [entries])

  function submit(text: string) {
    if (busy || !text.trim()) return
    setHistory((h) => [text, ...h])
    setHistPos(-1)
    setCmd('')
    run(text)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit(cmd)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const p = Math.max(-1, Math.min(history.length - 1, histPos + (e.key === 'ArrowUp' ? 1 : -1)))
      setHistPos(p)
      setCmd(p < 0 ? '' : history[p])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const words = ['/help', '/scenarios', '/state', '/incidents', '/approve', '/reject ', '/clear',
        ...Object.keys(SCENARIOS).map((s) => `/inject ${s}`)]
      const hit = words.find((w) => w.startsWith(cmd) && w !== cmd)
      if (hit) setCmd(hit)
    }
  }

  const chips = pending ? ['/approve', '/reject not now', '/state'] : ['/inject db-lock', '/inject memory-leak', '/state', '/scenarios']
  const tone: Record<Tone, string> = {
    dim: 'text-neutral-500', bright: 'text-white', prompt: 'text-white font-medium', ok: 'text-emerald-400', bad: 'text-red-400',
  }
  const lastState = entries.reduce((last, e, i) => ('state' in e ? i : last), -1)

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-[0_0_120px_-40px_rgba(255,255,255,0.25)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 sm:px-5">
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="ml-3 truncate font-mono text-xs text-neutral-500">aura — incident feed</span>
        {active && <span className="ml-auto truncate font-mono text-xs text-red-400">● {active}</span>}
      </div>
      <pre ref={scroller} onClick={() => input.current?.focus()}
        className="h-[420px] cursor-text overflow-y-auto p-4 font-mono text-[11px] leading-6 break-words whitespace-pre-wrap sm:h-[380px] sm:p-6 sm:text-[13px] sm:leading-7 xl:overflow-x-auto xl:whitespace-pre">
        {entries.map((e, i) =>
          'state' in e ? (
            <StatePanel key={i} target={target} live={i === lastState && i === entries.length - 1} />
          ) : (
            <TermLine key={i} text={e.text} className={tone[e.tone ?? 'dim']} />
          ),
        )}
        <div className="flex items-center">
          {!busy && <span className="mr-2 text-white">›</span>}
          <input ref={input} value={cmd} disabled={busy} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey}
            aria-label="Aura demo command" spellCheck={false} autoComplete="off"
            className="w-0 flex-1 bg-transparent text-base text-white caret-white sm:text-[13px] outline-none placeholder:text-neutral-700"
            placeholder={busy ? '' : 'type /help'} />
        </div>
      </pre>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
        {chips.map((c) => (
          <button key={c} onClick={() => submit(c)} disabled={busy}
            className="rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-neutral-300 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40">
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
