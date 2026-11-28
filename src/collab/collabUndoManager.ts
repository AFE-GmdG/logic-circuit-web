import {
  applyDeltaBackward,
  applyDeltaForward,
  createEmptyHistoryState,
} from "../contexts/circuitContext/historyManager";

import type GridPoint from "../types/canvas/gridPoint";
import type Circuit from "../types/circuit/circuit";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Pin from "../types/circuit/pin";
import type PreparedPastePayload from "../types/circuit/preparedPastePayload";
import type RotationDirection from "../types/circuit/rotationDirection";
import type TextNote from "../types/circuit/textNote";
import type Wire from "../types/circuit/wire";
import type WireEndpointUpdate from "../types/circuit/wireEndpointUpdate";
import type {
  CollabSerializedMutation,
  CollabSoftLockEntry,
  CollabSoftLockTargetType,
} from "../types/collab/modelSyncMessage";
import type CircuitDelta from "../types/history/circuitDelta";
import type HistoryState from "../types/history/historyState";
import type { NativeWire } from "../types/storage/nativeProjectFormat";

import { createCircuitSymbol, gridPointKey } from "../utils/circuitLayout";
import { generateEntityUuid } from "../utils/entityId";
import { checkFloatingPasteOverlap } from "../utils/floatingPasteUtils";
import { serializeTextNote, serializeWire } from "../utils/storage/nativeProjectWriter";

import { encodeCircuitDeltaToMutation, encodeSymbolToNative } from "./collabModelCodec";

export type CollabUndoConflictCode =
  | "circuit-missing"
  | "entity-missing"
  | "entity-modified"
  | "entity-locked"
  | "wire-topology-conflict"
  | "spatial-collision"
  | "id-collision"
  | "quiesced"
  | "unauthorized";

export type CollabUndoConflict = {
  direction: "undo" | "redo";
  code: CollabUndoConflictCode;
  message: string;
  logicalCircuitId: string;
  conflictingEntityIds: string[];
  lockedByDisplayName?: string;
  preservedEntry: boolean;
};

export type CollabUndoPreparation =
  | {
    ok: true;
    direction: "undo" | "redo";
    entryId: string;
    delta: CircuitDelta;
    mutation: CollabSerializedMutation;
    nextProject: CircuitProject;
    nextPointer: number;
    previousPointer: number;
  }
  | {
    ok: false;
    direction: "undo" | "redo";
    conflict: CollabUndoConflict | null;
  };

type PositionTransition = {
  id: string;
  before: GridPoint;
  after: GridPoint;
};

type CollabUndoEntry = {
  id: string;
  mutationId?: string;
  logicalCircuitId: string;
  delta: CircuitDelta;
  importedSubCircuits?: LogicalCircuit[];
  moveSymbolPositions?: PositionTransition[];
  moveNotePositions?: PositionTransition[];
};

type CircuitUndoStack = {
  entries: CollabUndoEntry[];
  pointer: number;
};

type WireEndpoints = { x1: number; y1: number; x2: number; y2: number };

function doWireEndpointsMatch(wire: Wire, expected: WireEndpoints): boolean {
  const direct =
    wire.x1 === expected.x1 &&
    wire.y1 === expected.y1 &&
    wire.x2 === expected.x2 &&
    wire.y2 === expected.y2;
  const reversed =
    wire.x1 === expected.x2 &&
    wire.y1 === expected.y2 &&
    wire.x2 === expected.x1 &&
    wire.y2 === expected.y1;
  return direct || reversed;
}

function flipDirection(direction: RotationDirection): RotationDirection {
  return direction === "clockwise" ? "counterClockwise" : "clockwise";
}

function flipWireChanges(wireChanges?: WireEndpointUpdate[]): WireEndpointUpdate[] | undefined {
  if (!wireChanges || wireChanges.length === 0) {
    return undefined;
  }
  return wireChanges.map((change) => ({
    wireId: change.wireId,
    before: change.after,
    after: change.before,
  }));
}

function serializeWiresList(wires?: Wire[]): NativeWire[] | undefined {
  if (!wires || wires.length === 0) {
    return undefined;
  }
  return wires
    .map(serializeWire)
    .filter((w): w is NativeWire => w !== null);
}

function buildEmptyPastePayload(
  logicalCircuitId: string,
  symbols: { symbol: CircuitSymbol; circuit: Circuit }[],
): PreparedPastePayload {
  return {
    targetCircuitId: logicalCircuitId,
    symbols,
    textNotes: [],
    wires: [],
    importedSubCircuits: [],
    importedGates: [],
    importedPins: [],
    importedButtons: [],
    importedConstants: [],
    importedProbes: [],
    importedLedMatrices: [],
    importedSplitters: [],
    importedMemories: [],
    importedSensors: [],
    importedSounds: [],
    importedSynthesizers: [],
    importedGraphicsArrays: [],
  };
}

function findForeignLockConflict(
  targets: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
  foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  direction: "undo" | "redo",
  logicalCircuitId: string,
): CollabUndoConflict | null {
  for (const target of targets) {
    const lock = foreignLocks.find(
      (entry) => entry.targetType === target.targetType && entry.targetId === target.targetId,
    );
    if (lock) {
      return {
        direction,
        code: "entity-locked",
        message: `Element wird aktuell von ${lock.ownerDisplayName} bearbeitet.`,
        logicalCircuitId,
        conflictingEntityIds: [target.targetId],
        lockedByDisplayName: lock.ownerDisplayName,
        preservedEntry: true,
      };
    }
  }
  return null;
}

