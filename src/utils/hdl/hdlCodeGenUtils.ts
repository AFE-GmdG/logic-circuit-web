import type BasePin from "../../types/circuit/basePin";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Gate from "../../types/circuit/gate";
import type Jam from "../../types/circuit/jam";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type {
  HdlBitRange,
  HdlLogCode,
  HdlLogEntry,
  HdlLogLevel,
  HdlTruthTableVectors,
} from "../../types/hdl/hdlExportTypes";
import { STATE_OFF, STATE_ON1 } from "../../types/simulation/state";

import i18n from "../../i18n";

import { comparePins } from "../circuitLayout";
import { decodeMemoryData, getCellValue, numberCellsFor } from "../memoryDataUtils";
import {
  bitRangeEquals,
  buildHdlTruthTableVectors,
  canMergeBitRange,
  createFullBitRange,
  getHdlJamDirection,
  MAX_HDL_TESTABLE_INPUT_BITS,
  mergeBitRange,
  type HdlCircuitGraph,
  type HdlConnectionNode,
  type HdlSymbolNode,
} from "./hdlGraphBuilder";

export type HdlWirePlan = {
  wires: Map<Jam, Jam>;
  connectionsByJam: Map<Jam, HdlConnectionNode[]>;
  assignments: HdlConnectionNode[];
  internalWireJams: Jam[];
};

export function createHdlLog(
  level: HdlLogLevel,
  code: HdlLogCode,
  circuitName: string,
  message: string,
  params?: Record<string, string | number>,
): HdlLogEntry {
  return {
    level,
    code,
    circuitName,
    message,
    params,
  };
}

// Formatiert eine Gitterkoordinate als Kommentar-Text analog zu HdlSymbol.Comment
export function formatSymbolComment(symbol: CircuitSymbol): string {
  return `${symbol.circuit.name} (${symbol.x}, ${symbol.y})`;
}

// Prüft Namen der Zielschaltung, ihrer Pins sowie direkter Subschaltungen inkl. Sanitization-Kollisionen
export function validateHdlIdentifiers(
  circuit: LogicalCircuit,
  languageLabel: string,
  fixNames: boolean,
  isValidIdentifier: (name: string, fixNames: boolean) => boolean,
  sanitizeIdentifier: (name: string, fixNames: boolean) => string,
  logs: HdlLogEntry[],
): boolean {
  let valid = true;

  if (!isValidIdentifier(circuit.name, fixNames)) {
    logs.push(
      createHdlLog(
        "error",
        "invalidName",
        circuit.name,
        i18n.t("errors.hdlExport.invalidCircuitName", {
          name: circuit.name,
          language: languageLabel,
        }),
        { name: circuit.name, language: languageLabel },
      ),
    );
    valid = false;
  }

  const seenPinIdentifiers = new Set<string>();
  for (const sym of circuit.circuitSymbols) {
    if (sym.circuit.kind === "pin") {
      const pinName = sym.circuit.name;
      if (!isValidIdentifier(pinName, fixNames)) {
        logs.push(
          createHdlLog(
            "error",
            "invalidName",
            circuit.name,
            i18n.t("errors.hdlExport.invalidPinName", {
              pinName,
              circuitName: circuit.name,
              language: languageLabel,
            }),
            { pinName, circuitName: circuit.name, language: languageLabel },
          ),
        );
        valid = false;
      } else {
        const normalized = sanitizeIdentifier(pinName, fixNames).toLowerCase();
        if (seenPinIdentifiers.has(normalized)) {
          const sanitizedName = sanitizeIdentifier(pinName, fixNames);
          logs.push(
            createHdlLog(
              "error",
              "invalidName",
              circuit.name,
              i18n.t("errors.hdlExport.duplicateSanitizedPinName", {
                circuitName: circuit.name,
                language: languageLabel,
                sanitizedName,
              }),
              { circuitName: circuit.name, language: languageLabel, sanitizedName },
            ),
          );
          valid = false;
        }
        seenPinIdentifiers.add(normalized);
      }
    } else if (sym.circuit.kind === "logicalCircuit") {
      const subCircuit = sym.circuit as LogicalCircuit;
      if (!isValidIdentifier(subCircuit.name, fixNames)) {
        logs.push(
          createHdlLog(
            "error",
            "invalidName",
            circuit.name,
            i18n.t("errors.hdlExport.invalidCircuitName", {
              name: subCircuit.name,
              language: languageLabel,
            }),
            { name: subCircuit.name, language: languageLabel },
          ),
        );
        valid = false;
      }
    }
  }

  return valid;
}

