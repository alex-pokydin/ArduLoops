import { useT } from "../i18n/i18n";

const TABS = [
  { id: "loops", label: "loops" },
  { id: "firmware", label: "controller" },
  { id: "scripts", label: "lua" },
  { id: "audit", label: "audit" },
] as const;

export type WorkspaceId = (typeof TABS)[number]["id"];

export function WorkspaceTabs({
  current,
  ids,
  onSelect,
}: {
  current: WorkspaceId;
  ids: WorkspaceId[];
  onSelect: (id: WorkspaceId) => void;
}) {
  const t = useT();
  const tabs = TABS.filter((tab) => ids.includes(tab.id));
  return (
    <div className="studio-tabs" role="tablist" aria-label={t("Workspace")}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={current === tab.id} onClick={() => onSelect(tab.id)}>
          <span>{t(tab.label)}</span>
        </button>
      ))}
    </div>
  );
}
