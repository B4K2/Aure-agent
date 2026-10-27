---
id: 1
topic: kubernetes integration
choice: Runtime backend abstraction (docker | kubernetes) selected by config; k8s backend shells out to kubectl. Works in-cluster (ServiceAccount+RBAC) or external (kubeconfig, e.g. EC2). Aura itself also deployable to k8s via manifests; local dev cluster for test-website.
status: active
agent: aura-project-b1eebec1
checkpoint: decision-kubernetes-integration
date: 2026-10-26 22:32:55
---

# kubernetes integration: Runtime backend abstraction (docker | kubernetes) selected by config; k8s backend shells out to kubectl. Works in-cluster (ServiceAccount+RBAC) or external (kubeconfig, e.g. EC2). Aura itself also deployable to k8s via manifests; local dev cluster for test-website.

User wants Aura to run anywhere (EC2/other cloud or in-cluster) and manage k8s workloads; kubectl mirrors existing subprocess-based docker code.
