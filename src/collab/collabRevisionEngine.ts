import type CircuitProject from "../types/circuit/circuitProject";
import type {
  CollabCatchupResponsePayload,
  CollabCircuitCommitPayload,
  CollabHostHandoverStatePayload,
  CollabMutationRejectedPayload,
  CollabMutationRequestPayload,
  CollabProjectSnapshotPayload,
  CollabRevisionEntry,
} from "../types/collab/modelSyncMessage";

import { generateEntityUuid } from "../utils/entityId";

import {
  applySerializedMutationToProject,
  encodeProjectSnapshot,
  extractMutationHighlightIds,
  extractMutationScope,
  validateSerializedMutation,
} from "./collabModelCodec";

export const DEFAULT_COLLAB_REVISION_RING_BUFFER_SIZE = 200;
const MAX_SEEN_MUTATION_CACHE_SIZE = 1000;

export type CollabRevisionEngineOptions = {
  initialProject: CircuitProject;
  initialRevision?: number;
  epochId?: string;
  maxRingBufferSize?: number;
  now?: () => number;
};

export type CollabMutationSubmitResult =
  | {
    accepted: true;
    deduplicated: boolean;
    commit: CollabCircuitCommitPayload;
    project: CircuitProject;
  }
  | {
    accepted: false;
    rejection: CollabMutationRejectedPayload;
  };

function collectExistingEntityIds(project: CircuitProject): Set<string> {
  const ids = new Set<string>();
  for (const lc of project.logicalCircuits) {
    ids.add(lc.logicalCircuitId);
  }
  for (const pin of project.pins) {
    ids.add(pin.pinId);
  }
  for (const btn of project.circuitButtons) {
    ids.add(btn.circuitButtonId);
  }
  for (const constant of project.constants) {
    ids.add(constant.constantId);
  }
  for (const probe of project.circuitProbes) {
    ids.add(probe.circuitProbeId);
  }
  for (const splitter of project.splitters) {
    ids.add(splitter.splitterId);
  }
  for (const mem of project.memories) {
    ids.add(mem.memoryId);
  }
  for (const matrix of project.ledMatrices) {
    ids.add(matrix.ledMatrixId);
  }
  for (const sensor of project.sensors) {
    ids.add(sensor.sensorId);
  }
  for (const sound of project.sounds) {
    ids.add(sound.soundId);
  }
  for (const synth of project.synthesizers) {
    ids.add(synth.synthesizerId);
  }
  for (const ga of project.graphicsArrays) {
    ids.add(ga.graphicsArrayId);
  }
  for (const sym of project.circuitSymbols) {
    ids.add(sym.circuitSymbolId);
  }
  for (const wire of project.wires) {
    ids.add(wire.wireId);
  }
  for (const note of project.textNotes) {
    ids.add(note.textNoteId);
  }
  return ids;
}

function reject(
  mutationId: string,
  code: CollabMutationRejectedPayload["code"],
  message: string,
  hostRevision: number,
  requiresResync: boolean,
  conflictingEntityIds?: string[],
): CollabMutationSubmitResult {
  return {
    accepted: false,
    rejection: {
      mutationId,
      code,
      message,
      hostRevision,
      requiresResync,
      ...(conflictingEntityIds && conflictingEntityIds.length > 0 ? { conflictingEntityIds } : {}),
    },
  };
}

// Host-autoritative Revisions-Engine mit Ringpuffer (Catch-up), idempotenter Deduplizierung & Konfliktprüfung
class CollabRevisionEngine {
  readonly #maxRingBufferSize: number;
  readonly #now: () => number;
  readonly #seenMutations = new Map<string, CollabCircuitCommitPayload>();

  #project: CircuitProject;
  #revision: number;
  #epochId: string;
  #ringBuffer: CollabRevisionEntry[] = [];
  #isQuiesced = false;

