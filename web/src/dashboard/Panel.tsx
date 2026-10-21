// Bordered card with a small uppercase title bar; every dashboard view is built from these.
export default function Panel({ title, children, className = '', right, style }: { title: string; children: React.ReactNode; className?: string; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-neutral-950 ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <h2 className="text-xs font-medium tracking-widest text-neutral-500 uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}
