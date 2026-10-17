import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function ProductCard({ p, i = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ delay: (i % 4) * 0.08, duration: 0.5 }}
    >
      <Link to={`/product/${p.id}`} className="card">
        <div className="card-img">
          <img src={p.image} alt={p.name} loading="lazy" />
          <span className="tag">{p.category}</span>
        </div>
        <div className="card-body">
          <div>
            <h4>{p.name}</h4>
            <span className="muted">{p.colorway} · ★ {p.rating}</span>
          </div>
          <span className="price">${p.price}</span>
        </div>
      </Link>
    </motion.div>
  );
}
