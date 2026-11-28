import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type Pin from "../../types/circuit/pin";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type TextNote from "../../types/circuit/textNote";
import type Wire from "../../types/circuit/wire";
import type WireEndpointUpdate from "../../types/circuit/wireEndpointUpdate";
import type CircuitDelta from "../../types/history/circuitDelta";
import type HistoryState from "../../types/history/historyState";

import { createCircuitSymbol, syncProjectLogicalCircuits } from "../../utils/circuitLayout";
import { recalculateProjectWires, updateWireEndpoints } from "../../utils/wireUtils";

// Erzeugt einen leeren Undo-/Redo-Stack
export function createEmptyHistoryState(): HistoryState {
  return {
    entries: [],
    pointer: 0,
  };
}

// Hängt eine neue Delta-Aktion an und kappt eventuelle Redo-Einträge ab der aktuellen Position
export function pushDelta(history: HistoryState, delta: CircuitDelta): HistoryState {
  const truncated = history.entries.slice(0, history.pointer);
  const nextEntries = [...truncated, delta];
  return {
    entries: nextEntries,
    pointer: nextEntries.length,
  };
}

// Fügt Symbole, Textnotizen und Leitungen inklusive ihrer Circuit-Entitäten in das Projekt ein
export function insertEntities(
  project: CircuitProject,
  logicalCircuitId: string,
  symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[],
  textNotes: TextNote[],
  wires: Wire[] = [],
): CircuitProject {
  const nextCircuits = new Map(project.circuits);
  const nextGates = new Map(project.gates);
  const nextPins = [...project.pins];
  const nextButtons = [...project.circuitButtons];
  const nextConstants = [...project.constants];
  const nextProbes = [...project.circuitProbes];
  const nextLedMatrices = [...project.ledMatrices];
  const nextSplitters = [...project.splitters];
  const nextMemories = [...project.memories];
  const nextSensors = [...project.sensors];
  const nextSounds = [...project.sounds];
  const nextSynthesizers = [...project.synthesizers];
  const nextGraphicsArrays = [...project.graphicsArrays];

  const addedSymbols: CircuitSymbol[] = [];
  const addedPinsForCircuit: Pin[] = [];

  for (const item of symbols) {
    const { symbol, circuit, pin } = item;
    addedSymbols.push(symbol);
    nextCircuits.set(circuit.circuitId, circuit);

    if (circuit.kind === "gate") {
      const gate = circuit as Gate;
      nextGates.set(gate.gateId, gate);
    } else if (circuit.kind === "circuitButton") {
      const btn = circuit as CircuitButton;
      if (!nextButtons.some((b) => b.circuitButtonId === btn.circuitButtonId)) {
        nextButtons.push(btn);
      }
    } else if (circuit.kind === "constant") {
      const constant = circuit as Constant;
      if (!nextConstants.some((c) => c.constantId === constant.constantId)) {
        nextConstants.push(constant);
      }
    } else if (circuit.kind === "circuitProbe") {
      const probe = circuit as CircuitProbe;
      if (!nextProbes.some((p) => p.circuitProbeId === probe.circuitProbeId)) {
        nextProbes.push(probe);
      }
    } else if (circuit.kind === "ledMatrix") {
      const matrix = circuit as LedMatrix;
      if (!nextLedMatrices.some((m) => m.ledMatrixId === matrix.ledMatrixId)) {
        nextLedMatrices.push(matrix);
      }
    } else if (circuit.kind === "splitter") {
      const splitter = circuit as Splitter;
      if (!nextSplitters.some((s) => s.splitterId === splitter.splitterId)) {
        nextSplitters.push(splitter);
      }
    } else if (circuit.kind === "memory") {
      const mem = circuit as Memory;
      if (!nextMemories.some((m) => m.memoryId === mem.memoryId)) {
        nextMemories.push(mem);
      }
    } else if (circuit.kind === "sensor") {
      const sensor = circuit as Sensor;
      if (!nextSensors.some((s) => s.sensorId === sensor.sensorId)) {
        nextSensors.push(sensor);
      }
    } else if (circuit.kind === "sound") {
      const sound = circuit as Sound;
      if (!nextSounds.some((s) => s.soundId === sound.soundId)) {
        nextSounds.push(sound);
      }
    } else if (circuit.kind === "synthesizer") {
      const synth = circuit as Synthesizer;
      if (!nextSynthesizers.some((s) => s.synthesizerId === synth.synthesizerId)) {
        nextSynthesizers.push(synth);
      }
    } else if (circuit.kind === "graphicsArray") {
      const ga = circuit as GraphicsArray;
      if (!nextGraphicsArrays.some((g) => g.graphicsArrayId === ga.graphicsArrayId)) {
        nextGraphicsArrays.push(ga);
      }
    } else if (circuit.kind === "pin" && pin) {
      if (!nextPins.some((p) => p.pinId === pin.pinId)) {
        nextPins.push(pin);
      }
      addedPinsForCircuit.push(pin);
    }
  }

  const existingSymbolIds = new Set(project.circuitSymbols.map((s) => s.circuitSymbolId));
  const uniqueAddedSymbols = addedSymbols.filter((s) => !existingSymbolIds.has(s.circuitSymbolId));

  const existingNoteIds = new Set(project.textNotes.map((n) => n.textNoteId));
  const uniqueAddedNotes = textNotes.filter((n) => !existingNoteIds.has(n.textNoteId));

  const existingWireIds = new Set(project.wires.map((w) => w.wireId));
  const uniqueAddedWires = wires.filter((w) => !existingWireIds.has(w.wireId));

  return recalculateProjectWires({
    ...project,
    circuits: nextCircuits,
    gates: nextGates,
    pins: nextPins,
    circuitButtons: nextButtons,
    constants: nextConstants,
    circuitProbes: nextProbes,
    ledMatrices: nextLedMatrices,
    splitters: nextSplitters,
    memories: nextMemories,
    sensors: nextSensors,
    sounds: nextSounds,
    synthesizers: nextSynthesizers,
    graphicsArrays: nextGraphicsArrays,
    circuitSymbols: [...project.circuitSymbols, ...uniqueAddedSymbols],
    textNotes: [...project.textNotes, ...uniqueAddedNotes],
    wires: [...project.wires, ...uniqueAddedWires],
    logicalCircuits: project.logicalCircuits.map((lc) => {
      if (lc.logicalCircuitId !== logicalCircuitId) {
        return lc;
      }
      const lcSymIds = new Set(lc.circuitSymbols.map((s) => s.circuitSymbolId));
      const lcNoteIds = new Set(lc.textNotes.map((n) => n.textNoteId));
      const lcPinIds = new Set(lc.logicalPins.map((p) => p.pinId));
      const lcWireIds = new Set(lc.wires.map((w) => w.wireId));
      return {
        ...lc,
        circuitSymbols: [
          ...lc.circuitSymbols,
          ...addedSymbols.filter((s) => !lcSymIds.has(s.circuitSymbolId)),
        ],
        textNotes: [
          ...lc.textNotes,
          ...textNotes.filter((n) => !lcNoteIds.has(n.textNoteId)),
        ],
        logicalPins: [
          ...lc.logicalPins,
          ...addedPinsForCircuit.filter((p) => !lcPinIds.has(p.pinId)),
        ],
        wires: [
          ...lc.wires,
          ...wires.filter((w) => !lcWireIds.has(w.wireId)),
        ],
      };
    }),
  });
}