function checkSpatialOverlapForSymbols(
  candidateSymbols: { symbol: CircuitSymbol; circuit: Circuit }[],
  targetCircuit: LogicalCircuit,
  excludeSymbolIds: ReadonlySet<string>,
  direction: "undo" | "redo",
): CollabUndoConflict | null {
  if (candidateSymbols.length === 0) {
    return null;
  }
  const filteredCircuit: LogicalCircuit = {
    ...targetCircuit,
    circuitSymbols: targetCircuit.circuitSymbols.filter((s) => !excludeSymbolIds.has(s.circuitSymbolId)),
  };
  const overlap = checkFloatingPasteOverlap(
    buildEmptyPastePayload(targetCircuit.logicalCircuitId, candidateSymbols),
    filteredCircuit,
  );
  if (!overlap.hasOverlapWarning) {
    return null;
  }
  return {
    direction,
    code: "spatial-collision",
    message: "Zielposition ist inzwischen durch ein anderes Bauteil belegt. Bitte zuerst Platz schaffen.",
    logicalCircuitId: targetCircuit.logicalCircuitId,
    conflictingEntityIds: overlap.overlappingSymbolIds,
    preservedEntry: true,
  };
}

function buildConflict(
  direction: "undo" | "redo",
  code: CollabUndoConflictCode,
  message: string,
  logicalCircuitId: string,
  conflictingEntityIds: string[],
): CollabUndoPreparation {
  return {
    ok: false,
    direction,
    conflict: {
      direction,
      code,
      message,
      logicalCircuitId,
      conflictingEntityIds,
      preservedEntry: true,
    },
  };
}

function isSymbolUnmodified(
  currentSymbol: CircuitSymbol,
  currentProject: CircuitProject,
  expected: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin },
  pinById: ReadonlyMap<string, Pin>,
): boolean {
  if (
    currentSymbol.x !== expected.symbol.x ||
    currentSymbol.y !== expected.symbol.y ||
    currentSymbol.rotation !== expected.symbol.rotation
  ) {
    return false;
  }
  const currentPin = currentSymbol.circuit.kind === "pin"
    ? pinById.get(currentSymbol.circuit.circuitId)
    : undefined;
  const currentSerialized = JSON.stringify(encodeSymbolToNative(currentSymbol, currentProject, currentPin));
  const expectedSerialized = JSON.stringify(encodeSymbolToNative(expected.symbol, currentProject, expected.pin));
  return currentSerialized === expectedSerialized;
}

function isTextNoteUnmodified(currentNote: TextNote, expectedNote: TextNote): boolean {
  return JSON.stringify(serializeTextNote(currentNote)) === JSON.stringify(serializeTextNote(expectedNote));
}

function isLogicalCircuitUnmodified(
  currentLc: LogicalCircuit,
  expected: NonNullable<Extract<CircuitDelta, { type: "updateProperty" }>["afterLogicalCircuit"]>,
): boolean {
  if (
    currentLc.name !== expected.name ||
    currentLc.notation !== expected.notation ||
    currentLc.category !== expected.category ||
    currentLc.note !== expected.note
  ) {
    return false;
  }
  if (expected.circuitShape !== undefined && currentLc.circuitShape !== expected.circuitShape) {
    return false;
  }
  if (expected.showLabelAbove !== undefined && Boolean(currentLc.showLabelAbove) !== Boolean(expected.showLabelAbove)) {
    return false;
  }
  if (expected.displayMargin !== undefined && (currentLc.displayMargin ?? "none") !== expected.displayMargin) {
    return false;
  }
  if (expected.exportToHDL !== undefined && Boolean(currentLc.exportToHDL) !== Boolean(expected.exportToHDL)) {
    return false;
  }
  if (expected.validators !== undefined && (currentLc.validators ?? "") !== expected.validators) {
    return false;
  }
  if (expected.pinOrder) {
    const actualById = new Map(currentLc.logicalPins.map((p) => [p.pinId, p.index]));
    for (const item of expected.pinOrder) {
      if (actualById.get(item.pinId) !== item.index) {
        return false;
      }
    }
  }
  return true;
}

function verifyNoAttachedForeignWires(
  targetCircuit: LogicalCircuit,
  removedSymbols: { symbol: CircuitSymbol }[],
  removingWireIds: ReadonlySet<string>,
  direction: "undo" | "redo",
): CollabUndoPreparation | null {
  if (removedSymbols.length === 0) {
    return null;
  }
  const jamKeys = new Set<string>();
  for (const entry of removedSymbols) {
    for (const jam of entry.symbol.jams) {
      jamKeys.add(gridPointKey(jam.absolutePoint));
    }
  }
  for (const wire of targetCircuit.wires) {
    if (removingWireIds.has(wire.wireId)) {
      continue;
    }
    if (jamKeys.has(gridPointKey(wire.point1)) || jamKeys.has(gridPointKey(wire.point2))) {
      return buildConflict(
        direction,
        "wire-topology-conflict",
        "Ein Bauteil wurde zwischenzeitlich von anderen Teilnehmern neu verdrahtet.",
        targetCircuit.logicalCircuitId,
        [wire.wireId],
      );
    }
  }
  return null;
}

