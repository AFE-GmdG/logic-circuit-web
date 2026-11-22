import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type GraphicsArray from "../types/circuit/graphicsArray";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpSimulationActions from "../types/mcp/mcpSimulationActions";
import { STATE_ON0, STATE_ON1 } from "../types/simulation/state";

import {
  addElements,
  executeMcpTool,
  getCircuitDetails,
  getComponentCatalogTool,
  updateElementPropertiesTool,
} from "../mcp/mcpTools";
import CircuitException from "../simulation/compiler/circuitException";
import CircuitMap, { getGraphicsArrayInstanceId } from "../simulation/compiler/circuitMap";
import FunctionGraphicsArray from "../simulation/functions/io/functionGraphicsArray";
import CircuitState from "../simulation/state/circuitState";
import CircuitRunner from "../simulation/worker/circuitRunner";
import SimulationClient from "../simulation/worker/simulationClient";
import { prepareCircuitSvgClone } from "../utils/circuitCapture";
import {
  circuitContainsDisplays,
  createCircuitButton,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGraphicsArray,
  createPinCircuit,
  getGraphicsArrayAddressBitWidth,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import { GRID_SIZE } from "../utils/coordinateSystem";
import {
  clampGraphicsArrayBitsPerPixel,
  clampGraphicsArrayDataBitWidth,
  clampGraphicsArrayHeight,
  clampGraphicsArrayWidth,
  clampGraphicsArrayZoom,
  getGraphicsArrayPaletteRgb,
  getGraphicsArrayStrides,
  normalizeGraphicsArrayOnStart,
  readGraphicsArrayCell,
  renderGraphicsVramToRgba,
  writeGraphicsArrayCell,
} from "../utils/graphicsArrayUtils";
import {
  exportMemoryToBinary,
  exportMemoryToText,
  getCellValue,
} from "../utils/memoryDataUtils";
import { createWire } from "../utils/wireUtils";

import { dispatchSimulationSymbolDoubleClick } from "../components/circuitCanvas";
import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";
import ComponentPalette from "../components/componentPalette";
import MemoryInspectorDialog from "../components/memoryInspectorDialog";
import PropertyDialog from "../components/propertyDialog";
import MemoryDataGrid from "../components/propertyDialog/memoryDataGrid";
import GraphicsArrayShape from "../components/symbols/display/graphicsArrayShape";

type MockDomNode = {
  tagName: string;
  attributes: Map<string, string>;
  children: MockDomNode[];
  parent?: MockDomNode;
  textContent: string | null;
  width?: number;
  height?: number;
  toDataURL?: (mime?: string) => string;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  insertBefore: (newNode: MockDomNode, refNode: MockDomNode | null) => void;
  appendChild: (newNode: MockDomNode) => void;
  replaceChild: (newNode: MockDomNode, oldNode: MockDomNode) => void;
  remove: () => void;
  closest: (tagSelector: string) => MockDomNode | null;
  cloneNode: (deep?: boolean) => MockDomNode;
  querySelector: (selector: string) => MockDomNode | null;
  querySelectorAll: (selector: string) => MockDomNode[];
  getBoundingClientRect: () => { width: number; height: number };
  get firstChild(): MockDomNode | null;
  get parentNode(): MockDomNode | undefined;
};

function matchesSelectorPart(node: MockDomNode, part: string): boolean {
  const trimmed = part.trim();
  if (!trimmed) {
    return false;
  }
  const tagMatch = /^([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (tagMatch && node.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) {
    return false;
  }
  const attrMatches = Array.from(trimmed.matchAll(/\[([^=\]]+)=['"]([^'"]*)['"]\]/g));
  return attrMatches.every((m) => node.getAttribute(m[1]) === m[2]);
}

function createMockDomNode(
  tagName: string,
  initialAttrs: Record<string, string> = {},
  children: MockDomNode[] = [],
  extras?: { width?: number; height?: number; toDataURL?: (mime?: string) => string },
): MockDomNode {
  const attributes = new Map<string, string>(Object.entries(initialAttrs));
  const node: MockDomNode = {
    tagName,
    attributes,
    children: [],
    textContent: null,
    width: extras?.width,
    height: extras?.height,
    toDataURL: extras?.toDataURL,
    get firstChild() {
      return this.children[0] ?? null;
    },
    get parentNode() {
      return this.parent;
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    hasAttribute(name: string) {
      return this.attributes.has(name);
    },
    insertBefore(newNode: MockDomNode, refNode: MockDomNode | null) {
      newNode.parent = this;
      if (!refNode) {
        this.children.push(newNode);
        return;
      }
      const idx = this.children.indexOf(refNode);
      if (idx === -1) {
        this.children.push(newNode);
      } else {
        this.children.splice(idx, 0, newNode);
      }
    },
    appendChild(newNode: MockDomNode) {
      newNode.parent = this;
      this.children.push(newNode);
    },
    replaceChild(newNode: MockDomNode, oldNode: MockDomNode) {
      const idx = this.children.indexOf(oldNode);
      if (idx !== -1) {
        newNode.parent = this;
        oldNode.parent = undefined;
        this.children[idx] = newNode;
      }
    },
    remove() {
      if (!this.parent) {
        return;
      }
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = undefined;
    },
    closest(tagSelector: string) {
      let cur: MockDomNode | undefined = this.parent;
      while (cur) {
        if (cur.tagName.toLowerCase() === tagSelector.toLowerCase()) {
          return cur;
        }
        cur = cur.parent;
      }
      return null;
    },
    cloneNode(deep = false) {
      const clonedChildren = deep ? this.children.map((c) => c.cloneNode(true)) : [];
      const cloned = createMockDomNode(
        this.tagName,
        Object.fromEntries(this.attributes.entries()),
        clonedChildren,
        { width: this.width, height: this.height, toDataURL: this.toDataURL },
      );
      cloned.textContent = this.textContent;
      return cloned;
    },
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      const tokens = selector.trim().split(/\s+/);
      const matches: MockDomNode[] = [];
      const visit = (cur: MockDomNode, ancestors: MockDomNode[]) => {
        for (const child of cur.children) {
          const last = tokens[tokens.length - 1];
          if (matchesSelectorPart(child, last)) {
            if (tokens.length === 1) {
              matches.push(child);
            } else if (tokens.length === 2 && ancestors.some((a) => matchesSelectorPart(a, tokens[0]))) {
              matches.push(child);
            }
          }
          visit(child, [...ancestors, child]);
        }
      };
      visit(this, []);
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

function createLiveHarness(initialProject = createEmptyCircuitProject("GraphicsArray Test", "Main")) {
  let circuitCtx!: React.ContextType<typeof CircuitContext>;

  const Consumer: React.FC = () => {
    circuitCtx = React.useContext(CircuitContext);
    return null;
  };

  renderToStaticMarkup(
    <CircuitContextProvider initialProject={initialProject}>
      <SimulationContextProvider>
        <CanvasContextProvider>
          <Consumer />
        </CanvasContextProvider>
      </SimulationContextProvider>
    </CircuitContextProvider>,
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
    },
    ...overrides,
  });

  return {
    getCtx: () => circuitCtx,
    getSnapshot,
  };
}

describe("GraphicsArray Geometrie, Paletten & Bit-Packing", () => {
  it("normalisiert und begrenzt Konfigurationswerte exakt wie C# Check*-Methoden", () => {
    expect(clampGraphicsArrayDataBitWidth(0)).toBe(1);
    expect(clampGraphicsArrayDataBitWidth(3)).toBe(4);
    expect(clampGraphicsArrayDataBitWidth(5)).toBe(8);
    expect(clampGraphicsArrayDataBitWidth(9)).toBe(16);
    expect(clampGraphicsArrayDataBitWidth(17)).toBe(32);
    expect(clampGraphicsArrayDataBitWidth(64)).toBe(32);
    expect(clampGraphicsArrayDataBitWidth(Number.NaN)).toBe(8);

    expect(clampGraphicsArrayBitsPerPixel(0)).toBe(1);
    expect(clampGraphicsArrayBitsPerPixel(3)).toBe(4);
    expect(clampGraphicsArrayBitsPerPixel(5)).toBe(8);
    expect(clampGraphicsArrayBitsPerPixel(16)).toBe(8);
    expect(clampGraphicsArrayBitsPerPixel(Number.NaN)).toBe(1);

    expect(clampGraphicsArrayWidth(-5)).toBe(1);
    expect(clampGraphicsArrayWidth(160.9)).toBe(160);
    expect(clampGraphicsArrayWidth(999)).toBe(640);
    expect(clampGraphicsArrayWidth(Number.NaN)).toBe(160);

    expect(clampGraphicsArrayHeight(0)).toBe(1);
    expect(clampGraphicsArrayHeight(120.7)).toBe(120);
    expect(clampGraphicsArrayHeight(800)).toBe(480);
    expect(clampGraphicsArrayHeight(Number.NaN)).toBe(120);

    expect(clampGraphicsArrayZoom(0)).toBe(1);
    expect(clampGraphicsArrayZoom(3)).toBe(3);
    expect(clampGraphicsArrayZoom(9)).toBe(4);
    expect(clampGraphicsArrayZoom(Number.NaN)).toBe(1);

    expect(normalizeGraphicsArrayOnStart("random")).toBe("random");
    expect(normalizeGraphicsArrayOnStart("ones")).toBe("ones");
    expect(normalizeGraphicsArrayOnStart("zeros")).toBe("zeros");
    expect(normalizeGraphicsArrayOnStart("data")).toBe("zeros");
    expect(normalizeGraphicsArrayOnStart(undefined)).toBe("zeros");
  });

  it("berechnet MemoryStride, BitmapStride und AddressBitWidth analog zu FunctionGraphicsArray.cs", () => {
    const def = getGraphicsArrayStrides(8, 1, 160, 120);
    expect(def).toEqual({
      memoryStride: 20,
      bitmapStride: 20,
      totalCells: 2400,
      totalBytes: 2400,
      addressBitWidth: 12,
    });
    expect(getGraphicsArrayAddressBitWidth(8, 1, 160, 120)).toBe(12);

    const max = getGraphicsArrayStrides(1, 8, 640, 480);
    expect(max).toEqual({
      memoryStride: 5120,
      bitmapStride: 640,
      totalCells: 2457600,
      totalBytes: 307200,
      addressBitWidth: 22,
    });

    // 1x1 bei 32-Bit Datenbus: bitmapStride muss mindestens 4 Bytes (32 Bit) breit sein
    expect(getGraphicsArrayStrides(32, 1, 1, 1)).toEqual({
      memoryStride: 1,
      bitmapStride: 4,
      totalCells: 1,
      totalBytes: 4,
      addressBitWidth: 1,
    });

    // Unrunde Pixelbreite mit Padding je Scanline
    expect(getGraphicsArrayStrides(8, 1, 10, 5)).toEqual({
      memoryStride: 2,
      bitmapStride: 2,
      totalCells: 10,
      totalBytes: 10,
      addressBitWidth: 4,
    });
    expect(getGraphicsArrayStrides(16, 4, 5, 2)).toEqual({
      memoryStride: 2,
      bitmapStride: 4,
      totalCells: 4,
      totalBytes: 8,
      addressBitWidth: 2,
    });
  });

  it("liefert exakte WPF-Farbtabellen (BlackAndWhite, Gray4, Halftone8, Halftone256 RGB332) und dekodiert MSB-first", () => {
    expect(getGraphicsArrayPaletteRgb(1)).toEqual([0x000000, 0xffffff]);
    expect(getGraphicsArrayPaletteRgb(2)).toEqual([0x000000, 0x555555, 0xaaaaaa, 0xffffff]);

    const p4 = getGraphicsArrayPaletteRgb(4);
    expect(p4).toHaveLength(16);
    expect(p4[0]).toBe(0x000000);
    expect(p4[1]).toBe(0x0000ff);
    expect(p4[4]).toBe(0xff0000);
    expect(p4[7]).toBe(0xffffff);
    expect(p4[15]).toBe(0x008080);

    const p8 = getGraphicsArrayPaletteRgb(8);
    expect(p8).toHaveLength(256);
    expect(p8[0x00]).toBe(0x000000);
    expect(p8[0xe0]).toBe(0xff0000);
    expect(p8[0x1c]).toBe(0x00ff00);
    expect(p8[0x03]).toBe(0x0000ff);
    expect(p8[0xff]).toBe(0xffffff);
    expect(p8[0x49]).toBe(0x494955);

    // 1 bpp MSB-first mit bitmapStride=2 (1 Padding-Byte pro Scanline)
    const pixels1 = new Uint32Array(4 * 2);
    renderGraphicsVramToRgba(new Uint8Array([0xa0, 0x00, 0x50, 0x00]), pixels1, 4, 2, 1, 2);
    const bytes1 = new Uint8ClampedArray(pixels1.buffer);
    expect(Array.from(bytes1.slice(0, 16))).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    expect(Array.from(bytes1.slice(16, 32))).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);

    // 2 bpp MSB-first: 0x1b = 00_01_10_11 -> #000000, #555555, #aaaaaa, #ffffff
    const pixels2 = new Uint32Array(4);
    renderGraphicsVramToRgba(new Uint8Array([0x1b]), pixels2, 4, 1, 2, 1);
    const bytes2 = new Uint8ClampedArray(pixels2.buffer);
    expect(Array.from(bytes2)).toEqual([
      0x00, 0x00, 0x00, 0xff,
      0x55, 0x55, 0x55, 0xff,
      0xaa, 0xaa, 0xaa, 0xff,
      0xff, 0xff, 0xff, 0xff,
    ]);

    // 4 bpp MSB-first: 0x4f -> [4]=#ff0000, [15]=#008080
    const pixels4 = new Uint32Array(2);
    renderGraphicsVramToRgba(new Uint8Array([0x4f]), pixels4, 2, 1, 4, 1);
    const bytes4 = new Uint8ClampedArray(pixels4.buffer);
    expect(Array.from(bytes4)).toEqual([
      0xff, 0x00, 0x00, 0xff,
      0x00, 0x80, 0x80, 0xff,
    ]);

    // 8 bpp: [0xe0, 0x03] -> Rot (#ff0000), Blau (#0000ff)
    const pixels8 = new Uint32Array(2);
    renderGraphicsVramToRgba(new Uint8Array([0xe0, 0x03]), pixels8, 2, 1, 8, 2);
    const bytes8 = new Uint8ClampedArray(pixels8.buffer);
    expect(Array.from(bytes8)).toEqual([
      0xff, 0x00, 0x00, 0xff,
      0x00, 0x00, 0xff, 0xff,
    ]);
  });

  it("schreibt und liest VRAM-Zellen fuer alle Datenbusbreiten (1..32 Bit) exakt nach C#-Endianess", () => {
    // 1, 2, 4 Bit innerhalb eines Bytes (MSB-first)
    for (const bitWidth of [1, 2, 4]) {
      const strides = getGraphicsArrayStrides(bitWidth, 1, 8, 2);
      const vram = new Uint8Array(strides.totalBytes);
      const mask = (1 << bitWidth) - 1;
      for (let addr = 0; addr < strides.totalCells; addr++) {
        const val = (addr + 1) & mask;
        const expectedChanged = val !== 0;
        expect(writeGraphicsArrayCell(vram, addr, val, bitWidth, strides.memoryStride, strides.bitmapStride, 2))
          .toBe(expectedChanged);
        expect(writeGraphicsArrayCell(vram, addr, val, bitWidth, strides.memoryStride, strides.bitmapStride, 2))
          .toBe(false);
        expect(readGraphicsArrayCell(vram, addr, bitWidth, strides.memoryStride, strides.bitmapStride, 2))
          .toBe(val);
      }
      // Prüfsumme: 1-Bit erste Zelle = MSB 0x80
      if (bitWidth === 1) {
        expect(vram[0] & 0x80).toBe(0x80);
      }
    }

    // 8 Bit
    const s8 = getGraphicsArrayStrides(8, 8, 3, 2);
    const v8 = new Uint8Array(s8.totalBytes);
    expect(writeGraphicsArrayCell(v8, 4, 0xab, 8, s8.memoryStride, s8.bitmapStride, 2)).toBe(true);
    expect(readGraphicsArrayCell(v8, 4, 8, s8.memoryStride, s8.bitmapStride, 2)).toBe(0xab);

    // 16 Bit Big-Endian innerhalb Scanline
    const s16 = getGraphicsArrayStrides(16, 8, 2, 2);
    const v16 = new Uint8Array(s16.totalBytes);
    expect(writeGraphicsArrayCell(v16, 1, 0x1234, 16, s16.memoryStride, s16.bitmapStride, 2)).toBe(true);
    expect(v16[s16.bitmapStride]).toBe(0x12);
    expect(v16[s16.bitmapStride + 1]).toBe(0x34);
    expect(readGraphicsArrayCell(v16, 1, 16, s16.memoryStride, s16.bitmapStride, 2)).toBe(0x1234);

    // 32 Bit inkl. Bit 31 (vorzeichenlos) und Big-Endian-Byte-Ablage
    const s32 = getGraphicsArrayStrides(32, 8, 8, 2);
    const v32 = new Uint8Array(s32.totalBytes);
    expect(writeGraphicsArrayCell(v32, 0, 0x80000000, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(true);
    expect(readGraphicsArrayCell(v32, 0, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(0x80000000);
    expect(writeGraphicsArrayCell(v32, 2, 0xdeadbeef, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(true);
    expect(v32.slice(s32.bitmapStride, s32.bitmapStride + 4)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(readGraphicsArrayCell(v32, 2, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(0xdeadbeef);
    expect(writeGraphicsArrayCell(v32, 1, 0xffffffff, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(true);
    expect(readGraphicsArrayCell(v32, 1, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(0xffffffff);

    // Ungültige / außerhalb liegende Adressen
    expect(writeGraphicsArrayCell(v32, -1, 1, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(false);
    expect(writeGraphicsArrayCell(v32, 100, 1, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(false);
    expect(readGraphicsArrayCell(v32, -1, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(0);
    expect(readGraphicsArrayCell(v32, 100, 32, s32.memoryStride, s32.bitmapStride, 2)).toBe(0);
  });
});

describe("GraphicsArray Layout, Rendering & SVG-Export", () => {
  const originalDocument = (globalThis as { document?: unknown }).document;

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("erzeugt GraphicsArray mit korrekten Pins, Display-Flag und dynamischen Rastermassen", () => {
    const defGa = createGraphicsArray("ga-1");
    expect(defGa.kind).toBe("graphicsArray");
    expect(defGa.isDisplay).toBe(true);
    expect(defGa.category).toBe("displays");
    expect(defGa.symbolWidth).toBe(Math.max(2, Math.ceil((160 + 3) / GRID_SIZE)));
    expect(defGa.symbolHeight).toBe(Math.max(3, Math.ceil((120 + 3) / GRID_SIZE)));
    expect(defGa.pins.map((p) => [p.name, p.pinSide, p.pinType, p.bitWidth])).toEqual([
      ["Address", "left", "input", 12],
      ["Data", "right", "output", 8],
      ["DataIn", "left", "input", 8],
      ["Write (0)", "bottom", "input", 1],
    ]);

    const zoomedGa = createGraphicsArray("ga-2", {
      width: 64,
      height: 32,
      bitsPerPixel: 4,
      dataBitWidth: 16,
      zoom: 3,
      writeOn1: true,
    });
    expect(zoomedGa.symbolWidth).toBe(Math.max(2, Math.ceil((64 * 3 + 3) / GRID_SIZE)));
    expect(zoomedGa.symbolHeight).toBe(Math.max(3, Math.ceil((32 * 3 + 3) / GRID_SIZE)));
    expect(zoomedGa.pins.find((p) => p.name === "Address")?.bitWidth).toBe(9);
    expect(zoomedGa.pins.find((p) => p.name === "Write (1)")).toBeDefined();
  });

  it("rendert Editiervorschau, Palettenvorschau und Live-VRAM-Canvas-Knoten inkl. eingebetteter Display-Subschaltungen", () => {
    const editHtml = renderToStaticMarkup(
      <svg>
        <GraphicsArrayShape
          width={180}
          height={126}
          displayWidth={160}
          displayHeight={120}
          bitsPerPixel={4}
          zoom={1}
        />
      </svg>,
    );
    expect(editHtml).toContain("data-component=\"GraphicsArrayShape\"");
    expect(editHtml).toContain("160×120");
    expect(editHtml).toContain("4 bpp");
    expect(editHtml).not.toContain("<foreignObject");

    const paletteHtml = renderToStaticMarkup(
      <svg>
        <GraphicsArrayShape
          width={36}
          height={28}
          displayWidth={85}
          displayHeight={64}
          bitsPerPixel={1}
          isPalettePreview
        />
      </svg>,
    );
    expect(paletteHtml).toContain("graphics-array-preview-pixels");
    expect(paletteHtml).not.toContain("85×64");

    const liveHtml = renderToStaticMarkup(
      <svg>
        <GraphicsArrayShape
          width={180}
          height={126}
          displayWidth={160}
          displayHeight={120}
          bitsPerPixel={1}
          vram={new Uint8Array(2400)}
          bitmapStride={20}
          vramRevision={1}
        />
      </svg>,
    );
    expect(liveHtml).toContain("<foreignObject");
    expect(liveHtml).toContain("data-graphics-array-canvas=\"true\"");
    expect(liveHtml).toContain("width=\"160\"");
    expect(liveHtml).toContain("height=\"120\"");

    // Direkte Symbol- und Subschaltungs-Display-Einbettung testen
    const project = createEmptyCircuitProject("Display Sub Test", "Main");
    const subLc = createDefaultLogicalCircuit("sub-screen", "Screen");
    subLc.circuitShape = "display";
    subLc.isDisplay = true;

    const ga = createGraphicsArray("ga-sub", { width: 64, height: 32, bitsPerPixel: 2, zoom: 1 });
    project.graphicsArrays.push(ga);
    project.circuits.set(ga.circuitId, ga);
    const gaSym = createCircuitSymbol(ga, subLc.logicalCircuitId, 2, 2);
    subLc.circuitSymbols.push(gaSym);
    project.logicalCircuits.push(subLc);
    project.circuits.set(subLc.circuitId, subLc);
    syncProjectLogicalCircuits(project);

    const byId = new Map(project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));
    expect(circuitContainsDisplays(subLc, byId)).toBe(true);

    const subChipSym = createCircuitSymbol(subLc, project.logicalCircuits[0].logicalCircuitId, 5, 5);

    const symbolViewHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <svg>
            <CircuitSymbolView symbol={gaSym} />
            <CircuitSymbolView symbol={subChipSym} />
          </svg>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(symbolViewHtml).toContain("data-component=\"GraphicsArrayShape\"");
    expect(symbolViewHtml).toContain("64×32");
    expect(symbolViewHtml).toContain("data-bpp=\"2\"");
    expect(symbolViewHtml).toContain("data-circuit-shape=\"display\"");
  });

  it("wandelt foreignObject-Canvas-Displays in prepareCircuitSvgClone in PNG-image-Elemente um", () => {
    (globalThis as { document?: unknown }).document = {
      styleSheets: [],
      createElementNS: (_ns: string, tag: string) => createMockDomNode(tag),
    };

    const canvas = createMockDomNode(
      "canvas",
      { "data-graphics-array-canvas": "true" },
      [],
      {
        width: 160,
        height: 120,
        toDataURL: () => "data:image/png;base64,MOCK_PNG_BYTES",
      },
    );
    const foreignObject = createMockDomNode(
      "foreignObject",
      { x: "10", y: "20", width: "160", height: "120" },
      [canvas],
    );
    const symbolGroup = createMockDomNode(
      "g",
      { "data-component": "CircuitSymbolView", "data-symbol-id": "sym-ga" },
      [foreignObject],
    );
    const svgRoot = createMockDomNode("svg", {}, [symbolGroup]);

    const prepared = prepareCircuitSvgClone(svgRoot as unknown as SVGSVGElement, {}, { width: 400, height: 300 });
    const cloneRoot = prepared.clone as unknown as MockDomNode;

    expect(cloneRoot.querySelectorAll("foreignObject")).toHaveLength(0);
    const images = cloneRoot.querySelectorAll("image");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("x")).toBe("10");
    expect(images[0].getAttribute("y")).toBe("20");
    expect(images[0].getAttribute("width")).toBe("160");
    expect(images[0].getAttribute("height")).toBe("120");
    expect(images[0].getAttribute("href")).toBe("data:image/png;base64,MOCK_PNG_BYTES");
    expect(images[0].getAttribute("preserveAspectRatio")).toBe("none");
    expect(images[0].getAttribute("style")).toContain("image-rendering: pixelated");

    // Fehlgeschlagenes toDataURL darf Export nicht abbrechen lassen
    const brokenCanvas = createMockDomNode(
      "canvas",
      { "data-graphics-array-canvas": "true" },
      [],
      {
        width: 160,
        height: 120,
        toDataURL: () => {
          throw new Error("Tainted canvas");
        },
      },
    );
    const brokenFo = createMockDomNode(
      "foreignObject",
      { x: "0", y: "0", width: "80", height: "60" },
      [brokenCanvas],
    );
    const brokenRoot = createMockDomNode("svg", {}, [brokenFo]);
    const brokenPrepared = prepareCircuitSvgClone(
      brokenRoot as unknown as SVGSVGElement,
      {},
      { width: 400, height: 300 },
    );
    expect((brokenPrepared.clone as unknown as MockDomNode).querySelectorAll("image")).toHaveLength(0);
    expect((brokenPrepared.clone as unknown as MockDomNode).querySelectorAll("foreignObject")).toHaveLength(1);
  });
});

describe("GraphicsArray Palette, PropertyDialog & Undo/Redo", () => {
  it("rendert GraphicsArray in ComponentPalette unter Displays sowie im PropertyDialog ohne data-Startmodus", () => {
    const project = createEmptyCircuitProject("UI Test", "Main");
    const ga = createGraphicsArray("ga-ui");
    project.graphicsArrays.push(ga);
    project.circuits.set(ga.circuitId, ga);
    const sym = createCircuitSymbol(ga, project.logicalCircuits[0].logicalCircuitId, 4, 4);
    project.logicalCircuits[0].circuitSymbols.push(sym);

    const paletteHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <ComponentPalette />
      </CircuitContextProvider>,
    );
    expect(paletteHtml).toContain("data-display-width=\"85\"");
    expect(paletteHtml).toContain("data-display-height=\"64\"");
    expect(paletteHtml).toContain("graphics-array-preview-pixels");

    const dialogHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <PropertyDialog
          isOpen
          symbol={sym}
          onClose={() => {}}
        />
      </CircuitContextProvider>,
    );
    expect(dialogHtml).toContain("value=\"160\"");
    expect(dialogHtml).toContain("value=\"120\"");
    expect(dialogHtml).toContain("property-graphics-derived-info");
    expect(dialogHtml).toContain("12 Bit");
    expect(dialogHtml).toContain("10×7");
    expect(dialogHtml).toContain("value=\"random\"");
    expect(dialogHtml).toContain("value=\"zeros\"");
    expect(dialogHtml).toContain("value=\"ones\"");
    expect(dialogHtml).not.toContain("value=\"data\"");
  });

  it("aktualisiert GraphicsArray-Eigenschaften inklusive Undo und Redo über CircuitContext", () => {
    const harness = createLiveHarness();
    const ctx = harness.getCtx();

    let addedSym!: CircuitSymbol;
    React.act(() => {
      addedSym = ctx.addSymbol(
        {
          type: "graphicsArray",
          name: "Graphics Array",
          width: 160,
          height: 120,
          bitsPerPixel: 1,
          dataBitWidth: 8,
          zoom: 1,
          writeOn1: false,
          onStart: "zeros",
        },
        { x: 4, y: 4 },
      );
    });

    expect((addedSym.circuit as GraphicsArray).width).toBe(160);
    expect(ctx.canUndo).toBe(true);

    let updatedSym!: CircuitSymbol | null;
    React.act(() => {
      updatedSym = ctx.updateCircuitSymbolProperties(addedSym.circuitSymbolId, {
        width: 64,
        height: 32,
        bitsPerPixel: 4,
        dataBitWidth: 16,
        zoom: 2,
        writeOn1: true,
        onStart: "ones",
        note: "Framebuffer",
      });
    });

    expect(updatedSym).not.toBeNull();
    const afterUpdate = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === addedSym.circuitSymbolId,
    )!;
    const gaAfter = afterUpdate.circuit as GraphicsArray;
    expect(gaAfter.width).toBe(64);
    expect(gaAfter.height).toBe(32);
    expect(gaAfter.bitsPerPixel).toBe(4);
    expect(gaAfter.dataBitWidth).toBe(16);
    expect(gaAfter.zoom).toBe(2);
    expect(gaAfter.writeOn1).toBe(true);
    expect(gaAfter.onStart).toBe("ones");
    expect(gaAfter.note).toBe("Framebuffer");
    expect(gaAfter.symbolWidth).toBe(Math.max(2, Math.ceil((64 * 2 + 3) / GRID_SIZE)));
    expect(gaAfter.symbolHeight).toBe(Math.max(3, Math.ceil((32 * 2 + 3) / GRID_SIZE)));
    expect(afterUpdate.jams.find((j) => j.pin.name === "Address")?.pin.bitWidth).toBe(9);
    expect(afterUpdate.jams.find((j) => j.pin.name === "Write (1)")).toBeDefined();

    React.act(() => {
      ctx.undo();
    });
    const afterUndo = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === addedSym.circuitSymbolId,
    )!;
    const gaUndo = afterUndo.circuit as GraphicsArray;
    expect(gaUndo.width).toBe(160);
    expect(gaUndo.height).toBe(120);
    expect(gaUndo.bitsPerPixel).toBe(1);
    expect(gaUndo.dataBitWidth).toBe(8);
    expect(gaUndo.zoom).toBe(1);
    expect(gaUndo.writeOn1).toBe(false);
    expect(gaUndo.onStart).toBe("zeros");
    expect(gaUndo.note).toBe("");
    expect(afterUndo.jams.find((j) => j.pin.name === "Address")?.pin.bitWidth).toBe(12);
    expect(afterUndo.jams.find((j) => j.pin.name === "Write (0)")).toBeDefined();

    React.act(() => {
      ctx.redo();
    });
    const afterRedo = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === addedSym.circuitSymbolId,
    )!;
    const gaRedo = afterRedo.circuit as GraphicsArray;
    expect(gaRedo.width).toBe(64);
    expect(gaRedo.height).toBe(32);
    expect(gaRedo.bitsPerPixel).toBe(4);
    expect(gaRedo.dataBitWidth).toBe(16);
    expect(gaRedo.zoom).toBe(2);
    expect(gaRedo.writeOn1).toBe(true);
    expect(gaRedo.onStart).toBe("ones");
    expect(gaRedo.note).toBe("Framebuffer");
  });
});

describe("GraphicsArray MCP CRUD-Werkzeuge", () => {
  it("liefert dynamischen Komponentenkatalog inkl. Preview für graphicsArray", () => {
    const harness = createLiveHarness();
    const defaultCatalog = getComponentCatalogTool(harness.getSnapshot(), { type: "graphicsArray" });
    expect(defaultCatalog.components).toHaveLength(1);
    const defEntry = defaultCatalog.components[0];
    expect(defEntry.paletteCategory).toBe("displays");
    expect(defEntry.isDisplay).toBe(true);
    expect(defEntry.hasDynamicPinLayout).toBe(true);
    expect(defEntry.pins.find((p) => p.name === "Address")?.bitWidth).toBe(12);

    const previewCatalog = getComponentCatalogTool(harness.getSnapshot(), {
      type: "graphicsArray",
      preview: {
        width: 64,
        height: 32,
        bitsPerPixel: 4,
        dataBitWidth: 16,
        zoom: 2,
        writeOn1: true,
      },
    });
    const prevEntry = previewCatalog.components[0];
    expect(prevEntry.defaultSize).toEqual({
      width: Math.max(2, Math.ceil((64 * 2 + 3) / GRID_SIZE)),
      height: Math.max(3, Math.ceil((32 * 2 + 3) / GRID_SIZE)),
    });
    expect(prevEntry.pins.find((p) => p.name === "Address")?.bitWidth).toBe(9);
    expect(prevEntry.pins.find((p) => p.name === "Write (1)")).toBeDefined();
  });

  it("unterstützt add_elements, get_circuit_details und update_element_properties inkl. Undo/Redo", () => {
    const harness = createLiveHarness();

    let symId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 6, y: 8 }],
      });
      symId = added.symbols[0].circuitSymbolId;
    });

    const details = getCircuitDetails(harness.getSnapshot(), {});
    const created = details.symbols.find((s) => s.circuitSymbolId === symId)!;
    expect(created).toMatchObject({
      kind: "graphicsArray",
      addressBitWidth: 12,
      pixelWidth: 160,
      pixelHeight: 120,
      bitsPerPixel: 1,
      dataBitWidth: 8,
      zoom: 1,
      writeOn1: false,
      onStart: "zeros",
      width: 10,
      height: 7,
    });

    React.act(() => {
      updateElementPropertiesTool(harness.getSnapshot(), {
        symbolId: symId,
        width: 128,
        height: 64,
        bitsPerPixel: 8,
        dataBitWidth: 32,
        zoom: 2,
        writeOn1: true,
        onStart: "random",
      });
    });

    const afterDetails = getCircuitDetails(harness.getSnapshot(), {});
    const updated = afterDetails.symbols.find((s) => s.circuitSymbolId === symId)!;
    expect(updated).toMatchObject({
      kind: "graphicsArray",
      addressBitWidth: 11,
      pixelWidth: 128,
      pixelHeight: 64,
      bitsPerPixel: 8,
      dataBitWidth: 32,
      zoom: 2,
      writeOn1: true,
      onStart: "random",
    });
    expect(updated.jams.find((j) => j.pinName === "Address")?.bitWidth).toBe(11);
    expect(updated.jams.find((j) => j.pinName === "Write (1)")).toBeDefined();

    React.act(() => {
      harness.getCtx().undo();
    });
    const reverted = getCircuitDetails(harness.getSnapshot(), {}).symbols.find((s) => s.circuitSymbolId === symId)!;
    expect(reverted).toMatchObject({
      addressBitWidth: 12,
      pixelWidth: 160,
      pixelHeight: 120,
      bitsPerPixel: 1,
      dataBitWidth: 8,
      zoom: 1,
      writeOn1: false,
      onStart: "zeros",
    });
  });

  it("weist ungültige Parameter für graphicsArray in add_elements und update_element_properties ab", () => {
    const harness = createLiveHarness();

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, bitsPerPixel: 3 }],
      }),
    ).toThrow(/bitsPerPixel/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, dataBitWidth: 12 }],
      }),
    ).toThrow(/dataBitWidth/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, onStart: "data" }],
      }),
    ).toThrow(/onStart/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, width: 641 }],
      }),
    ).toThrow(/width/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, height: 481 }],
      }),
    ).toThrow(/height/);

    expect(() =>
      addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2, zoom: 5 }],
      }),
    ).toThrow(/zoom/);

    let symId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [{ type: "graphicsArray", x: 2, y: 2 }],
      });
      symId = added.symbols[0].circuitSymbolId;
    });

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, bitsPerPixel: 3 }),
    ).toThrow(/bitsPerPixel/);

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, dataBitWidth: 6 }),
    ).toThrow(/dataBitWidth/);

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, onStart: "data" }),
    ).toThrow(/onStart/);

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, width: 0 }),
    ).toThrow(/width/);

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, height: 481 }),
    ).toThrow(/height/);

    expect(() =>
      updateElementPropertiesTool(harness.getSnapshot(), { symbolId: symId, zoom: 0 }),
    ).toThrow(/zoom/);
  });
});

