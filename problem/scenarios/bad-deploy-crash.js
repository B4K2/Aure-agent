import { deployScenario } from './_deploy.js';

export default deployScenario({
  name: 'bad-deploy-crash',
  category: 'bad deploy',
  summary: 'Deploy adds a required env var that is not set; the server crashes on boot. Full outage.',
  symptoms: 'Connection refused on :4000, /api/health down, process exits with "PAYMENTS_API_KEY is not set".',
  fix: 'Roll back the deploy (or set PAYMENTS_API_KEY) and start the server.',
  commit: 'payments: require PAYMENTS_API_KEY at startup',
  expectDown: true,
  edits: [{
    file: 'server/index.js',
    find: `const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';`,
    replace: `const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PAYMENTS_API_KEY = process.env.PAYMENTS_API_KEY;
if (!PAYMENTS_API_KEY) throw new Error('PAYMENTS_API_KEY is not set — refusing to start without payment provider credentials');`,
  }],
});
