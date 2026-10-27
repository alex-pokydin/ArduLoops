/** Fired by the header's Pre-arm tile: the Controller opens Setup on its Overview. */
export const OPEN_SETUP_OVERVIEW = "arduloops:setup-overview";

export function openSetupOverview(): void {
  window.dispatchEvent(new Event(OPEN_SETUP_OVERVIEW));
}
