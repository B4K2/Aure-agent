// Drag handle between dashboard panels (xl layout only). Reports the pointer delta in px since
// drag start; the caller owns the size. Double-click resets. Sizes persist via usePersisted.
import { useRef, useState } from 'react'

export function usePersisted(key: string, initial: number) {
  const [v, setV] = useState(() => Number(localStorage.getItem(key)) || initial)
  const set = (n: number) => { setV(n); localStorage.setItem(key, String(n)) }
  return [v, set] as const
}

type Props = { axis: 'x' | 'y'; onDrag: (delta: number, start: boolean) => void; onReset: () => void }

export default function Splitter({ axis, onDrag, onReset }: Props) {
  const origin = useRef<number | null>(null)
  const [active, setActive] = useState(false)
  const pos = (e: React.PointerEvent) => (axis === 'x' ? e.clientX : e.clientY)

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        origin.current = pos(e)
        setActive(true)
        onDrag(0, true)
      }}
      onPointerMove={(e) => origin.current != null && onDrag(pos(e) - origin.current, false)}
      onPointerUp={() => { origin.current = null; setActive(false) }}
      onDoubleClick={onReset}
      className={`group hidden shrink-0 touch-none items-center justify-center select-none xl:flex ${axis === 'x' ? 'w-6 cursor-col-resize' : 'h-6 cursor-row-resize'}`}
    >
      <span
        className={`rounded-full transition-colors ${axis === 'x' ? 'h-10 w-1' : 'h-1 w-10'} ${active ? 'bg-sky-400' : 'bg-white/10 group-hover:bg-white/40'}`}
      />
    </div>
  )
}
