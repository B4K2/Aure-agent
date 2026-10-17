import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';

// Area chart that only animates in once it scrolls into view.
export default function AnimatedChart({ data, dataKey = 'value', xKey = 'month', prefix = '', height = 280 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.3 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const gid = `g-${dataKey}`;

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {visible && (
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey={xKey} stroke="#666" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis stroke="#666" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `${prefix}${v}`} />
            <Tooltip
              contentStyle={{ background: '#0a0a0a', border: '1px solid #333', borderRadius: 12, color: '#fff' }}
              formatter={(v) => [`${prefix}${v}`, '']}
              separator=""
              cursor={{ stroke: '#fff', strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke="#fff"
              strokeWidth={2.5}
              fill={`url(#${gid})`}
              animationDuration={1800}
              animationEasing="ease-out"
              dot={{ r: 3, fill: '#000', stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6, fill: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
