import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type Gate from "../../types/circuit/gate";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type {
  HdlBitRange,
  HdlExportOptions,
  HdlExportResult,
  HdlGeneratedFile,
  HdlLogEntry,
  HdlTruthTableVectors,
} from "../../types/hdl/hdlExportTypes";

import i18n from "../../i18n";

import { numberCellsFor } from "../memoryDataUtils";
import {
  compareHdlBitRangeDescending,
  createHdlLog,
  formatSymbolComment,
  formatTruthOutputBits,
  getJamWireIdentifier,
  getPortNameFromJam,
  getSortedPartInputJams,
  prepareHdlWirePlan,
  readMemoryInitialCells,
  resolveHdlTruthTableWithLogs,
  validateHdlFloatingPorts,
  validateHdlIdentifiers,
  type HdlWirePlan,
} from "./hdlCodeGenUtils";
import {
  bitRangeEquals,
  buildHdlCircuitGraph,
  createFullBitRange,
  extractBitRangeValue,
  getHdlJamDirection,
  resolveExportTargetCircuits,
  type HdlCircuitGraph,
  type HdlConnectionNode,
} from "./hdlGraphBuilder";

const VERILOG_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const VERILOG_UNSUPPORTED_CHARS_REGEX = /[\s,.?/!@#$%^&*()\-+={}[\]|\\<>~`]+/g;

const VERILOG_KEYWORDS = new Set([
  "always",
  "assign",
  "attribute",
  "begin",
  "bit",
  "buf",
  "bufif0",
  "case",
  "casex",
  "casez",
  "cmos",
  "deassign",
  "default",
  "defparam",
  "disable",
  "edge",
  "else",
  "end",
  "endattribute",
  "endcase",
  "endfunction",
  "endmodule",
  "endprimitive",
  "endspecify",
  "endtable",
  "endtask",
  "event",
  "for",
  "force",
  "forever",
  "fork",
  "function",
  "highz0",
  "highz1",
  "if",
  "ifnone",
  "initial",
  "inout",
  "input",
  "integer",
  "join",
  "large",
  "logic",
  "macromodule",
  "medium",
  "module",
  "negedge",
  "nmos",
  "notif0",
  "notif1",
  "output",
  "packed",
  "parameter",
  "pmos",
  "posedge",
  "primitive",
  "pull0",
  "pull1",
  "pulldown",
  "pullup",
  "rcmos",
  "real",
  "realtime",
  "reg",
  "release",
  "repeat",
  "rnmos",
  "rpmos",
  "rtran",
  "rtranif0",
  "rtranif1",
  "scalared",
  "signed",
  "small",
  "specify",
  "specparam",
  "strength",
  "strong0",
  "strong1",
  "struct",
  "supply0",
  "supply1",
  "table",
  "task",
  "time",
  "tran",
  "tranif0",
  "tranif1",
  "tri",
  "tri0",
  "tri1",
  "triand",
  "trior",
  "trireg",
  "unsigned",
  "vectored",
  "wait",
  "wand",
  "weak0",
  "weak1",
  "while",
  "wire",
  "wor",
]);

export function sanitizeVerilogIdentifier(name: string, fixNames: boolean): string {
  const trimmed = name.trim();
  if (!fixNames) {
    return trimmed;
  }
  let normalized = trimmed.replace(VERILOG_UNSUPPORTED_CHARS_REGEX, "_");
  normalized = normalized.replace(/^_+|_+$/g, (m) => (normalized.length > m.length ? m : "_"));
  if (normalized.length === 0) {
    return "_id";
  }
  if (/^\d/.test(normalized)) {
    normalized = `_${normalized}`;
  }
  if (VERILOG_KEYWORDS.has(normalized)) {
    normalized = `${normalized}_id`;
  }
  return normalized;
}

export function isValidVerilogIdentifier(name: string, fixNames = false): boolean {
  const candidate = sanitizeVerilogIdentifier(name, fixNames);
  return VERILOG_IDENTIFIER_REGEX.test(candidate) && !VERILOG_KEYWORDS.has(candidate);
}

function formatVerilogWidthRange(bitWidth: number): string {
  return bitWidth <= 1 ? "" : `[${bitWidth - 1}:0]`;
}

function formatVerilogSliceRange(range: HdlBitRange): string {
  return range.first === range.last ? `[${range.first}]` : `[${range.last}:${range.first}]`;
}

function getVerilogPartTypeName(
  symbol: CircuitSymbol,
  circuitVerilogName: string,
  fixNames: boolean,
): string {
  if (symbol.circuit.kind === "gate") {
    const gate = symbol.circuit as Gate;
    switch (gate.gateType) {
      case "not":
        return "not";
      case "or":
        return gate.invertedOutput ? "nor" : "or";
      case "and":
        return gate.invertedOutput ? "nand" : "and";
      case "xor":
        return gate.invertedOutput ? "xnor" : "xor";
      case "triState1":
      case "triState2":
        return "bufif1";
      default:
        return gate.gateType;
    }
  }
  if (symbol.circuit.kind === "memory") {
    const memory = symbol.circuit as Memory;
    const prefix = memory.writable ? "RAM" : "ROM";
    return `${circuitVerilogName}_${prefix}_${symbol.x}x${symbol.y}`;
  }
  return sanitizeVerilogIdentifier(symbol.circuit.name, fixNames);
}

function formatVerilogPlug(
  connection: HdlConnectionNode,
  wirePlan: HdlWirePlan,
  symbolById: Map<string, CircuitSymbol>,
  fixNames: boolean,
): string {
  const sourceJam = connection.outJam;
  const sourceSymbol = symbolById.get(sourceJam.circuitSymbolId);
  if (sourceSymbol?.circuit.kind === "constant") {
    const constant = sourceSymbol.circuit as Constant;
    const width = connection.outBits.last - connection.outBits.first + 1;
    const extracted = extractBitRangeValue(constant.value, connection.outBits);
    return `${width}'h${extracted.toString(16)}`;
  }

  const targetJam = wirePlan.wires.get(sourceJam) ?? sourceJam;
  let text = getJamWireIdentifier(
    targetJam,
    symbolById,
    sanitizeVerilogIdentifier,
    fixNames,
  );
  const fullRange = createFullBitRange(sourceJam.pin.bitWidth);
  if (!bitRangeEquals(connection.outBits, fullRange)) {
    text += formatVerilogSliceRange(connection.outBits);
  }
  return text;
}

function emitVerilogMemoryModule(
  symbol: CircuitSymbol,
  circuitVerilogName: string,
  fixNames: boolean,
): string {
  const memory = symbol.circuit as Memory;
  const moduleName = getVerilogPartTypeName(symbol, circuitVerilogName, fixNames);
  const addrRange = formatVerilogWidthRange(memory.addressBitWidth);
  const dataRange = formatVerilogWidthRange(memory.dataBitWidth);
  const cellCount = numberCellsFor(memory.addressBitWidth);

  const lines: string[] = [];
  let header = `module ${moduleName}(input${addrRange} address, output${dataRange} dataOut`;
  if (memory.writable) {
    header += `, input${dataRange} dataIn, input write`;
  }
  if (memory.dualPort) {
    header += `, input${addrRange} address2, output${dataRange} dataOut2`;
  }
  header += ");";
  lines.push(header);

  lines.push(`\treg${dataRange} memory[0:${cellCount - 1}];`);
  if (memory.writable && memory.onStart !== "data") {
    lines.push("\tinteger i;");
  }

  lines.push("\tinitial begin");
  if (!memory.writable || memory.onStart === "data") {
    const cells = readMemoryInitialCells(memory);
    for (let i = 0; i < cells.length; i++) {
      lines.push(`\t\tmemory[${i}] = ${(cells[i] ?? 0).toString(10)};`);
    }
  } else {
    let initExpr = "0";
    if (memory.onStart === "random") {
      initExpr = "$random";
    } else if (memory.onStart === "ones") {
      initExpr = "-1";
    }
    lines.push(`\t\tfor (i = 0; i < ${cellCount}; i = i + 1) begin`);
    lines.push(`\t\t\tmemory[i] = ${initExpr};`);
    lines.push("\t\tend");
  }
  lines.push("\tend // initial");
  lines.push("");

  if (memory.writable) {
    const edge = memory.writeOn1 ? "posedge" : "negedge";
    lines.push(`\talways @(${edge} write) begin`);
    lines.push("\t\tmemory[address] <= dataIn;");
    lines.push("\tend");
  }

  lines.push("\tassign dataOut = memory[address];");
  if (memory.dualPort) {
    lines.push("\tassign dataOut2 = memory[address2];");
  }
  lines.push(`endmodule // ${moduleName}`);
  lines.push("");
  return lines.join("\n");
}

function generateVerilogModuleContent(
  graph: HdlCircuitGraph,
  wirePlan: HdlWirePlan,
  options: Omit<HdlExportOptions, "language">,
  logs: HdlLogEntry[],
): string | null {
  const fixNames = options.fixNames ?? true;
  const commentPoints = options.commentPoints ?? false;
  const circuitName = sanitizeVerilogIdentifier(graph.circuit.name, fixNames);

  const symbolById = new Map<string, CircuitSymbol>();
  for (const node of graph.allSymbols) {
    symbolById.set(node.circuitSymbol.circuitSymbolId, node.circuitSymbol);
  }

  const lines: string[] = [];

  for (const part of graph.parts) {
    if (part.circuitSymbol.circuit.kind === "memory") {
      lines.push(emitVerilogMemoryModule(part.circuitSymbol, circuitName, fixNames));
    }
  }

  lines.push(`// This file is generated by Logic Circuit Web from circuit ${graph.circuit.name}`);
  lines.push(`module ${circuitName}(`);

  const allPins = [...graph.inputPins, ...graph.outputPins];
  for (let i = 0; i < allPins.length; i++) {
    const pinNode = allPins[i]!;
    const sym = pinNode.circuitSymbol;
    const isInput = i < graph.inputPins.length;
    const dir = isInput ? "input" : "output";
    const bitWidth = sym.jams[0]?.pin.bitWidth ?? 1;
    const range = formatVerilogWidthRange(bitWidth);
    const pinIdent = sanitizeVerilogIdentifier(sym.circuit.name, fixNames);
    const comma = i < allPins.length - 1 ? "," : "";
    lines.push(`\t${dir}${range}\t${pinIdent}${comma}`);
  }
  lines.push(");");

  for (const wireJam of wirePlan.internalWireJams) {
    const range = formatVerilogWidthRange(wireJam.pin.bitWidth);
    const wireName = getJamWireIdentifier(wireJam, symbolById, sanitizeVerilogIdentifier, fixNames);
    lines.push(`\twire${range} ${wireName};`);
  }
  lines.push("");

  for (const part of graph.parts) {
    const sym = part.circuitSymbol;
    if (commentPoints) {
      lines.push(`\t// ${formatSymbolComment(sym)}`);
    }
    const partType = getVerilogPartTypeName(sym, circuitName, fixNames);
    lines.push(`\t${partType} ${partType}_${sym.x}x${sym.y}(`);

    if (sym.circuit.kind === "gate") {
      const outJam = sym.jams.find((j) => getHdlJamDirection(j, sym.circuit) === "output");
      if (outJam) {
        const resolvedOutJam = wirePlan.wires.get(outJam) ?? outJam;
        const outExpr = getJamWireIdentifier(
          resolvedOutJam,
          symbolById,
          sanitizeVerilogIdentifier,
          fixNames,
        );

        const portArgs: string[] = [outExpr];
        const inputs = getSortedPartInputJams(sym);
        for (const inJam of inputs) {
          const inList = (wirePlan.connectionsByJam.get(inJam) ?? []).filter((c) => c.inJam === inJam);
          if (inList.length > 1) {
            const params = {
              pinName: inJam.pin.name,
              symbolName: sym.circuit.name,
              x: sym.x,
              y: sym.y,
              circuitName: graph.circuit.name,
            };
            logs.push(
              createHdlLog(
                "error",
                "multipleDrivers",
                graph.circuit.name,
                i18n.t("errors.hdlExport.multipleDrivers", params),
                params,
              ),
            );
            return null;
          }
          if (inList.length === 1) {
            portArgs.push(formatVerilogPlug(inList[0]!, wirePlan, symbolById, fixNames));
          }
        }

        for (let idx = 0; idx < portArgs.length; idx++) {
          const comma = idx < portArgs.length - 1 ? "," : "";
          lines.push(`\t\t${portArgs[idx]!}${comma}`);
        }
      }
    } else {
      const portEntries: string[] = [];
      for (const jam of sym.jams) {
        const dir = getHdlJamDirection(jam, sym.circuit);
        const list = (wirePlan.connectionsByJam.get(jam) ?? []).filter(
          (c) => (dir === "output" ? c.outJam === jam : c.inJam === jam),
        );
        if (list.length === 0) {
          continue;
        }
        const portName = getPortNameFromJam(jam, sym, sanitizeVerilogIdentifier, fixNames);
        let valueExpr: string;
        if (dir === "output") {
          const resolvedJam = wirePlan.wires.get(jam) ?? jam;
          valueExpr = getJamWireIdentifier(
            resolvedJam,
            symbolById,
            sanitizeVerilogIdentifier,
            fixNames,
          );
        } else {
          const sortedSlices = [...list].sort((a, b) =>
            compareHdlBitRangeDescending(a.inBits, b.inBits),
          );
          const sliceTexts = sortedSlices.map((conn) =>
            formatVerilogPlug(conn, wirePlan, symbolById, fixNames),
          );
          valueExpr = sliceTexts.length > 1 ? `{${sliceTexts.join(", ")}}` : sliceTexts[0]!;
        }
        portEntries.push(`\t\t.${portName}(${valueExpr})`);
      }

      for (let idx = 0; idx < portEntries.length; idx++) {
        const comma = idx < portEntries.length - 1 ? "," : "";
        lines.push(`${portEntries[idx]!}${comma}`);
      }
    }

    lines.push("\t);");
  }

  lines.push("");

  if (wirePlan.assignments.length > 0) {
    for (const conn of wirePlan.assignments) {
      const lhsName = sanitizeVerilogIdentifier(conn.inSymbol.circuitSymbol.circuit.name, fixNames);
      const lhsRange = bitRangeEquals(conn.inBits, createFullBitRange(conn.inJam.pin.bitWidth))
        ? ""
        : formatVerilogSliceRange(conn.inBits);
      const rhsExpr = formatVerilogPlug(conn, wirePlan, symbolById, fixNames);
      lines.push(`\tassign ${lhsName}${lhsRange} = ${rhsExpr};`);
    }
    lines.push("");
  }

  lines.push(`endmodule // ${circuitName}`);
  return `${lines.join("\n")}\n`;
}

function generateVerilogTestBenchContent(
  circuitName: string,
  rawCircuitName: string,
  vectors: HdlTruthTableVectors,
  fixNames: boolean,
): string {
  const safeCircuitName = sanitizeVerilogIdentifier(circuitName, fixNames);
  const lines: string[] = [];

  lines.push(`// This file is generated by Logic Circuit Web from circuit ${rawCircuitName}`);
  lines.push(`module ${safeCircuitName}_TestBench;`);
  lines.push("\tstruct packed {");

  for (const inp of vectors.inputs) {
    const typeName = inp.bitWidth <= 1 ? "bit" : `bit[${inp.bitWidth - 1}:0]`;
    lines.push(`\t\t${typeName} ${sanitizeVerilogIdentifier(inp.name, fixNames)};`);
  }
  for (const out of vectors.outputs) {
    const typeName = out.bitWidth <= 1 ? "logic" : `logic[${out.bitWidth - 1}:0]`;
    lines.push(`\t\t${typeName} ${sanitizeVerilogIdentifier(out.name, fixNames)};`);
  }

  lines.push(`\t} TestBenchTruthState[${vectors.rows.length}] = '{`);

  for (let rowIdx = 0; rowIdx < vectors.rows.length; rowIdx++) {
    const row = vectors.rows[rowIdx]!;
    const values: string[] = [];

    for (let i = 0; i < vectors.inputs.length; i++) {
      const inp = vectors.inputs[i]!;
      const rawVal = (row.inputs[i] ?? 0) >>> 0;
      values.push(`${inp.bitWidth}'h${rawVal.toString(16)}`);
    }

    for (let o = 0; o < vectors.outputs.length; o++) {
      const out = vectors.outputs[o]!;
      const bitStates = row.rawStates[o] ?? [];
      const formatted = formatTruthOutputBits(bitStates, out.bitWidth, "z");
      if (formatted.hasHighZ) {
        values.push(`${out.bitWidth}'b${formatted.bits}`);
      } else {
        const numericVal = row.outputs?.[o] !== undefined ? row.outputs[o]! >>> 0 : 0;
        values.push(`${out.bitWidth}'h${numericVal.toString(16)}`);
      }
    }

    const rowComma = rowIdx < vectors.rows.length - 1 ? "," : "";
    lines.push(`\t\t'{${values.join(", ")}}${rowComma}`);
  }

  lines.push("\t};");
  lines.push("");

  for (const inp of vectors.inputs) {
    const range = formatVerilogWidthRange(inp.bitWidth);
    const space = range ? `${range} ` : "";
    lines.push(`\treg ${space}${sanitizeVerilogIdentifier(inp.name, fixNames)};`);
  }
  for (const out of vectors.outputs) {
    const range = formatVerilogWidthRange(out.bitWidth);
    const space = range ? `${range} ` : "";
    lines.push(`\twire ${space}${sanitizeVerilogIdentifier(out.name, fixNames)};`);
  }
  lines.push("");

  lines.push(`\t${safeCircuitName} u0(`);
  const allPins = [...vectors.inputs, ...vectors.outputs];
  for (let i = 0; i < allPins.length; i++) {
    const portIdent = sanitizeVerilogIdentifier(allPins[i]!.name, fixNames);
    const comma = i < allPins.length - 1 ? "," : "";
    lines.push(`\t\t.${portIdent}(${portIdent})${comma}`);
  }
  lines.push("\t);");
  lines.push("");

  lines.push("\tinitial begin");
  lines.push(`\t\t$display("Starting testbench for ${safeCircuitName}_TestBench");`);
  lines.push("\t\tforeach (TestBenchTruthState[i]) begin");

  for (const inp of vectors.inputs) {
    const pinIdent = sanitizeVerilogIdentifier(inp.name, fixNames);
    lines.push(`\t\t\t${pinIdent} = TestBenchTruthState[i].${pinIdent};`);
  }
  lines.push("\t\t\t#10;");

  for (const out of vectors.outputs) {
    const pinIdent = sanitizeVerilogIdentifier(out.name, fixNames);
    lines.push(`\t\t\tif (${pinIdent} !== TestBenchTruthState[i].${pinIdent}) begin`);
    lines.push(
      `\t\t\t\t$error("Output ${pinIdent} expected 0b%0b actual 0b%0b for i=%0d", TestBenchTruthState[i].${pinIdent}, ${pinIdent}, i);`,
    );
    lines.push("\t\t\tend");
  }

  lines.push("\t\tend");
  lines.push(`\t\t$display("Testbench completed for ${safeCircuitName}_TestBench");`);
  lines.push("\tend");
  lines.push(`endmodule // ${safeCircuitName}_TestBench`);
  return `${lines.join("\n")}\n`;
}

// Exportiert die aufgelösten Schaltungen als SystemVerilog-Module (.sv) inkl. optionaler Testbenches
export function exportVerilog(
  project: CircuitProject,
  currentCircuit: LogicalCircuit,
  options: Omit<HdlExportOptions, "language">,
): HdlExportResult {
  const fixNames = options.fixNames ?? true;
  const targets = resolveExportTargetCircuits(project, currentCircuit, options.scope);
  const files: HdlGeneratedFile[] = [];
  const logs: HdlLogEntry[] = [];
  let hasErrors = false;

  if (targets.length === 0) {
    logs.push(
      createHdlLog(
        "warning",
        "noCircuitsSelected",
        currentCircuit.name,
        i18n.t("errors.hdlExport.noCircuitsSelected"),
      ),
    );
    return { files, logs, hasErrors: false, targetCircuits: [] };
  }

  for (const circuit of targets) {
    const namesOk = validateHdlIdentifiers(
      circuit,
      "Verilog",
      fixNames,
      isValidVerilogIdentifier,
      sanitizeVerilogIdentifier,
      logs,
    );
    if (!namesOk) {
      hasErrors = true;
      continue;
    }

    const graph = buildHdlCircuitGraph(circuit, project, "verilog", {
      checkUnconnectedInputs: false,
    });
    logs.push(...graph.logs);
    if (graph.hasErrors) {
      hasErrors = true;
      continue;
    }

    const wirePlan = prepareHdlWirePlan(graph, true);
    const portsValid = validateHdlFloatingPorts(graph, wirePlan, logs);
    if (!portsValid) {
      hasErrors = true;
      continue;
    }

    const moduleContent = generateVerilogModuleContent(graph, wirePlan, options, logs);
    if (moduleContent === null) {
      hasErrors = true;
      continue;
    }

    const safeName = sanitizeVerilogIdentifier(circuit.name, fixNames);
    const moduleFileName = `${safeName}.sv`;
    files.push({
      fileName: moduleFileName,
      circuitId: circuit.logicalCircuitId,
      circuitName: circuit.name,
      language: "verilog",
      kind: "module",
      content: moduleContent,
    });
    logs.push(
      createHdlLog(
        "info",
        "exportSuccess",
        circuit.name,
        i18n.t("errors.hdlExport.fileGenerated", {
          fileName: moduleFileName,
          circuitName: circuit.name,
        }),
        { fileName: moduleFileName, circuitName: circuit.name },
      ),
    );

    if (options.exportTests) {
      const vectors = resolveHdlTruthTableWithLogs(graph, logs);
      if (vectors) {
        const tbFileName = `${safeName}_TestBench.sv`;
        const tbContent = generateVerilogTestBenchContent(safeName, circuit.name, vectors, fixNames);
        files.push({
          fileName: tbFileName,
          circuitId: circuit.logicalCircuitId,
          circuitName: circuit.name,
          language: "verilog",
          kind: "testbench",
          content: tbContent,
        });
        logs.push(
          createHdlLog(
            "info",
            "exportSuccess",
            circuit.name,
            i18n.t("errors.hdlExport.fileGenerated", {
              fileName: tbFileName,
              circuitName: circuit.name,
            }),
            { fileName: tbFileName, circuitName: circuit.name },
          ),
        );
      }
    }
  }

  return {
    files,
    logs,
    hasErrors,
    targetCircuits: targets.map((c) => c.name),
  };
}
