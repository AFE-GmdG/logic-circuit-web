import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type LogicalCircuit from "../types/circuit/logicalCircuit";

import { createDefaultLogicalCircuit } from "../utils/circuitLayout";

import ComponentPalette from "../components/componentPalette";

describe("ComponentPalette", () => {
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
});
