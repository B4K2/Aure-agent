#!/usr/bin/env bash
# Runs the VOID shop on a local minikube cluster (profile "aura"; MINIKUBE_PROFILE to change it).
#   bash problem/k8s/up.sh          # start cluster, apply manifests, build + deploy test-website at HEAD
#   bash problem/k8s/up.sh down     # delete the cluster
# Writes problem/.state/k8s.env with the env the injector, traffic and the Aura agent need.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
problem="$(dirname "$here")"
profile="${MINIKUBE_PROFILE:-aura}"

if [[ "${1:-}" == down ]]; then exec minikube delete -p "$profile"; fi

# The NodePorts are published on localhost: the node's own IP is often unreachable from the host.
minikube status -p "$profile" >/dev/null 2>&1 ||
  minikube start -p "$profile" --driver=docker --cpus=4 --memory=7g --ports=30400:30400,30433:30433,30870:30870
kubectl config use-context "$profile" >/dev/null

ip=127.0.0.1
mkdir -p "$problem/.state"
cat > "$problem/.state/k8s.env" <<ENV
VOID_RUNTIME=kubernetes
MINIKUBE_PROFILE=$profile
VOID_URL=http://$ip:30400
DATABASE_URL=postgres://void:void@$ip:30433/void
AURA_RUNTIME=kubernetes
K8S_NAMESPACE=void
K8S_CONTEXT=$profile
K8S_APP_DEPLOYMENT=void-app
K8S_APP_SELECTOR=app=void-app
K8S_DB_STATEFULSET=void-db
ENV

set -a; source "$problem/.state/k8s.env"; set +a
# Build first and apply with the real tag, so revision 1 is a real commit (a rollback can land on it).
tag="$(node --input-type=module -e "import('$problem/lib/k8s.js').then(m => console.log(m.buildImage()))" | tail -1)"
sed "s|void-app:latest|$tag|" "$here/void.yaml" | kubectl apply -f -
kubectl -n void annotate deployment/void-app --overwrite \
  "kubernetes.io/change-cause=$(git -C "$problem/../test-website" log -1 --format='%h %s')"
kubectl -n void rollout status statefulset/void-db --timeout=180s
kubectl -n void rollout status deployment/void-app --timeout=180s

echo
echo "VOID is up at $VOID_URL"
echo "Use it from this shell:   set -a; source problem/.state/k8s.env; set +a"
echo "Then: node problem/inject.js ... / npm --prefix problem run traffic, and start the agent from the same shell."
