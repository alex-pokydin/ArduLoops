/** What a wizard reports when the user finishes it or closes it. */
export type WizardClose = {
  outcome: "completed" | "cancelled" | "failed";
  measures: Record<string, number | string | null>;
};

export function paramNum(params: Record<string, number> | undefined, name: string): number | null {
  const value = params?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
