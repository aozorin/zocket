#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_MODE="${SOURCE_MODE:-auto}"         # auto|local|git|npm
REPO_URL="${REPO_URL:-https://github.com/aozorin/zocket.git}"
REPO_REF="${REPO_REF:-main}"
ZOCKET_HOME_DIR="${ZOCKET_HOME_DIR:-$HOME/.zocket}"
LANGUAGE="${LANGUAGE:-en}"                 # en|ru (used by UI; config set via web)
WEB_PORT="${WEB_PORT:-18001}"
MCP_PORT="${MCP_PORT:-18002}"
MCP_STREAM_PORT="${MCP_STREAM_PORT:-18003}"
MCP_MODE="${MCP_MODE:-admin}"              # metadata|admin
AUTOSTART="${AUTOSTART:-user}"             # user|system|none
SERVICE_USER="${SERVICE_USER:-zocketd}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --source <auto|local|git|npm>
  --repo-url <git-url>
  --repo-ref <branch-or-tag>
  --zocket-home <path>
  --lang <en|ru>
  --web-port <port>
  --mcp-port <port>
  --mcp-stream-port <port>
  --mcp-mode <metadata|admin>
  --autostart <user|system|none>
  --service-user <name>
  -h, --help

Environment variables with same names are also supported.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_MODE="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --repo-ref) REPO_REF="$2"; shift 2 ;;
    --zocket-home) ZOCKET_HOME_DIR="$2"; shift 2 ;;
    --lang) LANGUAGE="$2"; shift 2 ;;
    --web-port) WEB_PORT="$2"; shift 2 ;;
    --mcp-port) MCP_PORT="$2"; shift 2 ;;
    --mcp-stream-port) MCP_STREAM_PORT="$2"; shift 2 ;;
    --mcp-mode) MCP_MODE="$2"; shift 2 ;;
    --autostart) AUTOSTART="$2"; shift 2 ;;
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_sudo() {
  if have_cmd sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

install_node_linux() {
  if have_cmd apt-get; then
    run_sudo apt-get update
    run_sudo apt-get install -y nodejs npm git curl
    return
  fi
  if have_cmd dnf; then
    run_sudo dnf install -y nodejs npm git curl
    return
  fi
  if have_cmd yum; then
    run_sudo yum install -y nodejs npm git curl
    return
  fi
  if have_cmd pacman; then
    run_sudo pacman -Sy --noconfirm nodejs npm git curl
    return
  fi
  if have_cmd zypper; then
    run_sudo zypper install -y nodejs npm git curl
    return
  fi
  if have_cmd apk; then
    run_sudo apk add --no-cache nodejs npm git curl
    return
  fi
  echo "Unsupported Linux package manager. Install Node.js 18+ and npm manually." >&2
  exit 1
}

install_node_macos() {
  if ! have_cmd brew; then
    echo "Homebrew not found. Install Homebrew first: https://brew.sh" >&2
    exit 1
  fi
  brew install node git curl
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
if ! have_cmd node || ! have_cmd npm; then
  echo "node/npm not found, installing dependencies..."
  case "$OS" in
    linux*) install_node_linux ;;
    darwin*) install_node_macos ;;
    *)
      echo "Unsupported OS for this installer: $OS" >&2
      exit 1
      ;;
  esac
fi

if [[ "$SOURCE_MODE" == "auto" ]]; then
  if [[ -f "${REPO_ROOT}/package.json" ]]; then
    SOURCE_MODE="local"
  else
    SOURCE_MODE="npm"
  fi
fi

case "$SOURCE_MODE" in
  local)
    npm i -g "${REPO_ROOT}"
    ;;
  git)
    npm i -g "git+${REPO_URL}#${REPO_REF}"
    ;;
  npm)
    npm i -g @ao_zorin/zocket
    ;;
  *)
    echo "Invalid source mode: $SOURCE_MODE" >&2
    exit 2
    ;;
 esac

