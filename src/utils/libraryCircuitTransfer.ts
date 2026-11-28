import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type {
  NativeCircuitElement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeTextNote,
  NativeWire,
} from "../types/storage/nativeProjectFormat";

import {
  rebuildImportedProjectLayout,
  wouldCreateCircuitCycle,
} from "./circuitLayout";
import { computeNativeCircuitStructureHashes } from "./libraryCircuitHash";
import { buildCircuitProjectFromNativeCircuits } from "./storage/nativeProjectReader";
import { serializeLogicalCircuitToNative } from "./storage/nativeProjectWriter";

export type TransferToLibraryOptions = {
  rootMetadataOverrides?: {
    name?: string;
    notation?: string;
    category?: string;
    note?: string;
  };
  deduplicateRoot?: boolean;
};

export type TransferToLibraryResult = {
  logicalCircuits: NativeLogicalCircuit[];
  rootCircuitId: string;
  addedCircuits: NativeLogicalCircuit[];
  reusedCircuitIds: string[];
};

export type TransferToProjectOptions = {
  targetParentCircuitId?: string;
  deduplicateRoot?: boolean;
};

export type TransferToProjectResult = {
  project: CircuitProject;
  rootCircuitId: string;
  addedCircuits: LogicalCircuit[];
  reusedCircuitIds: string[];
};

// Erzeugt eine neue, kollisionsfreie UUID für geklonte Schaltungsentitäten
export function generateFreshLibraryUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Löst Namenskonflikte bei gleichnamigen Schaltungen automatisch über Suffixe " (2)", " (3)", ...
export function resolveUniqueCircuitName(
  candidateName: string,
  existingNames: Iterable<string>,
): string {
  const usedLower = new Set<string>();
  for (const name of existingNames) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed !== "") {
      usedLower.add(trimmed);
    }
  }

  const trimmedCandidate = candidateName.trim();
  const baseName = trimmedCandidate !== "" ? trimmedCandidate : "Circuit";
  if (!usedLower.has(baseName.toLowerCase())) {
    return baseName;
  }

  const numberedMatch = baseName.match(/^(.*)\s+\((\d+)\)$/);
  const stem = numberedMatch ? numberedMatch[1].trim() : baseName;
  let counter = numberedMatch ? Number.parseInt(numberedMatch[2], 10) + 1 : 2;
  if (!Number.isFinite(counter) || counter < 2) {
    counter = 2;
  }

  while (usedLower.has(`${stem} (${counter})`.toLowerCase())) {
    counter += 1;
  }

  return `${stem} (${counter})`;
}

// Sammelt eine Schaltung samt transitiver Sub-Schaltungen in Post-Order (Abhängigkeiten zuerst)
export function collectTransitiveCircuitsPostOrder(
  allCircuits: readonly NativeLogicalCircuit[],
  rootCircuitId: string,
): NativeLogicalCircuit[] {
  const byId = new Map(allCircuits.map((lc) => [lc.logicalCircuitId, lc]));
  const result: NativeLogicalCircuit[] = [];
  const state = new Map<string, 0 | 1 | 2>();

  const visit = (circuitId: string): void => {
    const currentState = state.get(circuitId) ?? 0;
    if (currentState === 2) {
      return;
    }
    if (currentState === 1) {
      throw new Error(`Zyklische Subschaltungs-Referenz erkannt (${circuitId}).`);
    }

    const lc = byId.get(circuitId);
    if (!lc) {
      throw new Error(`Schaltplan "${circuitId}" wurde nicht gefunden.`);
    }

    state.set(circuitId, 1);
    for (const elem of lc.elements) {
      if (elem.kind === "subCircuit") {
        visit(elem.logicalCircuitId);
      }
    }
    state.set(circuitId, 2);
    result.push(lc);
  };

  visit(rootCircuitId);
  return result;
}

