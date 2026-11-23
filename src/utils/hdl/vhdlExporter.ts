import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type Gate from "../../types/circuit/gate";
import type Jam from "../../types/circuit/jam";
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
  formatUnsignedBits,
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

// VHDL-Bezeichner dürfen weder mit '_' beginnen/enden noch doppelte '__' enthalten
const VHDL_IDENTIFIER_REGEX = /^[a-zA-Z](?:_?[a-zA-Z0-9])*$/;

const VHDL_KEYWORDS = new Set([
  "abs",
  "access",
  "after",
  "alias",
  "all",
  "and",
  "architecture",
  "array",
  "assert",
  "assume",
  "attribute",
  "begin",
  "block",
  "body",
  "buffer",
  "bus",
  "case",
  "component",
  "configuration",
  "constant",
  "context",
  "cover",
  "default",
  "disconnect",
  "downto",
  "else",
  "elsif",
  "end",
  "entity",
  "exit",
  "fairness",
  "file",
  "for",
  "force",
  "function",
  "generate",
  "generic",
  "group",
  "guarded",
  "ieee",
  "if",
  "impure",
  "in",
  "inertial",
  "inout",
  "is",
  "label",
  "library",
  "linkage",
  "literal",
  "loop",
  "map",
  "mod",
  "nand",
  "new",
  "next",
  "nor",
  "not",
  "null",
  "numeric_std",
  "of",
  "on",
  "open",
  "or",
  "others",
  "out",
  "package",
  "parameter",
  "port",
  "postponed",
  "private",
  "procedure",
  "process",
  "property",
  "protected",
  "pure",
  "range",
  "record",
  "register",
  "reject",
  "release",
  "rem",
  "report",
  "restrict",
  "return",
  "rol",
  "ror",
  "select",
  "sequence",
  "severity",
  "signal",
  "signed",
  "sla",
  "sll",
  "sra",
  "srl",
  "std_logic",
  "std_logic_1164",
  "std_logic_vector",
  "strong",
  "subtype",
  "then",
  "to",
  "transport",
  "type",
  "unaffected",
  "units",
  "unsigned",
  "until",
  "use",
  "variable",
  "vmode",
  "vprop",
  "vunit",
  "wait",
  "when",
  "while",
  "with",
  "work",
  "xnor",
  "xor",
]);

export function sanitizeVhdlIdentifier(name: string, fixNames: boolean): string {
  const trimmed = name.trim();
  if (!fixNames) {
    return trimmed;
  }
  let normalized = trimmed
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) {
    return "n_sig";
  }
  if (/^\d/.test(normalized)) {
    normalized = `n_${normalized}`;
  }
  if (VHDL_KEYWORDS.has(normalized.toLowerCase())) {
    normalized = `${normalized}_sig`;
  }
  return normalized;
}

export function isValidVhdlIdentifier(name: string, fixNames = false): boolean {
  const candidate = sanitizeVhdlIdentifier(name, fixNames);
  return (
    VHDL_IDENTIFIER_REGEX.test(candidate) && !VHDL_KEYWORDS.has(candidate.toLowerCase())
  );
}

function vhdlSignalType(bitWidth: number): string {
  return bitWidth <= 1 ? "std_logic" : `std_logic_vector(${bitWidth - 1} downto 0)`;
}

function vhdlConstantLiteral(value: number, bitWidth: number): string {
  if (bitWidth <= 1) {
    return (value & 1) === 1 ? "'1'" : "'0'";
  }
  return `"${formatUnsignedBits(value, bitWidth)}"`;
}

function formatVhdlSlice(range: HdlBitRange, fullBitWidth: number): string {
  if (bitRangeEquals(range, createFullBitRange(fullBitWidth))) {
    return "";
  }
  if (range.first === range.last) {
    return `(${range.first})`;
  }
  return `(${range.last} downto ${range.first})`;
}

function getVhdlPartTypeName(
  symbol: CircuitSymbol,
  circuitVhdlName: string,
  fixNames: boolean,
): string {
  if (symbol.circuit.kind === "memory") {
    const memory = symbol.circuit as Memory;
    const prefix = memory.writable ? "RAM" : "ROM";
    return `${circuitVhdlName}_${prefix}_${symbol.x}x${symbol.y}`;
  }
  return sanitizeVhdlIdentifier(symbol.circuit.name, fixNames);
}

