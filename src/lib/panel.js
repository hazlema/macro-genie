// Phones: the macro panel starts open for someone who hasn't used it yet and
// has nothing set, so new visitors see where the numbers go. Once they close
// it (or tap Done) it stays closed on later visits.
const KEY = "macro-genie:macro-panel-used:v1";

export function panelStartsOpen(
  activeCount,
  storage = globalThis.localStorage,
) {
  try {
    return activeCount === 0 && !storage?.getItem(KEY);
  } catch {
    return activeCount === 0;
  }
}

export function rememberPanelUsed(storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, "1");
  } catch {
    // No storage: the panel just opens again next visit.
  }
}

// Close the panel and bring the results into view.
export function showResults(id = "results") {
  rememberPanelUsed();
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}
