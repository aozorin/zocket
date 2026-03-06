# AI Auto-Deploy Playbook

This is the file you can send to an AI coding agent so it can deploy zocket end-to-end.

## One-command bootstrap

If this repo is already present locally:
```bash
python3 scripts/ai-autodeploy.py --repo-url https://github.com/your-org/zocket.git --repo-ref main
```

If only the file is available, the script will clone the repo and run the platform installer.

## Agent task prompt (copy/paste)

```text
Deploy zocket on this machine with secure defaults:
1) Detect OS and shell.
2) Run scripts/ai-autodeploy.py with:
   --lang en
   --web-port 18001
   --mcp-port 18002
   --mcp-mode metadata
   --autostart user (Linux/macOS) or enabled startup task (Windows)
3) Verify:
   - web panel on http://127.0.0.1:18001
   - MCP endpoint on http://127.0.0.1:18002/mcp
4) Configure MCP clients using docs/CLIENTS_MCP.md.
5) Return final report with commands executed and health-check results.
```

## Optional production profile (Linux system services)

```bash
python3 scripts/ai-autodeploy.py \
  --repo-url https://github.com/your-org/zocket.git \
  --repo-ref main \
  --autostart system \
  --zocket-home /var/lib/zocket
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
