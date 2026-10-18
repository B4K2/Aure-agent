// First-run screen: the dashboard authenticates with the same token as aura-cli (AURA_API_TOKEN).
import { useState } from 'react'
import Logo from '../components/Logo'

export default function Connect({ onConnect, error }: { onConnect: (token: string) => void; error?: string }) {
  const [token, setToken] = useState('')
  return (
    <div className="grid min-h-screen place-items-center bg-black px-6 text-white">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConnect(token.trim() || 'dev-aura-token')
        }}
        className="w-full max-w-sm"
      >
        <Logo size={36} />
        <h1 className="mt-10 text-3xl font-light tracking-tight">
          Connect to <span className="font-serif italic">your agent</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Use the API token from <span className="font-mono text-white">agent/.env</span> (<span className="font-mono">AURA_API_TOKEN</span>).
          Leave it empty for the local default.
        </p>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="dev-aura-token"
          className="mt-8 w-full rounded-full border border-white/15 bg-neutral-950 px-5 py-3 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-white/50"
        />
        {error && <p className="mt-3 text-sm text-white">✕ {error}</p>}
        <button className="mt-4 w-full rounded-full bg-white py-3 text-sm font-medium text-black transition-opacity hover:opacity-85">
          Connect
        </button>
        <a href="/" className="mt-6 block text-center text-xs text-neutral-500 hover:text-white">← Back to site</a>
      </form>
    </div>
  )
}
