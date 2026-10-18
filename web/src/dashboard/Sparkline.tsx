// Metric tile: headline value + a single-series sparkline with a hover crosshair and readout.
import { useState } from 'react'

type Props = {
  label: string
  values: (number | undefined)[]
  times: string[]
  format: (v: number) => string
}

const W = 240
const H = 56

export default function MetricTile({ label, values, times, format }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => typeof p.v === 'number')
  const last = pts.at(-1)?.v
  const max = Math.max(...pts.map((p) => p.v), 0) || 1
  const min = Math.min(...pts.map((p) => p.v), 0)
  const n = Math.max(values.length - 1, 1)
  const x = (i: number) => (i / n) * W
  const y = (v: number) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8)
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const shown = hover != null ? values[hover] : last

  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-neutral-500">{label}</span>
        {hover != null && <span className="font-mono text-[10px] text-neutral-500">{new Date(times[hover]).toLocaleTimeString()}</span>}
      </div>
      <div className="mt-1 text-2xl font-light tracking-tight tabular-nums">{typeof shown === 'number' ? format(shown) : '—'}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-3 h-14 w-full overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(Math.round(((e.clientX - r.left) / r.width) * n))
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="currentColor" className="text-white/10" vectorEffect="non-scaling-stroke" />
        {d && <path d={`${d}L${x(pts.at(-1)!.i)},${H}L${x(pts[0].i)},${H}Z`} className="fill-white/[0.06]" />}
        {d && <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-white" vectorEffect="non-scaling-stroke" />}
        {hover != null && typeof values[hover] === 'number' && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="currentColor" className="text-white/30" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(values[hover]!)} r="4" className="fill-white stroke-neutral-950" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    </div>
  )
}