function createSimHarness(initialProject = createEmptyCircuitProject("GraphicsArray Sim Test", "Main")) {
  let circuitCtx!: React.ContextType<typeof CircuitContext>;
  let simCtx!: React.ContextType<typeof SimulationContext>;

  const Capture: React.FC = () => {
    circuitCtx = React.useContext(CircuitContext);
    simCtx = React.useContext(SimulationContext);
    return null;
  };

  renderToStaticMarkup(
    <CanvasContextProvider>
      <CircuitContextProvider initialProject={initialProject}>
        <SimulationContextProvider>
          <Capture />
        </SimulationContextProvider>
      </CircuitContextProvider>
    </CanvasContextProvider>,
  );

  const simulationActions: McpSimulationActions = {
    getState: () => ({
      isSimulating: simCtx.isSimulating,
      isPaused: simCtx.isPaused,
      isRunning: simCtx.isRunning,
      isOscillating: simCtx.isOscillating,
      simulationError: simCtx.simulationError,
      actualFrequency: simCtx.actualFrequency,
      frameRateLimit: simCtx.frameRateLimit,
      snapshot: simCtx.snapshot,
      rootCircuitMap: simCtx.rootCircuitMap ?? simCtx.circuitMap,
      selectedCircuitMap: simCtx.selectedCircuitMap,
    }),
    startSimulation: simCtx.startSimulation,
    pauseSimulation: simCtx.pauseSimulation,
    stopSimulation: simCtx.stopSimulation,
    reset: simCtx.reset,
    flushPersistentMemories: simCtx.flushPersistentMemories,
    readMemorySlice: simCtx.readMemorySlice,
    writeMemoryCell: simCtx.writeMemoryCell,
    step: simCtx.step,
    ensurePausedSimulation: simCtx.ensurePausedSimulation,
    setFrameRateLimit: simCtx.setFrameRateLimit,
    selectCircuitMap: simCtx.selectCircuitMap,
    setButtonState: simCtx.setButtonState,
    toggleButton: simCtx.toggleButton,
    pullSnapshot: simCtx.pullSnapshot,
  };

  const getSnapshot = (): McpCircuitSnapshot => ({
    project: circuitCtx.project,
    currentCircuit: circuitCtx.currentCircuit,
    selectedSymbolIds: [],
    selectedTextNoteIds: [],
    selectedWireIds: [],
    isSimulating: simCtx.isSimulating,
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
    },
    simulation: simulationActions,
  });

  return {
    getCircuitCtx: () => circuitCtx,
    getSimCtx: () => simCtx,
    getSnapshot,
  };
}

