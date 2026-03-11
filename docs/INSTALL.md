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

Optional autostart:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -EnableAutostart
```

This creates scheduled tasks:
- `ZocketWeb`
- `ZocketMcpHttp`

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

```bash
sudo env ZOCKET_HOME=/var/lib/zocket zocket harden install-linux-system \
  --service-user zocketd \
  --zocket-home /var/lib/zocket \
  --web-port 18001 \
  --mcp-host 127.0.0.1 \
  --mcp-port 18002 \
  --mcp-mode metadata
```

Check:
```bash
systemctl status zocket-web.service --no-pager
systemctl status zocket-mcp-http.service --no-pager
systemctl status zocket-mcp-http-streamable.service --no-pager
```

### Optional: systemd unit for Codex (streamable HTTP on 18003)

Create `/etc/systemd/system/zocket-mcp-http-streamable.service`:
```ini
[Unit]
Description=Zocket MCP HTTP Streamable (system)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=zocketd
Group=zocketd
Environment=ZOCKET_HOME=/var/lib/zocket
ExecStart=/usr/bin/python3 -m zocket mcp --transport streamable-http --mode metadata --host 127.0.0.1 --port 18003
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectControlGroups=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/var/lib/zocket

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zocket-mcp-http-streamable.service
```

### Linux user-level autostart (no root)
```bash
zocket autostart install --target web --web-port 18001
zocket autostart install --target mcp --mcp-port 18002 --mcp-mode metadata --mcp-host 127.0.0.1
zocket autostart status --target both
```

### macOS launchd autostart (manual)
Create `~/Library/LaunchAgents/dev.zocket.web.plist`, `dev.zocket.mcp-sse.plist`,
and `dev.zocket.mcp-streamable.plist`:

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
