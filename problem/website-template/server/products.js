// Seed catalog. Images live in ./images and are served (uncached) at /images/*.
const names = [
  ['Phantom Runner', 'Running', 'Crimson'],
  ['Mono Court 87', 'Lifestyle', 'Chalk'],
  ['Apex Volt', 'Running', 'Neon'],
  ['Shadow Hi', 'Basketball', 'Onyx'],
  ['Cloudstep Lux', 'Lifestyle', 'Bone'],
  ['Nitro Glide', 'Running', 'Solar'],
  ['Retro Dunk SB', 'Skate', 'Multi'],
  ['Urban Stride', 'Lifestyle', 'Ivory'],
  ['Pulse Trainer', 'Training', 'Graphite'],
  ['Vapor Edge', 'Running', 'Ice'],
  ['Heritage 1', 'Basketball', 'Classic'],
  ['Drift Low', 'Skate', 'Sand'],
  ['Orbit Max', 'Running', 'Cobalt'],
  ['Eclipse Mid', 'Basketball', 'Blackout'],
  ['Zenith Knit', 'Training', 'Storm'],
  ['Atlas Trail', 'Trail', 'Moss'],
];

// Deterministic pseudo-random so prices/history are stable across restarts.
function rand(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export const products = names.map(([name, category, colorway], i) => {
  const id = i + 1;
  const price = Math.round(90 + rand(id) * 180);
  // 12-month resale price history for the animated chart
  const history = Array.from({ length: 12 }, (_, m) =>
    Math.round(price * (0.85 + rand(id * 31 + m) * 0.5 + m * 0.02))
  );
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    category,
    colorway,
    price,
    rating: (3.8 + rand(id * 7) * 1.2).toFixed(1),
    stock: Math.round(5 + rand(id * 13) * 60),
    image: `/images/sneaker-${String(id).padStart(2, '0')}.jpg`,
    sizes: [6, 7, 8, 9, 10, 11, 12, 13],
    description: `The ${name} blends street-ready attitude with all-day comfort. Responsive foam, a breathable upper and a ${colorway.toLowerCase()} colorway built to turn heads.`,
    history,
    featured: [1, 4, 6, 13, 14].includes(id),
  };
});
