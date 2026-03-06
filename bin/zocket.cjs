#!/usr/bin/env node

const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";
const args = process.argv.slice(2);
const pkgRoot = path.resolve(__dirname, "..");
const launcherVersion = "1.0.0";

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function run(cmd, cmdArgs, opts = {}) {
  const res = cp.spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  return res.status === null ? 1 : res.status;
}

function probe(cmd, cmdArgs) {
  const res = cp.spawnSync(cmd, cmdArgs, {
    stdio: "ignore",
    env: process.env,
  });
  return res.status === 0;
}

function findPython() {
  const candidates = isWin
    ? [
        { cmd: "py", prefix: ["-3"] },
        { cmd: "python", prefix: [] },
        { cmd: "python3", prefix: [] },
      ]
    : [
        { cmd: "python3", prefix: [] },
        { cmd: "python", prefix: [] },
      ];

  for (const item of candidates) {
    const ok = probe(item.cmd, [...item.prefix, "-c", "import sys;sys.exit(0)"]);
    if (ok) {
      return item;
    }
  }
  return null;
}

function installRoot() {
  if (isWin) {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "zocket");
  }
  return path.join(os.homedir(), ".local", "share", "zocket");
}

function venvPython(venvDir) {
  return isWin
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");
}

function removeIfExists(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function prepareInstallSource(rootDir) {
  const sourceDir = path.join(rootDir, "npm-install-source");
  removeIfExists(sourceDir);
  fs.mkdirSync(sourceDir, { recursive: true });

  const filesToCopy = ["pyproject.toml", "README.md", "zocket"];
  for (const item of filesToCopy) {
    const src = path.join(pkgRoot, item);
    if (!fs.existsSync(src)) {
      continue;
    }
    const dst = path.join(sourceDir, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  return sourceDir;
}

function ensureVenv() {
  const root = installRoot();
  const venvDir = path.join(root, "venv");
  const marker = path.join(root, "npm-launcher-version.txt");
  const pyBin = venvPython(venvDir);
  let needInstall = !fs.existsSync(pyBin);

  if (!needInstall && fs.existsSync(marker)) {
    const current = fs.readFileSync(marker, "utf-8").trim();
    if (current !== launcherVersion) {
      needInstall = true;
    }
  }

  if (!needInstall) {
    const healthy = probe(pyBin, ["-c", "import zocket, cryptography"]);
    if (!healthy) {
      needInstall = true;
    }
  }

  if (!needInstall) {
    return pyBin;
  }

  const py = findPython();
  if (!py) {
    fail(
      [
        "Python 3.10+ was not found.",
        "Install Python first, then rerun:",
        "  zocket setup",
      ].join("\n")
    );
  }

  fs.mkdirSync(root, { recursive: true });
  let code = run(py.cmd, [...py.prefix, "-m", "venv", venvDir]);
  if (code !== 0) {
    fail("Failed to create virtual environment for zocket.");
  }

  code = run(pyBin, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]);
  if (code !== 0) {
    fail("Failed to bootstrap pip in zocket virtual environment.");
  }

  // Install from a writable user-owned source copy to avoid permission issues.
  const sourceDir = prepareInstallSource(root);
  code = run(pyBin, ["-m", "pip", "install", sourceDir]);
  if (code !== 0) {
    fail("Failed to install zocket Python package from npm bundle.");
  }

  fs.writeFileSync(marker, `${launcherVersion}\n`, "utf-8");
  return pyBin;
}

if (args[0] === "setup") {
  ensureVenv();
  process.stdout.write("zocket runtime is installed.\n");
  process.exit(0);
}

if (args[0] === "doctor") {
  const py = findPython();
  const root = installRoot();
  const pyBin = venvPython(path.join(root, "venv"));
  process.stdout.write(`python_found=${py ? "yes" : "no"}\n`);
  process.stdout.write(`venv_python=${pyBin}\n`);
  process.stdout.write(`venv_exists=${fs.existsSync(pyBin) ? "yes" : "no"}\n`);
  process.exit(0);
}

const runtimePython = ensureVenv();
const code = run(runtimePython, ["-m", "zocket", ...args]);
process.exit(code);