function formatVhdlPlug(
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
    return vhdlConstantLiteral(extracted, width);
  }

  const targetJam = wirePlan.wires.get(sourceJam) ?? sourceJam;
  let text = getJamWireIdentifier(
    targetJam,
    symbolById,
    sanitizeVhdlIdentifier,
    fixNames,
    "_",
  );
  text += formatVhdlSlice(connection.outBits, sourceJam.pin.bitWidth);
  return text;
}

function emitVhdlMemoryEntity(
  symbol: CircuitSymbol,
  circuitVhdlName: string,
  fixNames: boolean,
): string {
  const memory = symbol.circuit as Memory;
  const entityName = getVhdlPartTypeName(symbol, circuitVhdlName, fixNames);
  const cellCount = numberCellsFor(memory.addressBitWidth);
  const addrType = vhdlSignalType(memory.addressBitWidth);
  const dataType = vhdlSignalType(memory.dataBitWidth);

  const lines: string[] = [];
  lines.push("library ieee;");
  lines.push("use ieee.std_logic_1164.all;");
  lines.push("use ieee.numeric_std.all;");
  lines.push("");
  lines.push(`entity ${entityName} is`);
  lines.push("  port (");

  const portDecls: string[] = [
    `    address : in ${addrType}`,
    `    dataOut : out ${dataType}`,
  ];
  if (memory.writable) {
    portDecls.push(`    dataIn : in ${dataType}`);
    portDecls.push("    write : in std_logic");
  }
  if (memory.dualPort) {
    portDecls.push(`    address2 : in ${addrType}`);
    portDecls.push(`    dataOut2 : out ${dataType}`);
  }
  lines.push(`${portDecls.join(";\n")}`);
  lines.push("  );");
  lines.push(`end entity ${entityName};`);
  lines.push("");
  lines.push(`architecture rtl of ${entityName} is`);
  lines.push(`  type mem_array_t is array (0 to ${cellCount - 1}) of ${dataType};`);

  if (!memory.writable || memory.onStart === "data") {
    const cells = readMemoryInitialCells(memory);
    const literals = cells.map((val) => vhdlConstantLiteral(val, memory.dataBitWidth));
    lines.push("  signal memory : mem_array_t := (");
    for (let i = 0; i < literals.length; i += 8) {
      const chunk = literals.slice(i, i + 8).join(", ");
      const comma = i + 8 < literals.length ? "," : "";
      lines.push(`    ${chunk}${comma}`);
    }
    lines.push("  );");
  } else {
    const fillBit = memory.onStart === "ones" ? "'1'" : "'0'";
    const defaultElem =
      memory.dataBitWidth <= 1 ? fillBit : `(others => ${fillBit})`;
    const comment =
      memory.onStart === "random"
        ? " -- Initialized to 0 for synthesizable VHDL (LogicCircuit random)"
        : "";
    lines.push(`  signal memory : mem_array_t := (others => ${defaultElem});${comment}`);
  }

  lines.push("begin");

  if (memory.writable) {
    const edgeFn = memory.writeOn1 ? "rising_edge" : "falling_edge";
    lines.push("  process (write)");
    lines.push("  begin");
    lines.push(`    if ${edgeFn}(write) then`);
    if (memory.addressBitWidth <= 1) {
      lines.push("      if address = '1' then");
      lines.push("        memory(1) <= dataIn;");
      lines.push("      else");
      lines.push("        memory(0) <= dataIn;");
      lines.push("      end if;");
    } else {
      lines.push("      memory(to_integer(unsigned(address))) <= dataIn;");
    }
    lines.push("    end if;");
    lines.push("  end process;");
  }

  if (memory.addressBitWidth <= 1) {
    lines.push("  dataOut <= memory(1) when address = '1' else memory(0);");
    if (memory.dualPort) {
      lines.push("  dataOut2 <= memory(1) when address2 = '1' else memory(0);");
    }
  } else {
    lines.push("  dataOut <= memory(to_integer(unsigned(address)));");
    if (memory.dualPort) {
      lines.push("  dataOut2 <= memory(to_integer(unsigned(address2)));");
    }
  }

  lines.push("end architecture rtl;");
  lines.push("");
  return lines.join("\n");
}

