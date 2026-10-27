// The website on Kubernetes (k8s/up.sh): a "deploy" builds test-website at HEAD into void-app:<commit>
// inside minikube and rolls the Deployment to it, so `kubectl rollout history` lines up with git.
import { execFileSync } from 'node:child_process';
import { WEBSITE_DIR, K8S_NAMESPACE, MINIKUBE_PROFILE } from './config.js';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
export const kubectl = (...args) => run('kubectl', ['-n', K8S_NAMESPACE, ...args]);
const git = (...args) => run('git', ['-C', WEBSITE_DIR, ...args]);

export function buildImage() {
  const tag = `void-app:${git('rev-parse', '--short', 'HEAD')}`;
  console.log(`  building ${tag} in minikube (${MINIKUBE_PROFILE})…`);
  try {
    run('minikube', ['-p', MINIKUBE_PROFILE, 'image', 'build', '-t', tag, WEBSITE_DIR]);
  } catch (e) {
    throw new Error(`image build failed:\n${String(e.stderr || e.message).slice(-3000)}`);
  }
  return tag;
}

/** Roll deployment/void-app to the image for HEAD. Returns true once the rollout completes. */
export function deploy({ waitSec = 120 } = {}) {
  const tag = buildImage();
  const current = kubectl('get', 'deployment/void-app', '-o', 'jsonpath={.spec.template.spec.containers[0].image}');
  if (current === tag) {
    console.log(`  ${tag} is already deployed; restarting the rollout`);
    kubectl('rollout', 'restart', 'deployment/void-app');
  } else {
    console.log(`  kubectl set image deployment/void-app app=${tag}`);
    kubectl('set', 'image', 'deployment/void-app', `app=${tag}`);
    kubectl('annotate', 'deployment/void-app', '--overwrite', `kubernetes.io/change-cause=${git('log', '-1', '--format=%h %s')}`);
  }
  try {
    kubectl('rollout', 'status', 'deployment/void-app', `--timeout=${waitSec}s`);
    return true;
  } catch {
    console.log('  ! rollout did not complete (new pod never became ready; the old one keeps serving)');
    return false;
  }
}

export function scaleDb(replicas) {
  console.log(`  kubectl scale statefulset/void-db --replicas=${replicas}`);
  kubectl('scale', 'statefulset/void-db', `--replicas=${replicas}`);
  if (replicas > 0) kubectl('rollout', 'status', 'statefulset/void-db', '--timeout=120s');
}