// Entfernt Symbole, Textnotizen und Leitungen aus dem Projekt
export function deleteEntities(
  project: CircuitProject,
  symbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[],
  textNotes: TextNote[],
  wires: Wire[] = [],
): CircuitProject {
  const symbolIdSet = new Set(symbols.map((s) => s.symbol.circuitSymbolId));
  const noteIdSet = new Set(textNotes.map((n) => n.textNoteId));
  const wireIdSet = new Set(wires.map((w) => w.wireId));

  const removedPinIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "pin")
      .map((s) => s.pin?.pinId ?? s.circuit.circuitId),
  );
  const removedButtonIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "circuitButton")
      .map((s) => (s.circuit as CircuitButton).circuitButtonId),
  );
  const removedConstantIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "constant")
      .map((s) => (s.circuit as Constant).constantId),
  );
  const removedProbeIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "circuitProbe")
      .map((s) => (s.circuit as CircuitProbe).circuitProbeId),
  );
  const removedMatrixIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "ledMatrix")
      .map((s) => (s.circuit as LedMatrix).ledMatrixId),
  );
  const removedSplitterIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "splitter")
      .map((s) => (s.circuit as Splitter).splitterId),
  );
  const removedMemoryIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "memory")
      .map((s) => (s.circuit as Memory).memoryId),
  );
  const removedSensorIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "sensor")
      .map((s) => (s.circuit as Sensor).sensorId),
  );
  const removedSoundIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "sound")
      .map((s) => (s.circuit as Sound).soundId),
  );
  const removedSynthesizerIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "synthesizer")
      .map((s) => (s.circuit as Synthesizer).synthesizerId),
  );
  const removedGraphicsArrayIds = new Set(
    symbols
      .filter((s) => s.circuit.kind === "graphicsArray")
      .map((s) => (s.circuit as GraphicsArray).graphicsArrayId),
  );

  return recalculateProjectWires({
    ...project,
    pins: project.pins.filter((p) => !removedPinIds.has(p.pinId)),
    circuitButtons: project.circuitButtons.filter((b) => !removedButtonIds.has(b.circuitButtonId)),
    constants: project.constants.filter((c) => !removedConstantIds.has(c.constantId)),
    circuitProbes: project.circuitProbes.filter((p) => !removedProbeIds.has(p.circuitProbeId)),
    ledMatrices: project.ledMatrices.filter((m) => !removedMatrixIds.has(m.ledMatrixId)),
    splitters: project.splitters.filter((s) => !removedSplitterIds.has(s.splitterId)),
    memories: project.memories.filter((m) => !removedMemoryIds.has(m.memoryId)),
    sensors: project.sensors.filter((s) => !removedSensorIds.has(s.sensorId)),
    sounds: project.sounds.filter((s) => !removedSoundIds.has(s.soundId)),
    synthesizers: project.synthesizers.filter((s) => !removedSynthesizerIds.has(s.synthesizerId)),
    graphicsArrays: project.graphicsArrays.filter((g) => !removedGraphicsArrayIds.has(g.graphicsArrayId)),
    circuitSymbols: project.circuitSymbols.filter((s) => !symbolIdSet.has(s.circuitSymbolId)),
    textNotes: project.textNotes.filter((n) => !noteIdSet.has(n.textNoteId)),
    wires: project.wires.filter((w) => !wireIdSet.has(w.wireId)),
    logicalCircuits: project.logicalCircuits.map((lc) => ({
      ...lc,
      logicalPins: lc.logicalPins.filter((p) => !removedPinIds.has(p.pinId)),
      circuitSymbols: lc.circuitSymbols.filter((s) => !symbolIdSet.has(s.circuitSymbolId)),
      textNotes: lc.textNotes.filter((n) => !noteIdSet.has(n.textNoteId)),
      wires: lc.wires.filter((w) => !wireIdSet.has(w.wireId)),
    })),
  });
}

