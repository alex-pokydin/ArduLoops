import type { Gain, NodeDef } from "../lib/gains";
import { useT } from "../i18n/i18n";
import type { Axis } from "../mav/axis";
import { useViewSample } from "../mav/view";
import { GainRow } from "./GainRow";

export function loopCls(compact?: boolean, embed?: boolean): string {
  if (compact) return "loop compact";
  if (embed) return "loop embed";
  return "loop";
}

export function namedGains(pools: Array<Iterable<Gain>>, keys: string[]): Gain[] {
  const all = pools.flatMap((p) => [...p]);
  const out: Gain[] = [];
  for (const k of keys) {
    const g = all.find((x) => x.key === k);
    if (g) out.push(g);
  }
  return out;
}

export function schemeHit(
  id: string,
  pick: string | null,
  setPick: (id: string | null) => void,
): { picked: boolean; onPick: () => void } {
  return {
    picked: pick === id,
    onPick: () => setPick(pick === id ? null : id),
  };
}

export function SchemeKnobs({
  node,
  axis = "roll",
  gains,
  picked,
  quiet,
}: {
  node: NodeDef;
  axis?: Axis;
  gains: Gain[];
  picked: string | null;
  quiet?: boolean;
}) {
  const t = useT();
  const s = useViewSample();
  const main = new Set(node.gains.map((g) => g.key));
  const extra = gains.filter((g) => !main.has(g.key));
  if (!picked) {
    return <p className="loop-note">{t("Pick a block — extra knobs sit under the scheme.")}</p>;
  }
  if (!extra.length) {
    return quiet ? null : <p className="loop-note">{t("This block has no extra knobs.")}</p>;
  }
  return (
    <div className="loop-xgain">
      {extra.map((g) => (
        <GainRow key={g.key} gain={g} sample={s} node={node} axis={axis} />
      ))}
    </div>
  );
}

export function SchemeDoc({
  lines,
  href,
  wiki,
}: {
  lines: string[];
  href?: string;
  wiki?: string;
}) {
  const t = useT();
  return (
    <div className="loop-doc">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {href && wiki ? (
        <p>
          <a href={href} target="_blank" rel="noreferrer">
            {t("Wiki")}: {wiki}
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function SchemeKey() {
  const t = useT();
  return (
    <div className="cmap-key" aria-hidden="true">
      <span className="k-tune">{t("tuning")}</span>
      <span className="k-later">{t("sometimes")}</span>
      <span className="k-struct">{t("without knobs")}</span>
    </div>
  );
}