describe("T-067: FunctionGraphicsArray & VRAM-Engine", () => {
  it("initialisiert VRAM mit zeros, ones und random korrekt mit Start-Revision 1", () => {
    const reserveIndices = (state: CircuitState, count: number): number[] =>
      Array.from({ length: count }, () => state.reserveState());

    const sZeros = new CircuitState(3);
    const fnZeros = new FunctionGraphicsArray(
      sZeros,
      reserveIndices(sZeros, 4),
      reserveIndices(sZeros, 8),
      reserveIndices(sZeros, 8),
      sZeros.reserveState(),
      createGraphicsArray("ga-zeros", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8, onStart: "zeros" }),
      "inst-zeros",
    );
    expect(fnZeros.revision).toBe(1);
    expect(fnZeros.copyVramBytes().every((b) => b === 0)).toBe(true);

    const sOnes = new CircuitState(3);
    const fnOnes = new FunctionGraphicsArray(
      sOnes,
      reserveIndices(sOnes, 4),
      reserveIndices(sOnes, 8),
      reserveIndices(sOnes, 8),
      sOnes.reserveState(),
      createGraphicsArray("ga-ones", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8, onStart: "ones" }),
      "inst-ones",
    );
    expect(fnOnes.revision).toBe(1);
    expect(fnOnes.copyVramBytes().every((b) => b === 0xff)).toBe(true);

    const sRand = new CircuitState(3);
    const fnRand = new FunctionGraphicsArray(
      sRand,
      reserveIndices(sRand, 8),
      reserveIndices(sRand, 8),
      [],
      sRand.reserveState(),
      createGraphicsArray("ga-rand", { width: 64, height: 32, bitsPerPixel: 1, dataBitWidth: 8, onStart: "random" }),
      "inst-rand",
    );
    expect(fnRand.revision).toBe(1);
    const randBytes = fnRand.copyVramBytes();
    expect(randBytes).toHaveLength(256);
    expect(randBytes.some((b) => b !== 0)).toBe(true);
    expect(randBytes.some((b) => b !== 0xff)).toBe(true);
  });

  it("schreibt flankengetriggert (writeOn1 false/true), verhindert Start-Fehlschreiben und unterstützt Schreib-Only", () => {
    const reserveIndices = (state: CircuitState, count: number): number[] =>
      Array.from({ length: count }, () => state.reserveState());

    const setBits = (state: CircuitState, indices: number[], value: number) => {
      for (let i = 0; i < indices.length; i++) {
        state.set(indices[i], ((value >>> i) & 1) !== 0 ? STATE_ON1 : STATE_ON0);
      }
    };
    const readBits = (state: CircuitState, indices: number[]): number => {
      let val = 0;
      for (let i = 0; i < indices.length; i++) {
        if (state.get(indices[i]) === STATE_ON1) {
          val = (val | (1 << i)) >>> 0;
        }
      }
      return val >>> 0;
    };

    // Fall 1: Fallende Flanke (writeOn1 = false), mit Data-Ausgang
    const cs1 = new CircuitState(3);
    const addr1 = reserveIndices(cs1, 4);
    const in1 = reserveIndices(cs1, 8);
    const out1 = reserveIndices(cs1, 8);
    const wr1 = cs1.reserveState();
    cs1.endDefinition();

    const fnFall = new FunctionGraphicsArray(
      cs1,
      addr1,
      in1,
      out1,
      wr1,
      createGraphicsArray("ga-fall", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8, writeOn1: false }),
      "inst-fall",
    );
    setBits(cs1, addr1, 3);
    setBits(cs1, in1, 0xa5);

    // Direkt STATE_ON0 beim Start (vorher STATE_OFF) darf NICHT schreiben
    cs1.set(wr1, STATE_ON0);
    fnFall.evaluate();
    expect(fnFall.getCell(3)).toBe(0);
    expect(fnFall.revision).toBe(1);

    // Steigende Flanke bereitet vor, fallende Flanke 1 -> 0 schreibt
    cs1.set(wr1, STATE_ON1);
    fnFall.evaluate();
    expect(fnFall.getCell(3)).toBe(0);

    cs1.set(wr1, STATE_ON0);
    const outChanged = fnFall.evaluate();
    expect(outChanged).toBe(true);
    expect(fnFall.revision).toBe(2);
    expect(fnFall.getCell(3)).toBe(0xa5);
    expect(readBits(cs1, out1)).toBe(0xa5);

    // Fall 2: Steigende Flanke (writeOn1 = true) im reinen Schreibbetrieb (outputData = [])
    const cs2 = new CircuitState(3);
    const addr2 = reserveIndices(cs2, 4);
    const in2 = reserveIndices(cs2, 8);
    const wr2 = cs2.reserveState();
    cs2.endDefinition();

    const fnRise = new FunctionGraphicsArray(
      cs2,
      addr2,
      in2,
      [],
      wr2,
      createGraphicsArray("ga-rise", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8, writeOn1: true }),
      "inst-rise",
    );
    setBits(cs2, addr2, 2);
    setBits(cs2, in2, 0x3c);
    cs2.set(wr2, STATE_ON1);
    expect(fnRise.evaluate()).toBe(false);
    expect(fnRise.getCell(2)).toBe(0);

    cs2.set(wr2, STATE_ON0);
    expect(fnRise.evaluate()).toBe(false);
    cs2.set(wr2, STATE_ON1);
    expect(fnRise.evaluate()).toBe(false);
    expect(fnRise.getCell(2)).toBe(0x3c);
    expect(fnRise.revision).toBe(2);
  });

  it("konvertiert VRAM über setCell und readSlice in Little-Endian-Zellen für 16-Bit und 32-Bit", () => {
    const cs = new CircuitState(3);
    const addr = Array.from({ length: 4 }, () => cs.reserveState());
    const dataIn = Array.from({ length: 32 }, () => cs.reserveState());
    const write = cs.reserveState();
    cs.endDefinition();

    const fn = new FunctionGraphicsArray(
      cs,
      addr,
      dataIn,
      [],
      write,
      createGraphicsArray("ga-32", { width: 8, height: 4, bitsPerPixel: 8, dataBitWidth: 32 }),
      "inst-32",
    );

    expect(fn.setCell(0, 0xdeadbeef)).toBe(true);
    expect(fn.getCell(0)).toBe(0xdeadbeef);
    expect(fn.setCell(-1, 1)).toBe(false);
    expect(fn.setCell(fn.totalCells, 1)).toBe(false);

    const slice = fn.readSlice(0, 2);
    expect(slice.totalCells).toBe(8);
    expect(slice.dataBitWidth).toBe(32);
    expect(slice.addressBitWidth).toBe(3);
    expect(slice.bytes.slice(0, 4)).toEqual(new Uint8Array([0xef, 0xbe, 0xad, 0xde]));
    expect(getCellValue(slice.bytes, 32, 0)).toBe(0xdeadbeef);
  });
});