// Wendet Leitungs-Updates, Löschungen und Einfügungen in Vorwärtsrichtung an
export function applyWireModificationsForward(
  project: CircuitProject,
  logicalCircuitId: string,
  wireChanges?: WireEndpointUpdate[],
  removedWires?: Wire[],
  addedWires?: Wire[],
): CircuitProject {
  if (
    (!wireChanges || wireChanges.length === 0) &&
    (!removedWires || removedWires.length === 0) &&
    (!addedWires || addedWires.length === 0)
  ) {
    return recalculateProjectWires(project);
  }

  const updateMap = new Map(
    (wireChanges ?? []).map((u) => [u.wireId, u.after]),
  );
  const removedIds = new Set((removedWires ?? []).map((w) => w.wireId));
  const toAdd = addedWires ?? [];

  const transformWireList = (list: Wire[], isTargetCircuit: boolean): Wire[] => {
    const kept = list
      .filter((w) => !removedIds.has(w.wireId))
      .map((w) => {
        const nextPts = updateMap.get(w.wireId);
        if (!nextPts) {
          return w;
        }
        return updateWireEndpoints(w, nextPts.x1, nextPts.y1, nextPts.x2, nextPts.y2);
      });

    if (!isTargetCircuit || toAdd.length === 0) {
      return kept;
    }
    const existingIds = new Set(kept.map((w) => w.wireId));
    return [...kept, ...toAdd.filter((w) => !existingIds.has(w.wireId))];
  };

  return recalculateProjectWires({
    ...project,
    wires: transformWireList(project.wires, true),
    logicalCircuits: project.logicalCircuits.map((lc) => ({
      ...lc,
      wires: transformWireList(lc.wires, lc.logicalCircuitId === logicalCircuitId),
    })),
  });
}

