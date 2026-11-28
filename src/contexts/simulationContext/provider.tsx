import React from "react";

import SimulationContext, {
  type SimulationCollabBridge,
  type SimulationStepResult,
} from ".";

import type CircuitButton from "../../types/circuit/circuitButton";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";
import type Wire from "../../types/circuit/wire";
import type CircuitCleanUpReport from "../../types/simulation/circuitCleanUpReport";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";
import type {
  OscilloscopeSnapshot,
  ProbeHistorySnapshot,
} from "../../types/simulation/oscilloscope";
import type SimulationError from "../../types/simulation/simulationError";
import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";
import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import AudioEngine, { type AudioPlaybackMode } from "../../audio/audioEngine";
import i18n from "../../i18n";
import CircuitException, { type CircuitExceptionCause } from "../../simulation/compiler/circuitException";
import CircuitMap from "../../simulation/compiler/circuitMap";
import SimulationClient from "../../simulation/worker/simulationClient";
import SnapshotScheduler from "../../simulation/worker/snapshotScheduler";
import type {
  MemorySliceData,
  ScheduledButtonEvent,
  SimulationSnapshot,
} from "../../simulation/worker/workerMessages";
import { AUDIO_DEFAULT_VOLUME } from "../../utils/audioPitchTable";
import {
  getKeyboardEventModifiers,
  isModifierOnlyKey,
  keyboardEventToWpfKeyCode,
  matchesKeyGesture,
} from "../../utils/keyGesture";
import { resolveFrequencyFromProject } from "../../utils/simulationSpeed";

import CircuitContext from "../circuitContext";

function collectCircuitButtons(rootMap: CircuitMap | null): CircuitButton[] {
  if (!rootMap) {
    return [];
  }
  const byId = new Map<string, CircuitButton>();
  const stack: CircuitMap[] = [rootMap];
  while (stack.length > 0) {
    const map = stack.pop()!;
    for (const sym of map.circuit.circuitSymbols) {
      if (sym.circuit.kind === "circuitButton") {
        const btn = sym.circuit as CircuitButton;
        const id = btn.circuitButtonId ?? btn.circuitId;
        if (!byId.has(id)) {
          byId.set(id, btn);
        }
      }
    }
    for (const child of map.children.values()) {
      stack.push(child);
    }
  }
  return Array.from(byId.values());
}

type PressedShortcutEntry = {
  buttonId: string;
  keyCode: number;
  modifiers: number;
};

type SimulationContextProviderProps = {
  children: React.ReactNode;
};

function computeWireStateMap(
  wires: Wire[] | undefined,
  snap: SimulationSnapshot | null,
  map: CircuitMap | null,
): Map<string, State> {
  const result = new Map<string, State>();
  if (!wires || !snap || !map) {
    return result;
  }

  for (const wire of wires) {
    const indices = map.stateIndexes(wire);
    if (indices.length === 0) {
      result.set(wire.wireId, STATE_OFF);
      continue;
    }

    let hasOn1 = false;
    let hasOn0 = false;
    for (const idx of indices) {
      if (idx === null || idx === undefined) {
        continue;
      }
      const s = snap.stateArray[idx] as State;
      if (s === STATE_ON1) {
        hasOn1 = true;
      } else if (s === STATE_ON0) {
        hasOn0 = true;
      }
    }

    result.set(wire.wireId, hasOn1 ? STATE_ON1 : hasOn0 ? STATE_ON0 : STATE_OFF);
  }

  return result;
}

function isCircuitInMap(map: CircuitMap, circuitId: string): boolean {
  if (map.circuit.logicalCircuitId === circuitId) {
    return true;
  }
  for (const child of map.children.values()) {
    if (isCircuitInMap(child, circuitId)) {
      return true;
    }
  }
  return false;
}

function findCircuitInMap(map: CircuitMap, circuitId: string): CircuitMap | null {
  if (map.circuit.logicalCircuitId === circuitId) {
    return map;
  }
  for (const child of map.children.values()) {
    const found = findCircuitInMap(child, circuitId);
    if (found) {
      return found;
    }
  }
  return null;
}

