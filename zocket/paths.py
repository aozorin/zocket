from __future__ import annotations

import os
from pathlib import Path


def zocket_home() -> Path:
    default = Path.home() / ".zocket"
    return Path(os.environ.get("ZOCKET_HOME", str(default))).expanduser()


def vault_path() -> Path:
    default = zocket_home() / "vault.enc"
    return Path(os.environ.get("ZOCKET_VAULT_PATH", str(default))).expanduser()


def key_path() -> Path:
    default = zocket_home() / "master.key"
    return Path(os.environ.get("ZOCKET_KEY_PATH", str(default))).expanduser()


def lock_path() -> Path:
    default = zocket_home() / "vault.lock"
    return Path(os.environ.get("ZOCKET_LOCK_PATH", str(default))).expanduser()


def config_path() -> Path:
    default = zocket_home() / "config.json"
    return Path(os.environ.get("ZOCKET_CONFIG_PATH", str(default))).expanduser()


def audit_log_path() -> Path:
    default = zocket_home() / "audit.log"
    return Path(os.environ.get("ZOCKET_AUDIT_LOG_PATH", str(default))).expanduser()


def backups_dir() -> Path:
    default = zocket_home() / "backups"
    return Path(os.environ.get("ZOCKET_BACKUPS_DIR", str(default))).expanduser()


def ensure_dirs() -> None:
    home = zocket_home()
    home.mkdir(parents=True, exist_ok=True)
    vault_path().parent.mkdir(parents=True, exist_ok=True)
    key_path().parent.mkdir(parents=True, exist_ok=True)
    lock_path().parent.mkdir(parents=True, exist_ok=True)
    config_path().parent.mkdir(parents=True, exist_ok=True)
    audit_log_path().parent.mkdir(parents=True, exist_ok=True)
    backups_dir().mkdir(parents=True, exist_ok=True)