function verifyWireChangesState(
  wireChanges: WireEndpointUpdate[] | undefined,
  removedWires: Wire[] | undefined,
  targetCircuit: LogicalCircuit,
  project: CircuitProject,
  expectAfterState: boolean,
  direction: "undo" | "redo",
): CollabUndoPreparation | null {
  const wireById = new Map(targetCircuit.wires.map((w) => [w.wireId, w]));
  const allProjectWireIds = new Set(project.wires.map((w) => w.wireId));

  for (const change of wireChanges ?? []) {
    const current = wireById.get(change.wireId);
    if (!current) {
      return buildConflict(
        direction,
        "wire-topology-conflict",
        "Betroffene Leitung wurde zwischenzeitlich von einem anderen Teilnehmer verändert oder entfernt.",
        targetCircuit.logicalCircuitId,
        [change.wireId],
      );
    }
    const expected = expectAfterState ? change.after : change.before;
    if (!doWireEndpointsMatch(current, expected)) {
      return buildConflict(
        direction,
        "wire-topology-conflict",
        "Betroffene Leitung wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
        targetCircuit.logicalCircuitId,
        [change.wireId],
      );
    }
  }

  for (const removed of removedWires ?? []) {
    if (expectAfterState) {
      if (allProjectWireIds.has(removed.wireId)) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine früher zusammengefasste Leitung existiert bereits wieder.",
          targetCircuit.logicalCircuitId,
          [removed.wireId],
        );
      }
      const sameSegmentExists = targetCircuit.wires.some((w) => doWireEndpointsMatch(w, removed));
      if (sameSegmentExists) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Die Zielposition einer wiederherzustellenden Leitung ist inzwischen belegt.",
          targetCircuit.logicalCircuitId,
          [removed.wireId],
        );
      }
    } else {
      const current = wireById.get(removed.wireId);
      if (!current || !doWireEndpointsMatch(current, removed)) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine zu entfernende Leitung wurde zwischenzeitlich verändert oder bereits gelöscht.",
          targetCircuit.logicalCircuitId,
          [removed.wireId],
        );
      }
    }
  }

  return null;
}

// Verwaltet pro Teilnehmer und Schaltplan den benutzerbezogenen Undo-/Redo-Verlauf inkl. Sicherheitsprüfungen
class CollabUndoManager {
  readonly #stacks = new Map<string, CircuitUndoStack>();

