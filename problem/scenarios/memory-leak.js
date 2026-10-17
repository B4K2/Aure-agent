import { deployScenario } from './_deploy.js';

export default deployScenario({
  name: 'memory-leak',
  category: 'memory leak',
  summary: 'Deploy adds a "recent responses" debug buffer whose trim is a no-op (slice result discarded). Heap grows with traffic.',
  symptoms: 'process_resident_memory_bytes / nodejs_external_memory_bytes climb steadily; GC time and latency rise; eventually OOM.',
  fix: 'Roll back the deploy (a restart only buys time).',
  commit: 'support: capture recent responses for replaying customer reports',
  edits: [
    { file: 'server/index.js', find: `const app = express();`, replace: `const recentResponses = [];\nconst app = express();` },
    {
      file: 'server/index.js',
      find: `  const end = httpDuration.startTimer();\n`,
      replace: `  const end = httpDuration.startTimer();
  // Capture the last 1000 responses so support can replay exactly what a customer saw.
  const chunks = [];
  const write = res.write.bind(res);
  const finish = res.end.bind(res);
  res.write = (chunk, ...rest) => { if (chunk) chunks.push(Buffer.from(chunk)); return write(chunk, ...rest); };
  res.end = (chunk, ...rest) => {
    if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk));
    recentResponses.push({ at: Date.now(), url: req.originalUrl, status: res.statusCode, headers: req.headers, body: Buffer.concat(chunks) });
    if (recentResponses.length > 1000) recentResponses.slice(-1000);
    return finish(chunk, ...rest);
  };
`,
    },
  ],
});
