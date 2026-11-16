---
id: 4
topic: frontend hosting
choice: Vercel for web/ (root directory web, Vite build to dist, SPA rewrite to index.html via web/vercel.json). In-cluster dashboard stays nginx (decision #2).
status: active
agent: aura-project-590d8e1c
checkpoint: decision-frontend-hosting
date: 2026-10-27 11:18:33
---

# frontend hosting: Vercel for web/ (root directory web, Vite build to dist, SPA rewrite to index.html via web/vercel.json). In-cluster dashboard stays nginx (decision #2).

/dashboard is a path route; Vercel serves at the domain root with rewrites, GitHub Pages would need a /Aure-agent/ base path and a 404 fallback hack.
