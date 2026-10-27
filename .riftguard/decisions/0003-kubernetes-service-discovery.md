---
id: 3
topic: kubernetes service discovery
choice: runtime.discover() via kubectl: app = the single Deployment whose image isn't a database, selector from its matchLabels, DB = the single StatefulSet with a database image; explicit K8S_* env wins. `aura connect` (Typer, agent/cli/aura.py) shows the result and saves it to agent/.env.
status: active
agent: aura-project-590d8e1c
checkpoint: decision-kubernetes-service-discovery
date: 2026-10-27 11:12:37
---

# kubernetes service discovery: runtime.discover() via kubectl: app = the single Deployment whose image isn't a database, selector from its matchLabels, DB = the single StatefulSet with a database image; explicit K8S_* env wins. `aura connect` (Typer, agent/cli/aura.py) shows the result and saves it to agent/.env.

Point Aura at a namespace without hand-written names; refuse to guess when ambiguous instead of watching the wrong workload.
