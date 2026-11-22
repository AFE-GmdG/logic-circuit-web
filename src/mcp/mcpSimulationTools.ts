import type CircuitButton from "../types/circuit/circuitButton";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type DevicePin from "../types/circuit/devicePin";
import type Gate from "../types/circuit/gate";
import type GraphicsArray from "../types/circuit/graphicsArray";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type Sound from "../types/circuit/sound";
import type Synthesizer from "../types/circuit/synthesizer";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpImageResult from "../types/mcp/mcpImageResult";
import type McpSimulationActions from "../types/mcp/mcpSimulationActions";
import type FrameRateLimit from "../types/simulation/frameRateLimit";
import type State from "../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";

import CircuitException from "../simulation/compiler/circuitException";
import CircuitMap, {
  getAudioInstanceId,
  getGraphicsArrayInstanceId,
  getMemoryInstanceId,
} from "../simulation/compiler/circuitMap";
import type {
  ScheduledButtonEvent,
  SimulationSnapshot,
} from "../simulation/worker/workerMessages";
import { captureCircuitSvg, type CaptureMode } from "../utils/circuitCapture";
import { gridPointKey } from "../utils/circuitLayout";
import { getGraphicsArrayStrides } from "../utils/graphicsArrayUtils";
import { validateCircuitWires } from "../utils/wireUtils";

import {
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalInteger,
  readOptionalString,
  readOptionalStringArray,
  resolveCircuit,
  resolveLiveSnapshot,
} from "./mcpParamUtils";

type SimulationAction = "step" | "start" | "pause" | "stop" | "reset";

const ALLOWED_SIMULATION_ACTIONS: readonly SimulationAction[] = [
  "step",
  "start",
  "pause",
  "stop",
  "reset",
];
const ALLOWED_FRAME_RATES: readonly FrameRateLimit[] = [1, 2, 5, 10, 20, 30, 60, "max"];
const ALLOWED_CAPTURE_MODES: readonly CaptureMode[] = ["circuit", "viewport"];

function requireSimulationActions(snapshot: McpCircuitSnapshot): McpSimulationActions {
  if (!snapshot.simulation) {
    throw new Error(
      "Simulations-Werkzeuge erfordern eine aktive Editor-Sitzung mit SimulationContext-Aktionen.",
    );
  }
  return snapshot.simulation;
}

function readOptionalFrameRateLimit(
  params: Record<string, unknown>,
  key: string,
): FrameRateLimit | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!ALLOWED_FRAME_RATES.includes(value as FrameRateLimit)) {
    throw new Error(`Parameter "${key}" muss einer der Werte [1, 2, 5, 10, 20, 30, 60, "max"] sein.`);
  }
  return value as FrameRateLimit;
}

// Löst einen Instanzpfad aus circuitSymbolIds entlang CircuitMap.children auf
function resolveCircuitMapByPath(rootMap: CircuitMap, instancePath: string[]): CircuitMap {
  let curr = rootMap;
  for (let i = 0; i < instancePath.length; i++) {
    const symbolId = instancePath[i];
    const next = curr.children.get(symbolId);
    if (!next) {
      const available = Array.from(curr.children.entries())
        .map(([id, child]) => `${id} (${child.circuit.name})`)
        .join(", ");
      const hint = available.length > 0 ? available : "keine Subschaltungs-Instanzen auf dieser Ebene";
      throw new Error(
        `Instanzpfad "${instancePath.join(" -> ")}" bei Segment "${symbolId}" ` +
        `(Tiefe ${i}) in "${curr.circuit.name}" nicht gefunden. Verfügbare Kinder: ${hint}`,
      );
    }
    curr = next;
  }
  return curr;
}

// Sammelt alle laufenden Instanzpfade ab der Root-CircuitMap
function collectRunningInstances(
  map: CircuitMap,
  prefix: string[] = [],
): {
  instancePath: string[];
  circuitId: string;
  name: string;
  symbolId?: string;
  coordinates?: { x: number; y: number };
  pathLabel: string;
}[] {
  const result = [
    {
      instancePath: prefix,
      circuitId: map.circuit.logicalCircuitId,
      name: map.circuit.name,
      ...(map.symbol
        ? {
          symbolId: map.symbol.circuitSymbolId,
          coordinates: { x: map.symbol.x, y: map.symbol.y },
        }
        : {}),
      pathLabel: map.path(),
    },
  ];

  for (const [symbolId, child] of map.children.entries()) {
    result.push(...collectRunningInstances(child, [...prefix, symbolId]));
  }
  return result;
}

