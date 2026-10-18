// Aura mark: a ring that draws itself in, a breathing core, and a satellite in orbit.
import { motion } from 'motion/react'

export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="overflow-visible" whileHover="hover">
      <motion.circle
        cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1" opacity={0}
        variants={{ hover: { opacity: [0.5, 0], scale: [1, 1.5], transition: { duration: 0.9, repeat: Infinity } } }}
        style={{ originX: '50%', originY: '50%' }}
      />
      <motion.circle
        cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        initial={{ pathLength: 0, rotate: -90 }}
        animate={{ pathLength: 1, rotate: 270 }}
        transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1] }}
        style={{ originX: '50%', originY: '50%' }}
      />
      <motion.circle
        cx="16" cy="16" r="3.5" fill="currentColor"
        animate={{ scale: [1, 0.7, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '50%', originY: '50%' }}
      />
      <motion.g
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        style={{ originX: '50%', originY: '50%' }}
      >
        <circle cx="16" cy="2.5" r="2" fill="currentColor" />
      </motion.g>
    </motion.svg>
  )
}