// Wendet Leitungs-Updates, Löschungen und Einfügungen in Rückwärtsrichtung (Undo) an
function applyWireModificationsBackward(
  project: CircuitProject,
  logicalCircuitId: string,
  wireChanges?: WireEndpointUpdate[],
  removedWires?: Wire[],
  addedWires?: Wire[],
): CircuitProject {
  if (
    (!wireChanges || wireChanges.length === 0) &&
    (!removedWires || removedWires.length === 0) &&
    (!addedWires || addedWires.length === 0)
  ) {
    return recalculateProjectWires(project);
  }

  const updateMap = new Map(
    (wireChanges ?? []).map((u) => [u.wireId, u.before]),
  );
  const addedIds = new Set((addedWires ?? []).map((w) => w.wireId));
  const toRestore = removedWires ?? [];

  const transformWireList = (list: Wire[], isTargetCircuit: boolean): Wire[] => {
    const kept = list
      .filter((w) => !addedIds.has(w.wireId))
      .map((w) => {
        const prevPts = updateMap.get(w.wireId);
        if (!prevPts) {
          return w;
        }
        return updateWireEndpoints(w, prevPts.x1, prevPts.y1, prevPts.x2, prevPts.y2);
      });

    if (!isTargetCircuit || toRestore.length === 0) {
      return kept;
    }
    const existingIds = new Set(kept.map((w) => w.wireId));
    return [...kept, ...toRestore.filter((w) => !existingIds.has(w.wireId))];
  };

  return recalculateProjectWires({
    ...project,
    wires: transformWireList(project.wires, true),
    logicalCircuits: project.logicalCircuits.map((lc) => ({
      ...lc,
      wires: transformWireList(lc.wires, lc.logicalCircuitId === logicalCircuitId),
    })),
  });
}

