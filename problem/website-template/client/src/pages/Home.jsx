import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Carousel from '../components/Carousel.jsx';
import ProductCard from '../components/ProductCard.jsx';
import AnimatedChart from '../components/AnimatedChart.jsx';
import CountUp from '../components/CountUp.jsx';
import GlassSurface from '../components/GlassSurface.jsx';
import { api } from '../store.jsx';

export default function Home() {
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api('/api/products').then(setProducts);
    api('/api/stats').then(setStats);
  }, []);
  const featured = products.filter((p) => p.featured);

  return (
    <>
      <Carousel items={featured} />

      <div className="marquee">
        <div className="marquee-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k}>
              FREE SHIPPING OVER $150 ✦ NEW DROPS EVERY FRIDAY ✦ 30-DAY RETURNS ✦ AUTHENTIC ONLY ✦ MEMBERS GET EARLY ACCESS ✦&nbsp;
            </span>
          ))}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Trending <em>now</em></h2>
          <Link to="/shop" className="link-btn">View all →</Link>
        </div>
        <div className="grid">
          {products.slice(0, 8).map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
        </div>
      </section>

      <section className="section split">
        <motion.div initial={{ opacity: 0, x: -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
          <span className="eyebrow">The Market</span>
          <h2 className="big">Hype, <br />charted.</h2>
          <p className="muted">Monthly drop demand across the VOID network. Every curve is a sell-out.</p>
          <div className="stats">
            <div><strong><CountUp to={stats?.products || 16} /></strong><span>Silhouettes</span></div>
            <div><strong><CountUp to={(stats?.users || 0) + 12480} /></strong><span>Members</span></div>
            <div><strong><CountUp to={(stats?.orders || 0) + 38211} /></strong><span>Pairs shipped</span></div>
          </div>
        </motion.div>
        <GlassSurface borderRadius={28} height="auto" className="chart-glass">
          <div style={{ width: '100%', padding: 24 }}>
            <div className="muted small" style={{ marginBottom: 12 }}>Drop demand index · 2026</div>
            {stats && <AnimatedChart data={stats.drops} />}
          </div>
        </GlassSurface>
      </section>

      <section className="section">
        <div className="banner">
          <img src="/images/sneaker-07.jpg" alt="" />
          <div className="banner-text">
            <h2 className="big">Join the <br />VOID.</h2>
            <p>Create an account for early access to every drop.</p>
            <Link to="/signup" className="btn btn-primary">Create account</Link>
          </div>
        </div>
      </section>
    </>
  );
}
