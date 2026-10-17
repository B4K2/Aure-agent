// Factory for "bad deploy" scenarios: patch website code, record the deploy, restart the server.
import { applyEdits, revertEdits, recordDeploy } from '../lib/patch.js';
import { restart, snapshot } from '../lib/server.js';

export const deployScenario = ({ edits, commit, rollbackCommit, expectDown, beforeRecover, afterInject, ...meta }) => ({
  ...meta,
  kind: 'deploy',
  async inject(opts) {
    snapshot();
    applyEdits(edits);
    recordDeploy({ scenario: meta.name, action: 'apply', message: commit, edits });
    if (opts.restart !== false) await restart({ expectDown });
    else console.log('  --no-restart: code patched; restart the website to "deploy" it.');
    await afterInject?.(opts);
    return {};
  },
  async recover(info, opts) {
    await beforeRecover?.(info);
    revertEdits(edits);
    recordDeploy({ scenario: meta.name, action: 'revert', message: rollbackCommit || `Revert "${commit}"`, edits });
    if (opts.restart !== false) await restart();
  },
});
