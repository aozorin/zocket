from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from typing import Sequence


def redact_text(text: str, secrets: Sequence[str]) -> str:
    redacted = text
    # Replace longest secrets first to avoid partial leaking.
    for secret in sorted(set(secrets), key=len, reverse=True):
        if secret:
            redacted = redacted.replace(secret, "***REDACTED***")
    return redacted


@dataclass
class RunResult:
    exit_code: int
    stdout: str
    stderr: str


class ExecPolicyError(RuntimeError):
    pass


_ENV_PATTERN = re.compile(r"\$(\w+)|\$\{([^}]+)\}")


def _substitute_env_vars(args: Sequence[str], env: dict[str, str]) -> list[str]:
    resolved: list[str] = []
    for arg in args:
        def _replace(match: re.Match[str]) -> str:
            key = match.group(1) or match.group(2) or ""
            return env.get(key, match.group(0))
        resolved.append(_ENV_PATTERN.sub(_replace, arg))
    return resolved


def _enforce_allowlist(command: Sequence[str], allowlist: Sequence[str]) -> None:
    if not command:
        raise ExecPolicyError("Command is required.")
    base = os.path.basename(command[0])
    if base == "sudo":
        raise ExecPolicyError("sudo is not allowed.")
    if allowlist and base not in set(allowlist):
        raise ExecPolicyError(f"Command '{base}' is not allowed by policy.")


def run_with_env(command: Sequence[str], project_env: dict[str, str]) -> RunResult:
    if not command:
        raise ValueError("Command is required.")

    env = os.environ.copy()
    env.update(project_env)
    completed = subprocess.run(
        list(command),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    secrets = list(project_env.values())
    return RunResult(
        exit_code=completed.returncode,
        stdout=redact_text(completed.stdout, secrets),
        stderr=redact_text(completed.stderr, secrets),
    )


def run_with_env_limited(
    *,
    command: Sequence[str],
    project_env: dict[str, str],
    allowlist: Sequence[str] | None = None,
    max_output_chars: int | None = 0,
    substitute_env: bool = True,
) -> RunResult:
    if not command:
        raise ValueError("Command is required.")
    allowlist = list(allowlist or [])
    _enforce_allowlist(command, allowlist)
    env = os.environ.copy()
    env.update(project_env)
    resolved = _substitute_env_vars(command, project_env) if substitute_env else list(command)
    completed = subprocess.run(
        list(resolved),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    secrets = list(project_env.values())
    stdout = redact_text(completed.stdout, secrets)
    stderr = redact_text(completed.stderr, secrets)
    if max_output_chars is None:
        return RunResult(exit_code=completed.returncode, stdout=stdout, stderr=stderr)
    limit = max(int(max_output_chars), 0)
    if limit == 0:
        return RunResult(exit_code=completed.returncode, stdout="", stderr="")
    return RunResult(
        exit_code=completed.returncode,
        stdout=stdout[:limit],
        stderr=stderr[:limit],
    )
