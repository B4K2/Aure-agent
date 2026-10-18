// Number that counts up when scrolled into view (inspired by React Bits "CountUp").
import { animate, useInView } from 'motion/react'
import { useEffect, useRef } from 'react'

export default function CountUp({ to, suffix = '', decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, to, {
      duration: 1.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = v.toFixed(decimals) + suffix
      },
    })
    return () => controls.stop()
  }, [inView, to, suffix, decimals])

  return <span ref={ref}>{(0).toFixed(decimals) + suffix}</span>
}
