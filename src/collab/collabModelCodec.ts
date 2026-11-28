import {
  applyDeltaForward,
  applyLogicalCircuitSnapshot,
  applySymbolSnapshot,
  applyWireModificationsForward,
  deleteEntities,
  insertEntities,
} from "../contexts/circuitContext/historyManager";

import type Circuit from "../types/circuit/circuit";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type Pin from "../types/circuit/pin";
import type TextNote from "../types/circuit/textNote";
import type Wire from "../types/circuit/wire";
import type {
  CollabHighlightIds,
  CollabSerializedEntityBundle,
  CollabSerializedMutation,
} from "../types/collab/modelSyncMessage";
import type CircuitDelta from "../types/history/circuitDelta";
import type NativeProjectDocument from "../types/storage/nativeProjectFormat";
import type {
  NativeCircuitElement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeTextNote,
  NativeWire,
} from "../types/storage/nativeProjectFormat";

import { createCircuitSymbol, syncProjectLogicalCircuits } from "../utils/circuitLayout";
import {
  buildCircuitProjectFromNativeCircuits,
  hydrateNativeProjectDocument,
  instantiateNativeElement,
  instantiateNativePin,
  instantiateNativeTextNote,
  parseNativeProjectDocument,
} from "../utils/storage/nativeProjectReader";
import {
  buildNativeProjectDocument,
  type NativeProjectSerializeOptions,
  serializeCircuitElement,
  serializePinSymbol,
  serializeTextNote,
  serializeWire,
} from "../utils/storage/nativeProjectWriter";
import { createWire, recalculateProjectWires } from "../utils/wireUtils";

export type CollabMutationScope = {
  createdIds: string[];
  touchedEntityIds: string[];
  touchedLogicalCircuitIds: string[];
  deletedLogicalCircuitIds: string[];
  mutatesWireTopologyCircuits: string[];
  mutatesProjectProperties: boolean;
};

const VALID_ROTATIONS = new Set(["up", "right", "down", "left"]);
const VALID_DIRECTIONS = new Set(["clockwise", "counterClockwise"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isGridPointLike(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isWireEndpointUpdateLike(value: unknown): boolean {
  if (!isPlainRecord(value) || !isNonEmptyString(value.wireId)) {
    return false;
  }
  const hasEndpoints = (obj: unknown): boolean =>
    isPlainRecord(obj) &&
    typeof obj.x1 === "number" &&
    Number.isFinite(obj.x1) &&
    typeof obj.y1 === "number" &&
    Number.isFinite(obj.y1) &&
    typeof obj.x2 === "number" &&
    Number.isFinite(obj.x2) &&
    typeof obj.y2 === "number" &&
    Number.isFinite(obj.y2);

  return hasEndpoints(value.before) && hasEndpoints(value.after);
}

function isNativeWireLike(value: unknown): value is NativeWire {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.wireId) &&
    typeof value.x1 === "number" &&
    Number.isFinite(value.x1) &&
    typeof value.y1 === "number" &&
    Number.isFinite(value.y1) &&
    typeof value.x2 === "number" &&
    Number.isFinite(value.x2) &&
    typeof value.y2 === "number" &&
    Number.isFinite(value.y2)
  );
}

function isNativePlacementLike(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.symbolId) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.rotation === "string" &&
    VALID_ROTATIONS.has(value.rotation)
  );
}

function isNativePinLike(value: unknown): value is NativePinElement {
  return isNativePlacementLike(value) && isPlainRecord(value) && isNonEmptyString(value.pinId);
}

function isNativeElementLike(value: unknown): value is NativeCircuitElement {
  return isNativePlacementLike(value) && isPlainRecord(value) && isNonEmptyString(value.kind);
}

function isNativeTextNoteLike(value: unknown): value is NativeTextNote {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.textNoteId) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.note === "string"
  );
}

function isNativeLogicalCircuitLike(value: unknown): value is NativeLogicalCircuit {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.logicalCircuitId) &&
    typeof value.name === "string" &&
    Array.isArray(value.pins) &&
    Array.isArray(value.elements) &&
    Array.isArray(value.wires) &&
    Array.isArray(value.textNotes)
  );
}

function isEntityBundleLike(value: unknown): value is CollabSerializedEntityBundle {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.logicalCircuitId) &&
    Array.isArray(value.pins) &&
    value.pins.every(isNativePinLike) &&
    Array.isArray(value.elements) &&
    value.elements.every(isNativeElementLike) &&
    Array.isArray(value.wires) &&
    value.wires.every(isNativeWireLike) &&
    Array.isArray(value.textNotes) &&
    value.textNotes.every(isNativeTextNoteLike)
  );
}

function buildPinMapForCircuit(project: CircuitProject, logicalCircuitId: string): Map<string, Pin> {
  const map = new Map<string, Pin>();
  for (const pin of project.pins) {
    if (pin.circuitId === logicalCircuitId) {
      map.set(pin.pinId, pin);
    }
  }
  const targetLc = project.logicalCircuits.find((lc) => lc.logicalCircuitId === logicalCircuitId);
  if (targetLc) {
    for (const pin of targetLc.logicalPins) {
      map.set(pin.pinId, pin);
    }
  }
  return map;
}