// Dekodiert ein Array aus State-Indizes (Bit 0 = LSB) in eine kompakte Darstellung
function decodeSignalStates(indices: (number | null)[], stateArray: Uint8Array) {
  const bitWidth = indices.length;
  if (bitWidth === 0) {
    return { bitWidth: 0, text: "", numeric: null as number | null };
  }

  let hasOff = false;
  let numericValue = 0;
  const msbToLsbChars: string[] = [];

  for (let i = bitWidth - 1; i >= 0; i--) {
    const idx = indices[i];
    const state: State = idx === null || idx === undefined ? STATE_OFF : (stateArray[idx] as State);
    if (state === STATE_ON1) {
      msbToLsbChars.push("1");
      numericValue = numericValue * 2 + 1;
    } else if (state === STATE_ON0) {
      msbToLsbChars.push("0");
      numericValue = numericValue * 2;
    } else {
      msbToLsbChars.push("x");
      hasOff = true;
    }
  }

  const text = msbToLsbChars.join("");
  const numeric = hasOff ? null : numericValue;
  return {
    bitWidth,
    text,
    numeric,
    ...(bitWidth > 1 ? { hex: numeric !== null ? `0x${numeric.toString(16)}` : null } : {}),
  };
}

// Beschreibt den Zustand eines einzelnen Symbols innerhalb der gewählten CircuitMap-Instanz
function describeSimulatedSymbol(
  symbol: CircuitSymbol,
  targetMap: CircuitMap,
  simSnapshot: SimulationSnapshot,
  instancePath: string[],
) {
  const jams = symbol.jams.map((jam) => ({
    pinName: jam.pin.name,
    pinType: jam.effectivePinType ?? jam.pin.pinType,
    bitWidth: jam.pin.bitWidth,
    signal: decodeSignalStates(targetMap.jamStateIndexes(jam), simSnapshot.stateArray),
  }));

  const extra: Record<string, unknown> = {};
  if (symbol.circuit.kind === "circuitButton") {
    const btn = symbol.circuit as CircuitButton;
    const buttonId = btn.circuitButtonId ?? btn.circuitId;
    const snapBtn = simSnapshot.buttons[buttonId];
    extra.button = {
      buttonId,
      isToggle: snapBtn?.isToggle ?? Boolean(btn.isToggle),
      isOn: snapBtn?.isOn ?? false,
    };
  } else if (symbol.circuit.kind === "circuitProbe") {
    const inJam = symbol.jams.find((j) => j.pin.pinType === "input") ?? symbol.jams[0];
    if (inJam) {
      extra.probe = decodeSignalStates(targetMap.jamStateIndexes(inJam), simSnapshot.stateArray);
    }
  } else if (symbol.circuit.kind === "gate") {
    const gate = symbol.circuit as Gate;
    if (gate.gateType === "led") {
      if (gate.inputCount === 8) {
        const segments = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const jam = symbol.jams.find(
            (j) => (j.pin as Partial<DevicePin>).order === i || j.pin.pinId === `in-${i}`,
          );
          if (!jam) {
            return false;
          }
          const sig = decodeSignalStates(targetMap.jamStateIndexes(jam), simSnapshot.stateArray);
          return sig.text === "1";
        });
        extra.sevenSegment = { segments };
      } else {
        const inJam = symbol.jams.find((j) => j.pin.pinType === "input");
        const sig = inJam
          ? decodeSignalStates(targetMap.jamStateIndexes(inJam), simSnapshot.stateArray)
          : { bitWidth: 1, text: "x", numeric: null };
        extra.led = { isOn: sig.text === "1", signal: sig.text };
      }
    }
  } else if (symbol.circuit.kind === "memory") {
    const mem = symbol.circuit as Memory;
    const memoryInstanceId = getMemoryInstanceId(targetMap, symbol);
    extra.memory = {
      memoryId: mem.memoryId,
      memoryInstanceId,
      writable: mem.writable,
      addressBitWidth: mem.addressBitWidth,
      dataBitWidth: mem.dataBitWidth,
      dualPort: mem.dualPort,
      ...(mem.writable ? { writeOn1: mem.writeOn1, onStart: mem.onStart } : {}),
      revision: simSnapshot.memoryRevisions?.[memoryInstanceId] ?? 0,
    };
  } else if (symbol.circuit.kind === "sound") {
    const sound = symbol.circuit as Sound;
    const channelId = getAudioInstanceId(targetMap, symbol);
    const snapAudio = simSnapshot.audioChannels?.[channelId];
    extra.sound = {
      soundId: sound.soundId,
      channelId,
      active: snapAudio?.active ?? false,
      waveform: sound.waveform ?? "sine",
      frequency: sound.frequency ?? 440,
      frequencyHz: snapAudio?.frequencyHz ?? null,
    };
  } else if (symbol.circuit.kind === "synthesizer") {
    const synth = symbol.circuit as Synthesizer;
    const channelId = getAudioInstanceId(targetMap, symbol);
    const snapAudio = simSnapshot.audioChannels?.[channelId];
    extra.synthesizer = {
      synthesizerId: synth.synthesizerId,
      channelId,
      active: snapAudio?.active ?? false,
      mode: synth.mode,
      frequencyHz: snapAudio?.frequencyHz ?? null,
      channelGain: snapAudio?.channelGain ?? 0,
      rawPitch: snapAudio?.rawPitch ?? null,
      rawVolume: snapAudio?.rawVolume ?? null,
    };
  } else if (symbol.circuit.kind === "graphicsArray") {
    const ga = symbol.circuit as GraphicsArray;
    const instanceId = getGraphicsArrayInstanceId(targetMap, symbol);
    const snapGa = simSnapshot.graphicsArrays?.[instanceId];
    const strides = getGraphicsArrayStrides(
      ga.dataBitWidth,
      ga.bitsPerPixel,
      ga.width,
      ga.height,
    );
    let nonZeroBytes = 0;
    if (snapGa?.vram) {
      for (let i = 0; i < snapGa.vram.length; i++) {
        if (snapGa.vram[i] !== 0) {
          nonZeroBytes++;
        }
      }
    }
    extra.graphicsArray = {
      graphicsArrayId: ga.graphicsArrayId,
      instanceId,
      width: ga.width,
      height: ga.height,
      bitsPerPixel: ga.bitsPerPixel,
      dataBitWidth: ga.dataBitWidth,
      addressBitWidth: strides.addressBitWidth,
      zoom: ga.zoom,
      writeOn1: ga.writeOn1,
      onStart: ga.onStart,
      revision: snapGa?.revision ?? simSnapshot.memoryRevisions?.[instanceId] ?? 0,
      nonZeroBytes,
    };
  } else if (symbol.circuit.kind === "logicalCircuit") {
    extra.subCircuit = {
      targetCircuitId: symbol.circuitId,
      childInstancePath: [...instancePath, symbol.circuitSymbolId],
    };
  }

  return {
    circuitSymbolId: symbol.circuitSymbolId,
    kind: symbol.circuit.kind,
    ...(symbol.circuit.kind === "gate" ? { gateType: (symbol.circuit as Gate).gateType } : {}),
    name: symbol.circuit.name,
    notation: symbol.circuit.notation,
    x: symbol.x,
    y: symbol.y,
    ...extra,
    jams,
  };
}

