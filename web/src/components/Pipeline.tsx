// The agent graph as a horizontal track with a pulse travelling through each stage.
import { motion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'

const STAGES = [
  { n: '01', name: 'Detect', body: 'Watches latency, error rate, saturation and DB health. Flags anomalies, not noise.' },
  { n: '02', name: 'Correlate', body: 'Lines the onset up against deploys, config changes and traffic shifts.' },
  { n: '03', name: 'Recall', body: 'Searches vector and graph memory for incidents that looked like this one.' },
  { n: '04', name: 'Diagnose', body: 'Forms a root-cause hypothesis with evidence and a confidence score.' },
  { n: '05', name: 'Propose', body: 'Suggests rollback, restart, kill sessions or scale. Waits for your approval.' },
  { n: '06', name: 'Learn', body: 'Writes the outcome, and your reason if you reject it, back into memory.' },
]

export default function Pipeline() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.9', 'start 0.35'] })
  const fill = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <div ref={ref} className="relative">
      <div className="absolute top-[7px] right-0 left-0 hidden h-px bg-white/10 lg:block" />
      {/* track fills in as you scroll the section into view */}
      <motion.div style={{ scaleX: fill }} className="absolute top-[7px] right-0 left-0 hidden h-px origin-left bg-white/60 lg:block" />
      <motion.div
        className="absolute top-[3px] hidden size-[9px] rounded-full bg-white shadow-[0_0_24px_4px_rgba(255,255,255,0.6)] lg:block"
        animate={{ left: ['0%', '100%'] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
      />
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6 lg:gap-6">
        {STAGES.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: i * 0.08 }}
          >
            <div className="mb-6 size-[15px] rounded-full border border-white/40 bg-black" />
            <div className="font-mono text-xs text-neutral-500">{s.n}</div>
            <div className="mt-2 text-xl font-medium">{s.name}</div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">{s.body}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
