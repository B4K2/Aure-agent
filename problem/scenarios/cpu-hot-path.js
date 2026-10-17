import { deployScenario } from './_deploy.js';

export default deployScenario({
  name: 'cpu-hot-path',
  category: 'bad deploy (cpu)',
  summary: 'Deploy signs every catalog response with synchronous PBKDF2, blocking the event loop on the hottest endpoint.',
  symptoms: 'CPU ~100% on the node process, nodejs_eventloop_lag_seconds up, latency up on ALL routes (not only /api/products).',
  fix: 'Roll back the deploy.',
  commit: 'catalog: add X-Catalog-Signature header for CDN integrity checks',
  edits: [
    { file: 'server/index.js', find: `import fs from 'node:fs';\n`, replace: `import fs from 'node:fs';\nimport crypto from 'node:crypto';\n` },
    {
      file: 'server/index.js',
      find: `    params\n  );\n  res.json(rows);`,
      replace: `    params\n  );\n  res.set('X-Catalog-Signature', crypto.pbkdf2Sync(JSON.stringify(rows), JWT_SECRET, 150000, 32, 'sha512').toString('hex'));\n  res.json(rows);`,
    },
  ],
});
