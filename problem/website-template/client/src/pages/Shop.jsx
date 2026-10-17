import { useEffect, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import { api } from '../store.jsx';

const CATS = ['All', 'Running', 'Lifestyle', 'Basketball', 'Skate', 'Training', 'Trail'];

export default function Shop() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ category, sort, q });
    api(`/api/products?${params}`).then(setProducts);
  }, [category, sort, q]);

  return (
    <section className="section page-top">
      <h1 className="page-title">Catalog</h1>
      <div className="filters">
        <div className="chips">
          {CATS.map((c) => (
            <button key={c} className={c === category ? 'chip active' : 'chip'} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <div className="filter-right">
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="">Featured</option>
            <option value="price-asc">Price: Low → High</option>
            <option value="price-desc">Price: High → Low</option>
          </select>
        </div>
      </div>
      <div className="grid">
        {products.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
      </div>
      {!products.length && <p className="muted">No sneakers match.</p>}
    </section>
  );
}
