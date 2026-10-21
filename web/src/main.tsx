import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Dashboard from './dashboard/Dashboard.tsx'

const page = location.pathname.replace(/\/$/, '') === '/dashboard' ? <Dashboard /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)
