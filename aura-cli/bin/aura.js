#!/usr/bin/env node
// `npm link` this package to get a global `aura` command.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(path.join(root, 'node_modules', '.bin', 'tsx'), [path.join(root, 'src', 'index.tsx'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 0);
