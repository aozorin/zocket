Param(
  [ValidateSet("Auto", "Local", "Git", "PyPI")]
  [string]$Source = "Auto",
  [string]$RepoUrl = "https://github.com/your-org/zocket.git",
  [string]$RepoRef = "main",
  [string]$InstallRoot = "$env:LOCALAPPDATA\zocket",
  [string]$ZocketHome = "$env:USERPROFILE\.zocket",
  [ValidateSet("en", "ru")]
  [string]$Lang = "en",
  [int]$WebPort = 18001,
  [int]$McpPort = 18002,
  [int]$McpStreamPort = 18003,
  [ValidateSet("metadata", "admin")]
  [string]$McpMode = "metadata",
  [bool]$EnableAutostart = $true
)

$ErrorActionPreference = "Stop"

function Resolve-Python {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return @{Cmd = "py"; Prefix = @("-3")}
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{Cmd = "python"; Prefix = @()}
  }
  throw "Python 3.10+ not found. Install Python and rerun."
}

function Run-Step([string]$Cmd, [string[]]$Args) {
  & $Cmd @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Cmd $($Args -join ' ')"
  }
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Source -eq "Auto") {
  if (Test-Path -LiteralPath (Join-Path $repoRoot "pyproject.toml")) {
    $Source = "Local"
  } else {
    $Source = "Git"
  }
}

Ensure-Dir $InstallRoot
$srcDir = Join-Path $InstallRoot "src"

$pkgSource = $null
if ($Source -eq "Local") {
  $pkgSource = $repoRoot
} elseif ($Source -eq "Git") {
  if (Test-Path -LiteralPath (Join-Path $srcDir ".git")) {
    Run-Step "git" @("-C", $srcDir, "fetch", "--all", "--tags")
    Run-Step "git" @("-C", $srcDir, "checkout", $RepoRef)
    Run-Step "git" @("-C", $srcDir, "pull", "--ff-only")
  } else {
    if (Test-Path -LiteralPath $srcDir) {
      Remove-Item -LiteralPath $srcDir -Recurse -Force
    }
    Run-Step "git" @("clone", "--depth", "1", "--branch", $RepoRef, $RepoUrl, $srcDir)
  }
  $pkgSource = $srcDir
} else {
  $pkgSource = "zocket"
}

$py = Resolve-Python
$venvDir = Join-Path $InstallRoot "venv"
$venvPy = Join-Path $venvDir "Scripts\python.exe"
$zocketExe = Join-Path $venvDir "Scripts\zocket.exe"

Run-Step $py.Cmd ($py.Prefix + @("-m", "venv", $venvDir))
Run-Step $venvPy @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")

if ($Source -eq "PyPI") {
  Run-Step $venvPy @("-m", "pip", "install", "--upgrade", $pkgSource)
} else {
  Run-Step $venvPy @("-m", "pip", "install", "--upgrade", $pkgSource)
}

Ensure-Dir $ZocketHome
$env:ZOCKET_HOME = $ZocketHome

if (-not (Test-Path -LiteralPath (Join-Path $ZocketHome "vault.enc"))) {
  Run-Step $zocketExe @("init")
}
Run-Step $zocketExe @("config", "set-language", $Lang)

if ($EnableAutostart) {
  $webTask = "ZocketWeb"
  $mcpSseTask = "ZocketMcpSse"
  $mcpStreamTask = "ZocketMcpStreamable"

  $webCmd = "`"$venvPy`" -m zocket web --host 127.0.0.1 --port $WebPort"
  $mcpSseCmd = "`"$venvPy`" -m zocket mcp --transport sse --mode $McpMode --host 127.0.0.1 --port $McpPort"
  $mcpStreamCmd = "`"$venvPy`" -m zocket mcp --transport streamable-http --mode $McpMode --host 127.0.0.1 --port $McpStreamPort"

  schtasks /Create /F /SC ONLOGON /RL LIMITED /TN $webTask /TR $webCmd | Out-Null
  schtasks /Create /F /SC ONLOGON /RL LIMITED /TN $mcpSseTask /TR $mcpSseCmd | Out-Null
  schtasks /Create /F /SC ONLOGON /RL LIMITED /TN $mcpStreamTask /TR $mcpStreamCmd | Out-Null
}

Write-Output "zocket installed successfully."
Write-Output "venv: $venvDir"
Write-Output "zocket: $zocketExe"
Write-Output "ZOCKET_HOME=$ZocketHome"
Write-Output "web panel: http://127.0.0.1:$WebPort"
Write-Output "mcp sse:   http://127.0.0.1:$McpPort/sse"
Write-Output "mcp http:  http://127.0.0.1:$McpStreamPort/mcp"
