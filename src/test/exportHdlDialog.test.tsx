import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CircuitContext from "../contexts/circuitContext";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";

import i18n from "../i18n";
import {
  calculateCircuitDimensionsAndPins,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
} from "../utils/circuitLayout";
import {
  exportTextFilesToDirectory,
  isDirectoryPickerSupported,
  type FileSystemDirectoryHandleLike,
  type FileSystemPickerWindow,
} from "../utils/fileSystemStorage";
import { exportHdl } from "../utils/hdl/exportHdl";

import ExportHdlDialog from "../components/app/exportHdlDialog";
import MainMenu from "../components/app/mainMenu";

const noop = () => undefined;

function makeWire(
  wireId: string,
  logicalCircuitId: string,
  point1: GridPoint,
  point2: GridPoint,
): Wire {
  return {
    wireId,
    logicalCircuitId,
    x1: point1.x,
    y1: point1.y,
    x2: point2.x,
    y2: point2.y,
    point1,
    point2,
  };
}

function addPinSymbol(
  circuit: LogicalCircuit,
  pinId: string,
  pinType: "input" | "output",
  name: string,
  bitWidth: number,
  x: number,
  y: number,
  index = 0,
): CircuitSymbol {
  const { pin, pinCircuit } = createPinCircuit(
    pinId,
    circuit.logicalCircuitId,
    pinType,
    name,
    bitWidth,
    pinType === "input" ? "left" : "right",
    false,
    index,
  );
  circuit.logicalPins.push(pin);
  const layout = calculateCircuitDimensionsAndPins(circuit.logicalPins, 3, 4);
  circuit.pins = layout.pins;
  circuit.symbolWidth = layout.gridWidth;
  circuit.symbolHeight = layout.gridHeight;
  const sym = createCircuitSymbol(pinCircuit, circuit.logicalCircuitId, x, y, "up", `sym-${pinId}`);
  circuit.circuitSymbols.push(sym);
  return sym;
}

function createSampleHdlProject() {
  const project = createEmptyCircuitProject();
  const mainCircuit = project.logicalCircuits[0]!;
  mainCircuit.name = "TopAdder";
  mainCircuit.exportToHDL = true;

  const pA = addPinSymbol(mainCircuit, "pin-a", "input", "a", 1, 0, 2, 0);
  const pB = addPinSymbol(mainCircuit, "pin-b", "input", "b", 1, 0, 6, 1);
  const xorGate = createGate("xor", 2, false);
  const xorSym = createCircuitSymbol(xorGate, mainCircuit.logicalCircuitId, 8, 4, "up", "sym-xor");
  const pQ = addPinSymbol(mainCircuit, "pin-q", "output", "q", 1, 16, 4, 2);
  mainCircuit.circuitSymbols.push(xorSym);

  const inJams = xorSym.jams.filter((j) => j.effectivePinType === "input");
  const outJam = xorSym.jams.find((j) => j.effectivePinType === "output")!;
  mainCircuit.wires.push(
    makeWire("w1", mainCircuit.logicalCircuitId, pA.jams[0]!.absolutePoint, inJams[0]!.absolutePoint),
    makeWire("w2", mainCircuit.logicalCircuitId, pB.jams[0]!.absolutePoint, inJams[1]!.absolutePoint),
    makeWire("w3", mainCircuit.logicalCircuitId, outJam.absolutePoint, pQ.jams[0]!.absolutePoint),
  );

  const helper = createDefaultLogicalCircuit("lc-helper", "HelperNot");
  helper.exportToHDL = false;
  const hIn = addPinSymbol(helper, "hp-in", "input", "x", 1, 0, 2, 0);
  const notGate = createGate("not", 1, true);
  const notSym = createCircuitSymbol(notGate, helper.logicalCircuitId, 6, 2, "up", "sym-hnot");
  const hOut = addPinSymbol(helper, "hp-out", "output", "y", 1, 12, 2, 1);
  helper.circuitSymbols.push(notSym);
  helper.wires.push(
    makeWire(
      "wh1",
      helper.logicalCircuitId,
      hIn.jams[0]!.absolutePoint,
      notSym.jams.find((j) => j.effectivePinType === "input")!.absolutePoint,
    ),
    makeWire(
      "wh2",
      helper.logicalCircuitId,
      notSym.jams.find((j) => j.effectivePinType === "output")!.absolutePoint,
      hOut.jams[0]!.absolutePoint,
    ),
  );

  project.logicalCircuits.push(helper);
  project.circuits.set(helper.logicalCircuitId, helper);

  const mockContext = {
    project,
    currentCircuit: mainCircuit,
    currentCircuitId: mainCircuit.logicalCircuitId,
  } as unknown as React.ContextType<typeof CircuitContext>;

  return { project, mainCircuit, helper, mockContext };
}

