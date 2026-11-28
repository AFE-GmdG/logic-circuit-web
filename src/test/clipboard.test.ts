import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProbe from "../types/circuit/circuitProbe";
import type Gate from "../types/circuit/gate";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Pin from "../types/circuit/pin";

import {
  createCircuitSymbol,
  createEmptyCircuitProject,
  createPinCircuit,
  getGateGuid,
} from "../utils/circuitLayout";
import {
  buildClipboardContent,
  buildClipboardNativeJson,
  buildClipboardXml,
  clearInMemoryClipboardText,
  extractEmbeddedNativeJson,
  getInMemoryClipboardText,
  isCircuitClipboardNative,
  isCircuitClipboardText,
  isCircuitClipboardXml,
  prepareClipboardPaste,
  readClipboardText,
  writeClipboardText,
} from "../utils/clipboardUtils";
import {
  checkFloatingPasteOverlap,
  createFloatingPasteState,
  rotatePastePayload,
  translatePastePayload,
} from "../utils/floatingPasteUtils";
import {
  LOGIC_CIRCUIT_CURRENT_NAMESPACE,
  LOGIC_CIRCUIT_DESKTOP_NAMESPACE,
} from "../utils/xml/logicCircuitXmlConstants";
import { parseLogicCircuitSnippetXml } from "../utils/xml/logicCircuitXmlReader";

import MainMenu from "../components/app/mainMenu";
import FloatingPasteLayer from "../components/circuitCanvas/floatingPasteLayer";

const ContextProbe: React.FC<{
  onCapture: (ctx: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onCapture }) => {
  const ctx = React.useContext(CircuitContext);
  onCapture(ctx);
  return null;
};

