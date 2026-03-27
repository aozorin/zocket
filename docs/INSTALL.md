# Install Guide (Windows / Linux / macOS)

This guide installs **zocket** (Node.js) as:
- local web panel on `127.0.0.1:18001`
- MCP SSE server on `127.0.0.1:18002/sse` (Claude Code)
- MCP streamable HTTP server on `127.0.0.1:18003/mcp` (Codex)

## 1) Quick Install (recommended)

### Linux and macOS
```bash
curl -fsSL https://raw.githubusercontent.com/aozorin/zocket/main/scripts/install-zocket.sh | bash
```

If you run from a local clone:
```bash
bash scripts/install-zocket.sh --source local
```

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/aozorin/zocket/main/scripts/install-zocket.ps1 | iex
```

If you run from a local clone:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -Source Local
```

## 2) Linux details

### Debian/Ubuntu and Debian-based
Installer auto-installs:
- `nodejs`
- `npm`
- `git`
- `curl`

Equivalent manual install:
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm git curl
```

### Other Linux distros
Installer supports:
- `dnf`/`yum` (RHEL/Fedora)
- `pacman` (Arch)
- `zypper` (openSUSE)
- `apk` (Alpine)

If your distro is unsupported, install manually:
- Node.js `>=18`
- `npm`
- `git`

## 3) macOS details

Installer uses Homebrew when dependencies are missing:
```bash
brew install node git curl
```

## 4) Windows details

Requirements:
- Node.js 18+ (recommended from `nodejs.org` or `winget`)
- Git for Windows

Autostart (enabled by default):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1
```

This creates scheduled task:
- `Zocket`

Disable autostart:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -EnableAutostart:$false
```

## 5) NPM package usage

Global install from npm:
```bash
npm i -g @ao_zorin/zocket
```

Then use normal CLI:
```bash
zocket init
zocket start --host 127.0.0.1 --web-port 18001 --mcp-port 18002 --mcp-stream-port 18003 --mode admin
```

## 6) Systemd hardening on Linux (production)

If you install with `--autostart system`, the installer creates and enables:
- `zocket.service` (web + SSE + streamable HTTP)

Check:
```bash
systemctl status zocket.service --no-pager
```

### Linux user-level autostart (no root)
```bash
systemctl --user enable --now zocket.service
systemctl --user status zocket.service --no-pager
```

### macOS launchd autostart (installed by script)
Installer creates and loads:
- `~/Library/LaunchAgents/dev.zocket.plist`

Manual example:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>dev.zocket</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/zocket</string>
      <string>start</string>
      <string>--host</string><string>127.0.0.1</string>
      <string>--web-port</string><string>18001</string>
      <string>--mcp-port</string><string>18002</string>
      <string>--mcp-stream-port</string><string>18003</string>
      <string>--mode</string><string>admin</string>
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

Load service:
```bash
launchctl load ~/Library/LaunchAgents/dev.zocket.plist
```

### Windows autostart (Task Scheduler)
Installer can create tasks with:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-zocket.ps1 -EnableAutostart
```

Or create manually:
- task `Zocket` on logon
- action:
  - `zocket start --host 127.0.0.1 --web-port 18001 --mcp-port 18002 --mcp-stream-port 18003 --mode admin`

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
zocket start --host 127.0.0.1 --web-port 18001 --mcp-port 18002 --mcp-stream-port 18003 --mode admin
```
