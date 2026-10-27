---
id: 2
topic: aura kubernetes packaging
choice: Plain manifests + kustomize in deploy/k8s (namespace aura); agent image with CPU torch + kubectl + git; web dashboard served by nginx proxying /ws,/incidents,/memory to the agent; secrets from agent/.env; RBAC Role in the watched namespace. In-cluster deploy correlation falls back to Deployment rollout history (change-cause) when no git repo is present.
status: active
agent: aura-project-b1eebec1
checkpoint: decision-aura-kubernetes-packaging
date: 2026-10-26 23:02:39
---

# aura kubernetes packaging: Plain manifests + kustomize in deploy/k8s (namespace aura); agent image with CPU torch + kubectl + git; web dashboard served by nginx proxying /ws,/incidents,/memory to the agent; secrets from agent/.env; RBAC Role in the watched namespace. In-cluster deploy correlation falls back to Deployment rollout history (change-cause) when no git repo is present.

No extra tooling (kubectl apply -k), matches problem/k8s style; in-cluster agent has no website checkout.
