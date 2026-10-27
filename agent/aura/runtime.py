"""Where the watched service runs: local processes + a Docker DB (the demo), or a Kubernetes cluster.
Observability and Execution go through this; nothing else knows about docker or kubectl.
AURA_RUNTIME=docker|kubernetes picks one. kubectl uses KUBECONFIG/~/.kube/config outside the cluster
(e.g. Aura on EC2) and the pod's ServiceAccount inside it."""
import json
import re
import subprocess
from datetime import datetime, timezone

from . import config

RESTART_JS = (f"import('{config.PROBLEM_DIR / 'lib' / 'server.js'}')"
              ".then(m => m.restart()).then(ok => process.exit(ok ? 0 : 1))")


class DockerRuntime:
    name = "docker"
    db_label = f"container {config.DB_CONTAINER}"

    def __init__(self):
        self.log_pos = config.SERVER_LOG.stat().st_size if config.SERVER_LOG.exists() else 0

    def db_running(self) -> bool | None:
        out = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", config.DB_CONTAINER],
                             capture_output=True, text=True)
        return out.stdout.strip() == "true" if out.returncode == 0 else None

    def new_log_lines(self) -> list[str]:
        if not config.SERVER_LOG.exists():
            return []
        if config.SERVER_LOG.stat().st_size < self.log_pos:
            self.log_pos = 0
        with config.SERVER_LOG.open("r", errors="replace") as f:
            f.seek(self.log_pos)
            chunk = f.read(2_000_000)
            self.log_pos = f.tell()
        return chunk.splitlines()

    def commands(self, action: dict) -> list[list[str]]:
        t, target = action["type"], action.get("target", "")
        restart = ["node", "-e", RESTART_JS]
        if t == "rollback":
            return [["git", "-C", str(config.WEBSITE_DIR), "revert", "--no-edit", target], restart]
        if t == "restart_service":
            return [restart]
        if t == "start_db":
            return [["docker", "start", config.DB_CONTAINER]]
        return []

    def show(self, cmd: list[str]) -> str:
        return " ".join(c if c != RESTART_JS else "<restart website via problem/lib/server.js>" for c in cmd)

    def rollback_preview(self, action: dict) -> str:
        return "# commit to revert:\n" + subprocess.run(
            ["git", "-C", str(config.WEBSITE_DIR), "show", "--stat", "--format=%h %s (%an, %cr)", action["target"]],
            capture_output=True, text=True).stdout.strip()


DB_IMAGE = re.compile(r"postgres|mysql|mariadb|mongo|redis|cockroach|cassandra", re.I)


def _images(workload: dict) -> list[str]:
    return [c.get("image", "") for c in workload["spec"]["template"]["spec"].get("containers", [])]


def kubectl_base() -> list[str]:
    base = ["kubectl", "-n", config.K8S_NAMESPACE]
    return base + ["--context", config.K8S_CONTEXT] if config.K8S_CONTEXT else base


def discover(base: list[str] | None = None) -> dict:
    """Find what to watch in the namespace: the app Deployment (the one that isn't a database), its pod
    selector, and the database StatefulSet (by image). Explicit K8S_* settings always win.
    Returns {"deployment", "selector", "db", "deployments", "statefulsets"}; raises RuntimeError when the
    namespace can't be read or the app is ambiguous."""
    base = base or kubectl_base()

    def items(kind: str) -> list[dict]:
        try:
            out = subprocess.run([*base, "get", kind, "-o", "json"], capture_output=True, text=True, timeout=15)
        except (subprocess.TimeoutExpired, OSError) as e:
            raise RuntimeError(f"kubectl get {kind}: {e}") from e
        if out.returncode != 0:
            raise RuntimeError(f"kubectl get {kind}: {(out.stderr.strip().splitlines() or ['failed'])[-1]}")
        return json.loads(out.stdout)["items"]

    deps, sets = items("deployments"), items("statefulsets")
    names = {d["metadata"]["name"]: d for d in deps}
    app = config.K8S_APP_DEPLOYMENT
    if not app:
        apps = [n for n, d in names.items() if not any(DB_IMAGE.search(i) for i in _images(d))]
        if len(apps) != 1:
            raise RuntimeError(f"can't pick the app Deployment in namespace {config.K8S_NAMESPACE!r} "
                               f"(candidates: {', '.join(apps) or 'none'}); set K8S_APP_DEPLOYMENT")
        app = apps[0]
    selector = config.K8S_APP_SELECTOR
    if not selector and app in names:
        labels = names[app]["spec"]["selector"].get("matchLabels", {})
        selector = ",".join(f"{k}={v}" for k, v in labels.items())
    if not selector:
        raise RuntimeError(f"no pod selector for deployment {app!r}; set K8S_APP_SELECTOR")
    db = config.K8S_DB_STATEFULSET
    if not db:
        dbs = [s["metadata"]["name"] for s in sets if any(DB_IMAGE.search(i) for i in _images(s))]
        db = dbs[0] if len(dbs) == 1 else ""  # none or several: don't guess, DB checks stay off
    return {"deployment": app, "selector": selector, "db": db,
            "deployments": {n: _images(d) for n, d in names.items()},
            "statefulsets": {s["metadata"]["name"]: _images(s) for s in sets}}