// Ersetzt ein platziertes Symbol und seine zugehörige Circuit-Entität im Projekt
export function applySymbolSnapshot(
  project: CircuitProject,
  targetId: string,
  snapshot: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin },
): CircuitProject {
  const { symbol: updatedSymbol, circuit: updatedCircuit, pin: updatedPin } = snapshot;
  const nextCircuits = new Map(project.circuits);
  const nextGates = new Map(project.gates);
  let nextButtons = [...project.circuitButtons];
  let nextConstants = [...project.constants];
  let nextPins = [...project.pins];
  let nextProbes = [...project.circuitProbes];
  let nextLedMatrices = [...project.ledMatrices];
  let nextSplitters = [...project.splitters];
  let nextMemories = [...project.memories];
  let nextSensors = [...project.sensors];
  let nextSounds = [...project.sounds];
  let nextSynthesizers = [...project.synthesizers];
  let nextGraphicsArrays = [...project.graphicsArrays];

  nextCircuits.set(updatedCircuit.circuitId, updatedCircuit);

  if (updatedCircuit.kind === "gate") {
    const gate = updatedCircuit as Gate;
    nextGates.set(gate.gateId, gate);
  } else if (updatedCircuit.kind === "circuitButton") {
    const btn = updatedCircuit as CircuitButton;
    nextButtons = nextButtons.map((b) => (b.circuitButtonId === btn.circuitButtonId ? btn : b));
    if (!nextButtons.some((b) => b.circuitButtonId === btn.circuitButtonId)) {
      nextButtons.push(btn);
    }
  } else if (updatedCircuit.kind === "constant") {
    const constant = updatedCircuit as Constant;
    nextConstants = nextConstants.map((c) => (c.constantId === constant.constantId ? constant : c));
    if (!nextConstants.some((c) => c.constantId === constant.constantId)) {
      nextConstants.push(constant);
    }
  } else if (updatedCircuit.kind === "circuitProbe") {
    const probe = updatedCircuit as CircuitProbe;
    nextProbes = nextProbes.map((p) => (p.circuitProbeId === probe.circuitProbeId ? probe : p));
    if (!nextProbes.some((p) => p.circuitProbeId === probe.circuitProbeId)) {
      nextProbes.push(probe);
    }
  } else if (updatedCircuit.kind === "ledMatrix") {
    const matrix = updatedCircuit as LedMatrix;
    nextLedMatrices = nextLedMatrices.map((m) => (m.ledMatrixId === matrix.ledMatrixId ? matrix : m));
    if (!nextLedMatrices.some((m) => m.ledMatrixId === matrix.ledMatrixId)) {
      nextLedMatrices.push(matrix);
    }
  } else if (updatedCircuit.kind === "splitter") {
    const splitter = updatedCircuit as Splitter;
    nextSplitters = nextSplitters.map((s) => (s.splitterId === splitter.splitterId ? splitter : s));
    if (!nextSplitters.some((s) => s.splitterId === splitter.splitterId)) {
      nextSplitters.push(splitter);
    }
  } else if (updatedCircuit.kind === "memory") {
    const memory = updatedCircuit as Memory;
    nextMemories = nextMemories.map((m) => (m.memoryId === memory.memoryId ? memory : m));
    if (!nextMemories.some((m) => m.memoryId === memory.memoryId)) {
      nextMemories.push(memory);
    }
  } else if (updatedCircuit.kind === "sensor") {
    const sensor = updatedCircuit as Sensor;
    nextSensors = nextSensors.map((s) => (s.sensorId === sensor.sensorId ? sensor : s));
    if (!nextSensors.some((s) => s.sensorId === sensor.sensorId)) {
      nextSensors.push(sensor);
    }
  } else if (updatedCircuit.kind === "sound") {
    const sound = updatedCircuit as Sound;
    nextSounds = nextSounds.map((s) => (s.soundId === sound.soundId ? sound : s));
    if (!nextSounds.some((s) => s.soundId === sound.soundId)) {
      nextSounds.push(sound);
    }
  } else if (updatedCircuit.kind === "synthesizer") {
    const synth = updatedCircuit as Synthesizer;
    nextSynthesizers = nextSynthesizers.map((s) =>
      s.synthesizerId === synth.synthesizerId ? synth : s,
    );
    if (!nextSynthesizers.some((s) => s.synthesizerId === synth.synthesizerId)) {
      nextSynthesizers.push(synth);
    }
  } else if (updatedCircuit.kind === "graphicsArray") {
    const ga = updatedCircuit as GraphicsArray;
    nextGraphicsArrays = nextGraphicsArrays.map((g) => (g.graphicsArrayId === ga.graphicsArrayId ? ga : g));
    if (!nextGraphicsArrays.some((g) => g.graphicsArrayId === ga.graphicsArrayId)) {
      nextGraphicsArrays.push(ga);
    }
  } else if (updatedCircuit.kind === "pin" && updatedPin) {
    nextPins = nextPins.map((p) => (p.pinId === updatedPin.pinId ? updatedPin : p));
    if (!nextPins.some((p) => p.pinId === updatedPin.pinId)) {
      nextPins.push(updatedPin);
    }
  }

  const replaceSymbol = (s: CircuitSymbol) => (s.circuitSymbolId === targetId ? updatedSymbol : s);

  const nextProject: CircuitProject = {
    ...project,
    circuits: nextCircuits,
    gates: nextGates,
    circuitButtons: nextButtons,
    constants: nextConstants,
    pins: nextPins,
    circuitProbes: nextProbes,
    ledMatrices: nextLedMatrices,
    splitters: nextSplitters,
    memories: nextMemories,
    sensors: nextSensors,
    sounds: nextSounds,
    synthesizers: nextSynthesizers,
    graphicsArrays: nextGraphicsArrays,
    circuitSymbols: project.circuitSymbols.map(replaceSymbol),
    logicalCircuits: project.logicalCircuits.map((lc) => ({
      ...lc,
      logicalPins: updatedPin
        ? lc.logicalPins.map((p) => (p.pinId === updatedPin.pinId ? updatedPin : p))
        : lc.logicalPins,
      circuitSymbols: lc.circuitSymbols.map(replaceSymbol),
    })),
  };

  return updatedCircuit.kind === "pin" ? syncProjectLogicalCircuits(nextProject) : nextProject;
}

