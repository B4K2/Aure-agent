// Service dependency graph from Neo4j (Service)-[:DEPENDS_ON]->(Service), colored by live health.
// Columns follow tiers (frontend → backend → data), so arrows always point toward what a service needs.
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useGet, type ServiceDetail, type Topology as Topo } from './api'
import Panel from './Panel'
import type { Beat, Incident } from './types'

const TIERS = ['frontend', 'backend', 'data']
const W = 200, H = 76, GX = 120, GY = 40, PAD = 24

type Health = 'down' | 'incident' | 'impacted' | 'healthy' | 'unknown'
// Like StatusBadge: glyph + label + color, never color alone.
const HEALTH: Record<Health, { glyph: string; label: string; stroke: string; text: string }> = {
  down: { glyph: '✕', label: 'Down', stroke: '#f87171', text: 'text-red-300' },
  incident: { glyph: '◆', label: 'Incident open', stroke: '#fbbf24', text: 'text-amber-300' },
  impacted: { glyph: '◌', label: 'Impacted upstream', stroke: '#fbbf24', text: 'text-amber-300/80' },
  healthy: { glyph: '✓', label: 'Healthy', stroke: '#34d399', text: 'text-emerald-300' },
  unknown: { glyph: '·', label: 'Not watched', stroke: 'rgba(255,255,255,0.25)', text: 'text-neutral-400' },
}

const date = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

type Props = { token: string; service: string; beat?: Beat; open?: Incident; version: unknown; onOpenIncident: (id: string) => void }

