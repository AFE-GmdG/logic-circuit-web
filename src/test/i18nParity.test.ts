import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import i18next from "i18next";
import { afterEach, describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import i18n, {
  AUTO_LANGUAGE,
  AVAILABLE_LANGUAGES,
  DEFAULT_LANGUAGE,
  detectBrowserLanguage,
  getLocaleNativeName,
  normalizeSupportedLanguage,
  resolveEffectiveLanguage,
} from "../i18n";
import { APP_SETTINGS_STORAGE_KEY, loadAppSettings } from "../utils/appSettingsStorage";
import { createEmptyCircuitProject } from "../utils/circuitLayout";
import {
  COMPONENT_PALETTE_CATEGORIES,
  getAllowedComponentTypes,
  getPaletteGateItems,
  getTextNotePaletteLabelKey,
} from "../utils/componentCatalog";

import OptionsDialog from "../components/app/optionsDialog";
import ComponentPalette from "../components/componentPalette";

import deCatalog from "../locales/de.json";
import enCatalog from "../locales/en.json";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(TEST_DIR, "..");
const LOCALES_DIR = path.resolve(SRC_ROOT, "locales");

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
const PLURAL_KEY_PATTERN = /^(.+)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

type FlattenedCatalog = {
  leaves: Record<string, string>;
  objectPaths: Set<string>;
  errors: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenCatalog(catalog: unknown, prefix = ""): FlattenedCatalog {
  const leaves: Record<string, string> = {};
  const objectPaths = new Set<string>();
  const errors: string[] = [];

  if (!isPlainRecord(catalog)) {
    errors.push(`Root node ${prefix || "<root>"} must be a plain JSON object.`);
    return { leaves, objectPaths, errors };
  }

  const visit = (node: Record<string, unknown>, currentPath: string) => {
    for (const [key, value] of Object.entries(node)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (isPlainRecord(value)) {
        objectPaths.add(nextPath);
        visit(value, nextPath);
      } else if (typeof value === "string") {
        if (value.trim().length === 0) {
          errors.push(`Empty translation string at "${nextPath}".`);
        }
        const stripped = value.replace(PLACEHOLDER_PATTERN, "");
        if (stripped.includes("{{") || stripped.includes("}}")) {
          errors.push(`Malformed interpolation delimiter at "${nextPath}": ${value}`);
        }
        leaves[nextPath] = value;
      } else {
        errors.push(`Invalid non-string/non-object value at "${nextPath}".`);
      }
    }
  };

  visit(catalog, prefix);
  return { leaves, objectPaths, errors };
}

function extractPlaceholders(template: string): string[] {
  const names = new Set<string>();
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, "g");
  let match = pattern.exec(template);
  while (match) {
    names.add(match[1]);
    match = pattern.exec(template);
  }
  return Array.from(names).sort();
}

function getAllowedPluralSuffixes(localeCode: string): Set<string> {
  const rules = new Intl.PluralRules(localeCode);
  return new Set<string>([...rules.resolvedOptions().pluralCategories, "zero"]);
}

function validateLocaleAgainstMaster(
  localeCode: string,
  candidateCatalog: unknown,
  masterCatalog: unknown,
): string[] {
  const master = flattenCatalog(masterCatalog);
  const candidate = flattenCatalog(candidateCatalog);
  const errors: string[] = [...candidate.errors];

  for (const objPath of candidate.objectPaths) {
    if (Object.hasOwn(master.leaves, objPath)) {
      errors.push(`"${objPath}" is an object in "${localeCode}" but a string in "en".`);
    }
  }

  for (const [leafPath, leafValue] of Object.entries(candidate.leaves)) {
    if (master.objectPaths.has(leafPath)) {
      errors.push(`"${leafPath}" is a string in "${localeCode}" but an object in "en".`);
      continue;
    }

    const pluralMatch = leafPath.match(PLURAL_KEY_PATTERN);
    if (pluralMatch) {
      const baseKey = pluralMatch[1];
      const suffix = pluralMatch[2];
      const englishOtherKey = `${baseKey}_other`;
      if (Object.hasOwn(master.leaves, englishOtherKey)) {
        const allowedSuffixes = getAllowedPluralSuffixes(localeCode);
        if (!allowedSuffixes.has(suffix)) {
          errors.push(`Plural suffix "_${suffix}" at "${leafPath}" is not valid for locale "${localeCode}".`);
          continue;
        }

        const allowedVars = new Set<string>(["count"]);
        for (const enSuffix of PLURAL_SUFFIXES) {
          const enKey = `${baseKey}_${enSuffix}`;
          if (Object.hasOwn(master.leaves, enKey)) {
            for (const name of extractPlaceholders(master.leaves[enKey])) {
              allowedVars.add(name);
            }
          }
        }

        const actualVars = new Set<string>(extractPlaceholders(leafValue));
        for (const actualVar of actualVars) {
          if (!allowedVars.has(actualVar)) {
            errors.push(`Unexpected placeholder "{{${actualVar}}}" at "${leafPath}" in "${localeCode}".`);
          }
        }
        for (const requiredVar of extractPlaceholders(master.leaves[englishOtherKey])) {
          if (requiredVar !== "count" && !actualVars.has(requiredVar)) {
            errors.push(`Missing placeholder "{{${requiredVar}}}" at "${leafPath}" in "${localeCode}".`);
          }
        }
        continue;
      }
    }

    if (Object.hasOwn(master.leaves, leafPath)) {
      const expectedVars = extractPlaceholders(master.leaves[leafPath]);
      const actualVars = extractPlaceholders(leafValue);
      if (JSON.stringify(actualVars) !== JSON.stringify(expectedVars)) {
        errors.push(
          `Placeholder mismatch at "${leafPath}" in "${localeCode}": ` +
          `expected [${expectedVars.join(", ")}], got [${actualVars.join(", ")}].`,
        );
      }
      continue;
    }

    errors.push(`Unknown key "${leafPath}" in "${localeCode}" is missing from master catalog "en".`);
  }

  return errors;
}

function collectSourceTranslationKeys(dir: string): string[] {
  const keys = new Set<string>();
  const callPattern = /(?:^|[^A-Za-z0-9_$.])(?:i18n\.)?t\(\s*["']([a-zA-Z0-9_.-]+)["']/g;

  const walk = (currentDir: string) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "node_modules") {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        const source = readFileSync(fullPath, "utf8");
        const pattern = new RegExp(callPattern.source, "g");
        let match = pattern.exec(source);
        while (match) {
          keys.add(match[1]);
          match = pattern.exec(source);
        }
      }
    }
  };

  walk(dir);
  return Array.from(keys).sort();
}