  constructor(options: CollabRevisionEngineOptions) {
    this.#project = options.initialProject;
    this.#revision = Math.max(0, Math.floor(options.initialRevision ?? 0));
    this.#epochId = options.epochId?.trim() || generateEntityUuid();
    this.#maxRingBufferSize = Math.max(
      1,
      Math.floor(options.maxRingBufferSize ?? DEFAULT_COLLAB_REVISION_RING_BUFFER_SIZE),
    );
    this.#now = options.now ?? (() => Date.now());
  }

  getProject(): CircuitProject {
    return this.#project;
  }

  getRevision(): number {
    return this.#revision;
  }

  getEpochId(): string {
    return this.#epochId;
  }

  isQuiesced(): boolean {
    return this.#isQuiesced;
  }

  setQuiesced(quiesced: boolean): void {
    this.#isQuiesced = quiesced;
  }

  getRingBuffer(): CollabRevisionEntry[] {
    return [...this.#ringBuffer];
  }

  createSnapshotPayload(
    reason: CollabProjectSnapshotPayload["reason"],
  ): CollabProjectSnapshotPayload {
    return {
      revision: this.#revision,
      epochId: this.#epochId,
      reason,
      document: encodeProjectSnapshot(this.#project),
    };
  }

  // Setzt das autoritative Projekt (z. B. bei Neu/Demo/Import durch den Host) mit frischer Epoche zurück
  resetWithProject(
    nextProject: CircuitProject,
    options?: { startRevision?: number; epochId?: string },
  ): CollabProjectSnapshotPayload {
    this.#project = nextProject;
    this.#revision = options?.startRevision !== undefined
      ? Math.max(0, Math.floor(options.startRevision))
      : this.#revision + 1;
    this.#epochId = options?.epochId?.trim() || generateEntityUuid();
    this.#ringBuffer = [];
    this.#seenMutations.clear();
    this.#isQuiesced = false;
    return this.createSnapshotPayload("project-switch");
  }

  // Übernimmt Projektstand, letzte Revision und Ringpuffer konsistent nach einem Host-Handover
  restoreFromHandover(
    project: CircuitProject,
    handover: Pick<CollabHostHandoverStatePayload, "revision" | "epochId" | "ringBuffer">,
  ): void {
    this.#project = project;
    this.#revision = Math.max(0, Math.floor(handover.revision));
    this.#epochId = handover.epochId.trim() || generateEntityUuid();
    this.#ringBuffer = handover.ringBuffer
      .filter((entry) => entry.revision <= this.#revision)
      .sort((a, b) => a.revision - b.revision)
      .slice(-this.#maxRingBufferSize);
    this.#seenMutations.clear();
    for (const entry of this.#ringBuffer) {
      this.#seenMutations.set(entry.mutationId, entry);
    }
    this.#isQuiesced = false;
  }

  // Liefert fehlende Revisionen für kurzzeitig unterbrochene Peers oder signalisiert Full-Snapshot-Fallback
  getCatchupSince(fromRevision: number): CollabCatchupResponsePayload {
    const normalizedFrom = Math.floor(fromRevision);
    if (!Number.isFinite(normalizedFrom) || normalizedFrom < 0 || normalizedFrom > this.#revision) {
      return {
        fromRevision: normalizedFrom,
        toRevision: this.#revision,
        entries: [],
        requiresFullSnapshot: true,
      };
    }

    if (normalizedFrom === this.#revision) {
      return {
        fromRevision: normalizedFrom,
        toRevision: this.#revision,
        entries: [],
        requiresFullSnapshot: false,
      };
    }

    if (this.#ringBuffer.length === 0) {
      return {
        fromRevision: normalizedFrom,
        toRevision: this.#revision,
        entries: [],
        requiresFullSnapshot: true,
      };
    }

    const oldestBufferedRevision = this.#ringBuffer[0].revision;
    if (normalizedFrom < oldestBufferedRevision - 1) {
      return {
        fromRevision: normalizedFrom,
        toRevision: this.#revision,
        entries: [],
        requiresFullSnapshot: true,
      };
    }

    const missingEntries = this.#ringBuffer.filter((entry) => entry.revision > normalizedFrom);
    return {
      fromRevision: normalizedFrom,
      toRevision: this.#revision,
      entries: missingEntries,
      requiresFullSnapshot: false,
    };
  }

  // Prüft und committet eine Mutation mit monotoner Revision oder lehnt sie deterministisch ab
  submitMutation(
    request: CollabMutationRequestPayload,
    authorPeerId: string,
  ): CollabMutationSubmitResult {
    const existingCommit = this.#seenMutations.get(request.mutationId);
    if (existingCommit) {
      return {
        accepted: true,
        deduplicated: true,
        commit: existingCommit,
        project: this.#project,
      };
    }

    if (this.#isQuiesced) {
      return reject(
        request.mutationId,
        "quiesced",
        "Die Session befindet sich in der Host-Übertragung (Quiesce). Bitte kurz warten.",
        this.#revision,
        false,
      );
    }

    if (!validateSerializedMutation(request.mutation)) {
      return reject(
        request.mutationId,
        "invalid-mutation",
        "Die übermittelte Schaltungs-Mutation ist ungültig oder unvollständig.",
        this.#revision,
        false,
      );
    }

    if (request.baseRevision < 0 || request.baseRevision > this.#revision) {
      return reject(
        request.mutationId,
        "stale-revision",
        `Die Basis-Revision ${request.baseRevision} ist gegenüber Host-Revision ${this.#revision} ungültig.`,
        this.#revision,
        true,
      );
    }

    const incomingScope = extractMutationScope(request.mutation);

    // Defensiver ID-Eindeutigkeits-Guard ohne Remapping
    const existingIds = collectExistingEntityIds(this.#project);
    const collidingIds = incomingScope.createdIds.filter((id) => existingIds.has(id));
    if (collidingIds.length > 0) {
      return reject(
        request.mutationId,
        "id-collision",
        `Mindestens eine neu erzeugte ID existiert bereits im Projekt (${collidingIds.join(", ")}).`,
        this.#revision,
        true,
        collidingIds,
      );
    }

    // Konfliktprüfung gegen zwischenzeitliche Commits bei veralteter baseRevision
    if (request.baseRevision < this.#revision) {
      if (this.#ringBuffer.length === 0 || request.baseRevision < this.#ringBuffer[0].revision - 1) {
        return reject(
          request.mutationId,
          "stale-revision",
          `Basis-Revision ${request.baseRevision} liegt außerhalb des Revisions-Ringpuffers.`,
          this.#revision,
          true,
        );
      }

      const conflictingIds = this.#findConflictingEntitiesSince(request.baseRevision, incomingScope);
      if (conflictingIds !== null) {
        return reject(
          request.mutationId,
          "conflict",
          "Konflikt mit zwischenzeitlichen Änderungen anderer Teilnehmer.",
          this.#revision,
          true,
          conflictingIds,
        );
      }
    }

    // Ziel- und Invariantenprüfung auf dem aktuellen Projektstand
    const targetError = this.#validateTargetsOnCurrentProject(request.mutation);
    if (targetError) {
      return reject(
        request.mutationId,
        targetError.code,
        targetError.message,
        this.#revision,
        true,
        targetError.conflictingEntityIds,
      );
    }

    let nextProject: CircuitProject;
    try {
      nextProject = applySerializedMutationToProject(this.#project, request.mutation);
    } catch (error) {
      return reject(
        request.mutationId,
        "conflict",
        error instanceof Error ? error.message : String(error),
        this.#revision,
        true,
      );
    }

    this.#project = nextProject;
    this.#revision += 1;
    const commit: CollabCircuitCommitPayload = {
      revision: this.#revision,
      mutationId: request.mutationId,
      authorPeerId,
      timestamp: this.#now(),
      origin: request.origin ?? "user",
      mutation: request.mutation,
      highlightIds: request.highlightIds ?? extractMutationHighlightIds(request.mutation),
    };

    this.#appendToRingBuffer(commit);
    this.#rememberSeenMutation(commit);

    return {
      accepted: true,
      deduplicated: false,
      commit,
      project: this.#project,
    };
  }

  #findConflictingEntitiesSince(
    baseRevision: number,
    incomingScope: ReturnType<typeof extractMutationScope>,
  ): string[] | null {
    const incomingEntitySet = new Set(incomingScope.touchedEntityIds);
    const incomingCircuitSet = new Set(incomingScope.touchedLogicalCircuitIds);
    const incomingDeleteSet = new Set(incomingScope.deletedLogicalCircuitIds);
    const incomingWireTopologySet = new Set(incomingScope.mutatesWireTopologyCircuits);

    for (const entry of this.#ringBuffer) {
      if (entry.revision <= baseRevision) {
        continue;
      }
      const priorScope = extractMutationScope(entry.mutation);

      if (incomingScope.mutatesProjectProperties && priorScope.mutatesProjectProperties) {
        return [];
      }

      for (const deletedCircuitId of priorScope.deletedLogicalCircuitIds) {
        if (incomingCircuitSet.has(deletedCircuitId)) {
          return [deletedCircuitId];
        }
      }
      for (const lcId of priorScope.touchedLogicalCircuitIds) {
        if (incomingDeleteSet.has(lcId)) {
          return [lcId];
        }
      }

      const overlap: string[] = [];
      for (const id of priorScope.touchedEntityIds) {
        if (incomingEntitySet.has(id)) {
          overlap.push(id);
        }
      }
      if (overlap.length > 0) {
        return overlap;
      }

      for (const wireCircuitId of priorScope.mutatesWireTopologyCircuits) {
        if (incomingWireTopologySet.has(wireCircuitId)) {
          return [wireCircuitId];
        }
      }
    }

    return null;
  }

  #validateTargetsOnCurrentProject(
    mutation: CollabCircuitCommitPayload["mutation"],
  ): {
    code: CollabMutationRejectedPayload["code"];
    message: string;
    conflictingEntityIds?: string[];
  } | null {
    const lcIds = new Set(this.#project.logicalCircuits.map((lc) => lc.logicalCircuitId));
    const symbolIds = new Set(this.#project.circuitSymbols.map((s) => s.circuitSymbolId));
    const noteIds = new Set(this.#project.textNotes.map((n) => n.textNoteId));
    const wireIds = new Set(this.#project.wires.map((w) => w.wireId));
    const memoryIds = new Set(this.#project.memories.map((m) => m.memoryId));

    const checkCircuitExists = (circuitId: string) => {
      if (!lcIds.has(circuitId)) {
        return {
          code: "missing-target" as const,
          message: `Ziel-Schaltplan "${circuitId}" existiert nicht mehr.`,
          conflictingEntityIds: [circuitId],
        };
      }
      return null;
    };

    switch (mutation.type) {
      case "add": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        const importedIds = new Set((mutation.importedSubCircuits ?? []).map((lc) => lc.logicalCircuitId));
        for (const elem of mutation.entities.elements) {
          if (elem.kind === "subCircuit" && !lcIds.has(elem.logicalCircuitId) && !importedIds.has(elem.logicalCircuitId)) {
            return {
              code: "missing-target",
              message: `Referenzierte Sub-Schaltung "${elem.logicalCircuitId}" existiert nicht mehr.`,
              conflictingEntityIds: [elem.logicalCircuitId],
            };
          }
        }
        return null;
      }

      case "remove": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        for (const id of mutation.symbolIds) {
          if (!symbolIds.has(id)) {
            return { code: "missing-target", message: `Symbol "${id}" wurde bereits entfernt.`, conflictingEntityIds: [id] };
          }
        }
        for (const id of mutation.textNoteIds) {
          if (!noteIds.has(id)) {
            return { code: "missing-target", message: `Textnotiz "${id}" wurde bereits entfernt.`, conflictingEntityIds: [id] };
          }
        }
        for (const id of mutation.wireIds) {
          if (!wireIds.has(id)) {
            return { code: "missing-target", message: `Leitung "${id}" wurde bereits entfernt.`, conflictingEntityIds: [id] };
          }
        }
        return null;
      }

      case "move": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        for (const id of mutation.symbolIds) {
          if (!symbolIds.has(id)) {
            return { code: "missing-target", message: `Symbol "${id}" existiert nicht mehr.`, conflictingEntityIds: [id] };
          }
        }
        for (const id of mutation.textNoteIds) {
          if (!noteIds.has(id)) {
            return { code: "missing-target", message: `Textnotiz "${id}" existiert nicht mehr.`, conflictingEntityIds: [id] };
          }
        }
        return null;
      }

      case "rotate": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        for (const entry of mutation.symbols) {
          if (!symbolIds.has(entry.symbolId)) {
            return {
              code: "missing-target",
              message: `Symbol "${entry.symbolId}" existiert nicht mehr.`,
              conflictingEntityIds: [entry.symbolId],
            };
          }
        }
        for (const entry of mutation.textNotes) {
          if (!noteIds.has(entry.textNoteId)) {
            return {
              code: "missing-target",
              message: `Textnotiz "${entry.textNoteId}" existiert nicht mehr.`,
              conflictingEntityIds: [entry.textNoteId],
            };
          }
        }
        return null;
      }

      case "wireBatch": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        for (const id of mutation.removedWireIds) {
          if (!wireIds.has(id)) {
            return { code: "missing-target", message: `Leitung "${id}" existiert nicht mehr.`, conflictingEntityIds: [id] };
          }
        }
        for (const upd of mutation.updatedWires) {
          if (!wireIds.has(upd.wireId)) {
            return {
              code: "missing-target",
              message: `Leitung "${upd.wireId}" existiert nicht mehr.`,
              conflictingEntityIds: [upd.wireId],
            };
          }
        }
        return null;
      }

      case "updateProperty": {
        const missingCircuit = checkCircuitExists(mutation.logicalCircuitId);
        if (missingCircuit) {
          return missingCircuit;
        }
        if (mutation.targetType === "symbol" && !symbolIds.has(mutation.targetId)) {
          return {
            code: "missing-target",
            message: `Symbol "${mutation.targetId}" existiert nicht mehr.`,
            conflictingEntityIds: [mutation.targetId],
          };
        }
        if (mutation.targetType === "textNote" && !noteIds.has(mutation.targetId)) {
          return {
            code: "missing-target",
            message: `Textnotiz "${mutation.targetId}" existiert nicht mehr.`,
            conflictingEntityIds: [mutation.targetId],
          };
        }
        if (mutation.targetType === "logicalCircuit" && !lcIds.has(mutation.targetId)) {
          return {
            code: "missing-target",
            message: `Schaltplan "${mutation.targetId}" existiert nicht mehr.`,
            conflictingEntityIds: [mutation.targetId],
          };
        }
        return null;
      }

      case "deleteCircuits": {
        for (const id of mutation.circuitIds) {
          if (!lcIds.has(id)) {
            return {
              code: "missing-target",
              message: `Schaltplan "${id}" wurde bereits entfernt.`,
              conflictingEntityIds: [id],
            };
          }
        }
        const targetSet = new Set(mutation.circuitIds);
        const remaining = this.#project.logicalCircuits.filter(
          (lc) => !targetSet.has(lc.logicalCircuitId),
        );
        if (remaining.length === 0) {
          return {
            code: "conflict",
            message: "Mindestens ein Schaltplan muss im Projekt verbleiben.",
            conflictingEntityIds: mutation.circuitIds,
          };
        }
        for (const surviving of remaining) {
          for (const sym of surviving.circuitSymbols) {
            if (sym.circuit.kind === "logicalCircuit" && targetSet.has(sym.circuit.circuitId)) {
              return {
                code: "conflict",
                message: `Schaltung "${sym.circuit.circuitId}" wird noch als Sub-Schaltung in "${surviving.name}" verwendet.`,
                conflictingEntityIds: [sym.circuit.circuitId, sym.circuitSymbolId],
              };
            }
          }
        }
        return null;
      }

      case "importLibraryCircuit": {
        if (mutation.targetCircuitId) {
          return checkCircuitExists(mutation.targetCircuitId);
        }
        return null;
      }

      case "updateMemoryData": {
        for (const entry of mutation.updates) {
          if (!memoryIds.has(entry.memoryId)) {
            return {
              code: "missing-target",
              message: `Speicherbaustein "${entry.memoryId}" existiert nicht mehr.`,
              conflictingEntityIds: [entry.memoryId],
            };
          }
        }
        return null;
      }

      case "createCircuits":
      case "updateProjectProperties":
        return null;
    }
  }

  #appendToRingBuffer(commit: CollabCircuitCommitPayload): void {
    this.#ringBuffer.push(commit);
    if (this.#ringBuffer.length > this.#maxRingBufferSize) {
      this.#ringBuffer = this.#ringBuffer.slice(
        this.#ringBuffer.length - this.#maxRingBufferSize,
      );
    }
  }

  #rememberSeenMutation(commit: CollabCircuitCommitPayload): void {
    this.#seenMutations.set(commit.mutationId, commit);
    if (this.#seenMutations.size > MAX_SEEN_MUTATION_CACHE_SIZE) {
      const oldestKey = this.#seenMutations.keys().next().value;
      if (oldestKey !== undefined) {
        this.#seenMutations.delete(oldestKey);
      }
    }
  }
}

export default CollabRevisionEngine;
