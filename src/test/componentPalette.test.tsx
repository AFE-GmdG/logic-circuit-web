import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it } from "vitest";

import CircuitContextProvider from "../contexts/circuitContext/provider";
import LibraryContextProvider from "../contexts/libraryContext/provider";

import type LogicalCircuit from "../types/circuit/logicalCircuit";

import i18n from "../i18n";
import { createDefaultLogicalCircuit } from "../utils/circuitLayout";
import {
  getCustomPaletteCategoryKey,
  saveCollapsedCategories,
  SYSTEM_PALETTE_CATEGORY_KEYS,
} from "../utils/paletteStorage";

import ComponentPalette from "../components/componentPalette";

function installMockLocalStorage(): void {
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
}

describe("ComponentPalette", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;

  afterEach(async () => {
    (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    await i18n.changeLanguage("de");
  });
  it("renders all default categories and items to markup", () => {
    const html = renderToStaticMarkup(<ComponentPalette />);

    expect(html).toContain("Bausteine");
    expect(html).toContain("Schaltungs-Projekt");
    expect(html).toContain("Helpers");
    expect(html).toContain("LED");
    expect(html).toContain("Ein- &amp; Ausgänge");
    expect(html).toContain("Grundformen");

    expect(html).toContain("Haupt-Schaltung");
    expect(html).toContain("Power");
    expect(html).toContain("7 Segment 04 Bit");
    expect(html).toContain("And");
    expect(html).toContain("Not");
  });

  it("renders input count dropdown for multi-input gates", () => {
    const html = renderToStaticMarkup(<ComponentPalette />);

    expect(html).toContain("Eingänge für And");
    expect(html).toContain("Eingänge für Or");
    expect(html).toContain("Eingänge für Xor");
  });

  it("renders configuration dropdowns for IO, display, and matrix components", () => {
    const html = renderToStaticMarkup(<ComponentPalette />);

    // Busbreite
    expect(html).toContain("Busbreite für Pin (Eingang)");
    expect(html).toContain("Busbreite für Pin (Ausgang)");
    expect(html).toContain("Busbreite für Konstante");

    // Pin-Seiten
    expect(html).toContain("Pin-Seite für Pin (Eingang)");
    expect(html).toContain("Pin-Seite für Pin (Ausgang)");
    expect(html).toContain("Pin-Seite für Konstante");
    expect(html).toContain("Pin-Seite für Signal-Sonde (Probe)");
    expect(html).toContain("Pin-Seite für Taster / Schalter");

    // Format (Dezimal / Hexadezimal)
    expect(html).toContain("Zahlenformat für Konstante");
    expect(html).toContain("Zahlenformat für Signal-Sonde (Probe)");

    // Display-Farben
    expect(html).toContain("Farbe für LED (Einzellampe)");
    expect(html).toContain("Farbe für 7-Segment-Anzeige");

    // Matrix-Konfiguration
    expect(html).toContain("Typ für LED-Matrix");
    expect(html).toContain("Zeilen für LED-Matrix");
    expect(html).toContain("Spalten für LED-Matrix");

    // Bus-Splitter-Konfiguration
    expect(html).toContain("Bus-Splitter");
    expect(html).toContain("Pins für Bus-Splitter");
    expect(html).toContain("Bitbreite pro Pin für Bus-Splitter");
    expect(html).toContain("Modus für Bus-Splitter");
  });

  it("dynamically creates custom categories from subcircuits", () => {
    const customCircuits: LogicalCircuit[] = [
      createDefaultLogicalCircuit("cpu-alu", "8-Bit ALU", "Arithmetik"),
      createDefaultLogicalCircuit("reg-a", "Register A", "Speicher"),
      createDefaultLogicalCircuit("uncategorized", "Top Level"),
    ];

    const html = renderToStaticMarkup(<ComponentPalette subCircuits={customCircuits} />);

    expect(html).toContain("Arithmetik");
    expect(html).toContain("8-Bit ALU");

    expect(html).toContain("Speicher");
    expect(html).toContain("Register A");

    expect(html).toContain("Schaltungs-Projekt");
    expect(html).toContain("Top Level");
  });

  it("keeps system category collapse state language-independent via i18n keys without colliding with matching custom categories", async () => {
    installMockLocalStorage();
    saveCollapsedCategories({
      [SYSTEM_PALETTE_CATEGORY_KEYS.gates]: true,
    });

    const collidingCircuits: LogicalCircuit[] = [
      createDefaultLogicalCircuit("c-de", "CustomGermanGate", "Grundformen"),
      createDefaultLogicalCircuit("c-short", "CustomShortKey", "gates"),
      createDefaultLogicalCircuit("c-i18n", "CustomI18nKey", "palette.categories.gates"),
    ];

    const deHtml = renderToStaticMarkup(<ComponentPalette subCircuits={collidingCircuits} />);
    expect(deHtml).toContain("CustomGermanGate");
    expect(deHtml).toContain("CustomShortKey");
    expect(deHtml).toContain("CustomI18nKey");
    expect(deHtml).toContain("Grundformen");
    // System-Kategorie "Grundformen" ist eingeklappt (enthält kein Nand-/Xor-Gatter)
    expect(deHtml).not.toContain("Eingänge für And");

    // Sprachwechsel auf Englisch nutzt denselben i18n-Key
    await i18n.changeLanguage("en");
    const enHtml = renderToStaticMarkup(<ComponentPalette subCircuits={collidingCircuits} />);
    expect(enHtml).toContain("Basic Gates");
    expect(enHtml).not.toContain("Inputs for And");
    expect(enHtml).toContain("CustomGermanGate");
  });

  it("collapses custom categories via custom namespace without affecting matching system categories", () => {
    installMockLocalStorage();
    saveCollapsedCategories({
      [getCustomPaletteCategoryKey("Grundformen")]: true,
      [getCustomPaletteCategoryKey("gates")]: true,
    });

    const collidingCircuits: LogicalCircuit[] = [
      createDefaultLogicalCircuit("c-de", "HiddenGermanCustom", "Grundformen"),
      createDefaultLogicalCircuit("c-short", "HiddenShortCustom", "gates"),
    ];

    const html = renderToStaticMarkup(<ComponentPalette subCircuits={collidingCircuits} />);
    expect(html).not.toContain("HiddenGermanCustom");
    expect(html).not.toContain("HiddenShortCustom");
    // System-Kategorie "Grundformen" bleibt weiterhin aufgeklappt
    expect(html).toContain("Eingänge für And");
  });

  it("renders Projekt / Bibliothek tab switcher inside LibraryContextProvider without touching project collapse state", () => {
    installMockLocalStorage();
    saveCollapsedCategories({
      [getCustomPaletteCategoryKey("Helpers")]: true,
    });
    saveCollapsedCategories(
      { "lib-user:Helpers": false },
      "logicCircuit.library.collapsedCategories",
    );

    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <LibraryContextProvider skipInitialLoad={true}>
          <ComponentPalette />
        </LibraryContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-testid=\"palette-sidebar-tabs\"");
    expect(html).toContain("data-testid=\"palette-tab-project\"");
    expect(html).toContain("data-testid=\"palette-tab-library\"");
    expect(html).toContain("Projekt");
    expect(html).toContain("Bibliothek");
  });
});
