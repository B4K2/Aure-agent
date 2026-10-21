// Minimal markdown for Aura's chat answers (mirrors aura-cli/src/Markdown.tsx): headings, bullet and
// numbered lists, fenced code, **bold**, *italic*, `code`. Anything else is plain text.
import type { ReactNode } from 'react'

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>
      : p.startsWith('`') ? <code key={i} className="rounded bg-white/10 px-1 py-px font-mono text-[0.85em] text-white">{p.slice(1, -1)}</code>
        : p.startsWith('*') ? <em key={i}>{p.slice(1, -1)}</em>
          : p)
}

type Block =
  | { kind: 'p' | 'h'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string }

function parse(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r/g, '').trim().split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.startsWith('```')) {
      const body: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i])
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const head = line.match(/^\s*#{1,6}\s+(.*)/)
    const ul = line.match(/^\s*[-*•]\s+(.*)/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/)
    const last = blocks.at(-1)
    if (head) blocks.push({ kind: 'h', text: head[1] })
    else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      const item = (ul ?? ol)![1]
      if (last?.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (!line.trim()) blocks.push({ kind: 'p', text: '' })
    else if (last?.kind === 'p' && last.text) last.text += ' ' + line.trim()
    else blocks.push({ kind: 'p', text: line.trim() })
  }
  return blocks.filter((b) => b.kind !== 'p' || b.text)
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 leading-relaxed">
      {parse(text).map((b, i) => {
        switch (b.kind) {
          case 'h': return <div key={i} className="font-medium text-white">{inline(b.text.replace(/\*\*/g, ''))}</div>
          case 'ul': return <ul key={i} className="ml-4 list-disc space-y-1 marker:text-neutral-600">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
          case 'ol': return <ol key={i} className="ml-4 list-decimal space-y-1 marker:text-neutral-500">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>
          case 'code': return <pre key={i} className="overflow-x-auto rounded-lg bg-black p-3 font-mono text-xs text-neutral-200">{b.text}</pre>
          default: return <p key={i}>{inline(b.text)}</p>
        }
      })}
    </div>
  )
}
