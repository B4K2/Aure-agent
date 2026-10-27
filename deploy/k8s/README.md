# Aura on Kubernetes

Aura (agent, Qdrant, Neo4j, dashboard) in namespace `aura`, watching the VOID site in namespace `void`.

## Local (minikube)

```bash
bash problem/k8s/up.sh     # cluster (profile "aura") + VOID site
bash deploy/k8s/up.sh      # Aura: builds images, creates aura-secrets from agent/.env, seeds memory
```

It prints a signed-in dashboard link (`http://localhost:30870/dashboard#token=…`) and the env for
`aura-cli`. Rerun `deploy/k8s/up.sh` after code changes; it rebuilds the `:dev` images and restarts.

## Another cluster

1. Build and push `agent/Dockerfile` and `web/Dockerfile`; set the images in `kustomization.yaml`.
2. Create the secret: `kubectl -n aura create secret generic aura-secrets --from-env-file=<file>`
   with `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `HUGGING_FACE_TOKEN`, `NEO4J_PASSWORD`
   and optionally `AURA_API_TOKEN` (generated into the state volume if empty).
3. Point it at your app: `K8S_NAMESPACE`, `VOID_URL` and `DATABASE_URL` in `agent.yaml`, and the
   namespace of the Role/RoleBinding in `rbac.yaml`. The app Deployment, its pod selector and the DB
   StatefulSet are detected from the namespace when `K8S_APP_DEPLOYMENT` / `K8S_APP_SELECTOR` /
   `K8S_DB_STATEFULSET` are empty (the app is the one Deployment whose image isn't a database).
4. `kubectl apply -k deploy/k8s`, then once: `kubectl -n aura exec deploy/aura-agent -- python -m aura.memory.seed`.

## Aura outside the cluster (EC2, a VM)

No manifests needed: run the agent with `AURA_RUNTIME=kubernetes` and a kubeconfig for the cluster
(`aws eks update-kubeconfig` on EKS), plus `VOID_URL` / `DATABASE_URL`. `cd agent && uv run aura connect -n <namespace>`
shows what it detects (app Deployment, selector, DB StatefulSet) and saves it with `AURA_RUNTIME=kubernetes` to `agent/.env`.
Give that identity the same permissions as `rbac.yaml`.

## What the agent may do

`rbac.yaml`: read pods, logs and workloads in the watched namespace; patch the app Deployment
(`rollout undo` / `rollout restart`) and scale the DB StatefulSet. It cannot delete anything or read secrets.
Without a checkout of the app's repo, deploy correlation uses the Deployment's rollout history
(`kubernetes.io/change-cause` = `<commit> <message>`), so set that annotation in your deploys.
