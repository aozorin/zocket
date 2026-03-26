# zocket

Local encrypted vault + web panel + MCP server for AI agent workflows.

## What zocket provides

- encrypted secret vault across projects/sessions
- local web panel (`127.0.0.1:18001`)
- MCP server:
  - stdio
  - SSE (`127.0.0.1:18002/sse`) for Claude Code
  - streamable HTTP (`127.0.0.1:18003/mcp`) for Codex
- EN/RU UI and CLI
- first-run web setup:
  - set your own password
  - generate strong password
  - continue without password (with explicit warning)
- project-to-folder mapping with folder picker
- audit log, backup/restore, key rotation
- Linux hardened system services (`zocketd`)

## Install (instant)

```bash
npm i -g @ao_zorin/zocket
zocket init
```

or global from git:
```bash
npm i -g github:aozorin/zocket
zocket init
```

## Quick start

```bash
zocket init
zocket start --host 127.0.0.1 --web-port 18001 --mcp-port 18002 --mode admin
```

Open `http://127.0.0.1:18001`.

## Codex (streamable HTTP)

Codex requires streamable HTTP on `127.0.0.1:18003/mcp`. The Node CLI does **SSE only** today.
Until streamable HTTP is implemented in Node, run the companion Python service (separate package):

```bash
python3 -m zocket mcp --transport streamable-http --mode admin --host 127.0.0.1 --port 18003
```

## Docs

- installation (Windows/Linux/macOS): [`docs/INSTALL.md`](docs/INSTALL.md)
- MCP clients (Codex/Claude Code): [`docs/CLIENTS_MCP.md`](docs/CLIENTS_MCP.md)
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
npm install
npm run build
npm test
```

## License

MIT, see [`LICENSE`](LICENSE).
