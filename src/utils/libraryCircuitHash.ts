import type CircuitProject from "../types/circuit/circuitProject";
import type {
  NativeCircuitElement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeTextNote,
  NativeWire,
} from "../types/storage/nativeProjectFormat";

import { serializeLogicalCircuitToNative } from "./storage/nativeProjectWriter";

// Kompakter synchroner 128-Bit Dual-FNV-1a-Hash über UTF-8-Bytes für In-Memory-Strukturvergleiche
function dualFnv1aHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (b + (i & 0xff)), 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ (b ^ 0x5a), 0x85ebca6b) >>> 0;
    h4 = Math.imul(h4 ^ ((b + 17) & 0xff), 0xc2b2ae35) >>> 0;
  }

  return [h1, h2, h3, h4]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

function canonicalizePin(pin: NativePinElement): string {
  return JSON.stringify({
    x: pin.x,
    y: pin.y,
    rotation: pin.rotation,
    name: pin.name,
    jamNotation: pin.jamNotation,
    note: pin.note,
    pinType: pin.pinType,
    pinSide: pin.pinSide,
    bitWidth: pin.bitWidth,
    inverted: pin.inverted,
    index: pin.index,
    width: pin.width,
    height: pin.height,
  });
}

function canonicalizeElement(
  elem: NativeCircuitElement,
  resolveSubCircuitHash: (subCircuitId: string) => string,
): string {
  if (elem.kind === "subCircuit") {
    return JSON.stringify({
      kind: "subCircuit",
      x: elem.x,
      y: elem.y,
      rotation: elem.rotation,
      subCircuitHash: resolveSubCircuitHash(elem.logicalCircuitId),
    });
  }

  if (elem.kind === "gate") {
    return JSON.stringify({
      kind: "gate",
      x: elem.x,
      y: elem.y,
      rotation: elem.rotation,
      gateType: elem.gateType,
      inputCount: elem.inputCount,
      invertedOutput: elem.invertedOutput,
      color: elem.color,
      note: elem.note,
    });
  }

  const { symbolId: _symId, componentId: _compId, ...rest } = elem;
  const sortedEntries = Object.keys(rest)
    .sort()
    .map((key) => [key, (rest as Record<string, unknown>)[key]]);
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

function canonicalizeWire(wire: NativeWire): string {
  const swap = wire.x1 > wire.x2 || (wire.x1 === wire.x2 && wire.y1 > wire.y2);
  return JSON.stringify({
    x1: swap ? wire.x2 : wire.x1,
    y1: swap ? wire.y2 : wire.y1,
    x2: swap ? wire.x1 : wire.x2,
    y2: swap ? wire.y1 : wire.y2,
  });
}

function canonicalizeTextNote(note: NativeTextNote): string {
  return JSON.stringify({
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    note: note.note,
    rotation: note.rotation,
    lineHeight: note.lineHeight,
    fontFamily: note.fontFamily,
    lineHeights: note.lineHeights ?? null,
  });
}

// Berechnet deterministische, UUID-unabhängige In-Memory-Struktur-Hashes im Bottom-up-Verfahren
export function computeNativeCircuitStructureHashes(
  circuits: readonly NativeLogicalCircuit[],
): Map<string, string> {
  const byId = new Map(circuits.map((lc) => [lc.logicalCircuitId, lc]));
  const hashes = new Map<string, string>();
  const visiting = new Set<string>();

  const computeForId = (circuitId: string): string => {
    const cached = hashes.get(circuitId);
    if (cached) {
      return cached;
    }

    if (visiting.has(circuitId)) {
      throw new Error(`Zyklische Subschaltungs-Referenz beim Hashen erkannt (${circuitId}).`);
    }

    const lc = byId.get(circuitId);
    if (!lc) {
      throw new Error(`Fehlende Subschaltungs-Referenz "${circuitId}" beim Hashen.`);
    }

    visiting.add(circuitId);

    const pins = lc.pins.map(canonicalizePin).sort();
    const elements = lc.elements
      .map((elem) => canonicalizeElement(elem, computeForId))
      .sort();
    const wires = lc.wires.map(canonicalizeWire).sort();
    const textNotes = lc.textNotes.map(canonicalizeTextNote).sort();

    const canonicalPayload = JSON.stringify({
      notation: lc.notation,
      circuitShape: lc.circuitShape,
      showLabelAbove: lc.showLabelAbove,
      displayMargin: lc.displayMargin,
      validators: lc.validators,
      exportToHDL: lc.exportToHDL,
      pins,
      elements,
      wires,
      textNotes,
    });

    visiting.delete(circuitId);
    const hash = dualFnv1aHex(canonicalPayload);
    hashes.set(circuitId, hash);
    return hash;
  };

  for (const lc of circuits) {
    computeForId(lc.logicalCircuitId);
  }

  return hashes;
}

// Berechnet den Struktur-Hash einer einzelnen nativen Schaltung inklusive ihrer Sub-Schaltungen
export function computeNativeCircuitStructureHash(
  circuitId: string,
  allCircuits: readonly NativeLogicalCircuit[],
): string {
  const hashes = computeNativeCircuitStructureHashes(allCircuits);
  const hash = hashes.get(circuitId);
  if (!hash) {
    throw new Error(`Schaltplan "${circuitId}" wurde für die Hash-Berechnung nicht gefunden.`);
  }
  return hash;
}

// Berechnet die Struktur-Hashes aller Schaltungen eines laufenden CircuitProject
export function computeProjectCircuitStructureHashes(
  project: CircuitProject,
): Map<string, string> {
  const nativeCircuits = project.logicalCircuits.map((lc) =>
    serializeLogicalCircuitToNative(lc, project),
  );
  return computeNativeCircuitStructureHashes(nativeCircuits);
}

// Berechnet den Struktur-Hash einer einzelnen Schaltung eines laufenden CircuitProject
export function computeProjectCircuitStructureHash(
  project: CircuitProject,
  circuitId: string,
): string {
  const hashes = computeProjectCircuitStructureHashes(project);
  const hash = hashes.get(circuitId);
  if (!hash) {
    throw new Error(`Schaltplan "${circuitId}" wurde im Projekt nicht gefunden.`);
  }
  return hash;
}