// Überträgt einen LogicalCircuit-Snapshot (inkl. Symbolform, Erweiterter Platzierung & Pin-Indizes) auf das Projekt
export function applyLogicalCircuitSnapshot(
  project: CircuitProject,
  logicalCircuitId: string,
  snapshot: NonNullable<Extract<CircuitDelta, { type: "updateProperty" }>["afterLogicalCircuit"]>,
): CircuitProject {
  const nextCircuits = new Map(project.circuits);
  const pinOrderMap = snapshot.pinOrder
    ? new Map(snapshot.pinOrder.map((entry) => [entry.pinId, entry.index]))
    : null;

  const updatePinIndex = (pin: Pin): Pin => {
    if (!pinOrderMap || pin.circuitId !== logicalCircuitId) {
      return pin;
    }
    const nextIdx = pinOrderMap.get(pin.pinId);
    return nextIdx !== undefined && nextIdx !== pin.index ? { ...pin, index: nextIdx } : pin;
  };

  const nextPins = pinOrderMap ? project.pins.map(updatePinIndex) : project.pins;

  const nextLogicalCircuits = project.logicalCircuits.map((lc) => {
    if (lc.logicalCircuitId !== logicalCircuitId) {
      return lc;
    }
    const nextShape = snapshot.circuitShape ?? lc.circuitShape;
    const updatedLc: LogicalCircuit = {
      ...lc,
      name: snapshot.name,
      notation: snapshot.notation,
      category: snapshot.category,
      note: snapshot.note,
      circuitShape: nextShape,
      isDisplay: nextShape === "display",
      ...(snapshot.showLabelAbove !== undefined ? { showLabelAbove: snapshot.showLabelAbove } : {}),
      ...(snapshot.displayMargin !== undefined ? { displayMargin: snapshot.displayMargin } : {}),
      ...(snapshot.exportToHDL !== undefined ? { exportToHDL: snapshot.exportToHDL } : {}),
      ...(snapshot.validators !== undefined ? { validators: snapshot.validators } : {}),
      logicalPins: pinOrderMap ? lc.logicalPins.map(updatePinIndex) : lc.logicalPins,
    };
    nextCircuits.set(updatedLc.circuitId, updatedLc);
    return updatedLc;
  });

  const synced = syncProjectLogicalCircuits({
    ...project,
    circuits: nextCircuits,
    pins: nextPins,
    logicalCircuits: nextLogicalCircuits,
  });

  return recalculateProjectWires(synced);
}

