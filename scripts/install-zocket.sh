#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_MODE="${SOURCE_MODE:-auto}"         # auto|local|git|pypi
REPO_URL="${REPO_URL:-https://github.com/your-org/zocket.git}"
REPO_REF="${REPO_REF:-main}"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME/.local/share/zocket}"
ZOCKET_HOME_DIR="${ZOCKET_HOME_DIR:-$HOME/.zocket}"
LANGUAGE="${LANGUAGE:-en}"                 # en|ru
WEB_PORT="${WEB_PORT:-18001}"
MCP_PORT="${MCP_PORT:-18002}"
MCP_STREAM_PORT="${MCP_STREAM_PORT:-18003}"
MCP_MODE="${MCP_MODE:-metadata}"           # metadata|admin
AUTOSTART="${AUTOSTART:-user}"             # user|system|none
SERVICE_USER="${SERVICE_USER:-zocketd}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --source <auto|local|git|pypi>
  --repo-url <git-url>
  --repo-ref <branch-or-tag>
  --install-root <path>
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
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
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

install_python_linux() {
  if have_cmd apt-get; then
    run_sudo apt-get update
    run_sudo apt-get install -y python3 python3-venv python3-pip git curl
    return
  fi
  if have_cmd dnf; then
    run_sudo dnf install -y python3 python3-pip python3-virtualenv git curl
    return
  fi
  if have_cmd yum; then
    run_sudo yum install -y python3 python3-pip git curl
    return
  fi
  if have_cmd pacman; then
    run_sudo pacman -Sy --noconfirm python python-pip git curl
    return
  fi
  if have_cmd zypper; then
    run_sudo zypper install -y python3 python3-pip python3-virtualenv git curl
    return
  fi
  if have_cmd apk; then
    run_sudo apk add --no-cache python3 py3-pip py3-virtualenv git curl
    return
  fi
  echo "Unsupported Linux package manager. Install Python 3.10+, pip, and venv manually." >&2
  exit 1
}

install_python_macos() {
  if ! have_cmd brew; then
    echo "Homebrew not found. Install Homebrew first: https://brew.sh" >&2
    exit 1
  fi
  brew install python git curl
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
if ! have_cmd python3; then
  echo "python3 not found, installing dependencies..."
  case "$OS" in
    linux*) install_python_linux ;;
    darwin*) install_python_macos ;;
    *)
      echo "Unsupported OS for this installer: $OS" >&2
      exit 1
      ;;
  esac
fi

if ! have_cmd git; then
  echo "git not found, installing..."
  case "$OS" in
    linux*) install_python_linux ;;
    darwin*) install_python_macos ;;
    *) echo "Install git manually and rerun." >&2; exit 1 ;;
  esac
fi

if [[ "$SOURCE_MODE" == "auto" ]]; then
  if [[ -f "${REPO_ROOT}/pyproject.toml" ]]; then
    SOURCE_MODE="local"
  else
    SOURCE_MODE="git"
  fi
fi

PKG_SOURCE=""
SRC_DIR="${INSTALL_ROOT}/src"

mkdir -p "${INSTALL_ROOT}"

if [[ "$SOURCE_MODE" == "local" ]]; then
  PKG_SOURCE="${REPO_ROOT}"
elif [[ "$SOURCE_MODE" == "git" ]]; then
  if [[ -d "${SRC_DIR}/.git" ]]; then
    git -C "${SRC_DIR}" fetch --all --tags
    git -C "${SRC_DIR}" checkout "${REPO_REF}"
    git -C "${SRC_DIR}" pull --ff-only
  else
    rm -rf "${SRC_DIR}"
    git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" "${SRC_DIR}"
  fi
  PKG_SOURCE="${SRC_DIR}"
elif [[ "$SOURCE_MODE" == "pypi" ]]; then
  PKG_SOURCE="zocket"
else
  echo "Invalid source mode: $SOURCE_MODE" >&2
  exit 2
fi

VENV_DIR="${INSTALL_ROOT}/venv"
PY_BIN="${VENV_DIR}/bin/python3"
ZOCKET_BIN="${VENV_DIR}/bin/zocket"

python3 -m venv "${VENV_DIR}"
"${PY_BIN}" -m pip install --upgrade pip setuptools wheel

if [[ "$SOURCE_MODE" == "pypi" ]]; then
  "${PY_BIN}" -m pip install --upgrade "${PKG_SOURCE}"
else
  "${PY_BIN}" -m pip install --upgrade "${PKG_SOURCE}"
fi

mkdir -p "$HOME/.local/bin"
ln -sf "${ZOCKET_BIN}" "$HOME/.local/bin/zocket"

export ZOCKET_HOME="${ZOCKET_HOME_DIR}"
mkdir -p "${ZOCKET_HOME_DIR}"

if [[ ! -f "${ZOCKET_HOME_DIR}/vault.enc" ]]; then
  "${ZOCKET_BIN}" init
fi

"${ZOCKET_BIN}" config set-language "${LANGUAGE}" >/dev/null

if [[ "$AUTOSTART" == "user" && "$OS" == linux* ]]; then
  "${ZOCKET_BIN}" autostart install \
    --target both \
    --web-port "${WEB_PORT}" \
    --mcp-port "${MCP_PORT}" \
    --mcp-mode "${MCP_MODE}" \
    --zocket-home "${ZOCKET_HOME_DIR}" >/dev/null
fi

if [[ "$AUTOSTART" == "system" && "$OS" == linux* ]]; then
  run_sudo env ZOCKET_HOME="${ZOCKET_HOME_DIR}" "${PY_BIN}" -m zocket harden install-linux-system \
    --service-user "${SERVICE_USER}" \
    --zocket-home "${ZOCKET_HOME_DIR}" \
    --web-port "${WEB_PORT}" \
    --mcp-host 127.0.0.1 \
    --mcp-port "${MCP_PORT}" \
    --mcp-mode "${MCP_MODE}" >/dev/null
fi

cat <<EOF
zocket installed successfully.

Runtime:
  venv:      ${VENV_DIR}
  zocket:    ${ZOCKET_BIN}
  ZOCKET_HOME=${ZOCKET_HOME_DIR}

Default ports:
  web panel: http://127.0.0.1:${WEB_PORT}
  MCP SSE:   http://127.0.0.1:${MCP_PORT}/sse
  MCP HTTP:  http://127.0.0.1:${MCP_STREAM_PORT}/mcp

Next steps:
  1) Open web: ${ZOCKET_BIN} web --host 127.0.0.1 --port ${WEB_PORT}
  2) MCP SSE (Claude Code): ${ZOCKET_BIN} mcp --transport sse --mode ${MCP_MODE} --host 127.0.0.1 --port ${MCP_PORT}
  3) MCP Streamable (Codex): ${ZOCKET_BIN} mcp --transport streamable-http --mode ${MCP_MODE} --host 127.0.0.1 --port ${MCP_STREAM_PORT}
  4) MCP stdio: ${ZOCKET_BIN} mcp --transport stdio --mode ${MCP_MODE}
EOF
