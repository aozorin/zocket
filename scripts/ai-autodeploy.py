#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print(f"[ai-autodeploy] $ {' '.join(cmd)}")
    cp = subprocess.run(cmd, check=False)
    if cp.returncode != 0:
        raise RuntimeError(f"Command failed with code {cp.returncode}: {' '.join(cmd)}")


def ensure_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required tool not found: {name}")
    return path


def clone_or_update(repo_url: str, repo_ref: str, checkout_dir: Path) -> None:
    git = ensure_tool("git")
    if (checkout_dir / ".git").exists():
        run([git, "-C", str(checkout_dir), "fetch", "--all", "--tags"])
        run([git, "-C", str(checkout_dir), "checkout", repo_ref])
        run([git, "-C", str(checkout_dir), "pull", "--ff-only"])
        return
    checkout_dir.parent.mkdir(parents=True, exist_ok=True)
    run([git, "clone", "--depth", "1", "--branch", repo_ref, repo_url, str(checkout_dir)])


def default_checkout_dir() -> Path:
    if sys.platform.startswith("win"):
        root = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
        return root / "zocket" / "bootstrap-src"
    return Path.home() / ".local" / "share" / "zocket" / "bootstrap-src"


def main() -> int:
    ap = argparse.ArgumentParser(description="One-file zocket bootstrap for AI agents.")
    ap.add_argument("--repo-url", default="https://github.com/your-org/zocket.git")
    ap.add_argument("--repo-ref", default="main")
    ap.add_argument("--checkout-dir", default=str(default_checkout_dir()))
    ap.add_argument("--lang", default="en", choices=["en", "ru"])
    ap.add_argument("--web-port", default="18001")
    ap.add_argument("--mcp-port", default="18002")
    ap.add_argument("--mcp-mode", default="metadata", choices=["metadata", "admin"])
    ap.add_argument("--autostart", default="user", choices=["user", "system", "none"])
    ap.add_argument("--service-user", default="zocketd")
    ap.add_argument("--zocket-home", default=str(Path.home() / ".zocket"))
    args = ap.parse_args()

    checkout_dir = Path(args.checkout_dir).expanduser().resolve()
    clone_or_update(args.repo_url, args.repo_ref, checkout_dir)

    system = platform.system().lower()
    if system == "windows":
        ps = shutil.which("pwsh") or shutil.which("powershell")
        if not ps:
            raise RuntimeError("PowerShell not found")
        installer = checkout_dir / "scripts" / "install-zocket.ps1"
        cmd = [
            ps,
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(installer),
            "-Source",
            "Local",
            "-InstallRoot",
            str(Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "zocket"),
            "-ZocketHome",
            args.zocket_home,
            "-Lang",
            args.lang,
            "-WebPort",
            args.web_port,
            "-McpPort",
            args.mcp_port,
            "-McpMode",
            args.mcp_mode,
        ]
        if args.autostart != "none":
            cmd.append("-EnableAutostart")
        run(cmd)
    else:
        bash = ensure_tool("bash")
        installer = checkout_dir / "scripts" / "install-zocket.sh"
        run(
            [
                bash,
                str(installer),
                "--source",
                "local",
                "--install-root",
                str(checkout_dir.parent),
                "--zocket-home",
                args.zocket_home,
                "--lang",
                args.lang,
                "--web-port",
                args.web_port,
                "--mcp-port",
                args.mcp_port,
                "--mcp-mode",
                args.mcp_mode,
                "--autostart",
                args.autostart,
                "--service-user",
                args.service_user,
            ]
        )

    print("[ai-autodeploy] Completed successfully.")
    print("[ai-autodeploy] Web: http://127.0.0.1:18001")
    print("[ai-autodeploy] MCP: http://127.0.0.1:18002/mcp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