function collectNativeCircuitIds(lc: NativeLogicalCircuit, outCreated: Set<string>, outSubRefs: Set<string>): void {
  outCreated.add(lc.logicalCircuitId);
  for (const pin of lc.pins) {
    outCreated.add(pin.symbolId);
    outCreated.add(pin.pinId);
  }
  for (const elem of lc.elements) {
    outCreated.add(elem.symbolId);
    if ("componentId" in elem) {
      outCreated.add(elem.componentId);
    }
    if (elem.kind === "subCircuit") {
      outSubRefs.add(elem.logicalCircuitId);
    }
  }
  for (const wire of lc.wires) {
    outCreated.add(wire.wireId);
  }
  for (const note of lc.textNotes) {
    outCreated.add(note.textNoteId);
  }
}

function mergeHydratedCircuitsIntoProject(
  project: CircuitProject,
  nativeCircuits: NativeLogicalCircuit[],
): CircuitProject {
  if (nativeCircuits.length === 0) {
    return project;
  }

  const existingLcMap = new Map<string, LogicalCircuit>(
    project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );
  const hydratedBatch = buildCircuitProjectFromNativeCircuits(
    project.project,
    [],
    nativeCircuits,
    existingLcMap,
  );

  const nextCircuits = new Map(project.circuits);
  for (const [id, circuit] of hydratedBatch.circuits.entries()) {
    nextCircuits.set(id, circuit);
  }

  const nextGates = new Map(project.gates);
  for (const [id, gate] of hydratedBatch.gates.entries()) {
    if (!nextGates.has(id)) {
      nextGates.set(id, gate);
    }
  }

  const mergeById = <T>(existing: T[], incoming: T[], getId: (item: T) => string): T[] => {
    if (incoming.length === 0) {
      return existing;
    }
    const seen = new Set(existing.map(getId));
    return [...existing, ...incoming.filter((item) => !seen.has(getId(item)))];
  };

  const merged: CircuitProject = {
    ...project,
    circuits: nextCircuits,
    gates: nextGates,
    logicalCircuits: mergeById(
      project.logicalCircuits,
      hydratedBatch.logicalCircuits,
      (lc) => lc.logicalCircuitId,
    ),
    pins: mergeById(project.pins, hydratedBatch.pins, (p) => p.pinId),
    constants: mergeById(project.constants, hydratedBatch.constants, (c) => c.constantId),
    circuitButtons: mergeById(project.circuitButtons, hydratedBatch.circuitButtons, (b) => b.circuitButtonId),
    circuitProbes: mergeById(project.circuitProbes, hydratedBatch.circuitProbes, (p) => p.circuitProbeId),
    splitters: mergeById(project.splitters, hydratedBatch.splitters, (s) => s.splitterId),
    memories: mergeById(project.memories, hydratedBatch.memories, (m) => m.memoryId),
    ledMatrices: mergeById(project.ledMatrices, hydratedBatch.ledMatrices, (m) => m.ledMatrixId),
    sensors: mergeById(project.sensors, hydratedBatch.sensors, (s) => s.sensorId),
    sounds: mergeById(project.sounds, hydratedBatch.sounds, (s) => s.soundId),
    synthesizers: mergeById(project.synthesizers, hydratedBatch.synthesizers, (s) => s.synthesizerId),
    graphicsArrays: mergeById(project.graphicsArrays, hydratedBatch.graphicsArrays, (g) => g.graphicsArrayId),
    circuitSymbols: mergeById(project.circuitSymbols, hydratedBatch.circuitSymbols, (s) => s.circuitSymbolId),
    wires: mergeById(project.wires, hydratedBatch.wires, (w) => w.wireId),
    textNotes: mergeById(project.textNotes, hydratedBatch.textNotes, (n) => n.textNoteId),
  };

  return recalculateProjectWires(syncProjectLogicalCircuits(merged));
}

function hydrateElementAsSymbol(
  elem: NativeCircuitElement,
  logicalCircuitId: string,
  project: CircuitProject,
): { symbol: CircuitSymbol; circuit: Circuit } {
  const lcMap = new Map(project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));
  const { circuit } = instantiateNativeElement(
    elem,
    (subId) => lcMap.get(subId),
    project.gates,
  );
  const symbol = createCircuitSymbol(
    circuit,
    logicalCircuitId,
    elem.x,
    elem.y,
    elem.rotation,
    elem.symbolId,
  );
  return { symbol, circuit };
}

function resolveRemovedWires(project: CircuitProject, removedWireIds?: string[]): Wire[] {
  if (!removedWireIds || removedWireIds.length === 0) {
    return [];
  }
  const byId = new Map(project.wires.map((w) => [w.wireId, w]));
  return removedWireIds.map((wireId) => (
    byId.get(wireId) ?? createWire("", { x: 0, y: 0 }, { x: 1, y: 0 }, wireId)
  ));
}

// Serialisiert ein vollständiges CircuitProject verlustfrei in ein NativeProjectDocument
export function encodeProjectSnapshot(
  project: CircuitProject,
  options?: NativeProjectSerializeOptions,
): NativeProjectDocument {
  return buildNativeProjectDocument(project, options);
}

// Validiert und hydratisiert ein empfangenes NativeProjectDocument zurück in ein CircuitProject
export function decodeProjectSnapshot(rawDocument: unknown): CircuitProject {
  const validated = parseNativeProjectDocument(rawDocument);
  return hydrateNativeProjectDocument(validated);
}

// Konvertiert ein einzelnes Symbol samt zugrundeliegendem Pin oder Bauteil in die JSON-Serialisierungsform
export function encodeSymbolToNative(
  symbol: CircuitSymbol,
  project: CircuitProject,
  explicitPin?: Pin,
): { pin?: NativePinElement; element?: NativeCircuitElement } {
  if (symbol.circuit.kind === "pin") {
    const pinMap = buildPinMapForCircuit(project, symbol.logicalCircuitId);
    if (explicitPin) {
      pinMap.set(explicitPin.pinId, explicitPin);
    }
    return { pin: serializePinSymbol(symbol, pinMap) };
  }
  const element = serializeCircuitElement(symbol);
  return element ? { element } : {};
}

