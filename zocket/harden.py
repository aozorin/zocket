from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if check and cp.returncode != 0:
        msg = cp.stderr.strip() or cp.stdout.strip() or f"command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    return cp


def _service_text(
    description: str,
    user: str,
    group: str,
    zocket_home: Path,
    exec_start: str,
) -> str:
    return (
        "[Unit]\n"
        f"Description={description}\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"User={user}\n"
        f"Group={group}\n"
        f"Environment=ZOCKET_HOME={zocket_home}\n"
        f"ExecStart={exec_start}\n"
        "Restart=on-failure\n"
        "RestartSec=2\n"
        "NoNewPrivileges=true\n"
        "PrivateTmp=true\n"
        "ProtectSystem=strict\n"
        "ProtectHome=read-only\n"
        "ProtectKernelTunables=true\n"
        "ProtectControlGroups=true\n"
        "LockPersonality=true\n"
        "MemoryDenyWriteExecute=true\n"
        f"ReadWritePaths={zocket_home}\n\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )


def install_linux_system_services(
    service_user: str = "zocketd",
    zocket_home: Path = Path("/var/lib/zocket"),
    web_port: int = 18001,
    mcp_host: str = "127.0.0.1",
    mcp_port: int = 18002,
    mcp_mode: str = "metadata",
    dry_run: bool = False,
) -> dict[str, object]:
    if not sys.platform.startswith("linux"):
        return {"ok": False, "message": "linux-only command"}
    if os.geteuid() != 0 and not dry_run:
        return {"ok": False, "message": "run this command as root"}

    python_exe = shutil.which("python3") or "/usr/bin/python3"
    web_exec = f"{python_exe} -m zocket web --host 127.0.0.1 --port {web_port}"
    mcp_exec = (
        f"{python_exe} -m zocket mcp --transport streamable-http "
        f"--mode {mcp_mode} --host {mcp_host} --port {mcp_port}"
    )
    web_service = _service_text(
        "Zocket Web Panel (system)",
        service_user,
        service_user,
        zocket_home,
        web_exec,
    )
    mcp_service = _service_text(
        "Zocket MCP HTTP (system)",
        service_user,
        service_user,
        zocket_home,
        mcp_exec,
    )
    result: dict[str, object] = {
        "ok": True,
        "dry_run": dry_run,
        "service_user": service_user,
        "zocket_home": str(zocket_home),
        "preview": {
            "/etc/systemd/system/zocket-web.service": web_service,
            "/etc/systemd/system/zocket-mcp-http.service": mcp_service,
        },
    }
    if dry_run:
        return result

    _run(
        [
            "id",
            service_user,
        ],
        check=False,
    )
    exists = _run(["id", service_user], check=False).returncode == 0
    if not exists:
        _run(
            [
                "useradd",
                "--system",
                "--create-home",
                "--home-dir",
                str(zocket_home),
                "--shell",
                "/usr/sbin/nologin",
                service_user,
            ]
        )
    zocket_home.mkdir(parents=True, exist_ok=True)
    os.chmod(zocket_home, 0o700)
    _run(["chown", "-R", f"{service_user}:{service_user}", str(zocket_home)])

    web_path = Path("/etc/systemd/system/zocket-web.service")
    mcp_path = Path("/etc/systemd/system/zocket-mcp-http.service")
    web_path.write_text(web_service, encoding="utf-8")
    mcp_path.write_text(mcp_service, encoding="utf-8")

    _run(["systemctl", "daemon-reload"])
    _run(["systemctl", "enable", "--now", "zocket-web.service"])
    _run(["systemctl", "enable", "--now", "zocket-mcp-http.service"])
    result["status"] = {
        "web": _run(["systemctl", "is-active", "zocket-web.service"], check=False).stdout.strip(),
        "mcp": _run(["systemctl", "is-active", "zocket-mcp-http.service"], check=False).stdout.strip(),
    }
    return result