describe("ExportHdlDialog & Folder Export (T-079)", () => {
  it("dispatches all three HDL languages cleanly via exportHdl", () => {
    const { project, mainCircuit } = createSampleHdlProject();

    const sv = exportHdl(project, mainCircuit, {
      language: "verilog",
      scope: "current",
      exportTests: true,
    });
    expect(sv.hasErrors).toBe(false);
    expect(sv.files.map((f) => f.fileName)).toEqual(["TopAdder.sv", "TopAdder_TestBench.sv"]);

    const vhdl = exportHdl(project, mainCircuit, {
      language: "vhdl",
      scope: "current",
      exportTests: true,
    });
    expect(vhdl.hasErrors).toBe(false);
    expect(vhdl.files.map((f) => f.fileName)).toEqual(["TopAdder.vhd", "TopAdder_tb.vhd"]);

    const n2t = exportHdl(project, mainCircuit, {
      language: "n2t",
      scope: "current",
      exportTests: true,
    });
    expect(n2t.hasErrors).toBe(false);
    expect(n2t.files.map((f) => f.fileName)).toEqual(["TopAdder.hdl", "TopAdder.tst", "TopAdder.cmp"]);
  });

  it("renders ExportHdlDialog with Verilog, VHDL, and Nand2Tetris live previews, tabs, and diagnostics", () => {
    const { mockContext } = createSampleHdlProject();

    const closedHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={mockContext}>
        <ExportHdlDialog isOpen={false} onClose={noop} />
      </CircuitContext.Provider>,
    );
    expect(closedHtml).not.toContain("ExportHdlDialog");

    const verilogHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={mockContext}>
        <ExportHdlDialog
          isOpen={true}
          onClose={noop}
          initialLanguage="verilog"
          initialScope="flaggedExportToHdl"
          initialExportTests={true}
        />
      </CircuitContext.Provider>,
    );
    expect(verilogHtml).toContain("data-component=\"ExportHdlDialog\"");
    expect(verilogHtml).toContain("TopAdder.sv");
    expect(verilogHtml).toContain("TopAdder_TestBench.sv");
    expect(verilogHtml).toContain("module TopAdder(");
    expect(verilogHtml).toContain("exportToHDL: 1");

    const vhdlHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={mockContext}>
        <ExportHdlDialog
          isOpen={true}
          onClose={noop}
          initialLanguage="vhdl"
          initialScope="current"
          initialExportTests={true}
        />
      </CircuitContext.Provider>,
    );
    expect(vhdlHtml).toContain("TopAdder.vhd");
    expect(vhdlHtml).toContain("TopAdder_tb.vhd");
    expect(vhdlHtml).toContain("entity TopAdder is");

    const n2tHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={mockContext}>
        <ExportHdlDialog
          isOpen={true}
          onClose={noop}
          initialLanguage="n2t"
          initialScope="current"
          initialExportTests={true}
        />
      </CircuitContext.Provider>,
    );
    expect(n2tHtml).toContain("TopAdder.hdl");
    expect(n2tHtml).toContain("TopAdder.tst");
    expect(n2tHtml).toContain("TopAdder.cmp");
    expect(n2tHtml).toContain("CHIP TopAdder");
  });

  it("displays error logs and disables export button when N2T encounters unsupported tri-state gates", () => {
    const project = createEmptyCircuitProject();
    const circuit = project.logicalCircuits[0]!;
    circuit.name = "TriBad";
    const triGate = createGate("triState1", 2, false);
    circuit.circuitSymbols.push(createCircuitSymbol(triGate, circuit.logicalCircuitId, 4, 4));

    const mockContext = {
      project,
      currentCircuit: circuit,
      currentCircuitId: circuit.logicalCircuitId,
    } as unknown as React.ContextType<typeof CircuitContext>;

    const html = renderToStaticMarkup(
      <CircuitContext.Provider value={mockContext}>
        <ExportHdlDialog isOpen={true} onClose={noop} initialLanguage="n2t" />
      </CircuitContext.Provider>,
    );

    expect(html).toContain("ERROR");
    expect(html).toContain(i18n.t("dialog.exportHdl.emptyPreview"));
  });

  it("writes all generated HDL files into a picked directory via exportTextFilesToDirectory", async () => {
    const written = new Map<string, string>();
    const dirHandle: FileSystemDirectoryHandleLike = {
      kind: "directory",
      name: "hdl-out",
      requestPermission: async () => "granted",
      getFileHandle: async (fileName: string) => ({
        kind: "file",
        name: fileName,
        getFile: async () => new File([written.get(fileName) ?? ""], fileName),
        createWritable: async () => ({
          write: async (data) => {
            written.set(fileName, typeof data === "string" ? data : "");
          },
          close: async () => undefined,
        }),
      }),
    };

    const pickerWindow: FileSystemPickerWindow = {
      showDirectoryPicker: vi.fn(async () => dirHandle),
    };

    expect(isDirectoryPickerSupported({ win: pickerWindow })).toBe(true);
    expect(isDirectoryPickerSupported({ win: {} })).toBe(false);

    const result = await exportTextFilesToDirectory(
      [
        { fileName: "Top.sv", content: "module Top; endmodule" },
        { fileName: "Top_TestBench.sv", content: "module Top_TestBench; endmodule" },
      ],
      null,
      { win: pickerWindow },
    );

    expect(result).toEqual({
      kind: "saved",
      directoryName: "hdl-out",
      fileCount: 2,
    });
    expect(written.get("Top.sv")).toBe("module Top; endmodule");
    expect(written.get("Top_TestBench.sv")).toBe("module Top_TestBench; endmodule");
  });

  it("exposes enabled/disabled file-export-hdl item in MainMenu", () => {
    const enabledMenu = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="file"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        canExportHdl={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportHdl={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(enabledMenu).toContain(i18n.t("menu.items.fileExportHdl"));

    const disabledMenu = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="file"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        canExportHdl={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportHdl={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(disabledMenu).toContain(i18n.t("menu.items.fileExportHdlDisabledTooltip"));
  });
});