const SimulationContextProvider: React.FC<SimulationContextProviderProps> = ({ children }) => {
  const circuitContext = React.useContext(CircuitContext);
  const currentCircuit = circuitContext?.currentCircuit ?? null;
  const currentCircuitId = currentCircuit?.logicalCircuitId ?? "";

  const [isSimulating, setIsSimulating] = React.useState(false);
  const isSimulatingRef = React.useRef(false);
  isSimulatingRef.current = isSimulating;

  const [isPaused, setIsPaused] = React.useState(false);
  const isPausedRef = React.useRef(false);
  isPausedRef.current = isPaused;

  const [hasProbes, setHasProbes] = React.useState(false);
  const hasProbesRef = React.useRef(false);
  hasProbesRef.current = hasProbes;

  const [isOscilloscoping, setIsOscilloscoping] = React.useState(false);
  const isOscilloscopingRef = React.useRef(false);
  isOscilloscopingRef.current = isOscilloscoping;

  const [frameRateLimit, setFrameRateLimit] = React.useState<FrameRateLimit>(30);
  const frameRateLimitRef = React.useRef<FrameRateLimit>(30);
  frameRateLimitRef.current = frameRateLimit;

  const [snapshot, setSnapshot] = React.useState<SimulationSnapshot | null>(null);
  const snapshotRef = React.useRef<SimulationSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const [circuitMap, setCircuitMap] = React.useState<CircuitMap | null>(null);
  const circuitMapRef = React.useRef<CircuitMap | null>(null);
  circuitMapRef.current = circuitMap;

  const [selectedCircuitMap, setSelectedCircuitMap] = React.useState<CircuitMap | null>(null);
  const selectedCircuitMapRef = React.useRef<CircuitMap | null>(null);
  selectedCircuitMapRef.current = selectedCircuitMap;

  const [isOscillating, setIsOscillating] = React.useState(false);
  const isOscillatingRef = React.useRef(false);
  isOscillatingRef.current = isOscillating;

  const [oscillationLocation, setOscillationLocation] = React.useState<SimulationErrorLocation | null>(null);
  const oscillationLocationRef = React.useRef<SimulationErrorLocation | null>(null);
  oscillationLocationRef.current = oscillationLocation;

  const [simulationError, setSimulationError] = React.useState<SimulationError | null>(null);
  const simulationErrorRef = React.useRef<SimulationError | null>(null);
  simulationErrorRef.current = simulationError;

  const [actualFrequency, setActualFrequency] = React.useState(0);
  const actualFrequencyRef = React.useRef(0);
  actualFrequencyRef.current = actualFrequency;

  const [totalSteps, setTotalSteps] = React.useState(0);
  const totalStepsRef = React.useRef(0);
  totalStepsRef.current = totalSteps;

  const wireStateMapRef = React.useRef<Map<string, State>>(new Map());
  const cleanUpReportRef = React.useRef<CircuitCleanUpReport | null>(null);

  const clientRef = React.useRef<SimulationClient | null>(null);
  const stopPromiseRef = React.useRef<Promise<void> | null>(null);
  const collabBridgeRef = React.useRef<SimulationCollabBridge | null>(null);
  const commitSimulatedMemoryData = circuitContext?.commitSimulatedMemoryData;

  const registerCollabBridge = React.useCallback(
    (bridge: SimulationCollabBridge | null) => {
      collabBridgeRef.current = bridge;
    },
    [],
  );

  const isCollabSnapshotMode = React.useCallback(
    (): boolean => Boolean(collabBridgeRef.current?.isCollabSnapshotMode()),
    [],
  );

  const audioEngineRef = React.useRef<AudioEngine | null>(null);
  const audioVolume = circuitContext?.appSettings?.audioVolume ?? AUDIO_DEFAULT_VOLUME;
  const audioMuted = circuitContext?.appSettings?.audioMuted ?? false;
  const audioVolumeRef = React.useRef(audioVolume);
  audioVolumeRef.current = audioVolume;
  const audioMutedRef = React.useRef(audioMuted);
  audioMutedRef.current = audioMuted;

  const getAudioEngine = React.useCallback(
    (): AudioEngine => {
      if (!audioEngineRef.current) {
        const engine = new AudioEngine();
        engine.setMasterSettings(audioVolumeRef.current, audioMutedRef.current);
        audioEngineRef.current = engine;
      }
      return audioEngineRef.current;
    },
    [],
  );

  const syncSnapshotAudio = React.useCallback(
    (snap: SimulationSnapshot, playbackMode: AudioPlaybackMode) => {
      const channels = snap.audioChannels ? Object.values(snap.audioChannels) : [];
      if (channels.length === 0) {
        audioEngineRef.current?.silenceAll();
        return;
      }
      getAudioEngine().syncChannels(channels, playbackMode);
    },
    [getAudioEngine],
  );

  React.useEffect(
    () => {
      const engine = audioEngineRef.current;
      if (!engine) {
        return;
      }
      engine.setMasterSettings(audioVolume, audioMuted);
      if (
        !audioMuted &&
        audioVolume > 0 &&
        isSimulatingRef.current &&
        !isPausedRef.current &&
        !isOscillatingRef.current &&
        snapshotRef.current?.audioChannels
      ) {
        syncSnapshotAudio(snapshotRef.current, "continuous");
      }
    },
    [
      audioMuted,
      audioVolume,
      syncSnapshotAudio,
    ],
  );

  const syncActiveCleanUpReport = React.useCallback(
    (activeMap: CircuitMap | null) => {
      cleanUpReportRef.current = activeMap ? activeMap.analyzeCleanUp() : null;
    },
    [],
  );

  const clearSimulationError = React.useCallback(
    () => {
      simulationErrorRef.current = null;
      setSimulationError(null);
    },
    [],
  );

  const reportSimulationError = React.useCallback(
    (
      message: string,
      causeType: CircuitExceptionCause = "userError",
      location?: SimulationErrorLocation | null,
      isOscillationError = false,
    ) => {
      const nextError: SimulationError = {
        title: isOscillationError
          ? i18n.t("errors.simulation.oscillationTitle")
          : causeType === "internalError"
            ? i18n.t("errors.simulation.internalErrorTitle")
            : i18n.t("errors.simulation.simulationErrorTitle"),
        message,
        causeType,
        ...(isOscillationError ? { isOscillation: true } : {}),
        location: location ?? null,
      };
      simulationErrorRef.current = nextError;
      setSimulationError(nextError);
    },
    [],
  );

  const resetSimulationRuntimeState = React.useCallback(
    (sendStopToWorker = true) => {
      const wasSimulating = isSimulatingRef.current;
      if (sendStopToWorker) {
        void clientRef.current?.stop();
      }
      isSimulatingRef.current = false;
      setIsSimulating(false);
      isPausedRef.current = false;
      setIsPaused(false);
      hasProbesRef.current = false;
      setHasProbes(false);
      isOscilloscopingRef.current = false;
      setIsOscilloscoping(false);
      isOscillatingRef.current = false;
      setIsOscillating(false);
      oscillationLocationRef.current = null;
      setOscillationLocation(null);
      snapshotRef.current = null;
      setSnapshot(null);
      circuitMapRef.current = null;
      setCircuitMap(null);
      selectedCircuitMapRef.current = null;
      setSelectedCircuitMap(null);
      actualFrequencyRef.current = 0;
      setActualFrequency(0);
      totalStepsRef.current = 0;
      setTotalSteps(0);
      wireStateMapRef.current = new Map();
      cleanUpReportRef.current = null;
      pressedShortcutButtonsRef.current.clear();
      audioEngineRef.current?.silenceAll();
      if (wasSimulating) {
        collabBridgeRef.current?.onSimulationStateChange?.(false);
      }
    },
    [],
  );

  // Synchronisiert geänderte persistente RAMs (onStart === "data") aus dem Worker in das Projektmodell
  const flushPersistentMemories = React.useCallback(
    async (): Promise<boolean> => {
      const client = clientRef.current;
      if (!client || !isSimulatingRef.current || isCollabSnapshotMode()) {
        return false;
      }
      try {
        const dumps = await client.flushPersistentMemories();
        if (dumps.length === 0 || !commitSimulatedMemoryData) {
          return false;
        }
        return commitSimulatedMemoryData(dumps);
      } catch {
        return false;
      }
    },
    [commitSimulatedMemoryData, isCollabSnapshotMode],
  );

  // Beendet die Simulation synchronisiert mit Worker-Stopp und Rückschreiben persistenter RAMs
  const stopSimulation = React.useCallback(
    async (): Promise<void> => {
      if (stopPromiseRef.current) {
        return stopPromiseRef.current;
      }
      const client = clientRef.current;
      if (!client || !isSimulatingRef.current) {
        resetSimulationRuntimeState(false);
        return;
      }

      const run = (async () => {
        try {
          const dumps = await client.stop();
          if (dumps.length > 0 && !isCollabSnapshotMode()) {
            commitSimulatedMemoryData?.(dumps);
          }
        } finally {
          stopPromiseRef.current = null;
          resetSimulationRuntimeState(false);
        }
      })();

      stopPromiseRef.current = run;
      return run;
    },
    [
      commitSimulatedMemoryData,
      isCollabSnapshotMode,
      resetSimulationRuntimeState,
    ],
  );

  const handleWorkerStatusOscillation = React.useCallback(
    (location?: SimulationErrorLocation | null) => {
      const resolvedLocation = location ?? oscillationLocationRef.current ?? null;
      oscillationLocationRef.current = resolvedLocation;
      setOscillationLocation(resolvedLocation);
      if (!isOscillatingRef.current) {
        audioEngineRef.current?.silenceAll();
        isOscillatingRef.current = true;
        setIsOscillating(true);
        reportSimulationError(
          i18n.t("errors.simulation.oscillationMessage"),
          "userError",
          resolvedLocation,
          true,
        );
      }
    },
    [reportSimulationError],
  );

  const getClient = React.useCallback(
    (): SimulationClient => {
      if (!clientRef.current) {
        const client = new SimulationClient();
        clientRef.current = client;

        client.onStatusChange((status, telemetry) => {
          if (!isSimulatingRef.current && status !== "powerOff") {
            return;
          }
          if (telemetry.actualFrequency !== actualFrequencyRef.current) {
            actualFrequencyRef.current = telemetry.actualFrequency;
            setActualFrequency(telemetry.actualFrequency);
          }
          if (telemetry.totalSteps !== totalStepsRef.current) {
            totalStepsRef.current = telemetry.totalSteps;
            setTotalSteps(telemetry.totalSteps);
          }
          if (status === "oscillating") {
            handleWorkerStatusOscillation(telemetry.oscillationLocation);
          }
        });

        client.onError((errorMsg, _errorType, causeType, location) => {
          resetSimulationRuntimeState(false);
          reportSimulationError(
            errorMsg || i18n.t("errors.simulation.unexpectedError"),
            causeType ?? "userError",
            location ?? null,
          );
        });
      }
      return clientRef.current;
    },
    [
      handleWorkerStatusOscillation,
      reportSimulationError,
      resetSimulationRuntimeState,
    ],
  );

  React.useEffect(
    () => {
      return () => {
        audioEngineRef.current?.dispose();
        audioEngineRef.current = null;
        clientRef.current?.terminate();
        clientRef.current = null;
      };
    },
    [],
  );

  const isRunning = isSimulating && !isPaused;

  // Stoppe Simulation bei Schaltungswechsel, sofern Schaltung nicht Teil der laufenden Simulation ist
  const prevCircuitIdRef = React.useRef(currentCircuitId);
  React.useEffect(
    () => {
      if (prevCircuitIdRef.current !== currentCircuitId) {
        prevCircuitIdRef.current = currentCircuitId;
        if (isSimulatingRef.current) {
          const isKnownInMap = circuitMapRef.current ? isCircuitInMap(circuitMapRef.current, currentCircuitId) : false;
          if (isKnownInMap) {
            if (selectedCircuitMapRef.current?.circuit.logicalCircuitId !== currentCircuitId) {
              const found = circuitMapRef.current ? findCircuitInMap(circuitMapRef.current, currentCircuitId) : null;
              if (found) {
                selectedCircuitMapRef.current = found;
                setSelectedCircuitMap(found);
              }
            }
            const activeMap = selectedCircuitMapRef.current ?? circuitMapRef.current;
            wireStateMapRef.current = computeWireStateMap(
              activeMap?.circuit.wires ?? currentCircuit?.wires,
              snapshotRef.current,
              activeMap,
            );
            syncActiveCleanUpReport(activeMap);
          } else {
            void stopSimulation();
          }
        }
      }
    },
    [
      currentCircuit?.wires,
      currentCircuitId,
      stopSimulation,
      syncActiveCleanUpReport,
    ],
  );

  // Frequenz-Regelung für die UI über requestAnimationFrame (1, 2, 5, 10, 20, 30, 60 Hz & Max)
  React.useEffect(
    () => {
      if (!isRunning || isOscillating) {
        return;
      }

      const client = clientRef.current;
      if (!client) {
        return;
      }

      const scheduler = new SnapshotScheduler({
        client,
        frameRateLimit,
        onSnapshot: (snap) => {
          if (!isSimulatingRef.current || isPausedRef.current) {
            return;
          }
          const activeMap = selectedCircuitMapRef.current ?? circuitMapRef.current;
          snapshotRef.current = snap;
          wireStateMapRef.current = computeWireStateMap(
            activeMap?.circuit.wires ?? currentCircuit?.wires,
            snap,
            activeMap,
          );
          setSnapshot(snap);

          if (snap.telemetry.actualFrequency !== actualFrequencyRef.current) {
            actualFrequencyRef.current = snap.telemetry.actualFrequency;
            setActualFrequency(snap.telemetry.actualFrequency);
          }
          if (snap.telemetry.totalSteps !== totalStepsRef.current) {
            totalStepsRef.current = snap.telemetry.totalSteps;
            setTotalSteps(snap.telemetry.totalSteps);
          }
          if (
            snap.telemetry.isOscilloscoping !== undefined &&
            snap.telemetry.isOscilloscoping !== isOscilloscopingRef.current
          ) {
            isOscilloscopingRef.current = snap.telemetry.isOscilloscoping;
            setIsOscilloscoping(snap.telemetry.isOscilloscoping);
          }

          if (snap.telemetry.isOscillating) {
            handleWorkerStatusOscillation(snap.telemetry.oscillationLocation);
            scheduler.stop();
          } else {
            syncSnapshotAudio(snap, "continuous");
          }
        },
      });

      scheduler.start();

      return () => {
        scheduler.stop();
      };
    },
    [
      isRunning,
      isOscillating,
      frameRateLimit,
      currentCircuit?.wires,
      handleWorkerStatusOscillation,
      syncSnapshotAudio,
    ],
  );

  // Synchronisiert Snapshot, wireStateMap und Telemetrie-Zustände in einem gemeinsamen Schritt
  const applySnapshotUpdate = React.useCallback(
    (
      snap: SimulationSnapshot,
      fallbackMap?: CircuitMap | null,
      audioPlaybackMode?: AudioPlaybackMode,
    ) => {
      const activeMap = selectedCircuitMapRef.current ?? fallbackMap ?? circuitMapRef.current;
      snapshotRef.current = snap;
      wireStateMapRef.current = computeWireStateMap(
        activeMap?.circuit.wires ?? currentCircuit?.wires,
        snap,
        activeMap,
      );
      setSnapshot(snap);
      if (snap.telemetry.actualFrequency !== actualFrequencyRef.current) {
        actualFrequencyRef.current = snap.telemetry.actualFrequency;
        setActualFrequency(snap.telemetry.actualFrequency);
      }
      if (snap.telemetry.totalSteps !== totalStepsRef.current) {
        totalStepsRef.current = snap.telemetry.totalSteps;
        setTotalSteps(snap.telemetry.totalSteps);
      }
      if (
        snap.telemetry.isOscilloscoping !== undefined &&
        snap.telemetry.isOscilloscoping !== isOscilloscopingRef.current
      ) {
        isOscilloscopingRef.current = snap.telemetry.isOscilloscoping;
        setIsOscilloscoping(snap.telemetry.isOscilloscoping);
      }
      if (snap.telemetry.isOscillating) {
        handleWorkerStatusOscillation(snap.telemetry.oscillationLocation);
      } else if (audioPlaybackMode) {
        syncSnapshotAudio(snap, audioPlaybackMode);
      }
    },
    [
      currentCircuit?.wires,
      handleWorkerStatusOscillation,
      syncSnapshotAudio,
    ],
  );

  const handleThrownSimulationError = React.useCallback(
    (err: unknown) => {
      resetSimulationRuntimeState();
      if (err instanceof CircuitException) {
        reportSimulationError(err.message, err.causeType, err.location ?? null);
        return;
      }
      const message = err instanceof Error && err.message
        ? err.message
        : i18n.t("errors.simulation.unexpectedStartError");
      reportSimulationError(message, "userError", null);
    },
    [reportSimulationError, resetSimulationRuntimeState],
  );

  // Kompiliert die angegebene Root-Schaltung und initialisiert den WebWorker
  const initializeSimulation = React.useCallback(
    async (
      rootCircuit: LogicalCircuit,
      paused: boolean,
    ): Promise<{ client: SimulationClient; map: CircuitMap } | null> => {
      const client = getClient();
      if (stopPromiseRef.current) {
        await stopPromiseRef.current;
      }
      let effectiveRoot = rootCircuit;
      if (isSimulatingRef.current) {
        const dumps = await client.stop();
        if (dumps.length > 0 && !isCollabSnapshotMode()) {
          commitSimulatedMemoryData?.(dumps);
          const refreshed = circuitContext?.project?.logicalCircuits.find(
            (lc) => lc.logicalCircuitId === rootCircuit.logicalCircuitId,
          );
          if (refreshed) {
            effectiveRoot = refreshed;
          }
        }
      }
      clearSimulationError();

      try {
        const map = new CircuitMap(effectiveRoot);
        map.apply();
        const ready = await client.init(effectiveRoot);

        isSimulatingRef.current = true;
        setIsSimulating(true);
        collabBridgeRef.current?.onSimulationStateChange?.(true);
        isPausedRef.current = paused;
        setIsPaused(paused);
        hasProbesRef.current = ready.probeCount > 0;
        setHasProbes(ready.probeCount > 0);
        isOscilloscopingRef.current = false;
        setIsOscilloscoping(false);
        isOscillatingRef.current = false;
        setIsOscillating(false);
        oscillationLocationRef.current = null;
        setOscillationLocation(null);
        totalStepsRef.current = 0;
        setTotalSteps(0);

        circuitMapRef.current = map;
        setCircuitMap(map);
        selectedCircuitMapRef.current = map;
        setSelectedCircuitMap(map);
        syncActiveCleanUpReport(map);

        if (circuitContext?.setCurrentCircuitId && effectiveRoot.logicalCircuitId !== currentCircuitId) {
          circuitContext.setCurrentCircuitId(effectiveRoot.logicalCircuitId);
        }

        return { client, map };
      } catch (err) {
        handleThrownSimulationError(err);
        return null;
      }
    },
    [
      circuitContext,
      clearSimulationError,
      commitSimulatedMemoryData,
      currentCircuitId,
      getClient,
      handleThrownSimulationError,
      isCollabSnapshotMode,
      syncActiveCleanUpReport,
    ],
  );

  // Startet den Dauerlauf (optional auf expliziter Root-Schaltung)
  const startSimulation = React.useCallback(
    async (targetCircuit?: LogicalCircuit): Promise<SimulationSnapshot | null> => {
      const rootCircuit = targetCircuit ?? circuitContext?.currentCircuit ?? currentCircuit;
      if (!rootCircuit) {
        return null;
      }
      getAudioEngine().unlock();
      const initialized = await initializeSimulation(rootCircuit, false);
      if (!initialized) {
        return null;
      }
      const { client, map } = initialized;
      try {
        client.setSpeed(frameRateLimitRef.current);
        client.start();

        const snap = await client.pullSnapshot();
        if (snap && isSimulatingRef.current) {
          applySnapshotUpdate(snap, map, "continuous");
        }
        return snap ?? null;
      } catch (err) {
        handleThrownSimulationError(err);
        return null;
      }
    },
    [
      applySnapshotUpdate,
      circuitContext,
      currentCircuit,
      getAudioEngine,
      handleThrownSimulationError,
      initializeSimulation,
    ],
  );

  // Initialisiert bei Bedarf eine Schaltung im pausierten Zustand ohne Takt-Fortschaltung
  const ensurePausedSimulation = React.useCallback(
    async (
      targetCircuit?: LogicalCircuit,
    ): Promise<{ snapshot: SimulationSnapshot; rootCircuitMap: CircuitMap } | null> => {
      const rootCircuit = targetCircuit ?? circuitContext?.currentCircuit ?? currentCircuit;
      if (!rootCircuit) {
        return null;
      }
      const client = getClient();
      try {
        if (
          isSimulatingRef.current &&
          circuitMapRef.current &&
          circuitMapRef.current.circuit.logicalCircuitId === rootCircuit.logicalCircuitId
        ) {
          const snap = snapshotRef.current ?? (await client.pullSnapshot());
          if (snap) {
            applySnapshotUpdate(snap, circuitMapRef.current);
          }
          return snap ? { snapshot: snap, rootCircuitMap: circuitMapRef.current } : null;
        }

        const initialized = await initializeSimulation(rootCircuit, true);
        if (!initialized) {
          return null;
        }
        const stabilized = await initialized.client.step(0);
        if (!stabilized) {
          return null;
        }
        applySnapshotUpdate(stabilized.snapshot, initialized.map);
        return { snapshot: stabilized.snapshot, rootCircuitMap: initialized.map };
      } catch (err) {
        handleThrownSimulationError(err);
        return null;
      }
    },
    [
      applySnapshotUpdate,
      circuitContext,
      currentCircuit,
      getClient,
      handleThrownSimulationError,
      initializeSimulation,
    ],
  );

  // Pausiert die laufende Simulation und flusht geänderte persistente RAM-Daten in das Projektmodell
  const pauseSimulation = React.useCallback(
    () => {
      isPausedRef.current = true;
      setIsPaused(true);
      actualFrequencyRef.current = 0;
      setActualFrequency(0);
      audioEngineRef.current?.silenceAll();
      clientRef.current?.pause();
      void flushPersistentMemories();
    },
    [flushPersistentMemories],
  );

  // Führt exakt steps Einzelschritte deterministisch aus (F10 / MCP step_simulation)
  const step = React.useCallback(
    async (
      count = 1,
      targetCircuit?: LogicalCircuit,
      events?: ScheduledButtonEvent[],
    ): Promise<SimulationStepResult | null> => {
      getAudioEngine().unlock();
      const normalizedSteps = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 1;
      const rootCircuit =
        targetCircuit ??
        circuitMapRef.current?.circuit ??
        circuitContext?.currentCircuit ??
        currentCircuit;
      if (!rootCircuit) {
        return null;
      }

      const switchingRoot =
        Boolean(targetCircuit) &&
        isSimulatingRef.current &&
        circuitMapRef.current !== null &&
        circuitMapRef.current.circuit.logicalCircuitId !== targetCircuit!.logicalCircuitId;

      let client = getClient();
      let map = circuitMapRef.current;

      if (!isSimulatingRef.current || !map || switchingRoot) {
        const initialized = await initializeSimulation(rootCircuit, true);
        if (!initialized) {
          return null;
        }
        client = initialized.client;
        map = initialized.map;
      } else if (!isPausedRef.current) {
        pauseSimulation();
      }

      try {
        const result = await client.step(normalizedSteps, events);
        if (!result) {
          return null;
        }
        applySnapshotUpdate(result.snapshot, map, "singleStep");
        return {
          stepsCompleted: result.stepsCompleted,
          maxAppliedEventStep: result.maxAppliedEventStep,
          snapshot: result.snapshot,
          rootCircuitMap: map,
        };
      } catch (err) {
        handleThrownSimulationError(err);
        return null;
      }
    },
    [
      applySnapshotUpdate,
      circuitContext,
      currentCircuit,
      getAudioEngine,
      getClient,
      handleThrownSimulationError,
      initializeSimulation,
      pauseSimulation,
    ],
  );

  // Schaltet zwischen Play und Pause um
  const toggleRunning = React.useCallback(
    () => {
      if (!isSimulatingRef.current) {
        void startSimulation();
      } else if (isPausedRef.current) {
        getAudioEngine().unlock();
        isPausedRef.current = false;
        setIsPaused(false);
        clientRef.current?.start();
        if (snapshotRef.current && !isOscillatingRef.current) {
          syncSnapshotAudio(snapshotRef.current, "continuous");
        }
      } else {
        pauseSimulation();
      }
    },
    [
      getAudioEngine,
      pauseSimulation,
      startSimulation,
      syncSnapshotAudio,
    ],
  );

  const reset = React.useCallback(
    async () => {
      await stopSimulation();
    },
    [stopSimulation],
  );

  // Liest eine Speicherseite für den Live-Speicherinspektor aus dem Worker
  const readMemorySlice = React.useCallback(
    async (
      memoryInstanceId: string,
      startAddress: number,
      count: number,
    ): Promise<MemorySliceData | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        return await clientRef.current.readMemorySlice(memoryInstanceId, startAddress, count);
      } catch {
        return null;
      }
    },
    [],
  );

  // Schreibt im pausierten Zustand eine einzelne RAM-Zelle und aktualisiert sofort den Snapshot
  const writeMemoryCell = React.useCallback(
    async (memoryInstanceId: string, address: number, value: number): Promise<boolean> => {
      if (!clientRef.current || !isSimulatingRef.current || !isPausedRef.current) {
        return false;
      }
      try {
        const result = await clientRef.current.writeMemoryCell(
          memoryInstanceId,
          address,
          value,
        );
        if (result.snapshot && isSimulatingRef.current) {
          applySnapshotUpdate(
            result.snapshot,
            undefined,
            isPausedRef.current ? "singleStep" : "continuous",
          );
        }
        return result.success;
      } catch {
        return false;
      }
    },
    [applySnapshotUpdate],
  );

  // Aktiviert oder pausiert die Oszilloskop-Aufzeichnung im WebWorker
  const setOscilloscoping = React.useCallback(
    async (enabled: boolean): Promise<OscilloscopeSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        const data = await clientRef.current.setOscilloscoping(enabled);
        if (data && isSimulatingRef.current) {
          isOscilloscopingRef.current = data.isOscilloscoping;
          setIsOscilloscoping(data.isOscilloscoping);
        }
        return data;
      } catch {
        return null;
      }
    },
    [],
  );

  // Liest alle Oszilloskop-Spuren aus dem WebWorker
  const readOscilloscope = React.useCallback(
    async (): Promise<OscilloscopeSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        const data = await clientRef.current.readOscilloscope();
        if (data && isSimulatingRef.current && data.isOscilloscoping !== isOscilloscopingRef.current) {
          isOscilloscopingRef.current = data.isOscilloscoping;
          setIsOscilloscoping(data.isOscilloscoping);
        }
        return data;
      } catch {
        return null;
      }
    },
    [],
  );

  // Leert alle Oszilloskop-Spuren im WebWorker
  const clearOscilloscope = React.useCallback(
    async (): Promise<OscilloscopeSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        return await clientRef.current.clearOscilloscope();
      } catch {
        return null;
      }
    },
    [],
  );

  // Liest den Wertänderungsverlauf einer einzelnen Messsonde aus dem WebWorker
  const readProbeHistory = React.useCallback(
    async (probeId: string): Promise<ProbeHistorySnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        return await clientRef.current.readProbeHistory(probeId);
      } catch {
        return null;
      }
    },
    [],
  );

  // Fügt eine visuelle Trennmarkierung in den Verlauf einer Messsonde ein
  const markProbeHistory = React.useCallback(
    async (probeId: string): Promise<ProbeHistorySnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        return await clientRef.current.markProbeHistory(probeId);
      } catch {
        return null;
      }
    },
    [],
  );

  // Synchronisiert die Ziel-Taktfrequenz mit den Projekteinstellungen (Frequenz / Max-Speed)
  const projectFrequency = circuitContext?.project?.project?.frequency;
  const projectIsMaxSpeed = circuitContext?.project?.project?.isMaximumSpeed;
  React.useEffect(
    () => {
      if (projectFrequency === undefined || projectIsMaxSpeed === undefined) {
        return;
      }
      if (isSimulating && collabBridgeRef.current?.isCollabSnapshotMode()) {
        return;
      }
      const nextLimit = resolveFrequencyFromProject(projectFrequency, projectIsMaxSpeed);
      if (frameRateLimitRef.current !== nextLimit) {
        frameRateLimitRef.current = nextLimit;
        setFrameRateLimit(nextLimit);
        clientRef.current?.setSpeed(nextLimit);
      }
    },
    [
      isSimulating,
      projectFrequency,
      projectIsMaxSpeed,
    ],
  );

  // Geschwindigkeit / Framerate anpassen (in kollaborativer Snapshot-Simulation streng lokal)
  const handleSetFrameRateLimit = React.useCallback(
    (limit: FrameRateLimit) => {
      frameRateLimitRef.current = limit;
      setFrameRateLimit(limit);
      clientRef.current?.setSpeed(limit);
      if (isSimulatingRef.current && isCollabSnapshotMode()) {
        return;
      }
      if (circuitContext?.updateProjectProperties) {
        if (limit === "max") {
          circuitContext.updateProjectProperties({ isMaximumSpeed: true });
        } else {
          circuitContext.updateProjectProperties({
            frequency: limit,
            isMaximumSpeed: false,
          });
        }
      }
    },
    [circuitContext, isCollabSnapshotMode],
  );

  // Fordert den aktuellen Snapshot vom WebWorker an und synchronisiert UI-Refs
  const pullSnapshot = React.useCallback(
    async (audioPlaybackMode?: AudioPlaybackMode): Promise<SimulationSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      try {
        const snap = await clientRef.current.pullSnapshot();
        if (snap && isSimulatingRef.current) {
          applySnapshotUpdate(snap, undefined, audioPlaybackMode);
        }
        return snap ?? null;
      } catch (err) {
        handleThrownSimulationError(err);
        return null;
      }
    },
    [applySnapshotUpdate, handleThrownSimulationError],
  );

  // Taster drücken oder loslassen
  const setButtonState = React.useCallback(
    async (buttonId: string, pressed: boolean): Promise<SimulationSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      getAudioEngine().unlock();
      clientRef.current.setButtonState(buttonId, pressed);
      return pullSnapshot(isPausedRef.current ? "singleStep" : "continuous");
    },
    [getAudioEngine, pullSnapshot],
  );

  // Wechselschalter (Toggle) umschalten
  const toggleButton = React.useCallback(
    async (buttonId: string): Promise<SimulationSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      getAudioEngine().unlock();
      clientRef.current.toggleButton(buttonId);
      return pullSnapshot(isPausedRef.current ? "singleStep" : "continuous");
    },
    [getAudioEngine, pullSnapshot],
  );

  // Sensorwert setzen (z. B. manuell, ASCII oder KeyCode)
  const setSensorValue = React.useCallback(
    async (sensorId: string, value: number): Promise<SimulationSnapshot | null> => {
      if (!clientRef.current || !isSimulatingRef.current) {
        return null;
      }
      getAudioEngine().unlock();
      clientRef.current.setSensorValue(sensorId, value);
      return pullSnapshot(isPausedRef.current ? "singleStep" : "continuous");
    },
    [getAudioEngine, pullSnapshot],
  );

  const playPreviewTone = React.useCallback(
    (mode: SynthesizerMode, frequencyHz: number) => {
      getAudioEngine().playPreviewTone(mode, frequencyHz);
    },
    [getAudioEngine],
  );

  // Navigiert im Schaltungsbaum zu einer Sub-Schaltungsinstanz
  const selectCircuitMap = React.useCallback(
    (map: CircuitMap) => {
      selectedCircuitMapRef.current = map;
      setSelectedCircuitMap(map);
      if (circuitContext?.setCurrentCircuitId) {
        circuitContext.setCurrentCircuitId(map.circuit.logicalCircuitId);
      }
      wireStateMapRef.current = computeWireStateMap(
        map.circuit.wires,
        snapshotRef.current,
        map,
      );
      syncActiveCleanUpReport(map);
    },
    [circuitContext, syncActiveCleanUpReport],
  );

  const getWireState = React.useCallback(
    (wire: Wire): State | null => {
      if (!isSimulatingRef.current) {
        return null;
      }
      return wireStateMapRef.current.get(wire.wireId) ?? STATE_OFF;
    },
    [],
  );

  const pressedShortcutButtonsRef = React.useRef<Map<string, PressedShortcutEntry>>(new Map());

  // Globale Tastenkürzel (F5 = Start/Pause, Shift+F5 = Stopp, F10 = Einzelschritt sowie Button-Shortcuts)
  React.useEffect(
    () => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }

        if (e.key === "F5") {
          e.preventDefault();
          if (e.shiftKey) {
            void stopSimulation();
          } else {
            toggleRunning();
          }
          return;
        }
        if (e.key === "F10") {
          e.preventDefault();
          void step();
          return;
        }

        if (!isSimulatingRef.current || e.repeat || isModifierOnlyKey(e.key)) {
          return;
        }

        const buttons = collectCircuitButtons(circuitMapRef.current);
        let matched = false;
        for (const btn of buttons) {
          if (btn.keyCode <= 0 || !matchesKeyGesture(e, btn.keyCode, btn.modifiers)) {
            continue;
          }
          matched = true;
          const buttonId = btn.circuitButtonId ?? btn.circuitId;
          if (btn.isToggle) {
            void toggleButton(buttonId);
          } else {
            pressedShortcutButtonsRef.current.set(buttonId, {
              buttonId,
              keyCode: btn.keyCode,
              modifiers: btn.modifiers,
            });
            void setButtonState(buttonId, true);
          }
        }
        if (matched) {
          e.preventDefault();
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (!isSimulatingRef.current || pressedShortcutButtonsRef.current.size === 0) {
          return;
        }
        const releasedKeyCode = keyboardEventToWpfKeyCode(e);
        const activeModifiers = getKeyboardEventModifiers(e);
        for (const [btnId, entry] of pressedShortcutButtonsRef.current.entries()) {
          const keyReleased = !isModifierOnlyKey(e.key) && releasedKeyCode === entry.keyCode;
          const modifierReleased = (entry.modifiers & activeModifiers) !== entry.modifiers;
          if (keyReleased || modifierReleased) {
            pressedShortcutButtonsRef.current.delete(btnId);
            void setButtonState(btnId, false);
          }
        }
      };

      const handleWindowBlur = () => {
        if (!isSimulatingRef.current || pressedShortcutButtonsRef.current.size === 0) {
          return;
        }
        for (const btnId of pressedShortcutButtonsRef.current.keys()) {
          void setButtonState(btnId, false);
        }
        pressedShortcutButtonsRef.current.clear();
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      window.addEventListener("blur", handleWindowBlur);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        window.removeEventListener("blur", handleWindowBlur);
      };
    },
    [
      setButtonState,
      step,
      stopSimulation,
      toggleButton,
      toggleRunning,
    ],
  );

  return (
    <SimulationContext.Provider
      value={{
        get isSimulating() {
          return isSimulatingRef.current;
        },
        get isPaused() {
          return isPausedRef.current;
        },
        get isRunning() {
          return isSimulatingRef.current && !isPausedRef.current;
        },
        get hasProbes() {
          return hasProbesRef.current;
        },
        get isOscilloscoping() {
          return isOscilloscopingRef.current;
        },
        get frameRateLimit() {
          return frameRateLimitRef.current;
        },
        setFrameRateLimit: handleSetFrameRateLimit,
        startSimulation,
        ensurePausedSimulation,
        pauseSimulation,
        step,
        stopSimulation,
        toggleRunning,
        reset,
        flushPersistentMemories,
        readMemorySlice,
        writeMemoryCell,
        setOscilloscoping,
        readOscilloscope,
        clearOscilloscope,
        readProbeHistory,
        markProbeHistory,
        get snapshot() {
          return snapshotRef.current;
        },
        get circuitMap() {
          return circuitMapRef.current;
        },
        get rootCircuitMap() {
          return circuitMapRef.current;
        },
        get selectedCircuitMap() {
          return selectedCircuitMapRef.current;
        },
        selectCircuitMap,
        get wireStateMap() {
          return wireStateMapRef.current;
        },
        get cleanUpReport() {
          return cleanUpReportRef.current;
        },
        get isOscillating() {
          return isOscillatingRef.current;
        },
        get oscillationLocation() {
          return oscillationLocationRef.current;
        },
        get simulationError() {
          return simulationErrorRef.current;
        },
        clearSimulationError,
        get actualFrequency() {
          return actualFrequencyRef.current;
        },
        get totalSteps() {
          return totalStepsRef.current;
        },
        setButtonState,
        toggleButton,
        setSensorValue,
        pullSnapshot,
        getWireState,
        playPreviewTone,
        registerCollabBridge,
        get isCollabSnapshotSimulation() {
          return isSimulatingRef.current && Boolean(collabBridgeRef.current?.isCollabSnapshotMode());
        },
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

export default SimulationContextProvider;
