export const CLEANUP_VISUALIZATION_STORAGE_KEY = "logicCircuit.view.cleanUpVisualization";

// Lädt den Aktivierungszustand der CleanUp-Visualisierung im Editiermodus aus localStorage
export function loadCleanUpVisualizationEnabled(
  storageKey = CLEANUP_VISUALIZATION_STORAGE_KEY,
): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

// Speichert den Aktivierungszustand der CleanUp-Visualisierung im Editiermodus in localStorage
export function saveCleanUpVisualizationEnabled(
  enabled: boolean,
  storageKey = CLEANUP_VISUALIZATION_STORAGE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, enabled ? "true" : "false");
  } catch {
    // Speicherfehler still ignorieren
  }
}
