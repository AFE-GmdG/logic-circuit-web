import React from "react";

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

import type CircuitMap from "../../simulation/compiler/circuitMap";
import type {
  MemorySliceData,
  ScheduledButtonEvent,
  SimulationSnapshot,
} from "../../simulation/worker/workerMessages";

export type SimulationCollabBridge = {
  isCollabSnapshotMode: () => boolean;
  onSimulationStateChange?: (isSimulating: boolean) => void;
};

export type SimulationStepResult = {
  stepsCompleted: number;
  maxAppliedEventStep?: number;
  snapshot: SimulationSnapshot;
  rootCircuitMap: CircuitMap;
};

export type SimulationContextType = {
  isSimulating: boolean;
  isPaused: boolean;
  isRunning: boolean;
  hasProbes: boolean;
  isOscilloscoping: boolean;
  frameRateLimit: FrameRateLimit;
  setFrameRateLimit: (limit: FrameRateLimit) => void;
  startSimulation: (targetCircuit?: LogicalCircuit) => Promise<SimulationSnapshot | null>;
  ensurePausedSimulation: (targetCircuit?: LogicalCircuit) => Promise<{
    snapshot: SimulationSnapshot;
    rootCircuitMap: CircuitMap;
  } | null>;
  pauseSimulation: () => void;
  step: (
    steps?: number,
    targetCircuit?: LogicalCircuit,
    events?: ScheduledButtonEvent[],
  ) => Promise<SimulationStepResult | null>;
  stopSimulation: () => Promise<void>;
  toggleRunning: () => void;
  reset: () => Promise<void>;
  flushPersistentMemories: () => Promise<boolean>;
  readMemorySlice: (
    memoryInstanceId: string,
    startAddress: number,
    count: number,
  ) => Promise<MemorySliceData | null>;
  writeMemoryCell: (memoryInstanceId: string, address: number, value: number) => Promise<boolean>;
  setOscilloscoping: (enabled: boolean) => Promise<OscilloscopeSnapshot | null>;
  readOscilloscope: () => Promise<OscilloscopeSnapshot | null>;
  clearOscilloscope: () => Promise<OscilloscopeSnapshot | null>;
  readProbeHistory: (probeId: string) => Promise<ProbeHistorySnapshot | null>;
  markProbeHistory: (probeId: string) => Promise<ProbeHistorySnapshot | null>;
  snapshot: SimulationSnapshot | null;
  circuitMap: CircuitMap | null;
  rootCircuitMap: CircuitMap | null;
  selectedCircuitMap: CircuitMap | null;
  selectCircuitMap: (map: CircuitMap) => void;
  wireStateMap: Map<string, State>;
  cleanUpReport?: CircuitCleanUpReport | null;
  isOscillating: boolean;
  oscillationLocation?: SimulationErrorLocation | null;
  simulationError?: SimulationError | null;
  clearSimulationError?: () => void;
  actualFrequency: number;
  totalSteps: number;
  setButtonState: (buttonId: string, pressed: boolean) => Promise<SimulationSnapshot | null>;
  toggleButton: (buttonId: string) => Promise<SimulationSnapshot | null>;
  setSensorValue: (sensorId: string, value: number) => Promise<SimulationSnapshot | null>;
  pullSnapshot: () => Promise<SimulationSnapshot | null>;
  getWireState: (wire: Wire) => State | null;
  playPreviewTone?: (mode: SynthesizerMode, frequencyHz: number) => void;
  registerCollabBridge?: (bridge: SimulationCollabBridge | null) => void;
  isCollabSnapshotSimulation?: boolean;
};

export const DEFAULT_SIMULATION_STATE: SimulationContextType = {
  isSimulating: false,
  isPaused: false,
  isRunning: false,
  hasProbes: false,
  isOscilloscoping: false,
  frameRateLimit: 30,
  setFrameRateLimit: () => {},
  startSimulation: async () => null,
  ensurePausedSimulation: async () => null,
  pauseSimulation: () => {},
  step: async () => null,
  stopSimulation: async () => {},
  toggleRunning: () => {},
  reset: async () => {},
  flushPersistentMemories: async () => false,
  readMemorySlice: async () => null,
  writeMemoryCell: async () => false,
  setOscilloscoping: async () => null,
  readOscilloscope: async () => null,
  clearOscilloscope: async () => null,
  readProbeHistory: async () => null,
  markProbeHistory: async () => null,
  snapshot: null,
  circuitMap: null,
  rootCircuitMap: null,
  selectedCircuitMap: null,
  selectCircuitMap: () => {},
  wireStateMap: new Map(),
  cleanUpReport: null,
  isOscillating: false,
  oscillationLocation: null,
  simulationError: null,
  clearSimulationError: () => {},
  actualFrequency: 0,
  totalSteps: 0,
  setButtonState: async () => null,
  toggleButton: async () => null,
  setSensorValue: async () => null,
  pullSnapshot: async () => null,
  getWireState: () => null,
  playPreviewTone: () => {},
  isCollabSnapshotSimulation: false,
};

const SimulationContext = React.createContext<SimulationContextType>(DEFAULT_SIMULATION_STATE);

export default SimulationContext;
