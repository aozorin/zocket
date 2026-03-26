# Install Guide (Windows / Linux / macOS)

This guide installs **zocket** as:
- local web panel on `127.0.0.1:18001`
- MCP SSE server on `127.0.0.1:18002/sse` (Claude Code)
- MCP streamable HTTP server on `127.0.0.1:18003/mcp` (Codex)
- optional MCP stdio server for local CLI use

## 1) Quick Install (recommended)

### Linux and macOS
```bash
curl -fsSL https://raw.githubusercontent.com/your-org/zocket/main/scripts/install-zocket.sh | bash
```

If you run from a local clone:
```bash
bash scripts/install-zocket.sh --source local
```

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/your-org/zocket/main/scripts/install-zocket.ps1 | iex
```

If you run from a local clone:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -Source Local
```

## 2) Linux details

### Debian/Ubuntu and Debian-based
Installer auto-installs:
- `python3`
- `python3-venv`
- `python3-pip`
- `git`
- `curl`

Equivalent manual install:
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip git curl
```

### Other Linux distros
Installer supports:
- `dnf`/`yum` (RHEL/Fedora)
- `pacman` (Arch)
- `zypper` (openSUSE)
- `apk` (Alpine)

If your distro is unsupported, install manually:
- Python `>=3.10`
- `pip`
- `venv`
- `git`

## 3) macOS details

Installer uses Homebrew when dependencies are missing:
```bash
brew install python git curl
```

## 4) Windows details

Requirements:
- Python 3.10+ (recommended from `python.org` or `winget`)
- Git for Windows

Autostart (enabled by default):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1
```

This creates scheduled tasks:
- `ZocketWeb`
- `ZocketMcpSse`
- `ZocketMcpStreamable`

Disable autostart:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -EnableAutostart:$false
```

## 5) NPM package usage

This repo now includes an npm wrapper package.

Global install from npm:
```bash
npm i -g @zocket/cli
zocket setup
```

Or install from your git repo (example):
```bash
npm i -g github:your-org/zocket
```

First-run setup:
```bash
zocket setup
```

Then use normal CLI:
```bash
zocket init
zocket web --host 127.0.0.1 --port 18001
zocket mcp --transport sse --mode metadata --host 127.0.0.1 --port 18002
zocket mcp --transport streamable-http --mode metadata --host 127.0.0.1 --port 18003
```

## 6) Systemd hardening on Linux (production)

If you install with `--autostart system`, the installer creates and enables:
- `zocket-web.service` (web panel on 18001)
- `zocket-mcp-sse.service` (Claude Code, 18002)
- `zocket-mcp-http.service` (Codex, 18003)

Check:
```bash
systemctl status zocket-web.service --no-pager
systemctl status zocket-mcp-sse.service --no-pager
systemctl status zocket-mcp-http.service --no-pager
```

### Linux user-level autostart (no root)
```bash
systemctl --user enable --now zocket-web.service
systemctl --user enable --now zocket-mcp-sse.service
systemctl --user enable --now zocket-mcp-http.service
systemctl --user status zocket-web.service --no-pager
systemctl --user status zocket-mcp-sse.service --no-pager
systemctl --user status zocket-mcp-http.service --no-pager
```

### macOS launchd autostart (installed by script)
Installer creates and loads:
- `~/Library/LaunchAgents/dev.zocket.web.plist`
- `~/Library/LaunchAgents/dev.zocket.mcp-sse.plist`
- `~/Library/LaunchAgents/dev.zocket.mcp-streamable.plist`

If you need to install manually, use:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>dev.zocket.web</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/YOUR_USER/.local/share/zocket/venv/bin/python3</string>
      <string>-m</string><string>zocket</string>
      <string>web</string><string>--host</string><string>127.0.0.1</string>
      <string>--port</string><string>18001</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ZOCKET_HOME</key><string>/Users/YOUR_USER/.zocket</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
```

SSE MCP (`dev.zocket.mcp-sse.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>dev.zocket.mcp-sse</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/YOUR_USER/.local/share/zocket/venv/bin/python3</string>
      <string>-m</string><string>zocket</string>
      <string>mcp</string><string>--transport</string><string>sse</string>
      <string>--mode</string><string>metadata</string>
      <string>--host</string><string>127.0.0.1</string>
      <string>--port</string><string>18002</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ZOCKET_HOME</key><string>/Users/YOUR_USER/.zocket</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
```

Streamable HTTP MCP (`dev.zocket.mcp-streamable.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>dev.zocket.mcp-streamable</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/YOUR_USER/.local/share/zocket/venv/bin/python3</string>
      <string>-m</string><string>zocket</string>
      <string>mcp</string><string>--transport</string><string>streamable-http</string>
      <string>--mode</string><string>metadata</string>
      <string>--host</string><string>127.0.0.1</string>
      <string>--port</string><string>18003</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ZOCKET_HOME</key><string>/Users/YOUR_USER/.zocket</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
```

Load services:
```bash
launchctl load ~/Library/LaunchAgents/dev.zocket.web.plist
launchctl load ~/Library/LaunchAgents/dev.zocket.mcp-sse.plist
launchctl load ~/Library/LaunchAgents/dev.zocket.mcp-streamable.plist
```

### Windows autostart (Task Scheduler)
Installer can create tasks with:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -EnableAutostart
```

Or create manually:
- task `ZocketWeb` on logon
- task `ZocketMcpSse` on logon
- task `ZocketMcpStreamable` on logon
- actions:
  - `python -m zocket web --host 127.0.0.1 --port 18001`
  - `python -m zocket mcp --transport sse --mode metadata --host 127.0.0.1 --port 18002`
  - `python -m zocket mcp --transport streamable-http --mode metadata --host 127.0.0.1 --port 18003`

## 7) First web open

Open `http://127.0.0.1:18001` and choose one:
- set your own password
- generate strong password
- continue without password (explicit warning + confirmation)

## 8) Health checks

```bash
curl -I http://127.0.0.1:18001/login
curl -I http://127.0.0.1:18002/sse
curl -I http://127.0.0.1:18003/mcp
zocket mcp --transport stdio --mode metadata
```