ZOCKET_BIN="$(command -v zocket || true)"
if [[ -z "${ZOCKET_BIN}" ]]; then
  echo "zocket binary not found after install" >&2
  exit 1
fi

export ZOCKET_HOME="${ZOCKET_HOME_DIR}"
mkdir -p "${ZOCKET_HOME_DIR}"
"${ZOCKET_BIN}" init >/dev/null

write_systemd_unit() {
  local unit_path="$1"
  local exec_start="$2"
  local svc_user="$3"
  local svc_group="$4"
  local zocket_home="$5"
  run_sudo tee "${unit_path}" >/dev/null <<EOF
[Unit]
Description=Zocket service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${svc_user}
Group=${svc_group}
Environment=ZOCKET_HOME=${zocket_home}
ExecStart=${exec_start}
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
ReadWritePaths=${zocket_home}

[Install]
WantedBy=multi-user.target
EOF
}

write_systemd_user_unit() {
  local unit_path="$1"
  local exec_start="$2"
  local zocket_home="$3"
  mkdir -p "$(dirname "${unit_path}")"
  cat > "${unit_path}" <<EOF
[Unit]
Description=Zocket service
After=default.target

[Service]
Type=simple
Environment=ZOCKET_HOME=${zocket_home}
ExecStart=${exec_start}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
}

install_launchd() {
  local label="$1"
  local exec_start="$2"
  local zocket_home="$3"
  local plist_dir="$4"
  mkdir -p "${plist_dir}"
  cat > "${plist_dir}/${label}.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${label}</string>
    <key>ProgramArguments</key>
    <array>
EOF
  for part in ${exec_start}; do
    echo "      <string>${part}</string>" >> "${plist_dir}/${label}.plist"
  done
  cat >> "${plist_dir}/${label}.plist" <<EOF
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ZOCKET_HOME</key><string>${zocket_home}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
EOF
}

EXEC_START="${ZOCKET_BIN} start --host 127.0.0.1 --web-port ${WEB_PORT} --mcp-port ${MCP_PORT} --mcp-stream-port ${MCP_STREAM_PORT} --mode ${MCP_MODE}"

if [[ "$AUTOSTART" == "user" && "$OS" == linux* ]]; then
  USER_UNIT_DIR="$HOME/.config/systemd/user"
  write_systemd_user_unit "${USER_UNIT_DIR}/zocket.service" "${EXEC_START}" "${ZOCKET_HOME_DIR}"
  systemctl --user daemon-reload
  systemctl --user enable --now zocket.service >/dev/null
fi

if [[ "$AUTOSTART" == "system" && "$OS" == linux* ]]; then
  write_systemd_unit "/etc/systemd/system/zocket.service" "${EXEC_START}" "${SERVICE_USER}" "${SERVICE_USER}" "${ZOCKET_HOME_DIR}"
  run_sudo systemctl daemon-reload
  run_sudo systemctl enable --now zocket.service >/dev/null
fi

if [[ "$AUTOSTART" != "none" && "$OS" == darwin* ]]; then
  PLIST_DIR="$HOME/Library/LaunchAgents"
  install_launchd "dev.zocket" "${EXEC_START}" "${ZOCKET_HOME_DIR}" "${PLIST_DIR}"
  launchctl unload "${PLIST_DIR}/dev.zocket.plist" >/dev/null 2>&1 || true
  launchctl load "${PLIST_DIR}/dev.zocket.plist"
fi

cat <<EOF
zocket installed successfully.

zocket:    ${ZOCKET_BIN}
ZOCKET_HOME=${ZOCKET_HOME_DIR}

Default ports:
  web panel: http://127.0.0.1:${WEB_PORT}
  MCP SSE:   http://127.0.0.1:${MCP_PORT}/sse
  MCP HTTP:  http://127.0.0.1:${MCP_STREAM_PORT}/mcp

Next steps:
  1) Start now: ${EXEC_START}
EOF
