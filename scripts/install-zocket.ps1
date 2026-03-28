Param(
  [ValidateSet("Auto", "Local", "Git", "Npm")]
  [string]$Source = "Auto",
  [string]$RepoUrl = "https://github.com/aozorin/zocket.git",
  [string]$RepoRef = "main",
  [string]$ZocketHome = "$env:USERPROFILE\.zocket",
  [ValidateSet("en", "ru")]
  [string]$Lang = "en",
  [int]$WebPort = 18001,
  [int]$McpPort = 18002,
  [int]$McpStreamPort = 18003,
  [ValidateSet("metadata", "admin")]
  [string]$McpMode = "admin",
  [bool]$EnableAutostart = $true,
  [switch]$NoWeb
)

$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Ensure-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found. Install Node.js 18+ and rerun."
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Install Node.js 18+ (includes npm) and rerun."
  }
}

Ensure-Node

$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Source -eq "Auto") {
  if (Test-Path -LiteralPath (Join-Path $repoRoot "package.json")) {
    $Source = "Local"
  } else {
    $Source = "Npm"
  }
}

if ($Source -eq "Local") {
  npm i -g $repoRoot
} elseif ($Source -eq "Git") {
  npm i -g "git+$RepoUrl#$RepoRef"
} else {
  npm i -g @ao_zorin/zocket
}

$zocketBin = (Get-Command zocket).Source
if (-not $zocketBin) {
  throw "zocket binary not found after install"
}

Ensure-Dir $ZocketHome
$env:ZOCKET_HOME = $ZocketHome

& $zocketBin init | Out-Null

if ($EnableAutostart) {
  $taskName = "Zocket"
  $cmd = "\"$zocketBin\" start --host 127.0.0.1 --web-port $WebPort --mcp-port $McpPort --mcp-stream-port $McpStreamPort --mode $McpMode"
  if ($NoWeb) { $cmd = "$cmd --no-web" }
  schtasks /Create /F /SC ONLOGON /RL LIMITED /TN $taskName /TR $cmd | Out-Null
}

Write-Output "zocket installed successfully."
Write-Output "zocket: $zocketBin"
Write-Output "ZOCKET_HOME=$ZocketHome"
if ($NoWeb) {
  Write-Output "web panel: disabled"
} else {
  Write-Output "web panel: http://127.0.0.1:$WebPort"
}
Write-Output "mcp sse:   http://127.0.0.1:$McpPort/sse"
Write-Output "mcp http:  http://127.0.0.1:$McpStreamPort/mcp"
