# zocket

Local encrypted vault + web panel + MCP server for AI agent workflows.

## What zocket provides

- encrypted secret vault across projects/sessions
- local web panel (`127.0.0.1:18001`)
- MCP server:
  - stdio
  - streamable HTTP (`127.0.0.1:18002`)
- EN/RU UI and CLI
- first-run web setup:
  - set your own password
  - generate strong password
  - continue without password (with explicit warning)
- project-to-folder mapping with folder picker
- audit log, backup/restore, key rotation
- Linux hardened system services (`zocketd`)

## Install

### Python
```bash
pip install -e .
```

### npm wrapper
```bash
npm install
npm run smoke:npm
```

or global from git:
```bash
npm i -g github:your-org/zocket
zocket setup
```

## Quick start

```bash
zocket init
zocket web --host 127.0.0.1 --port 18001
zocket mcp --transport streamable-http --mode metadata --host 127.0.0.1 --port 18002
```

Open `http://127.0.0.1:18001`.

## Docs

- installation (Windows/Linux/macOS): [`docs/INSTALL.md`](docs/INSTALL.md)
- MCP clients (OpenCode/Claude/Codex/Qwen/Windsurf/Antigravity): [`docs/CLIENTS_MCP.md`](docs/CLIENTS_MCP.md)
- local models (Ollama/Hugging Face): [`docs/LOCAL_MODELS.md`](docs/LOCAL_MODELS.md)
- AI one-file auto-deploy playbook: [`docs/AI_AUTODEPLOY.md`](docs/AI_AUTODEPLOY.md)
- git + npm + pypi release flow: [`docs/GIT_NPM_RELEASE.md`](docs/GIT_NPM_RELEASE.md)
- external source links: [`docs/SOURCES.md`](docs/SOURCES.md)

## Security defaults

- keep MCP in `metadata` mode unless admin tools are required
- bind web/MCP to loopback
- on Linux production use:
  ```bash
  sudo env ZOCKET_HOME=/var/lib/zocket zocket harden install-linux-system \
    --service-user zocketd \
    --zocket-home /var/lib/zocket \
    --web-port 18001 \
    --mcp-host 127.0.0.1 \
    --mcp-port 18002 \
    --mcp-mode metadata
  ```

## Development

```bash
PYTHONPATH=. pytest -q
bash scripts/release-check.sh
```

## License

MIT, see [`LICENSE`](LICENSE).
