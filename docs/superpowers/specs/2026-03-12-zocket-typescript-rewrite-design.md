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
  vault.ts          # VaultService — project/secret CRUD, file locking via proper-lockfile
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

### Runtime (4 packages)
| Package | Purpose |
|---|---|
| `hono` | Web framework + JSX server-side rendering |
| `commander` | CLI subcommands and option parsing |
| `@modelcontextprotocol/sdk` | MCP server (stdio, SSE, streamable-HTTP) |
| `proper-lockfile` | Cross-platform file locking for concurrent vault access |

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

**Vault binary format** (raw binary, no base64):
```
[4B version, big-endian uint32][12B IV][16B GCM auth tag][NB raw ciphertext]
```
Version field = `1` for this format. Backup files use `.enc` extension.

Key storage priority (highest first):
1. `ZOCKET_MASTER_KEY` env var
2. OS keyring via `keytar` (if installed)
3. File: `~/.zocket/master.key`

**keytar fallback:** if `key_storage` config is `"keyring"` but `keytar` is not installed, `load_key()` throws a user-facing error: `"keytar not installed — run: npm i -g keytar"`. Key rotation (`zocket key rotate`) must validate the target storage backend is available before rotating.

## Web Panel

- **Hono JSX** replaces Jinja2 templates — TypeScript-native, no extra dep
- Same routes as Python version (~10 routes)
- Same features: login, first-run setup, project/secret CRUD, folder picker, themes (standard/zorin, light/dark), language switcher
- **Session:** in-memory `Map<string, SessionData>` with random session ID stored in signed cookie via `hono/cookie` (`setCookie` + `getCookie`). Session secret generated once at init and persisted in `config.json` as `session_secret`. Restart-safe.
- **Folder picker security:** browsing constrained to allowlist `folder_picker_roots` (default: `["/home", "/srv", "/opt", "/var/www", "/var/lib"]`). Path traversal protection: resolve requested path with `path.resolve()` and verify it starts with one of the allowed roots before listing.
- **`config show` redaction:** `web_password_hash` and `web_password_salt` are redacted from CLI output (shown as `"***"`).

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
zocket init [--force] [--autostart]
zocket web [--host 127.0.0.1] [--port 18001]
zocket mcp [--transport stdio|sse|streamable-http] [--mode metadata|admin] [--host 127.0.0.1] [--port 18002]
```
MCP port defaults: `--port 18002` for SSE, `--port 18003` for streamable-HTTP (transport-aware default in Commander).

```
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

## Additional Module Notes

**`audit.ts`** — `AuditLogger` must implement:
- `log(action, actor, details, status)` — append JSONL entry
- `tail(n)` — return last N entries
- `failedLogins(minutes)` — count failed login entries within window (used by `zocket audit check`)

**`harden.ts` / `autostart.ts`** — binary discovery in Node.js context:
- Use `process.argv[1]` (absolute path to `zocket.js`) for `ExecStart` in systemd units
- Fallback: `which('zocket')` via Node `child_process.execSync`
- Systemd unit `ExecStart` uses `node /path/to/zocket.js web ...` form

**`i18n.ts`** — preserve same key names as Python version for consistency. All ~80 existing keys must be ported with identical names.

**`backup.ts`** — backup files named `vault-YYYYMMDDTHHMMSSZ.enc`, list globs `backups/*.enc`.

## Testing

**Vitest** (native ESM, fast, TypeScript-native):

| File | Coverage |
|---|---|
| `tests/vault.test.ts` | CRUD, concurrent file locking, folder matching |
| `tests/crypto.test.ts` | encrypt/decrypt, key rotation, keytar fallback error |
| `tests/mcp.test.ts` | metadata mode tools, admin mode mutations |
| `tests/web.test.ts` | all routes via Hono test client, folder picker path traversal |
| `tests/runner.test.ts` | $VAR substitution, output redaction, exec policy |
| `tests/harden.test.ts` | systemd unit generation (dry-run), binary path discovery |
| `tests/autostart.test.ts` | install/remove/status (dry-run) |

## Release

1. Delete existing GitHub repo `aozorin/zocket`
2. Delete npm package `@ao_zorin/zocket`
3. Fresh repo + fresh publish under same names
4. README updated with correct install instructions
