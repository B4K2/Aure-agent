"""`aura` command line. `aura connect` finds what to watch in a Kubernetes namespace and saves it to agent/.env."""
import os
import re

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(no_args_is_help=True)
console = Console()


@app.callback()
def main():
    """Aura agentic SRE."""


@app.command()
def connect(namespace: str = typer.Option(None, "--namespace", "-n", help="namespace of the watched service"),
            context: str = typer.Option(None, "--context", help="kubeconfig context (default: current)"),
            write: bool = typer.Option(True, help="save the result to agent/.env")):
    """Detect the app Deployment, its pod selector and the database StatefulSet in a namespace."""
    if namespace:
        os.environ["K8S_NAMESPACE"] = namespace
    if context is not None:
        os.environ["K8S_CONTEXT"] = context
    os.environ["AURA_RUNTIME"] = "docker"  # importing runtime must not discover with the old settings
    from aura import config, runtime

    config.K8S_NAMESPACE = os.getenv("K8S_NAMESPACE", config.K8S_NAMESPACE)
    config.K8S_CONTEXT = os.getenv("K8S_CONTEXT", config.K8S_CONTEXT)
    try:
        found = runtime.discover()
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)

    table = Table(title=f"namespace {config.K8S_NAMESPACE}")
    for col in ("kind", "name", "images", "role"):
        table.add_column(col)
    for kind, rows, pick in (("deployment", found["deployments"], found["deployment"]),
                             ("statefulset", found["statefulsets"], found["db"])):
        for name, images in rows.items():
            role = ("app" if kind == "deployment" else "database") if name == pick else ""
            table.add_row(kind, name, ", ".join(images), f"[green]{role}[/green]")
    console.print(table)
    console.print(f"selector: [bold]{found['selector']}[/bold]")
    if not found["db"]:
        console.print("[yellow]no database StatefulSet detected; DB checks and start_db are off "
                      "(set K8S_DB_STATEFULSET to enable)[/yellow]")

    settings = {"AURA_RUNTIME": "kubernetes", "K8S_NAMESPACE": config.K8S_NAMESPACE,
                "K8S_CONTEXT": config.K8S_CONTEXT, "K8S_APP_DEPLOYMENT": found["deployment"],
                "K8S_APP_SELECTOR": found["selector"], "K8S_DB_STATEFULSET": found["db"]}
    if write:
        env = config.AGENT_DIR / ".env"
        text = env.read_text() if env.exists() else ""
        for key, value in settings.items():
            line = f"{key}={value}"
            text, n = re.subn(rf"^{key}=.*$", line, text, flags=re.M)
            if not n:
                text += ("" if not text or text.endswith("\n") else "\n") + line + "\n"
        env.write_text(text)
        console.print(f"saved to {env}")


if __name__ == "__main__":
    app()
