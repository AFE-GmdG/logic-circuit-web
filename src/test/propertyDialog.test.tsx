import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createLedMatrix,
  createPinCircuit,
  createSplitter,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import {
  parseNativeProject,
} from "../utils/storage/nativeProjectReader";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { parseLogicCircuitXml } from "../utils/xml/logicCircuitXmlReader";
import { exportProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

import PropertyDialog from "../components/propertyDialog";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("PropertyDialog Component", () => {
  it("renders gate property form with input count and inversion toggle", () => {
    const andGate = createGate("and", 2, false);
    const sym = createCircuitSymbol(andGate, "main", 5, 5);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("data-component=\"PropertyDialog\"");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("Eigenschaften: AND-Gatter");
    expect(html).toContain("Anzahl der Eingänge (2–8)");
    expect(html).toContain("Ausgang invertieren (NAND)");
    expect(html).not.toContain("Ausgang invertieren (NAND / NOR / XNOR)");
    expect(html).toContain("Speichern");
    expect(html).toContain("Abbrechen");
  });

  it("renders button property form with momentary/toggle modes and notation", () => {
    const button = createCircuitButton("btn-1", "START", false);
    const sym = createCircuitSymbol(button, "main", 2, 2);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Taster / Schalter");
    expect(html).toContain("Betriebsmodus");
    expect(html).toContain("Taster (Momentary)");
    expect(html).toContain("Schalter (Toggle)");
    expect(html).toContain("START");
    expect(html).toContain("Signal invertieren (Aktiv Low)");
  });

  it("renders constant property form with bit width and value input", () => {
    const constant = createConstant("const-1", 8, 255);
    const sym = createCircuitSymbol(constant, "main", 10, 10);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Konstante");
    expect(html).toContain("Bitbreite (1–32)");
    expect(html).toContain("value=\"8\"");
    expect(html).toContain("value=\"FF\"");
    expect(html).toContain("Pin-Ausrichtung");
    expect(html).toContain("hex-prefix");
    expect(html).toContain("0x");
    expect(html).toContain("required=\"\"");
    expect(html).toContain("pattern=\"^[0-9a-fA-F]+$\"");
  });

  it("renders constant property form in decimal mode when isHex is false", () => {
    const sym = createCircuitSymbol(
      createConstant("c2", 8, 42, "right", false),
      "main",
      10,
      10,
    );

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Konstante");
    expect(html).toContain("Numerischer Wert (Dezimal)");
    expect(html).toContain("value=\"42\"");
    expect(html).toContain("pattern=\"^[0-9]+$\"");
    expect(html).not.toContain("<span class=\"hex-prefix\">");
  });

  it("renders pin property form with direction, bit width and name", () => {
    const { pinCircuit } = createPinCircuit("pin-1", "main", "input", "DataIn", 4);
    const sym = createCircuitSymbol(pinCircuit, "main", 0, 4);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Ein-/Ausgangs-Pin");
    expect(html).toContain("Pin-Name");
    expect(html).toContain("value=\"DataIn\"");
    expect(html).toContain("Pin-Richtung");
    expect(html).toContain("Eingang (Input)");
    expect(html).toContain("value=\"4\"");
  });

  it("renders probe property form with probe name and orientation", () => {
    const probe = createCircuitProbe("probe-1", "OutProbe");
    const sym = createCircuitSymbol(probe, "main", 12, 8);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Signal-Sonde (Probe)");
    expect(html).toContain("Bezeichnung der Messsonde");
    expect(html).toContain("value=\"OutProbe\"");
  });

  it("renders circuit property form with name, category and description", () => {
    const lc = createDefaultLogicalCircuit("alu-sub", "ALU", "Arithmetik", "8-Bit ALU Subschaltung");

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        circuit={lc}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Eigenschaften: Schaltung „ALU“");
    expect(html).toContain("Schaltungs-Name");
    expect(html).toContain("value=\"ALU\"");
    expect(html).toContain("Kategorie in der Bauteil-Palette");
    expect(html).toContain("value=\"Arithmetik\"");
    expect(html).toContain("list=\"circuit-category-suggestions\"");
    expect(html).toContain("<datalist id=\"circuit-category-suggestions\">");
    expect(html).toContain("<option value=\"Arithmetik\">");
    expect(html).toContain("8-Bit ALU Subschaltung");
  });

  it("renders category suggestions datalist from categories prop and project circuits", () => {
    const lc = createDefaultLogicalCircuit("reg-1", "Register");

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        circuit={lc}
        categories={["Arithmetik", "Speicher", "Hilfsbausteine"]}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("<datalist id=\"circuit-category-suggestions\">");
    expect(html).toContain("<option value=\"Arithmetik\">");
    expect(html).toContain("<option value=\"Speicher\">");
    expect(html).toContain("<option value=\"Hilfsbausteine\">");
  });

  it("returns null when isOpen is false", () => {
    const andGate = createGate("and", 2, false);
    const sym = createCircuitSymbol(andGate, "main", 5, 5);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={false}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).not.toContain("data-component=\"PropertyDialog\"");
  });

  it("renders modal with keyboard hints and accessible attributes", () => {
    const andGate = createGate("and", 2, false);
    const sym = createCircuitSymbol(andGate, "main", 5, 5);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("tabindex=\"-1\"");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("aria-labelledby=\"property-dialog-title\"");
    expect(html).toContain("Tipp: Enter / Strg+Enter zum Speichern • Esc zum Abbrechen");
  });

  it("unifies modal for Tri-State Up and Down variants with type switcher", () => {
    // TriState 1 (Down-Variante)
    const tri1 = createGate("triState1", 2, false);
    const sym1 = createCircuitSymbol(tri1, "main", 3, 30);

    const html1 = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym1}
        onClose={() => {}}
      />,
    );

    expect(html1).toContain("Eigenschaften: Tri-State-Gatter");
    expect(html1).toContain("Ausrichtung des Steuereingangs (Enable)");
    expect(html1).toContain("Unten (Down / Tri-State 1)");
    expect(html1).toContain("Oben (Up / Tri-State 2)");
    expect(html1).toContain("id=\"tristate-type-down-btn\"");
    expect(html1).toContain("id=\"tristate-type-up-btn\"");
    // Bei triState1 ist der Down-Button aktiv
    expect(html1).toContain("id=\"tristate-type-down-btn\" class=\"switcher-btn active\"");
    expect(html1).toContain("id=\"tristate-type-up-btn\" class=\"switcher-btn \"");

    // TriState 2 (Up-Variante)
    const tri2 = createGate("triState2", 2, false);
    const sym2 = createCircuitSymbol(tri2, "main", 8, 30);

    const html2 = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym2}
        onClose={() => {}}
      />,
    );

    // Identischer einheitlicher Titel
    expect(html2).toContain("Eigenschaften: Tri-State-Gatter");
    // Bei triState2 ist der Up-Button aktiv
    expect(html2).toContain("id=\"tristate-type-down-btn\" class=\"switcher-btn \"");
    expect(html2).toContain("id=\"tristate-type-up-btn\" class=\"switcher-btn active\"");
  });

  it("omits redundant fixed-input info box for fixed-pin gates such as NOT and CLOCK", () => {
    // NOT-Gatter
    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "main", 4, 4);

    const notHtml = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={notSym}
        onClose={() => {}}
      />,
    );

    expect(notHtml).toContain("Eigenschaften: NOT-Gatter");
    expect(notHtml).toContain("Notiz / Beschreibung (Optional)");
    expect(notHtml).not.toContain("class=\"form-info-box\"");
    expect(notHtml).not.toContain("fest vorgegeben");
    expect(notHtml).not.toContain("Anzahl der Eingänge");

    // CLOCK-Gatter
    const clockGate = createGate("clock", 0, false);
    const clockSym = createCircuitSymbol(clockGate, "main", 6, 6);

    const clockHtml = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={clockSym}
        onClose={() => {}}
      />,
    );

    expect(clockHtml).toContain("Eigenschaften: CLOCK-Gatter");
    expect(clockHtml).toContain("Notiz / Beschreibung (Optional)");
    expect(clockHtml).not.toContain("class=\"form-info-box\"");
    expect(clockHtml).not.toContain("fest vorgegeben");
    expect(clockHtml).not.toContain("Anzahl der Eingänge");
  });

  it("displays specific gate invert labels and titles for AND/NAND, OR/NOR, and XOR/XNOR", () => {
    // AND / NAND
    const nandGate = createGate("and", 2, true);
    const nandSym = createCircuitSymbol(nandGate, "main", 2, 2);
    const nandHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={nandSym} onClose={() => {}} />,
    );
    expect(nandHtml).toContain("Eigenschaften: NAND-Gatter");
    expect(nandHtml).toContain("Ausgang invertieren (NAND)");
    expect(nandHtml).not.toContain("Ausgang invertieren (NOR)");
    expect(nandHtml).not.toContain("Ausgang invertieren (XNOR)");

    // OR / NOR
    const orGate = createGate("or", 2, false);
    const orSym = createCircuitSymbol(orGate, "main", 4, 2);
    const orHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={orSym} onClose={() => {}} />,
    );
    expect(orHtml).toContain("Eigenschaften: OR-Gatter");
    expect(orHtml).toContain("Ausgang invertieren (NOR)");
    expect(orHtml).not.toContain("Ausgang invertieren (NAND)");
    expect(orHtml).not.toContain("Ausgang invertieren (XNOR)");

    const norGate = createGate("or", 3, true);
    const norSym = createCircuitSymbol(norGate, "main", 6, 2);
    const norHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={norSym} onClose={() => {}} />,
    );
    expect(norHtml).toContain("Eigenschaften: NOR-Gatter");
    expect(norHtml).toContain("Ausgang invertieren (NOR)");
    expect(norHtml).not.toContain("Ausgang invertieren (NAND)");
    expect(norHtml).not.toContain("Ausgang invertieren (XNOR)");

    // XOR / XNOR
    const xorGate = createGate("xor", 2, false);
    const xorSym = createCircuitSymbol(xorGate, "main", 8, 2);
    const xorHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={xorSym} onClose={() => {}} />,
    );
    expect(xorHtml).toContain("Eigenschaften: XOR-Gatter");
    expect(xorHtml).toContain("Ausgang invertieren (XNOR)");
    expect(xorHtml).not.toContain("Ausgang invertieren (NAND)");
    expect(xorHtml).not.toContain("Ausgang invertieren (NOR)");

    const xnorGate = createGate("xor", 2, true);
    const xnorSym = createCircuitSymbol(xnorGate, "main", 10, 2);
    const xnorHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={xnorSym} onClose={() => {}} />,
    );
    expect(xnorHtml).toContain("Eigenschaften: XNOR-Gatter");
    expect(xnorHtml).toContain("Ausgang invertieren (XNOR)");
    expect(xnorHtml).not.toContain("Ausgang invertieren (NAND)");
    expect(xnorHtml).not.toContain("Ausgang invertieren (NOR)");
  });

  it("renders LED property form with color selection", () => {
    const ledGate = createGate("led", 1);
    const sym = createCircuitSymbol(ledGate, "main", 4, 4);

    const html = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={sym} onClose={() => {}} />,
    );

    expect(html).toContain("Eigenschaften: LED (Einzellampe)");
    expect(html).toContain("Leuchtfarbe");
    expect(html).toContain("Rot (Standard)");
    expect(html).toContain("Gelb");
    expect(html).toContain("Grün");
    expect(html).toContain("Blau");
    // LED has no variable gate input count
    expect(html).not.toContain("Anzahl der Eingänge");
  });

  it("renders 7-Segment property form with color selection", () => {
    const sevenSegGate = createGate("led", 8);
    const sym = createCircuitSymbol(sevenSegGate, "main", 6, 6);

    const html = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={sym} onClose={() => {}} />,
    );

    expect(html).toContain("Eigenschaften: 7-Segment-Anzeige");
    expect(html).toContain("Leuchtfarbe");
    expect(html).toContain("Rot (Standard)");
    expect(html).toContain("Gelb");
    expect(html).toContain("Grün");
    expect(html).toContain("Blau");
  });

  it("renders LED-Matrix property form with mode, cell shape, rows, columns, colors and persistence", () => {
    const matrix = createLedMatrix("mat-test", 6, 8, "selector", "rect", 2, 2);
    const sym = createCircuitSymbol(matrix, "main", 10, 10);

    const html = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={sym} onClose={() => {}} />,
    );

    expect(html).toContain("Eigenschaften: LED-Matrix");
    expect(html).toContain("Matrix-Modus");
    expect(html).toContain("Zeilenweise (Multi-Bit Zeileneingänge)");
    expect(html).toContain("Auswahl (Multiplexing mit Spaltenauswahl)");
    expect(html).toContain("Zellenform");
    expect(html).toContain("Rund (Standard)");
    expect(html).toContain("Rechteckig / Quadratisch");
    expect(html).toContain("Zeilen (1–10)");
    expect(html).toContain("Spalten (1–10)");
    expect(html).toContain("value=\"6\"");
    expect(html).toContain("value=\"8\"");
    expect(html).toContain("Farbkanäle (Bits pro Zelle)");
    expect(html).toContain("1 Bit (Monochrom / Rot)");
    expect(html).toContain("2 Bit (4 Farben: Schwarz, Rot, Grün, Gelb)");
    expect(html).toContain("3 Bit (8 RGB-Farben)");
    expect(html).toContain("Nachleuchten (Multiplex-Faktor)");
    expect(html).toContain("1x (Standard)");
    expect(html).toContain("2x");
    expect(html).toContain("3x");
  });

  it("renders Bus-Splitter property form with pin count, bit width, and clockwise direction", () => {
    const splitter = createSplitter("split-test", 8, 4, true);
    const sym = createCircuitSymbol(splitter, "main", 5, 5);

    const html = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={sym} onClose={() => {}} />,
    );

    expect(html).toContain("Eigenschaften: Bus-Splitter");
    expect(html).toContain("Anzahl der Pins (2–32)");
    expect(html).toContain("Bitbreite pro Pin (1–32)");
    expect(html).toContain("Betriebsmodus / Signalrichtung");
    expect(html).toContain("Bus verzweigen (Bus links, Abzweige rechts)");
    expect(html).toContain("Bus bündeln (Abzweige links, Bus rechts)");
    expect(html).toContain("Bus verzweigen: Teilt einen 8-Bit-Bus in 4 Abzweige à 2 Bit auf.");
  });

  it("renders pin jamNotation field and persists jamNotation updates with undo/redo", () => {
    const { pinCircuit } = createPinCircuit(
      "pin-clk",
      "main",
      "input",
      "ClockInput",
      1,
      "left",
      false,
      0,
      2,
      2,
      "CLK",
    );
    const sym = createCircuitSymbol(pinCircuit, "main", 0, 4);

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        symbol={sym}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Beschriftung am Chip (Jam-Notation)");
    expect(html).toContain("id=\"pin-jam-notation-input\"");
    expect(html).toContain("maxLength=\"4\"");
    expect(html).toContain("value=\"CLK\"");

    // Über CircuitContextProvider inkl. updateCircuitSymbolProperties + Undo/Redo prüfen
    const project = createEmptyCircuitProject("Pin Jam Test", "Main", "main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    let placedPinSymId = "";
    React.act(() => {
      const placed = capturedCtx.addSymbol(
        { type: "pinIn", name: "ClockInput", notation: "ClockInput", jamNotation: "CLK" },
        { x: 2, y: 4 },
      );
      placedPinSymId = placed.circuitSymbolId;
    });

    React.act(() => {
      capturedCtx.updateCircuitSymbolProperties(placedPinSymId, {
        name: "ResetPin",
        jamNotation: "RST",
        pinSide: "bottom",
        inverted: true,
      });
    });

    const updatedPin = capturedCtx.project.pins.find((p) => p.name === "ResetPin");
    expect(updatedPin?.jamNotation).toBe("RST");
    expect(updatedPin?.pinSide).toBe("bottom");
    expect(updatedPin?.inverted).toBe(true);

    const updatedSym = capturedCtx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === placedPinSymId,
    )!;
    const updatedDialogHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={capturedCtx.project}>
        <PropertyDialog
          isOpen={true}
          symbol={updatedSym}
          onClose={() => {}}
        />
      </CircuitContextProvider>,
    );
    expect(updatedDialogHtml).toContain("value=\"ResetPin\"");
    expect(updatedDialogHtml).toContain("value=\"RST\"");

    React.act(() => {
      capturedCtx.undo();
    });
    const revertedPin = capturedCtx.project.pins.find((p) => p.name === "ClockInput");
    expect(revertedPin?.jamNotation).toBe("CLK");
    expect(revertedPin?.pinSide).toBe("left");
    expect(revertedPin?.inverted).toBe(false);

    React.act(() => {
      capturedCtx.redo();
    });
    const redonePin = capturedCtx.project.pins.find((p) => p.name === "ResetPin");
    expect(redonePin?.jamNotation).toBe("RST");
    expect(redonePin?.pinSide).toBe("bottom");
  });

  it("renders T-036 sub-circuit tabs, shape previews, extended placement, and disables display without display parts", () => {
    const subLc = createDefaultLogicalCircuit("sub-no-disp", "PlainBlock", "Logik", "Ohne Display");
    subLc.notation = "PB";
    const p1 = createPinCircuit("p1", subLc.logicalCircuitId, "input", "InA", 1, "left", false, 0, 2, 2, "A");
    const p2 = createPinCircuit("p2", subLc.logicalCircuitId, "output", "OutY", 1, "right", false, 0, 2, 2, "Y");
    subLc.logicalPins.push(p1.pin, p2.pin);
    const symA = createCircuitSymbol(p1.pinCircuit, subLc.logicalCircuitId, 2, 2);
    const symY = createCircuitSymbol(p2.pinCircuit, subLc.logicalCircuitId, 10, 2);
    subLc.circuitSymbols.push(symA, symY);

    const htmlNoDisplay = renderToStaticMarkup(
      <PropertyDialog isOpen={true} circuit={subLc} onClose={() => {}} />,
    );

    expect(htmlNoDisplay).toContain("id=\"circuit-tab-schematic\"");
    expect(htmlNoDisplay).toContain("id=\"circuit-tab-pin-order\"");
    expect(htmlNoDisplay).toContain("Pin Reihenfolge</span><span class=\"tab-count-badge\">2</span>");
    expect(htmlNoDisplay).toContain("id=\"circuit-notation-input\"");
    expect(htmlNoDisplay).toContain("value=\"PB\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-rectangular\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-flipFlop\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-mux\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-demux\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-alu\"");
    expect(htmlNoDisplay).toContain("data-testid=\"circuit-shape-btn-display\"");
    expect(htmlNoDisplay).toContain("disabled=\"\"");
    expect(htmlNoDisplay).toContain("Erweiterte Platzierung (Web-Erweiterung)");
    expect(htmlNoDisplay).toContain("id=\"circuit-show-label-above-checkbox\"");
    expect(htmlNoDisplay).toContain("id=\"circuit-display-margin-select\"");
    expect(htmlNoDisplay).toContain("id=\"circuit-export-hdl-checkbox\"");

    // Mit eingebetteter LED steht Symbolform "Anzeige" inkl. Margin & Label-Über-Baustein zur Verfügung
    subLc.circuitSymbols.push(createCircuitSymbol(createGate("led", 1), subLc.logicalCircuitId, 6, 6));
    subLc.circuitShape = "display";
    subLc.isDisplay = true;
    subLc.showLabelAbove = true;
    subLc.displayMargin = "horizontal";

    const htmlWithDisplay = renderToStaticMarkup(
      <PropertyDialog isOpen={true} circuit={subLc} onClose={() => {}} />,
    );
    expect(htmlWithDisplay).toContain("value=\"horizontal\" selected=\"\"");
    expect(htmlWithDisplay).not.toContain("steht zur Verfügung, sobald die Schaltung");
  });

  it("updates shape, extended placement, pinOrder with undo/redo, and roundtrips ShowLabelAbove/DisplayMargin in XML", () => {
    const project = createEmptyCircuitProject("SubDlg Test", "Main", "main");
    const subLc = createDefaultLogicalCircuit("sub-alu", "CounterPanel", "Anzeigen");
    const pTop = createPinCircuit("pin-top", "sub-alu", "input", "InTop", 1, "left", false, 0, 2, 2, "A");
    const pBot = createPinCircuit("pin-bot", "sub-alu", "input", "InBot", 1, "left", false, 0, 2, 2, "B");
    const pOut = createPinCircuit("pin-out", "sub-alu", "output", "OutQ", 1, "right", false, 0, 2, 2, "Q");
    const ledSym = createCircuitSymbol(createGate("led", 1), "sub-alu", 8, 4, "up", "led-sub");

    subLc.logicalPins.push(pTop.pin, pBot.pin, pOut.pin);
    subLc.circuitSymbols.push(
      createCircuitSymbol(pTop.pinCircuit, "sub-alu", 2, 2, "up", "sym-ptop"),
      createCircuitSymbol(pBot.pinCircuit, "sub-alu", 2, 8, "up", "sym-pbot"),
      createCircuitSymbol(pOut.pinCircuit, "sub-alu", 12, 4, "up", "sym-pout"),
      ledSym,
    );
    project.pins.push(pTop.pin, pBot.pin, pOut.pin);
    project.logicalCircuits.push(subLc);
    project.circuits.set(subLc.circuitId, subLc);

    const syncedInit = syncProjectLogicalCircuits(project);
    const subSynced = syncedInit.logicalCircuits.find((c) => c.logicalCircuitId === "sub-alu")!;
    const placedSub = createCircuitSymbol(subSynced, "main", 4, 4, "up", "sym-sub-main");
    syncedInit.logicalCircuits[0].circuitSymbols.push(placedSub);
    syncedInit.circuitSymbols.push(placedSub);

    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={syncedInit}>
        <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    const beforeJamA = capturedCtx.currentCircuit.circuitSymbols[0].jams.find((j) => j.pin.pinId === "pin-top")!;
    const beforeJamB = capturedCtx.currentCircuit.circuitSymbols[0].jams.find((j) => j.pin.pinId === "pin-bot")!;
    expect(beforeJamA.y).toBeLessThan(beforeJamB.y);

    React.act(() => {
      capturedCtx.updateCircuitProperties("sub-alu", {
        name: "PanelPro",
        notation: "PNL",
        circuitShape: "display",
        showLabelAbove: true,
        displayMargin: "all",
        exportToHDL: false,
        pinOrder: [
          { pinId: "pin-top", index: 2 },
          { pinId: "pin-bot", index: 1 },
          { pinId: "pin-out", index: 1 },
        ],
      });
    });

    const updatedSub = capturedCtx.project.logicalCircuits.find((c) => c.logicalCircuitId === "sub-alu")!;
    const updatedPlaced = capturedCtx.currentCircuit.circuitSymbols[0];
    expect(updatedSub.name).toBe("PanelPro");
    expect(updatedSub.notation).toBe("PNL");
    expect(updatedSub.circuitShape).toBe("display");
    expect(updatedSub.showLabelAbove).toBe(true);
    expect(updatedSub.displayMargin).toBe("all");
    expect(updatedSub.exportToHDL).toBe(false);
    // Display LED (2x2) + DisplayMargin "all" (+2 je Achse) => mindestens 4x4 Rastereinheiten
    expect(updatedPlaced.circuit.symbolWidth).toBeGreaterThanOrEqual(4);
    expect(updatedPlaced.circuit.symbolHeight).toBeGreaterThanOrEqual(4);

    // Nach expliziter Pin-Reihenfolge liegt InBot vor InTop
    const afterJamA = updatedPlaced.jams.find((j) => j.pin.pinId === "pin-top")!;
    const afterJamB = updatedPlaced.jams.find((j) => j.pin.pinId === "pin-bot")!;
    expect(afterJamB.y).toBeLessThan(afterJamA.y);

    // Natives JSON-Format bewahrt ShowLabelAbove, DisplayMargin, ExportToHDL und Pin-Index verlustfrei; Desktop-XML streift Web-only-Felder ab
    const nativeJson = serializeNativeProject(capturedCtx.project);
    const nativeReparsed = parseNativeProject(nativeJson);
    const nativeSub = nativeReparsed.logicalCircuits.find((c) => c.name === "PanelPro")!;
    expect(nativeSub.showLabelAbove).toBe(true);
    expect(nativeSub.displayMargin).toBe("all");
    expect(nativeSub.exportToHDL).toBe(false);
    expect(nativeSub.logicalPins.find((p) => p.name === "InBot")?.index).toBe(1);
    expect(nativeSub.logicalPins.find((p) => p.name === "InTop")?.index).toBe(2);

    const xml = exportProjectToXml(capturedCtx.project);
    expect(xml).toContain("CircuitShape=\"Display\"");
    expect(xml).not.toContain("ShowLabelAbove=");
    expect(xml).not.toContain("DisplayMargin=");
    expect(xml).not.toContain("ExportToHDL=");
    const reparsed = parseLogicCircuitXml(xml);
    const reparsedSub = reparsed.logicalCircuits.find((c) => c.name === "PanelPro")!;
    expect(reparsedSub.circuitShape).toBe("display");
    expect(reparsedSub.logicalPins.find((p) => p.name === "InBot")?.index).toBe(1);
    expect(reparsedSub.logicalPins.find((p) => p.name === "InTop")?.index).toBe(2);

    // Undo/Redo auf der bearbeiteten Schaltung "sub-alu" stellt ursprüngliche Form, Platzierung & Pin-Reihenfolge wieder her
    React.act(() => {
      capturedCtx.setCurrentCircuitId("sub-alu");
    });
    React.act(() => {
      capturedCtx.undo();
    });
    const revertedSub = capturedCtx.project.logicalCircuits.find((c) => c.logicalCircuitId === "sub-alu")!;
    const revertedMain = capturedCtx.project.logicalCircuits.find((c) => c.logicalCircuitId === "main")!;
    const revertedPlaced = revertedMain.circuitSymbols[0];
    expect(revertedSub.circuitShape).toBe("rectangular");
    expect(revertedSub.showLabelAbove).toBe(false);
    expect(revertedSub.displayMargin).toBe("none");
    expect(revertedSub.exportToHDL).toBe(true);
    const revertedJamA = revertedPlaced.jams.find((j) => j.pin.pinId === "pin-top")!;
    const revertedJamB = revertedPlaced.jams.find((j) => j.pin.pinId === "pin-bot")!;
    expect(revertedJamA.y).toBeLessThan(revertedJamB.y);

    // Redo wendet Änderungen wieder an
    React.act(() => {
      capturedCtx.redo();
    });
    const redoneSub = capturedCtx.project.logicalCircuits.find((c) => c.logicalCircuitId === "sub-alu")!;
    expect(redoneSub.showLabelAbove).toBe(true);
    expect(redoneSub.displayMargin).toBe("all");

    // Zurücksetzen auf grafische Anordnung (Index = 0) sortiert wieder anhand interner Symbolkoordinaten
    React.act(() => {
      capturedCtx.updateCircuitProperties("sub-alu", {
        pinOrder: [
          { pinId: "pin-top", index: 0 },
          { pinId: "pin-bot", index: 0 },
          { pinId: "pin-out", index: 0 },
        ],
      });
    });
    const resetMain = capturedCtx.project.logicalCircuits.find((c) => c.logicalCircuitId === "main")!;
    const resetPlaced = resetMain.circuitSymbols[0];
    const resetJamA = resetPlaced.jams.find((j) => j.pin.pinId === "pin-top")!;
    const resetJamB = resetPlaced.jams.find((j) => j.pin.pinId === "pin-bot")!;
    expect(resetJamA.y).toBeLessThan(resetJamB.y);
  });
});