// Liefert den standardisierten HDL-Portnamen für RAM-/ROM-Anschlüsse
export function getMemoryHdlPortName(memory: Memory, pin: BasePin): string {
  if (pin.pinId.endsWith("-addr")) {
    return "address";
  }
  if (pin.pinId.endsWith("-data-out")) {
    return "dataOut";
  }
  if (pin.pinId.endsWith("-data-in")) {
    return "dataIn";
  }
  if (pin.pinId.endsWith("-write")) {
    return "write";
  }
  if (pin.pinId.endsWith("-addr2")) {
    return "address2";
  }
  if (pin.pinId.endsWith("-data-out2")) {
    return "dataOut2";
  }

  const notation = pin.jamNotation.trim().toUpperCase();
  if (notation === "A") {
    return "address";
  }
  if (notation === "A2") {
    return "address2";
  }
  if (notation === "D2") {
    return "dataOut2";
  }
  if (notation === "W") {
    return "write";
  }
  if (notation === "D") {
    return pin.pinType === "output" ? "dataOut" : "dataIn";
  }
  return pin.name || `${memory.writable ? "ram" : "rom"}_${pin.pinId}`;
}

export function getPortNameFromJam(
  jam: Jam,
  symbol: CircuitSymbol,
  sanitizeIdentifier: (name: string, fixNames: boolean) => string,
  fixNames: boolean,
): string {
  if (symbol.circuit.kind === "memory") {
    return getMemoryHdlPortName(symbol.circuit as Memory, jam.pin);
  }
  return sanitizeIdentifier(jam.pin.name, fixNames);
}

// Berechnet den internen Signalnamen eines nicht direkt auf einen Ausgangs-Pin abgebildeten Ausgangs-Jams
export function getJamWireIdentifier(
  jam: Jam,
  symbolById: Map<string, CircuitSymbol>,
  sanitizeIdentifier: (name: string, fixNames: boolean) => string,
  fixNames: boolean,
  separator = "",
): string {
  const sym = symbolById.get(jam.circuitSymbolId);
  if (sym?.circuit.kind === "pin") {
    return sanitizeIdentifier(sym.circuit.name, fixNames);
  }
  return `Pin${separator}${jam.absolutePoint.x}x${jam.absolutePoint.y}`;
}

export function addJamConnectionMapEntry(
  map: Map<Jam, HdlConnectionNode[]>,
  jam: Jam,
  connection: HdlConnectionNode,
): void {
  let list = map.get(jam);
  if (!list) {
    list = [];
    map.set(jam, list);
  }
  if (!list.includes(connection)) {
    list.push(connection);
  }
}

// Vergleicht Bit-Bereiche absteigend (MSB zuerst) für Bus-Konkatenationen ({hi, lo} bzw. hi & lo)
export function compareHdlBitRangeDescending(a: HdlBitRange, b: HdlBitRange): number {
  const lastDiff = b.last - a.last;
  if (lastDiff !== 0) {
    return lastDiff;
  }
  return b.first - a.first;
}

// Vergleicht zwei Gatter- oder Signal-Verbindungs-Eingangspins kanonisch (Tri-State Enable stets zuletzt)
export function getSortedPartInputJams(symbol: CircuitSymbol): Jam[] {
  return symbol.jams
    .filter((j) => getHdlJamDirection(j, symbol.circuit) === "input")
    .sort((a, b) => comparePins(a.pin, b.pin));
}

