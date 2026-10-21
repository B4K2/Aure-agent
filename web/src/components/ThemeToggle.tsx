// Light mode is the exact inverse of the monochrome dark design, so it's applied as an
// inversion on <html> (see index.css). The initial class is set in index.html to avoid a flash.
// The switch is revealed as a circle growing out of the button via the View Transitions API.
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { flushSync } from 'react-dom'

export default function ThemeToggle() {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'))

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !light
    const apply = () => {
      document.documentElement.classList.toggle('light', next)
      localStorage.setItem('theme', next ? 'light' : 'dark')
      flushSync(() => setLight(next))
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!document.startViewTransition || reduced) return apply()

    const r = e.currentTarget.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))

    document.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="grid size-9 place-items-center overflow-hidden rounded-full border border-white/15 text-neutral-300 transition-colors hover:border-white/40 hover:text-white"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={light ? 'sun' : 'moon'}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          initial={{ y: 14, opacity: 0, rotate: -45 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 45 }}
          transition={{ duration: 0.25 }}
        >
          {light ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </>
          ) : (
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          )}
        </motion.svg>
      </AnimatePresence>
    </button>
  )
}
