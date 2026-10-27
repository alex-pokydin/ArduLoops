import { send } from "./cmd";
import { formatParamBackup } from "./paramFile";
import { getSnapshot } from "./store";

export type BackupResult = { saved: true; count: number } | { saved: false };

/**
 * Save the full parameter set as a `.param` file. When the list is not complete yet,
 * ask the vehicle for it again and save nothing: a partial backup is the wrong file to restore.
 */
export function downloadParamBackup(): BackupResult {
  const live = getSnapshot();
  const count = live.param_count ?? 0;
  const params = live.params ?? {};
  const received = Object.keys(params).filter((name) => Number.isFinite(params[name])).length;
  if (!live.ok || count === 0 || received < count) {
    send({ op: "params_list" });
    return { saved: false };
  }
  const board = live.board_name || "board";
  const text = formatParamBackup({ board, vehicle: live.frame || "vehicle", uid: live.boot_uid || "" }, params);
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const safeBoard = board.replace(/[^\w.-]+/g, "_");
  const uid = (live.boot_uid || "").slice(0, 8);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const linkEl = document.createElement("a");
  linkEl.href = url;
  linkEl.download = `${safeBoard}${uid ? `-${uid}` : ""}-${day}.param`;
  linkEl.click();
  URL.revokeObjectURL(url);
  return { saved: true, count: received };
}