export default function Topology({ token, service, beat, open, version, onOpenIncident }: Props) {
  const topo = useGet<Topo>('/memory/topology', token, version)
  const [selected, setSelected] = useState<string | null>(null)
  const focus = selected ?? service
  const detail = useGet<ServiceDetail>(`/memory/services/${encodeURIComponent(focus)}`, token, version)

  const layout = useMemo(() => {
    const nodes = topo.data?.nodes ?? []
    const col = (t?: string) => (TIERS.indexOf(t ?? '') + 1 || TIERS.length + 1) - 1
    const cols: Record<number, string[]> = {}
    nodes.forEach((n) => (cols[col(n.tier)] ??= []).push(n.name))
    const used = Object.keys(cols).map(Number).sort()
    const rows = Math.max(1, ...Object.values(cols).map((c) => c.length))
    const pos: Record<string, { x: number; y: number }> = {}
    used.forEach((c, ci) => {
      const names = cols[c].sort()
      const offset = ((rows - names.length) * (H + GY)) / 2 // center short columns
      names.forEach((n, ri) => { pos[n] = { x: PAD + ci * (W + GX), y: PAD + offset + ri * (H + GY) } })
    })
    return { pos, width: PAD * 2 + used.length * W + (used.length - 1) * GX, height: PAD * 2 + rows * H + (rows - 1) * GY }
  }, [topo.data])

  // Live health only exists for the watched service and its DB; anything that depends on an
  // unhealthy service (transitively) is marked as impacted — the blast radius.
  const health = useMemo(() => {
    const h: Record<string, Health> = {}
    const edges = topo.data?.edges ?? []
    for (const n of topo.data?.nodes ?? []) h[n.name] = 'unknown'
    if (beat) {
      h[service] = !beat.health.up ? 'down' : open ? 'incident' : 'healthy'
      for (const e of edges) {
        if (e.source === service && topo.data?.nodes.find((n) => n.name === e.target)?.tier === 'data' && beat.db.up !== undefined)
          h[e.target] = beat.db.up ? 'healthy' : 'down'
      }
    }
    const bad = (n: string) => h[n] === 'down' || h[n] === 'incident' || h[n] === 'impacted'
    for (let changed = true; changed;) {
      changed = false
      for (const e of edges) if (bad(e.target) && (h[e.source] === 'unknown' || h[e.source] === 'healthy')) { h[e.source] = 'impacted'; changed = true }
    }
    for (const n of Object.keys(h)) if (h[n] === 'unknown' && edges.some((e) => e.target === n && h[e.source] === 'healthy')) h[n] = 'healthy'
    return h
  }, [topo.data, beat, open, service])

  useEffect(() => { if (selected && topo.data && !topo.data.nodes.some((n) => n.name === selected)) setSelected(null) }, [topo.data, selected])

  return (
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel
        title="Service dependencies"
        right={<span className="text-xs text-neutral-600">{topo.data ? `${topo.data.nodes.length} services · ${topo.data.edges.length} edges` : ''}</span>}
      >
        <div className="relative min-h-[420px] flex-1 overflow-auto p-6">
          {topo.error && <ErrorNote text={topo.error} onRetry={topo.reload} />}
          {!topo.data && !topo.error && <p className="text-sm text-neutral-500">Loading topology…</p>}
          {topo.data?.nodes.length === 0 && <p className="text-sm text-neutral-500">No services in memory yet. Run <span className="font-mono">uv run python -m aura.memory.seed</span>.</p>}
          {!!topo.data?.nodes.length && (
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="mx-auto h-auto w-full max-w-[900px]" role="img" aria-label="Service dependency graph">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.5)" />
                </marker>
              </defs>
              {topo.data.edges.map((e) => {
                const a = layout.pos[e.source], b = layout.pos[e.target]
                if (!a || !b) return null
                const forward = b.x > a.x
                const x1 = forward ? a.x + W : a.x, x2 = forward ? b.x - 4 : b.x + W + 4
                const y1 = a.y + H / 2, y2 = b.y + H / 2
                const dx = (x2 - x1) / 2
                const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
                const hot = health[e.target] === 'down' || health[e.target] === 'incident'
                return (
                  <g key={`${e.source}-${e.target}`}>
                    <motion.path d={d} fill="none" stroke={hot ? '#f87171' : 'rgba(255,255,255,0.25)'} strokeWidth={1.5} markerEnd="url(#arrow)"
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5 }} />
                    <motion.path
                      d={d} fill="none" stroke={hot ? '#fca5a5' : 'rgba(255,255,255,0.6)'} strokeWidth={1.5} strokeDasharray="4 14"
                      animate={{ strokeDashoffset: [18, 0] }} transition={{ duration: hot ? 0.6 : 1.6, repeat: Infinity, ease: 'linear' }}
                    />
                  </g>
                )
              })}
              {topo.data.nodes.map((n, i) => {
                const p = layout.pos[n.name]
                const h = HEALTH[health[n.name] ?? 'unknown']
                const active = n.name === focus
                return (
                  <motion.g key={n.name} onClick={() => setSelected(n.name)} className="cursor-pointer"
                    initial={{ opacity: 0, x: p.x, y: p.y + 10 }} animate={{ opacity: 1, x: p.x, y: p.y }} transition={{ delay: 0.08 * i, duration: 0.35 }}>
                    <rect width={W} height={H} rx={14} fill={active ? '#fff' : '#0a0a0a'} stroke={h.stroke} strokeWidth={active ? 2 : 1.5} />
                    <text x={16} y={28} fontSize={14} fontWeight={500} fill={active ? '#000' : '#fff'} fontFamily="var(--font-mono)">{n.name}</text>
                    <text x={16} y={50} fontSize={11} fill={active ? 'rgba(0,0,0,0.55)' : '#737373'}>
                      {n.tier ?? 'service'} · {n.incidents} incident{n.incidents === 1 ? '' : 's'}
                    </text>
                    <text x={W - 16} y={28} fontSize={13} textAnchor="end" fill={h.stroke}>{h.glyph}</text>
                    <title>{`${n.name}: ${h.label}`}</title>
                  </motion.g>
                )
              })}
            </svg>
          )}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-white/10 px-5 py-3 text-[11px]">
          {(Object.keys(HEALTH) as Health[]).map((k) => (
            <span key={k} className={HEALTH[k].text}><span aria-hidden>{HEALTH[k].glyph}</span> {HEALTH[k].label}</span>
          ))}
          <span className="text-neutral-600">arrows point to dependencies</span>
        </div>
      </Panel>

      <Panel title="Service" right={<span className="font-mono text-xs text-neutral-500">{focus}</span>}>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6">
          {detail.error && <ErrorNote text={detail.error} onRetry={detail.reload} />}
          {detail.data && <ServiceInfo d={detail.data} health={health[focus] ?? 'unknown'} open={focus === service ? open : undefined} onOpenIncident={onOpenIncident} />}
        </div>
      </Panel>
    </div>
  )
}

