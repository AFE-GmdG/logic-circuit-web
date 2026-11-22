import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContext from "../contexts/canvasContext";
import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type AiHighlightState from "../types/canvas/aiHighlightState";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Constant from "../types/circuit/constant";
import type Gate from "../types/circuit/gate";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";

import {
  addElements,
  connectWire,
  createCircuitsTool,
  deleteCircuitsTool,
  deleteElements,
  executeMcpTool,
  getCircuitDetails,
  getCircuitImage,
  getCircuitSummary,
  getComponentCatalogTool,
  getImplementedMcpToolNames,
  MCP_TOOL_DEFINITIONS,
  moveElements,
  rotateSymbolsTool,
  setCurrentCircuit,
  updateCircuitPropertiesTool,
  updateElementPropertiesTool,
} from "../mcp/mcpTools";
import {
  prepareCircuitSvgClone,
  resolveCaptureBounds,
} from "../utils/circuitCapture";
import {
  createCircuitButton,
  createDemoCircuitProject,
  createEmptyCircuitProject,
} from "../utils/circuitLayout";
import {
  buildComponentCatalog,
  COMPONENT_PALETTE_CATEGORIES,
  type ComponentCatalogResponse,
  getAllowedComponentTypes,
  getRegisteredPaletteGateTypes,
} from "../utils/componentCatalog";
import { GRID_SIZE } from "../utils/coordinateSystem";

import CircuitCanvas from "../components/circuitCanvas";

function createSnapshot(): McpCircuitSnapshot {
  const project = createDemoCircuitProject();
  const currentCircuit = project.logicalCircuits[0];
  return {
    project,
    currentCircuit,
    selectedSymbolIds: [currentCircuit.circuitSymbols[1].circuitSymbolId],
    selectedTextNoteIds: [],
  };
}

