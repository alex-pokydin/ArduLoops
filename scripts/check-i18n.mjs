import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const ukSrc = readFileSync(join(root, "i18n", "uk.ts"), "utf8");
const ukKeys = new Set();
{
  const re = /(?:^|\n)\s*(?:(\w+)|"((?:\\.|[^"\\])*)")\s*:/g;
  let m;
  while ((m = re.exec(ukSrc))) ukKeys.add(m[1] || m[2].replace(/\\"/g, '"'));
}

const used = new Set();
const tRe = /\bt\(\s*"((?:\\.|[^"\\])*)"/g;
for (const file of walk(root)) {
  if (file.replace(/\\/g, "/").endsWith("i18n/uk.ts")) continue;
  const src = readFileSync(file, "utf8");
  tRe.lastIndex = 0;
  let m;
  while ((m = tRe.exec(src))) used.add(m[1].replace(/\\"/g, '"'));
}

for (const rel of ["cascade.ts", "mav/axis.ts"]) {
  const src = readFileSync(join(root, rel), "utf8");
  const re = /(?:title|kind|unit|does|name|rateName):\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(src))) used.add(m[1]);
}
{
  const src = readFileSync(join(root, "cascade.ts"), "utf8");
  const re = /(?:EDGES|LAYERS|BAND_LABEL)[\s\S]*?;/g;
  const blocks = src.match(re) || [];
  const lab = /label:\s*"((?:\\.|[^"\\])*)"/g;
  for (const block of blocks) {
    lab.lastIndex = 0;
    let m;
    while ((m = lab.exec(block))) used.add(m[1]);
  }
  for (const m of src.matchAll(/ends:\s*"((?:\\.|[^"\\])*)"|outer:\s*"((?:\\.|[^"\\])*)"|inner:\s*"((?:\\.|[^"\\])*)"/g)) {
    used.add(m[1] || m[2] || m[3]);
  }
}

const missing = [...used].filter((k) => !ukKeys.has(k)).sort();
const unused = [...ukKeys].filter((k) => !used.has(k)).sort();

if (missing.length) {
  console.log("Missing uk keys (" + missing.length + "):");
  for (const k of missing) console.log("  - " + JSON.stringify(k));
} else {
  console.log("All " + used.size + " used keys exist in uk.ts");
}
if (unused.length) {
  console.log("Unused uk keys (" + unused.length + ", ok if used dynamically):");
  for (const k of unused) console.log("  ~ " + JSON.stringify(k));
}
process.exit(missing.length ? 1 : 0);
