#!/usr/bin/env bash
# Runs Aura itself in the cluster next to the VOID site (start that first: bash problem/k8s/up.sh).
#   bash deploy/k8s/up.sh       # build images in minikube, create aura-secrets from agent/.env, apply, seed memory
# Another cluster: push aura-agent / aura-web images to a registry, set them in kustomization.yaml,
# create the aura-secrets Secret yourself, then kubectl apply -k deploy/k8s.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
profile="${MINIKUBE_PROFILE:-aura}"
kubectl config use-context "$profile" >/dev/null

echo "building aura-agent:dev and aura-web:dev in minikube ($profile)…"
minikube -p "$profile" image build -t aura-agent:dev "$root/agent" >/dev/null
minikube -p "$profile" image build -t aura-web:dev "$root/web" >/dev/null

kubectl apply -f "$root/deploy/k8s/namespace.yaml" >/dev/null
# Only the keys the agent needs; addresses come from agent.yaml, not from a local .env.
grep -E '^(LLM_[A-Z_]+|HUGGING_FACE_TOKEN|NEO4J_PASSWORD|AURA_API_TOKEN|EMBED_[A-Z_]+)=' "$root/agent/.env" > /tmp/aura-secrets.env || true
grep -q '^NEO4J_PASSWORD=.' /tmp/aura-secrets.env || echo "NEO4J_PASSWORD=aura-dev-password" >> /tmp/aura-secrets.env
kubectl -n aura create secret generic aura-secrets --from-env-file=/tmp/aura-secrets.env --dry-run=client -o yaml | kubectl apply -f - >/dev/null
rm -f /tmp/aura-secrets.env

kubectl apply -k "$root/deploy/k8s"
kubectl -n aura rollout restart deployment/aura-agent deployment/aura-web >/dev/null  # pick up rebuilt :dev images
kubectl -n aura rollout status statefulset/qdrant statefulset/neo4j --timeout=300s
kubectl -n aura rollout status deployment/aura-web --timeout=120s
kubectl -n aura rollout status deployment/aura-agent --timeout=900s  # first boot downloads the embedding model

kubectl -n aura exec deploy/aura-agent -- sh -c \
  'test -f .aura_state/seeded || { python -m aura.memory.seed && touch .aura_state/seeded; }'
token="$(kubectl -n aura exec deploy/aura-agent -- cat .aura_state/api_token)"
echo
echo "Aura is running in namespace aura, watching namespace void."
echo "Dashboard: http://localhost:30870/dashboard#token=$token"
echo "CLI:       AURA_URL=http://localhost:30870 AURA_API_TOKEN=$token npm --prefix aura-cli start"
