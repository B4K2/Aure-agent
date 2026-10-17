import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AnimatedChart from '../components/AnimatedChart.jsx';
import GlassSurface from '../components/GlassSurface.jsx';
import { api, useStore } from '../store.jsx';

export default function Account() {
  const { user, token } = useStore();
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (token) api('/api/orders', { token }).then(setOrders).catch(() => {});
  }, [token]);
  if (!user) return <Navigate to="/login" replace />;

  let running = 0;
  const spend = [...orders].reverse().map((o) => ({ month: `#${o.id}`, value: (running += o.total) }));

  return (
    <section className="section page-top">
      <h1 className="page-title">Hey, {user.name}</h1>
      <p className="muted">{user.email}</p>

      {spend.length > 1 && (
        <GlassSurface borderRadius={24} height="auto" style={{ margin: '32px 0' }}>
          <div style={{ width: '100%', padding: 20 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>Lifetime spend</div>
            <AnimatedChart data={spend} prefix="$" height={220} />
          </div>
        </GlassSurface>
      )}

      <h3 style={{ marginTop: 32 }}>Orders</h3>
      {!orders.length && <p className="muted">No orders yet.</p>}
      <div className="orders">
        {orders.map((o) => (
          <div className="order" key={o.id}>
            <div className="order-head">
              <strong>Order #{o.id}</strong>
              <span className="muted">{new Date(o.created_at).toLocaleString()}</span>
              <strong>${o.total}</strong>
            </div>
            <div className="order-items">
              {o.items.map((it, i) => (
                <div key={i} className="order-item">
                  <img src={it.image} alt={it.name} />
                  <span>{it.name} · US {it.size} × {it.qty}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