function buildVhdlGateExpression(
  gate: Gate,
  inputExprs: string[],
): string | null {
  switch (gate.gateType) {
    case "not":
      return `not (${inputExprs[0] ?? "'0'"})`;
    case "and":
      return gate.invertedOutput
        ? `not (${inputExprs.join(" and ")})`
        : inputExprs.join(" and ");
    case "or":
      return gate.invertedOutput
        ? `not (${inputExprs.join(" or ")})`
        : inputExprs.join(" or ");
    case "xor":
      return gate.invertedOutput
        ? `not (${inputExprs.join(" xor ")})`
        : inputExprs.join(" xor ");
    case "triState1":
    case "triState2":
      return `${inputExprs[0] ?? "'0'"} when ${inputExprs[1] ?? "'0'"} = '1' else 'Z'`;
    default:
      return null;
  }
}

function generateVhdlModuleContent(
  graph: HdlCircuitGraph,
  wirePlan: HdlWirePlan,
  options: Omit<HdlExportOptions, "language">,
  logs: HdlLogEntry[],
): string | null {
  const fixNames = options.fixNames ?? true;
  const commentPoints = options.commentPoints ?? false;
  const circuitName = sanitizeVhdlIdentifier(graph.circuit.name, fixNames);

  const symbolById = new Map<string, CircuitSymbol>();
  for (const node of graph.allSymbols) {
    symbolById.set(node.circuitSymbol.circuitSymbolId, node.circuitSymbol);
  }

  const embeddedMemories: string[] = [];
  for (const part of graph.parts) {
    if (part.circuitSymbol.circuit.kind === "memory") {
      embeddedMemories.push(emitVhdlMemoryEntity(part.circuitSymbol, circuitName, fixNames));
    }
  }

  // Prüfe Hilfssignale für Multi-Slice-Eingänge an Subschaltungen/RAMs, um strikte VHDL-93-Kompatibilität zu garantieren
  const concatSignals: { sigName: string; bitWidth: number; expr: string }[] = [];
  const concatByJam = new Map<Jam, string>();

  for (const part of graph.parts) {
    const sym = part.circuitSymbol;
    if (sym.circuit.kind === "gate") {
      continue;
    }
    for (const jam of sym.jams) {
      if (getHdlJamDirection(jam, sym.circuit) === "output") {
        continue;
      }
      const list = (wirePlan.connectionsByJam.get(jam) ?? []).filter((c) => c.inJam === jam);
      if (list.length > 1) {
        const sortedSlices = [...list].sort((a, b) =>
          compareHdlBitRangeDescending(a.inBits, b.inBits),
        );
        const portName = getPortNameFromJam(jam, sym, sanitizeVhdlIdentifier, fixNames);
        const sigName = `Cat_${sym.x}x${sym.y}_${portName}`;
        const expr = sortedSlices
          .map((conn) => formatVhdlPlug(conn, wirePlan, symbolById, fixNames))
          .join(" & ");
        concatByJam.set(jam, sigName);
        concatSignals.push({ sigName, bitWidth: jam.pin.bitWidth, expr });
      }
    }
  }

  const lines: string[] = [];
  if (embeddedMemories.length > 0) {
    lines.push(...embeddedMemories);
  }

  lines.push(`-- This file is generated by Logic Circuit Web from circuit ${graph.circuit.name}`);
  lines.push("library ieee;");
  lines.push("use ieee.std_logic_1164.all;");
  lines.push("");
  lines.push(`entity ${circuitName} is`);

  const allPins = [...graph.inputPins, ...graph.outputPins];
  if (allPins.length > 0) {
    lines.push("  port (");
    for (let i = 0; i < allPins.length; i++) {
      const sym = allPins[i]!.circuitSymbol;
      const dir = i < graph.inputPins.length ? "in" : "out";
      const bitWidth = sym.jams[0]?.pin.bitWidth ?? 1;
      const pinIdent = sanitizeVhdlIdentifier(sym.circuit.name, fixNames);
      const sep = i < allPins.length - 1 ? ";" : "";
      lines.push(`    ${pinIdent} : ${dir} ${vhdlSignalType(bitWidth)}${sep}`);
    }
    lines.push("  );");
  }

  lines.push(`end entity ${circuitName};`);
  lines.push("");
  lines.push(`architecture rtl of ${circuitName} is`);

  for (const wireJam of wirePlan.internalWireJams) {
    const wireName = getJamWireIdentifier(
      wireJam,
      symbolById,
      sanitizeVhdlIdentifier,
      fixNames,
      "_",
    );
    lines.push(`  signal ${wireName} : ${vhdlSignalType(wireJam.pin.bitWidth)};`);
  }

  for (const cat of concatSignals) {
    lines.push(`  signal ${cat.sigName} : ${vhdlSignalType(cat.bitWidth)};`);
  }

  lines.push("begin");

  for (const cat of concatSignals) {
    lines.push(`  ${cat.sigName} <= ${cat.expr};`);
  }

  for (const part of graph.parts) {
    const sym = part.circuitSymbol;
    if (commentPoints) {
      lines.push(`  -- ${formatSymbolComment(sym)}`);
    }

    if (sym.circuit.kind === "gate") {
      const gate = sym.circuit as Gate;
      const outJam = sym.jams.find((j) => getHdlJamDirection(j, sym.circuit) === "output");
      if (!outJam) {
        continue;
      }

      const resolvedOutJam = wirePlan.wires.get(outJam) ?? outJam;
      const lhsExpr = getJamWireIdentifier(
        resolvedOutJam,
        symbolById,
        sanitizeVhdlIdentifier,
        fixNames,
        "_",
      );

      const inputExprs: string[] = [];
      for (const inJam of getSortedPartInputJams(sym)) {
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
          inputExprs.push(formatVhdlPlug(inList[0]!, wirePlan, symbolById, fixNames));
        }
      }

      const rhsExpr = buildVhdlGateExpression(gate, inputExprs);
      if (rhsExpr) {
        lines.push(`  ${lhsExpr} <= ${rhsExpr};`);
      }
    } else {
      const partType = getVhdlPartTypeName(sym, circuitName, fixNames);
      const portMaps: string[] = [];

      for (const jam of sym.jams) {
        const dir = getHdlJamDirection(jam, sym.circuit);
        const list = (wirePlan.connectionsByJam.get(jam) ?? []).filter(
          (c) => (dir === "output" ? c.outJam === jam : c.inJam === jam),
        );
        if (list.length === 0) {
          continue;
        }
        const portName = getPortNameFromJam(jam, sym, sanitizeVhdlIdentifier, fixNames);
        let actualExpr: string;
        if (dir === "output") {
          const resolvedJam = wirePlan.wires.get(jam) ?? jam;
          actualExpr = getJamWireIdentifier(
            resolvedJam,
            symbolById,
            sanitizeVhdlIdentifier,
            fixNames,
            "_",
          );
        } else {
          const catSig = concatByJam.get(jam);
          actualExpr = catSig ?? formatVhdlPlug(list[0]!, wirePlan, symbolById, fixNames);
        }
        portMaps.push(`      ${portName} => ${actualExpr}`);
      }

      lines.push(`  u_${partType}_${sym.x}x${sym.y} : entity work.${partType}`);
      if (portMaps.length > 0) {
        lines.push("    port map (");
        for (let idx = 0; idx < portMaps.length; idx++) {
          const comma = idx < portMaps.length - 1 ? "," : "";
          lines.push(`${portMaps[idx]!}${comma}`);
        }
        lines.push("    );");
      } else {
        lines.push("    ;");
      }
    }
  }

  for (const conn of wirePlan.assignments) {
    const lhsName = sanitizeVhdlIdentifier(conn.inSymbol.circuitSymbol.circuit.name, fixNames);
    const lhsSlice = formatVhdlSlice(conn.inBits, conn.inJam.pin.bitWidth);
    const rhsExpr = formatVhdlPlug(conn, wirePlan, symbolById, fixNames);
    lines.push(`  ${lhsName}${lhsSlice} <= ${rhsExpr};`);
  }

  lines.push("end architecture rtl;");
  return `${lines.join("\n")}\n`;
}