// Klont eine NativeLogicalCircuit-Definition tief mit komplett neu generierten UUIDs
export function cloneNativeLogicalCircuitWithFreshIds(
  source: NativeLogicalCircuit,
  subCircuitIdMapping: ReadonlyMap<string, string>,
  targetCircuitId: string,
  resolvedName: string,
): NativeLogicalCircuit {
  const pins: NativePinElement[] = source.pins.map((pin) => ({
    ...pin,
    symbolId: generateFreshLibraryUuid(),
    pinId: generateFreshLibraryUuid(),
  }));

  const elements: NativeCircuitElement[] = source.elements.map((elem) => {
    const symbolId = generateFreshLibraryUuid();
    if (elem.kind === "gate") {
      return {
        ...elem,
        symbolId,
      };
    }
    if (elem.kind === "subCircuit") {
      return {
        ...elem,
        symbolId,
        logicalCircuitId: subCircuitIdMapping.get(elem.logicalCircuitId) ?? elem.logicalCircuitId,
      };
    }

    const oldComponentId = elem.componentId;
    const componentId = generateFreshLibraryUuid();
    if (elem.kind === "circuitProbe") {
      const normalizedName = elem.name.trim().toLowerCase() === oldComponentId.toLowerCase()
        ? ""
        : elem.name;
      return {
        ...elem,
        symbolId,
        componentId,
        name: normalizedName,
      };
    }

    return {
      ...elem,
      symbolId,
      componentId,
    };
  });

  const wires: NativeWire[] = source.wires.map((wire) => ({
    ...wire,
    wireId: generateFreshLibraryUuid(),
  }));

  const textNotes: NativeTextNote[] = source.textNotes.map((note) => ({
    ...note,
    textNoteId: generateFreshLibraryUuid(),
    lineHeights: note.lineHeights ? [...note.lineHeights] : null,
  }));

  return {
    ...source,
    logicalCircuitId: targetCircuitId,
    name: resolvedName,
    pins,
    elements,
    wires,
    textNotes,
  };
}

// Extrahiert eine Projektschaltung samt aller transitiven Sub-Schaltungen in Post-Order als NativeLogicalCircuit[]
export function extractProjectCircuitsAsNative(
  project: CircuitProject,
  rootCircuitId: string,
  rootMetadataOverrides?: TransferToLibraryOptions["rootMetadataOverrides"],
): NativeLogicalCircuit[] {
  const allNative = project.logicalCircuits.map((lc) => serializeLogicalCircuitToNative(lc, project));
  const postOrder = collectTransitiveCircuitsPostOrder(allNative, rootCircuitId);

  if (!rootMetadataOverrides) {
    return postOrder;
  }

  return postOrder.map((lc) => {
    if (lc.logicalCircuitId !== rootCircuitId) {
      return lc;
    }
    return {
      ...lc,
      ...(rootMetadataOverrides.name !== undefined ? { name: rootMetadataOverrides.name } : {}),
      ...(rootMetadataOverrides.notation !== undefined ? { notation: rootMetadataOverrides.notation } : {}),
      ...(rootMetadataOverrides.category !== undefined ? { category: rootMetadataOverrides.category } : {}),
      ...(rootMetadataOverrides.note !== undefined ? { note: rootMetadataOverrides.note } : {}),
    };
  });
}

