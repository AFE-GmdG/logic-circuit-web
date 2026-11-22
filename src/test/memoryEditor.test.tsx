import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type McpCircuitActions from "../types/mcp/mcpCircuitActions";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";

import { executeMcpTool } from "../mcp/mcpTools";
import {
  createCircuitSymbol,
  createEmptyCircuitProject,
  createMemory,
  getComponentLayout,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import {
  type ComponentCatalogResponse,
  getPaletteGateItems,
} from "../utils/componentCatalog";
import { GRID_SIZE } from "../utils/coordinateSystem";
import {
  areByteArraysEqual,
  bytesPerCellFor,
  decodeMemoryData,
  encodeMemoryData,
  exportMemoryToBinary,
  exportMemoryToText,
  formatCellValue,
  getCellValue,
  importBinaryIntoMemory,
  importTextIntoMemory,
  maxCellValueFor,
  numberCellsFor,
  parseCellInput,
  reallocateMemoryData,
  setCellValue,
  totalBytesFor,
} from "../utils/memoryDataUtils";

import ComponentPalette from "../components/componentPalette";
import PropertyDialog from "../components/propertyDialog";
import MemoryDataGrid from "../components/propertyDialog/memoryDataGrid";
import SymbolRenderer from "../components/symbols/symbolRenderer";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("memoryDataUtils", () => {
  it("supports unsigned 32-bit cell read/write without signed overflow", () => {
    expect(bytesPerCellFor(1)).toBe(1);
    expect(bytesPerCellFor(8)).toBe(1);
    expect(bytesPerCellFor(9)).toBe(2);
    expect(bytesPerCellFor(32)).toBe(4);
    expect(numberCellsFor(1)).toBe(2);
    expect(numberCellsFor(16)).toBe(65536);

    expect(maxCellValueFor(1)).toBe(1);
    expect(maxCellValueFor(8)).toBe(0xff);
    expect(maxCellValueFor(16)).toBe(0xffff);
    expect(maxCellValueFor(31)).toBe(0x7fffffff);
    expect(maxCellValueFor(32)).toBe(0xffffffff);

    const buf = new Uint8Array(totalBytesFor(2, 32));
    setCellValue(buf, 32, 0, 0x80000000);
    setCellValue(buf, 32, 1, 0xffffffff);
    setCellValue(buf, 32, 2, 0x12345678);

    expect(getCellValue(buf, 32, 0)).toBe(0x80000000);
    expect(getCellValue(buf, 32, 1)).toBe(0xffffffff);
    expect(getCellValue(buf, 32, 2)).toBe(0x12345678);
    expect(getCellValue(buf, 32, 3)).toBe(0);
  });

  it("encodes Base64 with trailing-zero trimming and handles 256 KB buffers safely", () => {
    const empty = new Uint8Array(totalBytesFor(4, 8));
    expect(encodeMemoryData(empty, 4, 8)).toBe("");

    const small = new Uint8Array(totalBytesFor(4, 8));
    small[0] = 0xab;
    small[2] = 0xcd;
    const encoded = encodeMemoryData(small, 4, 8);
    expect(encoded).toBe("qwDN");
    const decodedMultiline = decodeMemoryData("qw\n\r DN ", 4, 8);
    expect(areByteArraysEqual(decodedMultiline, small)).toBe(true);

    // Maximaler 256-KiB-Puffer (16-Bit Adresse * 32-Bit Daten) ohne Call-Stack-Überlauf
    const maxBuffer = new Uint8Array(totalBytesFor(16, 32));
    setCellValue(maxBuffer, 32, 0, 0xdeadbeef);
    setCellValue(maxBuffer, 32, 65535, 0xcafebabe);
    const maxEncoded = encodeMemoryData(maxBuffer, 16, 32);
    expect(maxEncoded.length).toBeGreaterThan(1000);
    const maxDecoded = decodeMemoryData(maxEncoded, 16, 32);
    expect(getCellValue(maxDecoded, 32, 0)).toBe(0xdeadbeef);
    expect(getCellValue(maxDecoded, 32, 65535)).toBe(0xcafebabe);
  });

  it("reallocates data losslessly when changing address or data bit width", () => {
    const buf = new Uint8Array(totalBytesFor(3, 8));
    setCellValue(buf, 8, 0, 0xab);
    setCellValue(buf, 8, 1, 0x0f);
    setCellValue(buf, 8, 7, 0xff);

    const wider = reallocateMemoryData(buf, 3, 8, 4, 16);
    expect(wider.length).toBe(totalBytesFor(4, 16));
    expect(getCellValue(wider, 16, 0)).toBe(0x00ab);
    expect(getCellValue(wider, 16, 1)).toBe(0x000f);
    expect(getCellValue(wider, 16, 7)).toBe(0x00ff);
    expect(getCellValue(wider, 16, 8)).toBe(0);

    const narrower = reallocateMemoryData(wider, 4, 16, 2, 4);
    expect(narrower.length).toBe(totalBytesFor(2, 4));
    expect(getCellValue(narrower, 4, 0)).toBe(0x0b);
    expect(getCellValue(narrower, 4, 1)).toBe(0x0f);
  });

  it("imports and exports binary and Hex/Dec/Bin text files deterministically", () => {
    const rawBin = new Uint8Array([0x34, 0x12, 0xfe]);
    const mem16 = importBinaryIntoMemory(rawBin, 2, 16);
    expect(getCellValue(mem16, 16, 0)).toBe(0x1234);
    expect(getCellValue(mem16, 16, 1)).toBe(0x00fe);
    expect(getCellValue(mem16, 16, 2)).toBe(0);
    const exportedBin = exportMemoryToBinary(mem16, 2, 16);
    expect(exportedBin.length).toBe(8);
    expect(Array.from(exportedBin.slice(0, 4))).toEqual([0x34, 0x12, 0xfe, 0x00]);

    const hexImport = importTextIntoMemory("0A, FF; -1 0x10", "hex", 3, 8);
    expect(hexImport.ok).toBe(true);
    if (hexImport.ok) {
      expect(hexImport.importedCells).toBe(4);
      expect(getCellValue(hexImport.data, 8, 0)).toBe(0x0a);
      expect(getCellValue(hexImport.data, 8, 1)).toBe(0xff);
      expect(getCellValue(hexImport.data, 8, 2)).toBe(0xff);
      expect(getCellValue(hexImport.data, 8, 3)).toBe(0x10);
      expect(exportMemoryToText(hexImport.data, "hex", 3, 8)).toBe(
        "0A FF FF 10 00 00 00 00",
      );
    }

    const decImport = importTextIntoMemory("10 255 -2", "dec", 2, 8);
    expect(decImport.ok).toBe(true);
    if (decImport.ok) {
      expect(getCellValue(decImport.data, 8, 0)).toBe(10);
      expect(getCellValue(decImport.data, 8, 1)).toBe(255);
      expect(getCellValue(decImport.data, 8, 2)).toBe(254);
      expect(exportMemoryToText(decImport.data, "dec", 2, 8)).toBe("10 255 254 0");
    }

    const binImport = importTextIntoMemory("1010 0b0101", "bin", 2, 4);
    expect(binImport.ok).toBe(true);
    if (binImport.ok) {
      expect(getCellValue(binImport.data, 4, 0)).toBe(10);
      expect(getCellValue(binImport.data, 4, 1)).toBe(5);
      expect(exportMemoryToText(binImport.data, "bin", 2, 4)).toBe("1010 0101 0000 0000");
    }

    const badChar = importTextIntoMemory("10\n12G", "dec", 2, 8);
    expect(badChar).toEqual({
      ok: false,
      errorKey: "dialog.property.memoryErrorTextChar",
      errorParams: { line: 2, position: 3 },
    });

    const tooBig = importTextIntoMemory("99999999999", "dec", 2, 32);
    expect(tooBig).toEqual({
      ok: false,
      errorKey: "dialog.property.memoryErrorTextBigNumber",
      errorParams: { line: 1, position: 10 },
    });
  });

  it("validates and formats individual memory cells across radices", () => {
    expect(formatCellValue(0xab, 8, "hex")).toBe("AB");
    expect(formatCellValue(0xab, 8, "dec")).toBe("171");
    expect(formatCellValue(0xab, 8, "bin")).toBe("10101011");

    expect(parseCellInput("0xff", 8, "hex")).toEqual({ ok: true, value: 255 });
    expect(parseCellInput("256", 8, "dec").ok).toBe(false);
    expect(parseCellInput("ffffffff", 32, "hex")).toEqual({ ok: true, value: 0xffffffff });
    expect(parseCellInput("12g", 8, "hex").ok).toBe(false);
    expect(parseCellInput("102", 8, "bin").ok).toBe(false);
  });
});

describe("Memory layout, palette, and vector symbols", () => {
  it("lists ROM and RAM at the end of Basic Gates (Grundformen)", () => {
    const gateItems = getPaletteGateItems("gates").map((item) => item.type);
    expect(gateItems.slice(-2)).toEqual(["rom", "ram"]);
  });

  it("computes grid-aligned pins and dimensions for single-port and dual-port ROM/RAM", () => {
    const romLayout = getComponentLayout("rom", { addressBitWidth: 8, dataBitWidth: 16 });
    expect(romLayout.gridWidth).toBe(3);
    expect(romLayout.gridHeight).toBe(4);
    expect(romLayout.pins.map((p) => ({ name: p.name, bw: p.bitWidth, pt: p.gridPoint }))).toEqual([
      { name: "Address", bw: 8, pt: { x: 0, y: 2 } },
      { name: "Data", bw: 16, pt: { x: 3, y: 2 } },
    ]);

    const ramDual = createMemory("ram-dual", true, 12, 32, {
      writeOn1: true,
      onStart: "data",
      dualPort: true,
    });
    expect(ramDual.symbolWidth).toBe(3);
    expect(ramDual.symbolHeight).toBe(4);
    expect(ramDual.pins.map((p) => ({ name: p.name, side: p.pinSide, pt: p.gridPoint }))).toEqual([
      { name: "Address", side: "left", pt: { x: 0, y: 1 } },
      { name: "Data", side: "right", pt: { x: 3, y: 1 } },
      { name: "DataIn", side: "left", pt: { x: 0, y: 2 } },
      { name: "Write (1)", side: "bottom", pt: { x: 1, y: 4 } },
      { name: "Address2", side: "left", pt: { x: 0, y: 3 } },
      { name: "Data2", side: "right", pt: { x: 3, y: 3 } },
    ]);

    const project = createEmptyCircuitProject();
    const placed = instantiateCircuitFromPalette(
      project,
      project.logicalCircuits[0].logicalCircuitId,
      { type: "ram", name: "RAM", addressBitWidth: 4, dataBitWidth: 8 },
      { x: 5, y: 6 },
    );
    expect(placed.circuit.kind).toBe("memory");
    expect(project.memories).toHaveLength(1);
    expect(placed.circuitSymbol.jams.every((j) => Number.isInteger(j.absolutePoint.x))).toBe(true);
    expect(placed.circuitSymbol.jams.every((j) => Number.isInteger(j.absolutePoint.y))).toBe(true);
  });

  it("renders ROM and RAM symbols and palette controls", () => {
    const paletteHtml = renderToStaticMarkup(<ComponentPalette />);
    expect(paletteHtml).toContain("Grundformen");
    expect(paletteHtml).toContain("Adressbits für ROM");
    expect(paletteHtml).toContain("Datenbits für ROM");
    expect(paletteHtml).toContain("Adressbits für RAM");
    expect(paletteHtml).toContain("Datenbits für RAM");

    const ram = createMemory("ram-sym", true, 8, 8, { writeOn1: true });
    const ramSvg = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="ram"
          showPins={true}
          width={ram.symbolWidth * GRID_SIZE}
          height={ram.symbolHeight * GRID_SIZE}
          pins={ram.pins}
          writeOn1={ram.writeOn1}
          dualPort={ram.dualPort}
        />
      </svg>,
    );
    expect(ramSvg).toContain("data-component=\"MemoryShape\"");
    expect(ramSvg).toContain(">RAM<");
    expect(ramSvg).toContain(">W<");
  });
});