describe("T-042: Desktop-kompatibler XML-Clipboard-Handler mit ID- und Pin-Umbenennung", () => {
  it("erkennt gültiges CircuitProject-XML und nutzt In-Memory-Fallback für Clipboard-I/O", async () => {
    clearInMemoryClipboardText();
    expect(isCircuitClipboardXml("")).toBe(false);
    expect(isCircuitClipboardXml("Hallo Welt")).toBe(false);
    expect(isCircuitClipboardXml("<CircuitProject></CircuitProject>")).toBe(true);
    expect(isCircuitClipboardXml(`<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}" />`)).toBe(true);

    await writeClipboardText("<lc:CircuitProject />");
    expect(getInMemoryClipboardText()).toBe("<lc:CircuitProject />");
    expect(await readClipboardText()).toBe("<lc:CircuitProject />");
    expect(await readClipboardText("explizit")).toBe("explizit");
  });

  it("vergibt beim Paste frische UUIDs, behält Gate-GUIDs und benennt Pins sowie benannte Probes eindeutig um", () => {
    const project = createEmptyCircuitProject("Paste-Projekt", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let pinSymbolId = "";
    let probeNamedId = "";
    let probeUnnamedId = "";
    let gateSymbolId = "";
    let wireId = "";
    let noteId = "";

    React.act(() => {
      const pinSym = ctx.addSymbol({ type: "pinIn", name: "Pin (Eingang)", notation: "A" }, { x: 4, y: 4 });
      const namedProbeSym = ctx.addSymbol({ type: "probe", name: "Out" }, { x: 14, y: 4 });
      const unnamedProbeSym = ctx.addSymbol({ type: "probe", name: "" }, { x: 14, y: 8 });
      const gateSym = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 8, y: 4 });
      const wire = ctx.addWire({ x: 6, y: 5 }, { x: 8, y: 5 });
      const note = ctx.addTextNote("Kommentar", { x: 4, y: 12 });

      pinSymbolId = pinSym.circuitSymbolId;
      probeNamedId = namedProbeSym.circuitSymbolId;
      probeUnnamedId = unnamedProbeSym.circuitSymbolId;
      gateSymbolId = gateSym.circuitSymbolId;
      wireId = wire?.wireId ?? "";
      noteId = note.textNoteId;
    });

    const xml = buildClipboardXml(
      ctx.project,
      ctx.currentCircuit,
      [pinSymbolId, probeNamedId, probeUnnamedId, gateSymbolId],
      [wireId],
      [noteId],
    );
    expect(isCircuitClipboardXml(xml)).toBe(true);

    const originalGateGuid = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === gateSymbolId)?.circuitId;
    const payload = prepareClipboardPaste(xml, ctx.project, ctx.currentCircuitId);

    expect(payload.symbols).toHaveLength(4);
    expect(payload.wires).toHaveLength(1);
    expect(payload.textNotes).toHaveLength(1);

    // Alle Platzierungs-IDs müssen frisch vergeben sein
    const pastedSymIds = payload.symbols.map((s) => s.symbol.circuitSymbolId);
    expect(pastedSymIds).not.toContain(pinSymbolId);
    expect(pastedSymIds).not.toContain(probeNamedId);
    expect(pastedSymIds).not.toContain(gateSymbolId);
    expect(payload.wires[0].wireId).not.toBe(wireId);
    expect(payload.textNotes[0].textNoteId).not.toBe(noteId);

    // Gate-GUID bleibt identisch
    const pastedGate = payload.symbols.find((s) => s.circuit.kind === "gate");
    expect(pastedGate?.symbol.circuitId).toBe(originalGateGuid);

    // Pin "A" -> "A1"
    const pastedPin = payload.symbols.find((s) => s.circuit.kind === "pin")?.pin;
    expect(pastedPin?.name).toBe("A1");

    // Benannte Probe "Out" -> "Out1", unbenannte Probe bleibt ohne Benutzername (Notation "?")
    const pastedProbes = payload.symbols
      .filter((s) => s.circuit.kind === "circuitProbe")
      .map((s) => s.circuit as CircuitProbe);
    expect(pastedProbes.some((p) => p.name === "Out1")).toBe(true);
    expect(pastedProbes.some((p) => p.name === p.circuitProbeId && p.notation === "?")).toBe(true);

    // Commit als einzelner atomarer Undo-Schritt
    const countBeforeCommit = ctx.currentCircuit.circuitSymbols.length;
    const undoPointerBefore = ctx.history.pointer;
    React.act(() => {
      ctx.commitPastePayload(payload);
    });
    expect(ctx.currentCircuit.circuitSymbols.length).toBe(countBeforeCommit + 4);
    expect(ctx.history.pointer).toBe(undoPointerBefore + 1);

    // Mit einem einzigen Strg+Z wird der komplette Paste-Block rückgängig gemacht
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols.length).toBe(countBeforeCommit);
  });

  it("parst Desktop-XML-Snippets, übernimmt fehlende Subschaltungen und verhindert zirkuläre Einbettungen", () => {
    const project = createEmptyCircuitProject("Ziel-Projekt", "Main");
    const targetCircuitId = project.logicalCircuits[0].logicalCircuitId;

    // Bestehender Pin A im Zielprojekt zur Kollisionsprüfung
    const existingPin = createPinCircuit("pin-existing-a", targetCircuitId, "input", "A");
    project.pins.push(existingPin.pin);
    project.circuits.set(existingPin.pinCircuit.circuitId, existingPin.pinCircuit);
    project.logicalCircuits[0].logicalPins.push(existingPin.pin);
    project.logicalCircuits[0].circuitSymbols.push(
      createCircuitSymbol(existingPin.pinCircuit, targetCircuitId, 2, 2, "up", "sym-existing-a"),
    );

    const snippetCircuitId = "11111111-1111-1111-1111-111111111111";
    const subCircuitId = "22222222-2222-2222-2222-222222222222";
    const subPinId = "33333333-3333-3333-3333-333333333333";
    const rootPinId = "44444444-4444-4444-4444-444444444444";
    const andGuid = getGateGuid("and", 2, false);

    const desktopXml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" Name="DesktopCopy" LogicalCircuitId="${snippetCircuitId}" />
  <lc:LogicalCircuit LogicalCircuitId="${snippetCircuitId}" Name="SourceRoot" Notation="SR" />
  <lc:LogicalCircuit LogicalCircuitId="${subCircuitId}" Name="HelperBlock" Notation="HB" />
  <lc:Pin PinId="${subPinId}" CircuitId="${subCircuitId}" Name="IN" BitWidth="1" PinType="Input" PinSide="Left" />
  <lc:Pin PinId="${rootPinId}" CircuitId="${snippetCircuitId}" Name="A" BitWidth="1" PinType="Input" PinSide="Left" />
  <lc:CircuitSymbol CircuitSymbolId="55555555-5555-5555-5555-555555555555" CircuitId="${subCircuitId}" LogicalCircuitId="${snippetCircuitId}" X="10" Y="10" />
  <lc:CircuitSymbol CircuitSymbolId="66666666-6666-6666-6666-666666666666" CircuitId="${rootPinId}" LogicalCircuitId="${snippetCircuitId}" X="4" Y="10" />
  <lc:CircuitSymbol CircuitSymbolId="77777777-7777-7777-7777-777777777777" CircuitId="${andGuid}" LogicalCircuitId="${subCircuitId}" X="15" Y="15" />
  <lc:CircuitSymbol CircuitSymbolId="77777778-7777-7777-7777-777777777777" CircuitId="${subPinId}" LogicalCircuitId="${subCircuitId}" X="12" Y="15" />
  <lc:Wire WireId="88888888-8888-8888-8888-888888888888" LogicalCircuitId="${snippetCircuitId}" X1="6" Y1="11" X2="10" Y2="11" />
</lc:CircuitProject>`;

    const payload = prepareClipboardPaste(desktopXml, project, targetCircuitId);

    // Fehlende Subschaltung "HelperBlock" wird automatisch mitimportiert
    expect(payload.importedSubCircuits.map((lc) => lc.logicalCircuitId)).toEqual([subCircuitId]);
    expect(payload.importedPins.some((p: Pin) => p.pinId === subPinId)).toBe(true);
    // Pin A aus Desktop-Snippet wird wegen Kollision mit bestehendem Pin A zu A1 umbenannt
    const pastedPin = payload.symbols.find((s) => s.circuit.kind === "pin")?.pin;
    expect(pastedPin?.name).toBe("A1");

    // Selbst-Referenz / Zyklus beim Einfügen in dieselbe Schaltung muss verhindert werden
    const cyclicXml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" Name="Cyclic" LogicalCircuitId="${snippetCircuitId}" />
  <lc:LogicalCircuit LogicalCircuitId="${snippetCircuitId}" Name="SourceRoot" Notation="SR" />
  <lc:LogicalCircuit LogicalCircuitId="${targetCircuitId}" Name="Main" Notation="M" />
  <lc:CircuitSymbol
    CircuitSymbolId="99999999-9999-9999-9999-999999999999"
    CircuitId="${targetCircuitId}"
    LogicalCircuitId="${snippetCircuitId}"
    X="10"
    Y="10"
  />
</lc:CircuitProject>`;

    expect(() => prepareClipboardPaste(cyclicXml, project, targetCircuitId)).toThrow(/Zirkuläre Einbettung/i);
  });
});

