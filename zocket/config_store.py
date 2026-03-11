from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "language": "en",
    "key_storage": "file",
    "keyring_service": "zocket",
    "keyring_account": "master-key",
    "web_auth_enabled": True,
    "web_password_hash": "",
    "web_password_salt": "",
    "web_password_iterations": 390000,
    "theme": "standard",
    "theme_variant": "dark",
    "session_secret": "",
    "audit_enabled": True,
    "exec_allowlist": [],
    "exec_return_output": True,
    "exec_max_output_chars": 4000,
    "exec_allow_full_output": False,
    "exec_substitute_env": True,
}


def _deep_copy_default() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_CONFIG))


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return _deep_copy_default()
        raw = self.path.read_text(encoding="utf-8")
        if not raw.strip():
            return _deep_copy_default()
        data = json.loads(raw)
        if not isinstance(data, dict):
            return _deep_copy_default()
        merged = _deep_copy_default()
        merged.update(data)
        return merged

    def save(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def ensure_exists(self) -> dict[str, Any]:
        cfg = self.load()
        if not cfg.get("session_secret"):
            cfg["session_secret"] = secrets.token_urlsafe(32)
            self.save(cfg)
        elif not self.path.exists():
            self.save(cfg)
        return cfg