// Übernimmt eine Projektschaltung in die Bibliothek (mit Hash-Abgleich zur Vermeidung von Subschaltungs-Duplikaten)
export function transferProjectCircuitToLibrary(
  project: CircuitProject,
  sourceCircuitId: string,
  existingLibraryCircuits: readonly NativeLogicalCircuit[],
  options?: TransferToLibraryOptions,
): TransferToLibraryResult {
  const extracted = extractProjectCircuitsAsNative(
    project,
    sourceCircuitId,
    options?.rootMetadataOverrides,
  );
  const libraryHashes = computeNativeCircuitStructureHashes(existingLibraryCircuits);
  const extractedHashes = computeNativeCircuitStructureHashes(extracted);

  const libraryByHash = new Map<string, NativeLogicalCircuit>();
  for (const libLc of existingLibraryCircuits) {
    const hash = libraryHashes.get(libLc.logicalCircuitId);
    if (hash && !libraryByHash.has(hash)) {
      libraryByHash.set(hash, libLc);
    }
  }

  const usedNames = existingLibraryCircuits.map((lc) => lc.name);
  const idMapping = new Map<string, string>();
  const addedCircuits: NativeLogicalCircuit[] = [];
  const reusedCircuitIds: string[] = [];
  const deduplicateRoot = options?.deduplicateRoot !== false;

  for (const srcLc of extracted) {
    const srcHash = extractedHashes.get(srcLc.logicalCircuitId)!;
    const isRoot = srcLc.logicalCircuitId === sourceCircuitId;
    const existingMatch = (!isRoot || deduplicateRoot) ? libraryByHash.get(srcHash) : undefined;

    if (existingMatch) {
      idMapping.set(srcLc.logicalCircuitId, existingMatch.logicalCircuitId);
      reusedCircuitIds.push(existingMatch.logicalCircuitId);
      continue;
    }

    const freshId = generateFreshLibraryUuid();
    const resolvedName = resolveUniqueCircuitName(srcLc.name, usedNames);
    usedNames.push(resolvedName);

    const cloned = cloneNativeLogicalCircuitWithFreshIds(srcLc, idMapping, freshId, resolvedName);
    idMapping.set(srcLc.logicalCircuitId, freshId);
    addedCircuits.push(cloned);
    if (!libraryByHash.has(srcHash)) {
      libraryByHash.set(srcHash, cloned);
    }
  }

  return {
    logicalCircuits: [...existingLibraryCircuits, ...addedCircuits],
    rootCircuitId: idMapping.get(sourceCircuitId)!,
    addedCircuits,
    reusedCircuitIds,
  };
}

function appendUniqueById<T>(existing: T[], incoming: T[], getId: (item: T) => string): T[] {
  if (incoming.length === 0) {
    return existing;
  }
  const seen = new Set(existing.map(getId));
  const filtered = incoming.filter((item) => !seen.has(getId(item)));
  return filtered.length > 0 ? [...existing, ...filtered] : existing;
}

