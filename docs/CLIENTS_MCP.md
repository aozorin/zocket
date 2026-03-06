# MCP Client Integration

This file contains ready-to-use zocket MCP configs for:
- OpenCode
- Claude Code / Claude Desktop
- Codex CLI
- Qwen CLI
- Windsurf
- Antigravity

Use safest mode by default:
- `metadata` (recommended)

Use admin mode only when needed:
- `admin`

---

## Common zocket endpoints

- MCP stdio command:
```bash
zocket mcp --transport stdio --mode metadata
```

- MCP HTTP endpoint:
```text
http://127.0.0.1:18002/mcp
```

---

## OpenCode

OpenCode supports local and remote MCP entries in `~/.config/opencode/opencode.json`.

```json
{
  "mcp": {
    "zocket_stdio": {
      "type": "local",
      "enabled": true,
      "command": ["zocket", "mcp", "--transport", "stdio", "--mode", "metadata"]
    },
    "zocket_http": {
      "type": "remote",
      "enabled": true,
      "url": "http://127.0.0.1:18002/mcp"
    }
  }
}
```

---

## Claude Code

Add stdio server:
```bash
claude mcp add zocket -- zocket mcp --transport stdio --mode metadata
```

Add HTTP server:
```bash
claude mcp add --transport http zocket-http http://127.0.0.1:18002/mcp
```

Check:
```bash
claude mcp list
```

---

## Claude Desktop

Recommended path:
1. Open Claude Desktop.
2. Go to settings/developer MCP section.
3. Use MCP config editor (or import from Claude Code) and add zocket.

If Claude Code already has zocket configured:
```bash
claude mcp add-from-claude-desktop
```

---

## Codex CLI

Add stdio server:
```bash
codex mcp add zocket -- zocket mcp --transport stdio --mode metadata
```

Add HTTP server:
```bash
codex mcp add --transport streamable-http zocket-http http://127.0.0.1:18002/mcp
```

Check:
```bash
codex mcp list
```

You can also define MCP servers in `~/.codex/config.toml` under `[mcp_servers.*]`.

---

## Qwen CLI

Qwen CLI supports MCP through `~/.qwen/settings.json`.

```json
{
  "mcpServers": {
    "zocket": {
      "command": "zocket",
      "args": ["mcp", "--transport", "stdio", "--mode", "metadata"]
    }
  }
}
```

---

## Windsurf

1. Open Windsurf settings.
2. Go to MCP / Manage MCP Servers.
3. Open raw MCP config and add:

```json
{
  "mcpServers": {
    "zocket": {
      "command": "zocket",
      "args": ["mcp", "--transport", "stdio", "--mode", "metadata"]
    }
  }
}
```

Windsurf also supports Streamable HTTP MCP transport.

---

## Antigravity

Use:
1. Settings -> Manage MCP Servers
2. View raw config

Then add zocket entry:

```json
{
  "mcpServers": {
    "zocket": {
      "command": "zocket",
      "args": ["mcp", "--transport", "stdio", "--mode", "metadata"]
    }
  }
}
```

---

## Security defaults

- Prefer `metadata` mode in all clients.
- Keep zocket HTTP on loopback (`127.0.0.1`) only.
- If using system services on Linux, run under dedicated `zocketd`.