  recordLocalDelta(
    delta: CircuitDelta,
    projectAfterDelta: CircuitProject,
    options?: {
      mutationId?: string;
      importedSubCircuits?: readonly LogicalCircuit[];
    },
  ): void {
    const circuitId = delta.logicalCircuitId;
    const existing = this.#stacks.get(circuitId) ?? { entries: [], pointer: 0 };
    const truncated = existing.entries.slice(0, existing.pointer);

    let moveSymbolPositions: PositionTransition[] | undefined;
    let moveNotePositions: PositionTransition[] | undefined;
    if (delta.type === "move") {
      if (delta.symbolPositions) {
        moveSymbolPositions = delta.symbolPositions.map((p) => ({
          id: p.symbolId,
          before: p.before,
          after: p.after,
        }));
      } else {
        const afterSymMap = new Map(projectAfterDelta.circuitSymbols.map((s) => [s.circuitSymbolId, s]));
        moveSymbolPositions = delta.symbolIds
          .map((symId) => {
            const sym = afterSymMap.get(symId);
            if (!sym) {
              return null;
            }
            return {
              id: symId,
              before: { x: sym.x - delta.dx, y: sym.y - delta.dy },
              after: { x: sym.x, y: sym.y },
            };
          })
          .filter((entry): entry is PositionTransition => entry !== null);
      }

      if (delta.textNotePositions) {
        moveNotePositions = delta.textNotePositions.map((p) => ({
          id: p.textNoteId,
          before: p.before,
          after: p.after,
        }));
      } else {
        const afterNoteMap = new Map(projectAfterDelta.textNotes.map((n) => [n.textNoteId, n]));
        moveNotePositions = delta.textNoteIds
          .map((noteId) => {
            const note = afterNoteMap.get(noteId);
            if (!note) {
              return null;
            }
            return {
              id: noteId,
              before: { x: note.x - delta.dx, y: note.y - delta.dy },
              after: { x: note.x, y: note.y },
            };
          })
          .filter((entry): entry is PositionTransition => entry !== null);
      }
    }

    const entry: CollabUndoEntry = {
      id: generateEntityUuid(),
      mutationId: options?.mutationId,
      logicalCircuitId: circuitId,
      delta,
      importedSubCircuits: options?.importedSubCircuits ? [...options.importedSubCircuits] : undefined,
      moveSymbolPositions,
      moveNotePositions,
    };

    const nextEntries = [...truncated, entry];
    this.#stacks.set(circuitId, {
      entries: nextEntries,
      pointer: nextEntries.length,
    });
  }

  // Entfernt einen noch unbestätigten Optimistic-Eintrag bei Host-Ablehnung sauber aus dem Verlauf
  discardByMutationId(mutationId: string): boolean {
    for (const [circuitId, stack] of Array.from(this.#stacks.entries())) {
      const idx = stack.entries.findIndex((entry) => entry.mutationId === mutationId);
      if (idx === -1) {
        continue;
      }
      const nextEntries = stack.entries.filter((_, index) => index !== idx);
      const nextPointer = idx < stack.pointer ? Math.max(0, stack.pointer - 1) : Math.min(stack.pointer, nextEntries.length);
      this.#stacks.set(circuitId, { entries: nextEntries, pointer: nextPointer });
      return true;
    }
    return false;
  }

  getHistoryState(logicalCircuitId: string): HistoryState {
    const stack = this.#stacks.get(logicalCircuitId);
    if (!stack) {
      return createEmptyHistoryState();
    }
    return {
      entries: stack.entries.map((entry) => entry.delta),
      pointer: stack.pointer,
    };
  }

  canUndo(logicalCircuitId: string): boolean {
    const stack = this.#stacks.get(logicalCircuitId);
    return Boolean(stack && stack.pointer > 0);
  }

  canRedo(logicalCircuitId: string): boolean {
    const stack = this.#stacks.get(logicalCircuitId);
    return Boolean(stack && stack.pointer < stack.entries.length);
  }

  commitPointer(logicalCircuitId: string, pointer: number): void {
    const stack = this.#stacks.get(logicalCircuitId);
    if (!stack) {
      return;
    }
    stack.pointer = Math.max(0, Math.min(pointer, stack.entries.length));
  }

  restorePointer(logicalCircuitId: string, previousPointer: number): void {
    this.commitPointer(logicalCircuitId, previousPointer);
  }

  clearCircuit(logicalCircuitId: string): void {
    this.#stacks.delete(logicalCircuitId);
  }

  clearAll(): void {
    this.#stacks.clear();
  }

  prepareUndo(
    logicalCircuitId: string,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const stack = this.#stacks.get(logicalCircuitId);
    if (!stack || stack.pointer <= 0) {
      return { ok: false, direction: "undo", conflict: null };
    }
    const previousPointer = stack.pointer;
    const nextPointer = stack.pointer - 1;
    const entry = stack.entries[nextPointer];
    return this.#prepareEntryTransition(entry, "undo", previousPointer, nextPointer, currentProject, foreignLocks);
  }

  prepareRedo(
    logicalCircuitId: string,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const stack = this.#stacks.get(logicalCircuitId);
    if (!stack || stack.pointer >= stack.entries.length) {
      return { ok: false, direction: "redo", conflict: null };
    }
    const previousPointer = stack.pointer;
    const nextPointer = stack.pointer + 1;
    const entry = stack.entries[previousPointer];
    return this.#prepareEntryTransition(entry, "redo", previousPointer, nextPointer, currentProject, foreignLocks);
  }

  #prepareEntryTransition(
    entry: CollabUndoEntry,
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const delta = entry.delta;
    const targetCircuit = currentProject.logicalCircuits.find(
      (lc) => lc.logicalCircuitId === delta.logicalCircuitId,
    );
    if (!targetCircuit) {
      return buildConflict(
        direction,
        "circuit-missing",
        "Der betroffene Schaltplan existiert nicht mehr.",
        delta.logicalCircuitId,
        [delta.logicalCircuitId],
      );
    }

    switch (delta.type) {
      case "add":
        return direction === "undo"
          ? this.#prepareRemoveEntities(
            entry,
            delta.symbols,
            delta.textNotes,
            delta.wires ?? [],
            direction,
            previousPointer,
            nextPointer,
            targetCircuit,
            currentProject,
            foreignLocks,
          )
          : this.#prepareRestoreEntities(
            entry,
            delta.symbols,
            delta.textNotes,
            delta.wires ?? [],
            direction,
            previousPointer,
            nextPointer,
            targetCircuit,
            currentProject,
          );

      case "remove":
        return direction === "undo"
          ? this.#prepareRestoreEntities(
            entry,
            delta.symbols,
            delta.textNotes,
            delta.wires ?? [],
            direction,
            previousPointer,
            nextPointer,
            targetCircuit,
            currentProject,
          )
          : this.#prepareRemoveEntities(
            entry,
            delta.symbols,
            delta.textNotes,
            delta.wires ?? [],
            direction,
            previousPointer,
            nextPointer,
            targetCircuit,
            currentProject,
            foreignLocks,
          );

      case "move":
        return this.#prepareMoveTransition(
          entry,
          delta,
          direction,
          previousPointer,
          nextPointer,
          targetCircuit,
          currentProject,
          foreignLocks,
        );

      case "rotate":
        return this.#prepareRotateTransition(
          entry,
          delta,
          direction,
          previousPointer,
          nextPointer,
          targetCircuit,
          currentProject,
          foreignLocks,
        );

      case "updateProperty":
        return this.#prepareUpdatePropertyTransition(
          entry,
          delta,
          direction,
          previousPointer,
          nextPointer,
          targetCircuit,
          currentProject,
          foreignLocks,
        );

      case "wireBatch":
        return this.#prepareWireBatchTransition(
          entry,
          delta,
          direction,
          previousPointer,
          nextPointer,
          targetCircuit,
          currentProject,
        );
    }
  }

  #prepareRemoveEntities(
    entry: CollabUndoEntry,
    symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[],
    textNotes: TextNote[],
    wires: Wire[],
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const lockTargets = [
      ...symbols.map((s) => ({ targetType: "symbol" as const, targetId: s.symbol.circuitSymbolId })),
      ...textNotes.map((n) => ({ targetType: "textNote" as const, targetId: n.textNoteId })),
    ];
    const lockConflict = findForeignLockConflict(lockTargets, foreignLocks, direction, targetCircuit.logicalCircuitId);
    if (lockConflict) {
      return { ok: false, direction, conflict: lockConflict };
    }

    const symById = new Map(targetCircuit.circuitSymbols.map((s) => [s.circuitSymbolId, s]));
    const noteById = new Map(targetCircuit.textNotes.map((n) => [n.textNoteId, n]));
    const wireById = new Map(targetCircuit.wires.map((w) => [w.wireId, w]));
    const pinById = new Map(currentProject.pins.map((p) => [p.pinId, p]));

    for (const symEntry of symbols) {
      const currentSym = symById.get(symEntry.symbol.circuitSymbolId);
      if (!currentSym) {
        return buildConflict(
          direction,
          "entity-missing",
          "Ein betroffenes Bauteil wurde zwischenzeitlich von einem anderen Teilnehmer entfernt.",
          targetCircuit.logicalCircuitId,
          [symEntry.symbol.circuitSymbolId],
        );
      }
      if (!isSymbolUnmodified(currentSym, currentProject, symEntry, pinById)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Ein betroffenes Bauteil wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
          targetCircuit.logicalCircuitId,
          [symEntry.symbol.circuitSymbolId],
        );
      }
    }

    for (const noteEntry of textNotes) {
      const currentNote = noteById.get(noteEntry.textNoteId);
      if (!currentNote) {
        return buildConflict(
          direction,
          "entity-missing",
          "Eine betroffene Textnotiz wurde zwischenzeitlich von einem anderen Teilnehmer entfernt.",
          targetCircuit.logicalCircuitId,
          [noteEntry.textNoteId],
        );
      }
      if (!isTextNoteUnmodified(currentNote, noteEntry)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Eine betroffene Textnotiz wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
          targetCircuit.logicalCircuitId,
          [noteEntry.textNoteId],
        );
      }
    }

    for (const wireEntry of wires) {
      const currentWire = wireById.get(wireEntry.wireId);
      if (!currentWire) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine betroffene Leitung wurde zwischenzeitlich entfernt.",
          targetCircuit.logicalCircuitId,
          [wireEntry.wireId],
        );
      }
      if (!doWireEndpointsMatch(currentWire, wireEntry)) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine betroffene Leitung wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
          targetCircuit.logicalCircuitId,
          [wireEntry.wireId],
        );
      }
    }

    const removingWireIds = new Set(wires.map((w) => w.wireId));
    const attachedConflict = verifyNoAttachedForeignWires(targetCircuit, symbols, removingWireIds, direction);
    if (attachedConflict) {
      return attachedConflict;
    }

    const nextProject = direction === "undo"
      ? applyDeltaBackward(currentProject, entry.delta)
      : applyDeltaForward(currentProject, entry.delta);

    const mutation: CollabSerializedMutation = {
      type: "remove",
      logicalCircuitId: targetCircuit.logicalCircuitId,
      symbolIds: symbols.map((s) => s.symbol.circuitSymbolId),
      textNoteIds: textNotes.map((n) => n.textNoteId),
      wireIds: wires.map((w) => w.wireId),
    };

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta: entry.delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }

  #prepareRestoreEntities(
    entry: CollabUndoEntry,
    symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[],
    textNotes: TextNote[],
    wires: Wire[],
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
  ): CollabUndoPreparation {
    const existingSymbolIds = new Set(currentProject.circuitSymbols.map((s) => s.circuitSymbolId));
    const existingNoteIds = new Set(currentProject.textNotes.map((n) => n.textNoteId));
    const existingWireIds = new Set(currentProject.wires.map((w) => w.wireId));
    const existingCircuitIds = new Set(currentProject.logicalCircuits.map((lc) => lc.logicalCircuitId));
    const importedCircuitIds = new Set((entry.importedSubCircuits ?? []).map((lc) => lc.logicalCircuitId));

    for (const symEntry of symbols) {
      if (existingSymbolIds.has(symEntry.symbol.circuitSymbolId)) {
        return buildConflict(
          direction,
          "id-collision",
          "Das wiederherzustellende Bauteil existiert bereits wieder im Projekt.",
          targetCircuit.logicalCircuitId,
          [symEntry.symbol.circuitSymbolId],
        );
      }
      if (
        symEntry.circuit.kind === "logicalCircuit" &&
        !existingCircuitIds.has(symEntry.circuit.circuitId) &&
        !importedCircuitIds.has(symEntry.circuit.circuitId)
      ) {
        return buildConflict(
          direction,
          "circuit-missing",
          "Eine referenzierte Sub-Schaltung existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [symEntry.circuit.circuitId],
        );
      }
    }

    for (const noteEntry of textNotes) {
      if (existingNoteIds.has(noteEntry.textNoteId)) {
        return buildConflict(
          direction,
          "id-collision",
          "Die wiederherzustellende Textnotiz existiert bereits wieder im Projekt.",
          targetCircuit.logicalCircuitId,
          [noteEntry.textNoteId],
        );
      }
    }

    for (const wireEntry of wires) {
      if (existingWireIds.has(wireEntry.wireId)) {
        return buildConflict(
          direction,
          "id-collision",
          "Eine wiederherzustellende Leitung existiert bereits wieder.",
          targetCircuit.logicalCircuitId,
          [wireEntry.wireId],
        );
      }
      if (targetCircuit.wires.some((w) => doWireEndpointsMatch(w, wireEntry))) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Ein Leitungssegment kollidiert mit zwischenzeitlich gezeichneten Leitungen.",
          targetCircuit.logicalCircuitId,
          [wireEntry.wireId],
        );
      }
    }

    const spatialConflict = checkSpatialOverlapForSymbols(
      symbols.map((s) => ({ symbol: s.symbol, circuit: s.circuit })),
      targetCircuit,
      new Set(),
      direction,
    );
    if (spatialConflict) {
      return { ok: false, direction, conflict: spatialConflict };
    }

    const nextProject = direction === "undo"
      ? applyDeltaBackward(currentProject, entry.delta)
      : applyDeltaForward(currentProject, entry.delta);

    const addDelta: Extract<CircuitDelta, { type: "add" }> = {
      type: "add",
      logicalCircuitId: targetCircuit.logicalCircuitId,
      symbols,
      textNotes,
      wires,
    };
    const mutation = encodeCircuitDeltaToMutation(addDelta, nextProject, {
      importedSubCircuits: entry.importedSubCircuits,
    });

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta: entry.delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }

  #prepareMoveTransition(
    entry: CollabUndoEntry,
    delta: Extract<CircuitDelta, { type: "move" }>,
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const lockTargets = [
      ...delta.symbolIds.map((id) => ({ targetType: "symbol" as const, targetId: id })),
      ...delta.textNoteIds.map((id) => ({ targetType: "textNote" as const, targetId: id })),
    ];
    const lockConflict = findForeignLockConflict(lockTargets, foreignLocks, direction, targetCircuit.logicalCircuitId);
    if (lockConflict) {
      return { ok: false, direction, conflict: lockConflict };
    }

    const isUndo = direction === "undo";
    const symById = new Map(targetCircuit.circuitSymbols.map((s) => [s.circuitSymbolId, s]));
    const noteById = new Map(targetCircuit.textNotes.map((n) => [n.textNoteId, n]));
    const symTransitions = entry.moveSymbolPositions ?? delta.symbolPositions?.map((p) => ({
      id: p.symbolId,
      before: p.before,
      after: p.after,
    }));
    const noteTransitions = entry.moveNotePositions ?? delta.textNotePositions?.map((p) => ({
      id: p.textNoteId,
      before: p.before,
      after: p.after,
    }));

    const candidateSymbols: { symbol: CircuitSymbol; circuit: Circuit }[] = [];
    for (const symbolId of delta.symbolIds) {
      const currentSym = symById.get(symbolId);
      if (!currentSym) {
        return buildConflict(
          direction,
          "entity-missing",
          "Ein verschobenes Bauteil existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [symbolId],
        );
      }
      const pos = symTransitions?.find((p) => p.id === symbolId);
      const expectedFrom = pos ? (isUndo ? pos.after : pos.before) : undefined;
      const targetPos = pos
        ? (isUndo ? pos.before : pos.after)
        : {
          x: currentSym.x + (isUndo ? -delta.dx : delta.dx),
          y: currentSym.y + (isUndo ? -delta.dy : delta.dy),
        };
      if (expectedFrom && (currentSym.x !== expectedFrom.x || currentSym.y !== expectedFrom.y)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Das Bauteil wurde zwischenzeitlich von einem anderen Teilnehmer weiterverschoben.",
          targetCircuit.logicalCircuitId,
          [symbolId],
        );
      }
      candidateSymbols.push({
        circuit: currentSym.circuit,
        symbol: createCircuitSymbol(
          currentSym.circuit,
          currentSym.logicalCircuitId,
          targetPos.x,
          targetPos.y,
          currentSym.rotation,
          currentSym.circuitSymbolId,
        ),
      });
    }

    for (const noteId of delta.textNoteIds) {
      const currentNote = noteById.get(noteId);
      if (!currentNote) {
        return buildConflict(
          direction,
          "entity-missing",
          "Eine verschobene Textnotiz existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [noteId],
        );
      }
      const pos = noteTransitions?.find((p) => p.id === noteId);
      const expectedFrom = pos ? (isUndo ? pos.after : pos.before) : undefined;
      if (expectedFrom && (currentNote.x !== expectedFrom.x || currentNote.y !== expectedFrom.y)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Die Textnotiz wurde zwischenzeitlich von einem anderen Teilnehmer weiterverschoben.",
          targetCircuit.logicalCircuitId,
          [noteId],
        );
      }
    }

    const wireConflict = verifyWireChangesState(
      delta.wireChanges,
      delta.removedWires,
      targetCircuit,
      currentProject,
      isUndo,
      direction,
    );
    if (wireConflict) {
      return wireConflict;
    }

    const spatialConflict = checkSpatialOverlapForSymbols(
      candidateSymbols,
      targetCircuit,
      new Set(delta.symbolIds),
      direction,
    );
    if (spatialConflict) {
      return { ok: false, direction, conflict: spatialConflict };
    }

    const nextProject = isUndo
      ? applyDeltaBackward(currentProject, delta)
      : applyDeltaForward(currentProject, delta);

    const mutation: CollabSerializedMutation = isUndo
      ? {
        type: "move",
        logicalCircuitId: delta.logicalCircuitId,
        symbolIds: [...delta.symbolIds],
        textNoteIds: [...delta.textNoteIds],
        ...(delta.wireIds ? { wireIds: [...delta.wireIds] } : {}),
        dx: -delta.dx,
        dy: -delta.dy,
        ...(delta.symbolPositions
          ? {
            symbolPositions: delta.symbolPositions.map((p) => ({
              symbolId: p.symbolId,
              before: p.after,
              after: p.before,
            })),
          }
          : {}),
        ...(delta.textNotePositions
          ? {
            textNotePositions: delta.textNotePositions.map((p) => ({
              textNoteId: p.textNoteId,
              before: p.after,
              after: p.before,
            })),
          }
          : {}),
        ...(delta.wireChanges ? { wireChanges: flipWireChanges(delta.wireChanges) } : {}),
        ...(delta.removedWires && delta.removedWires.length > 0
          ? { addedWires: serializeWiresList(delta.removedWires) }
          : {}),
      }
      : encodeCircuitDeltaToMutation(delta, nextProject);

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }

  #prepareRotateTransition(
    entry: CollabUndoEntry,
    delta: Extract<CircuitDelta, { type: "rotate" }>,
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const lockTargets = [
      ...delta.symbols.map((s) => ({ targetType: "symbol" as const, targetId: s.symbolId })),
      ...delta.textNotes.map((n) => ({ targetType: "textNote" as const, targetId: n.textNoteId })),
    ];
    const lockConflict = findForeignLockConflict(lockTargets, foreignLocks, direction, targetCircuit.logicalCircuitId);
    if (lockConflict) {
      return { ok: false, direction, conflict: lockConflict };
    }

    const isUndo = direction === "undo";
    const symById = new Map(targetCircuit.circuitSymbols.map((s) => [s.circuitSymbolId, s]));
    const noteById = new Map(targetCircuit.textNotes.map((n) => [n.textNoteId, n]));
    const candidateSymbols: { symbol: CircuitSymbol; circuit: Circuit }[] = [];

    for (const symEntry of delta.symbols) {
      const currentSym = symById.get(symEntry.symbolId);
      if (!currentSym) {
        return buildConflict(
          direction,
          "entity-missing",
          "Ein rotiertes Bauteil existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [symEntry.symbolId],
        );
      }
      const expectedFrom = isUndo ? symEntry.after : symEntry.before;
      const targetTo = isUndo ? symEntry.before : symEntry.after;
      if (
        currentSym.x !== expectedFrom.x ||
        currentSym.y !== expectedFrom.y ||
        currentSym.rotation !== expectedFrom.rotation
      ) {
        return buildConflict(
          direction,
          "entity-modified",
          "Das Bauteil wurde zwischenzeitlich von einem anderen Teilnehmer verändert oder bewegt.",
          targetCircuit.logicalCircuitId,
          [symEntry.symbolId],
        );
      }
      candidateSymbols.push({
        circuit: currentSym.circuit,
        symbol: createCircuitSymbol(
          currentSym.circuit,
          currentSym.logicalCircuitId,
          targetTo.x,
          targetTo.y,
          targetTo.rotation,
          currentSym.circuitSymbolId,
        ),
      });
    }

    for (const noteEntry of delta.textNotes) {
      const currentNote = noteById.get(noteEntry.textNoteId);
      if (!currentNote) {
        return buildConflict(
          direction,
          "entity-missing",
          "Eine rotierte Textnotiz existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [noteEntry.textNoteId],
        );
      }
      const expectedFrom = isUndo ? noteEntry.after : noteEntry.before;
      if (
        currentNote.x !== expectedFrom.x ||
        currentNote.y !== expectedFrom.y ||
        currentNote.rotation !== expectedFrom.rotation
      ) {
        return buildConflict(
          direction,
          "entity-modified",
          "Die Textnotiz wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
          targetCircuit.logicalCircuitId,
          [noteEntry.textNoteId],
        );
      }
    }

    const wireConflict = verifyWireChangesState(
      delta.wireChanges,
      delta.removedWires,
      targetCircuit,
      currentProject,
      isUndo,
      direction,
    );
    if (wireConflict) {
      return wireConflict;
    }

    const spatialConflict = checkSpatialOverlapForSymbols(
      candidateSymbols,
      targetCircuit,
      new Set(delta.symbols.map((s) => s.symbolId)),
      direction,
    );
    if (spatialConflict) {
      return { ok: false, direction, conflict: spatialConflict };
    }

    const nextProject = isUndo
      ? applyDeltaBackward(currentProject, delta)
      : applyDeltaForward(currentProject, delta);

    const mutation: CollabSerializedMutation = isUndo
      ? {
        type: "rotate",
        logicalCircuitId: delta.logicalCircuitId,
        direction: flipDirection(delta.direction),
        symbols: delta.symbols.map((s) => ({
          symbolId: s.symbolId,
          before: s.after,
          after: s.before,
        })),
        textNotes: delta.textNotes.map((n) => ({
          textNoteId: n.textNoteId,
          before: n.after,
          after: n.before,
        })),
        ...(delta.wireChanges ? { wireChanges: flipWireChanges(delta.wireChanges) } : {}),
        ...(delta.removedWires && delta.removedWires.length > 0
          ? { addedWires: serializeWiresList(delta.removedWires) }
          : {}),
      }
      : encodeCircuitDeltaToMutation(delta, nextProject);

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }

  #prepareUpdatePropertyTransition(
    entry: CollabUndoEntry,
    delta: Extract<CircuitDelta, { type: "updateProperty" }>,
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
    foreignLocks: ReadonlyArray<CollabSoftLockEntry>,
  ): CollabUndoPreparation {
    const lockConflict = findForeignLockConflict(
      [{ targetType: delta.targetType, targetId: delta.targetId }],
      foreignLocks,
      direction,
      targetCircuit.logicalCircuitId,
    );
    if (lockConflict) {
      return { ok: false, direction, conflict: lockConflict };
    }

    const isUndo = direction === "undo";

    if (delta.targetType === "symbol") {
      const expectedFrom = isUndo ? delta.afterSymbol : delta.beforeSymbol;
      const targetTo = isUndo ? delta.beforeSymbol : delta.afterSymbol;
      const currentSym = targetCircuit.circuitSymbols.find((s) => s.circuitSymbolId === delta.targetId);
      if (!currentSym || !expectedFrom || !targetTo) {
        return buildConflict(
          direction,
          "entity-missing",
          "Das geänderte Bauteil existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [delta.targetId],
        );
      }
      const pinById = new Map(currentProject.pins.map((p) => [p.pinId, p]));
      if (!isSymbolUnmodified(currentSym, currentProject, expectedFrom, pinById)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Die Eigenschaften oder Position dieses Bauteils wurden zwischenzeitlich von einem anderen Teilnehmer geändert.",
          targetCircuit.logicalCircuitId,
          [delta.targetId],
        );
      }

      const wireConflict = verifyWireChangesState(
        delta.wireChanges,
        delta.removedWires,
        targetCircuit,
        currentProject,
        isUndo,
        direction,
      );
      if (wireConflict) {
        return wireConflict;
      }

      const spatialConflict = checkSpatialOverlapForSymbols(
        [{ symbol: targetTo.symbol, circuit: targetTo.circuit }],
        targetCircuit,
        new Set([delta.targetId]),
        direction,
      );
      if (spatialConflict) {
        return { ok: false, direction, conflict: spatialConflict };
      }

      const nextProject = isUndo
        ? applyDeltaBackward(currentProject, delta)
        : applyDeltaForward(currentProject, delta);

      const serialized = encodeSymbolToNative(targetTo.symbol, nextProject, targetTo.pin);
      const mutation: CollabSerializedMutation = {
        type: "updateProperty",
        logicalCircuitId: delta.logicalCircuitId,
        targetType: "symbol",
        targetId: delta.targetId,
        ...(serialized.pin ? { afterPin: serialized.pin } : {}),
        ...(serialized.element ? { afterElement: serialized.element } : {}),
        ...(delta.wireChanges
          ? { wireChanges: isUndo ? flipWireChanges(delta.wireChanges) : delta.wireChanges }
          : {}),
        ...(isUndo && delta.removedWires && delta.removedWires.length > 0
          ? { addedWires: serializeWiresList(delta.removedWires) }
          : !isUndo && delta.removedWires && delta.removedWires.length > 0
            ? { removedWireIds: delta.removedWires.map((w) => w.wireId) }
            : {}),
      };

      return {
        ok: true,
        direction,
        entryId: entry.id,
        delta,
        mutation,
        nextProject,
        nextPointer,
        previousPointer,
      };
    }

    if (delta.targetType === "textNote") {
      const expectedFrom = isUndo ? delta.afterTextNote : delta.beforeTextNote;
      const targetTo = isUndo ? delta.beforeTextNote : delta.afterTextNote;
      const currentNote = targetCircuit.textNotes.find((n) => n.textNoteId === delta.targetId);
      if (!currentNote || !expectedFrom || !targetTo) {
        return buildConflict(
          direction,
          "entity-missing",
          "Die geänderte Textnotiz existiert nicht mehr.",
          targetCircuit.logicalCircuitId,
          [delta.targetId],
        );
      }
      if (!isTextNoteUnmodified(currentNote, expectedFrom)) {
        return buildConflict(
          direction,
          "entity-modified",
          "Die Textnotiz wurde zwischenzeitlich von einem anderen Teilnehmer verändert.",
          targetCircuit.logicalCircuitId,
          [delta.targetId],
        );
      }

      const nextProject = isUndo
        ? applyDeltaBackward(currentProject, delta)
        : applyDeltaForward(currentProject, delta);

      const mutation: CollabSerializedMutation = {
        type: "updateProperty",
        logicalCircuitId: delta.logicalCircuitId,
        targetType: "textNote",
        targetId: delta.targetId,
        afterTextNote: serializeTextNote(targetTo),
      };

      return {
        ok: true,
        direction,
        entryId: entry.id,
        delta,
        mutation,
        nextProject,
        nextPointer,
        previousPointer,
      };
    }

    const expectedFromLc = isUndo ? delta.afterLogicalCircuit : delta.beforeLogicalCircuit;
    const targetToLc = isUndo ? delta.beforeLogicalCircuit : delta.afterLogicalCircuit;
    if (!expectedFromLc || !targetToLc) {
      return buildConflict(
        direction,
        "entity-missing",
        "Schaltplan-Eigenschafts-Snapshot ist unvollständig.",
        targetCircuit.logicalCircuitId,
        [delta.targetId],
      );
    }
    if (!isLogicalCircuitUnmodified(targetCircuit, expectedFromLc)) {
      return buildConflict(
        direction,
        "entity-modified",
        "Die Schaltplan-Eigenschaften wurden zwischenzeitlich von einem anderen Teilnehmer geändert.",
        targetCircuit.logicalCircuitId,
        [delta.targetId],
      );
    }

    const nextProject = isUndo
      ? applyDeltaBackward(currentProject, delta)
      : applyDeltaForward(currentProject, delta);

    const mutation: CollabSerializedMutation = {
      type: "updateProperty",
      logicalCircuitId: delta.logicalCircuitId,
      targetType: "logicalCircuit",
      targetId: delta.targetId,
      afterLogicalCircuit: targetToLc,
    };

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }

  #prepareWireBatchTransition(
    entry: CollabUndoEntry,
    delta: Extract<CircuitDelta, { type: "wireBatch" }>,
    direction: "undo" | "redo",
    previousPointer: number,
    nextPointer: number,
    targetCircuit: LogicalCircuit,
    currentProject: CircuitProject,
  ): CollabUndoPreparation {
    const isUndo = direction === "undo";
    const wireById = new Map(targetCircuit.wires.map((w) => [w.wireId, w]));
    const allProjectWireIds = new Set(currentProject.wires.map((w) => w.wireId));

    const wiresToRemove = isUndo ? delta.addedWires : delta.removedWires;
    const wiresToRestore = isUndo ? delta.removedWires : delta.addedWires;

    for (const w of wiresToRemove) {
      const current = wireById.get(w.wireId);
      if (!current || !doWireEndpointsMatch(current, w)) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine zu ändernde Leitung wurde zwischenzeitlich verändert oder entfernt.",
          targetCircuit.logicalCircuitId,
          [w.wireId],
        );
      }
    }

    for (const upd of delta.updatedWires) {
      const current = wireById.get(upd.wireId);
      const expected = isUndo ? upd.after : upd.before;
      if (!current || !doWireEndpointsMatch(current, expected)) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Eine verschobene/aufgeteilte Leitung wurde zwischenzeitlich verändert.",
          targetCircuit.logicalCircuitId,
          [upd.wireId],
        );
      }
    }

    const removingIds = new Set(wiresToRemove.map((w) => w.wireId));
    for (const restoreWire of wiresToRestore) {
      if (allProjectWireIds.has(restoreWire.wireId)) {
        return buildConflict(
          direction,
          "id-collision",
          "Eine wiederherzustellende Leitung existiert bereits wieder.",
          targetCircuit.logicalCircuitId,
          [restoreWire.wireId],
        );
      }
      const segmentOccupied = targetCircuit.wires.some(
        (existing) => !removingIds.has(existing.wireId) && doWireEndpointsMatch(existing, restoreWire),
      );
      if (segmentOccupied) {
        return buildConflict(
          direction,
          "wire-topology-conflict",
          "Das Leitungssegment wird inzwischen anderweitig verwendet.",
          targetCircuit.logicalCircuitId,
          [restoreWire.wireId],
        );
      }
    }

    const nextProject = isUndo
      ? applyDeltaBackward(currentProject, delta)
      : applyDeltaForward(currentProject, delta);

    const mutation: CollabSerializedMutation = isUndo
      ? {
        type: "wireBatch",
        logicalCircuitId: delta.logicalCircuitId,
        addedWires: serializeWiresList(delta.removedWires) ?? [],
        removedWireIds: delta.addedWires.map((w) => w.wireId),
        updatedWires: flipWireChanges(delta.updatedWires) ?? [],
      }
      : encodeCircuitDeltaToMutation(delta, nextProject);

    return {
      ok: true,
      direction,
      entryId: entry.id,
      delta,
      mutation,
      nextProject,
      nextPointer,
      previousPointer,
    };
  }
}

export default CollabUndoManager;
