import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';

export default function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useStore();
  const nav = useNavigate();
  return (
    <AnimatePresence>
      {cartOpen && (
        <>
          <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCartOpen(false)} />
          <motion.aside
            className="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="drawer-head">
              <h3>Your Bag</h3>
              <button className="link-btn" onClick={() => setCartOpen(false)}>Close ✕</button>
            </div>
            {cart.length === 0 ? (
              <p className="muted">Your bag is empty. Go find some heat.</p>
            ) : (
              <div className="drawer-items">
                {cart.map((it, i) => (
                  <div className="drawer-item" key={`${it.id}-${it.size}`}>
                    <img src={it.image} alt={it.name} />
                    <div>
                      <strong>{it.name}</strong>
                      <div className="muted">US {it.size}</div>
                      <div className="qty">
                        <button onClick={() => updateQty(i, -1)}>−</button>
                        <span>{it.qty}</span>
                        <button onClick={() => updateQty(i, 1)}>+</button>
                      </div>
                    </div>
                    <div className="price">${it.price * it.qty}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="drawer-foot">
              <div className="row"><span>Subtotal</span><strong>${cartTotal}</strong></div>
              <button
                className="btn btn-primary full"
                disabled={!cart.length}
                onClick={() => { setCartOpen(false); nav('/checkout'); }}
              >
                Checkout
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