// Baut die detaillierte Zustandsauswertung für eine konkrete CircuitMap-Instanz auf
function buildSimulationStateReport(
  targetMap: CircuitMap,
  simSnapshot: SimulationSnapshot,
  instancePath: string[],
  symbolIds?: string[],
) {
  if (symbolIds) {
    for (const id of symbolIds) {
      if (!targetMap.findSymbol(id)) {
        throw new Error(
          `Symbol "${id}" in Instanz "${targetMap.path()}" ("${targetMap.circuit.name}") nicht gefunden.`,
        );
      }
    }
  }

  const symbolSet = symbolIds ? new Set(symbolIds) : null;
  const filteredSymbols = symbolSet
    ? targetMap.circuit.circuitSymbols.filter((s) => symbolSet.has(s.circuitSymbolId))
    : targetMap.circuit.circuitSymbols;

  const symbols = filteredSymbols.map((sym) =>
    describeSimulatedSymbol(sym, targetMap, simSnapshot, instancePath),
  );

  const probes = targetMap.circuit.circuitSymbols
    .filter((s) => s.circuit.kind === "circuitProbe")
    .map((s) => {
      const inJam = s.jams.find((j) => j.pin.pinType === "input") ?? s.jams[0];
      const decoded = inJam
        ? decodeSignalStates(targetMap.jamStateIndexes(inJam), simSnapshot.stateArray)
        : { bitWidth: 0, text: "", numeric: null };
      return {
        symbolId: s.circuitSymbolId,
        name: s.circuit.name,
        notation: s.circuit.notation,
        ...decoded,
      };
    });

  const buttons = targetMap.circuit.circuitSymbols
    .filter((s) => s.circuit.kind === "circuitButton")
    .map((s) => {
      const btn = s.circuit as CircuitButton;
      const buttonId = btn.circuitButtonId ?? btn.circuitId;
      const snapBtn = simSnapshot.buttons[buttonId];
      return {
        symbolId: s.circuitSymbolId,
        buttonId,
        name: s.circuit.name,
        notation: s.circuit.notation,
        isToggle: snapBtn?.isToggle ?? Boolean(btn.isToggle),
        isOn: snapBtn?.isOn ?? false,
      };
    });

  const audioChannels = targetMap.circuit.circuitSymbols
    .filter((s) => s.circuit.kind === "sound" || s.circuit.kind === "synthesizer")
    .map((s) => {
      const channelId = getAudioInstanceId(targetMap, s);
      const snapAudio = simSnapshot.audioChannels?.[channelId];
      if (s.circuit.kind === "sound") {
        const sound = s.circuit as Sound;
        return {
          symbolId: s.circuitSymbolId,
          channelId,
          kind: "sound" as const,
          name: s.circuit.name,
          notation: s.circuit.notation,
          active: snapAudio?.active ?? false,
          mode: sound.waveform ?? "sine",
          configuredFrequencyHz: sound.frequency ?? 440,
          frequencyHz: snapAudio?.frequencyHz ?? null,
          channelGain: snapAudio?.channelGain ?? 0,
        };
      }
      const synth = s.circuit as Synthesizer;
      return {
        symbolId: s.circuitSymbolId,
        channelId,
        kind: "synthesizer" as const,
        name: s.circuit.name,
        notation: s.circuit.notation,
        active: snapAudio?.active ?? false,
        mode: synth.mode,
        frequencyHz: snapAudio?.frequencyHz ?? null,
        channelGain: snapAudio?.channelGain ?? 0,
        rawPitch: snapAudio?.rawPitch ?? null,
        rawVolume: snapAudio?.rawVolume ?? null,
      };
    });

  const wires = targetMap.circuit.wires.map((wire) => ({
    wireId: wire.wireId,
    x1: wire.x1,
    y1: wire.y1,
    x2: wire.x2,
    y2: wire.y2,
    ...decodeSignalStates(targetMap.stateIndexes(wire), simSnapshot.stateArray),
  }));

  return {
    activeInstance: {
      instancePath,
      circuitId: targetMap.circuit.logicalCircuitId,
      name: targetMap.circuit.name,
      pathLabel: targetMap.path(),
    },
    instances: collectRunningInstances(targetMap.root),
    probes,
    buttons,
    audioChannels,
    symbols,
    wires,
  };
}

