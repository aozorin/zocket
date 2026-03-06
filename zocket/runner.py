from __future__ import annotations

import os
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
