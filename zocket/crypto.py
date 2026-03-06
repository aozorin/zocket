from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

KeyStorage = str


class KeyNotFoundError(FileNotFoundError):
    pass


class DecryptionError(RuntimeError):
    pass


def _import_keyring():
    try:
        import keyring  # type: ignore

        return keyring
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "Keyring backend is unavailable. Install `keyring` package and OS backend."
        ) from exc


def _store_key_keyring(service: str, account: str, key: bytes, force: bool) -> None:
    keyring = _import_keyring()
    if not force:
        existing = keyring.get_password(service, account)
        if existing:
            raise FileExistsError(
                f"Key already exists in keyring service={service} account={account}"
            )
    keyring.set_password(service, account, key.decode("utf-8"))


def _load_key_keyring(service: str, account: str) -> bytes:
    keyring = _import_keyring()
    value = keyring.get_password(service, account)
    if not value:
        raise KeyNotFoundError(
            f"Master key not found in keyring service={service} account={account}"
        )
    return value.encode("utf-8")


def _delete_key_keyring(service: str, account: str) -> None:
    keyring = _import_keyring()
    try:
        keyring.delete_password(service, account)
    except Exception:
        return


def generate_key_file(path: Path, force: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        raise FileExistsError(f"Key file already exists: {path}")

    key = Fernet.generate_key()
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_bytes(key + b"\n")
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, path)
    return path


def generate_master_key(
    path: Path,
    storage: KeyStorage = "file",
    keyring_service: str = "zocket",
    keyring_account: str = "master-key",
    force: bool = False,
) -> bytes:
    key = Fernet.generate_key()
    if storage == "keyring":
        _store_key_keyring(keyring_service, keyring_account, key, force=force)
        return key
    generate_key_file(path, force=force)
    return path.read_bytes().strip()


def load_key(
    path: Path,
    env_var: str = "ZOCKET_MASTER_KEY",
    storage: KeyStorage = "file",
    keyring_service: str = "zocket",
    keyring_account: str = "master-key",
) -> bytes:
    from_env = os.environ.get(env_var)
    if from_env:
        return from_env.strip().encode("utf-8")

    if storage == "keyring":
        return _load_key_keyring(keyring_service, keyring_account)

    if not path.exists():
        raise KeyNotFoundError(
            f"Master key file not found: {path}. Run `zocket init` first."
        )

    key = path.read_bytes().strip()
    if not key:
        raise KeyNotFoundError(f"Master key file is empty: {path}")
    return key


def store_key(
    key: bytes,
    path: Path,
    storage: KeyStorage = "file",
    keyring_service: str = "zocket",
    keyring_account: str = "master-key",
) -> None:
    if storage == "keyring":
        _store_key_keyring(keyring_service, keyring_account, key, force=True)
        return
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_bytes(key + b"\n")
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, path)


def delete_key(
    path: Path,
    storage: KeyStorage = "file",
    keyring_service: str = "zocket",
    keyring_account: str = "master-key",
) -> None:
    if storage == "keyring":
        _delete_key_keyring(keyring_service, keyring_account)
        return
    if path.exists():
        path.unlink()


def encrypt_payload(payload: dict[str, Any], key: bytes) -> bytes:
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return Fernet(key).encrypt(raw)


def decrypt_payload(ciphertext: bytes, key: bytes) -> dict[str, Any]:
    try:
        raw = Fernet(key).decrypt(ciphertext)
    except InvalidToken as exc:
        raise DecryptionError(
            "Failed to decrypt vault. Master key is invalid or vault is corrupted."
        ) from exc
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise DecryptionError("Vault payload is malformed.")
    return data
