import { useEffect, useRef, useState } from "react";
import type { Gain, NodeDef } from "../cascade";
import { addLog } from "../log";
import { gainKeysForAxis, remapGainKey, type Axis } from "../mav/axis";
import { send } from "../mav/cmd";
import type { Sample } from "../mav/types";

export function paramOf(s: Sample, key: string): number | null {
  if (s.params && s.params[key] != null) return s.params[key];
  if (key === "ATC_RAT_RLL_P") return s.gain_p;
  if (key === "ATC_RAT_RLL_I") return s.gain_i;
  if (key === "ATC_RAT_RLL_D") return s.gain_d;
  if (key === "ATC_INPUT_TC") return s.input_tc;
  if (key === "ATC_ACC_R_MAX") return s.acc_max;
  if (key === "ATC_RATE_R_MAX") return s.rate_max;
  return null;
}

export function fmtGain(g: Gain, v: number, name = g.key): string {
  if ((name === "ATC_RATE_R_MAX" || name === "ATC_RATE_P_MAX" || name === "ATC_RATE_Y_MAX") && v <= 0) return "off";
  return v.toFixed(g.digits);
}

export function paramNames(g: Gain): string[] {
  return [g.key, ...(g.aliases || [])];
}

export function GainRow({
  gain,
  sample,
  node,
  axis = "roll",
}: {
  gain: Gain;
  sample: Sample;
  node: NodeDef;
  axis?: Axis;
}) {
  const readKey = remapGainKey(gain.key, axis);
  const writeKeys = gainKeysForAxis(gain, axis);
  const remote = paramOf(sample, readKey);
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const timer = useRef(0);
  const shown = dragging.current && local != null ? local : (local ?? remote ?? Number(gain.min));

  useEffect(() => {
    if (!dragging.current && remote != null) setLocal(remote);
  }, [remote]);

  function push(v: number, logIt: boolean) {
    setLocal(v);
    const fire = () => {
      if (gain.tune && axis !== "yaw") {
        const p = gain.tune === "p" ? v : paramOf(sample, "ATC_RAT_RLL_P") ?? 0.135;
        const i = gain.tune === "i" ? v : paramOf(sample, "ATC_RAT_RLL_I") ?? 0.135;
        const d = gain.tune === "d" ? v : paramOf(sample, "ATC_RAT_RLL_D") ?? 0.0036;
        send({ op: "tune", p, i, d });
        if (logIt) addLog(`P ${p.toFixed(3)}  I ${i.toFixed(3)}  D ${d.toFixed(4)}`, "cmd");
        return;
      }
      if (gain.tune && axis === "yaw") {
        const p = gain.tune === "p" ? v : paramOf(sample, "ATC_RAT_YAW_P") ?? 0.18;
        const i = gain.tune === "i" ? v : paramOf(sample, "ATC_RAT_YAW_I") ?? 0.018;
        const d = gain.tune === "d" ? v : paramOf(sample, "ATC_RAT_YAW_D") ?? 0;
        send({ op: "param", name: "ATC_RAT_YAW_P", value: p });
        send({ op: "param", name: "ATC_RAT_YAW_I", value: i });
        send({ op: "param", name: "ATC_RAT_YAW_D", value: d });
        if (logIt) addLog(`YAW P ${p.toFixed(3)}  I ${i.toFixed(3)}  D ${d.toFixed(4)}`, "cmd");
        return;
      }
      for (const name of writeKeys) send({ op: "param", name, value: v });
      if (logIt) addLog(`${readKey} ${fmtGain(gain, v, readKey)}`, "cmd");
    };
    if (logIt) {
      window.clearTimeout(timer.current);
      fire();
    } else {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(fire, 70);
    }
  }

  return (
    <div className="srow wide">
      <span>{gain.label}</span>
      <input
        type="range"
        min={gain.min}
        max={gain.max}
        step={gain.step}
        value={shown}
        title={`${readKey} · ${node.param}`}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(ev) => {
          dragging.current = false;
          push(Number((ev.currentTarget as HTMLInputElement).value), true);
        }}
        onInput={(ev) => {
          const v = Number((ev.target as HTMLInputElement).value);
          dragging.current = true;
          push(v, false);
        }}
      />
      <b>{fmtGain(gain, shown, readKey)}</b>
    </div>
  );
}
