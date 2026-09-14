import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const require = createRequire(import.meta.url);
const cargoBin = join(homedir(), ".cargo", "bin");
const cargoExe = join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
if (existsSync(cargoExe)) {
  process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ""}`;
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/with-cargo.mjs <command>...");
  process.exit(1);
}

const [cmd, ...rest] = args;
let bin;
let binArgs = rest;
if (cmd === "tauri") {
  bin = process.execPath;
  binArgs = [require.resolve("@tauri-apps/cli/tauri.js"), ...rest];
} else if (cmd === "cargo") {
  bin = cargoExe;
} else {
  bin = cmd;
}

const child = spawn(bin, binArgs, { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
