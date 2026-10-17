import { createContext, useContext, useEffect, useState } from 'react';

const Ctx = createContext(null);

export async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function StoreProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('void_token'));
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('void_user') || 'null'));
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem('void_cart') || '[]'));
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => localStorage.setItem('void_cart', JSON.stringify(cart)), [cart]);

  const login = ({ token, user }) => {
    localStorage.setItem('void_token', token);
    localStorage.setItem('void_user', JSON.stringify(user));
    setToken(token);
    setUser(user);
  };
  const logout = () => {
    localStorage.removeItem('void_token');
    localStorage.removeItem('void_user');
    setToken(null);
    setUser(null);
  };

  const addToCart = (product, size) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === product.id && x.size === size);
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { id: product.id, name: product.name, image: product.image, price: product.price, size, qty: 1 }];
    });
    setCartOpen(true);
  };
  const updateQty = (idx, delta) =>
    setCart((c) => c.map((x, i) => (i === idx ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0));
  const clearCart = () => setCart([]);
  const cartTotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
  const cartCount = cart.reduce((s, x) => s + x.qty, 0);

  return (
    <Ctx.Provider
      value={{ token, user, login, logout, cart, addToCart, updateQty, clearCart, cartTotal, cartCount, cartOpen, setCartOpen }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useStore = () => useContext(Ctx);