// Überführt ein lokales CircuitDelta in eine netzwerkfähige, JSON-serialisierbare CollabSerializedMutation
export function encodeCircuitDeltaToMutation(
  delta: CircuitDelta,
  project: CircuitProject,
  options?: { importedSubCircuits?: readonly LogicalCircuit[] },
): CollabSerializedMutation {
  switch (delta.type) {
    case "add": {
      const pins: NativePinElement[] = [];
      const elements: NativeCircuitElement[] = [];
      for (const entry of delta.symbols) {
        const serialized = encodeSymbolToNative(entry.symbol, project, entry.pin);
        if (serialized.pin) {
          pins.push(serialized.pin);
        } else if (serialized.element) {
          elements.push(serialized.element);
        }
      }
      const wires = (delta.wires ?? [])
        .map(serializeWire)
        .filter((w): w is NativeWire => w !== null);
      const textNotes = delta.textNotes.map(serializeTextNote);

      const importedSubCircuits = options?.importedSubCircuits && options.importedSubCircuits.length > 0
        ? options.importedSubCircuits.map((lc) => {
          const doc = buildNativeProjectDocument({
            ...project,
            logicalCircuits: [lc],
          });
          return doc.logicalCircuits[0];
        })
        : undefined;

      return {
        type: "add",
        logicalCircuitId: delta.logicalCircuitId,
        entities: {
          logicalCircuitId: delta.logicalCircuitId,
          pins,
          elements,
          wires,
          textNotes,
        },
        ...(importedSubCircuits ? { importedSubCircuits } : {}),
      };
    }

    case "remove": {
      return {
        type: "remove",
        logicalCircuitId: delta.logicalCircuitId,
        symbolIds: delta.symbols.map((s) => s.symbol.circuitSymbolId),
        textNoteIds: delta.textNotes.map((n) => n.textNoteId),
        wireIds: (delta.wires ?? []).map((w) => w.wireId),
      };
    }

    case "move": {
      return {
        type: "move",
        logicalCircuitId: delta.logicalCircuitId,
        symbolIds: [...delta.symbolIds],
        textNoteIds: [...delta.textNoteIds],
        ...(delta.wireIds ? { wireIds: [...delta.wireIds] } : {}),
        dx: delta.dx,
        dy: delta.dy,
        ...(delta.symbolPositions ? { symbolPositions: delta.symbolPositions } : {}),
        ...(delta.textNotePositions ? { textNotePositions: delta.textNotePositions } : {}),
        ...(delta.wireChanges ? { wireChanges: delta.wireChanges } : {}),
        ...(delta.removedWires ? { removedWireIds: delta.removedWires.map((w) => w.wireId) } : {}),
      };
    }

    case "rotate": {
      return {
        type: "rotate",
        logicalCircuitId: delta.logicalCircuitId,
        direction: delta.direction,
        symbols: delta.symbols,
        textNotes: delta.textNotes,
        ...(delta.wireChanges ? { wireChanges: delta.wireChanges } : {}),
        ...(delta.removedWires ? { removedWireIds: delta.removedWires.map((w) => w.wireId) } : {}),
      };
    }

    case "wireBatch": {
      return {
        type: "wireBatch",
        logicalCircuitId: delta.logicalCircuitId,
        addedWires: delta.addedWires
          .map(serializeWire)
          .filter((w): w is NativeWire => w !== null),
        removedWireIds: delta.removedWires.map((w) => w.wireId),
        updatedWires: delta.updatedWires,
      };
    }

    case "updateProperty": {
      if (delta.targetType === "symbol" && delta.afterSymbol) {
        const serialized = encodeSymbolToNative(
          delta.afterSymbol.symbol,
          project,
          delta.afterSymbol.pin,
        );
        return {
          type: "updateProperty",
          logicalCircuitId: delta.logicalCircuitId,
          targetType: "symbol",
          targetId: delta.targetId,
          ...(serialized.pin ? { afterPin: serialized.pin } : {}),
          ...(serialized.element ? { afterElement: serialized.element } : {}),
          ...(delta.wireChanges ? { wireChanges: delta.wireChanges } : {}),
          ...(delta.removedWires ? { removedWireIds: delta.removedWires.map((w) => w.wireId) } : {}),
        };
      }

      if (delta.targetType === "textNote" && delta.afterTextNote) {
        return {
          type: "updateProperty",
          logicalCircuitId: delta.logicalCircuitId,
          targetType: "textNote",
          targetId: delta.targetId,
          afterTextNote: serializeTextNote(delta.afterTextNote),
        };
      }

      if (delta.targetType === "logicalCircuit" && delta.afterLogicalCircuit) {
        return {
          type: "updateProperty",
          logicalCircuitId: delta.logicalCircuitId,
          targetType: "logicalCircuit",
          targetId: delta.targetId,
          afterLogicalCircuit: delta.afterLogicalCircuit,
        };
      }

      throw new Error(`Unvollständiges updateProperty-Delta für "${delta.targetType}:${delta.targetId}".`);
    }
  }
}

