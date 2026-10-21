// First-run screen: the dashboard authenticates with the same token as aura-cli. Usually skipped: the CLI's
// /web prints a link that carries the token.
import { useState } from 'react'
import Logo from '../components/Logo'

export default function Connect({ onConnect, error }: { onConnect: (token: string) => void; error?: string }) {
  const [token, setToken] = useState('')
  return (
    <div className="grid min-h-screen place-items-center bg-black px-6 text-white">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (token.trim()) onConnect(token.trim())
        }}
        className="w-full max-w-sm"
      >
        <Logo size={36} />
        <h1 className="mt-10 text-3xl font-light tracking-tight">
          Connect to <span className="font-serif italic">your agent</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Run <span className="font-mono text-white">/web</span> in the <span className="font-mono text-white">aura</span> CLI and open the link it
          prints. Or paste the token from <span className="font-mono text-white">agent/.aura_state/api_token</span> (or your{' '}
          <span className="font-mono">AURA_API_TOKEN</span>).
        </p>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="API token"
          className="mt-8 w-full rounded-full border border-white/15 bg-neutral-950 px-5 py-3 font-mono text-sm outline-none placeholder:text-neutral-600 focus:border-white/50"
        />
        {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">✕ {error}</p>}
        <button disabled={!token.trim()} className="mt-4 w-full disabled:opacity-40 rounded-full bg-white py-3 text-sm font-medium text-black transition-opacity hover:opacity-85">
          Connect
        </button>
        <a href="/" className="mt-6 block text-center text-xs text-neutral-500 hover:text-white">← Back to site</a>
      </form>
    </div>
  )
}
