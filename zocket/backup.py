from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path


def backup_name(prefix: str = "vault") -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}-{ts}.enc"


def create_backup(vault_file: Path, backup_dir: Path) -> Path:
    if not vault_file.exists():
        raise FileNotFoundError(f"Vault file not found: {vault_file}")
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / backup_name()
    shutil.copy2(vault_file, target)
    return target


def restore_backup(vault_file: Path, backup_file: Path) -> Path:
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_file}")
    vault_file.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup_file, vault_file)
    return vault_file


def list_backups(backup_dir: Path) -> list[Path]:
    if not backup_dir.exists():
        return []
    return sorted(backup_dir.glob("*.enc"), reverse=True)