// Prüft die strukturelle Gültigkeit einer empfangenen SerializedMutation
export function validateSerializedMutation(raw: unknown): raw is CollabSerializedMutation {
  if (!isPlainRecord(raw) || typeof raw.type !== "string") {
    return false;
  }

  switch (raw.type) {
    case "add":
      return (
        isNonEmptyString(raw.logicalCircuitId) &&
        isEntityBundleLike(raw.entities) &&
        raw.entities.logicalCircuitId === raw.logicalCircuitId &&
        (raw.importedSubCircuits === undefined ||
          (Array.isArray(raw.importedSubCircuits) && raw.importedSubCircuits.every(isNativeLogicalCircuitLike)))
      );

    case "remove":
      return (
        isNonEmptyString(raw.logicalCircuitId) &&
        isStringArray(raw.symbolIds) &&
        isStringArray(raw.textNoteIds) &&
        isStringArray(raw.wireIds)
      );

    case "move":
      return (
        isNonEmptyString(raw.logicalCircuitId) &&
        isStringArray(raw.symbolIds) &&
        isStringArray(raw.textNoteIds) &&
        (raw.wireIds === undefined || isStringArray(raw.wireIds)) &&
        typeof raw.dx === "number" &&
        Number.isFinite(raw.dx) &&
        typeof raw.dy === "number" &&
        Number.isFinite(raw.dy) &&
        (raw.symbolPositions === undefined ||
          (Array.isArray(raw.symbolPositions) &&
            raw.symbolPositions.every(
              (p) => isPlainRecord(p) && isNonEmptyString(p.symbolId) && isGridPointLike(p.before) && isGridPointLike(p.after),
            ))) &&
        (raw.textNotePositions === undefined ||
          (Array.isArray(raw.textNotePositions) &&
            raw.textNotePositions.every(
              (p) => isPlainRecord(p) && isNonEmptyString(p.textNoteId) && isGridPointLike(p.before) && isGridPointLike(p.after),
            ))) &&
        (raw.wireChanges === undefined ||
          (Array.isArray(raw.wireChanges) && raw.wireChanges.every(isWireEndpointUpdateLike))) &&
        (raw.removedWireIds === undefined || isStringArray(raw.removedWireIds)) &&
        (raw.addedWires === undefined || (Array.isArray(raw.addedWires) && raw.addedWires.every(isNativeWireLike)))
      );

    case "rotate":
      return (
        isNonEmptyString(raw.logicalCircuitId) &&
        typeof raw.direction === "string" &&
        VALID_DIRECTIONS.has(raw.direction) &&
        Array.isArray(raw.symbols) &&
        Array.isArray(raw.textNotes) &&
        (raw.wireChanges === undefined ||
          (Array.isArray(raw.wireChanges) && raw.wireChanges.every(isWireEndpointUpdateLike))) &&
        (raw.removedWireIds === undefined || isStringArray(raw.removedWireIds)) &&
        (raw.addedWires === undefined || (Array.isArray(raw.addedWires) && raw.addedWires.every(isNativeWireLike)))
      );

    case "wireBatch":
      return (
        isNonEmptyString(raw.logicalCircuitId) &&
        Array.isArray(raw.addedWires) &&
        raw.addedWires.every(isNativeWireLike) &&
        isStringArray(raw.removedWireIds) &&
        Array.isArray(raw.updatedWires) &&
        raw.updatedWires.every(isWireEndpointUpdateLike)
      );

    case "updateProperty":
      if (!isNonEmptyString(raw.logicalCircuitId) || !isNonEmptyString(raw.targetId)) {
        return false;
      }
      if (
        (raw.wireChanges !== undefined &&
          (!Array.isArray(raw.wireChanges) || !raw.wireChanges.every(isWireEndpointUpdateLike))) ||
        (raw.removedWireIds !== undefined && !isStringArray(raw.removedWireIds)) ||
        (raw.addedWires !== undefined && (!Array.isArray(raw.addedWires) || !raw.addedWires.every(isNativeWireLike)))
      ) {
        return false;
      }
      if (raw.targetType === "symbol") {
        return (
          (raw.afterPin !== undefined && isNativePinLike(raw.afterPin)) ||
          (raw.afterElement !== undefined && isNativeElementLike(raw.afterElement))
        );
      }
      if (raw.targetType === "textNote") {
        return isNativeTextNoteLike(raw.afterTextNote);
      }
      if (raw.targetType === "logicalCircuit") {
        return (
          isPlainRecord(raw.afterLogicalCircuit) &&
          typeof raw.afterLogicalCircuit.name === "string" &&
          typeof raw.afterLogicalCircuit.notation === "string" &&
          typeof raw.afterLogicalCircuit.category === "string" &&
          typeof raw.afterLogicalCircuit.note === "string"
        );
      }
      return false;

    case "createCircuits":
      return (
        Array.isArray(raw.circuits) &&
        raw.circuits.length > 0 &&
        raw.circuits.every(isNativeLogicalCircuitLike)
      );

    case "deleteCircuits":
      return isStringArray(raw.circuitIds) && raw.circuitIds.length > 0;

    case "updateProjectProperties":
      return isPlainRecord(raw.updates);

    case "importLibraryCircuit":
      return (
        Array.isArray(raw.addedCircuits) &&
        (raw.targetCircuitId === undefined || isNonEmptyString(raw.targetCircuitId)) &&
        (raw.placedElement === undefined || isNativeElementLike(raw.placedElement)) &&
        raw.addedCircuits.every(isNativeLogicalCircuitLike)
      );

    case "updateMemoryData":
      return (
        Array.isArray(raw.updates) &&
        raw.updates.length > 0 &&
        raw.updates.every(
          (entry) => isPlainRecord(entry) && isNonEmptyString(entry.memoryId) && typeof entry.data === "string",
        )
      );

    default:
      return false;
  }
}