// Ermittelt die Wire-Aliase, internen Drähte und expliziten Output-Zuweisungen analog zu VerilogHdl.Prepare
export function prepareHdlWirePlan(
  graph: HdlCircuitGraph,
  allowAliasedOutputFanout: boolean,
): HdlWirePlan {
  const wires = new Map<Jam, Jam>();
  const connectionsByJam = new Map<Jam, HdlConnectionNode[]>();
  const assignments: HdlConnectionNode[] = [];

  for (const part of graph.parts) {
    for (const conn of part.connections) {
      addJamConnectionMapEntry(connectionsByJam, conn.outJam, conn);
      addJamConnectionMapEntry(connectionsByJam, conn.inJam, conn);
    }
  }

  for (const outPin of graph.outputPins) {
    for (const conn of outPin.connections) {
      addJamConnectionMapEntry(connectionsByJam, conn.outJam, conn);
      addJamConnectionMapEntry(connectionsByJam, conn.inJam, conn);
    }
  }

  for (const inputPin of graph.inputPins) {
    const jam = inputPin.circuitSymbol.jams[0];
    if (!jam) {
      continue;
    }
    wires.set(jam, jam);
    for (const conn of inputPin.connections) {
      if (conn.inSymbol.circuitSymbol.circuit.kind === "pin") {
        assignments.push(conn);
      }
    }
  }

  for (const outputPin of graph.outputPins) {
    const jam = outputPin.circuitSymbol.jams[0];
    if (!jam) {
      continue;
    }
    wires.set(jam, jam);
    for (const conn of outputPin.connections) {
      if (conn.outSymbol.circuitSymbol.circuit.kind === "constant") {
        assignments.push(conn);
      }
    }
  }

  const aliasedOutputTargets = new Set<Jam>();

  for (const [jam, list] of connectionsByJam.entries()) {
    const owner = findSymbolById(graph, jam.circuitSymbolId);
    if (
      getHdlJamDirection(jam, owner?.circuitSymbol.circuit) === "output" &&
      owner?.circuitSymbol.circuit.kind !== "pin" &&
      owner?.circuitSymbol.circuit.kind !== "constant"
    ) {
      const hasNonPinConsumers = list.some((c) => c.inSymbol.circuitSymbol.circuit.kind !== "pin");
      const fullWidthPinConn = list.find((c) => {
        if (c.inSymbol.circuitSymbol.circuit.kind !== "pin") {
          return false;
        }
        const pinWidth = c.inJam.pin.bitWidth;
        const outWidth = jam.pin.bitWidth;
        if (
          !bitRangeEquals(c.outBits, createFullBitRange(outWidth)) ||
          !bitRangeEquals(c.inBits, createFullBitRange(pinWidth))
        ) {
          return false;
        }
        const outConns = connectionsByJam.get(c.inJam) ?? [];
        const hasPartialOther = outConns.some(
          (oc) => oc !== c && !bitRangeEquals(oc.inBits, createFullBitRange(pinWidth)),
        );
        if (hasPartialOther) {
          return false;
        }
        if (aliasedOutputTargets.has(c.inJam)) {
          // Mehrere Tri-State-Treiber dürfen gemeinsam direkt auf einen Ausgangs-Pin schreiben
          const ownerGate = owner?.circuitSymbol.circuit.kind === "gate"
            ? (owner.circuitSymbol.circuit as Gate)
            : null;
          return (
            ownerGate !== null &&
            (ownerGate.gateType === "triState1" || ownerGate.gateType === "triState2")
          );
        }
        return (allowAliasedOutputFanout || !hasNonPinConsumers) && (pinWidth === outWidth || list.length === 1);
      });

      const aliasedTarget = fullWidthPinConn?.inJam ?? null;
      if (aliasedTarget) {
        wires.set(jam, aliasedTarget);
        aliasedOutputTargets.add(aliasedTarget);
      } else {
        wires.set(jam, jam);
      }

      for (const conn of list) {
        if (conn.outJam === jam && conn.inJam !== aliasedTarget && conn.inSymbol.circuitSymbol.circuit.kind === "pin") {
          assignments.push(conn);
        }
      }
    }
  }

  const seenInternal = new Set<Jam>();
  const internalWireJams: Jam[] = [];
  for (const targetJam of wires.values()) {
    const owner = findSymbolById(graph, targetJam.circuitSymbolId);
    if (owner?.circuitSymbol.circuit.kind !== "pin" && !seenInternal.has(targetJam)) {
      seenInternal.add(targetJam);
      internalWireJams.push(targetJam);
    }
  }
  internalWireJams.sort(
    (a, b) => a.absolutePoint.x - b.absolutePoint.x || a.absolutePoint.y - b.absolutePoint.y,
  );

  return {
    wires,
    connectionsByJam,
    assignments,
    internalWireJams,
  };
}

function findSymbolById(graph: HdlCircuitGraph, circuitSymbolId: string): HdlSymbolNode | undefined {
  return graph.allSymbols.find((s) => s.circuitSymbol.circuitSymbolId === circuitSymbolId);
}

// Prüft analog zu VerilogExport.Validate auf schwebende Eingänge bei Subschaltungen, Speichern, Tri-States und Ausgangs-Pins
export function validateHdlFloatingPorts(
  graph: HdlCircuitGraph,
  wirePlan: HdlWirePlan,
  logs: HdlLogEntry[],
): boolean {
  let valid = true;

  for (const symbol of [...graph.parts, ...graph.outputPins]) {
    const sym = symbol.circuitSymbol;
    const isGate = sym.circuit.kind === "gate";
    const gate = isGate ? (sym.circuit as Gate) : null;
    const isTriState = gate !== null && (gate.gateType === "triState1" || gate.gateType === "triState2");

    if (isGate && !isTriState) {
      continue;
    }

    for (const jam of sym.jams) {
      if (getHdlJamDirection(jam, sym.circuit) === "output") {
        continue;
      }

      const incoming = (wirePlan.connectionsByJam.get(jam) ?? []).filter((c) => c.inJam === jam);
      let covered = false;
      if (incoming.length > 0) {
        const sorted = [...incoming].sort((a, b) => a.inBits.first - b.inBits.first);
        let merged = { ...sorted[0]!.inBits };
        let contiguous = true;
        for (let i = 1; i < sorted.length; i++) {
          const next = sorted[i]!.inBits;
          if (canMergeBitRange(merged, next)) {
            merged = mergeBitRange(merged, next);
          } else {
            contiguous = false;
          }
        }
        covered = contiguous && merged.first === 0 && merged.last >= jam.pin.bitWidth - 1;
      }

      if (!covered) {
        const params = {
          pinName: jam.pin.name,
          symbolName: sym.circuit.name,
          x: sym.x,
          y: sym.y,
          circuitName: graph.circuit.name,
        };
        if (isTriState) {
          logs.push(
            createHdlLog(
              "error",
              "floatingPort",
              graph.circuit.name,
              i18n.t("errors.hdlExport.floatingPortError", params),
              params,
            ),
          );
          valid = false;
        } else {
          logs.push(
            createHdlLog(
              "warning",
              "floatingPort",
              graph.circuit.name,
              i18n.t("errors.hdlExport.floatingPortWarning", params),
              params,
            ),
          );
        }
      }
    }
  }

  return valid;
}

