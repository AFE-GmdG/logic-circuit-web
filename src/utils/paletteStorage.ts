const COLLAPSED_CATEGORIES_STORAGE_KEY = "logicCircuit.palette.collapsedCategories";

// Sprachunabhängige i18n-Schlüssel der festen System-Kategorien in der Bauteil-Palette
export const SYSTEM_PALETTE_CATEGORY_KEYS = {
  projectCircuits: "palette.categories.projectCircuits",
  io: "palette.categories.io",
  displays: "palette.categories.displays",
  gates: "palette.categories.gates",
  decoration: "palette.categories.decoration",
} as const;

// Erzeugt einen eigenen Namespace-Key für benutzerdefinierte Schaltungs-Kategorien
export function getCustomPaletteCategoryKey(categoryName: string): string {
  return `custom:${categoryName}`;
}

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