// Extrahiert die von einer Mutation betroffenen visuellen Highlight-IDs (z. B. für MCP-Commits)
export function extractMutationHighlightIds(mutation: CollabSerializedMutation): CollabHighlightIds {
  switch (mutation.type) {
    case "add":
      return {
        symbolIds: [
          ...mutation.entities.pins.map((p) => p.symbolId),
          ...mutation.entities.elements.map((e) => e.symbolId),
        ],
        textNoteIds: mutation.entities.textNotes.map((n) => n.textNoteId),
        wireIds: mutation.entities.wires.map((w) => w.wireId),
      };
    case "remove":
      return {
        symbolIds: [...mutation.symbolIds],
        textNoteIds: [...mutation.textNoteIds],
        wireIds: [...mutation.wireIds],
      };
    case "move":
      return {
        symbolIds: [...mutation.symbolIds],
        textNoteIds: [...mutation.textNoteIds],
        wireIds: [
          ...(mutation.wireIds ?? []),
          ...(mutation.wireChanges ?? []).map((w) => w.wireId),
          ...(mutation.addedWires ?? []).map((w) => w.wireId),
        ],
      };
    case "rotate":
      return {
        symbolIds: mutation.symbols.map((s) => s.symbolId),
        textNoteIds: mutation.textNotes.map((n) => n.textNoteId),
        wireIds: [
          ...(mutation.wireChanges ?? []).map((w) => w.wireId),
          ...(mutation.addedWires ?? []).map((w) => w.wireId),
        ],
      };
    case "wireBatch":
      return {
        symbolIds: [],
        textNoteIds: [],
        wireIds: [
          ...mutation.addedWires.map((w) => w.wireId),
          ...mutation.updatedWires.map((w) => w.wireId),
        ],
      };
    case "updateProperty":
      return {
        symbolIds: mutation.targetType === "symbol" ? [mutation.targetId] : [],
        textNoteIds: mutation.targetType === "textNote" ? [mutation.targetId] : [],
        wireIds: [
          ...(mutation.wireChanges ?? []).map((w) => w.wireId),
          ...(mutation.addedWires ?? []).map((w) => w.wireId),
        ],
      };
    case "importLibraryCircuit":
      return {
        symbolIds: mutation.placedElement ? [mutation.placedElement.symbolId] : [],
        textNoteIds: [],
        wireIds: [],
      };
    case "createCircuits":
    case "deleteCircuits":
    case "updateProjectProperties":
    case "updateMemoryData":
      return {
        symbolIds: [],
        textNoteIds: [],
        wireIds: [],
      };
  }
}