function generateVhdlTestBenchContent(
  safeCircuitName: string,
  rawCircuitName: string,
  vectors: HdlTruthTableVectors,
  fixNames: boolean,
): string {
  const lines: string[] = [];
  lines.push(`-- This file is generated by Logic Circuit Web from circuit ${rawCircuitName}`);
  lines.push("library ieee;");
  lines.push("use ieee.std_logic_1164.all;");
  lines.push("");
  lines.push(`entity ${safeCircuitName}_tb is`);
  lines.push(`end entity ${safeCircuitName}_tb;`);
  lines.push("");
  lines.push(`architecture sim of ${safeCircuitName}_tb is`);

  for (const inp of vectors.inputs) {
    const pinIdent = sanitizeVhdlIdentifier(inp.name, fixNames);
    const initVal = inp.bitWidth <= 1 ? "'0'" : "(others => '0')";
    lines.push(`  signal ${pinIdent} : ${vhdlSignalType(inp.bitWidth)} := ${initVal};`);
  }
  for (const out of vectors.outputs) {
    const pinIdent = sanitizeVhdlIdentifier(out.name, fixNames);
    lines.push(`  signal ${pinIdent} : ${vhdlSignalType(out.bitWidth)};`);
  }

  lines.push("begin");
  lines.push(`  dut : entity work.${safeCircuitName}`);
  lines.push("    port map (");
  const allPins = [...vectors.inputs, ...vectors.outputs];
  for (let i = 0; i < allPins.length; i++) {
    const portIdent = sanitizeVhdlIdentifier(allPins[i]!.name, fixNames);
    const comma = i < allPins.length - 1 ? "," : "";
    lines.push(`      ${portIdent} => ${portIdent}${comma}`);
  }
  lines.push("    );");
  lines.push("");
  lines.push("  stim_proc : process");
  lines.push("  begin");

  for (let rowIdx = 0; rowIdx < vectors.rows.length; rowIdx++) {
    const row = vectors.rows[rowIdx]!;
    for (let i = 0; i < vectors.inputs.length; i++) {
      const inp = vectors.inputs[i]!;
      const pinIdent = sanitizeVhdlIdentifier(inp.name, fixNames);
      const literal = vhdlConstantLiteral((row.inputs[i] ?? 0) >>> 0, inp.bitWidth);
      lines.push(`    ${pinIdent} <= ${literal};`);
    }
    lines.push("    wait for 10 ns;");

    for (let o = 0; o < vectors.outputs.length; o++) {
      const out = vectors.outputs[o]!;
      const pinIdent = sanitizeVhdlIdentifier(out.name, fixNames);
      const formatted = formatTruthOutputBits(row.rawStates[o] ?? [], out.bitWidth, "Z");
      const expectedLiteral =
        out.bitWidth <= 1 ? `'${formatted.bits}'` : `"${formatted.bits}"`;
      lines.push(
        `    assert ${pinIdent} = ${expectedLiteral} report "Mismatch on ${pinIdent} at vector ${rowIdx}" severity error;`,
      );
    }
  }

  lines.push("    wait;");
  lines.push("  end process stim_proc;");
  lines.push("end architecture sim;");
  return `${lines.join("\n")}\n`;
}

