from __future__ import annotations

import hashlib
import hmac
import secrets


def hash_password(
    password: str, salt_hex: str | None = None, iterations: int = 390000
) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return salt.hex(), digest.hex()


def verify_password(
    password: str,
    salt_hex: str,
    expected_hash_hex: str,
    iterations: int,
) -> bool:
    salt = bytes.fromhex(salt_hex)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(digest.hex(), expected_hash_hex)
