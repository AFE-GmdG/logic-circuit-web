import type CircuitProject from "../../types/circuit/circuitProject";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type { HdlExportOptions, HdlExportResult } from "../../types/hdl/hdlExportTypes";

import { exportN2t } from "./n2tExporter";
import { exportVerilog } from "./verilogExporter";
import { exportVhdl } from "./vhdlExporter";

// Zentrale Export-Fassade für alle drei unterstützten HDL-Zielformate (Verilog, VHDL, Nand2Tetris)
export function exportHdl(
  project: CircuitProject,
  currentCircuit: LogicalCircuit,
  options: HdlExportOptions,
): HdlExportResult {
  const { language, ...restOptions } = options;
  switch (language) {
    case "verilog":
      return exportVerilog(project, currentCircuit, restOptions);
    case "vhdl":
      return exportVhdl(project, currentCircuit, restOptions);
    case "n2t":
      return exportN2t(project, currentCircuit, restOptions);
  }
}