describe("T-043: Schwebender Paste-Zustand (Floating Paste) und Bearbeiten-Menü", () => {
  it("normalisiert Nicht-UUID-IDs im exportierten Clipboard-XML auf gültige Desktop-GUIDs", () => {
    const project = createEmptyCircuitProject("GUID-Export", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let symId = "";
    let wireId = "";
    let noteId = "";
    React.act(() => {
      const gate = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 6, y: 6 });
      const wire = ctx.addWire({ x: 4, y: 7 }, { x: 6, y: 7 });
      const note = ctx.addTextNote("Notiz", { x: 6, y: 12 });
      symId = gate.circuitSymbolId;
      wireId = wire?.wireId ?? "";
      noteId = note.textNoteId;
    });

    const xml = buildClipboardXml(
      ctx.project,
      ctx.currentCircuit,
      [symId],
      [wireId],
      [noteId],
    );

    const idMatches = Array.from(
      xml.matchAll(/(?:ProjectId|LogicalCircuitId|CircuitSymbolId|WireId|TextNoteId)="([^"]+)"/g),
    ).map((m) => m[1]);

    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(idMatches.length).toBeGreaterThanOrEqual(5);
    for (const idValue of idMatches) {
      expect(guidRegex.test(idValue)).toBe(true);
    }

    // Exportiertes Web-XML kann direkt wieder per prepareClipboardPaste importiert werden
    const reparsed = prepareClipboardPaste(xml, ctx.project, ctx.currentCircuitId);
    expect(reparsed.symbols).toHaveLength(1);
    expect(reparsed.wires).toHaveLength(1);
    expect(reparsed.textNotes).toHaveLength(1);
  });

  it("versetzt schwebenden Block automatisch (+2/+2 oder Viewport-Mitte), rotiert und erkennt Bauteil-Überlappungen", () => {
    const project = createEmptyCircuitProject("Floating-Test", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let gateId = "";
    let wireId = "";
    React.act(() => {
      const gate = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 6, y: 6 });
      const wire = ctx.addWire({ x: 4, y: 7 }, { x: 6, y: 7 });
      gateId = gate.circuitSymbolId;
      wireId = wire?.wireId ?? "";
    });

    const xml = buildClipboardXml(ctx.project, ctx.currentCircuit, [gateId], [wireId], []);
    const prepared = prepareClipboardPaste(xml, ctx.project, ctx.currentCircuitId);

    // Innerhalb des sichtbaren Viewports -> +2/+2 Versatz und erneutes Shiften bei bestehender Belegung bei (8,8)
    React.act(() => {
      ctx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 8, y: 8 });
    });

    const floating = createFloatingPasteState(prepared, ctx.currentCircuit, {
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 20,
    });
    const placedSym = floating.payload.symbols[0].symbol;
    expect(placedSym.x).toBeGreaterThanOrEqual(10);
    expect(placedSym.y).toBeGreaterThanOrEqual(10);
    expect(floating.hasOverlapWarning).toBe(false);

    // Manuelles Schieben zurück auf (8, 8) löst Überlappungswarnung aus, ohne das bestehende Schaltnetz zu verändern
    const collided = translatePastePayload(prepared, 2, 2);
    const overlapCheck = checkFloatingPasteOverlap(collided, ctx.currentCircuit);
    expect(overlapCheck.hasOverlapWarning).toBe(true);
    expect(overlapCheck.overlappingSymbolIds).toContain(prepared.symbols[0].symbol.circuitSymbolId);

    // Blockweises Rotieren dreht Symbol und Leitung ohne Berührung der bestehenden Schaltung
    const wireCountBefore = ctx.currentCircuit.wires.length;
    const historyBefore = ctx.history.pointer;
    const rotated = rotatePastePayload(floating.payload, "clockwise");
    expect(rotated.symbols[0].symbol.rotation).toBe("right");
    expect(ctx.currentCircuit.wires).toHaveLength(wireCountBefore);
    expect(ctx.history.pointer).toBe(historyBefore);

    // Außerhalb des sichtbaren Viewports wird in die Viewport-Mitte zentriert
    const centeredFloating = createFloatingPasteState(prepared, ctx.currentCircuit, {
      minX: 40,
      minY: 30,
      maxX: 60,
      maxY: 50,
    });
    expect(centeredFloating.payload.symbols[0].symbol.x).toBeGreaterThanOrEqual(40);
    expect(centeredFloating.payload.symbols[0].symbol.y).toBeGreaterThanOrEqual(30);
  });

  it("rendert FloatingPasteLayer als isoliertes SVG-Overlay und aktiviert Bearbeiten-Menü (Cut/Copy/Paste)", () => {
    const project = createEmptyCircuitProject("Overlay-Test", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let symId = "";
    React.act(() => {
      const gate = ctx.addSymbol({ type: "not", name: "NOT" }, { x: 4, y: 4 });
      symId = gate.circuitSymbolId;
    });

    const xml = buildClipboardXml(ctx.project, ctx.currentCircuit, [symId], [], []);
    const prepared = prepareClipboardPaste(xml, ctx.project, ctx.currentCircuitId);
    const floatingState = createFloatingPasteState(prepared, ctx.currentCircuit, {
      minX: 0,
      minY: 0,
      maxX: 25,
      maxY: 20,
    });

    const svgHtml = renderToStaticMarkup(
      React.createElement(SimulationContextProvider, {
        children: React.createElement(
          "svg",
          null,
          React.createElement(FloatingPasteLayer, {
            floatingPaste: floatingState,
            onStartFloatingDrag: () => undefined,
          }),
        ),
      }),
    );
    expect(svgHtml).toContain("data-component=\"FloatingPasteLayer\"");
    expect(svgHtml).toContain("data-testid=\"floating-paste-frame\"");

    const noop = () => undefined;
    const menuHtml = renderToStaticMarkup(
      React.createElement(MainMenu, {
        isOpen: true,
        initialCategory: "edit",
        isSimulating: false,
        isPaused: false,
        isRunning: false,
        canUndo: false,
        canRedo: false,
        hasSelection: true,
        hasSymbolSelection: true,
        canPaste: true,
        canDeleteCurrentCircuit: false,
        onClose: noop,
        onNewProject: noop,
        onLoadDemo: noop,
        onImportProject: noop,
        onSaveProject: noop,
        onSaveProjectAs: noop,
        onExportImage: noop,
        onOpenProjectSettings: noop,
        onUndo: noop,
        onRedo: noop,
        onCut: noop,
        onCopy: noop,
        onPaste: noop,
        onDeleteSelected: noop,
        onRotateRight: noop,
        onRotateLeft: noop,
        onEditCurrentCircuit: noop,
        onCreateCircuit: noop,
        onDeleteCurrentCircuit: noop,
        onToggleSimulation: noop,
        onStepSimulation: noop,
        onStopSimulation: noop,
        onOpenOptions: noop,
        onOpenHelp: noop,
      }),
    );

    expect(menuHtml).toContain("Ausschneiden");
    expect(menuHtml).toContain("Strg+X");
    expect(menuHtml).toContain("Kopieren");
    expect(menuHtml).toContain("Strg+C");
    expect(menuHtml).toContain("Einfügen");
    expect(menuHtml).toContain("Strg+V");
    expect(menuHtml).not.toContain("Folgt in US-013 (Copy/Cut/Paste)");
  });

  it("serialisiert rechteckige LedMatrix und unbenannte CircuitProbes Desktop-kompatibel und aktualisiert In-Memory-Cache", async () => {
    clearInMemoryClipboardText();
    const project = createEmptyCircuitProject("ClipboardExportTest", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let ledSymbolId = "";
    let probeSymbolId = "";
    let probeEntityId = "";

    React.act(() => {
      const ledSym = ctx.addSymbol(
        {
          type: "ledMatrix",
          name: "LED Matrix",
          rows: 1,
          columns: 1,
          matrixType: "individual",
          cellShape: "rect",
        },
        { x: 4, y: 4 },
      );
      const probeSym = ctx.addSymbol({ type: "probe", name: "" }, { x: 8, y: 4 });
      ledSymbolId = ledSym.circuitSymbolId;
      probeSymbolId = probeSym.circuitSymbolId;
      probeEntityId = probeSym.circuitId;
    });

    const xml = buildClipboardXml(
      ctx.project,
      ctx.currentCircuit,
      [ledSymbolId, probeSymbolId],
      [],
      [],
    );

    expect(xml).toContain(`xmlns="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}"`);
    expect(xml).not.toContain("xmlns:lc=");
    expect(xml).not.toContain("<lc:");
    expect(xml).toContain("CellShape=\"Rectangle\"");
    expect(xml).not.toContain("CellShape=\"Rect\"");
    expect(xml).toContain(`CircuitProbeId="${probeEntityId}" Name="${probeEntityId}"`);
    expect(xml).toMatch(/<CircuitProbe CircuitProbeId="([0-9a-f-]+)" Name="\1"/i);

    const wroteSystemClipboard = await writeClipboardText(xml);
    expect(typeof wroteSystemClipboard).toBe("boolean");
    expect(getInMemoryClipboardText()).toBe(xml);
  });
});

