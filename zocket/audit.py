from __future__ import annotations

import json
import os
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditLogger:
    def __init__(self, path: Path, enabled: bool = True):
        self.path = path
        self.enabled = enabled

    def log(
        self,
        action: str,
        status: str,
        actor: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled:
            return
        entry = {
            "ts": utc_now_iso(),
            "action": action,
            "status": status,
            "actor": actor,
            "details": details or {},
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch(mode=0o600)
        line = json.dumps(entry, ensure_ascii=True, separators=(",", ":")) + "\n"
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line)
        os.chmod(self.path, 0o600)

    def tail(self, n: int = 50) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        out: deque[dict[str, Any]] = deque(maxlen=max(1, n))
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return list(out)

    def failed_logins(self, minutes: int = 60) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        total = 0
        for item in self.tail(2000):
            if item.get("action") != "web.login":
                continue
            if item.get("status") != "failed":
                continue
            ts = item.get("ts")
            if not isinstance(ts, str):
                continue
            try:
                t = datetime.fromisoformat(ts)
            except ValueError:
                continue
            if t >= cutoff:
                total += 1
        return total