// Übernimmt eine Bibliotheksschaltung als unabhängige Kopie ins Projekt (mit Hash-Abgleich auf Sub-Schaltungen)
export function transferLibraryCircuitToProject(
  targetProject: CircuitProject,
  libraryCircuits: readonly NativeLogicalCircuit[],
  rootLibraryCircuitId: string,
  options?: TransferToProjectOptions,
): TransferToProjectResult {
  const extracted = collectTransitiveCircuitsPostOrder(libraryCircuits, rootLibraryCircuitId);
  const libraryHashes = computeNativeCircuitStructureHashes(extracted);

  const projectNative = targetProject.logicalCircuits.map((lc) =>
    serializeLogicalCircuitToNative(lc, targetProject),
  );
  const projectHashes = computeNativeCircuitStructureHashes(projectNative);
  const projectLcById = new Map(
    targetProject.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );

  const projectByHash = new Map<string, LogicalCircuit[]>();
  for (const lc of targetProject.logicalCircuits) {
    const hash = projectHashes.get(lc.logicalCircuitId);
    if (!hash) {
      continue;
    }
    const list = projectByHash.get(hash) ?? [];
    list.push(lc);
    projectByHash.set(hash, list);
  }

  const usedNames = targetProject.logicalCircuits.map((lc) => lc.name);
  const idMapping = new Map<string, string>();
  const clonedNativeCircuits: NativeLogicalCircuit[] = [];
  const reusedCircuitIds: string[] = [];
  const deduplicateRoot = options?.deduplicateRoot !== false;
  const targetParentId = options?.targetParentCircuitId;

  const canReuseProjectCircuit = (candidate: LogicalCircuit): boolean => {
    if (!targetParentId) {
      return true;
    }
    return (
      candidate.logicalCircuitId !== targetParentId &&
      !wouldCreateCircuitCycle(targetParentId, candidate.logicalCircuitId, targetProject)
    );
  };

  for (const srcLc of extracted) {
    const srcHash = libraryHashes.get(srcLc.logicalCircuitId)!;
    const isRoot = srcLc.logicalCircuitId === rootLibraryCircuitId;

    const candidates = (!isRoot || deduplicateRoot) ? (projectByHash.get(srcHash) ?? []) : [];
    const reusable = candidates.find(canReuseProjectCircuit);

    if (reusable) {
      idMapping.set(srcLc.logicalCircuitId, reusable.logicalCircuitId);
      reusedCircuitIds.push(reusable.logicalCircuitId);
      continue;
    }

    const freshId = generateFreshLibraryUuid();
    const resolvedName = resolveUniqueCircuitName(srcLc.name, usedNames);
    usedNames.push(resolvedName);

    const cloned = cloneNativeLogicalCircuitWithFreshIds(srcLc, idMapping, freshId, resolvedName);
    idMapping.set(srcLc.logicalCircuitId, freshId);
    clonedNativeCircuits.push(cloned);
  }

  const mappedRootId = idMapping.get(rootLibraryCircuitId)!;

  if (clonedNativeCircuits.length === 0) {
    return {
      project: targetProject,
      rootCircuitId: mappedRootId,
      addedCircuits: [],
      reusedCircuitIds,
    };
  }

  const hydrated = buildCircuitProjectFromNativeCircuits(
    targetProject.project,
    targetProject.collapsedCategories,
    clonedNativeCircuits,
    projectLcById,
  );

  const nextCircuits = new Map(targetProject.circuits);
  for (const [id, circuit] of hydrated.circuits.entries()) {
    nextCircuits.set(id, circuit);
  }
  const nextGates = new Map(targetProject.gates);
  for (const [id, gate] of hydrated.gates.entries()) {
    nextGates.set(id, gate);
  }

  const mergedProject = rebuildImportedProjectLayout({
    ...targetProject,
    circuits: nextCircuits,
    gates: nextGates,
    logicalCircuits: [...targetProject.logicalCircuits, ...hydrated.logicalCircuits],
    pins: appendUniqueById(targetProject.pins, hydrated.pins, (p) => p.pinId),
    constants: appendUniqueById(targetProject.constants, hydrated.constants, (c) => c.constantId),
    circuitButtons: appendUniqueById(
      targetProject.circuitButtons,
      hydrated.circuitButtons,
      (b) => b.circuitButtonId,
    ),
    circuitProbes: appendUniqueById(
      targetProject.circuitProbes,
      hydrated.circuitProbes,
      (p) => p.circuitProbeId,
    ),
    splitters: appendUniqueById(targetProject.splitters, hydrated.splitters, (s) => s.splitterId),
    memories: appendUniqueById(targetProject.memories, hydrated.memories, (m) => m.memoryId),
    ledMatrices: appendUniqueById(targetProject.ledMatrices, hydrated.ledMatrices, (m) => m.ledMatrixId),
    sensors: appendUniqueById(targetProject.sensors, hydrated.sensors, (s) => s.sensorId),
    sounds: appendUniqueById(targetProject.sounds, hydrated.sounds, (s) => s.soundId),
    synthesizers: appendUniqueById(
      targetProject.synthesizers,
      hydrated.synthesizers,
      (s) => s.synthesizerId,
    ),
    graphicsArrays: appendUniqueById(
      targetProject.graphicsArrays,
      hydrated.graphicsArrays,
      (g) => g.graphicsArrayId,
    ),
    circuitSymbols: appendUniqueById(
      targetProject.circuitSymbols,
      hydrated.circuitSymbols,
      (s) => s.circuitSymbolId,
    ),
    wires: appendUniqueById(targetProject.wires, hydrated.wires, (w) => w.wireId),
    textNotes: appendUniqueById(targetProject.textNotes, hydrated.textNotes, (n) => n.textNoteId),
  });

  const addedIdSet = new Set(hydrated.logicalCircuits.map((lc) => lc.logicalCircuitId));
  const addedCircuits = mergedProject.logicalCircuits.filter((lc) => addedIdSet.has(lc.logicalCircuitId));

  return {
    project: mergedProject,
    rootCircuitId: mappedRootId,
    addedCircuits,
    reusedCircuitIds,
  };
}