// Extrahiert alle Initialwerte einer ROM-/RAM-Instanz in Zellen-Reihenfolge
export function readMemoryInitialCells(memory: Memory): number[] {
  const bytes = decodeMemoryData(memory.data, memory.addressBitWidth, memory.dataBitWidth);
  const count = numberCellsFor(memory.addressBitWidth);
  const values = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    values[i] = getCellValue(bytes, memory.dataBitWidth, i);
  }
  return values;
}

// Liefert bei vorhandener Wahrheitstabelle die formatierten Testvektoren oder ergänzt eine Warnung im Log
export function resolveHdlTruthTableWithLogs(
  graph: HdlCircuitGraph,
  logs: HdlLogEntry[],
): HdlTruthTableVectors | null {
  const vectors = buildHdlTruthTableVectors(graph.circuit, graph.project);

  switch (vectors.status) {
    case "ok":
      return vectors;
    case "notTestable":
      logs.push(
        createHdlLog(
          "warning",
          "testNotTestable",
          graph.circuit.name,
          i18n.t("errors.hdlExport.testNotTestable", { circuitName: graph.circuit.name }),
          { circuitName: graph.circuit.name },
        ),
      );
      return null;
    case "inputTooBig":
      logs.push(
        createHdlLog(
          "warning",
          "testInputTooBig",
          graph.circuit.name,
          i18n.t("errors.hdlExport.testInputTooBig", {
            circuitName: graph.circuit.name,
            totalBits: vectors.totalInputBits,
            maxBits: MAX_HDL_TESTABLE_INPUT_BITS,
          }),
          {
            circuitName: graph.circuit.name,
            totalBits: vectors.totalInputBits,
            maxBits: MAX_HDL_TESTABLE_INPUT_BITS,
          },
        ),
      );
      return null;
    case "truncated":
      logs.push(
        createHdlLog(
          "warning",
          "testTruncated",
          graph.circuit.name,
          i18n.t("errors.hdlExport.testTruncated", {
            circuitName: graph.circuit.name,
            maxRows: vectors.rows.length,
          }),
          { circuitName: graph.circuit.name, maxRows: vectors.rows.length },
        ),
      );
      return null;
    case "oscillation":
      logs.push(
        createHdlLog(
          "warning",
          "testOscillation",
          graph.circuit.name,
          i18n.t("errors.hdlExport.testOscillation", { circuitName: graph.circuit.name }),
          { circuitName: graph.circuit.name },
        ),
      );
      return null;
    case "error":
      logs.push(
        createHdlLog(
          "warning",
          "testNotTestable",
          graph.circuit.name,
          i18n.t("errors.hdlExport.testError", {
            circuitName: graph.circuit.name,
            message: vectors.errorMessage ?? "",
          }),
          { circuitName: graph.circuit.name },
        ),
      );
      return null;
  }
}

// Formatiert einen Wahrheitstabellen-Ausgabepin als Binär-String (MSB zuerst) inkl. Tri-State ('Z'/'z')
export function formatTruthOutputBits(
  rowStates: readonly number[],
  bitWidth: number,
  zChar: "z" | "Z",
): { hasHighZ: boolean; bits: string } {
  let hasHighZ = false;
  const chars: string[] = [];
  for (let b = bitWidth - 1; b >= 0; b--) {
    const s = rowStates[b] ?? STATE_OFF;
    if (s === STATE_OFF) {
      hasHighZ = true;
      chars.push(zChar);
    } else if (s === STATE_ON1) {
      chars.push("1");
    } else {
      chars.push("0");
    }
  }
  return { hasHighZ, bits: chars.join("") };
}

export function formatUnsignedBits(value: number, bitWidth: number): string {
  const normalized = value >>> 0;
  let result = "";
  for (let b = bitWidth - 1; b >= 0; b--) {
    result += ((normalized >>> b) & 1) === 1 ? "1" : "0";
  }
  return result;
}
