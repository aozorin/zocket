# Zocket — TypeScript Rewrite Design

**Date:** 2026-03-12
**Status:** Approved

## Overview

Rewrite zocket from Python to TypeScript/Node.js so the npm package is the entire application — no Python dependency required. Republish to GitHub and npm as `@ao_zorin/zocket`.

## Goals

- Remove Python runtime dependency
- Native npm package (bundle via tsup — no node_modules at install time)
- Full feature parity with Python version
- TypeScript for safety across crypto, vault, and MCP layers
- Maintain same CLI interface, same MCP tools, same web panel features

## Non-Goals

- Vault file compatibility with Python version (new AES-256-GCM format)
- Monorepo / multiple packages
- zorin-member-mcp (stays as JS, no rewrite needed)

## Architecture

```
CLI (Commander.js)  ──┐
Web (Hono)          ──┼──> VaultService ──> crypto ──> vault.enc
MCP SDK             ──┘         │
                                └──> ConfigStore, AuditLogger
```

Three interfaces share one VaultService core. All interfaces run as subcommands of the single `zocket` binary.

## Module Structure

```
src/
  index.ts          # bin entry point (shebang, Commander root)
  cli.ts            # all CLI commands
  vault.ts          # VaultService — project/secret CRUD, file locking
  crypto.ts         # AES-256-GCM, key management, key storage backends
  web.ts            # Hono app + all routes
  mcp.ts            # MCP server (stdio / SSE / streamable-HTTP)
  auth.ts           # PBKDF2-SHA256 password hashing (Node built-in)
  config.ts         # ConfigStore — JSON persistence with defaults
  audit.ts          # AuditLogger — JSONL append-only audit trail
  backup.ts         # backup/restore with timestamped naming
  paths.ts          # ZOCKET_HOME resolution, all file paths
  i18n.ts           # EN/RU translations, message interpolation
  harden.ts         # Linux systemd service generation
  autostart.ts      # cross-platform autostart (Linux/macOS/Windows)
  runner.ts         # command exec with $VAR substitution and redaction
  ui/
    index.tsx       # Hono JSX — main dashboard
    login.tsx       # Hono JSX — login / first-run setup
```

## Dependencies

### Runtime (3 packages)
| Package | Purpose |
|---|---|
| `hono` | Web framework + JSX server-side rendering |
| `commander` | CLI subcommands and option parsing |
| `@modelcontextprotocol/sdk` | MCP server (stdio, SSE, streamable-HTTP) |

### Optional peer dependency
| Package | Purpose |
|---|---|
| `keytar` | OS keyring storage for master key (falls back to file if absent) |

### Dev
`typescript`, `tsup`, `vitest`, `@types/node`

## Build

- **tsup** bundles `src/index.ts` → `dist/zocket.js` (ESM)
- All runtime deps bundled inside — no node_modules at install time
- `minify: false` — readable output, easier to debug
- `package.json`: `"type": "module"`, `"bin": { "zocket": "dist/zocket.js" }`

## Crypto

| | Python (old) | Node.js (new) |
|---|---|---|
| Vault encryption | Fernet (AES-128-CBC + HMAC) | AES-256-GCM (Node built-in `crypto`) |
| Password hashing | PBKDF2-SHA256, 390k iterations | PBKDF2-SHA256, 600k iterations (OWASP 2024) |
| Key storage | `keyring` library | `keytar` peer dep + file + env var |

**Vault binary format:** `[4B version][12B IV][16B auth tag][NB ciphertext]`

Key storage priority (highest first):
1. `ZOCKET_MASTER_KEY` env var
2. OS keyring via `keytar` (if installed)
3. File: `~/.zocket/master.key`

## Web Panel

- **Hono JSX** replaces Jinja2 templates — TypeScript-native, no extra dep
- Same routes as Python version (~10 routes)
- Same features: login, first-run setup, project/secret CRUD, folder picker, themes (standard/zorin, light/dark), language switcher
- Session: in-memory Map with signed cookie (Hono built-in)

## MCP Server

Same tools as Python version:

**Metadata mode** (read-only):
- `list_projects`, `list_project_keys`, `find_project_by_path`, `ping`

**Admin mode** (+ mutations):
- `upsert_secret`, `delete_secret`, `delete_project`, `create_project`, `run_with_project_env`, `get_exec_policy`

Transports: `stdio` (default), `sse` (port 18002), `streamable-http` (port 18003)

## CLI Commands

Same interface as Python version:
```
zocket init
zocket web [--host] [--port]
zocket mcp [--transport stdio|sse|streamable-http] [--mode metadata|admin] [--host] [--port]
zocket projects <list|create|set-folder|match-path|delete>
zocket secrets <list|set|delete>
zocket use <project> -- <command>
zocket autostart <install|remove|status>
zocket config <show|set-language|set-key-storage>
zocket auth <set-password|enable|disable>
zocket key rotate [--to-storage]
zocket backup <create|list|restore>
zocket audit <tail|check>
zocket harden install-linux-system [options]
```

## Testing

**Vitest** (native ESM, fast, TypeScript-native):

| File | Coverage |
|---|---|
| `tests/vault.test.ts` | CRUD, file locking, folder matching |
| `tests/crypto.test.ts` | encrypt/decrypt, key rotation, storage backends |
| `tests/mcp.test.ts` | metadata mode tools, admin mode mutations |
| `tests/web.test.ts` | all routes via Hono test client |
| `tests/runner.test.ts` | $VAR substitution, output redaction, exec policy |

## Release

1. Delete existing GitHub repo `aozorin/zocket`
2. Delete npm package `@ao_zorin/zocket`
3. Fresh repo + fresh publish under same names
4. README updated with correct install instructions
