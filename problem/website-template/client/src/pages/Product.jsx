import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import AnimatedChart from '../components/AnimatedChart.jsx';
import GlassSurface from '../components/GlassSurface.jsx';
import { api, useStore } from '../store.jsx';

const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

export default function Product() {
  const { id } = useParams();
  const { addToCart } = useStore();
  const [p, setP] = useState(null);
  const [size, setSize] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setP(null);
    api(`/api/products/${id}`).then(setP).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <section className="section page-top"><p>{err}</p></section>;
  if (!p) return <section className="section page-top"><div className="skeleton" style={{ height: 500 }} /></section>;

  return (
    <section className="section page-top">
      <div className="pdp">
        <motion.div className="pdp-img" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}>
          <img src={p.image} alt={p.name} />
        </motion.div>
        <div className="pdp-info">
          <span className="eyebrow">{p.category} · {p.colorway}</span>
          <h1 className="pdp-title">{p.name}</h1>
          <div className="pdp-price">${p.price} <span className="muted small">★ {p.rating} · {p.stock} left</span></div>
          <p className="muted">{p.description}</p>

          <div className="muted small" style={{ margin: '24px 0 10px' }}>Select size (US)</div>
          <div className="sizes">
            {p.sizes.map((s) => (
              <button key={s} className={s === size ? 'size active' : 'size'} onClick={() => setSize(s)}>{s}</button>
            ))}
          </div>
          <button className="btn btn-primary full" disabled={!size} onClick={() => addToCart(p, size)}>
            {size ? 'Add to bag' : 'Pick a size'}
          </button>

          <GlassSurface borderRadius={24} height="auto" style={{ marginTop: 32 }}>
            <div style={{ width: '100%', padding: 20 }}>
              <div className="muted small" style={{ marginBottom: 8 }}>Resale price · last 12 months</div>
              <AnimatedChart data={p.history.map((v, i) => ({ month: MONTHS[i], value: v }))} prefix="$" height={200} />
            </div>
          </GlassSurface>
        </div>
      </div>
    </section>
  );
}