// Ermittelt die von einer Mutation angelegten bzw. berührten IDs und Schaltpläne für die Konflikt- und Kollisionsprüfung
export function extractMutationScope(mutation: CollabSerializedMutation): CollabMutationScope {
  const created = new Set<string>();
  const touchedEntities = new Set<string>();
  const touchedCircuits = new Set<string>();
  const deletedCircuits = new Set<string>();
  const wireTopologyCircuits = new Set<string>();
  let mutatesProjectProperties = false;

  switch (mutation.type) {
    case "add": {
      touchedCircuits.add(mutation.logicalCircuitId);
      for (const lc of mutation.importedSubCircuits ?? []) {
        collectNativeCircuitIds(lc, created, touchedCircuits);
      }
      for (const pin of mutation.entities.pins) {
        created.add(pin.symbolId);
        created.add(pin.pinId);
      }
      for (const elem of mutation.entities.elements) {
        created.add(elem.symbolId);
        if ("componentId" in elem) {
          created.add(elem.componentId);
        }
        if (elem.kind === "subCircuit") {
          touchedCircuits.add(elem.logicalCircuitId);
        }
      }
      for (const note of mutation.entities.textNotes) {
        created.add(note.textNoteId);
      }
      for (const wire of mutation.entities.wires) {
        created.add(wire.wireId);
      }
      if (mutation.entities.wires.length > 0) {
        wireTopologyCircuits.add(mutation.logicalCircuitId);
      }
      for (const id of created) {
        touchedEntities.add(id);
      }
      break;
    }

    case "remove": {
      touchedCircuits.add(mutation.logicalCircuitId);
      for (const id of mutation.symbolIds) {
        touchedEntities.add(id);
      }
      for (const id of mutation.textNoteIds) {
        touchedEntities.add(id);
      }
      for (const id of mutation.wireIds) {
        touchedEntities.add(id);
      }
      if (mutation.wireIds.length > 0) {
        wireTopologyCircuits.add(mutation.logicalCircuitId);
      }
      break;
    }

    case "move": {
      touchedCircuits.add(mutation.logicalCircuitId);
      for (const id of mutation.symbolIds) {
        touchedEntities.add(id);
      }
      for (const id of mutation.textNoteIds) {
        touchedEntities.add(id);
      }
      for (const id of mutation.wireIds ?? []) {
        touchedEntities.add(id);
      }
      for (const change of mutation.wireChanges ?? []) {
        touchedEntities.add(change.wireId);
      }
      for (const id of mutation.removedWireIds ?? []) {
        touchedEntities.add(id);
      }
      for (const w of mutation.addedWires ?? []) {
        created.add(w.wireId);
        touchedEntities.add(w.wireId);
      }
      if (
        (mutation.wireIds && mutation.wireIds.length > 0) ||
        (mutation.wireChanges && mutation.wireChanges.length > 0) ||
        (mutation.removedWireIds && mutation.removedWireIds.length > 0) ||
        (mutation.addedWires && mutation.addedWires.length > 0)
      ) {
        wireTopologyCircuits.add(mutation.logicalCircuitId);
      }
      break;
    }

    case "rotate": {
      touchedCircuits.add(mutation.logicalCircuitId);
      for (const entry of mutation.symbols) {
        touchedEntities.add(entry.symbolId);
      }
      for (const entry of mutation.textNotes) {
        touchedEntities.add(entry.textNoteId);
      }
      for (const change of mutation.wireChanges ?? []) {
        touchedEntities.add(change.wireId);
      }
      for (const id of mutation.removedWireIds ?? []) {
        touchedEntities.add(id);
      }
      for (const w of mutation.addedWires ?? []) {
        created.add(w.wireId);
        touchedEntities.add(w.wireId);
      }
      if (
        (mutation.wireChanges && mutation.wireChanges.length > 0) ||
        (mutation.removedWireIds && mutation.removedWireIds.length > 0) ||
        (mutation.addedWires && mutation.addedWires.length > 0)
      ) {
        wireTopologyCircuits.add(mutation.logicalCircuitId);
      }
      break;
    }

    case "wireBatch": {
      touchedCircuits.add(mutation.logicalCircuitId);
      wireTopologyCircuits.add(mutation.logicalCircuitId);
      for (const w of mutation.addedWires) {
        created.add(w.wireId);
        touchedEntities.add(w.wireId);
      }
      for (const id of mutation.removedWireIds) {
        touchedEntities.add(id);
      }
      for (const change of mutation.updatedWires) {
        touchedEntities.add(change.wireId);
      }
      break;
    }

    case "updateProperty": {
      touchedCircuits.add(mutation.logicalCircuitId);
      touchedEntities.add(mutation.targetId);
      if (mutation.targetType === "logicalCircuit") {
        touchedCircuits.add(mutation.targetId);
      }
      if (mutation.afterPin) {
        touchedEntities.add(mutation.afterPin.pinId);
      }
      if (mutation.afterElement && "componentId" in mutation.afterElement) {
        touchedEntities.add(mutation.afterElement.componentId);
      }
      for (const change of mutation.wireChanges ?? []) {
        touchedEntities.add(change.wireId);
      }
      for (const id of mutation.removedWireIds ?? []) {
        touchedEntities.add(id);
      }
      for (const w of mutation.addedWires ?? []) {
        created.add(w.wireId);
        touchedEntities.add(w.wireId);
      }
      if (
        (mutation.wireChanges && mutation.wireChanges.length > 0) ||
        (mutation.removedWireIds && mutation.removedWireIds.length > 0) ||
        (mutation.addedWires && mutation.addedWires.length > 0)
      ) {
        wireTopologyCircuits.add(mutation.logicalCircuitId);
      }
      break;
    }

    case "createCircuits": {
      for (const lc of mutation.circuits) {
        collectNativeCircuitIds(lc, created, touchedCircuits);
      }
      for (const id of created) {
        touchedEntities.add(id);
        if (mutation.circuits.some((lc) => lc.logicalCircuitId === id)) {
          touchedCircuits.add(id);
        }
      }
      break;
    }

    case "deleteCircuits": {
      for (const id of mutation.circuitIds) {
        deletedCircuits.add(id);
        touchedCircuits.add(id);
        touchedEntities.add(id);
      }
      break;
    }

    case "updateProjectProperties": {
      mutatesProjectProperties = true;
      break;
    }

    case "importLibraryCircuit": {
      if (mutation.targetCircuitId) {
        touchedCircuits.add(mutation.targetCircuitId);
      }
      for (const lc of mutation.addedCircuits) {
        collectNativeCircuitIds(lc, created, touchedCircuits);
        touchedCircuits.add(lc.logicalCircuitId);
      }
      if (mutation.placedElement) {
        created.add(mutation.placedElement.symbolId);
        if ("componentId" in mutation.placedElement) {
          created.add(mutation.placedElement.componentId);
        }
        if (mutation.placedElement.kind === "subCircuit") {
          touchedCircuits.add(mutation.placedElement.logicalCircuitId);
        }
      }
      for (const id of created) {
        touchedEntities.add(id);
      }
      break;
    }

    case "updateMemoryData": {
      for (const entry of mutation.updates) {
        touchedEntities.add(entry.memoryId);
      }
      break;
    }
  }

  return {
    createdIds: Array.from(created),
    touchedEntityIds: Array.from(touchedEntities),
    touchedLogicalCircuitIds: Array.from(touchedCircuits),
    deletedLogicalCircuitIds: Array.from(deletedCircuits),
    mutatesWireTopologyCircuits: Array.from(wireTopologyCircuits),
    mutatesProjectProperties,
  };
}

