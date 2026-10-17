import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import GlassSurface from './GlassSurface.jsx';

export default function Carousel({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return <div className="hero skeleton" />;
  const p = items[idx];
  const go = (d) => setIdx((i) => (i + d + items.length) % items.length);

  return (
    <section className="hero">
      <AnimatePresence mode="sync">
        <motion.img
          key={p.id}
          src={p.image}
          alt={p.name}
          className="hero-img"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </AnimatePresence>
      <div className="hero-shade" />
      <div className="hero-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.6 }}
          >
            <span className="eyebrow">New Drop — {String(idx + 1).padStart(2, '0')}/{String(items.length).padStart(2, '0')}</span>
            <h1 className="hero-title">{p.name}</h1>
            <p className="hero-sub">{p.colorway} colorway. {p.category}. Limited pairs.</p>
          </motion.div>
        </AnimatePresence>
        <GlassSurface width={340} height={84} borderRadius={42} className="hero-glass">
          <div className="hero-cta">
            <div>
              <div className="muted small">From</div>
              <div className="hero-price">${p.price}</div>
            </div>
            <Link to={`/product/${p.id}`} className="btn btn-primary">Shop now →</Link>
          </div>
        </GlassSurface>
      </div>
      <div className="hero-controls">
        <button onClick={() => go(-1)} aria-label="Previous">←</button>
        <div className="dots">
          {items.map((it, i) => (
            <button key={it.id} className={i === idx ? 'dot active' : 'dot'} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`} />
          ))}
        </div>
        <button onClick={() => go(1)} aria-label="Next">→</button>
      </div>
    </section>
  );
}
