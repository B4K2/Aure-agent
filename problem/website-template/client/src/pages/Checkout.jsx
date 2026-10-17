import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, useStore } from '../store.jsx';

export default function Checkout() {
  const { user, token, cart, cartTotal, clearCart } = useStore();
  const nav = useNavigate();
  const [form, setForm] = useState({ address: '', city: '', zip: '', card: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login" state={{ from: '/checkout' }} replace />;

  if (done)
    return (
      <section className="section page-top center">
        <h1 className="page-title">Order #{done.id} confirmed ✦</h1>
        <p className="muted">Total charged: ${done.total}. Your pairs are on the way.</p>
        <button className="btn btn-primary" onClick={() => nav('/account')}>View orders</button>
      </section>
    );

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        token,
        body: {
          items: cart.map(({ id, size, qty }) => ({ id, size, qty })),
          address: `${form.address}, ${form.city} ${form.zip}`,
        },
      });
      clearCart();
      setDone(order);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const shipping = cartTotal >= 150 || cartTotal === 0 ? 0 : 12;

  return (
    <section className="section page-top">
      <h1 className="page-title">Checkout</h1>
      <div className="checkout">
        <form onSubmit={submit} className="checkout-form">
          <h3>Shipping</h3>
          <input className="input" placeholder="Street address" required value={form.address} onChange={set('address')} />
          <div className="two">
            <input className="input" placeholder="City" required value={form.city} onChange={set('city')} />
            <input className="input" placeholder="ZIP" required value={form.zip} onChange={set('zip')} />
          </div>
          <h3>Payment</h3>
          <input className="input" placeholder="Card number (test — anything works)" required value={form.card} onChange={set('card')} />
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary full" disabled={busy || !cart.length}>
            {busy ? 'Placing order…' : `Pay $${cartTotal + shipping}`}
          </button>
        </form>
        <div className="summary">
          <h3>Summary</h3>
          {cart.map((it) => (
            <div className="drawer-item" key={`${it.id}-${it.size}`}>
              <img src={it.image} alt={it.name} />
              <div><strong>{it.name}</strong><div className="muted">US {it.size} × {it.qty}</div></div>
              <div className="price">${it.price * it.qty}</div>
            </div>
          ))}
          <div className="row"><span>Subtotal</span><span>${cartTotal}</span></div>
          <div className="row"><span>Shipping</span><span>{shipping ? `$${shipping}` : 'Free'}</span></div>
          <div className="row total"><span>Total</span><strong>${cartTotal + shipping}</strong></div>
        </div>
      </div>
    </section>
  );
}