class KubernetesRuntime:
    name = "kubernetes"

    def __init__(self):
        self.base = kubectl_base()
        found = discover(self.base)
        self.app, self.selector, self.db = found["deployment"], found["selector"], found["db"]
        self.db_label = f"statefulset {self.db}"
        self.deploy = f"deployment/{self.app}"
        self.restarts: dict[str, int] = {}  # pod -> container restarts already seen
        self.log_since = _ts(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"))

    def _kubectl(self, *args: str, timeout: float = 10) -> subprocess.CompletedProcess:
        """Never raises: an unreachable cluster or missing kubectl is a failed result, like a nonzero exit."""
        cmd = [*self.base, *args]
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except (subprocess.TimeoutExpired, OSError) as e:
            return subprocess.CompletedProcess(cmd, -1, "", f"{type(e).__name__}: {e}")

    def db_running(self) -> bool | None:
        if not self.db:
            return None
        out = self._kubectl("get", "statefulset", self.db, "-o", "jsonpath={.status.readyReplicas}")
        return int(out.stdout.strip() or 0) > 0 if out.returncode == 0 else None

    def new_log_lines(self) -> list[str]:
        """Every pod behind the app's selector, since the newest line already seen. --timestamps gives each
        line an RFC3339 prefix to track that cursor; it's stripped so lines look like the local server log."""
        since = ["--timestamps", "--tail=-1", f"--since-time={self.log_since}"]
        out = self._kubectl("logs", "-l", self.selector, "--all-containers", *since, "--max-log-requests=20")
        if out.returncode != 0:
            return []
        raw = out.stdout.splitlines()
        # A crashed container's last words (the error that killed it) are only in --previous.
        pods = self._kubectl("get", "pods", "-l", self.selector, "-o",
                             'jsonpath={range .items[*]}{.metadata.name} {.status.containerStatuses[0].restartCount}{"\\n"}{end}')
        for name, _, count in (l.partition(" ") for l in pods.stdout.splitlines()):
            if count.isdigit() and int(count) > self.restarts.get(name, 0):
                self.restarts[name] = int(count)
                raw += self._kubectl("logs", name, "--previous", *since).stdout.splitlines()
        lines = []
        for line in raw:
            ts, _, text = line.partition(" ")
            ts = _ts(ts)
            if ts > self.log_since:  # --since-time is inclusive and only second-precise
                lines.append((ts, text))
        if lines:
            self.log_since = max(ts for ts, _ in lines)
        return [text for _, text in sorted(lines)]

    def commands(self, action: dict) -> list[list[str]]:
        t = action["type"]
        status = [*self.base, "rollout", "status", self.deploy, "--timeout=150s"]
        if t == "rollback":  # back to the previous ReplicaSet; the commit hash is what the reasoner blamed
            return [[*self.base, "rollout", "undo", self.deploy], status]
        if t == "restart_service":
            return [[*self.base, "rollout", "restart", self.deploy], status]
        if t == "start_db" and self.db:
            return [[*self.base, "scale", "statefulset", self.db, "--replicas=1"],
                    [*self.base, "rollout", "status", f"statefulset/{self.db}", "--timeout=150s"]]
        return []

    def show(self, cmd: list[str]) -> str:
        return " ".join(cmd)

    def deploy_history(self, n: int) -> list[dict]:
        """Deploys as the cluster saw them, for an agent with no checkout of the site's repo: one per
        ReplicaSet of the Deployment, newest revision first. change-cause is "<commit> <message>"."""
        out = self._kubectl("get", "replicasets", "-l", self.selector, "-o", "json")
        if out.returncode != 0:
            return []
        rows = []
        for rs in json.loads(out.stdout)["items"]:
            meta = rs["metadata"]
            if not any(o.get("name") == self.app for o in meta.get("ownerReferences", [])):
                continue
            ann = meta.get("annotations", {})
            commit, _, msg = ann.get("kubernetes.io/change-cause", "").partition(" ")
            image = rs["spec"]["template"]["spec"]["containers"][0]["image"]
            rows.append((int(ann.get("deployment.kubernetes.io/revision", 0)),
                         {"hash": commit or image.rpartition(":")[2], "timestamp": meta["creationTimestamp"].replace("Z", "+00:00"),
                          "author": "", "message": msg or f"image {image}", "files": [], "diff_summary": f"image {image}"}))
        return [r for _, r in sorted(rows, key=lambda r: -r[0])[:n]]

    def rollback_preview(self, action: dict) -> str:
        out = self._kubectl("rollout", "history", self.deploy)
        return (f"# blamed commit: {action.get('target')}; rolling {self.deploy} back to its previous revision\n"
                + (out.stdout or out.stderr).strip()[-1500:])


def _ts(stamp: str) -> str:
    """kubectl trims trailing zeros (RFC3339Nano); pad the fraction to 9 digits so stamps compare as strings."""
    sec, _, frac = stamp.rstrip("Z").partition(".")
    return f"{sec}.{frac:0<9}Z"


runtime = KubernetesRuntime() if config.RUNTIME == "kubernetes" else DockerRuntime()