describe("T-067: CircuitMap CleanUp-Ausnahme, Pflichtpins & Subschaltungen", () => {
  it("hält rein schreibend betriebenes GraphicsArray trotz offenem Data-Pin aktiv und meldet fehlende Pflichtpins", () => {
    const harness = createSimHarness();

    let gaSymId = "";
    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          {
            ref: "addr",
            type: "constant",
            bitWidth: 3,
            value: 1,
            x: 2,
            y: 4,
          },
          {
            ref: "din",
            type: "constant",
            bitWidth: 8,
            value: 0xc3,
            x: 2,
            y: 10,
          },
          {
            ref: "wr",
            type: "button",
            isToggle: true,
            x: 6,
            y: 16,
          },
          {
            ref: "disp",
            type: "graphicsArray",
            width: 8,
            height: 8,
            bitsPerPixel: 1,
            dataBitWidth: 8,
            writeOn1: true,
            x: 10,
            y: 6,
          },
        ],
        wires: [
          { from: { ref: "addr", pinName: "Out" }, to: { ref: "disp", pinName: "Address" } },
          { from: { ref: "din", pinName: "Out" }, to: { ref: "disp", pinName: "DataIn" } },
          { from: { ref: "wr", pinName: "Out" }, to: { ref: "disp", pinName: "Write (1)" } },
        ],
      });
      gaSymId = added.symbols.find((s) => s.ref === "disp")!.circuitSymbolId;
    });

    const activeLc = harness.getCircuitCtx().currentCircuit;
    const cleanMap = new CircuitMap(activeLc);
    cleanMap.prepareCleanUpAnalysis();
    const report = cleanMap.analyzeCleanUp();
    expect(report.unusedSymbolIds.has(gaSymId)).toBe(false);

    const runner = new CircuitRunner(activeLc);
    expect(runner.graphicsArrayCount).toBe(1);
    const snap1 = runner.step(1).snapshot;
    expect(snap1.graphicsArrays?.[gaSymId].vram?.[1]).toBe(0);

    runner.setButtonState(
      activeLc.circuitSymbols.find((s) => s.circuit.kind === "circuitButton")!.circuit.circuitId,
      true,
    );
    const snap2 = runner.step(1).snapshot;
    expect(snap2.graphicsArrays?.[gaSymId].vram?.[1]).toBe(0xc3);
    runner.dispose();

    // Pflichtpin-Prüfung (Adresse fehlt, DataIn fehlt, Write fehlt)
    const missingAddrLc = createDefaultLogicalCircuit("m-addr", "MissingAddr");
    const gaUnwired = createGraphicsArray("ga-err", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8 });
    const gaErrSym = createCircuitSymbol(gaUnwired, missingAddrLc.logicalCircuitId, 10, 10);
    missingAddrLc.circuitSymbols = [gaErrSym];
    expect(() => new CircuitMap(missingAddrLc).apply()).toThrow(CircuitException);
    expect(() => new CircuitMap(missingAddrLc).apply()).toThrow(/Adresseingang|address/);

    const missingDinLc = createDefaultLogicalCircuit("m-din", "MissingDin");
    const gaDin = createGraphicsArray("ga-din", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8 });
    const gaDinSym = createCircuitSymbol(gaDin, missingDinLc.logicalCircuitId, 10, 10);
    const constAddr = createConstant("c-addr", 3, 0);
    const constAddrSym = createCircuitSymbol(constAddr, missingDinLc.logicalCircuitId, 2, 10);
    const addrJam = gaDinSym.jams.find((j) => j.pin.name === "Address")!;
    missingDinLc.circuitSymbols = [constAddrSym, gaDinSym];
    missingDinLc.wires = [
      createWire(missingDinLc.logicalCircuitId, constAddrSym.jams[0].absolutePoint, addrJam.absolutePoint),
    ];
    expect(() => new CircuitMap(missingDinLc).apply()).toThrow(/Dateneingang|data/);

    const missingWrLc = createDefaultLogicalCircuit("m-wr", "MissingWr");
    const gaWr = createGraphicsArray("ga-wr", { width: 8, height: 8, bitsPerPixel: 1, dataBitWidth: 8 });
    const gaWrSym = createCircuitSymbol(gaWr, missingWrLc.logicalCircuitId, 10, 10);
    const cA = createCircuitSymbol(createConstant("c-a2", 3, 0), missingWrLc.logicalCircuitId, 2, 8);
    const cD = createCircuitSymbol(createConstant("c-d2", 8, 1), missingWrLc.logicalCircuitId, 2, 14);
    missingWrLc.circuitSymbols = [cA, cD, gaWrSym];
    missingWrLc.wires = [
      createWire(
        missingWrLc.logicalCircuitId,
        cA.jams[0].absolutePoint,
        gaWrSym.jams.find((j) => j.pin.name === "Address")!.absolutePoint,
      ),
      createWire(
        missingWrLc.logicalCircuitId,
        cD.jams[0].absolutePoint,
        gaWrSym.jams.find((j) => j.pin.name === "DataIn")!.absolutePoint,
      ),
    ];
    expect(() => new CircuitMap(missingWrLc).apply()).toThrow(/Schreibeingang|Write/);
  });

  it("trennt VRAM-Puffer von mehrfach instanziierten Subschaltungs-Displays sauber nach Instanzpfad", () => {
    const project = createEmptyCircuitProject("MultiSubDisp", "Main");
    const mainLc = project.logicalCircuits[0];
    const subLc = createDefaultLogicalCircuit("sub-ga", "SubDisplay");
    subLc.circuitShape = "display";
    subLc.isDisplay = true;

    const pinIn = createPinCircuit("pin-wr", subLc.logicalCircuitId, "input", "WR", 1, "left");
    const cAddr = createConstant("c-sub-a", 3, 0);
    const cData = createConstant("c-sub-d", 8, 0x55);
    const ga = createGraphicsArray("ga-sub-inst", {
      width: 8,
      height: 8,
      bitsPerPixel: 1,
      dataBitWidth: 8,
      writeOn1: true,
    });
    const symPin = createCircuitSymbol(pinIn.pinCircuit, subLc.logicalCircuitId, 2, 2);
    const symAddr = createCircuitSymbol(cAddr, subLc.logicalCircuitId, 2, 6);
    const symData = createCircuitSymbol(cData, subLc.logicalCircuitId, 2, 10);
    const symGa = createCircuitSymbol(ga, subLc.logicalCircuitId, 10, 4, "up", "ga-inner");

    project.pins.push(pinIn.pin);
    project.circuits.set(pinIn.pinCircuit.circuitId, pinIn.pinCircuit);
    subLc.pins = [pinIn.pin];
    subLc.logicalPins = [pinIn.pin];
    subLc.circuitSymbols = [symPin, symAddr, symData, symGa];
    subLc.wires = [
      createWire(
        subLc.logicalCircuitId,
        symAddr.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "Address")!.absolutePoint,
      ),
      createWire(
        subLc.logicalCircuitId,
        symData.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "DataIn")!.absolutePoint,
      ),
      createWire(
        subLc.logicalCircuitId,
        symPin.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "Write (1)")!.absolutePoint,
      ),
    ];

    project.graphicsArrays.push(ga);
    project.circuits.set(ga.circuitId, ga);
    project.logicalCircuits.push(subLc);
    project.circuits.set(subLc.circuitId, subLc);
    syncProjectLogicalCircuits(project);

    const btn1 = createCircuitButton("btn-sub-1", "W1", true);
    const btn2 = createCircuitButton("btn-sub-2", "W2", true);
    const symBtn1 = createCircuitSymbol(btn1, mainLc.logicalCircuitId, 2, 2, "up", "sym-btn-1");
    const symBtn2 = createCircuitSymbol(btn2, mainLc.logicalCircuitId, 2, 12, "up", "sym-btn-2");
    const symSub1 = createCircuitSymbol(subLc, mainLc.logicalCircuitId, 10, 2, "up", "sub-1");
    const symSub2 = createCircuitSymbol(subLc, mainLc.logicalCircuitId, 10, 12, "up", "sub-2");
    mainLc.circuitSymbols = [symBtn1, symBtn2, symSub1, symSub2];
    mainLc.wires = [
      createWire(mainLc.logicalCircuitId, symBtn1.jams[0].absolutePoint, symSub1.jams[0].absolutePoint),
      createWire(mainLc.logicalCircuitId, symBtn2.jams[0].absolutePoint, symSub2.jams[0].absolutePoint),
    ];

    const runner = new CircuitRunner(mainLc);
    expect(runner.graphicsArrayCount).toBe(2);

    runner.step(1);
    runner.setButtonState("btn-sub-1", true);
    const snap = runner.step(1).snapshot;

    expect(snap.graphicsArrays?.["sub-1/ga-inner"]?.vram?.[0]).toBe(0x55);
    expect(snap.graphicsArrays?.["sub-2/ga-inner"]?.vram?.[0]).toBe(0);
    runner.dispose();
  });
});

