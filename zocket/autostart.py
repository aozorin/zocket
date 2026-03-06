from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Literal

AutostartTarget = Literal["web", "mcp", "both"]
MCPMode = Literal["metadata", "admin"]

WEB_SERVICE = "zocket-web.service"
MCP_HTTP_SERVICE = "zocket-mcp-http.service"


def current_platform() -> str:
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform in {"win32", "cygwin"}:
        return "windows"
    return "other"


def _service_targets(target: AutostartTarget) -> list[str]:
    if target == "web":
        return [WEB_SERVICE]
    if target == "mcp":
        return [MCP_HTTP_SERVICE]
    return [WEB_SERVICE, MCP_HTTP_SERVICE]


def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if check and cp.returncode != 0:
        msg = cp.stderr.strip() or cp.stdout.strip() or f"command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    return cp


def _safe_exec_start(cmd: list[str]) -> str:
    # systemd supports shell-like quoting in unit files.
    escaped = []
    for part in cmd:
        if " " in part or '"' in part or "'" in part:
            escaped.append('"' + part.replace('"', '\\"') + '"')
        else:
            escaped.append(part)
    return " ".join(escaped)


def _linux_unit_web(zocket_home: Path, exec_cmd: list[str], host: str, port: int) -> str:
    exec_start = _safe_exec_start(exec_cmd + ["web", "--host", host, "--port", str(port)])
    return (
        "[Unit]\n"
        "Description=Zocket Web Panel\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"Environment=ZOCKET_HOME={zocket_home}\n"
        f"ExecStart={exec_start}\n"
        "Restart=on-failure\n"
        "RestartSec=2\n"
        "NoNewPrivileges=true\n"
        "PrivateTmp=true\n"
        "ProtectSystem=full\n"
        "ProtectHome=read-only\n"
        f"ReadWritePaths={zocket_home}\n"
        "LockPersonality=true\n"
        "MemoryDenyWriteExecute=true\n\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def _linux_unit_mcp(
    zocket_home: Path,
    exec_cmd: list[str],
    mcp_mode: MCPMode,
    mcp_host: str,
    mcp_port: int,
) -> str:
    exec_start = _safe_exec_start(
        exec_cmd
        + [
            "mcp",
            "--transport",
            "streamable-http",
            "--mode",
            mcp_mode,
            "--host",
            mcp_host,
            "--port",
            str(mcp_port),
        ]
    )
    return (
        "[Unit]\n"
        "Description=Zocket MCP (Streamable HTTP)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"Environment=ZOCKET_HOME={zocket_home}\n"
        f"ExecStart={exec_start}\n"
        "Restart=on-failure\n"
        "RestartSec=2\n"
        "NoNewPrivileges=true\n"
        "PrivateTmp=true\n"
        "ProtectSystem=full\n"
        "ProtectHome=read-only\n"
        f"ReadWritePaths={zocket_home}\n"
        "LockPersonality=true\n"
        "MemoryDenyWriteExecute=true\n\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def _linux_user_units_dir() -> Path:
    return Path.home() / ".config" / "systemd" / "user"


def _status_for_service(name: str) -> dict[str, str]:
    enabled = _run(["systemctl", "--user", "is-enabled", name], check=False)
    active = _run(["systemctl", "--user", "is-active", name], check=False)
    return {
        "service": name,
        "enabled": (enabled.stdout or enabled.stderr).strip(),
        "active": (active.stdout or active.stderr).strip(),
    }


def _linger_note() -> str:
    user = os.environ.get("USER", "")
    if not user:
        return "Could not determine USER for loginctl linger check."
    cp = _run(
        ["loginctl", "show-user", user, "-p", "Linger"],
        check=False,
    )
    output = (cp.stdout or cp.stderr).strip()
    if "Linger=yes" in output:
        return "Linger is enabled (services can run without active GUI/login session)."
    if "Linger=no" in output:
        return (
            "Linger is disabled. To keep user services alive after logout run: "
            f"sudo loginctl enable-linger {user}"
        )
    return "Could not verify linger status."


def install_autostart(
    target: AutostartTarget,
    web_host: str,
    web_port: int,
    mcp_host: str,
    mcp_port: int,
    mcp_mode: MCPMode,
    zocket_home: Path,
    dry_run: bool = False,
) -> dict[str, object]:
    platform = current_platform()
    if platform != "linux":
        return {
            "ok": False,
            "platform": platform,
            "message": (
                "Automatic install is implemented for Linux/systemd first. "
                "Use generated guidance in README for macOS/Windows."
            ),
        }

    exec_bin = shutil.which("zocket")
    exec_cmd = [exec_bin] if exec_bin else [sys.executable, "-m", "zocket"]

    units_dir = _linux_user_units_dir()
    service_files: list[Path] = []
    unit_preview: dict[str, str] = {}
    services = _service_targets(target)
    for service_name in services:
        if service_name == WEB_SERVICE:
            content = _linux_unit_web(
                zocket_home=zocket_home,
                exec_cmd=exec_cmd,
                host=web_host,
                port=web_port,
            )
        else:
            content = _linux_unit_mcp(
                zocket_home=zocket_home,
                exec_cmd=exec_cmd,
                mcp_mode=mcp_mode,
                mcp_host=mcp_host,
                mcp_port=mcp_port,
            )
        service_path = units_dir / service_name
        service_files.append(service_path)
        unit_preview[service_name] = content

    result: dict[str, object] = {
        "ok": True,
        "platform": platform,
        "units_dir": str(units_dir),
        "service_files": [str(p) for p in service_files],
        "unit_preview": unit_preview,
        "dry_run": dry_run,
    }
    if dry_run:
        return result

    units_dir.mkdir(parents=True, exist_ok=True)
    zocket_home.mkdir(parents=True, exist_ok=True)
    os.chmod(zocket_home, 0o700)
    for service_path in service_files:
        content = unit_preview[service_path.name]
        service_path.write_text(content, encoding="utf-8")
        os.chmod(service_path, 0o644)

    _run(["systemctl", "--user", "daemon-reload"])
    for service_name in services:
        _run(["systemctl", "--user", "enable", "--now", service_name])

    result["services"] = [_status_for_service(s) for s in services]
    result["linger_note"] = _linger_note()
    return result


def remove_autostart(target: AutostartTarget) -> dict[str, object]:
    platform = current_platform()
    if platform != "linux":
        return {
            "ok": False,
            "platform": platform,
            "message": "Automatic removal is implemented for Linux/systemd first.",
        }

    units_dir = _linux_user_units_dir()
    services = _service_targets(target)
    removed_files: list[str] = []

    for service_name in services:
        _run(["systemctl", "--user", "disable", "--now", service_name], check=False)
        path = units_dir / service_name
        if path.exists():
            path.unlink()
            removed_files.append(str(path))

    _run(["systemctl", "--user", "daemon-reload"], check=False)
    return {
        "ok": True,
        "platform": platform,
        "removed_files": removed_files,
        "services": [_status_for_service(s) for s in services],
    }


def status_autostart(target: AutostartTarget) -> dict[str, object]:
    platform = current_platform()
    services = _service_targets(target)
    if platform != "linux":
        return {
            "ok": False,
            "platform": platform,
            "services": [{"service": s, "enabled": "n/a", "active": "n/a"} for s in services],
            "message": "Status command is implemented for Linux/systemd first.",
        }

    units_dir = _linux_user_units_dir()
    files = [str(units_dir / s) for s in services]
    return {
        "ok": True,
        "platform": platform,
        "units_dir": str(units_dir),
        "service_files": files,
        "services": [_status_for_service(s) for s in services],
        "linger_note": _linger_note(),
    }