function ServiceInfo({ d, health, open, onOpenIncident }: { d: ServiceDetail; health: Health; open?: Incident; onOpenIncident: (id: string) => void }) {
  const h = HEALTH[health]
  const max = Math.max(1, ...d.frequency.map((f) => f.times))
  return (
    <>
      <div>
        <div className={`text-sm ${h.text}`}><span aria-hidden>{h.glyph}</span> {h.label}</div>
        {open && (
          <button onClick={() => onOpenIncident(open.incident_id)} className="mt-3 rounded-full border border-amber-400/50 px-4 py-1.5 font-mono text-xs text-amber-300 hover:bg-amber-500/10">
            {open.incident_id} → open in Live
          </button>
        )}
        {!!d.impact.length && (
          <p className="mt-3 text-sm text-neutral-400">
            If this fails it takes down <span className="font-mono text-white">{d.impact.map((i) => i.name).join(', ')}</span>.
          </p>
        )}
      </div>

      <div>
        <div className="text-xs text-neutral-500">Root causes seen</div>
        {d.frequency.length === 0 ? <p className="mt-2 text-sm text-neutral-600">None recorded.</p> : (
          <ul className="mt-3 space-y-2.5">
            {d.frequency.map((f) => (
              <li key={f.root_cause_type}>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-neutral-300">{f.root_cause_type}</span>
                  <span className="text-neutral-500">{f.confirmed}/{f.times} confirmed</span>
                </div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/10" style={{ width: `${(f.times / max) * 100}%` }}>
                  <div className="h-full bg-emerald-400" style={{ width: `${(f.confirmed / f.times) * 100}%` }} />
                  <div className="h-full flex-1 bg-red-400/60" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs text-neutral-500">Recent incidents</div>
        {d.incidents.length === 0 ? <p className="mt-2 text-sm text-neutral-600">None recorded.</p> : (
          <ul className="mt-3 space-y-1.5 font-mono text-xs">
            {d.incidents.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span className={i.confirmed ? 'text-emerald-300' : 'text-red-300'} aria-label={i.confirmed ? 'confirmed' : 'not confirmed'}>{i.confirmed ? '✓' : '✕'}</span>
                <span className="truncate text-neutral-300">{i.root_cause_type}</span>
                <span className="ml-auto shrink-0 text-neutral-600">{i.action}</span>
                <span className="w-24 shrink-0 text-right text-neutral-600">{date(i.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs text-neutral-500">Deployments</div>
        {d.deployments.length === 0 ? <p className="mt-2 text-sm text-neutral-600">None recorded.</p> : (
          <ul className="mt-3 space-y-2">
            {d.deployments.map((dep) => (
              <li key={dep.commit} className={`rounded-lg border p-3 text-sm ${dep.caused.length ? 'border-red-400/40 bg-red-950/20' : 'border-white/10'}`}>
                <div className="flex justify-between gap-3 font-mono text-xs">
                  <span className="text-white">{dep.commit}</span>
                  <span className="text-neutral-600">{date(dep.timestamp)}</span>
                </div>
                <p className="mt-1 text-neutral-400">{dep.message}</p>
                {!!dep.caused.length && <p className="mt-1 font-mono text-[11px] text-red-300">caused {dep.caused.join(', ')}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
      ✕ {text}
      {onRetry && <button onClick={onRetry} className="ml-3 underline hover:text-white">Retry</button>}
    </div>
  )
}