// Exportiert die aufgelösten Schaltungen als IEEE-1164-VHDL-Entitäten (.vhd) inkl. optionaler Testbenches
export function exportVhdl(
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
      "VHDL",
      fixNames,
      isValidVhdlIdentifier,
      sanitizeVhdlIdentifier,
      logs,
    );
    if (!namesOk) {
      hasErrors = true;
      continue;
    }

    const graph = buildHdlCircuitGraph(circuit, project, "vhdl", {
      checkUnconnectedInputs: false,
    });
    logs.push(...graph.logs);
    if (graph.hasErrors) {
      hasErrors = true;
      continue;
    }

    const wirePlan = prepareHdlWirePlan(graph, false);
    const portsValid = validateHdlFloatingPorts(graph, wirePlan, logs);
    if (!portsValid) {
      hasErrors = true;
      continue;
    }

    const moduleContent = generateVhdlModuleContent(graph, wirePlan, options, logs);
    if (moduleContent === null) {
      hasErrors = true;
      continue;
    }

    const safeName = sanitizeVhdlIdentifier(circuit.name, fixNames);
    const moduleFileName = `${safeName}.vhd`;
    files.push({
      fileName: moduleFileName,
      circuitId: circuit.logicalCircuitId,
      circuitName: circuit.name,
      language: "vhdl",
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
        const tbFileName = `${safeName}_tb.vhd`;
        const tbContent = generateVhdlTestBenchContent(safeName, circuit.name, vectors, fixNames);
        files.push({
          fileName: tbFileName,
          circuitId: circuit.logicalCircuitId,
          circuitName: circuit.name,
          language: "vhdl",
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
