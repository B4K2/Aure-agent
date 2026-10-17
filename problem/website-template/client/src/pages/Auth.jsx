import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import GlassSurface from '../components/GlassSurface.jsx';
import { api, useStore } from '../store.jsx';

export default function Auth({ mode }) {
  const isSignup = mode === 'signup';
  const { login } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const data = await api(`/api/auth/${isSignup ? 'signup' : 'login'}`, { method: 'POST', body: form });
      login(data);
      nav(loc.state?.from || '/account');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section className="auth">
      <img className="auth-bg" src="/images/sneaker-04.jpg" alt="" />
      <GlassSurface width="min(440px, 92vw)" borderRadius={28} className="auth-glass">
        <form onSubmit={submit} className="auth-form">
          <h1>{isSignup ? 'Create account' : 'Welcome back'}</h1>
          <p className="muted">{isSignup ? 'Sign up with your email to start copping.' : 'Sign in with your email.'}</p>
          {isSignup && <input className="input" placeholder="Name" value={form.name} onChange={set('name')} />}
          <input className="input" type="email" placeholder="Email" required value={form.email} onChange={set('email')} />
          <input className="input" type="password" placeholder="Password (min 6)" required value={form.password} onChange={set('password')} />
          {err && <div className="error">{err}</div>}
          <button className="btn btn-primary full" disabled={busy}>{busy ? '…' : isSignup ? 'Create account' : 'Sign in'}</button>
          <p className="muted small">
            {isSignup ? <>Already a member? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
          </p>
        </form>
      </GlassSurface>
    </section>
  );
}