describe("T-067: Zero-Copy Delta-VRAM-Sync (CircuitRunner & SimulationClient)", () => {
  it("sendet vram im inkrementellen Modus nur bei Revisionsänderung und hydriert über SimulationClient", async () => {
    const lc = createDefaultLogicalCircuit("delta-main", "DeltaMain");
    const cAddr = createCircuitSymbol(createConstant("d-a", 3, 0), lc.logicalCircuitId, 2, 2);
    const cDin = createCircuitSymbol(createConstant("d-d", 8, 0x9e), lc.logicalCircuitId, 2, 6);
    const wrBtn = createCircuitSymbol(createCircuitButton("d-w", "W", true), lc.logicalCircuitId, 2, 12);
    const ga = createGraphicsArray("ga-delta", {
      width: 8,
      height: 8,
      bitsPerPixel: 1,
      dataBitWidth: 8,
      writeOn1: true,
    });
    const symGa = createCircuitSymbol(ga, lc.logicalCircuitId, 10, 4, "up", "sym-ga-delta");
    lc.circuitSymbols = [cAddr, cDin, wrBtn, symGa];
    lc.wires = [
      createWire(
        lc.logicalCircuitId,
        cAddr.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "Address")!.absolutePoint,
      ),
      createWire(
        lc.logicalCircuitId,
        cDin.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "DataIn")!.absolutePoint,
      ),
      createWire(
        lc.logicalCircuitId,
        wrBtn.jams[0].absolutePoint,
        symGa.jams.find((j) => j.pin.name === "Write (1)")!.absolutePoint,
      ),
    ];

    // Direkt im Runner: Standard-Snapshot enthält immer vram; incrementalVram spart unveränderten Puffer ein
    const runner = new CircuitRunner(lc);
    expect(runner.getSnapshot().graphicsArrays?.["sym-ga-delta"]?.vram).toBeInstanceOf(Uint8Array);

    const inc1 = runner.getSnapshot({ incrementalVram: true });
    expect(inc1.graphicsArrays?.["sym-ga-delta"]?.revision).toBe(1);
    expect(inc1.graphicsArrays?.["sym-ga-delta"]?.vram).toBeInstanceOf(Uint8Array);

    const inc2 = runner.getSnapshot({ incrementalVram: true });
    expect(inc2.graphicsArrays?.["sym-ga-delta"]?.revision).toBe(1);
    expect(inc2.graphicsArrays?.["sym-ga-delta"]?.vram).toBeUndefined();

    runner.step(1);
    runner.setButtonState("d-w", true);
    const inc3 = runner.step(1, [], { incrementalVram: true }).snapshot;
    expect(inc3.graphicsArrays?.["sym-ga-delta"]?.revision).toBe(2);
    expect(inc3.graphicsArrays?.["sym-ga-delta"]?.vram?.[0]).toBe(0x9e);
    expect(inc3.memoryRevisions?.["sym-ga-delta"]).toBe(2);
    runner.dispose();

    // Über SimulationClient: InProcessWorker liefert inkrementell, Client hydriert aus #graphicsVramCache
    const client = new SimulationClient();
    await client.init(lc);
    const stepZero = await client.step(0);
    expect(stepZero.snapshot.graphicsArrays?.["sym-ga-delta"]?.vram).toBeInstanceOf(Uint8Array);

    const pulled = await client.pullSnapshot();
    expect(pulled.graphicsArrays?.["sym-ga-delta"]?.revision).toBe(1);
    expect(pulled.graphicsArrays?.["sym-ga-delta"]?.vram?.[0]).toBe(0);

    const writeRes = await client.writeMemoryCell("sym-ga-delta", 0, 0xa5);
    expect(writeRes.success).toBe(true);
    expect(writeRes.revision).toBe(2);
    expect(writeRes.snapshot?.graphicsArrays?.["sym-ga-delta"]?.vram?.[0]).toBe(0xa5);

    const pulledAfter = await client.pullSnapshot();
    expect(pulledAfter.graphicsArrays?.["sym-ga-delta"]?.revision).toBe(2);
    expect(pulledAfter.graphicsArrays?.["sym-ga-delta"]?.vram?.[0]).toBe(0xa5);

    await client.stop();
    client.terminate();
  });
});

