# AI Auto-Deploy Playbook

This is the file you can send to an AI coding agent so it can deploy zocket end-to-end.

## One-command bootstrap

If this repo is already present locally:
```bash
bash scripts/install-zocket.sh --source local
```

If only the file is available, the script will fetch and run the platform installer:
```bash
curl -fsSL https://raw.githubusercontent.com/aozorin/zocket/main/scripts/install-zocket.sh | bash
```

## Agent task prompt (copy/paste)

```text
Deploy zocket on this machine with secure defaults:
1) Detect OS and shell.
2) Run installer:
   - Linux/macOS: curl -fsSL https://raw.githubusercontent.com/aozorin/zocket/main/scripts/install-zocket.sh | bash
   - Windows: irm https://raw.githubusercontent.com/aozorin/zocket/main/scripts/install-zocket.ps1 | iex
3) Verify:
   - web panel on http://127.0.0.1:18001
   - MCP SSE endpoint on http://127.0.0.1:18002/sse (Claude Code)
   - MCP streamable endpoint on http://127.0.0.1:18003/mcp (Codex)
4) Configure MCP clients using docs/CLIENTS_MCP.md (Codex + Claude Code only).
5) Return final report with commands executed and health-check results.
```

## Optional production profile (Linux system services)

```bash
bash scripts/install-zocket.sh --source git --repo-url https://github.com/aozorin/zocket.git --repo-ref main --autostart system --zocket-home /var/lib/zocket
```

## Post-deploy checklist for agent

1. Confirm web login/setup page opens.
2. Confirm MCP HTTP is reachable on loopback only.
3. Configure one client (Codex or Claude Code) and run `list_projects` tool.
4. Ensure no secret values are returned in metadata mode.
5. Save final links:
   - [INSTALL.md](/home/zorin/project/zocket/docs/INSTALL.md)
   - [CLIENTS_MCP.md](/home/zorin/project/zocket/docs/CLIENTS_MCP.md)
   - [LOCAL_MODELS.md](/home/zorin/project/zocket/docs/LOCAL_MODELS.md)
