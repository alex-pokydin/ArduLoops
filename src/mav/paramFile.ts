export type ParamRow = { name: string; value: number };

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8)));
}

function nameOk(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(name);
}

/** Mission Planner `.param` text. The last copy of a name wins. */
export function parseParamFile(text: string): ParamRow[] | string {
  const rows: ParamRow[] = [];
  const at = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.search(/[, \t]/);
    if (cut <= 0) return "This file is not a parameter backup";
    const name = line.slice(0, cut).trim();
    if (!nameOk(name)) return "This file is not a parameter backup";
    let rest = line.slice(cut + 1).trim();
    const hash = rest.indexOf(" #");
    if (hash >= 0) rest = rest.slice(0, hash).trim();
    const token = rest.split(/[, \t]/)[0] ?? "";
    const value = Number(token);
    if (!Number.isFinite(value)) return "This file is not a parameter backup";
    const seen = at.get(name);
    if (seen == null) {
      at.set(name, rows.length);
      rows.push({ name, value });
    } else {
      rows[seen] = { name, value };
    }
  }
  if (!rows.length) return "No parameters in this file";
  if (rows.length > 8000) return "Too many parameters";
  return rows;
}

export function formatParamBackup(
  meta: { board: string; vehicle: string; uid: string },
  params: Record<string, number>,
): string {
  const names = Object.keys(params).filter((name) => Number.isFinite(params[name])).sort();
  const lines = [
    "# ArduLoops full parameter backup",
    `# board: ${meta.board}`,
    `# vehicle: ${meta.vehicle}`,
    `# uid: ${meta.uid}`,
    `# count: ${names.length}`,
  ];
  for (const name of names) lines.push(`${name},${numberLabel(params[name])}`);
  return `${lines.join("\n")}\n`;
}