describe("T-067: Live-Canvas, Live-VRAM-Inspektor & MCP-Simulations-Telemetrie", () => {
  it("übergibt Live-VRAM an GraphicsArrayShape direkt und in Display-Subschaltungen und öffnet Inspektor", () => {
    const project = createEmptyCircuitProject("LiveDisplayView", "Main");
    const mainLc = project.logicalCircuits[0];
    const subLc = createDefaultLogicalCircuit("sub-live", "LiveScreen");
    subLc.circuitShape = "display";
    subLc.isDisplay = true;

    const ga = createGraphicsArray("ga-live", { width: 160, height: 120, bitsPerPixel: 1, dataBitWidth: 8 });
    const gaSym = createCircuitSymbol(ga, subLc.logicalCircuitId, 2, 2, "up", "ga-inner");
    subLc.circuitSymbols = [gaSym];
    project.graphicsArrays.push(ga);
    project.circuits.set(ga.circuitId, ga);
    project.logicalCircuits.push(subLc);
    project.circuits.set(subLc.circuitId, subLc);
    syncProjectLogicalCircuits(project);

    const subChipSym = createCircuitSymbol(subLc, mainLc.logicalCircuitId, 4, 4, "up", "sub-chip");
    mainLc.circuitSymbols = [subChipSym];

    const vramBytes = new Uint8Array(2400);
    vramBytes[0] = 0xff;
    const simSnap = {
      stateArray: new Uint8Array(4),
      probes: {},
      buttons: {},
      graphicsArrays: {
        "sub-chip/ga-inner": {
          instanceId: "sub-chip/ga-inner",
          graphicsArrayId: ga.graphicsArrayId,
          width: 160,
          height: 120,
          bitsPerPixel: 1,
          bitmapStride: 20,
          revision: 3,
          vram: vramBytes,
        },
        "ga-inner": {
          instanceId: "ga-inner",
          graphicsArrayId: ga.graphicsArrayId,
          width: 160,
          height: 120,
          bitsPerPixel: 1,
          bitmapStride: 20,
          revision: 3,
          vram: vramBytes,
        },
      },
      telemetry: {
        isRunning: true,
        isPaused: false,
        isOscillating: false,
        actualFrequency: 30,
        totalSteps: 5,
        timestamp: 1,
      },
    };

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider
          value={{
            ...DEFAULT_SIMULATION_STATE,
            isSimulating: true,
            isRunning: true,
            snapshot: simSnap,
            circuitMap: new CircuitMap(mainLc),
          }}
        >
          <svg>
            <CircuitSymbolView symbol={subChipSym} />
          </svg>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(html).toContain("<foreignObject");
    expect(html).toContain("data-graphics-array-canvas=\"true\"");
    expect(html).toContain("data-circuit-shape=\"display\"");

    const subHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider
          value={{
            ...DEFAULT_SIMULATION_STATE,
            isSimulating: true,
            isRunning: true,
            snapshot: simSnap,
            circuitMap: new CircuitMap(subLc),
          }}
        >
          <svg>
            <CircuitSymbolView symbol={gaSym} />
          </svg>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(subHtml).toContain("data-graphics-array-canvas=\"true\"");

    // Doppelklick-Dispatching öffnet den Live-VRAM-Inspektor
    let openedId: string | null = null;
    const rootMap = new CircuitMap(mainLc);
    const handled = dispatchSimulationSymbolDoubleClick({
      symbol: gaSym,
      target: null,
      activeSimulationMap: rootMap.child(subChipSym),
      selectCircuitMap: () => {},
      onOpenMemoryInspector: (sym, activeMap) => {
        openedId = getGraphicsArrayInstanceId(activeMap, sym);
      },
    });
    expect(handled).toBe(true);
    expect(openedId).toBe("sub-chip/ga-inner");

    // MemoryInspectorDialog + 22-Bit MemoryDataGrid + Nicht-Zweierpotenz-Export
    const runningInspectorHtml = renderToStaticMarkup(
      <SimulationContext.Provider
        value={{
          ...DEFAULT_SIMULATION_STATE,
          isSimulating: true,
          isPaused: false,
          isRunning: true,
        }}
      >
        <MemoryInspectorDialog
          isOpen
          symbol={gaSym}
          memoryInstanceId="sub-chip/ga-inner"
          circuitPath="LiveScreen/Graphics Array[2,2]"
          onClose={() => {}}
        />
      </SimulationContext.Provider>,
    );
    expect(runningInspectorHtml).toContain("Live-Speicherinspektor: Grafisches Display (VRAM)");
    expect(runningInspectorHtml).toContain("160×120 px · 1 bpp");
    expect(runningInspectorHtml).toContain("2400 Zellen");
    expect(runningInspectorHtml).toContain("data-readonly=\"true\"");

    const pausedInspectorHtml = renderToStaticMarkup(
      <SimulationContext.Provider
        value={{
          ...DEFAULT_SIMULATION_STATE,
          isSimulating: true,
          isPaused: true,
          isRunning: false,
        }}
      >
        <MemoryInspectorDialog
          isOpen
          symbol={gaSym}
          memoryInstanceId="sub-chip/ga-inner"
          onClose={() => {}}
        />
      </SimulationContext.Provider>,
    );
    expect(pausedInspectorHtml).toContain("data-readonly=\"false\"");

    // 640x480 @ 8 bpp, 1-Bit Datenbus -> 3.072.000 Zellen / 22 Adressbits
    const largeGridHtml = renderToStaticMarkup(
      <MemoryDataGrid
        addressBitWidth={22}
        dataBitWidth={1}
        totalCells={3072000}
        data={new Uint8Array(256)}
        format="hex"
        onFormatChange={() => {}}
        readOnly
      />,
    );
    expect(largeGridHtml).toContain("3072000 Zellen");
    expect(largeGridHtml).toContain("000000");

    const tenBytes = new Uint8Array(16).fill(0x41);
    expect(exportMemoryToBinary(tenBytes, 4, 8, 10)).toHaveLength(10);
    expect(exportMemoryToText(tenBytes, "hex", 4, 8, 10).split(" ")).toHaveLength(10);
  });

  it("liefert kompakte graphicsArray-Telemetrie in MCP step_simulation ohne rohen Megabyte-VRAM", async () => {
    const harness = createSimHarness();
    let btnId = "";
    let gaSymId = "";

    React.act(() => {
      const added = addElements(harness.getSnapshot(), {
        components: [
          { ref: "addr", type: "constant", bitWidth: 3, value: 0, x: 2, y: 4 },
          { ref: "din", type: "constant", bitWidth: 8, value: 0x7f, x: 2, y: 10 },
          { ref: "wr", type: "button", isToggle: true, x: 6, y: 16 },
          {
            ref: "disp",
            type: "graphicsArray",
            width: 8,
            height: 8,
            bitsPerPixel: 1,
            dataBitWidth: 8,
            writeOn1: true,
            zoom: 2,
            x: 10,
            y: 6,
          },
        ],
        wires: [
          { from: { ref: "addr", pinName: "Out" }, to: { ref: "disp", pinName: "Address" } },
          { from: { ref: "din", pinName: "Out" }, to: { ref: "disp", pinName: "DataIn" } },
          { from: { ref: "wr", pinName: "Out" }, to: { ref: "disp", pinName: "Write (1)" } },
        ],
      });
      btnId = added.symbols.find((s) => s.ref === "wr")!.circuitSymbolId;
      gaSymId = added.symbols.find((s) => s.ref === "disp")!.circuitSymbolId;
    });

    const stepResult = (await executeMcpTool(
      "step_simulation",
      {
        steps: 2,
        includeState: true,
        events: [{ atStep: 2, symbolId: btnId, on: true }],
      },
      harness.getSnapshot(),
    )) as {
      state?: {
        symbols: Array<{
          circuitSymbolId: string;
          kind: string;
          graphicsArray?: Record<string, unknown>;
        }>;
      };
    };

    const dispReport = stepResult.state?.symbols.find((s) => s.circuitSymbolId === gaSymId);
    expect(dispReport?.kind).toBe("graphicsArray");
    expect(dispReport?.graphicsArray).toMatchObject({
      instanceId: gaSymId,
      width: 8,
      height: 8,
      bitsPerPixel: 1,
      dataBitWidth: 8,
      addressBitWidth: 3,
      zoom: 2,
      writeOn1: true,
      onStart: "zeros",
      revision: 2,
      nonZeroBytes: 1,
    });
    expect(dispReport?.graphicsArray?.vram).toBeUndefined();

    await harness.getSimCtx().stopSimulation();
  });
});