describe("CircuitContext memory property updates and simulation commits", () => {
  it("reallocates memory data on bit-width update with Undo/Redo support", () => {
    const project = createEmptyCircuitProject("Mem Test", "Main", "main");
    const initData = new Uint8Array(totalBytesFor(4, 8));
    setCellValue(initData, 8, 0, 0xab);
    setCellValue(initData, 8, 3, 0xcd);
    const ram = createMemory("mem-1", true, 4, 8, {
      onStart: "data",
      data: encodeMemoryData(initData, 4, 8),
    });
    const sym = createCircuitSymbol(ram, "main", 4, 4, "up", "sym-mem-1");
    project.memories.push(ram);
    project.circuits.set(ram.circuitId, ram);
    project.circuitSymbols.push(sym);
    project.logicalCircuits[0].circuitSymbols.push(sym);

    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    React.act(() => {
      capturedCtx.updateCircuitSymbolProperties("sym-mem-1", {
        addressBitWidth: 3,
        dataBitWidth: 16,
        writeOn1: true,
        dualPort: true,
      });
    });

    const updated = capturedCtx.project.memories[0];
    expect(updated.addressBitWidth).toBe(3);
    expect(updated.dataBitWidth).toBe(16);
    expect(updated.writeOn1).toBe(true);
    expect(updated.dualPort).toBe(true);
    expect(updated.pins.find((p) => p.pinId === "mem-1-write")?.name).toBe("Write (1)");

    const decoded = decodeMemoryData(updated.data, 3, 16);
    expect(getCellValue(decoded, 16, 0)).toBe(0x00ab);
    expect(getCellValue(decoded, 16, 3)).toBe(0x00cd);
    expect(capturedCtx.canUndo).toBe(true);

    React.act(() => {
      capturedCtx.undo();
    });
    expect(capturedCtx.project.memories[0].addressBitWidth).toBe(4);
    expect(capturedCtx.project.memories[0].dataBitWidth).toBe(8);
    expect(capturedCtx.project.memories[0].dualPort).toBe(false);

    React.act(() => {
      capturedCtx.redo();
    });
    expect(capturedCtx.project.memories[0].addressBitWidth).toBe(3);
    expect(capturedCtx.project.memories[0].dataBitWidth).toBe(16);
  });

  it("commits simulated RAM data without Undo entry and marks dirty only on real changes", () => {
    const project = createEmptyCircuitProject("Sim Commit Test", "Main", "main");
    const ram = createMemory("ram-persist", true, 4, 8, {
      onStart: "data",
      data: "AQ==",
    });
    const sym = createCircuitSymbol(ram, "main", 4, 4, "up", "sym-ram-persist");
    project.memories.push(ram);
    project.circuits.set(ram.circuitId, ram);
    project.circuitSymbols.push(sym);
    project.logicalCircuits[0].circuitSymbols.push(sym);

    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedCtx.hasUnsavedChanges).toBe(false);

    // Identische Daten (trotz angehängter Null-Bytes) dürfen kein Dirty-Flag setzen
    let didChange = true;
    React.act(() => {
      didChange = capturedCtx.commitSimulatedMemoryData([{ memoryId: "ram-persist", data: "AQA=" }]);
    });
    expect(didChange).toBe(false);
    expect(capturedCtx.hasUnsavedChanges).toBe(false);
    expect(capturedCtx.canUndo).toBe(false);

    // Echte Datenänderung aktualisiert Memory.data und setzt hasUnsavedChanges ohne Undo-Eintrag
    const nextBuf = new Uint8Array(totalBytesFor(4, 8));
    nextBuf[0] = 0x55;
    nextBuf[5] = 0xaa;
    React.act(() => {
      didChange = capturedCtx.commitSimulatedMemoryData([
        { memoryId: "ram-persist", data: encodeMemoryData(nextBuf, 4, 8) },
      ]);
    });
    expect(didChange).toBe(true);
    expect(capturedCtx.hasUnsavedChanges).toBe(true);
    expect(capturedCtx.canUndo).toBe(false);
    const updatedBytes = decodeMemoryData(capturedCtx.project.memories[0].data, 4, 8);
    expect(updatedBytes[0]).toBe(0x55);
    expect(updatedBytes[5]).toBe(0xaa);
  });
});

