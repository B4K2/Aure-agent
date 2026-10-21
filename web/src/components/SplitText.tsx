// Word-by-word blur reveal (inspired by React Bits "SplitText" / "BlurText").
import { motion } from 'motion/react'

type Props = { text: string; className?: string; delay?: number; stagger?: number }

export default function SplitText({ text, className, delay = 0, stagger = 0.06 }: Props) {
  return (
    <span className={className}>
      {text.split(' ').map((word, i) => (
        <motion.span
          key={i}
          className="inline-block whitespace-pre"
          initial={{ opacity: 0, y: '0.35em', filter: 'blur(10px)' }}
          whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: delay + i * stagger, ease: [0.22, 1, 0.36, 1] }}
        >
          {word + ' '}
        </motion.span>
      ))}
    </span>
  )
}
