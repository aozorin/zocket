# MCP Client Integration (Codex + Claude Code)

This file contains ready-to-use zocket MCP configs for:
- Codex CLI
- Claude Code

Use safest mode by default:
- `metadata` (recommended)

Use admin mode only when needed:
- `admin`

---

## Endpoints

- Claude Code (SSE):
  - `http://127.0.0.1:18002/sse`

- Codex (streamable HTTP):
  - `http://127.0.0.1:18003/mcp`

---

## Claude Code

Recommended: SSE (loopback only).

```bash
claude mcp add --transport sse zocket http://127.0.0.1:18002/sse
claude mcp list
```

Note: Claude Code uses `--transport sse` (not http) for SSE endpoints.

---

## Codex CLI

Recommended: streamable HTTP.

```bash
codex mcp add zocket --url http://127.0.0.1:18003/mcp
codex mcp list
```

Config file alternative (`~/.codex/config.toml`):
```toml
[mcp_servers.zocket]
url = "http://127.0.0.1:18003/mcp"
```

---

## Security defaults

- Prefer `metadata` mode in all clients.
- Keep MCP bound to `127.0.0.1`.
- Do not expose these ports to the network.
