import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import startEn from "../../docs/start.md?raw";
import startUk from "../../docs/start.uk.md?raw";
import cascadePng from "../../docs/cascade.png";
import plotPng from "../../docs/plot.png";
import { useLang, useT } from "../i18n/i18n";

const REMARK = [remarkGfm];

const DOC_IMG: Record<string, string> = {
  "plot.png": plotPng,
  "cascade.png": cascadePng,
};

function docUrl(url: string): string {
  const name = url.replace(/^\.\//, "").split(/[?#]/)[0]?.split("/").pop() ?? url;
  return DOC_IMG[name] ?? url;
}

const MD: Components = {
  a({ href, children }) {
    const ext = !!href && /^https?:/i.test(href);
    return (
      <a href={href} {...(ext ? { target: "_blank", rel: "noreferrer" } : null)}>
        {children}
      </a>
    );
  },
};

export function Disconnected() {
  const t = useT();
  const lang = useLang();
  return (
    <main className="land-main">
      <article className="land">
        <p className="land-kicker">{t("No vehicle yet")}</p>
        <Markdown remarkPlugins={REMARK} urlTransform={docUrl} components={MD}>
          {lang === "uk" ? startUk : startEn}
        </Markdown>
      </article>
    </main>
  );
}