// Statische Schaltungsprüfung auf offene Eingänge, Mehrfachtreiber, Bitbreiten- und Zyklusfehler
export function validateCircuitTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const rootCircuit = resolveCircuit(snapshot, readOptionalString(params, "circuitId"));
  const live = resolveLiveSnapshot(snapshot);
  const circuitById = new Map(live.project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));

  // Alle ab rootCircuit erreichbaren eindeutigen LogicalCircuits einsammeln (ohne Zyklen endlos zu folgen)
  const visited = new Set<string>();
  const queue: LogicalCircuit[] = [rootCircuit];
  const checkedCircuits: LogicalCircuit[] = [];

  while (queue.length > 0) {
    const lc = queue.shift()!;
    if (visited.has(lc.logicalCircuitId)) {
      continue;
    }
    visited.add(lc.logicalCircuitId);
    checkedCircuits.push(lc);

    for (const sym of lc.circuitSymbols) {
      if (sym.circuit.kind === "logicalCircuit") {
        const target = circuitById.get(sym.circuitId) ?? (sym.circuit as LogicalCircuit);
        if (!visited.has(target.logicalCircuitId)) {
          queue.push(target);
        }
      }
    }
  }

  const errors: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];

  for (const lc of checkedCircuits) {
    const wireValidation = validateCircuitWires(lc.circuitSymbols, lc.wires);
    for (const indicator of wireValidation.errorIndicators) {
      errors.push({
        type: indicator.errorKind,
        circuitId: lc.logicalCircuitId,
        circuitName: lc.name,
        symbolId: indicator.symbolId,
        pinId: indicator.pinId,
        pinName: indicator.pinName,
        point: indicator.point,
        conflictingBitWidths: indicator.conflictingBitWidths,
        message: indicator.tooltip,
      });
    }

    // Offene Eingänge prüfen (Splitter-Einzelpins können optional unbeschaltet bleiben)
    for (const sym of lc.circuitSymbols) {
      if (sym.circuit.kind === "splitter") {
        continue;
      }
      for (const jam of sym.jams) {
        const isInput =
          jam.pin.pinType === "input" &&
          jam.effectivePinType !== "output" &&
          jam.effectivePinType !== "none";
        if (!isInput) {
          continue;
        }
        const key = gridPointKey(jam.absolutePoint);
        if (!wireValidation.conductorMap.byPointKey.has(key)) {
          const pinLabel = jam.pin.name || jam.pin.pinId;
          const symLabel = sym.circuit.notation || sym.circuit.name;
          warnings.push({
            type: "unconnectedInput",
            circuitId: lc.logicalCircuitId,
            circuitName: lc.name,
            symbolId: sym.circuitSymbolId,
            symbolName: symLabel,
            pinName: pinLabel,
            bitWidth: jam.pin.bitWidth,
            x: jam.absolutePoint.x,
            y: jam.absolutePoint.y,
            message:
              `Offener Eingang "${pinLabel}" an "${symLabel}" ` +
              `(${jam.absolutePoint.x}, ${jam.absolutePoint.y}) in "${lc.name}".`,
          });
        }
      }
    }
  }

  // Hierarchie- und Compiler-Prüfung (erkennt Rekursionsschleifen und Subschaltungs-Fehler)
  let hasClocks = false;
  try {
    const map = new CircuitMap(rootCircuit);
    const compiledState = map.apply();
    hasClocks = compiledState.hasClocks;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isCycle =
      error instanceof CircuitException && /schleife|zyklus|loop/i.test(message);
    errors.push({
      type: isCycle ? "cycle" : "compileError",
      circuitId: rootCircuit.logicalCircuitId,
      circuitName: rootCircuit.name,
      message,
      ...(error instanceof CircuitException && error.location ? { location: error.location } : {}),
    });
  }

  return {
    circuitId: rootCircuit.logicalCircuitId,
    name: rootCircuit.name,
    hasClocks,
    valid: errors.length === 0,
    clean: errors.length === 0 && warnings.length === 0,
    checkedCircuits: checkedCircuits.map((lc) => ({
      logicalCircuitId: lc.logicalCircuitId,
      name: lc.name,
    })),
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };
}

