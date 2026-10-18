import { motion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import CountUp from './components/CountUp'
import Logo from './components/Logo'
import Pipeline from './components/Pipeline'
import Reveal from './components/Reveal'
import SplitText from './components/SplitText'
import SpotlightCard from './components/SpotlightCard'
import Terminal from './components/Terminal'
import ThemeToggle from './components/ThemeToggle'
import Threads from './components/Threads'

const REPO = 'https://github.com/B4K2/Aure-agent'

const SCENARIOS = [
  'bad deploys', 'memory leaks', 'CPU hot paths', 'DB pool leaks', 'slow queries',
  'connection exhaustion', 'table locks', 'DB outages', 'traffic spikes',
]

const FEATURES = [
  {
    title: 'Evidence, not guesses',
    body: 'Every hypothesis cites the metrics, log lines, traces and deploy diffs it came from, so you can check the reasoning in seconds.',
  },
  {
    title: 'Memory that compounds',
    body: 'Resolved and rejected incidents go into Qdrant and Neo4j. The second time a failure shows up, Aura recognises it.',
  },
  {
    title: 'Human in the loop',
    body: 'Rollbacks, restarts and session kills are proposals. Nothing destructive runs until you type /approve.',
  },
  {
    title: 'Ask it anything',
    body: 'Chat with the incident from the terminal. Why this deploy? What else changed? What happened last time?',
  },
]

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2.5 text-[15px] font-medium tracking-tight">
          <Logo />
          Aura
        </a>
        <div className="hidden items-center gap-8 text-sm text-neutral-400 md:flex">
          <a href="#how" className="transition-colors hover:text-white">How it works</a>
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#demo" className="transition-colors hover:text-white">Demo</a>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a href={REPO} className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-85">
            Get started
          </a>
        </div>
      </nav>
    </header>
  )
}

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, 160])
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0])

  return (
    <section ref={ref} className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-16">
      <motion.div style={{ opacity }} className="absolute inset-0">
        <Threads className="absolute inset-0" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#000_80%)]" />
      </motion.div>

      <motion.div style={{ y }} className="relative z-10 mx-auto max-w-5xl text-center">
        <h1 className="text-[clamp(3rem,9vw,8.5rem)] leading-[0.92] font-light tracking-[-0.045em]">
          <SplitText text="Incidents," />
          <br />
          <SplitText text="understood." delay={0.2} className="font-serif font-normal italic tracking-[-0.02em]" />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.7 }}
          className="mx-auto mt-10 max-w-xl text-lg leading-relaxed text-neutral-400"
        >
          Aura watches your app, ties anomalies to the deploy that caused them, remembers every past
          incident, and proposes a fix. You approve it.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.9 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <a href={REPO} className="rounded-full bg-white px-7 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.03]">
            Run it locally
          </a>
          <a href="#demo" className="rounded-full border border-white/20 px-7 py-3 text-sm font-medium transition-colors hover:bg-white/5">
            Watch a demo ↓
          </a>
        </motion.div>
      </motion.div>

      <div className="absolute bottom-10 left-1/2 h-12 w-px -translate-x-1/2 overflow-hidden bg-white/10">
        <motion.div
          className="h-1/2 w-full bg-white"
          animate={{ y: ['-100%', '200%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </section>
  )
}

function Marquee() {
  const items = [...SCENARIOS, ...SCENARIOS]
  return (
    <section className="border-y border-white/10 py-6">
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_15%,#000_85%,transparent)]">
        <div className="flex w-max gap-12" style={{ animation: 'marquee 40s linear infinite' }}>
          {items.map((s, i) => (
            <span key={i} className="flex items-center gap-12 font-mono text-sm whitespace-nowrap text-neutral-500">
              {s}
              <span className="text-neutral-700">✕</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function SectionHead({ eyebrow, title, serif }: { eyebrow: string; title: string; serif: string }) {
  return (
    <div className="mb-20 max-w-3xl">
      <Reveal>
        <div className="mb-6 font-mono text-xs tracking-widest text-neutral-500 uppercase">{eyebrow}</div>
      </Reveal>
      <h2 className="text-[clamp(2.25rem,5vw,4.25rem)] leading-[1.02] font-light tracking-[-0.035em]">
        <SplitText text={title} />{' '}
        <SplitText text={serif} delay={0.25} className="font-serif italic" />
      </h2>
    </div>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-40">
      <SectionHead eyebrow="How it works" title="From first alert to" serif="root cause." />
      <Pipeline />
    </section>
  )
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-7xl px-6 py-40">
      <SectionHead eyebrow="Features" title="Built for the 3am" serif="page." />
      <div className="grid gap-4 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.08}>
            <SpotlightCard className="h-full">
              <div className="font-mono text-xs text-neutral-600">0{i + 1}</div>
              <h3 className="mt-16 text-2xl font-medium tracking-tight">{f.title}</h3>
              <p className="mt-4 max-w-md leading-relaxed text-neutral-400">{f.body}</p>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function Demo() {
  return (
    <section id="demo" className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-40 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <Reveal>
          <div className="mb-6 font-mono text-xs tracking-widest text-neutral-500 uppercase">Demo</div>
        </Reveal>
        <h2 className="text-[clamp(2.25rem,4.5vw,3.75rem)] leading-[1.02] font-light tracking-[-0.035em]">
          <SplitText text="A bad push," /> <SplitText text="caught in minutes." delay={0.2} className="font-serif italic" />
        </h2>
        <Reveal delay={0.3}>
          <p className="mt-8 max-w-md leading-relaxed text-neutral-400">
            Break the demo shop with <span className="font-mono text-sm text-white">node inject.js bad-deploy-checkout-500</span> and
            watch Aura go from anomaly to approved rollback, with the reasoning shown at every step.
          </p>
        </Reveal>
      </div>
      <Reveal delay={0.15}>
        <Terminal />
      </Reveal>
    </section>
  )
}

function Stats() {
  const stats = [
    { value: 9, label: 'failure scenarios in the demo harness' },
    { value: 6, label: 'remediation actions Aura can propose' },
    { value: 0, label: 'destructive actions without approval' },
  ]
  return (
    <section className="border-y border-white/10">
      <div className="mx-auto grid max-w-7xl divide-white/10 px-6 md:grid-cols-3 md:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="py-16 md:px-10">
            <div className="text-7xl font-light tracking-tighter">
              <CountUp to={s.value} />
            </div>
            <div className="mt-4 text-sm text-neutral-500">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Statement() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-48 text-center">
      <p className="text-[clamp(1.75rem,4vw,3.25rem)] leading-[1.15] font-light tracking-[-0.03em] text-neutral-500">
        <SplitText text="It doesn't replace your on-call engineer." stagger={0.04} />{' '}
        <SplitText text="It makes sure they never start from zero." delay={0.3} stagger={0.04} className="text-white" />
      </p>
    </section>
  )
}

function CTA() {
  return (
    <section className="relative overflow-hidden px-6 py-48 text-center">
      <div className="absolute inset-0 opacity-60">
        <Threads amplitude={0.8} distance={0.2} className="absolute inset-0" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#000_75%)]" />
      </div>
      <div className="relative">
        <h2 className="text-[clamp(2.5rem,7vw,6rem)] leading-[0.95] font-light tracking-[-0.045em]">
          <SplitText text="Sleep through" /> <SplitText text="the next one." delay={0.2} className="font-serif italic" />
        </h2>
        <Reveal delay={0.4}>
          <div className="mx-auto mt-12 inline-flex items-center gap-3 rounded-full border border-white/15 bg-neutral-950 py-2 pr-2 pl-6 font-mono text-sm">
            <span className="text-neutral-500">$</span> git clone {REPO.replace('https://', '')}
            <a href={REPO} className="rounded-full bg-white px-5 py-2 font-sans font-medium text-black">
              Clone
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-neutral-500 md:flex-row">
        <span>© {new Date().getFullYear()} Aura</span>
        <div className="flex gap-6">
          <a href={REPO} className="hover:text-white">GitHub</a>
          <a href={`${REPO}#readme`} className="hover:text-white">Docs</a>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div className="grain min-h-screen bg-black font-sans text-white">
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <HowItWorks />
        <Demo />
        <Stats />
        <Features />
        <Statement />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
