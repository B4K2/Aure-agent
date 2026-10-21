// Incident history (every outcome Aura has written to Qdrant, seeded ones included) and free-text
// semantic search over past incidents + runbooks, using the same embeddings Aura retrieves with.
import { useEffect, useMemo, useState } from 'react'
import { useGet, type Memory, type Outcome, type Runbook, type SearchResult } from './api'
import Markdown from './Markdown'
import Panel from './Panel'
import { ErrorNote } from './Topology'

const OUTCOME: Record<Outcome, { glyph: string; label: string; tone: string }> = {
  confirmed: { glyph: '✓', label: 'Confirmed', tone: 'border-emerald-400/40 text-emerald-300' },
  rejected: { glyph: '✕', label: 'Rejected', tone: 'border-red-400/50 text-red-300' },
  inconclusive: { glyph: '?', label: 'Inconclusive', tone: 'border-white/20 text-neutral-300' },
}

const date = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Splits the embedded text (vector_db.incident_text + learning's "human said") back into fields. */
function parse(text: string) {
  const m = text.match(/symptoms: (.*?)\. root cause \((.*?)\): (.*?)\. resolved by: (.*?)\.(?: human said: (.*))?$/s)
  return m ? { symptoms: m[1], hypothesis: m[3], resolvedBy: m[4], note: m[5] } : { symptoms: '', hypothesis: text, resolvedBy: '', note: undefined }
}

type Selection = { kind: 'incident'; item: Memory } | { kind: 'runbook'; item: Runbook }

type Props = { token: string; version: unknown; live: Set<string>; onOpenIncident: (id: string) => void }

export default function MemoryView({ token, version, live, onOpenIncident }: Props) {
  const history = useGet<Memory[]>('/memory/incidents', token, version)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const search = useGet<SearchResult>(query ? `/memory/search?q=${encodeURIComponent(query)}` : null, token)
  const [outcome, setOutcome] = useState<Outcome | 'all'>('all')
  const [cause, setCause] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)

  const all = history.data ?? []
  const causes = useMemo(() => {
    const c: Record<string, number> = {}
    all.forEach((m) => { c[m.root_cause_type] = (c[m.root_cause_type] ?? 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [all])
  const counts = useMemo(() => ({
    all: all.length,
    confirmed: all.filter((m) => m.outcome === 'confirmed').length,
    rejected: all.filter((m) => m.outcome === 'rejected').length,
    inconclusive: all.filter((m) => m.outcome === 'inconclusive').length,
  }), [all])

  const searching = !!query
  const rows = (searching ? search.data?.incidents ?? [] : all)
    .filter((m) => (outcome === 'all' || m.outcome === outcome) && (!cause || m.root_cause_type === cause))
  const runbooks = searching ? search.data?.runbooks ?? [] : []

  // default to the top row so the detail pane is never empty when there's something to show
  useEffect(() => { setSel(rows[0] ? { kind: 'incident', item: rows[0] } : runbooks[0] ? { kind: 'runbook', item: runbooks[0] } : null) }, [search.data, history.data, outcome, cause]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title={searching ? 'Search results' : 'Incident history'} right={<span className="text-xs text-neutral-600">{rows.length}{searching ? '' : ` of ${all.length}`}</span>}>
        <div className="space-y-3 border-b border-white/10 p-4">
          <form onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()) }} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); if (!e.target.value.trim()) setQuery('') }}
              placeholder="Search memory: “checkout 500 after deploy”, “connections full”…"
              className="flex-1 rounded-full border border-white/15 bg-black px-4 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-white/50"
            />
            {searching && <button type="button" onClick={() => { setInput(''); setQuery('') }} className="px-2 text-sm text-neutral-500 hover:text-white">Clear</button>}
            <button className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:opacity-85">Search</button>
          </form>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {(['all', 'confirmed', 'rejected', 'inconclusive'] as const).map((o) => (
              <Chip key={o} active={outcome === o} onClick={() => setOutcome(o)}>
                {o === 'all' ? 'All' : <><span aria-hidden>{OUTCOME[o].glyph}</span> {OUTCOME[o].label}</>} <span className="opacity-50">{counts[o]}</span>
              </Chip>
            ))}
            <span className="mx-1 w-px bg-white/10" />
            {causes.map(([c, n]) => (
              <Chip key={c} mono active={cause === c} onClick={() => setCause(cause === c ? null : c)}>{c} <span className="opacity-50">{n}</span></Chip>
            ))}
          </div>
        </div>
        <div className="max-h-[640px] min-h-0 flex-1 overflow-y-auto p-2 xl:max-h-none">
          {(history.error || search.error) && <div className="p-2"><ErrorNote text={(search.error || history.error)!} onRetry={search.error ? search.reload : history.reload} /></div>}
          {(searching ? search.loading : history.loading && !history.data) && <p className="p-4 text-sm text-neutral-500">{searching ? 'Searching…' : 'Loading…'}</p>}
          {!rows.length && !runbooks.length && !(searching ? search.loading : history.loading) && <p className="p-4 text-sm text-neutral-500">Nothing matches.</p>}
          {rows.map((m) => {
            const active = sel?.kind === 'incident' && sel.item.incident_id === m.incident_id
            return (
              <button key={m.incident_id} onClick={() => setSel({ kind: 'incident', item: m })}
                className={`mb-1 w-full rounded-xl p-3 text-left transition-colors ${active ? 'bg-white text-black' : 'hover:bg-white/5'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{m.incident_id}</span>
                  <span className="flex items-center gap-2">
                    {m.similarity !== undefined && <Score v={m.similarity} />}
                    <OutcomeBadge o={m.outcome} inverted={active} />
                  </span>
                </div>
                <p className={`mt-2 line-clamp-2 text-sm ${active ? 'text-black/70' : 'text-neutral-400'}`}>{parse(m.text).hypothesis}</p>
                <div className={`mt-2 flex justify-between font-mono text-[11px] ${active ? 'text-black/50' : 'text-neutral-600'}`}>
                  <span>{m.root_cause_type}</span>
                  <span>{date(m.timestamp)}</span>
                </div>
              </button>
            )
          })}
          {!!runbooks.length && (
            <>
              <div className="px-3 pt-4 pb-2 text-xs font-medium tracking-widest text-neutral-500 uppercase">Runbooks</div>
              {runbooks.map((r) => {
                const active = sel?.kind === 'runbook' && sel.item.id === r.id
                return (
                  <button key={r.id} onClick={() => setSel({ kind: 'runbook', item: r })}
                    className={`mb-1 w-full rounded-xl p-3 text-left transition-colors ${active ? 'bg-white text-black' : 'hover:bg-white/5'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">{r.title}</span>
                      <Score v={r.similarity} />
                    </div>
                    <p className={`mt-1 line-clamp-1 text-xs ${active ? 'text-black/60' : 'text-neutral-500'}`}>{r.text}</p>
                  </button>
                )
              })}
            </>
          )}
        </div>
      </Panel>

      <Panel title={sel?.kind === 'runbook' ? 'Runbook' : 'Memory'} right={sel && <span className="font-mono text-xs text-neutral-500">{sel.kind === 'runbook' ? sel.item.id : sel.item.incident_id}</span>}>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6">
          {!sel && <p className="text-sm text-neutral-500">Select an incident or runbook.</p>}
          {sel?.kind === 'runbook' && (
            <div>
              <h3 className="text-2xl font-light tracking-tight">{sel.item.title}</h3>
              <div className="mt-6 text-sm text-neutral-300"><Markdown text={sel.item.text} /></div>
            </div>
          )}
          {sel?.kind === 'incident' && <MemoryDetail m={sel.item} live={live.has(sel.item.incident_id)} onOpenIncident={onOpenIncident} />}
        </div>
      </Panel>
    </div>
  )
}

