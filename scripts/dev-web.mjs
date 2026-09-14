import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoToml = join(root, "src-tauri", "Cargo.toml");
const cargoBin = join(homedir(), ".cargo", "bin");
const cargoExe = join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
if (existsSync(cargoExe)) {
  process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ""}`;
}

function bridgeBin() {
  const toml = readFileSync(cargoToml, "utf8");
  const m = toml.match(/\[\[bin\]\]\s*name\s*=\s*"([^"]+)"/);
  return m?.[1] ?? "arduloops-bridge";
}

function bridgeArgs() {
  return [
    "run",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--bin",
    bridgeBin(),
    "--no-default-features",
  ];
}

let stopping = false;
let viteProc = null;
let bridgeProc = null;
let bridgeGen = 0;
let restartTimer = 0;

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function startVite() {
  viteProc = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js")], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  viteProc.on("exit", (code) => {
    if (stopping) return;
    stopping = true;
    killTree(bridgeProc);
    process.exit(code ?? 1);
  });
}

function startBridge() {
  const gen = ++bridgeGen;
  console.log("bridge: cargo run (watch src-tauri)");
  const child = spawn(cargoExe, bridgeArgs(), {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  bridgeProc = child;
  child.on("exit", (code) => {
    if (stopping || gen !== bridgeGen) return;
    bridgeProc = null;
    if (code) {
      console.log(`bridge exited (${code}). waiting for src-tauri change…`);
    }
  });
}

function restartBridge() {
  const gen = ++bridgeGen;
  const old = bridgeProc;
  bridgeProc = null;
  const launch = () => {
    if (stopping || gen !== bridgeGen) return;
    startBridge();
  };
  if (old?.pid) {
    old.once("exit", launch);
    killTree(old);
    setTimeout(launch, 2500);
  } else {
    launch();
  }
}

function scheduleBridgeRestart(reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`bridge: reload (${reason})`);
    restartBridge();
  }, 400);
}

function shouldReload(filename) {
  if (!filename) return false;
  const n = filename.replaceAll("\\", "/");
  if (n.includes("/target/") || n.startsWith("target/") || n.includes("/gen/")) return false;
  return /\.(rs|toml)$/.test(n);
}

function onStop() {
  stopping = true;
  clearTimeout(restartTimer);
  killTree(bridgeProc);
  killTree(viteProc);
  process.exit(0);
}
process.on("SIGINT", onStop);
process.on("SIGTERM", onStop);

if (!existsSync(cargoExe)) {
  console.error("cargo not found. Install rustup (https://rustup.rs).");
  process.exit(1);
}

console.log("ArduLoops  http://127.0.0.1:5173  (Vite HMR + Rust watch)");
startBridge();
startVite();

const tauriDir = join(root, "src-tauri");
watch(tauriDir, { recursive: true }, (_event, filename) => {
  if (stopping || !shouldReload(filename ?? "")) return;
  scheduleBridgeRestart(filename);
});
