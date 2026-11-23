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

import { comparePins, createCircuitSymbol, createGate } from "../circuitLayout";
import {
  createHdlLog,
  formatSymbolComment,
  resolveHdlTruthTableWithLogs,
  validateHdlIdentifiers,
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
  type HdlSymbolNode,
} from "./hdlGraphBuilder";

const N2T_IDENTIFIER_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
const N2T_NOT_SUPPORTED_CHARS_REGEX = /[\s,.?/!@#$%^&*()\-_+={}[\]|\\<>~`]+/g;
const N2T_KEYWORDS = new Set(["CHIP", "PARTS", "IN", "OUT", "true", "false"]);
const N2T_RAM_ADDRESS_WIDTHS = new Set([3, 6, 9, 12, 14]);

export function sanitizeN2tIdentifier(name: string, fixNames: boolean): string {
  const trimmed = name.trim();
  if (!fixNames) {
    return trimmed;
  }
  let normalized = trimmed.replace(N2T_NOT_SUPPORTED_CHARS_REGEX, "");
  if (normalized.length === 0) {
    return "Chip";
  }
  if (/^\d/.test(normalized)) {
    normalized = `n${normalized}`;
  }
  if (N2T_KEYWORDS.has(normalized)) {
    normalized = `${normalized}Chip`;
  }
  return normalized;
}

export function isValidN2tIdentifier(name: string, fixNames = false): boolean {
  const candidate = sanitizeN2tIdentifier(name, fixNames);
  return N2T_IDENTIFIER_REGEX.test(candidate) && !N2T_KEYWORDS.has(candidate);
}

function formatN2tRange(range: HdlBitRange): string {
  return range.first === range.last ? `[${range.first}]` : `[${range.first}..${range.last}]`;
}

function getN2tSymbolName(symbol: CircuitSymbol, fixNames: boolean): string {
  if (symbol.circuit.kind === "gate") {
    const gate = symbol.circuit as Gate;
    switch (gate.gateType) {
      case "and":
        return gate.invertedOutput ? "Nand" : "And";
      case "not":
        return "Not";
      case "or":
        return "Or";
      case "xor":
        return "Xor";
      default:
        return gate.name;
    }
  }
  if (symbol.circuit.kind === "memory") {
    const memory = symbol.circuit as Memory;
    if (memory.writable) {
      switch (memory.addressBitWidth) {
        case 3:
          return "RAM8";
        case 6:
          return "RAM64";
        case 9:
          return "RAM512";
        case 12:
          return "RAM4K";
        case 14:
          return "RAM16K";
        default:
          return "RAM";
      }
    }
    return "ROM32K";
  }
  return sanitizeN2tIdentifier(symbol.circuit.name, fixNames);
}

function getN2tJamName(jam: Jam, symbol: CircuitSymbol, fixNames: boolean): string {
  const dir = getHdlJamDirection(jam, symbol.circuit);
  if (symbol.circuit.kind === "gate") {
    if (dir === "output" || jam.pin.pinId === "out-0" || jam.pin.name === "q") {
      return "out";
    }
    const gate = symbol.circuit as Gate;
    if (gate.gateType === "not") {
      return "in";
    }
    const sortedInputs = symbol.jams
      .filter((j) => getHdlJamDirection(j, symbol.circuit) === "input")
      .sort((a, b) => comparePins(a.pin, b.pin));
    const idx = sortedInputs.indexOf(jam);
    if (idx === 0 || jam.pin.name === "x1") {
      return "a";
    }
    if (idx === 1 || jam.pin.name === "x2") {
      return "b";
    }
  } else if (symbol.circuit.kind === "memory") {
    if (jam.pin.pinId.endsWith("-addr") || jam.pin.jamNotation === "A") {
      return "address";
    }
    if (jam.pin.pinId.endsWith("-data-out") || (jam.pin.jamNotation === "D" && dir === "output")) {
      return "out";
    }
    if (jam.pin.pinId.endsWith("-data-in") || (jam.pin.jamNotation === "D" && dir === "input")) {
      return "in";
    }
    if (jam.pin.pinId.endsWith("-write") || jam.pin.jamNotation === "W") {
      return "load";
    }
  }
  return sanitizeN2tIdentifier(jam.pin.name, fixNames);
}

function getGateOutputJam(node: HdlSymbolNode): Jam {
  return node.circuitSymbol.jams.find(
    (j) => getHdlJamDirection(j, node.circuitSymbol.circuit) === "output",
  )!;
}

function createAutoGateNode(
  gateType: "and" | "or" | "xor" | "not",
  inverted: boolean,
  originalNode: HdlSymbolNode,
  subindex: number,
  comment: string,
): HdlSymbolNode {
  const originalSym = originalNode.circuitSymbol;
  const originalGate = originalSym.circuit as Gate;
  const dy = Math.floor((originalGate.inputCount + 1) / 2) - 2;
  const gate = createGate(gateType, gateType === "not" ? 1 : 2, inverted);
  const symbol = createCircuitSymbol(
    gate,
    originalSym.logicalCircuitId,
    originalSym.x,
    originalSym.y + dy,
    originalSym.rotation,
    `${originalSym.circuitSymbolId}-n2t-${subindex}-${gateType}`,
  );
  return {
    circuitSymbol: symbol,
    connections: [],
    order: originalNode.order,
    autoGenerated: true,
    subindex,
    comment,
  };
}

function replaceConnectionReference(
  list: HdlConnectionNode[],
  oldConn: HdlConnectionNode,
  newConn: HdlConnectionNode,
): void {
  const idx = list.indexOf(oldConn);
  if (idx >= 0) {
    list[idx] = newConn;
  } else {
    list.push(newConn);
  }
}

function createRewiredConnection(
  outSymbol: HdlSymbolNode,
  outJam: Jam,
  outBits: HdlBitRange,
  inSymbol: HdlSymbolNode,
  inJam: Jam,
  inBits: HdlBitRange,
): HdlConnectionNode {
  return {
    outSymbol,
    outJam,
    outBits: { ...outBits },
    inSymbol,
    inJam,
    inBits: { ...inBits },
    skipOutput: false,
  };
}

// Zerlegt Multi-Input- sowie NOR-/XNOR-Gatter in balancierte 2-Input-N2T-Bäume analog zu N2TExport.FixBigGates
function decomposeBigOrInvertedGates(graph: HdlCircuitGraph, logs: HdlLogEntry[]): boolean {
  let success = true;

  for (let idx = 0; idx < graph.parts.length; idx++) {
    const symbol = graph.parts[idx]!;
    if (symbol.circuitSymbol.circuit.kind !== "gate") {
      continue;
    }

    const gate = symbol.circuitSymbol.circuit as Gate;
    const incomingJams = new Map<Jam, HdlConnectionNode[]>();
    const outgoingConns: HdlConnectionNode[] = [];

    for (const conn of symbol.connections) {
      if (conn.outSymbol === symbol) {
        outgoingConns.push(conn);
      } else if (conn.inSymbol === symbol) {
        let list = incomingJams.get(conn.inJam);
        if (!list) {
          list = [];
          incomingJams.set(conn.inJam, list);
        }
        list.push(conn);
      }
    }

    if (gate.inputCount > 1 && incomingJams.size <= 1) {
      logs.push(
        createHdlLog(
          "error",
          "unconnectedGate",
          graph.circuit.name,
          i18n.t("errors.hdlExport.unconnectedGate", {
            gateName: gate.name,
            circuitName: graph.circuit.name,
          }),
          { gateName: gate.name, circuitName: graph.circuit.name },
        ),
      );
      success = false;
      continue;
    }

    const needsReplacement =
      gate.inputCount > 2 ||
      (gate.invertedOutput && (gate.gateType === "or" || gate.gateType === "xor"));
    if (!needsReplacement) {
      continue;
    }

    const baseType = gate.gateType as "and" | "or" | "xor";
    const comment = formatSymbolComment(symbol.circuitSymbol);
    const replacement: HdlSymbolNode[] = [];
    let currentGate: HdlSymbolNode | null = null;
    let currentInputs: Jam[] = [];

    const readSortedInputs = (node: HdlSymbolNode): Jam[] =>
      node.circuitSymbol.jams
        .filter((j) => getHdlJamDirection(j, node.circuitSymbol.circuit) === "input")
        .sort((a, b) => comparePins(a.pin, b.pin));

    const addStageGate = (isFinal: boolean): void => {
      const inverted = baseType === "and" && gate.invertedOutput && isFinal;
      const nextSubindex = replacement.length + 1;
      currentGate = createAutoGateNode(baseType, inverted, symbol, nextSubindex, comment);
      currentInputs = readSortedInputs(currentGate);
      replacement.push(currentGate);
    };

    const sortedInputJams = Array.from(incomingJams.keys()).sort((a, b) =>
      comparePins(a.pin, b.pin),
    );
    let inputIndex = 0;

    for (const oldInputJam of sortedInputJams) {
      if ((inputIndex & 1) === 0) {
        const isFinal =
          sortedInputJams.length <= 3 && (inputIndex > 0 || sortedInputJams.length <= 2);
        addStageGate(isFinal);
      } else {
        const existingGate = replacement[replacement.length - 1]!;
        currentGate = existingGate;
        currentInputs = readSortedInputs(existingGate);
      }

      const targetJam = currentInputs[inputIndex & 1]!;
      const oldConns = incomingJams.get(oldInputJam) ?? [];
      for (const oldConn of oldConns) {
        const rewired = createRewiredConnection(
          oldConn.outSymbol,
          oldConn.outJam,
          oldConn.outBits,
          currentGate!,
          targetJam,
          createFullBitRange(targetJam.pin.bitWidth),
        );
        replaceConnectionReference(oldConn.outSymbol.connections, oldConn, rewired);
        currentGate!.connections.push(rewired);
      }
      inputIndex++;
    }

    let waveStart = inputIndex & 1;
    if (waveStart > 0 && replacement.length > 1) {
      const firstGate = replacement[0]!;
      const lastInFirstWave = currentGate!;
      const targetJam = currentInputs[1]!;
      const firstOutJam = getGateOutputJam(firstGate);
      const link = createRewiredConnection(
        firstGate,
        firstOutJam,
        createFullBitRange(firstOutJam.pin.bitWidth),
        lastInFirstWave,
        targetJam,
        createFullBitRange(targetJam.pin.bitWidth),
      );
      firstGate.connections.push(link);
      lastInFirstWave.connections.push(link);
    }

    let waveEnd = replacement.length;
    while (waveEnd - waveStart > 1) {
      const pairCount = Math.floor((waveEnd - waveStart) / 2);
      for (let i = 0; i < pairCount; i++) {
        addStageGate(waveEnd - waveStart === 2);
        const stage = currentGate!;
        const out1 = replacement[waveStart + i * 2]!;
        const out2 = replacement[waveStart + i * 2 + 1]!;
        const j1 = getGateOutputJam(out1);
        const j2 = getGateOutputJam(out2);
        const c1 = createRewiredConnection(
          out1,
          j1,
          createFullBitRange(j1.pin.bitWidth),
          stage,
          currentInputs[0]!,
          createFullBitRange(currentInputs[0]!.pin.bitWidth),
        );
        const c2 = createRewiredConnection(
          out2,
          j2,
          createFullBitRange(j2.pin.bitWidth),
          stage,
          currentInputs[1]!,
          createFullBitRange(currentInputs[1]!.pin.bitWidth),
        );
        out1.connections.push(c1);
        out2.connections.push(c2);
        stage.connections.push(c1, c2);
      }

      if (((waveEnd - waveStart) & 1) !== 0) {
        addStageGate(waveEnd - waveStart === 2);
        const stage = currentGate!;
        const out1 = replacement[waveEnd - 1]!;
        const out2 = replacement[waveEnd]!;
        waveEnd++;
        const j1 = getGateOutputJam(out1);
        const j2 = getGateOutputJam(out2);
        const c1 = createRewiredConnection(
          out1,
          j1,
          createFullBitRange(j1.pin.bitWidth),
          stage,
          currentInputs[0]!,
          createFullBitRange(currentInputs[0]!.pin.bitWidth),
        );
        const c2 = createRewiredConnection(
          out2,
          j2,
          createFullBitRange(j2.pin.bitWidth),
          stage,
          currentInputs[1]!,
          createFullBitRange(currentInputs[1]!.pin.bitWidth),
        );
        out1.connections.push(c1);
        out2.connections.push(c2);
        stage.connections.push(c1, c2);
      }

      waveStart = waveEnd;
      waveEnd = replacement.length;
    }

    let last = replacement[replacement.length - 1]!;
    const lastGate = last.circuitSymbol.circuit as Gate;
    if (lastGate.invertedOutput !== gate.invertedOutput) {
      const notNode = createAutoGateNode("not", true, symbol, replacement.length + 1, comment);
      const lastOut = getGateOutputJam(last);
      const notIn = notNode.circuitSymbol.jams.find(
        (j) => getHdlJamDirection(j, notNode.circuitSymbol.circuit) === "input",
      )!;
      const notLink = createRewiredConnection(
        last,
        lastOut,
        createFullBitRange(lastOut.pin.bitWidth),
        notNode,
        notIn,
        createFullBitRange(notIn.pin.bitWidth),
      );
      last.connections.push(notLink);
      notNode.connections.push(notLink);
      replacement.push(notNode);
      last = notNode;
    }

    const finalOutJam = getGateOutputJam(last);
    for (const oldOut of outgoingConns) {
      const rewired = createRewiredConnection(
        last,
        finalOutJam,
        oldOut.outBits,
        oldOut.inSymbol,
        oldOut.inJam,
        oldOut.inBits,
      );
      replaceConnectionReference(oldOut.inSymbol.connections, oldOut, rewired);
      last.connections.push(rewired);
    }
    last.subindex = 0;

    graph.parts.splice(idx, 1, ...replacement);
    const allIdx = graph.allSymbols.indexOf(symbol);
    if (allIdx >= 0) {
      graph.allSymbols.splice(allIdx, 1, ...replacement);
    } else {
      graph.allSymbols.push(...replacement);
    }
    idx += replacement.length - 1;
  }

  return success;
}

function validateN2tConstraints(
  graph: HdlCircuitGraph,
  exportTests: boolean,
  logs: HdlLogEntry[],
): boolean {
  let valid = true;

  for (const inputPin of graph.inputPins) {
    for (const conn of inputPin.connections) {
      if (conn.inSymbol.circuitSymbol.circuit.kind === "pin") {
        const params = {
          inPin: conn.outSymbol.circuitSymbol.circuit.name,
          outPin: conn.inSymbol.circuitSymbol.circuit.name,
          circuitName: graph.circuit.name,
        };
        logs.push(
          createHdlLog(
            "error",
            "pinDirectConnect",
            graph.circuit.name,
            i18n.t("errors.hdlExport.pinDirectConnect", params),
            params,
          ),
        );
        valid = false;
      }
    }
  }

  for (const part of graph.parts) {
    const sym = part.circuitSymbol;
    if (sym.circuit.kind === "memory") {
      const memory = sym.circuit as Memory;
      const locParams = { name: memory.name, x: sym.x, y: sym.y };

      if (memory.dualPort) {
        logs.push(
          createHdlLog(
            "error",
            "memoryUnsupported",
            graph.circuit.name,
            i18n.t("errors.hdlExport.memoryDualPortUnsupported", locParams),
            locParams,
          ),
        );
        valid = false;
      }

      if (memory.writable) {
        if (!N2T_RAM_ADDRESS_WIDTHS.has(memory.addressBitWidth) || memory.dataBitWidth !== 16) {
          logs.push(
            createHdlLog(
              "error",
              "memoryUnsupported",
              graph.circuit.name,
              i18n.t("errors.hdlExport.ramBitWidthUnsupported", locParams),
              locParams,
            ),
          );
          valid = false;
        }
        if (memory.writeOn1) {
          logs.push(
            createHdlLog(
              "error",
              "memoryUnsupported",
              graph.circuit.name,
              i18n.t("errors.hdlExport.ramWriteOn1Unsupported", locParams),
              locParams,
            ),
          );
          valid = false;
        }
        if (exportTests) {
          logs.push(
            createHdlLog(
              "warning",
              "ramTestWarning",
              graph.circuit.name,
              i18n.t("errors.hdlExport.ramTestWarning", locParams),
              locParams,
            ),
          );
        }
      } else if (memory.addressBitWidth !== 15 || memory.dataBitWidth !== 16) {
        logs.push(
          createHdlLog(
            "error",
            "memoryUnsupported",
            graph.circuit.name,
            i18n.t("errors.hdlExport.romBitWidthUnsupported", locParams),
            locParams,
          ),
        );
        valid = false;
      }
    }
  }

  return valid;
}

function formatN2tPinsDeclaration(pins: HdlSymbolNode[], fixNames: boolean): string {
  return pins
    .map((node) => {
      const sym = node.circuitSymbol;
      const pinName = sanitizeN2tIdentifier(sym.circuit.name, fixNames);
      const width = sym.jams[0]?.pin.bitWidth ?? 1;
      return width > 1 ? `${pinName}[${width}]` : pinName;
    })
    .join(", ");
}

function formatN2tOtherSidePinName(
  symbol: HdlSymbolNode,
  connection: HdlConnectionNode,
  fixNames: boolean,
): string {
  const otherSymbol =
    symbol === connection.outSymbol ? connection.inSymbol : connection.outSymbol;
  const otherJam = symbol === connection.outSymbol ? connection.inJam : connection.outJam;
  const otherBits = symbol === connection.outSymbol ? connection.inBits : connection.outBits;

  if (otherSymbol.circuitSymbol.circuit.kind === "pin") {
    let name = sanitizeN2tIdentifier(otherSymbol.circuitSymbol.circuit.name, fixNames);
    if (!bitRangeEquals(otherBits, createFullBitRange(otherJam.pin.bitWidth))) {
      name += formatN2tRange(otherBits);
    }
    return name;
  }

  const pt = connection.outJam.absolutePoint;
  let wireName = `Pin${pt.x}x${pt.y}`;
  if (!bitRangeEquals(connection.outBits, createFullBitRange(connection.outJam.pin.bitWidth))) {
    if (connection.outBits.first === connection.outBits.last) {
      wireName += `b${connection.outBits.first}`;
    } else {
      wireName += `s${connection.outBits.first}e${connection.outBits.last}`;
    }
  }
  if ((connection.outSymbol.subindex ?? 0) > 0) {
    wireName += `v${connection.outSymbol.subindex}`;
  }
  return wireName;
}

function generateN2tHdlContent(
  graph: HdlCircuitGraph,
  options: Omit<HdlExportOptions, "language">,
): string {
  const fixNames = options.fixNames ?? true;
  const commentPoints = options.commentPoints ?? false;
  const safeName = sanitizeN2tIdentifier(graph.circuit.name, fixNames);
  const lines: string[] = [];

  lines.push(`// This file is generated by Logic Circuit Web from circuit ${graph.circuit.name}`);
  lines.push(`CHIP ${safeName} {`);
  if (graph.inputPins.length > 0) {
    lines.push(`IN ${formatN2tPinsDeclaration(graph.inputPins, fixNames)};`);
  }
  if (graph.outputPins.length > 0) {
    lines.push(`OUT ${formatN2tPinsDeclaration(graph.outputPins, fixNames)};`);
  }
  lines.push("PARTS:");

  for (const symbol of graph.parts) {
    const sym = symbol.circuitSymbol;
    if (commentPoints && (!symbol.autoGenerated || symbol.subindex === 1)) {
      lines.push(`\t// ${symbol.comment ?? formatSymbolComment(sym)}`);
    }

    const args: string[] = [];
    for (const conn of symbol.connections) {
      if (conn.outSymbol === symbol && conn.skipOutput) {
        continue;
      }
      if (conn.outSymbol.circuitSymbol.circuit.kind === "constant") {
        const constant = conn.outSymbol.circuitSymbol.circuit as Constant;
        const val = extractBitRangeValue(constant.value, conn.outBits);
        const width = conn.inBits.last - conn.inBits.first + 1;
        const portName = getN2tJamName(conn.inJam, sym, fixNames);
        for (let i = 0; i < width; i++) {
          const bitSuffix = conn.inJam.pin.bitWidth > 1 ? `[${i + conn.inBits.first}]` : "";
          const literal = ((val >>> i) & 1) !== 0 ? "true" : "false";
          args.push(`${portName}${bitSuffix}=${literal}`);
        }
      } else {
        const jam = symbol === conn.outSymbol ? conn.outJam : conn.inJam;
        const usedBits = symbol === conn.outSymbol ? conn.outBits : conn.inBits;
        let portExpr = getN2tJamName(jam, sym, fixNames);
        if (!bitRangeEquals(usedBits, createFullBitRange(jam.pin.bitWidth))) {
          portExpr += formatN2tRange(usedBits);
        }
        const wireExpr = formatN2tOtherSidePinName(symbol, conn, fixNames);
        args.push(`${portExpr}=${wireExpr}`);
      }
    }

    lines.push(`\t${getN2tSymbolName(sym, fixNames)}(${args.join(", ")});`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function formatN2tCmpCell(text: string, colWidth: number): string {
  if (colWidth <= 3 && text.length <= 3) {
    if (text.length === 1) {
      return ` ${text} `;
    }
    if (text.length === 2) {
      return `${text} `;
    }
    return text;
  }
  const leftPad = Math.max(0, Math.floor((colWidth - text.length) / 2));
  return `${" ".repeat(leftPad)}${text}`.padEnd(colWidth, " ");
}

function generateN2tTestAndCompare(
  safeCircuitName: string,
  vectors: HdlTruthTableVectors,
  fixNames: boolean,
): { tst: string; cmp: string } {
  const inputCols = vectors.inputs.map((inp) => {
    const name = sanitizeN2tIdentifier(inp.name, fixNames);
    const hexDigits = Math.max(1, Math.ceil(inp.bitWidth / 4));
    const minDigits = Math.max(1, hexDigits);
    const colWidth = Math.max(3, name.length, minDigits + 2);
    return { name, minDigits, colWidth, padLen: Math.max(1, colWidth - minDigits) };
  });

  const outputCols = vectors.outputs.map((out) => {
    const name = sanitizeN2tIdentifier(out.name, fixNames);
    const hexDigits = Math.max(1, Math.ceil(out.bitWidth / 4));
    const minDigits = Math.max(1, hexDigits);
    const colWidth = Math.max(3, name.length, minDigits + 2);
    return { name, minDigits, colWidth, padLen: Math.max(1, colWidth - minDigits) };
  });

  const allCols = [...inputCols, ...outputCols];
  const scriptLines: string[] = [
    `load ${safeCircuitName}.hdl,`,
    `output-file ${safeCircuitName}.out,`,
    `compare-to ${safeCircuitName}.cmp,`,
    `output-list ${allCols.map((c) => `${c.name}%X${Math.max(1, Math.floor(c.padLen / 2))}.${c.minDigits}.1`).join(" ")};`,
    "",
  ];

  const cmpLines: string[] = [
    `|${allCols.map((c) => formatN2tCmpCell(c.name, c.colWidth)).join("|")}|`,
  ];

  for (const row of vectors.rows) {
    const rowCells: string[] = [];
    for (let i = 0; i < inputCols.length; i++) {
      const col = inputCols[i]!;
      const val = (row.inputs[i] ?? 0) >>> 0;
      scriptLines.push(`set ${col.name} ${val},`);
      rowCells.push(formatN2tCmpCell(val.toString(16), col.colWidth));
    }
    scriptLines.push("eval,");
    scriptLines.push("output;");
    scriptLines.push("");

    for (let o = 0; o < outputCols.length; o++) {
      const col = outputCols[o]!;
      const outVal = row.outputs?.[o] !== undefined ? row.outputs[o]! >>> 0 : 0;
      rowCells.push(formatN2tCmpCell(outVal.toString(16), col.colWidth));
    }
    cmpLines.push(`|${rowCells.join("|")}|`);
  }

  return {
    tst: `${scriptLines.join("\n")}\n`,
    cmp: `${cmpLines.join("\n")}\n`,
  };
}

// Exportiert die aufgelösten Schaltungen als Nand2Tetris-Chips (.hdl) inkl. optionaler .tst/.cmp-Skripte
export function exportN2t(
  project: CircuitProject,
  currentCircuit: LogicalCircuit,
  options: Omit<HdlExportOptions, "language">,
): HdlExportResult {
  const fixNames = options.fixNames ?? true;
  const exportTests = options.exportTests;
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
      "Nand2Tetris",
      fixNames,
      isValidN2tIdentifier,
      sanitizeN2tIdentifier,
      logs,
    );
    if (!namesOk) {
      hasErrors = true;
      continue;
    }

    let gateTransformFailed = false;
    const graph = buildHdlCircuitGraph(circuit, project, "n2t", {
      checkUnconnectedInputs: true,
      transformFn: (builtGraph) => {
        if (!decomposeBigOrInvertedGates(builtGraph, logs)) {
          gateTransformFailed = true;
        }
      },
    });
    logs.push(...graph.logs);

    if (graph.hasErrors || gateTransformFailed) {
      hasErrors = true;
      continue;
    }

    if (!validateN2tConstraints(graph, exportTests, logs)) {
      hasErrors = true;
      continue;
    }

    const safeName = sanitizeN2tIdentifier(circuit.name, fixNames);
    const hdlFileName = `${safeName}.hdl`;
    const hdlContent = generateN2tHdlContent(graph, options);
    files.push({
      fileName: hdlFileName,
      circuitId: circuit.logicalCircuitId,
      circuitName: circuit.name,
      language: "n2t",
      kind: "module",
      content: hdlContent,
    });
    logs.push(
      createHdlLog(
        "info",
        "exportSuccess",
        circuit.name,
        i18n.t("errors.hdlExport.fileGenerated", {
          fileName: hdlFileName,
          circuitName: circuit.name,
        }),
        { fileName: hdlFileName, circuitName: circuit.name },
      ),
    );

    if (exportTests) {
      const vectors = resolveHdlTruthTableWithLogs(graph, logs);
      if (vectors) {
        const { tst, cmp } = generateN2tTestAndCompare(safeName, vectors, fixNames);
        const tstFileName = `${safeName}.tst`;
        const cmpFileName = `${safeName}.cmp`;

        files.push({
          fileName: tstFileName,
          circuitId: circuit.logicalCircuitId,
          circuitName: circuit.name,
          language: "n2t",
          kind: "testbench",
          content: tst,
        });
        files.push({
          fileName: cmpFileName,
          circuitId: circuit.logicalCircuitId,
          circuitName: circuit.name,
          language: "n2t",
          kind: "compare",
          content: cmp,
        });
        logs.push(
          createHdlLog(
            "info",
            "exportSuccess",
            circuit.name,
            i18n.t("errors.hdlExport.fileGenerated", {
              fileName: tstFileName,
              circuitName: circuit.name,
            }),
            { fileName: tstFileName, circuitName: circuit.name },
          ),
          createHdlLog(
            "info",
            "exportSuccess",
            circuit.name,
            i18n.t("errors.hdlExport.fileGenerated", {
              fileName: cmpFileName,
              circuitName: circuit.name,
            }),
            { fileName: cmpFileName, circuitName: circuit.name },
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
