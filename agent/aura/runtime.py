"""Where the watched service runs: local processes + a Docker DB (the demo), or a Kubernetes cluster.
Observability and Execution go through this; nothing else knows about docker or kubectl.
AURA_RUNTIME=docker|kubernetes picks one. kubectl uses KUBECONFIG/~/.kube/config outside the cluster
(e.g. Aura on EC2) and the pod's ServiceAccount inside it."""
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


class KubernetesRuntime:
    name = "kubernetes"
    db_label = f"statefulset {config.K8S_DB_STATEFULSET}"

    def __init__(self):
        self.base = ["kubectl", "-n", config.K8S_NAMESPACE]
        if config.K8S_CONTEXT:
            self.base += ["--context", config.K8S_CONTEXT]
        self.deploy = f"deployment/{config.K8S_APP_DEPLOYMENT}"
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
        out = self._kubectl("get", "statefulset", config.K8S_DB_STATEFULSET, "-o", "jsonpath={.status.readyReplicas}")
        return int(out.stdout.strip() or 0) > 0 if out.returncode == 0 else None

    def new_log_lines(self) -> list[str]:
        """Every pod behind the app's selector, since the newest line already seen. --timestamps gives each
        line an RFC3339 prefix to track that cursor; it's stripped so lines look like the local server log."""
        since = ["--timestamps", "--tail=-1", f"--since-time={self.log_since}"]
        out = self._kubectl("logs", "-l", config.K8S_APP_SELECTOR, "--all-containers", *since, "--max-log-requests=20")
        if out.returncode != 0:
            return []
        raw = out.stdout.splitlines()
        # A crashed container's last words (the error that killed it) are only in --previous.
        pods = self._kubectl("get", "pods", "-l", config.K8S_APP_SELECTOR, "-o",
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
        if t == "start_db":
            return [[*self.base, "scale", "statefulset", config.K8S_DB_STATEFULSET, "--replicas=1"],
                    [*self.base, "rollout", "status", f"statefulset/{config.K8S_DB_STATEFULSET}", "--timeout=150s"]]
        return []

    def show(self, cmd: list[str]) -> str:
        return " ".join(cmd)

    def rollback_preview(self, action: dict) -> str:
        out = self._kubectl("rollout", "history", self.deploy)
        return (f"# blamed commit: {action.get('target')}; rolling {self.deploy} back to its previous revision\n"
                + (out.stdout or out.stderr).strip()[-1500:])


def _ts(stamp: str) -> str:
    """kubectl trims trailing zeros (RFC3339Nano); pad the fraction to 9 digits so stamps compare as strings."""
    sec, _, frac = stamp.rstrip("Z").partition(".")
    return f"{sec}.{frac:0<9}Z"


runtime = KubernetesRuntime() if config.RUNTIME == "kubernetes" else DockerRuntime()