describe("MemoryDataGrid & PropertyDialog UI", () => {
  it("paginates 16-bit (65536 cells) memory views to at most 256 cells per page", () => {
    const bigData = new Uint8Array(totalBytesFor(16, 8));
    bigData[0] = 0x42;
    const html = renderToStaticMarkup(
      <MemoryDataGrid
        addressBitWidth={16}
        dataBitWidth={8}
        data={bigData}
        format="hex"
        onFormatChange={() => {}}
      />,
    );

    expect(html).toContain("65536 Zellen × 8 Bits");
    expect(html).toContain("Seite 1 / 256 (0x0000–0x00FF)");
    expect(html).toContain("value=\"42\"");
    const cellMatches = html.match(/data-address="/g) ?? [];
    expect(cellMatches).toHaveLength(256);
  });

  it("renders ROM and RAM property dialogs with data-persistence awareness", () => {
    const rom = createMemory("rom-ui", false, 4, 8, { data: "AQID" });
    const romSym = createCircuitSymbol(rom, "main", 2, 2);
    const romHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={romSym} onClose={() => {}} />,
    );
    expect(romHtml).toContain("Eigenschaften: ROM");
    expect(romHtml).toContain("Binär laden...");
    expect(romHtml).toContain("Text laden...");
    expect(romHtml).not.toContain("Beim Simulationsstart");
    expect(romHtml).not.toContain("Schreibflanke (Trigger)");

    const ramRandom = createMemory("ram-ui", true, 4, 8, { onStart: "random" });
    const ramRandomSym = createCircuitSymbol(ramRandom, "main", 2, 2);
    const ramRandomHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={ramRandomSym} onClose={() => {}} />,
    );
    expect(ramRandomHtml).toContain("Eigenschaften: RAM");
    expect(ramRandomHtml).toContain("Beim Simulationsstart");
    expect(ramRandomHtml).toContain("Schreibflanke (Trigger)");
    expect(ramRandomHtml).toContain("data-disabled=\"true\"");
    expect(ramRandomHtml).toContain("Wählen Sie oben „Daten (persistent)“");

    const ramData = createMemory("ram-data", true, 4, 8, { onStart: "data", data: "qv8=" });
    const ramDataSym = createCircuitSymbol(ramData, "main", 2, 2);
    const ramDataHtml = renderToStaticMarkup(
      <PropertyDialog isOpen={true} symbol={ramDataSym} onClose={() => {}} />,
    );
    expect(ramDataHtml).toContain("data-disabled=\"false\"");
    expect(ramDataHtml).toContain("value=\"AA\"");
    expect(ramDataHtml).toContain("value=\"FF\"");
  });
});

