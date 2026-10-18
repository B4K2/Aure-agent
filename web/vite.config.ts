import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dashboard talks to the Aura agent server; proxying keeps it same-origin in dev (no CORS).
const AURA = process.env.AURA_URL || 'http://127.0.0.1:8700'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws': { target: AURA, ws: true },
      '/incidents': AURA,
    },
  },
})