describe("MCP-Werkzeugkatalog", () => {
  it("implementiert jedes definierte Werkzeug im Browser und umgekehrt", () => {
    const defined = MCP_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
    expect(getImplementedMcpToolNames().sort()).toEqual(defined);
  });

  it("beschreibt jedes Werkzeug mit Objekt-Schema und Beschreibung", () => {
    for (const tool of MCP_TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("get_circuit_summary", () => {
  it("liefert Projekt, aktive Schaltung, Zähler und Auswahl", () => {
    const snapshot = createSnapshot();
    const summary = getCircuitSummary(snapshot);

    expect(summary.project.name).toBe("Schaltungs-Projekt");
    expect(summary.currentCircuitId).toBe(snapshot.currentCircuit.logicalCircuitId);
    expect(summary.circuits).toHaveLength(snapshot.project.logicalCircuits.length);

    const main = summary.circuits.find((c) => c.isCurrent);
    expect(main?.symbolCount).toBe(snapshot.currentCircuit.circuitSymbols.length);
    expect(main?.textNoteCount).toBe(0);
    expect(summary.circuits.filter((c) => c.isCurrent)).toHaveLength(1);

    expect(summary.selection.symbolIds).toEqual(snapshot.selectedSymbolIds);
    expect(summary.selection.textNoteIds).toEqual([]);
  });

  it("ist JSON-serialisierbar (Transport über WebSocket)", async () => {
    const summary = await executeMcpTool("get_circuit_summary", {}, createSnapshot());
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("get_circuit_details", () => {
  it("liefert Symbole mit Typ, Position und absoluten Jam-Koordinaten", () => {
    const snapshot = createSnapshot();
    const details = getCircuitDetails(snapshot, {});

    expect(details.logicalCircuitId).toBe(snapshot.currentCircuit.logicalCircuitId);
    expect(details.isCurrent).toBe(true);
    expect(details.symbols).toHaveLength(snapshot.currentCircuit.circuitSymbols.length);

    const andGate = details.symbols.find((s) => s.gateType === "and");
    expect(andGate).toBeDefined();
    expect(andGate?.kind).toBe("gate");
    expect(andGate?.x).toBe(6);
    expect(andGate?.y).toBe(3);
    expect(andGate?.jams.filter((j) => j.pinType === "input")).toHaveLength(2);
    expect(andGate?.jams.filter((j) => j.pinType === "output")).toHaveLength(1);
    for (const jam of andGate?.jams ?? []) {
      expect(Number.isInteger(jam.x)).toBe(true);
      expect(Number.isInteger(jam.y)).toBe(true);
    }

    expect(details.textNotes).toHaveLength(0);
    expect(details.selection.textNoteIds).toEqual([]);
  });

  it("liest eine andere Schaltung per circuitId ohne Auswahl der aktiven Schaltung", () => {
    const snapshot = createSnapshot();
    const details = getCircuitDetails(snapshot, { circuitId: "sub-power" });

    expect(details.logicalCircuitId).toBe("sub-power");
    expect(details.isCurrent).toBe(false);
    expect(details.symbols.length).toBe(2);
    expect(details.selection.symbolIds).toEqual([]);
  });

  it("meldet unbekannte Schaltungen und ungültige Parameter", () => {
    const snapshot = createSnapshot();
    expect(() => getCircuitDetails(snapshot, { circuitId: "gibt-es-nicht" })).toThrow(/nicht gefunden/);
    expect(() => getCircuitDetails(snapshot, { circuitId: 42 })).toThrow(/String/);
  });
});

type MockSvgNode = {
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  children: MockSvgNode[];
  parent?: MockSvgNode;
  firstChild: MockSvgNode | null;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  hasAttribute: (name: string) => boolean;
  insertBefore: (node: MockSvgNode, ref: MockSvgNode | null) => void;
  remove: () => void;
  cloneNode: (deep?: boolean) => MockSvgNode;
  querySelector: (selector: string) => MockSvgNode | null;
  querySelectorAll: (selector: string) => MockSvgNode[];
  getBoundingClientRect: () => { width: number; height: number };
};

function createMockSvgNode(tagName: string, attributes: Record<string, string> = {}, children: MockSvgNode[] = []): MockSvgNode {
  const node: MockSvgNode = {
    tagName,
    attributes: { ...attributes },
    textContent: "",
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    insertBefore(newChild: MockSvgNode, refChild: MockSvgNode | null) {
      newChild.parent = this;
      if (!refChild) {
        this.children.push(newChild);
        return;
      }
      const idx = this.children.indexOf(refChild);
      if (idx >= 0) {
        this.children.splice(idx, 0, newChild);
      } else {
        this.children.unshift(newChild);
      }
    },
    remove() {
      if (!this.parent) {
        return;
      }
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = undefined;
    },
    cloneNode(deep = false) {
      const clonedChildren = deep ? this.children.map((c) => c.cloneNode(true)) : [];
      const cloned = createMockSvgNode(this.tagName, this.attributes, clonedChildren);
      cloned.textContent = this.textContent;
      return cloned;
    },
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      const matches: MockSvgNode[] = [];
      const visit = (cur: MockSvgNode) => {
        for (const child of cur.children) {
          if (matchesMockSelector(child, selector)) {
            matches.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return matches;
    },
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };

  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}

function matchesMockSelector(node: MockSvgNode, selector: string): boolean {
  if (selector === "pattern" || selector === "rect") {
    return node.tagName.toLowerCase() === selector;
  }
  const attrMatches = Array.from(selector.matchAll(/\[([^=\]]+)="([^"]*)"\]/g));
  return attrMatches.length > 0 && attrMatches.every((m) => node.getAttribute(m[1]) === m[2]);
}

describe("get_circuit_image", () => {
  it("validiert Parameter und unerlaubte Kombinationen", async () => {
    const snapshot = createSnapshot();
    const firstSymId = snapshot.currentCircuit.circuitSymbols[0].circuitSymbolId;

    await expect(getCircuitImage(snapshot, { mode: "ungültig" })).rejects.toThrow(/mode/);
    await expect(
      getCircuitImage(snapshot, { gridRect: { x: 1, y: 1, width: 4, height: 4 }, symbolIds: [firstSymId] }),
    ).rejects.toThrow(/gleichzeitig/);
    await expect(
      getCircuitImage(snapshot, { mode: "circuit", gridRect: { x: 1, y: 1, width: 4, height: 4 } }),
    ).rejects.toThrow(/mode/);
    await expect(
      getCircuitImage(snapshot, { mode: "viewport", symbolIds: [firstSymId] }),
    ).rejects.toThrow(/mode/);
    await expect(
      getCircuitImage(snapshot, { symbolIds: [] }),
    ).rejects.toThrow(/leer/);
    await expect(
      getCircuitImage(snapshot, { symbolIds: ["gibt-es-nicht"] }),
    ).rejects.toThrow(/nicht gefunden/);
    await expect(
      getCircuitImage(snapshot, { unrelatedSymbols: "dim" }),
    ).rejects.toThrow(/symbolIds/);
    await expect(
      getCircuitImage(snapshot, { symbolIds: [firstSymId], unrelatedSymbols: "blur" }),
    ).rejects.toThrow(/unrelatedSymbols/);
    await expect(
      getCircuitImage(snapshot, { mode: "viewport", margin: 1 }),
    ).rejects.toThrow(/margin/);
    await expect(
      getCircuitImage(snapshot, { gridRect: { x: 0, y: 0, width: 0, height: 2 } }),
    ).rejects.toThrow(/width/);
    await expect(
      getCircuitImage(snapshot, { gridRect: { x: 0, y: 0, width: 2, height: 2, extra: 1 } }),
    ).rejects.toThrow(/Unbekanntes Feld/);
  });

  it("meldet im Node-Umfeld das Fehlen des Browsers", async () => {
    const snapshot = createSnapshot();
    await expect(getCircuitImage(snapshot, { mode: "viewport" })).rejects.toThrow(/Browser/);
  });

  it("berechnet Raster-Ausschnitte für gridRect und symbolIds inklusive Margin exakt", () => {
    const snapshot = createSnapshot();
    const circuit = snapshot.currentCircuit;

    const rectBoundsDefault = resolveCaptureBounds({
      circuit,
      gridRect: { x: 10, y: 20, width: 8, height: 6 },
    });
    expect(rectBoundsDefault).toEqual({
      x: 10 * GRID_SIZE,
      y: 20 * GRID_SIZE,
      width: 8 * GRID_SIZE,
      height: 6 * GRID_SIZE,
    });

    const rectBoundsMargin = resolveCaptureBounds({
      circuit,
      gridRect: { x: 10, y: 20, width: 8, height: 6 },
      margin: 1,
    });
    expect(rectBoundsMargin).toEqual({
      x: 9 * GRID_SIZE,
      y: 19 * GRID_SIZE,
      width: 10 * GRID_SIZE,
      height: 8 * GRID_SIZE,
    });

    const andGate = circuit.circuitSymbols.find(
      (s) => s.circuit.kind === "gate" && (s.circuit as Gate).gateType === "and",
    )!;
    const symBounds = resolveCaptureBounds({
      circuit,
      symbolIds: [andGate.circuitSymbolId],
    });
    expect(symBounds).toEqual({
      x: (andGate.x - 2) * GRID_SIZE,
      y: (andGate.y - 2) * GRID_SIZE,
      width: (3 + 4) * GRID_SIZE,
      height: (4 + 4) * GRID_SIZE,
    });
  });

  it("bereitet SVG-Klone mit Raster-Offset und unrelatedSymbols ('show' | 'dim' | 'hide') auf", () => {
    const snapshot = createSnapshot();
    const circuit = snapshot.currentCircuit;
    const keepSym = circuit.circuitSymbols[0];
    const extraSym = circuit.circuitSymbols[1];

    const previousDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElementNS: (_ns: string, tag: string) => createMockSvgNode(tag),
    };

    try {
      const makeSvg = () => createMockSvgNode("svg", {}, [
        createMockSvgNode("g", { "data-component": "CanvasGrid" }, [
          createMockSvgNode("defs", {}, [
            createMockSvgNode("pattern", {
              id: "circuit-canvas-grid-pattern",
              patternTransform: "translate(27, 27) scale(1)",
            }),
          ]),
          createMockSvgNode("rect", { width: "100%", height: "100%" }),
        ]),
        createMockSvgNode("g", { transform: "translate(36, 36) scale(1.5)" }, [
          createMockSvgNode("g", {
            "data-component": "CircuitSymbolView",
            "data-symbol-id": keepSym.circuitSymbolId,
          }),
          createMockSvgNode("g", {
            "data-component": "CircuitSymbolView",
            "data-symbol-id": extraSym.circuitSymbolId,
          }),
          createMockSvgNode("g", { "data-component": "SelectionBox" }),
        ]),
      ]);

      const dimPrepared = prepareCircuitSvgClone(
        makeSvg() as unknown as SVGSVGElement,
        {
          circuit,
          symbolIds: [keepSym.circuitSymbolId],
          margin: 1,
          unrelatedSymbols: "dim",
        },
      );
      const dimClone = dimPrepared.clone as unknown as MockSvgNode;
      expect(dimClone.getAttribute("viewBox")).toBe(
        `${(keepSym.x - 1) * GRID_SIZE} ${(keepSym.y - 1) * GRID_SIZE} ${dimPrepared.width} ${dimPrepared.height}`,
      );
      expect(dimClone.querySelectorAll("[data-component=\"SelectionBox\"]")).toHaveLength(0);
      expect(
        dimClone.querySelector("[data-component=\"CanvasGrid\"]")
          ?.querySelector("pattern")
          ?.getAttribute("patternTransform"),
      ).toBe(`translate(${-GRID_SIZE / 2}, ${-GRID_SIZE / 2}) scale(1)`);
      expect(
        dimClone.querySelector(`[data-symbol-id="${keepSym.circuitSymbolId}"]`)?.getAttribute("opacity"),
      ).toBeNull();
      expect(
        dimClone.querySelector(`[data-symbol-id="${extraSym.circuitSymbolId}"]`)?.getAttribute("opacity"),
      ).toBe("0.15");

      const hidePrepared = prepareCircuitSvgClone(
        makeSvg() as unknown as SVGSVGElement,
        {
          circuit,
          symbolIds: [keepSym.circuitSymbolId],
          unrelatedSymbols: "hide",
        },
      );
      const hideClone = hidePrepared.clone as unknown as MockSvgNode;
      expect(hideClone.querySelector(`[data-symbol-id="${keepSym.circuitSymbolId}"]`)).not.toBeNull();
      expect(hideClone.querySelector(`[data-symbol-id="${extraSym.circuitSymbolId}"]`)).toBeNull();
    } finally {
      (globalThis as { document?: unknown }).document = previousDoc;
    }
  });
});

describe("executeMcpTool", () => {
  it("weist unbekannte Werkzeuge und Prototyp-Namen ab", async () => {
    const snapshot = createSnapshot();
    await expect(executeMcpTool("does_not_exist", {}, snapshot)).rejects.toThrow(/Unbekanntes MCP-Werkzeug/);
    await expect(executeMcpTool("toString", {}, snapshot)).rejects.toThrow(/Unbekanntes MCP-Werkzeug/);
  });

  it("weist Nicht-Objekt-Parameter ab", async () => {
    await expect(executeMcpTool("get_circuit_details", ["x"], createSnapshot())).rejects.toThrow(/Objekt/);
  });
});

function createLiveHarness(initialProject = createEmptyCircuitProject("MCP Write Test", "Main")) {
  let circuitCtx!: React.ContextType<typeof CircuitContext>;
  const highlightedCalls: Array<Partial<AiHighlightState>> = [];

  const Consumer: React.FC = () => {
    circuitCtx = React.useContext(CircuitContext);
    return null;
  };

  renderToStaticMarkup(
    React.createElement(CircuitContextProvider, {
      initialProject,
      children: React.createElement(SimulationContextProvider, {
        children: React.createElement(CanvasContextProvider, {
          children: React.createElement(Consumer, null),
        }),
      }),
    }),
  );

  const getSnapshot = (overrides?: Partial<McpCircuitSnapshot>): McpCircuitSnapshot => ({
    project: circuitCtx.project,
    currentCircuit: circuitCtx.currentCircuit,
    selectedSymbolIds: [],
    selectedTextNoteIds: [],
    selectedWireIds: [],
    isSimulating: false,
    actions: {
      addEntities: circuitCtx.addEntities,
      moveEntities: circuitCtx.moveEntities,
      rotateSymbols: circuitCtx.rotateSymbols,
      removeEntities: circuitCtx.removeEntities,
      setCurrentCircuitId: circuitCtx.setCurrentCircuitId,
      updateCircuitProperties: circuitCtx.updateCircuitProperties,
      updateCircuitSymbolProperties: circuitCtx.updateCircuitSymbolProperties,
      resizeCircuitSymbol: circuitCtx.resizeCircuitSymbol,
      updateTextNote: circuitCtx.updateTextNote,
      createCircuits: circuitCtx.createCircuits,
      deleteCircuits: circuitCtx.deleteCircuits,
      getCurrentCircuit: () => circuitCtx.currentCircuit,
      getProject: () => circuitCtx.project,
      highlightAiElements: (elements) => {
        highlightedCalls.push(elements);
      },
    },
    ...overrides,
  });

  return {
    getCtx: () => circuitCtx,
    getSnapshot,
    highlightedCalls,
  };
}

describe("Schreibende MCP-Werkzeuge mit CircuitContext", () => {
  it("lehnt Schreibwerkzeuge ohne Bridge-Aktionen oder während laufender Simulation ab", async () => {
    await expect(
      executeMcpTool("add_elements", { components: [{ type: "and", x: 2, y: 2 }] }, createSnapshot()),
    ).rejects.toThrow(/CircuitContext-Aktionen/);

    const harness = createLiveHarness();
    await expect(
      executeMcpTool(
        "add_elements",
        { components: [{ type: "and", x: 2, y: 2 }] },
        harness.getSnapshot({ isSimulating: true }),
      ),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool(
        "move_elements",
        { symbolIds: ["x"], dx: 1, dy: 1 },
        harness.getSnapshot({ isSimulating: true }),
      ),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("rotate_symbols", { symbolIds: ["x"] }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("delete_elements", { symbolIds: ["x"] }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("connect_wire", { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("set_current_circuit", { circuitId: "main-circuit" }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("update_circuit_properties", { name: "Neu" }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("create_circuits", { circuits: [{ name: "Sub" }] }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);
    await expect(
      executeMcpTool("delete_circuits", { circuitIds: ["sub-1"] }, harness.getSnapshot({ isSimulating: true })),
    ).rejects.toThrow(/Simulation/);

    // Lese-Werkzeuge bleiben während der Simulation verfügbar
    const summary = await executeMcpTool("get_circuit_summary", {}, harness.getSnapshot({ isSimulating: true }));
    expect(summary).toBeDefined();
  });

  it("add_elements platziert auch Einzelbauteile (Gatter, Konstante, Button, Pin, SubCircuit, Textnotiz) mit Undo/Redo", () => {
    const harness = createLiveHarness(createDemoCircuitProject());
    const ctx = harness.getCtx();
    const initialCount = ctx.currentCircuit.circuitSymbols.length;

    let addedAnd!: ReturnType<typeof addElements>;
    let addedConst!: ReturnType<typeof addElements>;
    let addedSub!: ReturnType<typeof addElements>;
    let addedNote!: ReturnType<typeof addElements>;

    React.act(() => {
      addedAnd = addElements(harness.getSnapshot(), {
        components: [{ type: "and", x: 20, y: 6, inputCount: 3, name: "AND3" }],
      });
      addedConst = addElements(harness.getSnapshot(), {
        components: [{ type: "constant", x: 16, y: 6, bitWidth: 4, value: 9, isHex: true }],
      });
      addElements(harness.getSnapshot(), {
        components: [{ type: "button", x: 16, y: 12, isToggle: true, notation: "SW0" }],
      });
      addElements(harness.getSnapshot(), {
        components: [{ type: "pinIn", x: 16, y: 16, notation: "DIN", bitWidth: 2 }],
      });
      addedSub = addElements(harness.getSnapshot(), {
        components: [{ type: "subCircuit", x: 26, y: 6, subCircuitId: "sub-power" }],
      });
      addedNote = addElements(harness.getSnapshot(), {
        components: [{ type: "textNote", x: 20, y: 16, note: "KI-Notiz" }],
      });
    });

    expect(addedAnd.symbols).toHaveLength(1);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(initialCount + 5);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
    expect(ctx.canUndo).toBe(true);

    const constSymbol = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === addedConst.symbols[0].circuitSymbolId,
    );
    expect((constSymbol?.circuit as Constant).value).toBe(9);
    expect((constSymbol?.circuit as Constant).bitWidth).toBe(4);

    const subSymbol = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === addedSub.symbols[0].circuitSymbolId,
    );
    expect(subSymbol?.circuitId).toBe("sub-power");

    const details = getCircuitDetails(harness.getSnapshot(), {});
    expect(details.symbols.some((s) => s.circuitSymbolId === addedAnd.symbols[0].circuitSymbolId)).toBe(true);
    expect(details.textNotes.some((n) => n.textNoteId === addedNote.textNotes[0].textNoteId && n.note === "KI-Notiz")).toBe(true);

    expect(harness.highlightedCalls[0]).toEqual({
      symbolIds: [addedAnd.symbols[0].circuitSymbolId],
      textNoteIds: [],
      wireIds: [],
    });
    expect(harness.highlightedCalls.at(-1)).toEqual({
      symbolIds: [],
      textNoteIds: [addedNote.textNotes[0].textNoteId],
      wireIds: [],
    });

    // Zyklus- und fehlende SubCircuit-ID werden abgewiesen
    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "subCircuit", x: 2, y: 2, subCircuitId: ctx.currentCircuit.logicalCircuitId }],
      }),
    ).toThrow(/Zyklus/);
    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "subCircuit", x: 2, y: 2, subCircuitId: "unbekannt" }],
      }),
    ).toThrow(/nicht gefunden/);

    // Undo/Redo der letzten Textnotiz
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
  });

  it("connect_wire verlegt direkte und orthogonale Leitungen zwischen Jams, aktualisiert ConductorMap und Validierung", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    let pinSymbol!: CircuitSymbol;
    let andSymbol!: CircuitSymbol;
    let wideConst!: CircuitSymbol;

    React.act(() => {
      const batch = addElements(harness.getSnapshot(), {
        components: [
          { ref: "pinA", type: "pinIn", x: 2, y: 4, notation: "A" },
          { ref: "and1", type: "and", x: 10, y: 6, inputCount: 2 },
          { ref: "const4", type: "constant", x: 2, y: 12, bitWidth: 4, value: 3 },
        ],
      });
      pinSymbol = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === batch.symbols[0].circuitSymbolId)!;
      andSymbol = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === batch.symbols[1].circuitSymbolId)!;
      wideConst = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === batch.symbols[2].circuitSymbolId)!;
    });

    let wireResult!: ReturnType<typeof connectWire>;
    React.act(() => {
      wireResult = connectWire(harness.getSnapshot(), {
        from: { symbolId: pinSymbol.circuitSymbolId },
        to: { symbolId: andSymbol.circuitSymbolId, pinName: "In 1" },
        route: "horizontal-first",
      });
    });

    expect(wireResult.wires.length).toBeGreaterThanOrEqual(1);
    expect(wireResult.wires.every((w) => !w.markedBad)).toBe(true);
    expect(wireResult.conductorCount).toBeGreaterThanOrEqual(1);
    expect(ctx.currentCircuit.conductorMap?.conductors.length).toBe(wireResult.conductorCount);
    expect(harness.highlightedCalls.at(-1)).toEqual({ wireIds: wireResult.wires.map((w) => w.wireId) });

    // Bitbreitenkonflikt (4-Bit Constant -> 1-Bit AND-Eingang) wird als markedBad erkannt
    let badResult!: ReturnType<typeof connectWire>;
    React.act(() => {
      badResult = connectWire(harness.getSnapshot(), {
        from: { symbolId: wideConst.circuitSymbolId, jamIndex: 0 },
        to: { symbolId: andSymbol.circuitSymbolId, pinName: "In 2" },
        route: "vertical-first",
      });
    });
    expect(badResult.wires.some((w) => w.markedBad)).toBe(true);

    // Identischer Start/Zielpunkt wird abgelehnt
    expect(() =>
      connectWire(harness.getSnapshot(), {
        from: { x: 4, y: 20 },
        to: { x: 4, y: 20 },
      }),
    ).toThrow(/identisch/);

    const wiresBeforeUndo = ctx.currentCircuit.wires.length;
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.wires.length).toBeLessThan(wiresBeforeUndo);
    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.wires.length).toBe(wiresBeforeUndo);
  });

  it("move_elements und rotate_symbols verschieben/rotieren einzelne oder ganze Gruppen samt Textnotizen und Leitungen mit Undo/Redo", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    let pinId!: string;
    let andId!: string;
    let noteId!: string;
    let wireIds: string[] = [];

    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          { ref: "p", type: "pinIn", x: 2, y: 5 },
          { ref: "a", type: "and", x: 8, y: 6 },
          { type: "textNote", x: 8, y: 12, note: "Drehen" },
        ],
        wires: [{ from: { ref: "p" }, to: { ref: "a", pinName: "In 1" }, route: "horizontal-first" }],
      });
      pinId = added.symbols[0].circuitSymbolId;
      andId = added.symbols[1].circuitSymbolId;
      noteId = added.textNotes[0].textNoteId;
      wireIds = added.wires.map((w) => w.wireId);
    });

    // Gesamte Schaltung (Symbole + Textnotiz + Mehrsegment-Leitungen) gemeinsam verschieben ohne Knick-Verzerrung
    const wiresBeforeGroup = ctx.currentCircuit.wires.map((w) => ({
      id: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
    }));
    expect(wiresBeforeGroup).toHaveLength(2);

    React.act(() => {
      const groupMove = moveElements(harness.getSnapshot(), {
        symbolIds: [pinId, andId],
        textNoteIds: [noteId],
        wireIds,
        dx: 8,
        dy: 4,
      });
      expect(groupMove.dx).toBe(8);
      expect(groupMove.dy).toBe(4);
      expect(groupMove.symbols).toHaveLength(2);
      expect(groupMove.textNotes[0]).toMatchObject({ x: 16, y: 16 });
      expect(groupMove.wires).toHaveLength(wiresBeforeGroup.length);
    });

    for (const prev of wiresBeforeGroup) {
      const shifted = ctx.currentCircuit.wires.find((w) => w.wireId === prev.id)!;
      expect(shifted.x1).toBe(prev.x1 + 8);
      expect(shifted.y1).toBe(prev.y1 + 4);
      expect(shifted.x2).toBe(prev.x2 + 8);
      expect(shifted.y2).toBe(prev.y2 + 4);
    }

    // Undo macht komplette Gruppenverschiebung in einem Schritt rückgängig
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.textNotes.find((n) => n.textNoteId === noteId)).toMatchObject({ x: 8, y: 12 });
    expect(ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === andId)).toMatchObject({ x: 8, y: 6 });

    // Gruppenrotation mit Mehrsegment-Leitungen (inkl. Knickpunkt) hält alle Segmente exakt orthogonal
    React.act(() => {
      const groupRot = rotateSymbolsTool(harness.getSnapshot(), {
        symbolIds: [pinId, andId],
        textNoteIds: [noteId],
        wireIds,
        direction: "clockwise",
        withWires: true,
      });
      expect(groupRot.symbols.every((s) => s.rotation === "right")).toBe(true);
      expect(groupRot.wires).toHaveLength(wireIds.length);
    });

    const rotatedPin = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === pinId)!;
    const rotatedGate = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === andId)!;
    const rotatedOutJam = rotatedPin.jams[0].absolutePoint;
    const rotatedIn1Jam = rotatedGate.jams.find((j) => j.pin.name === "In 1")!.absolutePoint;

    expect(ctx.currentCircuit.wires.every((w) => w.x1 === w.x2 || w.y1 === w.y2)).toBe(true);
    expect(ctx.currentCircuit.conductorMap?.conductors).toHaveLength(1);
    const connectedPts = ctx.currentCircuit.conductorMap!.conductors[0].points;
    expect(connectedPts.some((pt) => pt.x === rotatedOutJam.x && pt.y === rotatedOutJam.y)).toBe(true);
    expect(connectedPts.some((pt) => pt.x === rotatedIn1Jam.x && pt.y === rotatedIn1Jam.y)).toBe(true);

    // Undo Gruppenrotation stellt ursprüngliche Leitungs- und Symbolkoordinaten wieder her
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === andId)?.rotation).toBe("up");
    expect(ctx.currentCircuit.wires.every((w) => w.x1 === w.x2 || w.y1 === w.y2)).toBe(true);

    // Einzelnes Symbol samt Textnotiz rotieren und mit Rubberbanding verschieben
    React.act(() => {
      const rotRes = rotateSymbolsTool(harness.getSnapshot(), {
        symbolIds: [andId],
        textNoteIds: [noteId],
        direction: "clockwise",
        withWires: true,
      });
      expect(rotRes.symbols[0].rotation).toBe("right");
      expect(rotRes.textNoteIds).toEqual([noteId]);
    });

    const rotatedAnd = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === andId)!;
    const rotatedNote = ctx.currentCircuit.textNotes.find((n) => n.textNoteId === noteId)!;
    expect(rotatedAnd.rotation).toBe("right");
    expect(rotatedNote.rotation).toBe("right");

    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === andId)?.rotation).toBe("up");

    React.act(() => {
      const singleMove = moveElements(harness.getSnapshot(), {
        symbolIds: [andId],
        dx: 2,
        dy: 2,
        withWires: true,
      });
      expect(singleMove.symbols[0].x).toBe(10);
      expect(singleMove.symbols[0].y).toBe(8);
      expect(singleMove.wires.length).toBeGreaterThanOrEqual(1);
    });

    expect(() =>
      moveElements(harness.getSnapshot(), { symbolIds: ["unbekannt"], dx: 1, dy: 1 }),
    ).toThrow(/nicht gefunden/);
    expect(() =>
      moveElements(harness.getSnapshot(), { dx: 1, dy: 1 }),
    ).toThrow(/Mindestens/);
  });

  it("delete_elements löscht Symbole, Leitungen und Textnotizen sauber mit Undo/Redo", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    let andId!: string;
    let noteId!: string;
    let wireId!: string;

    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          { type: "and", x: 6, y: 6 },
          { type: "textNote", x: 12, y: 6, note: "Weg" },
        ],
        wires: [{ from: { x: 2, y: 2 }, to: { x: 5, y: 2 } }],
      });
      andId = added.symbols[0].circuitSymbolId;
      noteId = added.textNotes[0].textNoteId;
      wireId = added.wires[0].wireId;
    });

    React.act(() => {
      const delRes = deleteElements(harness.getSnapshot(), {
        symbolIds: [andId],
        wireIds: [wireId],
        textNoteIds: [noteId],
      });
      expect(delRes.deleted).toEqual({
        symbolIds: [andId],
        wireIds: [wireId],
        textNoteIds: [noteId],
      });
      expect(delRes.remainingCounts).toEqual({ symbols: 0, wires: 0, textNotes: 0 });
    });

    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);
    expect(ctx.currentCircuit.wires).toHaveLength(0);
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    expect(ctx.currentCircuit.conductorMap?.conductors).toHaveLength(0);

    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.wires).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
  });

  it("add_elements platziert einen kompletten HalfAdder atomar mit ref-Verknüpfungen in einem Undo-Schritt", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    let batchResult!: ReturnType<typeof addElements>;
    React.act(() => {
      batchResult = addElements(harness.getSnapshot(), {
        components: [
          { ref: "btnA", type: "button", x: 2, y: 4, isToggle: true, notation: "A" },
          { ref: "btnB", type: "button", x: 2, y: 10, isToggle: true, notation: "B" },
          { ref: "xorSum", type: "xor", x: 9, y: 3, inputCount: 2 },
          { ref: "andCarry", type: "and", x: 9, y: 9, inputCount: 2 },
          { ref: "ledSum", type: "led", x: 15, y: 4, color: "green" },
          { ref: "ledCarry", type: "led", x: 15, y: 10, color: "yellow" },
          { ref: "title", type: "textNote", x: 2, y: 1, note: "HalfAdder" },
          { type: "textNote", x: 18, y: 4, note: "Sum" },
          { type: "textNote", x: 18, y: 10, note: "Carry" },
        ],
        wires: [
          { from: { ref: "btnA" }, to: { x: 6, y: 5 }, route: "direct" },
          { from: { x: 6, y: 5 }, to: { ref: "xorSum", pinName: "In 1" }, route: "vertical-first" },
          { from: { x: 6, y: 5 }, to: { ref: "andCarry", pinName: "In 1" }, route: "vertical-first" },
          { from: { ref: "btnB" }, to: { x: 7, y: 11 }, route: "direct" },
          { from: { x: 7, y: 11 }, to: { ref: "xorSum", pinName: "In 2" }, route: "vertical-first" },
          { from: { x: 7, y: 11 }, to: { ref: "andCarry", pinName: "In 2" }, route: "vertical-first" },
          { from: { ref: "xorSum", pinName: "Out" }, to: { ref: "ledSum" }, route: "direct" },
          { from: { ref: "andCarry", pinName: "Out" }, to: { ref: "ledCarry" }, route: "direct" },
        ],
      });
    });

    expect(batchResult.symbols).toHaveLength(6);
    expect(batchResult.textNotes).toHaveLength(3);
    expect(batchResult.wires).toHaveLength(12);
    expect(batchResult.wires.every((w) => !w.markedBad)).toBe(true);
    expect(batchResult.conductorCount).toBe(4);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(6);
    expect(ctx.currentCircuit.textNotes).toHaveLength(3);
    expect(ctx.currentCircuit.wires).toHaveLength(12);
    expect(ctx.history.entries).toHaveLength(1);
    expect(harness.highlightedCalls.at(-1)).toEqual({
      symbolIds: batchResult.symbols.map((s) => s.circuitSymbolId),
      textNoteIds: batchResult.textNotes.map((n) => n.textNoteId),
      wireIds: batchResult.wires.map((w) => w.wireId),
    });

    // Ein einziger Undo-Schritt entfernt den gesamten HalfAdder wieder
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    expect(ctx.currentCircuit.wires).toHaveLength(0);

    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(6);
    expect(ctx.currentCircuit.textNotes).toHaveLength(3);
    expect(ctx.currentCircuit.wires).toHaveLength(12);

    // Bestehende symbolId und neue ref lassen sich in wires kombinieren
    const existingPinId = batchResult.symbols[0].circuitSymbolId;
    React.act(() => {
      const ext = addElements(harness.getSnapshot(), {
        components: [{ ref: "probeOut", type: "probe", x: 18, y: 6 }],
        wires: [{ from: { symbolId: existingPinId }, to: { ref: "probeOut" }, route: "horizontal-first" }],
      });
      expect(ext.symbols).toHaveLength(1);
      expect(ext.wires.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("add_elements bricht bei ungültigen Referenzen atomar ab, ohne Teiländerungen zu hinterlassen", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    expect(() => addElements(harness.getSnapshot(), { components: [], wires: [] })).toThrow(/Mindestens/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [
          { ref: "dup", type: "and", x: 2, y: 2 },
          { ref: "dup", type: "or", x: 8, y: 2 },
        ],
      }),
    ).toThrow(/Doppelte Referenz/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ ref: "g1", type: "and", x: 2, y: 2 }],
        wires: [{ from: { ref: "g1", pinName: "Out" }, to: { ref: "gibtEsNicht" } }],
      }),
    ).toThrow(/nicht gefunden/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [
          { ref: "note1", type: "textNote", x: 2, y: 2, note: "Text" },
          { ref: "g1", type: "and", x: 8, y: 2 },
        ],
        wires: [{ from: { ref: "note1" }, to: { ref: "g1", pinName: "In 1" } }],
      }),
    ).toThrow(/Textnotiz/);

    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    expect(ctx.currentCircuit.wires).toHaveLength(0);
  });

  it("create_circuits, set_current_circuit, update_circuit_properties und delete_circuits verwalten Schaltungen inkl. Schutzprüfungen", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();
    const mainCircuitId = ctx.currentCircuit.logicalCircuitId;

    // Mehrere Sub-Schaltungen in einem Aufruf erstellen (inkl. Namens-Kollisionserkennung bei IDs)
    let created!: ReturnType<typeof createCircuitsTool>;
    React.act(() => {
      created = createCircuitsTool(harness.getSnapshot(), {
        circuits: [
          { name: "FullAdder1Bit", category: "Arithmetik", note: "1-Bit Volladdierer" },
          { name: "HalfAdder1Bit", category: "Arithmetik" },
        ],
      });
    });

    expect(created.circuits).toHaveLength(2);
    expect(created.totalCircuits).toBe(3);
    const faId = created.circuits[0].logicalCircuitId;
    const haId = created.circuits[1].logicalCircuitId;
    expect(faId).not.toBe(haId);

    // In FullAdder1Bit wechseln und Pins hinzufügen
    React.act(() => {
      const switched = setCurrentCircuit(harness.getSnapshot(), { circuitId: faId });
      expect(switched.previousCircuitId).toBe(mainCircuitId);
      expect(switched.currentCircuitId).toBe(faId);
    });
    expect(ctx.currentCircuit.logicalCircuitId).toBe(faId);

    React.act(() => {
      addElements(harness.getSnapshot(), {
        components: [
          { type: "pinIn", name: "A", x: 2, y: 2 },
          { type: "pinOut", name: "S", x: 10, y: 2 },
        ],
      });
    });

    // Properties der aktiven Schaltung anpassen + Undo/Redo testen
    expect(() =>
      updateCircuitPropertiesTool(harness.getSnapshot(), { circuitShape: "display" }),
    ).toThrow(/Display-Element/);

    React.act(() => {
      const updated = updateCircuitPropertiesTool(harness.getSnapshot(), {
        name: "FA_1Bit",
        notation: "FA",
        category: "Logik",
        note: "Aktualisierte Notiz",
        circuitShape: "alu",
        showLabelAbove: true,
      });
      expect(updated.name).toBe("FA_1Bit");
      expect(updated.notation).toBe("FA");
      expect(updated.category).toBe("Logik");
      expect(updated.note).toBe("Aktualisierte Notiz");
      expect(updated.circuitShape).toBe("alu");
      expect(updated.showLabelAbove).toBe(true);
    });
    expect(ctx.currentCircuit.name).toBe("FA_1Bit");
    expect(ctx.currentCircuit.circuitShape).toBe("alu");

    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.name).toBe("FullAdder1Bit");

    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.name).toBe("FA_1Bit");

    // Zurück zur Hauptschaltung wechseln und FA_1Bit als SubCircuit einbetten
    React.act(() => {
      setCurrentCircuit(harness.getSnapshot(), { circuitId: mainCircuitId });
    });

    let embeddedId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [{ type: "subCircuit", subCircuitId: faId, x: 4, y: 4 }],
      });
      embeddedId = added.symbols[0].circuitSymbolId;
    });

    // Referenzierte Schaltung darf nicht gelöscht werden
    expect(() =>
      deleteCircuitsTool(harness.getSnapshot(), { circuitIds: [faId] }),
    ).toThrow(/Sub-Schaltung/);

    // SubCircuit-Instanz entfernen, in faId wechseln und beide erstellten Schaltungen löschen
    React.act(() => {
      deleteElements(harness.getSnapshot(), { symbolIds: [embeddedId] });
      setCurrentCircuit(harness.getSnapshot(), { circuitId: faId });
    });
    expect(ctx.currentCircuit.logicalCircuitId).toBe(faId);

    React.act(() => {
      const deleted = deleteCircuitsTool(harness.getSnapshot(), { circuitIds: [faId, haId] });
      expect(deleted.deletedCircuitIds).toEqual([faId, haId]);
      expect(deleted.currentCircuitId).toBe(mainCircuitId);
      expect(deleted.remainingCircuits).toHaveLength(1);
    });
    expect(ctx.currentCircuit.logicalCircuitId).toBe(mainCircuitId);

    // Letzte verbleibende Schaltung darf nicht gelöscht werden
    expect(() =>
      deleteCircuitsTool(harness.getSnapshot(), { circuitIds: [mainCircuitId] }),
    ).toThrow(/Mindestens eine Schaltung/);
  });

  it("markiert von der KI geänderte Elemente zeitlich begrenzt und rendert die Canvas-Hervorhebung", () => {
    const project = createDemoCircuitProject();
    const circuit = project.logicalCircuits[0];
    const targetSymbol = circuit.circuitSymbols[0];
    const targetWire = circuit.wires[0];

    // Canvas-Rendering mit aktiven AI-Highlight-IDs prüfen
    const html = renderToStaticMarkup(
      React.createElement(CircuitContextProvider, {
        initialProject: project,
        children: React.createElement(SimulationContextProvider, {
          children: React.createElement(CanvasContext.Provider, {
            value: {
              viewport: { panX: 36, panY: 36, zoom: 1 },
              setViewport: () => {},
              cursor: null,
              setCursor: () => {},
              zoomIn: () => {},
              zoomOut: () => {},
              resetZoom: () => {},
              resetView: () => {},
              selectedCount: 0,
              setSelectedCount: () => {},
              aiHighlightedIds: {
                symbolIds: [targetSymbol.circuitSymbolId],
                textNoteIds: [],
                wireIds: [targetWire.wireId],
              },
              highlightAiElements: () => {},
              hasClipboardContent: false,
              setHasClipboardContent: () => {},
              refreshClipboardAvailability: async () => false,
              registerClipboardActions: () => {},
              copySelection: async () => false,
              cutSelection: async () => false,
              pasteFromClipboard: async () => {},
            },
            children: React.createElement(CircuitCanvas, null),
          }),
        }),
      }),
    );

    expect(html).toContain(`data-symbol-id="${targetSymbol.circuitSymbolId}"`);
    expect(html).toContain("data-ai-highlighted=\"true\"");
    expect(html).toContain("ai-highlight-box");
    expect(html).toContain("wire-ai-highlight");

    // Zeitablauf des Highlight-Timers im CanvasContextProvider verifizieren
    vi.useFakeTimers();
    try {
      let canvasCtx!: React.ContextType<typeof CanvasContext>;
      const CaptureCanvas: React.FC = () => {
        canvasCtx = React.useContext(CanvasContext);
        return null;
      };

      renderToStaticMarkup(
        React.createElement(
          CanvasContextProvider,
          null,
          React.createElement(CaptureCanvas, null),
        ),
      );

      React.act(() => {
        canvasCtx.highlightAiElements({ symbolIds: ["sym-ai"], wireIds: ["wire-ai"] }, 200);
      });
      vi.advanceTimersByTime(250);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("get_component_catalog (Single Source of Truth)", () => {
  it("hält Registry, ALLOWED_COMPONENT_TYPES und toolDefinitions.json synchron", () => {
    const allowedTypes = getAllowedComponentTypes().slice().sort();
    const registeredGates = getRegisteredPaletteGateTypes();
    expect(allowedTypes).toEqual([...registeredGates, "subCircuit", "textNote"].sort());

    const catalogTool = MCP_TOOL_DEFINITIONS.find((t) => t.name === "get_component_catalog");
    const addTool = MCP_TOOL_DEFINITIONS.find((t) => t.name === "add_elements");
    const updateElementTool = MCP_TOOL_DEFINITIONS.find((t) => t.name === "update_element_properties");
    expect(catalogTool).toBeDefined();
    expect(addTool).toBeDefined();
    expect(updateElementTool).toBeDefined();

    const catalogCategoryEnum = (
      (catalogTool?.inputSchema.properties as Record<string, { enum?: string[] }>)?.category?.enum ?? []
    );
    const catalogTypeEnum = (
      (catalogTool?.inputSchema.properties as Record<string, { enum?: string[] }>)?.type?.enum ?? []
    ).slice().sort();
    const addComponentsSchema = (
      (addTool?.inputSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>)
        ?.components?.items?.properties ?? {}
    );
    const updateElementSchema = (
      (updateElementTool?.inputSchema.properties as Record<string, unknown>) ?? {}
    );
    const addTypeEnum = ((addComponentsSchema.type as { enum?: string[] })?.enum ?? []).slice().sort();

    expect(catalogCategoryEnum).toEqual(COMPONENT_PALETTE_CATEGORIES);
    expect(catalogTypeEnum).toEqual(allowedTypes);
    expect(addTypeEnum).toEqual(allowedTypes);

    // Jede in der Registry als settableOnCreate=true bzw. settableOnUpdate=true deklarierte Eigenschaft muss im Schema existieren
    const fullCatalog = buildComponentCatalog({ includeAliases: true, includeSubCircuits: false });
    for (const entry of fullCatalog.components) {
      for (const prop of entry.properties) {
        if (prop.settableOnCreate) {
          expect(Object.hasOwn(addComponentsSchema, prop.name)).toBe(true);
        }
        if (prop.settableOnUpdate) {
          expect(Object.hasOwn(updateElementSchema, prop.name)).toBe(true);
        }
      }
    }
  });

  it("liefert auf einem leeren Projekt den vollständigen Katalog inkl. Taster-/Schalter- und Resize-Infos", async () => {
    const emptyProject = createEmptyCircuitProject("Leeres Projekt", "Main", "main-empty");
    const emptySnapshot: McpCircuitSnapshot = {
      project: emptyProject,
      currentCircuit: emptyProject.logicalCircuits[0],
      selectedSymbolIds: [],
      selectedTextNoteIds: [],
    };

    const catalog = await executeMcpTool("get_component_catalog", {}, emptySnapshot) as ComponentCatalogResponse;
    expect(catalog.gridUnitPixels).toBe(GRID_SIZE);
    expect(catalog.categories).toEqual(["io", "displays", "gates", "decoration", "circuits"]);
    expect(catalog.components.some((c) => c.type === "sensor")).toBe(true);
    expect(catalog.components.some((c) => c.type === "pin")).toBe(false);

    const gatesCatalog = getComponentCatalogTool(emptySnapshot, {
      category: "gates",
      includeSubCircuits: false,
    });
    expect(gatesCatalog.components.length).toBeGreaterThan(0);
    expect(gatesCatalog.components.every((c) => c.paletteCategory === "gates")).toBe(true);

    const ioCatalog = getComponentCatalogTool(emptySnapshot, {
      category: "io",
      includeSubCircuits: false,
    });
    expect(ioCatalog.components.length).toBeGreaterThan(0);
    expect(ioCatalog.components.every((c) => c.paletteCategory === "io")).toBe(true);

    const button = catalog.components.find((c) => c.type === "button");
    expect(button).toBeDefined();
    expect(button?.defaultSize).toEqual({ width: 2, height: 2 });
    expect(button?.resizable).toBe(true);
    expect(button?.minSize).toEqual({ width: 2, height: 2 });
    expect(button?.maxSize).toEqual({ width: 20, height: 20 });
    expect(button?.hasDynamicPinLayout).toBe(true);
    expect(button?.pinLayoutDependsOn).toContain("pinSide");
    expect(button?.pins).toEqual([
      {
        name: "Out",
        pinType: "output",
        pinSide: "right",
        bitWidth: 1,
        inverted: false,
        gridPoint: { x: 2, y: 1 },
      },
    ]);

    const toggleProp = button?.properties.find((p) => p.name === "isToggle");
    const pinSideProp = button?.properties.find((p) => p.name === "pinSide");
    expect(toggleProp?.settableOnCreate).toBe(true);
    expect(pinSideProp?.enumValues).toEqual(["left", "top", "right", "bottom"]);

    expect(catalog.subCircuits).toHaveLength(1);
    expect(catalog.subCircuits?.[0].logicalCircuitId).toBe("main-empty");
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  it("berechnet mit 'preview' dynamische Größen und Pin-Positionen über die echten Factories", () => {
    const snapshot = createSnapshot();

    const resizedButton = getComponentCatalogTool(snapshot, {
      type: "button",
      includeSubCircuits: false,
      preview: { pinSide: "bottom", width: 4, height: 3, isToggle: true },
    });
    expect(resizedButton.components).toHaveLength(1);
    expect(resizedButton.components[0].defaultSize).toEqual({ width: 4, height: 3 });
    expect(resizedButton.components[0].pins[0]).toMatchObject({
      name: "Out",
      pinSide: "bottom",
      gridPoint: { x: 2, y: 3 },
    });

    const selectorMatrix = getComponentCatalogTool(snapshot, {
      type: "ledMatrix",
      includeSubCircuits: false,
      preview: { matrixType: "selector", rows: 5, columns: 6 },
    });
    expect(selectorMatrix.components[0].defaultSize).toEqual({ width: 7, height: 6 });
    expect(selectorMatrix.components[0].pins).toHaveLength(11);
    expect(selectorMatrix.components[0].pins.filter((p) => p.pinSide === "top")).toHaveLength(6);
    expect(selectorMatrix.components[0].pins.filter((p) => p.pinSide === "left")).toHaveLength(5);

    const subPreview = getComponentCatalogTool(snapshot, {
      type: "subCircuit",
      includeSubCircuits: false,
      preview: { subCircuitId: "sub-power" },
    });
    expect(subPreview.components[0].pins.some((p) => p.name === "VCC")).toBe(true);

    expect(() =>
      getComponentCatalogTool(snapshot, { preview: { inputCount: 4 } }),
    ).toThrow(/zusammen mit "type"/);
  });

  it("platziert sensor, resizte Bausteine & alle neuen Properties über add_elements und liefert sie in get_circuit_details", () => {
    const harness = createLiveHarness(createEmptyCircuitProject("T056", "Main", "main-t056"));
    let added!: ReturnType<typeof addElements>;

    React.act(() => {
      added = addElements(harness.getSnapshot(), {
        components: [
          {
            ref: "btn1",
            type: "button",
            x: 2,
            y: 2,
            width: 4,
            height: 3,
            isToggle: true,
            pinSide: "bottom",
            inverted: true,
            keyCode: 44,
            modifiers: 1,
            notation: "SW",
            note: "Großer Schalter",
          },
          {
            ref: "sens1",
            type: "sensor",
            x: 10,
            y: 2,
            sensorType: "series",
            data: "0:1,5:F",
            bitWidth: 4,
            pinSide: "right",
            notation: "SEQ",
            note: "Zählerfolge",
          },
          {
            ref: "probe1",
            type: "probe",
            x: 18,
            y: 2,
            width: 3,
            height: 2,
            pinSide: "left",
            displayFormat: "dec",
            notation: "OUT",
          },
          {
            ref: "mat1",
            type: "ledMatrix",
            x: 24,
            y: 2,
            rows: 3,
            columns: 4,
            matrixType: "selector",
            cellShape: "rect",
            colors: 2,
            persistenceMultiplier: 3,
            rotation: "right",
          },
          {
            ref: "pin1",
            type: "pinIn",
            x: 2,
            y: 10,
            width: 3,
            height: 3,
            pinSide: "top",
            inverted: true,
            bitWidth: 4,
            rotation: "right",
            notation: "DIN",
          },
          {
            type: "textNote",
            x: 10,
            y: 10,
            note: "Info",
            width: 8,
            height: 3,
            fontFamily: "sans",
            lineHeight: 36,
            rotation: "right",
          },
        ],
        wires: [
          { from: { ref: "sens1", pinName: "Out" }, to: { ref: "probe1", pinName: "In" }, route: "horizontal-first" },
        ],
      });
    });

    expect(added.symbols).toHaveLength(5);
    expect(added.textNotes).toHaveLength(1);
    expect(added.wires.length).toBeGreaterThanOrEqual(1);

    const details = getCircuitDetails(harness.getSnapshot(), {});
    expect(JSON.parse(JSON.stringify(details))).toEqual(details);

    const btnDetail = details.symbols.find((s) => s.kind === "circuitButton") as Record<string, unknown>;
    expect(btnDetail).toMatchObject({
      width: 4,
      height: 3,
      isToggle: true,
      pinSide: "bottom",
      inverted: true,
      keyCode: 44,
      modifiers: 1,
      notation: "SW",
      note: "Großer Schalter",
    });

    const sensorDetail = details.symbols.find((s) => s.kind === "sensor") as Record<string, unknown>;
    expect(sensorDetail).toMatchObject({
      sensorType: "series",
      data: "0:1,5:F",
      bitWidth: 4,
      pinSide: "right",
      notation: "SEQ",
      note: "Zählerfolge",
    });

    const probeDetail = details.symbols.find((s) => s.kind === "circuitProbe") as Record<string, unknown>;
    expect(probeDetail).toMatchObject({
      width: 3,
      height: 2,
      pinSide: "left",
      displayFormat: "dec",
      isHex: false,
    });

    const matrixDetail = details.symbols.find((s) => s.kind === "ledMatrix") as Record<string, unknown>;
    expect(matrixDetail).toMatchObject({
      rows: 3,
      columns: 4,
      matrixType: "selector",
      cellShape: "rect",
      colors: 2,
      persistenceMultiplier: 3,
      rotation: "right",
    });

    const pinDetail = details.symbols.find((s) => s.kind === "pin") as Record<string, unknown>;
    expect(pinDetail).toMatchObject({
      pinType: "input",
      pinSide: "top",
      inverted: true,
      bitWidth: 4,
      width: 3,
      height: 3,
      rotation: "right",
    });

    expect(details.textNotes[0]).toMatchObject({
      width: 8,
      height: 3,
      fontFamily: "sans",
      lineHeight: 36,
      rotation: "right",
      note: "Info",
    });
  });

  it("erzwingt desktop-kompatible Größenlimits bei add_elements, Factory und resizeCircuitSymbol", () => {
    const clampedBtn = createCircuitButton("btn-clamp", "B", false, "right", false, 99, 1);
    expect(clampedBtn.symbolWidth).toBe(20);
    expect(clampedBtn.symbolHeight).toBe(2);

    const harness = createLiveHarness(createEmptyCircuitProject("Limits", "Main", "main-limits"));
    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "button", x: 1, y: 1, width: 21, height: 2 }],
      }),
    ).toThrow(/höchstens 20/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "and", x: 1, y: 1, width: 5, height: 5 }],
      }),
    ).toThrow(/nicht unterstützt/);

    React.act(() => {
      addElements(harness.getSnapshot(), {
        components: [{ type: "button", x: 2, y: 2 }],
      });
    });
    const btnId = harness.getCtx().currentCircuit.circuitSymbols[0].circuitSymbolId;
    let resized: CircuitSymbol | null = null;
    React.act(() => {
      resized = harness.getCtx().resizeCircuitSymbol(btnId, { x: 2, y: 2, width: 99, height: 99 });
    });
    expect(resized!.circuit.symbolWidth).toBe(20);
    expect(resized!.circuit.symbolHeight).toBe(20);
  });
});

