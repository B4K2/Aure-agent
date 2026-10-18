// Scripted replay of an Aura CLI session, typed out once the block scrolls into view.
import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const SCRIPT: { text: string; tone?: 'dim' | 'bright' | 'prompt'; pause?: number }[] = [
  { text: '● anomaly  checkout p95 1.9s → 7.4s · 5xx 0.2% → 31%', tone: 'bright', pause: 500 },
  { text: '  observability  pulled metrics, logs, traces (12m window)', tone: 'dim' },
  { text: '  change         deploy a41f9c2 "refactor cart totals" 3m before onset', tone: 'dim' },
  { text: '  memory         2 similar incidents · INC-0112 (0.91), INC-0087 (0.78)', tone: 'dim', pause: 600 },
  { text: '◆ hypothesis     null cart.discount after refactor → TypeError in /checkout', tone: 'bright' },
  { text: '  confidence     0.87', tone: 'dim' },
  { text: '  proposed       rollback → b7e20d1   (requires approval)', tone: 'bright', pause: 900 },
  { text: '› /approve', tone: 'prompt', pause: 700 },
  { text: '✓ rolled back · 5xx 31% → 0.1% · incident written to memory', tone: 'bright' },
]

export default function Terminal() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-120px' })
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!inView) return
    let cancelled = false
    ;(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      for (let i = 0; i < SCRIPT.length && !cancelled; i++) {
        const { text, pause = 250 } = SCRIPT[i]
        for (let c = 1; c <= text.length && !cancelled; c += 2) {
          setLines((prev) => [...prev.slice(0, i), text.slice(0, c)])
          await sleep(12)
        }
        setLines((prev) => [...prev.slice(0, i), text])
        await sleep(pause)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [inView])

  const tone = { dim: 'text-neutral-500', bright: 'text-white', prompt: 'text-white font-medium' }

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-[0_0_120px_-40px_rgba(255,255,255,0.25)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="ml-3 font-mono text-xs text-neutral-500">aura — incident feed</span>
      </div>
      <pre className="min-h-[340px] overflow-x-auto p-6 font-mono text-[13px] leading-7">
        {lines.map((l, i) => (
          <div key={i} className={tone[SCRIPT[i].tone ?? 'dim']}>
            {l}
          </div>
        ))}
        <span className="inline-block h-4 w-2 translate-y-0.5 bg-white" style={{ animation: 'blink 1s steps(1) infinite' }} />
      </pre>
    </div>
  )
}
