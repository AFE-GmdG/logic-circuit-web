const COLLAPSED_CATEGORIES_STORAGE_KEY = "logicCircuit.palette.collapsedCategories";

export type CollapsedCategoriesMap = Record<string, boolean>;

// Lädt den eingeklappten Status aller Paletten-Kategorien aus localStorage
export function loadCollapsedCategories(
  storageKey = COLLAPSED_CATEGORIES_STORAGE_KEY,
): CollapsedCategoriesMap {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: CollapsedCategoriesMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// Speichert das Kategorie-Dictionary in localStorage
export function saveCollapsedCategories(
  categories: CollapsedCategoriesMap,
  storageKey = COLLAPSED_CATEGORIES_STORAGE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(categories));
  } catch {
    // Speicherfehler (z. B. Private Mode oder Quota) still ignorieren
  }
}
