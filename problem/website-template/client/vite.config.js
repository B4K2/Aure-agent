import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    headers: { 'Cache-Control': 'no-store' },
    proxy: {
      '/api': 'http://localhost:4000',
      '/images': 'http://localhost:4000',
    },
  },
})
