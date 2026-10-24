import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDocumentLang } from "./i18n/i18n";
import "./styles.css";

applyDocumentLang();

function syncMobileClasses() {
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isMobile =
    isAndroid ||
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);
  document.documentElement.classList.toggle("android", isAndroid);
  document.body.classList.toggle("android", isAndroid);
  document.documentElement.classList.toggle("mobile", isMobile);
  document.body.classList.toggle("mobile", isMobile);
}

syncMobileClasses();
if (typeof window !== "undefined") {
  window.addEventListener("resize", syncMobileClasses);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
