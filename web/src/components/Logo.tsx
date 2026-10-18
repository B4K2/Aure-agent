// Aura mark + wordmark. The ring draws itself in on load; hovering winds the ring forward,
// flings the satellite, sends out a ripple and lifts the letters; leaving unwinds it all.
import { motion, type Variants } from 'motion/react'
import { useState } from 'react'

const ease = [0.65, 0, 0.35, 1] as const
const center = { originX: '50%', originY: '50%' }

const ring: Variants = {
  rest: { rotate: 0, scale: 1, transition: { duration: 0.7, ease } },
  hover: { rotate: 360, scale: 0.92, transition: { duration: 0.7, ease } },
}
const core: Variants = {
  rest: { scale: 1, transition: { type: 'spring', stiffness: 400, damping: 12 } },
  hover: { scale: 1.45, transition: { type: 'spring', stiffness: 400, damping: 12 } },
}
const ripple: Variants = {
  rest: { opacity: [0.6, 0], scale: [1, 1.35], transition: { duration: 0.6 } },
  hover: { opacity: [0.6, 0], scale: [1, 1.6], transition: { duration: 0.7 } },
}
const letter: Variants = {
  rest: (i: number) => ({ y: 0, transition: { duration: 0.35, delay: (3 - i) * 0.04, ease } }),
  hover: (i: number) => ({ y: [0, -5, 0], transition: { duration: 0.45, delay: i * 0.05, ease } }),
}

export default function Logo({ size = 30 }: { size?: number }) {
  // Satellite speeds up while hovered; restarting its loop keeps it continuous.
  const [hovered, setHovered] = useState(false)

  return (
    <motion.a
      href="#"
      className="flex items-center gap-3 text-xl font-medium tracking-tight"
      initial="rest"
      animate={hovered ? 'hover' : 'rest'}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="overflow-visible">
        <motion.circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1" variants={ripple} style={center} opacity={0} />
        <motion.g variants={ring} style={center}>
          <motion.circle
            cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease }}
          />
        </motion.g>
        <motion.circle cx="16" cy="16" r="3.5" fill="currentColor" variants={core} style={center} />
        <motion.g
          key={hovered ? 'fast' : 'slow'}
          animate={{ rotate: 360 }}
          transition={{ duration: hovered ? 1.2 : 6, repeat: Infinity, ease: 'linear' }}
          style={center}
        >
          <circle cx="16" cy="2.5" r="2" fill="currentColor" />
        </motion.g>
      </svg>
      <span className="flex">
        {'Aura'.split('').map((ch, i) => (
          <motion.span key={i} custom={i} variants={letter} className="inline-block">
            {ch}
          </motion.span>
        ))}
      </span>
    </motion.a>
  )
}