describe("MCP catalog and editing support for ROM & RAM", () => {
  it("supports get_component_catalog, add_elements, and update_element_properties for rom & ram", async () => {
    const project = createEmptyCircuitProject("MCP Mem", "Main", "main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    const actions: McpCircuitActions = {
      addEntities: capturedCtx.addEntities,
      moveEntities: capturedCtx.moveEntities,
      rotateSymbols: capturedCtx.rotateSymbols,
      removeEntities: capturedCtx.removeEntities,
      updateTextNote: capturedCtx.updateTextNote,
      updateCircuitSymbolProperties: capturedCtx.updateCircuitSymbolProperties,
      resizeCircuitSymbol: capturedCtx.resizeCircuitSymbol,
      updateCircuitProperties: capturedCtx.updateCircuitProperties,
      createCircuits: capturedCtx.createCircuits,
      deleteCircuits: capturedCtx.deleteCircuits,
      setCurrentCircuitId: capturedCtx.setCurrentCircuitId,
      getProject: () => capturedCtx.project,
      getCurrentCircuit: () => capturedCtx.currentCircuit,
    };

    const makeSnapshot = (): McpCircuitSnapshot => ({
      project: capturedCtx.project,
      currentCircuit: capturedCtx.currentCircuit,
      selectedSymbolIds: [],
      selectedTextNoteIds: [],
      actions,
    });

    const catalog = (await executeMcpTool(
      "get_component_catalog",
      { type: "ram", preview: { addressBitWidth: 6, dataBitWidth: 16, dualPort: true, writeOn1: true } },
      makeSnapshot(),
    )) as ComponentCatalogResponse;

    expect(catalog.components).toHaveLength(1);
    expect(catalog.components[0].paletteCategory).toBe("gates");
    expect(catalog.components[0].pins.map((p) => p.name)).toEqual([
      "Address",
      "Data",
      "DataIn",
      "Write (1)",
      "Address2",
      "Data2",
    ]);

    let placedSym!: CircuitSymbol;
    await React.act(async () => {
      const addRes = (await executeMcpTool(
        "add_elements",
        {
          components: [
            {
              type: "rom",
              x: 4,
              y: 4,
              addressBitWidth: 4,
              dataBitWidth: 8,
              data: "AQI=",
            },
          ],
        },
        makeSnapshot(),
      )) as { symbols: CircuitSymbol[] };
      placedSym = addRes.symbols[0];
    });

    expect(capturedCtx.project.memories[0].data).toBe("AQI=");
    expect(placedSym.circuitSymbolId).toBeTruthy();

    await React.act(async () => {
      await executeMcpTool(
        "update_element_properties",
        {
          symbolId: placedSym.circuitSymbolId,
          addressBitWidth: 5,
          dataBitWidth: 16,
          dualPort: true,
        },
        makeSnapshot(),
      );
    });

    const updatedMem = capturedCtx.project.memories[0] as Memory;
    expect(updatedMem.addressBitWidth).toBe(5);
    expect(updatedMem.dataBitWidth).toBe(16);
    expect(updatedMem.dualPort).toBe(true);
    const updatedBytes = decodeMemoryData(updatedMem.data, 5, 16);
    expect(getCellValue(updatedBytes, 16, 0)).toBe(1);
    expect(getCellValue(updatedBytes, 16, 1)).toBe(2);
    const lc: LogicalCircuit = capturedCtx.currentCircuit;
    expect(lc.circuitSymbols[0].jams).toHaveLength(4);
  });
});
