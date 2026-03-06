from __future__ import annotations

import fcntl
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .crypto import decrypt_payload, encrypt_payload, load_key

PROJECT_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
SECRET_KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_vault() -> dict[str, Any]:
    return {"version": 1, "projects": {}}


class VaultError(RuntimeError):
    pass


class ProjectNotFoundError(VaultError):
    pass


class SecretNotFoundError(VaultError):
    pass


class ValidationError(VaultError):
    pass


class VaultService:
    def __init__(
        self,
        vault_file: Path,
        key_file: Path,
        lock_file: Path,
        key_storage: str = "file",
        keyring_service: str = "zocket",
        keyring_account: str = "master-key",
    ):
        self.vault_file = vault_file
        self.key_file = key_file
        self.lock_file = lock_file
        self.key_storage = key_storage
        self.keyring_service = keyring_service
        self.keyring_account = keyring_account
        self._cached_key: bytes | None = None

    def _key(self) -> bytes:
        if self._cached_key is None:
            self._cached_key = load_key(
                self.key_file,
                storage=self.key_storage,
                keyring_service=self.keyring_service,
                keyring_account=self.keyring_account,
            )
        return self._cached_key

    @contextmanager
    def _locked(self) -> Iterator[None]:
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_file.open("a+") as lock_fd:
            fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_fd.fileno(), fcntl.LOCK_UN)

    def _read_unlocked(self) -> dict[str, Any]:
        if not self.vault_file.exists():
            return empty_vault()
        ciphertext = self.vault_file.read_bytes()
        if not ciphertext:
            return empty_vault()
        payload = decrypt_payload(ciphertext, self._key())
        if "projects" not in payload or not isinstance(payload["projects"], dict):
            raise VaultError("Vault payload is malformed: missing `projects` map.")
        return payload

    def _write_unlocked(self, payload: dict[str, Any]) -> None:
        self.vault_file.parent.mkdir(parents=True, exist_ok=True)
        ciphertext = encrypt_payload(payload, self._key())
        tmp = self.vault_file.with_suffix(self.vault_file.suffix + ".tmp")
        tmp.write_bytes(ciphertext)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.vault_file)

    def ensure_initialized(self) -> None:
        with self._locked():
            if self.vault_file.exists():
                return
            self._write_unlocked(empty_vault())

    def _validate_project_name(self, project: str) -> None:
        if not project or not PROJECT_RE.match(project):
            raise ValidationError(
                "Invalid project name. Use only [a-zA-Z0-9._-] characters."
            )

    def _validate_secret_key(self, key: str) -> None:
        if not key or not SECRET_KEY_RE.match(key):
            raise ValidationError(
                "Invalid secret key. Use UPPERCASE env-like keys, e.g. SSH_PASSWORD."
            )

    def _normalize_folder_path(
        self,
        folder_path: str | None,
        require_exists: bool,
    ) -> str | None:
        if folder_path is None:
            return None
        raw = folder_path.strip()
        if not raw:
            return None
        path = Path(raw).expanduser()
        try:
            resolved = path.resolve(strict=require_exists)
        except FileNotFoundError as exc:
            raise ValidationError(f"Project folder not found: {path}") from exc
        except OSError as exc:
            raise ValidationError(f"Invalid project folder path: {path}") from exc
        if require_exists and not resolved.is_dir():
            raise ValidationError(f"Project folder is not a directory: {resolved}")
        return str(resolved)

    def create_project(
        self,
        project: str,
        description: str = "",
        folder_path: str | None = None,
    ) -> None:
        self._validate_project_name(project)
        normalized_folder = self._normalize_folder_path(
            folder_path, require_exists=True
        )
        with self._locked():
            payload = self._read_unlocked()
            projects = payload["projects"]
            if project in projects:
                return
            now = utc_now_iso()
            projects[project] = {
                "description": description,
                "created_at": now,
                "updated_at": now,
                "secrets": {},
            }
            if normalized_folder:
                projects[project]["folder_path"] = normalized_folder
            self._write_unlocked(payload)

    def list_projects(self) -> list[dict[str, Any]]:
        with self._locked():
            payload = self._read_unlocked()
        items: list[dict[str, Any]] = []
        for project, info in payload["projects"].items():
            secrets = info.get("secrets", {})
            items.append(
                {
                    "project": project,
                    "description": info.get("description", ""),
                    "folder_path": info.get("folder_path"),
                    "secret_count": len(secrets),
                    "updated_at": info.get("updated_at"),
                }
            )
        items.sort(key=lambda x: x["project"])
        return items

    def _get_project(self, payload: dict[str, Any], project: str) -> dict[str, Any]:
        self._validate_project_name(project)
        info = payload["projects"].get(project)
        if info is None:
            raise ProjectNotFoundError(f"Project not found: {project}")
        return info

    def list_project_secrets(
        self, project: str, include_values: bool = False
    ) -> list[dict[str, Any]]:
        with self._locked():
            payload = self._read_unlocked()
        info = self._get_project(payload, project)
        result: list[dict[str, Any]] = []
        for key, item in info.get("secrets", {}).items():
            row: dict[str, Any] = {
                "key": key,
                "description": item.get("description", ""),
                "updated_at": item.get("updated_at"),
                "has_value": bool(item.get("value")),
            }
            if include_values:
                row["value"] = item.get("value", "")
            result.append(row)
        result.sort(key=lambda x: x["key"])
        return result

    def upsert_secret(
        self, project: str, key: str, value: str, description: str = ""
    ) -> None:
        self._validate_project_name(project)
        self._validate_secret_key(key)
        if value is None:
            raise ValidationError("Secret value cannot be null.")

        with self._locked():
            payload = self._read_unlocked()
            projects = payload["projects"]
            if project not in projects:
                now = utc_now_iso()
                projects[project] = {
                    "description": "",
                    "created_at": now,
                    "updated_at": now,
                    "secrets": {},
                }
            project_info = projects[project]
            now = utc_now_iso()
            project_info["secrets"][key] = {
                "value": value,
                "description": description,
                "updated_at": now,
            }
            project_info["updated_at"] = now
            self._write_unlocked(payload)

    def delete_secret(self, project: str, key: str) -> None:
        self._validate_project_name(project)
        self._validate_secret_key(key)
        with self._locked():
            payload = self._read_unlocked()
            info = self._get_project(payload, project)
            if key not in info.get("secrets", {}):
                raise SecretNotFoundError(f"Secret {key} not found in project {project}")
            del info["secrets"][key]
            info["updated_at"] = utc_now_iso()
            self._write_unlocked(payload)

    def delete_project(self, project: str) -> None:
        self._validate_project_name(project)
        with self._locked():
            payload = self._read_unlocked()
            if project not in payload["projects"]:
                raise ProjectNotFoundError(f"Project not found: {project}")
            del payload["projects"][project]
            self._write_unlocked(payload)

    def set_project_folder(self, project: str, folder_path: str | None) -> None:
        self._validate_project_name(project)
        normalized_folder = self._normalize_folder_path(
            folder_path, require_exists=True
        )
        with self._locked():
            payload = self._read_unlocked()
            info = self._get_project(payload, project)
            if normalized_folder:
                info["folder_path"] = normalized_folder
            else:
                info.pop("folder_path", None)
            info["updated_at"] = utc_now_iso()
            self._write_unlocked(payload)

    def find_project_by_path(self, folder_path: str) -> dict[str, Any] | None:
        normalized_folder = self._normalize_folder_path(
            folder_path, require_exists=False
        )
        if not normalized_folder:
            return None
        target = Path(normalized_folder)
        best_name: str | None = None
        best_info: dict[str, Any] | None = None
        best_depth = -1

        with self._locked():
            payload = self._read_unlocked()
            for name, info in payload["projects"].items():
                raw_folder = info.get("folder_path")
                if not raw_folder:
                    continue
                try:
                    candidate = Path(str(raw_folder)).expanduser().resolve(strict=False)
                except OSError:
                    continue
                if target != candidate and not target.is_relative_to(candidate):
                    continue
                depth = len(candidate.parts)
                if depth > best_depth:
                    best_name = name
                    best_info = info
                    best_depth = depth

        if best_name is None or best_info is None:
            return None

        return {
            "project": best_name,
            "description": best_info.get("description", ""),
            "folder_path": best_info.get("folder_path"),
            "secret_count": len(best_info.get("secrets", {})),
            "updated_at": best_info.get("updated_at"),
        }

    def get_project_env(self, project: str) -> dict[str, str]:
        with self._locked():
            payload = self._read_unlocked()
        info = self._get_project(payload, project)
        env: dict[str, str] = {}
        for key, item in info.get("secrets", {}).items():
            env[key] = str(item.get("value", ""))
        return env