describe("update_element_properties", () => {
  it("aktualisiert Button-Properties inkl. Resize, Wire-Rubberbanding, Jam-Neuberechnung, AI-Highlight und Undo/Redo", () => {
    const harness = createLiveHarness();

    let btnId = "";
    let ledId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          { type: "button", x: 2, y: 2, isToggle: false, pinSide: "right", width: 2, height: 2 },
          { type: "led", x: 8, y: 3, color: "red" },
        ],
      });
      btnId = added.symbols[0].circuitSymbolId;
      ledId = added.symbols[1].circuitSymbolId;
    });

    const beforeDetails = getCircuitDetails(harness.getSnapshot(), {});
    const btnBefore = beforeDetails.symbols.find((s) => s.circuitSymbolId === btnId)!;
    expect(btnBefore.jams[0]).toMatchObject({ x: 4, y: 3 });

    React.act(() => {
      connectWire(harness.getSnapshot(), {
        from: { symbolId: btnId },
        to: { symbolId: ledId },
      });
    });

    let updateResult: Record<string, unknown> = {};
    React.act(() => {
      updateResult = updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: btnId,
        isToggle: true,
        pinSide: "top",
        width: 4,
        height: 3,
        inverted: true,
        notation: "PWR",
        withWires: true,
      }) as Record<string, unknown>;
    });

    expect(updateResult.targetType).toBe("symbol");
    const returnedSym = updateResult.symbol as Record<string, unknown>;
    expect(returnedSym.circuitSymbolId).toBe(btnId);

    const afterDetails = getCircuitDetails(harness.getSnapshot(), {});
    const updatedBtn = afterDetails.symbols.find((s) => s.circuitSymbolId === btnId)!;
    expect(updatedBtn).toMatchObject({
      x: 2,
      y: 2,
      width: 4,
      height: 3,
      isToggle: true,
      pinSide: "top",
      inverted: true,
      notation: "PWR",
    });
    // Pin auf "top" bei x=2, width=4 -> (4, 2)
    expect(updatedBtn.jams[0]).toMatchObject({ x: 4, y: 2 });

    // Verdrahtung wurde per Rubberbanding mitgezogen und am neuen Pin verbunden
    expect(afterDetails.wires.some((w) =>
      (w.x1 === 4 && w.y1 === 2) || (w.x2 === 4 && w.y2 === 2),
    )).toBe(true);

    // AI-Highlight wurde auf Symbol und betroffene Wires ausgelöst
    expect(harness.highlightedCalls.at(-1)?.symbolIds).toEqual([btnId]);

    // Undo stellt ursprüngliche Größe, Pin-Seite und Verdrahtung atomar wieder her
    React.act(() => {
      harness.getCtx().undo();
    });
    const undoDetails = getCircuitDetails(harness.getSnapshot(), {});
    const revertedBtn = undoDetails.symbols.find((s) => s.circuitSymbolId === btnId)!;
    expect(revertedBtn).toMatchObject({
      x: 2,
      y: 2,
      width: 2,
      height: 2,
      isToggle: false,
      pinSide: "right",
      inverted: false,
    });
    expect(revertedBtn.jams[0]).toMatchObject({ x: 4, y: 3 });

    // Redo wendet die Änderung erneut sauber an
    React.act(() => {
      harness.getCtx().redo();
    });
    const redoDetails = getCircuitDetails(harness.getSnapshot(), {});
    const redoneBtn = redoDetails.symbols.find((s) => s.circuitSymbolId === btnId)!;
    expect(redoneBtn).toMatchObject({ width: 4, height: 3 });
    expect(redoneBtn.jams[0]).toMatchObject({ x: 4, y: 2 });
  });

  it("aktualisiert Gate-, LED-, LED-Matrix-, Sensor-, Probe- und Pin-Properties inkl. Subschaltungs-Sync", () => {
    const harness = createLiveHarness();

    let gateId = "";
    let ledId = "";
    let matrixId = "";
    let sensorId = "";
    let probeId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          { type: "and", x: 2, y: 2, inputCount: 2 },
          { type: "led", x: 2, y: 10, color: "red" },
          { type: "ledMatrix", x: 10, y: 2, rows: 3, columns: 3, matrixType: "selector", cellShape: "rect" },
          { type: "sensor", x: 2, y: 16, sensorType: "random", data: "5" },
          { type: "probe", x: 10, y: 16, displayFormat: "bin" },
        ],
      });
      gateId = added.symbols[0].circuitSymbolId;
      ledId = added.symbols[1].circuitSymbolId;
      matrixId = added.symbols[2].circuitSymbolId;
      sensorId = added.symbols[3].circuitSymbolId;
      probeId = added.symbols[4].circuitSymbolId;
    });

    React.act(() => {
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: gateId,
        inputCount: 3,
        invertedOutput: true,
        gateType: "or",
        note: "NOR3",
      });
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: ledId,
        color: "green",
      });
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: matrixId,
        rows: 4,
        columns: 5,
        matrixType: "individual",
        cellShape: "round",
        colors: 2,
        persistenceMultiplier: 3,
      });
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: sensorId,
        sensorType: "clock",
        data: "10",
        bitWidth: 4,
        pinSide: "bottom",
      });
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: probeId,
        displayFormat: "hex",
        notation: "HEX",
        width: 5,
        height: 4,
      });
    });

    const details = getCircuitDetails(harness.getSnapshot(), {});
    const gate = details.symbols.find((s) => s.circuitSymbolId === gateId)!;
    expect(gate).toMatchObject({
      gateType: "or",
      inputCount: 3,
      invertedOutput: true,
      note: "NOR3",
    });
    expect(gate.jams).toHaveLength(4);

    const led = details.symbols.find((s) => s.circuitSymbolId === ledId)!;
    expect(led).toMatchObject({ color: "green" });

    const matrix = details.symbols.find((s) => s.circuitSymbolId === matrixId)!;
    expect(matrix).toMatchObject({
      rows: 4,
      columns: 5,
      matrixType: "individual",
      cellShape: "round",
      colors: 2,
      persistenceMultiplier: 3,
      width: 6,
      height: 5,
    });

    const sensor = details.symbols.find((s) => s.circuitSymbolId === sensorId)!;
    expect(sensor).toMatchObject({
      sensorType: "clock",
      data: "10",
      bitWidth: 4,
      pinSide: "bottom",
    });

    const probe = details.symbols.find((s) => s.circuitSymbolId === probeId)!;
    expect(probe).toMatchObject({
      displayFormat: "hex",
      name: "HEX",
      notation: "?\nHEX",
      width: 5,
      height: 4,
    });

    // Pin-Update synchronisiert auch eingebundene Subschaltungs-Symbole
    let subCircuitId = "";
    let pinId = "";
    React.act(() => {
      const created = harness.getCtx().createCircuits([{ name: "SubChip" }]);
      subCircuitId = created[0].logicalCircuitId;
      harness.getCtx().setCurrentCircuitId(subCircuitId);
    });
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [{ type: "pinIn", x: 2, y: 2, notation: "A", bitWidth: 1 }],
      });
      pinId = added.symbols[0].circuitSymbolId;
    });
    React.act(() => {
      const mainId = harness.getCtx().project.logicalCircuits[0].logicalCircuitId;
      harness.getCtx().setCurrentCircuitId(mainId);
    });
    React.act(() => {
      addElements(harness.getSnapshot(), {
        components: [{ type: "subCircuit", x: 20, y: 20, subCircuitId }],
      });
    });
    React.act(() => {
      harness.getCtx().setCurrentCircuitId(subCircuitId);
    });
    React.act(() => {
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: pinId,
        pinType: "output",
        bitWidth: 4,
        pinSide: "left",
        notation: "OUT4",
      });
    });

    const subDetails = getCircuitDetails(harness.getSnapshot(), {});
    const updatedPin = subDetails.symbols.find((s) => s.circuitSymbolId === pinId)!;
    expect(updatedPin).toMatchObject({
      pinType: "output",
      bitWidth: 4,
      pinSide: "left",
      name: "OUT4",
      notation: "Out: OUT4",
    });

    // Im Main-Circuit muss das eingebettete Subschaltungssymbol ebenfalls aktualisiert worden sein
    const mainCircuit = harness.getCtx().project.logicalCircuits[0];
    const subSym = mainCircuit.circuitSymbols.find((s) => s.circuit.circuitId === subCircuitId);
    expect(subSym).toBeDefined();
    expect(subSym!.circuit.pins[0]?.bitWidth).toBe(4);
    expect(subSym!.circuit.pins[0]?.name).toBe("OUT4");
  });

  it("aktualisiert TextNotes inkl. Text, Größe, Rotation und Undo/Redo", () => {
    const harness = createLiveHarness();

    let noteId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [{ type: "textNote", x: 3, y: 4, note: "Alt", width: 8, height: 3 }],
      });
      noteId = added.textNotes[0].textNoteId;
    });

    let res: Record<string, unknown> = {};
    React.act(() => {
      res = updateElementPropertiesTool(harness.getSnapshot(), {
        textNoteId: noteId,
        note: "Neu",
        x: 5,
        y: 6,
        width: 12,
        height: 4,
        rotation: "right",
        fontFamily: "mono",
        lineHeight: 36,
      }) as Record<string, unknown>;
    });

    expect(res.targetType).toBe("textNote");
    expect((res.textNote as Record<string, unknown>).textNoteId).toBe(noteId);

    const updated = getCircuitDetails(harness.getSnapshot(), {}).textNotes.find((n) => n.textNoteId === noteId)!;
    expect(updated).toMatchObject({
      x: 5,
      y: 6,
      width: 12,
      height: 4,
      note: "Neu",
      rotation: "right",
      fontFamily: "mono",
      lineHeight: 36,
    });
    expect(harness.highlightedCalls.at(-1)?.textNoteIds).toEqual([noteId]);

    React.act(() => {
      harness.getCtx().undo();
    });
    const reverted = getCircuitDetails(harness.getSnapshot(), {}).textNotes.find((n) => n.textNoteId === noteId)!;
    expect(reverted).toMatchObject({ x: 3, y: 4, width: 8, height: 3, note: "Alt", rotation: "up" });
  });

  it("lehnt ungültige Parameter, laufende Simulation, Subschaltungen und Rotation auf Symbolen sauber ab", () => {
    const harness = createLiveHarness();

    let btnId = "";
    let gateId = "";
    let noteId = "";
    let subCircuitId = "";
    let subSymId = "";

    React.act(() => {
      const created = harness.getCtx().createCircuits([{ name: "Helper" }]);
      subCircuitId = created[0].logicalCircuitId;
      const added = addElements(harness.getSnapshot(), {
        components: [
          { type: "button", x: 1, y: 1 },
          { type: "and", x: 6, y: 1 },
          { type: "textNote", x: 12, y: 1, note: "Info" },
          { type: "subCircuit", x: 18, y: 1, subCircuitId },
        ],
      });
      btnId = added.symbols[0].circuitSymbolId;
      gateId = added.symbols[1].circuitSymbolId;
      noteId = added.textNotes[0].textNoteId;
      subSymId = added.symbols[2].circuitSymbolId;
    });

    // Aktive Simulation blockiert
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot({ isSimulating: true }), {
        symbolId: btnId,
        notation: "X",
      }),
    ).toThrow(/laufenden Simulation/);

    // Weder symbolId noch textNoteId
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { notation: "X" }),
    ).toThrow(/symbolId.*textNoteId/);

    // Beide gleichzeitig
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: btnId,
        textNoteId: noteId,
        notation: "X",
      }),
    ).toThrow(/nicht gleichzeitig/);

    // Unbekannte ID
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: "does-not-exist",
        notation: "X",
      }),
    ).toThrow(/nicht gefunden/);

    // Unzulässige Property auf AND-Gatter
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: gateId,
        isToggle: true,
      }),
    ).toThrow(/nicht unterstützt/);

    // Rotation auf Symbol verweist auf rotate_symbols
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: gateId,
        rotation: "right",
      }),
    ).toThrow(/rotate_symbols/);

    // withWires auf TextNote verboten
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        textNoteId: noteId,
        note: "Neu",
        withWires: false,
      }),
    ).toThrow(/withWires/);

    // Größenlimit auf Button
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: btnId,
        width: 21,
      }),
    ).toThrow(/höchstens 20/);

    // Subschaltungs-Instanz verweist auf update_circuit_properties
    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: subSymId,
        notation: "NEW",
      }),
    ).toThrow(/update_circuit_properties/);
  });
});
