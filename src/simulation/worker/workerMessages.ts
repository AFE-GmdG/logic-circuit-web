import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type SensorType from "../../types/circuit/sensorType";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";
import type GraphicsArraySnapshot from "../../types/simulation/graphicsArraySnapshot";
import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";

import type { CircuitExceptionCause } from "../compiler/circuitException";

// Snapshot eines einzelnen Messfühlers (Probe)
export type ProbeSnapshot = {
  probeId: string;
  label: string;
  bitWidth: number;
  value: number | null;
  text: string;
};

// Snapshot eines Tasters oder Schalters (Button)
export type ButtonSnapshot = {
  buttonId: string;
  isToggle: boolean;
  isOn: boolean;
};

// Snapshot eines Sensors
export type SensorSnapshot = {
  sensorId: string;
  sensorType: SensorType;
  bitWidth: number;
  value: number;
  text: string;
};

// Live-Audiozustand eines Summers oder Synthesizers
export type AudioChannelSnapshot = {
  channelId: string;
  kind: "sound" | "synthesizer";
  active: boolean;
  mode: SynthesizerMode;
  frequencyHz: number | null;
  channelGain: number;
  noisePlaybackRate?: number | null;
  rawPitch?: number | null;
  rawVolume?: number | null;
};

// Telemetriedaten des Simulationslaufs
export type SimulationTelemetry = {
  isRunning: boolean;
  isPaused: boolean;
  isOscillating: boolean;
  oscillationLocation?: SimulationErrorLocation | null;
  hasClocks?: boolean;
  actualFrequency: number;
  totalSteps: number;
  timestamp: number;
};

// Zeitgesteuertes Eingabe-Ereignis für deterministisches Stepping (z. B. MCP step_simulation)
export type ScheduledButtonEvent = {
  atStep: number;
  buttonId: string;
  on?: boolean;
  toggle?: boolean;
};

// Ausschnitt eines Speichers für das bedarfsgesteuerte Paging im Live-Inspektor
export type MemorySliceData = {
  memoryInstanceId: string;
  memoryId: string;
  startAddress: number;
  count: number;
  totalCells: number;
  addressBitWidth: number;
  dataBitWidth: number;
  writable: boolean;
  revision: number;
  bytes: Uint8Array;
};

// Persistenter RAM-Inhalt zur Rücksynchronisierung in Memory.data
export type PersistentMemoryDump = {
  memoryId: string;
  data: string;
};

// Atomarer Gesamtzustand für den UI-Thread
export type SimulationSnapshot = {
  stateArray: Uint8Array;
  probes: Record<string, ProbeSnapshot>;
  buttons: Record<string, ButtonSnapshot>;
  sensors?: Record<string, SensorSnapshot>;
  ledMatrices?: Record<string, number[][]>;
  graphicsArrays?: Record<string, GraphicsArraySnapshot>;
  memoryRevisions?: Record<string, number>;
  audioChannels?: Record<string, AudioChannelSnapshot>;
  telemetry: SimulationTelemetry;
};

// Befehle vom Hauptthread an den WebWorker
export type WorkerCommand =
  | { type: "INIT"; circuit: LogicalCircuit; historySize?: number; sharedBuffer?: SharedArrayBuffer }
  | { type: "START" }
  | { type: "PAUSE" }
  | { type: "STOP"; requestId?: number }
  | { type: "STEP"; count?: number; events?: ScheduledButtonEvent[] }
  | { type: "SET_SPEED"; frameRateLimit: FrameRateLimit }
  | { type: "SET_BUTTON"; buttonId: string; pressed: boolean }
  | { type: "TOGGLE_BUTTON"; buttonId: string }
  | { type: "SET_SENSOR_VALUE"; sensorId: string; value: number }
  | { type: "PULL_SNAPSHOT" }
  | {
    type: "READ_MEMORY_SLICE";
    requestId: number;
    memoryInstanceId: string;
    startAddress: number;
    count: number;
  }
  | {
    type: "WRITE_MEMORY_CELL";
    requestId: number;
    memoryInstanceId: string;
    address: number;
    value: number;
  }
  | { type: "FLUSH_PERSISTENT_MEMORIES"; requestId: number };

// Antworten und Ereignisse vom WebWorker an den Hauptthread
export type WorkerResponse =
  | { type: "READY"; success: true; probeCount: number; buttonCount: number; stateCount: number }
  | {
    type: "ERROR";
    error: string;
    errorType?: string;
    causeType?: CircuitExceptionCause;
    location?: SimulationErrorLocation;
  }
  | {
    type: "STATUS_UPDATE";
    status: "powerOn" | "powerOff" | "running" | "paused" | "oscillating";
    telemetry: SimulationTelemetry;
  }
  | {
    type: "STEP_DONE";
    stepsCompleted: number;
    maxAppliedEventStep?: number;
    snapshot: SimulationSnapshot;
  }
  | { type: "SNAPSHOT"; snapshot: SimulationSnapshot }
  | { type: "STOPPED"; requestId?: number; persistentMemories: PersistentMemoryDump[] }
  | { type: "MEMORY_SLICE"; requestId: number; slice: MemorySliceData | null }
  | {
    type: "MEMORY_CELL_WRITTEN";
    requestId: number;
    success: boolean;
    revision: number;
    snapshot?: SimulationSnapshot;
  }
  | { type: "PERSISTENT_MEMORIES_FLUSHED"; requestId: number; persistentMemories: PersistentMemoryDump[] };