describe("T-059: Natives JSON-Clipboard (Web-to-Web verlustfrei inkl. Desktop-XML-Erkennung)", () => {
  it("serialisiert und erkennt natives Web-JSON und überträgt alle Web-Erweiterungen verlustfrei", () => {
    const project = createEmptyCircuitProject("NativeClipboard", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(ContextProbe, { onCapture: (c) => { ctx = c; } }),
      }),
    );

    let subId = "";
    let pinOutSymId = "";
    let probeSymId = "";
    let btnSymId = "";
    let ledSymId = "";
    let subSymId = "";
    let noteId = "";

    React.act(() => {
      const [sub] = ctx.createCircuits([{ name: "DispSub", category: "Display" }]);
      subId = sub.logicalCircuitId;
      ctx.setCurrentCircuitId(subId);
      ctx.addSymbol({ type: "led", name: "LED", color: "green" }, { x: 4, y: 4 });
      ctx.updateCircuitProperties(subId, {
        circuitShape: "display",
        showLabelAbove: true,
        displayMargin: "all",
      });

      ctx.setCurrentCircuitId(ctx.project.logicalCircuits[0]!.logicalCircuitId);
      const pinSym = ctx.addSymbol(
        {
          type: "pinOut",
          name: "Pin (Ausgang)",
          notation: "DOUT",
          jamNotation: "DO",
          pinSide: "left",
          width: 4,
          height: 3,
        },
        { x: 2, y: 2 },
      );
      const probeSym = ctx.addSymbol(
        { type: "probe", name: "Messung", notation: "Messung", displayFormat: "dec" },
        { x: 10, y: 2 },
      );
      const btnSym = ctx.addSymbol(
        { type: "button", name: "BTN", notation: "BTN", keyCode: 65, modifiers: 2 },
        { x: 2, y: 8 },
      );
      const ledSym = ctx.addSymbol(
        { type: "led", name: "LED", color: "green", note: "Status-LED" },
        { x: 10, y: 8 },
      );
      const subSym = ctx.addSymbol(
        { type: "subCircuit", subCircuitId: subId, name: "DispSub" },
        { x: 16, y: 2 },
      );
      const note = ctx.addTextNote("Notiz A --> B\nZeile B", { x: 2, y: 14 });
      ctx.updateTextNote(note.textNoteId, { fontFamily: "sans", lineHeights: [36, 12] });

      pinOutSymId = pinSym.circuitSymbolId;
      probeSymId = probeSym.circuitSymbolId;
      btnSymId = btnSym.circuitSymbolId;
      ledSymId = ledSym.circuitSymbolId;
      subSymId = subSym.circuitSymbolId;
      noteId = note.textNoteId;
    });

    const dualContent = buildClipboardContent(
      ctx.project,
      ctx.currentCircuit,
      [pinOutSymId, probeSymId, btnSymId, ledSymId, subSymId],
      [],
      [noteId],
    );
    const pureNativeJson = buildClipboardNativeJson(
      ctx.project,
      ctx.currentCircuit,
      [pinOutSymId, probeSymId, btnSymId, ledSymId, subSymId],
      [],
      [noteId],
    );

    // Dual-Format kombiniert präfixloses Desktop-XML mit Base64-kodiertem nativem JSON-Kommentar (ohne vorzeitiges "-->")
    expect(dualContent).toContain(`<CircuitProject xmlns="${LOGIC_CIRCUIT_DESKTOP_NAMESPACE}">`);
    expect(dualContent).not.toContain("xmlns:lc=");
    expect(dualContent).not.toContain("<lc:");
    expect(dualContent).toContain("Notation=\"Main\"");
    expect(dualContent).toMatch(/<!--LCWEB_NATIVE_B64:[A-Za-z0-9+/=]+-->/);
    expect(dualContent.match(/-->/g)).toHaveLength(1);
    expect(extractEmbeddedNativeJson(dualContent)).toBe(pureNativeJson);

    expect(isCircuitClipboardNative(dualContent)).toBe(true);
    expect(isCircuitClipboardXml(dualContent)).toBe(true);
    expect(isCircuitClipboardText(dualContent)).toBe(true);

    expect(isCircuitClipboardNative(pureNativeJson)).toBe(true);
    expect(isCircuitClipboardText(pureNativeJson)).toBe(true);
    expect(isCircuitClipboardXml(pureNativeJson)).toBe(false);

    // Desktop-XML-Parser (ignoriert Kommentare) parst den XML-Teil inkl. maskiertem "-->" in der TextNote fehlerfrei
    const parsedAsDesktopXml = parseLogicCircuitSnippetXml(dualContent);
    expect(parsedAsDesktopXml.textNotes[0]?.note).toBe("Notiz A --> B\nZeile B");

    // Einfügen in eine leere Zielschaltung eines zweiten Projekts stellt alle Web-Erweiterungen über Base64-JSON wieder her
    const targetProject = createEmptyCircuitProject("Target", "Main");
    const targetCircuitId = targetProject.logicalCircuits[0]!.logicalCircuitId;
    const payload = prepareClipboardPaste(dualContent, targetProject, targetCircuitId);
    const pureNativePayload = prepareClipboardPaste(pureNativeJson, targetProject, targetCircuitId);
    expect(pureNativePayload.symbols).toHaveLength(payload.symbols.length);

    const pastedPin = payload.symbols.find((s) => s.circuit.kind === "pin");
    expect(pastedPin?.pin?.pinType).toBe("output");
    expect(pastedPin?.pin?.pinSide).toBe("left");
    expect(pastedPin?.pin?.jamNotation).toBe("DO");
    expect(pastedPin?.circuit.symbolWidth).toBe(4);
    expect(pastedPin?.circuit.symbolHeight).toBe(3);

    const pastedProbe = payload.symbols.find((s) => s.circuit.kind === "circuitProbe")?.circuit as CircuitProbe;
    expect(pastedProbe.displayFormat).toBe("dec");

    const pastedLed = payload.symbols.find((s) => s.circuit.kind === "gate")?.circuit as Gate;
    expect(pastedLed.color).toBe("green");
    expect(pastedLed.note).toBe("Status-LED");

    const pastedSub = payload.symbols.find((s) => s.circuit.kind === "logicalCircuit")?.circuit as LogicalCircuit;
    expect(pastedSub.circuitShape).toBe("display");
    expect(pastedSub.showLabelAbove).toBe(true);
    expect(pastedSub.displayMargin).toBe("all");

    expect(payload.textNotes[0]?.note).toBe("Notiz A --> B\nZeile B");
    expect(payload.textNotes[0]?.fontFamily).toBe("sans");
    expect(payload.textNotes[0]?.lineHeights).toEqual([36, 12]);

    // Dedizierter Desktop-XML-Clipboard-Export (B-002 / T-060) nutzt Schema 2.0.0.14 ohne lc:-Präfix, nur GUIDs und streift Web-Attribute ab
    const desktopXml = buildClipboardXml(
      ctx.project,
      ctx.currentCircuit,
      [pinOutSymId, probeSymId, btnSymId, ledSymId, subSymId],
      [],
      [noteId],
    );
    expect(desktopXml).toContain(`xmlns="${LOGIC_CIRCUIT_DESKTOP_NAMESPACE}"`);
    expect(desktopXml).not.toContain("xmlns:lc=");
    expect(desktopXml).not.toContain("<lc:");
    expect(desktopXml).not.toContain("LCWEB_NATIVE_B64");
    expect(desktopXml).not.toContain("2.0.0.15");
    expect(desktopXml).not.toContain("Color=");
    expect(desktopXml).not.toContain("ShowLabelAbove=");
    expect(desktopXml).not.toContain("DisplayMargin=");
    expect(desktopXml).not.toContain("DisplayFormat=");
    expect(desktopXml).not.toContain("FontFamily=");
    expect(desktopXml).not.toContain("LineHeights=");
    const idMatches = Array.from(desktopXml.matchAll(/\b\w*Id="([^"]+)"/g));
    expect(idMatches.length).toBeGreaterThan(5);
    for (const match of idMatches) {
      expect(match[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }

    // MainMenu bietet "Für Desktop kopieren (XML)" an
    const menuHtml = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: createEmptyCircuitProject("MenuTest"),
        children: React.createElement(SimulationContextProvider, {
          children: React.createElement(MainMenu, {
            isOpen: true,
            initialCategory: "edit",
            isSimulating: false,
            isPaused: false,
            isRunning: false,
            canUndo: false,
            canRedo: false,
            hasSelection: true,
            hasSymbolSelection: true,
            canDeleteCurrentCircuit: false,
            onClose: () => undefined,
            onNewProject: () => undefined,
            onLoadDemo: () => undefined,
            onImportProject: () => undefined,
            onSaveProject: () => undefined,
            onSaveProjectAs: () => undefined,
            onExportImage: () => undefined,
            onOpenProjectSettings: () => undefined,
            onUndo: () => undefined,
            onRedo: () => undefined,
            onCopy: () => undefined,
            onCopyForDesktop: () => undefined,
            onDeleteSelected: () => undefined,
            onRotateRight: () => undefined,
            onRotateLeft: () => undefined,
            onEditCurrentCircuit: () => undefined,
            onCreateCircuit: () => undefined,
            onDeleteCurrentCircuit: () => undefined,
            onToggleSimulation: () => undefined,
            onStepSimulation: () => undefined,
            onStopSimulation: () => undefined,
            onOpenOptions: () => undefined,
            onOpenHelp: () => undefined,
          }),
        }),
      }),
    );
    expect(menuHtml).toContain("Für Desktop kopieren (XML)");
  });
});
