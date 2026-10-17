import { Link, NavLink } from 'react-router-dom';
import GlassSurface from './GlassSurface.jsx';
import { useStore } from '../store.jsx';

export default function Navbar() {
  const { user, cartCount, setCartOpen, logout } = useStore();
  return (
    <div className="nav-wrap">
      <GlassSurface height={64} borderRadius={32} className="nav-glass" distortionScale={-40} greenOffset={3} blueOffset={6} backgroundOpacity={0.12} blur={14} style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
        <nav className="nav">
          <Link to="/" className="logo">VOID<span>●</span></Link>
          <div className="nav-links">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/shop">Shop</NavLink>
            {user ? <NavLink to="/account">Account</NavLink> : <NavLink to="/login">Sign in</NavLink>}
          </div>
          <div className="nav-actions">
            {user && <button className="link-btn" onClick={logout}>Log out</button>}
            <button className="cart-btn" onClick={() => setCartOpen(true)}>
              Cart <span className="badge">{cartCount}</span>
            </button>
          </div>
        </nav>
      </GlassSurface>
    </div>
  );
}