const ContextProbe: React.FC<{
  onContext: (ctx: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const ctx = React.useContext(CircuitContext);
  onContext(ctx);
  return null;
};

const noop = () => undefined;

describe("T-062: i18n-Setup, Community-Katalog-Validierung, Sprachpersistenz & Pluralisierung", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }
  });

  function installMockLocalStorage(): Map<string, string> {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    (globalThis as { window?: Window & typeof globalThis }).window = {
      localStorage: mockStorage,
    } as unknown as Window & typeof globalThis;

    return store;
  }

  it("validiert den führenden englischen Katalog vollständig gegen Code-Keys, Paletten-Registry und Pluralpaare", () => {
    const enFlat = flattenCatalog(enCatalog);
    expect(enFlat.errors).toEqual([]);

    // Jede in en.json definierte Pluralbasis muss sowohl _one als auch _other besitzen
    const pluralBases = new Set<string>();
    for (const leafKey of Object.keys(enFlat.leaves)) {
      const match = leafKey.match(PLURAL_KEY_PATTERN);
      if (match) {
        pluralBases.add(match[1]);
      }
    }
    expect(pluralBases.size).toBeGreaterThan(0);
    for (const base of pluralBases) {
      expect(Object.hasOwn(enFlat.leaves, `${base}_one`)).toBe(true);
      expect(Object.hasOwn(enFlat.leaves, `${base}_other`)).toBe(true);
    }

    // Alle statischen t("...")-Aufrufe sowie alle Katalog- und Kategorie-Keys müssen in en.json existieren
    const requiredKeys = new Set<string>(collectSourceTranslationKeys(SRC_ROOT));
    for (const item of [
      ...getPaletteGateItems("io"),
      ...getPaletteGateItems("displays"),
      ...getPaletteGateItems("gates"),
    ]) {
      requiredKeys.add(item.labelKey);
    }
    requiredKeys.add(getTextNotePaletteLabelKey());
    requiredKeys.add("palette.components.subCircuit");
    requiredKeys.add("palette.components.pin");
    for (const category of COMPONENT_PALETTE_CATEGORIES) {
      requiredKeys.add(`palette.categories.${category}`);
    }
    requiredKeys.add("palette.categories.projectCircuits");

    expect(getAllowedComponentTypes().length).toBeGreaterThanOrEqual(22);

    for (const key of requiredKeys) {
      const hasDirect = Object.hasOwn(enFlat.leaves, key);
      const hasPlural = Object.hasOwn(enFlat.leaves, `${key}_one`) && Object.hasOwn(enFlat.leaves, `${key}_other`);
      expect(hasDirect || hasPlural, `Missing master key "${key}" in src/locales/en.json`).toBe(true);
    }
  });

  it("prüft alle nicht-englischen Sprachdateien als echte Teilmenge von en.json (ohne Fremd-Keys oder Leereinträge)", () => {
    const localeFiles = readdirSync(LOCALES_DIR)
      .filter((name) => name.endsWith(".json") && name !== "en.json")
      .sort();

    expect(localeFiles).toContain("de.json");

    for (const fileName of localeFiles) {
      const code = fileName.slice(0, -".json".length);
      const parsed: unknown = JSON.parse(readFileSync(path.join(LOCALES_DIR, fileName), "utf8"));
      const errors = validateLocaleAgainstMaster(code, parsed, enCatalog);
      expect(errors, `Validation errors in ${fileName}`).toEqual([]);
    }
  });

  it("akzeptiert partielle Community-Übersetzungen und komplexe CLDR-Pluralformen, lehnt aber Fremd-Keys und Platzhalterfehler ab", () => {
    const partialFrench = {
      meta: { nativeName: "Français" },
      common: { apply: "Appliquer" },
    };
    expect(validateLocaleAgainstMaster("fr", partialFrench, enCatalog)).toEqual([]);

    const polishWithRichPlurals = {
      meta: { nativeName: "Polski" },
      dialog: {
        options: {
          directoriesCount_one: "{{count}} powiązany katalog projektu",
          directoriesCount_few: "{{count}} powiązane katalogi projektu",
          directoriesCount_many: "{{count}} powiązanych katalogów projektu",
          directoriesCount_other: "{{count}} powiązanego katalogu projektu",
        },
      },
    };
    expect(validateLocaleAgainstMaster("pl", polishWithRichPlurals, enCatalog)).toEqual([]);

    const germanWithInvalidFew = {
      dialog: {
        options: {
          directoriesCount_few: "{{count}} Verzeichnisse",
        },
      },
    };
    expect(validateLocaleAgainstMaster("de", germanWithInvalidFew, enCatalog)).toHaveLength(1);

    const germanWithUnknownKey = {
      dialog: {
        options: {
          extraOnlyInGerman: "Nur in Deutsch",
        },
      },
    };
    expect(validateLocaleAgainstMaster("de", germanWithUnknownKey, enCatalog)).toHaveLength(1);

    const wrongPlaceholder = {
      dialog: {
        options: {
          errorPermissionNotGranted: "Keine Berechtigung für {{wrongName}}",
        },
      },
    };
    expect(validateLocaleAgainstMaster("de", wrongPlaceholder, enCatalog)).toHaveLength(1);

    const emptyValue = {
      common: {
        apply: "   ",
      },
    };
    expect(validateLocaleAgainstMaster("de", emptyValue, enCatalog)).toHaveLength(1);

    const structuralMismatch = {
      common: "not-an-object",
    };
    expect(validateLocaleAgainstMaster("de", structuralMismatch, enCatalog)).toHaveLength(1);
  });

  it("erkennt Sprachdateien automatisch, löst Einzahl/Mehrzahl auf und fällt bei Lücken sauber auf Englisch zurück", async () => {
    expect(AVAILABLE_LANGUAGES[0]).toEqual({ code: DEFAULT_LANGUAGE, nativeName: "English" });
    expect(AVAILABLE_LANGUAGES).toContainEqual({ code: "de", nativeName: "Deutsch" });
    expect(getLocaleNativeName("en")).toBe("English");
    expect(getLocaleNativeName("de")).toBe("Deutsch");
    expect(normalizeSupportedLanguage("DE_at")).toBeNull();
    expect(normalizeSupportedLanguage("DE")).toBe("de");

    // Isolierte i18next-Instanz demonstriert partiellen Community-Katalog + Einzahl/Mehrzahl-Fallback
    const partialInstance = i18next.createInstance();
    await partialInstance.init({
      fallbackLng: "en",
      lng: "fr",
      returnEmptyString: false,
      returnNull: false,
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: enCatalog },
        de: { translation: deCatalog },
        fr: {
          translation: {
            meta: { nativeName: "Français" },
            common: { apply: "Appliquer" },
          },
        },
      },
    });

    expect(partialInstance.t("common.apply")).toBe("Appliquer");
    expect(partialInstance.t("dialog.options.title")).toBe("Settings / Options");
    expect(partialInstance.t("dialog.options.directoriesCount", { count: 1 })).toBe("1 linked project directory");
    expect(partialInstance.t("dialog.options.directoriesCount", { count: 3 })).toBe("3 linked project directories");

    await partialInstance.changeLanguage("de");
    expect(partialInstance.t("dialog.options.directoriesCount", { count: 1 })).toBe("1 verknüpftes Projektverzeichnis");
    expect(partialInstance.t("dialog.options.directoriesCount", { count: 0 })).toBe("0 verknüpfte Projektverzeichnisse");
    expect(partialInstance.t("dialog.options.directoriesCount", { count: 2 })).toBe("2 verknüpfte Projektverzeichnisse");
  });

  it("erkennt Browser-Sprachen und löst Präferenzen deterministisch auf", () => {
    expect(detectBrowserLanguage(["de-DE"])).toBe("de");
    expect(detectBrowserLanguage(["de-AT"])).toBe("de");
    expect(detectBrowserLanguage(["en-GB"])).toBe("en");
    expect(detectBrowserLanguage(["ja-JP", "de-CH"])).toBe("de");
    expect(detectBrowserLanguage(["fr-FR"])).toBe("en");
    expect(detectBrowserLanguage([])).toBe("en");

    expect(resolveEffectiveLanguage(AUTO_LANGUAGE, ["de-DE"])).toBe("de");
    expect(resolveEffectiveLanguage(AUTO_LANGUAGE, ["fr-FR"])).toBe("en");
    expect(resolveEffectiveLanguage("en", ["de-DE"])).toBe("en");
    expect(resolveEffectiveLanguage("de", ["en-US"])).toBe("de");
    expect(resolveEffectiveLanguage("zz-UNKNOWN", ["de-DE"])).toBe("de");
  });

  it("schaltet die UI-Sprache über CircuitContextProvider sofort um und persistiert sie in localStorage", () => {
    const store = installMockLocalStorage();
    const project = createEmptyCircuitProject();

    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, {
          onContext: (ctx) => {
            capturedCtx = ctx;
          },
        }),
      }),
    );

    React.act(() => {
      capturedCtx.updateAppSettings({ language: "en" });
    });

    expect(i18n.language).toBe("en");
    expect(loadAppSettings().language).toBe("en");
    expect(JSON.parse(store.get(APP_SETTINGS_STORAGE_KEY) ?? "{}").language).toBe("en");

    const englishOptionsHtml = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(OptionsDialog, { isOpen: true, onClose: noop }),
      }),
    );
    expect(englishOptionsHtml).toContain("Settings / Options");
    expect(englishOptionsHtml).toContain("Language");
    expect(englishOptionsHtml).toContain("Startup behavior");
    expect(englishOptionsHtml).toContain("Default clock frequency for new projects");

    const englishPaletteHtml = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(ComponentPalette, null),
        ),
      }),
    );
    expect(englishPaletteHtml).toContain("Inputs &amp; Outputs");
    expect(englishPaletteHtml).toContain("Outputs &amp; Displays");
    expect(englishPaletteHtml).toContain("Basic Gates");
    expect(englishPaletteHtml).toContain("Button / Switch");
    expect(englishPaletteHtml).toContain("Text Note");

    React.act(() => {
      capturedCtx.updateAppSettings({ language: "de" });
    });

    expect(i18n.language).toBe("de");
    expect(loadAppSettings().language).toBe("de");

    const germanOptionsHtml = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(OptionsDialog, { isOpen: true, onClose: noop }),
      }),
    );
    expect(germanOptionsHtml).toContain("Einstellungen / Optionen");
    expect(germanOptionsHtml).toContain("Verhalten beim Programmstart");

    const germanPaletteHtml = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(ComponentPalette, null),
        ),
      }),
    );
    expect(germanPaletteHtml).toContain("Ein- &amp; Ausgänge");
    expect(germanPaletteHtml).toContain("Ausgabe &amp; Anzeige");
    expect(germanPaletteHtml).toContain("Grundformen");
    expect(germanPaletteHtml).toContain("Taster / Schalter");
    expect(germanPaletteHtml).toContain("Text-Notiz");
  });
});
