import { motion, useScroll, useTransform } from 'motion/react'
import { useRef, type ReactNode } from 'react'

type Props = { children: ReactNode; delay?: number; className?: string; parallax?: number }

// Fades up on first view; `parallax` (px) additionally lags the element behind the scroll.
export default function Reveal({ children, delay = 0, className, parallax = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [parallax, -parallax])
  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      <motion.div
        className="h-full"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
