import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_VITE_PORT = 4173;
const DEFAULT_API_HOST = "127.0.0.1";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(scriptDir, "..");
const skillRoot = path.resolve(uiRoot, "..");
const viteBin = path.resolve(uiRoot, "node_modules", "vite", "bin", "vite.js");
const backendEntry = path.resolve(skillRoot, "src", "server", "index.ts");

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const vitePort = readOption(rawArgs, ["--port", "-p"], String(DEFAULT_VITE_PORT));
const apiPort = readOption(rawArgs, ["--api-port"], String(Number(vitePort) + 1));
const artifactsRoot = readOption(rawArgs, ["--artifacts-root"], "/tmp/claude-delegate-runs");
const viteArgs = stripOptions(rawArgs, ["--api-port", "--artifacts-root"]);

const backend = spawn(
  process.execPath,
  [
    "--import", "tsx/esm",
    backendEntry,
    "--api-only",
    "--host",
    DEFAULT_API_HOST,
    "--port",
    apiPort,
    "--artifacts-root",
    artifactsRoot,
  ],
  {
    cwd: skillRoot,
    env: process.env,
    stdio: "inherit",
  },
);

const vite = spawn(
  process.execPath,
  [viteBin, ...viteArgs],
  {
    cwd: uiRoot,
    env: {
      ...process.env,
      CLAUDE_DELEGATE_API_ORIGIN: `http://${DEFAULT_API_HOST}:${apiPort}`,
    },
    stdio: "inherit",
  },
);

let exiting = false;
let exitsRemaining = 2;

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}

attachChild(backend);
attachChild(vite);

function attachChild(child) {
  child.on("exit", (code, signal) => {
    exitsRemaining -= 1;
    if (exiting) {
      if (exitsRemaining <= 0) {
        process.exit(0);
      }
      return;
    }
    exiting = true;
    const stopSignal = signal || "SIGTERM";
    if (backend.pid && backend.exitCode === null) {
      backend.kill(stopSignal);
    }
    if (vite.pid && vite.exitCode === null) {
      vite.kill(stopSignal);
    }
    process.exit(code ?? 1);
  });
}

function shutdown(signal) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (backend.pid && backend.exitCode === null) {
    backend.kill(signal);
  }
  if (vite.pid && vite.exitCode === null) {
    vite.kill(signal);
  }
}

function readOption(args, names, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    const value = optionValue(args, names, index);
    if (value != null) {
      return value;
    }
  }
  return fallback;
}

function optionValue(args, names, index) {
  const current = args[index];
  for (const name of names) {
    if (current === name) {
      return args[index + 1] ?? null;
    }
    if (current.startsWith(`${name}=`)) {
      return current.slice(name.length + 1);
    }
  }
  return null;
}

function stripOptions(args, names) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const matched = names.find((name) => current === name || current.startsWith(`${name}=`));
    if (!matched) {
      next.push(current);
      continue;
    }
    if (current === matched) {
      index += 1;
    }
  }
  return next;
}