function MemoryDetail({ m, live, onOpenIncident }: { m: Memory; live: boolean; onOpenIncident: (id: string) => void }) {
  const p = parse(m.text)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <OutcomeBadge o={m.outcome} />
        <span className="font-mono text-xs text-neutral-500">{m.service}</span>
        <span className="text-xs text-neutral-500">{date(m.timestamp)}</span>
        {live && (
          <button onClick={() => onOpenIncident(m.incident_id)} className="ml-auto rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10">Open in Live →</button>
        )}
      </div>
      <div>
        <div className="text-xs text-neutral-500">Hypothesis</div>
        <p className="mt-2 text-2xl leading-snug font-light tracking-tight">{p.hypothesis}</p>
        <div className="mt-3 font-mono text-xs text-neutral-500">{m.root_cause_type}</div>
      </div>
      {p.symptoms && (
        <div>
          <div className="text-xs text-neutral-500">Symptoms</div>
          <ul className="mt-3 space-y-1.5 font-mono text-xs text-neutral-400">
            {p.symptoms.split('; ').map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      <div className={`rounded-xl border p-5 ${m.outcome === 'confirmed' ? 'border-emerald-400/40' : m.outcome === 'rejected' ? 'border-red-400/40' : 'border-white/10'}`}>
        <div className="text-xs text-neutral-500">{m.outcome === 'confirmed' ? 'Resolved by' : 'Outcome'}</div>
        <div className="mt-2 font-mono text-lg">{m.outcome === 'confirmed' ? m.resolved_by : p.resolvedBy || m.resolved_by}</div>
        {p.note && <p className="mt-3 text-sm text-neutral-400">Human said: “{p.note}”</p>}
        <p className="mt-3 text-xs text-neutral-500">
          {m.outcome === 'confirmed' ? 'Raises confidence when a similar incident recurs.'
            : m.outcome === 'rejected' ? 'Stored as negative memory: a similar hypothesis next time is penalised.'
              : 'Diagnosis was not useful; kept as context without a penalty.'}
        </p>
      </div>
    </>
  )
}

function OutcomeBadge({ o, inverted }: { o: Outcome; inverted?: boolean }) {
  const s = OUTCOME[o]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${inverted ? 'border-black/20' : s.tone}`}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  )
}

function Score({ v }: { v: number }) {
  return <span className="font-mono text-[11px] opacity-60" title="cosine similarity">{v.toFixed(2)}</span>
}

function Chip({ active, mono, onClick, children }: { active: boolean; mono?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 transition-colors ${mono ? 'font-mono' : ''} ${active ? 'border-white bg-white text-black' : 'border-white/15 text-neutral-400 hover:border-white/40 hover:text-white'}`}>
      {children}
    </button>
  )
}