// Wendet eine validierte CollabSerializedMutation deterministisch und unveränderlich auf ein CircuitProject an
export function applySerializedMutationToProject(
  project: CircuitProject,
  mutation: CollabSerializedMutation,
): CircuitProject {
  switch (mutation.type) {
    case "add": {
      const baseProject = mutation.importedSubCircuits && mutation.importedSubCircuits.length > 0
        ? mergeHydratedCircuitsIntoProject(project, mutation.importedSubCircuits)
        : project;

      const symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[] = [];
      for (const rawPin of mutation.entities.pins) {
        const { pin, pinCircuit } = instantiateNativePin(rawPin, mutation.logicalCircuitId);
        const symbol = createCircuitSymbol(
          pinCircuit,
          mutation.logicalCircuitId,
          rawPin.x,
          rawPin.y,
          rawPin.rotation,
          rawPin.symbolId,
        );
        symbols.push({ symbol, circuit: pinCircuit, pin });
      }
      for (const rawElem of mutation.entities.elements) {
        const { symbol, circuit } = hydrateElementAsSymbol(
          rawElem,
          mutation.logicalCircuitId,
          baseProject,
        );
        symbols.push({ symbol, circuit });
      }
      const textNotes = mutation.entities.textNotes.map((rawNote) =>
        instantiateNativeTextNote(rawNote, mutation.logicalCircuitId),
      );
      const wires = mutation.entities.wires.map((rawWire) =>
        createWire(
          mutation.logicalCircuitId,
          { x: rawWire.x1, y: rawWire.y1 },
          { x: rawWire.x2, y: rawWire.y2 },
          rawWire.wireId,
        ),
      );
      return insertEntities(baseProject, mutation.logicalCircuitId, symbols, textNotes, wires);
    }

    case "remove": {
      const symSet = new Set(mutation.symbolIds);
      const noteSet = new Set(mutation.textNoteIds);
      const wireSet = new Set(mutation.wireIds);
      const pinById = new Map(project.pins.map((p) => [p.pinId, p]));

      const targetLc = project.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === mutation.logicalCircuitId,
      );
      const symbolSource = targetLc?.circuitSymbols ?? project.circuitSymbols;
      const noteSource = targetLc?.textNotes ?? project.textNotes;
      const wireSource = targetLc?.wires ?? project.wires;

      const symbols = symbolSource
        .filter((s) => symSet.has(s.circuitSymbolId))
        .map((symbol) => ({
          symbol,
          circuit: symbol.circuit,
          pin: symbol.circuit.kind === "pin" ? pinById.get(symbol.circuit.circuitId) : undefined,
        }));
      const textNotes = noteSource.filter((n) => noteSet.has(n.textNoteId));
      const wires = wireSource.filter((w) => wireSet.has(w.wireId));

      return deleteEntities(project, symbols, textNotes, wires);
    }

    case "move": {
      const moved = applyDeltaForward(project, {
        type: "move",
        logicalCircuitId: mutation.logicalCircuitId,
        symbolIds: mutation.symbolIds,
        textNoteIds: mutation.textNoteIds,
        wireIds: mutation.wireIds,
        dx: mutation.dx,
        dy: mutation.dy,
        symbolPositions: mutation.symbolPositions,
        textNotePositions: mutation.textNotePositions,
        wireChanges: mutation.wireChanges,
        removedWires: resolveRemovedWires(project, mutation.removedWireIds),
      });
      if (!mutation.addedWires || mutation.addedWires.length === 0) {
        return moved;
      }
      const restoredWires = mutation.addedWires.map((w) =>
        createWire(mutation.logicalCircuitId, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, w.wireId),
      );
      return applyWireModificationsForward(moved, mutation.logicalCircuitId, undefined, undefined, restoredWires);
    }

    case "rotate": {
      const rotated = applyDeltaForward(project, {
        type: "rotate",
        logicalCircuitId: mutation.logicalCircuitId,
        direction: mutation.direction,
        symbols: mutation.symbols,
        textNotes: mutation.textNotes,
        wireChanges: mutation.wireChanges,
        removedWires: resolveRemovedWires(project, mutation.removedWireIds),
      });
      if (!mutation.addedWires || mutation.addedWires.length === 0) {
        return rotated;
      }
      const restoredWires = mutation.addedWires.map((w) =>
        createWire(mutation.logicalCircuitId, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, w.wireId),
      );
      return applyWireModificationsForward(rotated, mutation.logicalCircuitId, undefined, undefined, restoredWires);
    }

    case "wireBatch": {
      const addedWires = mutation.addedWires.map((w) =>
        createWire(
          mutation.logicalCircuitId,
          { x: w.x1, y: w.y1 },
          { x: w.x2, y: w.y2 },
          w.wireId,
        ),
      );
      const removedWires = resolveRemovedWires(project, mutation.removedWireIds);
      return applyWireModificationsForward(
        project,
        mutation.logicalCircuitId,
        mutation.updatedWires,
        removedWires,
        addedWires,
      );
    }

    case "updateProperty": {
      if (mutation.targetType === "symbol") {
        let nextProject = project;
        if (mutation.afterPin) {
          const { pin, pinCircuit } = instantiateNativePin(
            mutation.afterPin,
            mutation.logicalCircuitId,
          );
          const symbol = createCircuitSymbol(
            pinCircuit,
            mutation.logicalCircuitId,
            mutation.afterPin.x,
            mutation.afterPin.y,
            mutation.afterPin.rotation,
            mutation.afterPin.symbolId,
          );
          nextProject = applySymbolSnapshot(project, mutation.targetId, {
            symbol,
            circuit: pinCircuit,
            pin,
          });
        } else if (mutation.afterElement) {
          const { symbol, circuit } = hydrateElementAsSymbol(
            mutation.afterElement,
            mutation.logicalCircuitId,
            project,
          );
          nextProject = applySymbolSnapshot(project, mutation.targetId, { symbol, circuit });
        }
        const addedWires = (mutation.addedWires ?? []).map((w) =>
          createWire(mutation.logicalCircuitId, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, w.wireId),
        );
        return applyWireModificationsForward(
          nextProject,
          mutation.logicalCircuitId,
          mutation.wireChanges,
          resolveRemovedWires(nextProject, mutation.removedWireIds),
          addedWires,
        );
      }

      if (mutation.targetType === "textNote" && mutation.afterTextNote) {
        const updatedNote = instantiateNativeTextNote(
          mutation.afterTextNote,
          mutation.logicalCircuitId,
        );
        const replaceNote = (n: TextNote) => (n.textNoteId === mutation.targetId ? updatedNote : n);
        return {
          ...project,
          textNotes: project.textNotes.map(replaceNote),
          logicalCircuits: project.logicalCircuits.map((lc) => ({
            ...lc,
            textNotes: lc.textNotes.map(replaceNote),
          })),
        };
      }

      if (mutation.targetType === "logicalCircuit" && mutation.afterLogicalCircuit) {
        return applyLogicalCircuitSnapshot(
          project,
          mutation.targetId,
          mutation.afterLogicalCircuit,
        );
      }

      return project;
    }

    case "createCircuits": {
      return mergeHydratedCircuitsIntoProject(project, mutation.circuits);
    }

    case "deleteCircuits": {
      const targetSet = new Set(mutation.circuitIds);
      const remaining = project.logicalCircuits.filter(
        (lc) => !targetSet.has(lc.logicalCircuitId),
      );
      if (remaining.length === 0) {
        throw new Error("Mindestens eine Schaltung muss im Projekt verbleiben.");
      }

      for (const surviving of remaining) {
        for (const sym of surviving.circuitSymbols) {
          if (sym.circuit.kind === "logicalCircuit" && targetSet.has(sym.circuit.circuitId)) {
            throw new Error(
              `Schaltung "${sym.circuit.circuitId}" wird noch als Sub-Schaltung in "${surviving.name}" verwendet.`,
            );
          }
        }
      }

      const deletedLcs = project.logicalCircuits.filter((lc) => targetSet.has(lc.logicalCircuitId));
      const pinById = new Map(project.pins.map((p) => [p.pinId, p]));
      const deletedSymbols = deletedLcs.flatMap((lc) =>
        lc.circuitSymbols.map((symbol) => ({
          symbol,
          circuit: symbol.circuit,
          pin: symbol.circuit.kind === "pin" ? pinById.get(symbol.circuit.circuitId) : undefined,
        })),
      );
      const deletedNotes = deletedLcs.flatMap((lc) => lc.textNotes);
      const deletedWires = deletedLcs.flatMap((lc) => lc.wires);

      const cleaned = deleteEntities(project, deletedSymbols, deletedNotes, deletedWires);
      const nextCircuits = new Map(cleaned.circuits);
      for (const deletedId of targetSet) {
        nextCircuits.delete(deletedId);
      }
      const fallbackCircuitId = remaining[0].logicalCircuitId;

      return {
        ...cleaned,
        project: {
          ...cleaned.project,
          logicalCircuitId: targetSet.has(cleaned.project.logicalCircuitId)
            ? fallbackCircuitId
            : cleaned.project.logicalCircuitId,
          startupCircuitId: cleaned.project.startupCircuitId && targetSet.has(cleaned.project.startupCircuitId)
            ? undefined
            : cleaned.project.startupCircuitId,
        },
        circuits: nextCircuits,
        logicalCircuits: cleaned.logicalCircuits.filter((lc) => !targetSet.has(lc.logicalCircuitId)),
      };
    }

    case "updateProjectProperties": {
      const currentMeta = project.project;
      const updates = mutation.updates;
      const nextName = updates.name !== undefined
        ? (updates.name.trim() || currentMeta.name)
        : currentMeta.name;
      return {
        ...project,
        project: {
          ...currentMeta,
          name: nextName,
          note: updates.note !== undefined ? updates.note : currentMeta.note,
          frequency: updates.frequency !== undefined ? updates.frequency : currentMeta.frequency,
          isMaximumSpeed: updates.isMaximumSpeed !== undefined
            ? updates.isMaximumSpeed
            : currentMeta.isMaximumSpeed,
        },
      };
    }

    case "importLibraryCircuit": {
      const merged = mergeHydratedCircuitsIntoProject(project, mutation.addedCircuits);
      if (!mutation.targetCircuitId || !mutation.placedElement) {
        return merged;
      }
      const { symbol, circuit } = hydrateElementAsSymbol(
        mutation.placedElement,
        mutation.targetCircuitId,
        merged,
      );
      return insertEntities(merged, mutation.targetCircuitId, [{ symbol, circuit }], []);
    }

    case "updateMemoryData": {
      const updateMap = new Map(mutation.updates.map((u) => [u.memoryId, u.data]));
      if (updateMap.size === 0) {
        return project;
      }

      const nextCircuits = new Map(project.circuits);
      const updatedMemoryById = new Map<string, Memory>();
      const nextMemories = project.memories.map((mem) => {
        const nextData = updateMap.get(mem.memoryId);
        if (nextData === undefined || nextData === mem.data) {
          return mem;
        }
        const updatedMem: Memory = { ...mem, data: nextData };
        nextCircuits.set(updatedMem.circuitId, updatedMem);
        updatedMemoryById.set(updatedMem.memoryId, updatedMem);
        return updatedMem;
      });

      if (updatedMemoryById.size === 0) {
        return project;
      }

      const refreshSymbol = (sym: CircuitSymbol): CircuitSymbol => {
        if (sym.circuit.kind !== "memory") {
          return sym;
        }
        const updatedMem = updatedMemoryById.get((sym.circuit as Memory).memoryId);
        return updatedMem ? { ...sym, circuit: updatedMem } : sym;
      };

      return {
        ...project,
        circuits: nextCircuits,
        memories: nextMemories,
        circuitSymbols: project.circuitSymbols.map(refreshSymbol),
        logicalCircuits: project.logicalCircuits.map((lc) => ({
          ...lc,
          circuitSymbols: lc.circuitSymbols.map(refreshSymbol),
        })),
      };
    }
  }
}
