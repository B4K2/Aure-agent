// Aura mark + wordmark. The satellite orbits the ring continuously while the core breathes.
// On hover it adds a fast lap, drawing the ring behind it; on leave it laps back the other way.
import { animate, motion, useAnimationFrame, useMotionValue, useTransform, type Variants } from 'motion/react'
import { useEffect, useRef } from 'react'

const ease = [0.65, 0, 0.35, 1] as const
const center = { originX: '50%', originY: '50%' }
const START = 45 // satellite rest position, degrees clockwise from 12 o'clock

const letter: Variants = {
  rest: (i: number) => ({ y: 0, transition: { duration: 0.35, delay: (3 - i) * 0.04, ease } }),
  hover: (i: number) => ({ y: [0, -5, 0], transition: { duration: 0.45, delay: i * 0.05, ease } }),
}

export default function Logo({ size = 30 }: { size?: number }) {
  // 0 → 1 is one lap. The ring's drawn length follows the satellite.
  // dir 1 = clockwise lap (enter / load), -1 = counter-clockwise lap (leave).
  const lap = useMotionValue(1)
  const dir = useRef(1)
  const orbit = useMotionValue(START)
  useAnimationFrame((_, delta) => orbit.set(orbit.get() + delta * 0.06)) // one idle lap per 6s
  const angle = useTransform(() => orbit.get() + dir.current * lap.get() * 360)
  const drawn = useTransform(lap, (v) => Math.max(v, 0.001))
  // the circle's path starts at 3 o'clock; rotate it so the drawn arc trails the satellite
  const ringRotate = useTransform(() => angle.get() - (dir.current > 0 ? lap.get() * 360 : 0) - 90)
  const anim = useRef<ReturnType<typeof animate>>(null)

  useEffect(() => {
    lap.set(0)
    anim.current = animate(lap, 1, { duration: 1.4, ease })
  }, [lap])

  // each hover/leave is a fresh full lap: clockwise on enter, counter-clockwise on leave
  const run = (d: number) => {
    anim.current?.stop()
    dir.current = d
    lap.set(0)
    anim.current = animate(lap, 1, { duration: 0.9, ease })
  }

  return (
    <motion.a
      href="#"
      className="flex items-center gap-3 text-xl font-medium tracking-tight"
      initial="rest"
      whileHover="hover"
      onHoverStart={() => run(1)}
      onHoverEnd={() => run(-1)}
    >
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="overflow-visible">
        <motion.circle
          cx="16" cy="16" r="9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ ...center, pathLength: drawn, rotate: ringRotate }}
        />
        <motion.g variants={{ rest: { scale: 1 }, hover: { scale: 1.35 } }} transition={{ type: 'spring', stiffness: 400, damping: 12 }} style={center}>
          <motion.circle
            cx="16" cy="16" r="3" fill="currentColor" style={center}
            animate={{ scale: [1, 0.7, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.g>
        <motion.g style={{ ...center, rotate: angle }}>
          <circle cx="16" cy="1.5" r="2" fill="currentColor" />
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
