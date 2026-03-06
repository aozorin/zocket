#!/usr/bin/env node

const cp = require("child_process");
const path = require("path");

const launcher = path.resolve(__dirname, "zocket.cjs");
const res = cp.spawnSync(process.execPath, [launcher, "setup"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(res.status === null ? 1 : res.status);
