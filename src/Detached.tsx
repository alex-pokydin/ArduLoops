import { useEffect, useState } from "react";
import { Assistant, DocWindow } from "./components/Assistant";
import { BoardWindow } from "./components/BoardDoc";
import { ChartWindow, type ChartSpec } from "./components/FindingCharts";
import { ImageViewerHost } from "./components/ImageViewer";
import { LiveWindow, type LiveSpec } from "./components/LivePlots";
import { useT } from "./i18n/i18n";
import { seedLastBoardDoc, setBoardWindow, type BoardDocReply, type BoardTab } from "./lib/boardDoc";
import { closeSelf, followMainWindow, onWindowMsg, postWindowMsg, readPayload, type Detached } from "./lib/detach";
import { startStream } from "./mav/store";
import { useStorePicked, VehicleView } from "./mav/view";

type BoardPayload = { tab?: BoardTab; path?: string; heading?: string; doc?: BoardDocReply | null };
type AssistantPayload = { chatId?: string };
type DocPayload = { id?: string; title: string; format: string; url: string };

/** One floating panel filling its own window (see lib/detach.ts). */
export function DetachedRoot({ initial }: { initial: Detached }) {
  const t = useT();
  const [cur, setCur] = useState(initial);
  const vehicle = useStorePicked((s) => (s.frame === "plane" ? "plane" : "copter"));
  const close = () => void closeSelf();

  useEffect(() => {
    document.documentElement.classList.add("detached-window");
    postWindowMsg({ type: "sync-req" });
    const stopStream = startStream({ passive: true });
    const stopFollow = followMainWindow();
    return () => {
      stopStream();
      stopFollow();
    };
  }, []);

  // The main window opened this kind again: it wrote a new payload under our label.
  useEffect(
    () =>
      onWindowMsg((msg) => {
        if (msg.type === "payload" && msg.label === cur.label) setCur((prev) => ({ ...prev, payload: readPayload(prev.label) }));
      }),
    [cur.label],
  );

  useEffect(() => {
    if (cur.kind !== "board") return;
    const p = (cur.payload ?? {}) as BoardPayload;
    seedLastBoardDoc(p.doc ?? null);
    setBoardWindow({ open: true, tab: p.tab ?? "readme", path: p.path ?? "", heading: p.heading ?? "" });
  }, [cur]);

  useEffect(() => {
    const title = titleOf(cur, t);
    if (title) document.title = `${title} — ArduLoops`;
  }, [cur, t]);

  if (!cur.payload) return <p className="ai-live-empty">{t("Nothing to show in this window")}</p>;

  let body = null;
  if (cur.kind === "live") body = <LiveWindow detached spec={cur.payload as LiveSpec} onClose={close} />;
  else if (cur.kind === "chart") body = <ChartWindow detached chart={cur.payload as ChartSpec} onClose={close} />;
  else if (cur.kind === "doc") {
    body = <DocWindow detached doc={cur.payload as DocPayload} onClose={close} />;
  } else if (cur.kind === "assistant") {
    const chatId = (cur.payload as AssistantPayload).chatId ?? "";
    body = (
      <>
        <Assistant key={chatId} detached initialChatId={chatId} home={false} onOpenOptions={() => {}} onOpenHome={() => {}} />
        <ImageViewerHost />
      </>
    );
  } else if (cur.kind === "board") {
    body = (
      <>
        <BoardWindow detached onClose={close} />
        <ImageViewerHost />
      </>
    );
  }
  return <VehicleView vehicle={vehicle}>{body}</VehicleView>;
}

function titleOf(cur: Detached, t: (key: string) => string): string {
  const p = cur.payload as Record<string, unknown> | null;
  if (cur.kind === "live") return t("Live lines");
  if (cur.kind === "assistant") return t("Assistant");
  if (cur.kind === "chart") return typeof p?.title === "string" ? p.title : "";
  if (cur.kind === "doc") return typeof p?.title === "string" ? p.title : t("Document");
  const doc = p?.doc as BoardDocReply | null | undefined;
  return doc?.board || t("Board doc");
}