type ParsedButtonAction = {
  symbolId: string;
  on: boolean | undefined;
  toggle: boolean;
};

type ResolvedButtonTarget = {
  sym: CircuitSymbol;
  buttonId: string;
  isToggle: boolean;
};

// Liest und prüft eine einzelne Button-Aktion (on oder toggle)
function parseButtonActionFields(
  obj: Record<string, unknown>,
  label: string,
): ParsedButtonAction {
  const symbolId = readOptionalString(obj, "symbolId");
  if (!symbolId || symbolId.trim().length === 0) {
    throw new Error(`${label}.symbolId muss ein nicht-leerer String sein.`);
  }
  const on = readOptionalBoolean(obj, "on");
  const toggle = readOptionalBoolean(obj, "toggle");
  if (on !== undefined && toggle !== undefined) {
    throw new Error(`${label}: "on" und "toggle" dürfen nicht gleichzeitig gesetzt werden.`);
  }
  if (on === undefined && toggle !== true) {
    throw new Error(`${label}: Entweder "on" (true/false) oder "toggle: true" muss angegeben werden.`);
  }
  return { symbolId, on, toggle: toggle === true };
}

// Löst ein CircuitButton-Symbol innerhalb eines Instanzpfads auf und prüft dessen Typ
function resolveButtonTarget(
  rootMap: CircuitMap,
  instancePath: string[],
  symbolId: string,
  wantsToggle: boolean,
  snap?: SimulationSnapshot,
): ResolvedButtonTarget {
  const targetMap = resolveCircuitMapByPath(rootMap, instancePath);
  const sym = targetMap.findSymbol(symbolId);
  if (!sym) {
    throw new Error(
      `Button "${symbolId}" in Instanz "${targetMap.path()}" ("${targetMap.circuit.name}") nicht gefunden.`,
    );
  }
  if (sym.circuit.kind !== "circuitButton") {
    throw new Error(
      `Symbol "${symbolId}" ("${sym.circuit.name}") ist vom Typ "${sym.circuit.kind}", erwartet wurde "circuitButton".`,
    );
  }
  const btn = sym.circuit as CircuitButton;
  const buttonId = btn.circuitButtonId ?? btn.circuitId;
  if (snap && !snap.buttons[buttonId]) {
    throw new Error(
      `Button-Instanz "${buttonId}" für Symbol "${symbolId}" ist in der laufenden Simulation nicht registriert.`,
    );
  }
  const isToggle = snap?.buttons[buttonId]?.isToggle ?? Boolean(btn.isToggle);
  if (wantsToggle && !isToggle) {
    const symLabel = sym.circuit.notation || sym.circuit.name;
    throw new Error(
      `Button "${symbolId}" ("${symLabel}") ist kein Wechselschalter ` +
      "(isToggle=false) und unterstützt kein \"toggle: true\".",
    );
  }
  return { sym, buttonId, isToggle };
}