// Wendet eine Delta-Aktion in Vorwärtsrichtung (Redo) auf das Projekt an
export function applyDeltaForward(project: CircuitProject, delta: CircuitDelta): CircuitProject {
  switch (delta.type) {
    case "move": {
      const symPosMap = delta.symbolPositions
        ? new Map(delta.symbolPositions.map((p) => [p.symbolId, p.after]))
        : null;
      const notePosMap = delta.textNotePositions
        ? new Map(delta.textNotePositions.map((p) => [p.textNoteId, p.after]))
        : null;
      const symSet = new Set(delta.symbolIds);
      const noteSet = new Set(delta.textNoteIds);

      const moveSymbolFn = (sym: CircuitSymbol): CircuitSymbol => {
        if (!symSet.has(sym.circuitSymbolId)) {
          return sym;
        }
        const targetPos = symPosMap?.get(sym.circuitSymbolId) ?? {
          x: sym.x + delta.dx,
          y: sym.y + delta.dy,
        };
        return createCircuitSymbol(
          sym.circuit,
          sym.logicalCircuitId,
          targetPos.x,
          targetPos.y,
          sym.rotation,
          sym.circuitSymbolId,
        );
      };

      const moveNoteFn = (note: TextNote): TextNote => {
        if (!noteSet.has(note.textNoteId)) {
          return note;
        }
        const targetPos = notePosMap?.get(note.textNoteId) ?? {
          x: note.x + delta.dx,
          y: note.y + delta.dy,
        };
        return {
          ...note,
          x: targetPos.x,
          y: targetPos.y,
        };
      };

      const movedProject: CircuitProject = {
        ...project,
        circuitSymbols: project.circuitSymbols.map(moveSymbolFn),
        textNotes: project.textNotes.map(moveNoteFn),
        logicalCircuits: project.logicalCircuits.map((lc) => ({
          ...lc,
          circuitSymbols: lc.circuitSymbols.map(moveSymbolFn),
          textNotes: lc.textNotes.map(moveNoteFn),
        })),
      };

      return applyWireModificationsForward(
        movedProject,
        delta.logicalCircuitId,
        delta.wireChanges,
        delta.removedWires,
      );
    }

    case "rotate": {
      const symMap = new Map(delta.symbols.map((s) => [s.symbolId, s.after]));
      const noteMap = new Map(delta.textNotes.map((n) => [n.textNoteId, n.after]));

      const rotateSymbolFn = (sym: CircuitSymbol): CircuitSymbol => {
        const target = symMap.get(sym.circuitSymbolId);
        if (!target) {
          return sym;
        }
        return createCircuitSymbol(
          sym.circuit,
          sym.logicalCircuitId,
          target.x,
          target.y,
          target.rotation,
          sym.circuitSymbolId,
        );
      };

      const rotateNoteFn = (note: TextNote): TextNote => {
        const target = noteMap.get(note.textNoteId);
        if (!target) {
          return note;
        }
        return {
          ...note,
          x: target.x,
          y: target.y,
          rotation: target.rotation,
        };
      };

      const rotatedProject: CircuitProject = {
        ...project,
        circuitSymbols: project.circuitSymbols.map(rotateSymbolFn),
        textNotes: project.textNotes.map(rotateNoteFn),
        logicalCircuits: project.logicalCircuits.map((lc) => ({
          ...lc,
          circuitSymbols: lc.circuitSymbols.map(rotateSymbolFn),
          textNotes: lc.textNotes.map(rotateNoteFn),
        })),
      };

      return applyWireModificationsForward(
        rotatedProject,
        delta.logicalCircuitId,
        delta.wireChanges,
        delta.removedWires,
      );
    }

    case "add": {
      return insertEntities(
        project,
        delta.logicalCircuitId,
        delta.symbols,
        delta.textNotes,
        delta.wires,
      );
    }

    case "remove": {
      return deleteEntities(project, delta.symbols, delta.textNotes, delta.wires);
    }

    case "wireBatch": {
      return applyWireModificationsForward(
        project,
        delta.logicalCircuitId,
        delta.updatedWires,
        delta.removedWires,
        delta.addedWires,
      );
    }

    case "updateProperty": {
      if (delta.targetType === "symbol" && delta.afterSymbol) {
        const snapshotApplied = applySymbolSnapshot(project, delta.targetId, delta.afterSymbol);
        return applyWireModificationsForward(
          snapshotApplied,
          delta.logicalCircuitId,
          delta.wireChanges,
          delta.removedWires,
        );
      }
      if (delta.targetType === "textNote" && delta.afterTextNote) {
        const afterNote = delta.afterTextNote;
        const replaceNote = (n: TextNote) => (n.textNoteId === delta.targetId ? afterNote : n);
        return {
          ...project,
          textNotes: project.textNotes.map(replaceNote),
          logicalCircuits: project.logicalCircuits.map((lc) => ({
            ...lc,
            textNotes: lc.textNotes.map(replaceNote),
          })),
        };
      }
      if (delta.targetType === "logicalCircuit" && delta.afterLogicalCircuit) {
        return applyLogicalCircuitSnapshot(project, delta.targetId, delta.afterLogicalCircuit);
      }
      return project;
    }
  }
}
// Wendet eine Delta-Aktion in Rückwärtsrichtung (Undo) auf das Projekt an
export function applyDeltaBackward(project: CircuitProject, delta: CircuitDelta): CircuitProject {
  switch (delta.type) {
    case "move": {
      const symPosMap = delta.symbolPositions
        ? new Map(delta.symbolPositions.map((p) => [p.symbolId, p.before]))
        : null;
      const notePosMap = delta.textNotePositions
        ? new Map(delta.textNotePositions.map((p) => [p.textNoteId, p.before]))
        : null;
      const symSet = new Set(delta.symbolIds);
      const noteSet = new Set(delta.textNoteIds);

      const moveSymbolFn = (sym: CircuitSymbol): CircuitSymbol => {
        if (!symSet.has(sym.circuitSymbolId)) {
          return sym;
        }
        const targetPos = symPosMap?.get(sym.circuitSymbolId) ?? {
          x: sym.x - delta.dx,
          y: sym.y - delta.dy,
        };
        return createCircuitSymbol(
          sym.circuit,
          sym.logicalCircuitId,
          targetPos.x,
          targetPos.y,
          sym.rotation,
          sym.circuitSymbolId,
        );
      };

      const moveNoteFn = (note: TextNote): TextNote => {
        if (!noteSet.has(note.textNoteId)) {
          return note;
        }
        const targetPos = notePosMap?.get(note.textNoteId) ?? {
          x: note.x - delta.dx,
          y: note.y - delta.dy,
        };
        return {
          ...note,
          x: targetPos.x,
          y: targetPos.y,
        };
      };

      const revertedProject: CircuitProject = {
        ...project,
        circuitSymbols: project.circuitSymbols.map(moveSymbolFn),
        textNotes: project.textNotes.map(moveNoteFn),
        logicalCircuits: project.logicalCircuits.map((lc) => ({
          ...lc,
          circuitSymbols: lc.circuitSymbols.map(moveSymbolFn),
          textNotes: lc.textNotes.map(moveNoteFn),
        })),
      };

      return applyWireModificationsBackward(
        revertedProject,
        delta.logicalCircuitId,
        delta.wireChanges,
        delta.removedWires,
      );
    }

    case "rotate": {
      const symMap = new Map(delta.symbols.map((s) => [s.symbolId, s.before]));
      const noteMap = new Map(delta.textNotes.map((n) => [n.textNoteId, n.before]));

      const rotateSymbolFn = (sym: CircuitSymbol): CircuitSymbol => {
        const target = symMap.get(sym.circuitSymbolId);
        if (!target) {
          return sym;
        }
        return createCircuitSymbol(
          sym.circuit,
          sym.logicalCircuitId,
          target.x,
          target.y,
          target.rotation,
          sym.circuitSymbolId,
        );
      };

      const rotateNoteFn = (note: TextNote): TextNote => {
        const target = noteMap.get(note.textNoteId);
        if (!target) {
          return note;
        }
        return {
          ...note,
          x: target.x,
          y: target.y,
          rotation: target.rotation,
        };
      };

      const revertedProject: CircuitProject = {
        ...project,
        circuitSymbols: project.circuitSymbols.map(rotateSymbolFn),
        textNotes: project.textNotes.map(rotateNoteFn),
        logicalCircuits: project.logicalCircuits.map((lc) => ({
          ...lc,
          circuitSymbols: lc.circuitSymbols.map(rotateSymbolFn),
          textNotes: lc.textNotes.map(rotateNoteFn),
        })),
      };

      return applyWireModificationsBackward(
        revertedProject,
        delta.logicalCircuitId,
        delta.wireChanges,
        delta.removedWires,
      );
    }

    case "add": {
      return deleteEntities(project, delta.symbols, delta.textNotes, delta.wires);
    }

    case "remove": {
      return insertEntities(
        project,
        delta.logicalCircuitId,
        delta.symbols,
        delta.textNotes,
        delta.wires,
      );
    }

    case "wireBatch": {
      return applyWireModificationsBackward(
        project,
        delta.logicalCircuitId,
        delta.updatedWires,
        delta.removedWires,
        delta.addedWires,
      );
    }

    case "updateProperty": {
      if (delta.targetType === "symbol" && delta.beforeSymbol) {
        const snapshotApplied = applySymbolSnapshot(project, delta.targetId, delta.beforeSymbol);
        return applyWireModificationsBackward(
          snapshotApplied,
          delta.logicalCircuitId,
          delta.wireChanges,
          delta.removedWires,
        );
      }
      if (delta.targetType === "textNote" && delta.beforeTextNote) {
        const beforeNote = delta.beforeTextNote;
        const replaceNote = (n: TextNote) => (n.textNoteId === delta.targetId ? beforeNote : n);
        return {
          ...project,
          textNotes: project.textNotes.map(replaceNote),
          logicalCircuits: project.logicalCircuits.map((lc) => ({
            ...lc,
            textNotes: lc.textNotes.map(replaceNote),
          })),
        };
      }
      if (delta.targetType === "logicalCircuit" && delta.beforeLogicalCircuit) {
        return applyLogicalCircuitSnapshot(project, delta.targetId, delta.beforeLogicalCircuit);
      }
      return project;
    }
  }
}