// Schaltet einen oder mehrere Buttons/Wechselschalter deterministisch in der Simulation
export async function setInputSignalTool(
  snapshot: McpCircuitSnapshot,
  params: Record<string, unknown>,
) {
  const sim = requireSimulationActions(snapshot);
  const circuitId = readOptionalString(params, "circuitId");
  const instancePath = readOptionalStringArray(params, "instancePath") ?? [];
  const rawInputs = params.inputs;

  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    throw new Error("Parameter \"inputs\" muss ein nicht-leeres Array von Eingangs-Aktionen sein.");
  }

  const parsedInputs = rawInputs.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Eintrag inputs[${idx}] muss ein Objekt sein.`);
    }
    return parseButtonActionFields(entry as Record<string, unknown>, `inputs[${idx}]`);
  });

  const liveSim = sim.getState();
  const rootCircuit = circuitId
    ? resolveCircuit(snapshot, circuitId)
    : (liveSim.rootCircuitMap?.circuit ?? resolveCircuit(snapshot));

  const initialized = await sim.ensurePausedSimulation(rootCircuit);
  if (!initialized) {
    throw new Error(`Simulation für "${rootCircuit.name}" konnte nicht initialisiert werden.`);
  }

  let latestSnap: SimulationSnapshot = initialized.snapshot;

  // Vorab alle Symbol-IDs und Button-Typen vollständig validieren
  const resolvedTargets = parsedInputs.map((item) => ({
    item,
    ...resolveButtonTarget(initialized.rootCircuitMap, instancePath, item.symbolId, item.toggle, latestSnap),
  }));

  const updated: {
    symbolId: string;
    buttonId: string;
    name: string;
    notation: string;
    isToggle: boolean;
    isOn: boolean;
  }[] = [];

  for (const target of resolvedTargets) {
    const currentOn = latestSnap.buttons[target.buttonId]?.isOn ?? false;
    if (target.item.toggle) {
      latestSnap = (await sim.toggleButton(target.buttonId)) ?? latestSnap;
    } else if (target.item.on !== undefined) {
      if (target.isToggle) {
        if (currentOn !== target.item.on) {
          latestSnap = (await sim.toggleButton(target.buttonId)) ?? latestSnap;
        }
      } else {
        latestSnap = (await sim.setButtonState(target.buttonId, target.item.on)) ?? latestSnap;
      }
    }

    const finalBtn = latestSnap.buttons[target.buttonId];
    updated.push({
      symbolId: target.sym.circuitSymbolId,
      buttonId: target.buttonId,
      name: target.sym.circuit.name,
      notation: target.sym.circuit.notation,
      isToggle: finalBtn?.isToggle ?? target.isToggle,
      isOn: finalBtn?.isOn ?? false,
    });
  }

  return {
    rootCircuitId: rootCircuit.logicalCircuitId,
    instancePath,
    updated,
    telemetry: {
      isSimulating: true,
      isPaused: sim.getState().isPaused,
      isRunning: sim.getState().isRunning,
      isOscillating: latestSnap.telemetry.isOscillating,
      hasClocks: latestSnap.telemetry.hasClocks ?? false,
      actualFrequency: latestSnap.telemetry.actualFrequency,
      totalSteps: latestSnap.telemetry.totalSteps,
    },
  };
}

// Steuert, schreitet deterministisch fort und wertet optional Zustand + Screenshot aus
export async function stepSimulationTool(
  snapshot: McpCircuitSnapshot,
  params: Record<string, unknown>,
) {
  const sim = requireSimulationActions(snapshot);
  const action: SimulationAction = readOptionalEnum(params, "action", ALLOWED_SIMULATION_ACTIONS) ?? "step";
  const rawSteps = readOptionalInteger(params, "steps", 0, 100000);
  if (action !== "step" && rawSteps !== undefined) {
    throw new Error("Parameter \"steps\" kann nur zusammen mit action=\"step\" angegeben werden.");
  }

  const stepsRequested = action === "step" ? (rawSteps ?? 1) : 0;
  const rawEvents = params.events;
  if (rawEvents !== undefined && action !== "step") {
    throw new Error("Parameter \"events\" wird nur zusammen mit action=\"step\" unterstützt.");
  }
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) {
    throw new Error("Parameter \"events\" muss ein Array aus zeitgesteuerten Eingabe-Aktionen sein.");
  }

  const parsedEvents = (rawEvents ?? []).map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Eintrag events[${idx}] muss ein Objekt sein.`);
    }
    const obj = entry as Record<string, unknown>;
    const atStep = readOptionalInteger(obj, "atStep", 0, stepsRequested);
    if (atStep === undefined) {
      throw new Error(
        `events[${idx}].atStep ist erforderlich und muss eine Ganzzahl zwischen 0 und steps (${stepsRequested}) sein.`,
      );
    }
    const eventInstancePath = readOptionalStringArray(obj, "instancePath") ?? [];
    const buttonAction = parseButtonActionFields(obj, `events[${idx}]`);
    return {
      atStep,
      instancePath: eventInstancePath,
      ...buttonAction,
    };
  });

  const circuitId = readOptionalString(params, "circuitId");
  const instancePath = readOptionalStringArray(params, "instancePath") ?? [];
  const frameRateLimit = readOptionalFrameRateLimit(params, "frameRateLimit");
  const includeState = readOptionalBoolean(params, "includeState") ?? false;
  const symbolIds = readOptionalStringArray(params, "symbolIds");
  const includeScreenshot = readOptionalBoolean(params, "includeScreenshot") ?? false;
  const captureMode = readOptionalEnum(params, "captureMode", ALLOWED_CAPTURE_MODES) ?? "circuit";

  const initialSimState = sim.getState();

  if (action === "stop" || action === "reset") {
    if (instancePath.length > 0) {
      throw new Error(`"instancePath" kann bei action="${action}" nicht verwendet werden.`);
    }
    if (frameRateLimit !== undefined) {
      sim.setFrameRateLimit(frameRateLimit);
    }
    await sim.stopSimulation();
    if (circuitId) {
      const targetCircuit = resolveCircuit(snapshot, circuitId);
      const current = resolveLiveSnapshot(snapshot).currentCircuit;
      if (targetCircuit.logicalCircuitId !== current.logicalCircuitId) {
        snapshot.actions?.setCurrentCircuitId(targetCircuit.logicalCircuitId);
      }
    }

    let screenshot: McpImageResult | undefined;
    if (includeScreenshot) {
      await sim.waitForRender?.();
      const latestCircuit = resolveLiveSnapshot(snapshot).currentCircuit;
      screenshot = await captureCircuitSvg({ mode: captureMode, circuit: latestCircuit });
    }

    return {
      action,
      rootCircuitId: circuitId ?? initialSimState.rootCircuitMap?.circuit.logicalCircuitId ?? resolveLiveSnapshot(snapshot).currentCircuit.logicalCircuitId,
      instancePath: [],
      stepsCompleted: 0,
      telemetry: {
        isSimulating: false,
        isPaused: false,
        isRunning: false,
        isOscillating: false,
        hasClocks: false,
        actualFrequency: 0,
        totalSteps: 0,
      },
      ...(includeState ? { state: null } : {}),
      ...(screenshot ? { screenshot } : {}),
    };
  }

  let stepsCompleted = 0;
  let maxAppliedEventStep = -1;
  let scheduledTargets: {
    atStep: number;
    instancePath: string[];
    actionType: "toggle" | "on" | "off";
    scheduled: ScheduledButtonEvent;
    target: ResolvedButtonTarget;
  }[] = [];

  if (action === "pause") {
    if (!initialSimState.isSimulating || !initialSimState.rootCircuitMap) {
      throw new Error("Simulation läuft derzeit nicht und kann daher nicht pausiert werden.");
    }
    if (frameRateLimit !== undefined) {
      sim.setFrameRateLimit(frameRateLimit);
    }
    sim.pauseSimulation();
  } else if (action === "start") {
    const targetRoot = circuitId
      ? resolveCircuit(snapshot, circuitId)
      : (initialSimState.rootCircuitMap?.circuit ?? resolveLiveSnapshot(snapshot).currentCircuit);
    if (frameRateLimit !== undefined) {
      sim.setFrameRateLimit(frameRateLimit);
    }
    await sim.startSimulation(targetRoot);
  } else {
    const targetRoot = circuitId
      ? resolveCircuit(snapshot, circuitId)
      : (initialSimState.rootCircuitMap?.circuit ?? resolveLiveSnapshot(snapshot).currentCircuit);

    // Geplante Eingabe-Events vor dem Ausführen komplett gegen den Ziel-Schaltungsbaum prüfen
    if (parsedEvents.length > 0) {
      const validationMap =
        initialSimState.isSimulating &&
        initialSimState.rootCircuitMap?.circuit.logicalCircuitId === targetRoot.logicalCircuitId
          ? initialSimState.rootCircuitMap
          : (() => {
            const tempMap = new CircuitMap(targetRoot);
            tempMap.apply();
            return tempMap;
          })();

      scheduledTargets = parsedEvents.map((ev) => {
        const target = resolveButtonTarget(validationMap, ev.instancePath, ev.symbolId, ev.toggle);
        const actionType = ev.toggle ? "toggle" : (ev.on ? "on" : "off");
        return {
          atStep: ev.atStep,
          instancePath: ev.instancePath,
          actionType,
          scheduled: {
            atStep: ev.atStep,
            buttonId: target.buttonId,
            ...(ev.toggle ? { toggle: true } : { on: ev.on }),
          },
          target,
        };
      });
    }

    if (frameRateLimit !== undefined) {
      sim.setFrameRateLimit(frameRateLimit);
    }

    const explicitRoot = circuitId || !initialSimState.isSimulating ? targetRoot : undefined;
    const stepResult = await sim.step(
      stepsRequested,
      explicitRoot,
      scheduledTargets.length > 0 ? scheduledTargets.map((entry) => entry.scheduled) : undefined,
    );
    if (!stepResult) {
      const errorMsg = sim.getState().simulationError?.message;
      throw new Error(errorMsg ?? "Simulation konnte nicht fortgeschaltet werden.");
    }
    stepsCompleted = stepResult.stepsCompleted;
    maxAppliedEventStep = stepResult.maxAppliedEventStep ?? -1;
  }

  const liveSim = sim.getState();
  const rootMap = liveSim.rootCircuitMap;
  if (!liveSim.isSimulating || !rootMap || !liveSim.snapshot) {
    throw new Error(
      liveSim.simulationError?.message ??
        "Nach der Simulationsaktion liegt kein aktiver Simulationszustand vor.",
    );
  }

  const targetMap = resolveCircuitMapByPath(rootMap, instancePath);
  const currentEditorCircuit = resolveLiveSnapshot(snapshot).currentCircuit;
  if (
    (instancePath.length > 0 || includeScreenshot) &&
    (liveSim.selectedCircuitMap !== targetMap ||
      currentEditorCircuit.logicalCircuitId !== targetMap.circuit.logicalCircuitId)
  ) {
    sim.selectCircuitMap(targetMap);
  }

  const state = includeState
    ? buildSimulationStateReport(targetMap, liveSim.snapshot, instancePath, symbolIds)
    : undefined;

  let screenshot: McpImageResult | undefined;
  if (includeScreenshot) {
    await sim.waitForRender?.();
    screenshot = await captureCircuitSvg({ mode: captureMode, circuit: targetMap.circuit });
  }

  const finalTelemetry = liveSim.snapshot.telemetry;
  const executedStepLimit = Math.max(stepsCompleted, maxAppliedEventStep);
  const eventsExecuted = scheduledTargets.length > 0
    ? scheduledTargets
      .filter((entry) => entry.atStep <= executedStepLimit)
      .map((entry) => ({
        atStep: entry.atStep,
        symbolId: entry.target.sym.circuitSymbolId,
        buttonId: entry.target.buttonId,
        name: entry.target.sym.circuit.name,
        notation: entry.target.sym.circuit.notation,
        instancePath: entry.instancePath,
        action: entry.actionType,
        finalIsOn: liveSim.snapshot?.buttons[entry.target.buttonId]?.isOn ?? false,
      }))
    : undefined;

  return {
    action,
    rootCircuitId: rootMap.circuit.logicalCircuitId,
    instancePath,
    ...(action === "step" ? { stepsRequested, stepsCompleted } : {}),
    ...(eventsExecuted ? { eventsExecuted } : {}),
    telemetry: {
      isSimulating: liveSim.isSimulating,
      isPaused: liveSim.isPaused,
      isRunning: liveSim.isRunning,
      isOscillating: liveSim.isOscillating || finalTelemetry.isOscillating,
      hasClocks: finalTelemetry.hasClocks ?? false,
      actualFrequency: finalTelemetry.actualFrequency,
      frameRateLimit: liveSim.frameRateLimit,
      totalSteps: finalTelemetry.totalSteps,
    },
    ...(state !== undefined ? { state } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}
