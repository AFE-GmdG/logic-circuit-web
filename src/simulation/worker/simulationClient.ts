import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";
import type GraphicsArraySnapshot from "../../types/simulation/graphicsArraySnapshot";
import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";

import CircuitRunner from "./circuitRunner";
import type {
  MemorySliceData,
  PersistentMemoryDump,
  ScheduledButtonEvent,
  SimulationSnapshot,
  SimulationTelemetry,
  WorkerCommand,
  WorkerResponse,
} from "./workerMessages";
import CircuitException, { type CircuitExceptionCause } from "../compiler/circuitException";

export type StatusChangeCallback = (
  status: "powerOn" | "powerOff" | "running" | "paused" | "oscillating",
  telemetry: SimulationTelemetry,
) => void;

export type ErrorCallback = (
  error: string,
  errorType?: string,
  causeType?: CircuitExceptionCause,
  location?: SimulationErrorLocation,
) => void;

// In-Process-Fallback-Worker für Umgebungen ohne native WebWorker (z. B. Vitest / Node)
class InProcessWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => void) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => void) | null = null;

  #runner: CircuitRunner | null = null;

  postMessage(message: WorkerCommand): void {
    try {
      switch (message.type) {
        case "INIT": {
          this.#runner?.dispose();
          this.#runner = new CircuitRunner(message.circuit, {
            historySize: message.historySize,
            onStatusChange: (status, telemetry) => {
              this.#emit({ type: "STATUS_UPDATE", status, telemetry });
            },
          });
          this.#emit({
            type: "READY",
            success: true,
            probeCount: this.#runner.probeCount,
            buttonCount: this.#runner.buttonCount,
            stateCount: this.#runner.circuitState.count,
          });
          break;
        }

        case "START":
          this.#runner?.start();
          break;

        case "PAUSE":
          this.#runner?.pause();
          break;

        case "STOP": {
          const persistentMemories = this.#runner ? this.#runner.collectPersistentMemories() : [];
          this.#runner?.stop();
          this.#emit({
            type: "STOPPED",
            requestId: message.requestId,
            persistentMemories,
          });
          break;
        }

        case "SET_SPEED":
          this.#runner?.setSpeed(message.frameRateLimit);
          break;

        case "STEP": {
          if (!this.#runner) {
            this.#emit({ type: "ERROR", error: "Simulation ist nicht initialisiert." });
            return;
          }
          const res = this.#runner.step(message.count ?? 1, message.events, { incrementalVram: true });
          this.#emit({
            type: "STEP_DONE",
            stepsCompleted: res.stepsCompleted,
            maxAppliedEventStep: res.maxAppliedEventStep,
            snapshot: res.snapshot,
          });
          break;
        }

        case "SET_BUTTON":
          this.#runner?.setButtonState(message.buttonId, message.pressed);
          break;

        case "TOGGLE_BUTTON":
          this.#runner?.toggleButton(message.buttonId);
          break;

        case "SET_SENSOR_VALUE":
          this.#runner?.setSensorValue(message.sensorId, message.value);
          break;

        case "PULL_SNAPSHOT": {
          if (!this.#runner) {
            this.#emit({ type: "ERROR", error: "Simulation ist nicht initialisiert." });
            return;
          }
          this.#emit({
            type: "SNAPSHOT",
            snapshot: this.#runner.getSnapshot({ incrementalVram: true }),
          });
          break;
        }

        case "READ_MEMORY_SLICE": {
          const slice = this.#runner
            ? this.#runner.readMemorySlice(message.memoryInstanceId, message.startAddress, message.count)
            : null;
          this.#emit({
            type: "MEMORY_SLICE",
            requestId: message.requestId,
            slice,
          });
          break;
        }

        case "WRITE_MEMORY_CELL": {
          const result = this.#runner
            ? this.#runner.writeMemoryCell(
              message.memoryInstanceId,
              message.address,
              message.value,
              { incrementalVram: true },
            )
            : { success: false, revision: 0 };
          this.#emit({
            type: "MEMORY_CELL_WRITTEN",
            requestId: message.requestId,
            ...result,
          });
          break;
        }

        case "FLUSH_PERSISTENT_MEMORIES": {
          const persistentMemories = this.#runner ? this.#runner.collectPersistentMemories() : [];
          this.#emit({
            type: "PERSISTENT_MEMORIES_FLUSHED",
            requestId: message.requestId,
            persistentMemories,
          });
          break;
        }
      }
    } catch (err) {
      const e = err as Error;
      const circuitErr = err instanceof CircuitException ? err : null;
      this.#emit({
        type: "ERROR",
        error: e.message,
        errorType: e.name,
        ...(circuitErr ? { causeType: circuitErr.causeType, location: circuitErr.location } : {}),
      });
    }
  }

  terminate(): void {
    this.#runner?.dispose();
    this.#runner = null;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }

  #emit(response: WorkerResponse): void {
    if (this.onmessage) {
      this.onmessage.call(this, new MessageEvent("message", { data: response }));
    }
  }
}

// Hauptthread-Client zur Steuerung des Simulations-WebWorkers
export class SimulationClient {
  readonly #worker: Worker;
  readonly #ownsWorker: boolean;

  #onStatusChange?: StatusChangeCallback;
  #onError?: ErrorCallback;

  #stepResolvers: ((res: {
    stepsCompleted: number;
    maxAppliedEventStep?: number;
    snapshot: SimulationSnapshot;
  }) => void)[] = [];
  #stepRejecters: ((err: Error) => void)[] = [];
  #snapshotResolvers: ((snapshot: SimulationSnapshot) => void)[] = [];
  #snapshotRejecters: ((err: Error) => void)[] = [];
  #initResolver: ((res: { success: true; probeCount: number; buttonCount: number; stateCount: number }) => void) | null = null;
  #initRejecter: ((err: Error) => void) | null = null;
  #nextRequestId = 1;
  #stopResolvers: Map<number, (dumps: PersistentMemoryDump[]) => void> = new Map();
  #flushResolvers: Map<number, (dumps: PersistentMemoryDump[]) => void> = new Map();
  #memorySliceResolvers: Map<number, (slice: MemorySliceData | null) => void> = new Map();
  #memoryWriteResolvers: Map<
    number,
    (res: { success: boolean; revision: number; snapshot?: SimulationSnapshot }) => void
  > = new Map();
  readonly #graphicsVramCache = new Map<string, Uint8Array>();

  constructor(customWorker?: Worker) {
    if (customWorker) {
      this.#worker = customWorker;
      this.#ownsWorker = false;
    } else if (typeof Worker !== "undefined") {
      this.#worker = new Worker(new URL("./simulationWorker.ts", import.meta.url), {
        type: "module",
      });
      this.#ownsWorker = true;
    } else {
      this.#worker = new InProcessWorker();
      this.#ownsWorker = true;
    }

    this.#worker.onmessage = this.#handleWorkerMessage;
  }

  // Registriert einen Callback für Statusänderungen (z. B. Oszillation oder Takttelemetrie)
  onStatusChange(callback: StatusChangeCallback): void {
    this.#onStatusChange = callback;
  }

  // Registriert einen Callback für Kompilier- oder Laufzeitfehler
  onError(callback: ErrorCallback): void {
    this.#onError = callback;
  }

  // Initialisiert die Schaltung im WebWorker
  init(
    circuit: LogicalCircuit,
    historySize = 100,
  ): Promise<{ success: true; probeCount: number; buttonCount: number; stateCount: number }> {
    this.#graphicsVramCache.clear();
    return new Promise((resolve, reject) => {
      this.#initResolver = resolve;
      this.#initRejecter = reject;
      this.#postCommand({
        type: "INIT",
        circuit,
        historySize,
      });
    });
  }

  // Startet den kontinuierlichen Lauf
  start(): void {
    this.#postCommand({ type: "START" });
  }

  // Pausiert die Simulation
  pause(): void {
    this.#postCommand({ type: "PAUSE" });
  }

  // Stoppt die Simulation und liefert persistente RAM-Stände (onStart === "data") vor dem Abbau zurück
  stop(): Promise<PersistentMemoryDump[]> {
    this.#graphicsVramCache.clear();
    return new Promise((resolve) => {
      const requestId = this.#nextRequestId++;
      this.#stopResolvers.set(requestId, resolve);
      this.#postCommand({ type: "STOP", requestId });
    });
  }

  // Fordert persistente RAM-Inhalte aus dem Worker an (z. B. bei Pause oder vor Projekt-Speichern)
  flushPersistentMemories(): Promise<PersistentMemoryDump[]> {
    return new Promise((resolve) => {
      const requestId = this.#nextRequestId++;
      this.#flushResolvers.set(requestId, resolve);
      this.#postCommand({ type: "FLUSH_PERSISTENT_MEMORIES", requestId });
    });
  }

  // Liest einen bedarfsgesteuerten Adressbereich eines RAM/ROM-Bausteins aus dem Worker
  readMemorySlice(
    memoryInstanceId: string,
    startAddress: number,
    count: number,
  ): Promise<MemorySliceData | null> {
    return new Promise((resolve) => {
      const requestId = this.#nextRequestId++;
      this.#memorySliceResolvers.set(requestId, resolve);
      this.#postCommand({
        type: "READ_MEMORY_SLICE",
        requestId,
        memoryInstanceId,
        startAddress,
        count,
      });
    });
  }

  // Schreibt eine einzelne RAM-Zelle während pausierter Simulation über das Worker-Protokoll
  writeMemoryCell(
    memoryInstanceId: string,
    address: number,
    value: number,
  ): Promise<{ success: boolean; revision: number; snapshot?: SimulationSnapshot }> {
    return new Promise((resolve) => {
      const requestId = this.#nextRequestId++;
      this.#memoryWriteResolvers.set(requestId, resolve);
      this.#postCommand({
        type: "WRITE_MEMORY_CELL",
        requestId,
        memoryInstanceId,
        address,
        value,
      });
    });
  }

  // Passt die Simulationsgeschwindigkeit / Framerate an
  setSpeed(frameRateLimit: FrameRateLimit): void {
    this.#postCommand({
      type: "SET_SPEED",
      frameRateLimit,
    });
  }

  get isSnapshotPending(): boolean {
    return this.#snapshotResolvers.length > 0;
  }

  // Führt exakt count Einzelschritte deterministisch aus (optional mit zeitgesteuerten Eingabe-Events)
  step(
    count = 1,
    events?: ScheduledButtonEvent[],
  ): Promise<{ stepsCompleted: number; maxAppliedEventStep?: number; snapshot: SimulationSnapshot }> {
    return new Promise((resolve, reject) => {
      this.#stepResolvers.push(resolve);
      this.#stepRejecters.push(reject);
      this.#postCommand({
        type: "STEP",
        count,
        ...(events && events.length > 0 ? { events } : {}),
      });
    });
  }

  // Interaktiver Tastendruck oder Loslassen
  setButtonState(buttonId: string, pressed: boolean): void {
    this.#postCommand({
      type: "SET_BUTTON",
      buttonId,
      pressed,
    });
  }

  // Wechselschalter (Toggle) umschalten
  toggleButton(buttonId: string): void {
    this.#postCommand({
      type: "TOGGLE_BUTTON",
      buttonId,
    });
  }

  // Sensorwert setzen (z. B. manuell, ASCII oder KeyCode)
  setSensorValue(sensorId: string, value: number): void {
    this.#postCommand({
      type: "SET_SENSOR_VALUE",
      sensorId,
      value,
    });
  }

  // Fordert vom WebWorker den aktuellen Snapshot für den UI-Frame an (Pull-Prinzip)
  pullSnapshot(): Promise<SimulationSnapshot> {
    return new Promise((resolve, reject) => {
      this.#snapshotResolvers.push(resolve);
      this.#snapshotRejecters.push(reject);
      this.#postCommand({ type: "PULL_SNAPSHOT" });
    });
  }

  #resolvePendingMemoryRequests(): void {
    for (const resolve of this.#stopResolvers.values()) {
      resolve([]);
    }
    this.#stopResolvers.clear();
    for (const resolve of this.#flushResolvers.values()) {
      resolve([]);
    }
    this.#flushResolvers.clear();
    for (const resolve of this.#memorySliceResolvers.values()) {
      resolve(null);
    }
    this.#memorySliceResolvers.clear();
    for (const resolve of this.#memoryWriteResolvers.values()) {
      resolve({ success: false, revision: 0 });
    }
    this.#memoryWriteResolvers.clear();
  }

  // Beendet den Worker und gibt alle Ressourcen frei
  terminate(): void {
    this.#stepResolvers.length = 0;
    this.#stepRejecters.length = 0;
    this.#snapshotResolvers.length = 0;
    this.#snapshotRejecters.length = 0;
    this.#graphicsVramCache.clear();
    this.#resolvePendingMemoryRequests();
    if (this.#ownsWorker) {
      this.#worker.terminate();
    }
  }

  #postCommand(command: WorkerCommand): void {
    this.#worker.postMessage(command);
  }

  #hydrateGraphicsVram(snapshot: SimulationSnapshot): SimulationSnapshot {
    if (!snapshot.graphicsArrays) {
      return snapshot;
    }
    const hydrated: Record<string, GraphicsArraySnapshot> = {};
    for (const [instanceId, entry] of Object.entries(snapshot.graphicsArrays)) {
      if (entry.vram) {
        this.#graphicsVramCache.set(instanceId, entry.vram);
        hydrated[instanceId] = entry;
      } else {
        const cached = this.#graphicsVramCache.get(instanceId);
        hydrated[instanceId] = cached ? { ...entry, vram: cached } : entry;
      }
    }
    return {
      ...snapshot,
      graphicsArrays: hydrated,
    };
  }

  #handleWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    const message = event.data;

    switch (message.type) {
      case "READY":
        if (this.#initResolver) {
          this.#initResolver({
            success: true,
            probeCount: message.probeCount,
            buttonCount: message.buttonCount,
            stateCount: message.stateCount,
          });
          this.#initResolver = null;
          this.#initRejecter = null;
        }
        break;

      case "ERROR": {
        const err = message.errorType === "CircuitException"
          ? new CircuitException(message.error, message.causeType ?? "userError", message.location)
          : new Error(message.error);
        if (this.#initRejecter) {
          this.#initRejecter(err);
          this.#initResolver = null;
          this.#initRejecter = null;
        }
        while (this.#stepRejecters.length > 0) {
          this.#stepResolvers.shift();
          this.#stepRejecters.shift()?.(err);
        }
        while (this.#snapshotRejecters.length > 0) {
          this.#snapshotResolvers.shift();
          this.#snapshotRejecters.shift()?.(err);
        }
        this.#resolvePendingMemoryRequests();
        if (this.#onError) {
          this.#onError(message.error, message.errorType, message.causeType, message.location);
        }
        break;
      }

      case "STATUS_UPDATE":
        if (this.#onStatusChange) {
          this.#onStatusChange(message.status, message.telemetry);
        }
        break;

      case "STEP_DONE": {
        this.#stepRejecters.shift();
        const resolver = this.#stepResolvers.shift();
        if (resolver) {
          resolver({
            stepsCompleted: message.stepsCompleted,
            maxAppliedEventStep: message.maxAppliedEventStep,
            snapshot: this.#hydrateGraphicsVram(message.snapshot),
          });
        }
        break;
      }

      case "SNAPSHOT": {
        this.#snapshotRejecters.shift();
        const resolver = this.#snapshotResolvers.shift();
        if (resolver) {
          resolver(this.#hydrateGraphicsVram(message.snapshot));
        }
        break;
      }

      case "STOPPED": {
        this.#graphicsVramCache.clear();
        if (message.requestId !== undefined) {
          const resolve = this.#stopResolvers.get(message.requestId);
          if (resolve) {
            this.#stopResolvers.delete(message.requestId);
            resolve(message.persistentMemories);
          }
        }
        break;
      }

      case "PERSISTENT_MEMORIES_FLUSHED": {
        const resolve = this.#flushResolvers.get(message.requestId);
        if (resolve) {
          this.#flushResolvers.delete(message.requestId);
          resolve(message.persistentMemories);
        }
        break;
      }

      case "MEMORY_SLICE": {
        const resolve = this.#memorySliceResolvers.get(message.requestId);
        if (resolve) {
          this.#memorySliceResolvers.delete(message.requestId);
          resolve(message.slice);
        }
        break;
      }

      case "MEMORY_CELL_WRITTEN": {
        const resolve = this.#memoryWriteResolvers.get(message.requestId);
        if (resolve) {
          this.#memoryWriteResolvers.delete(message.requestId);
          resolve({
            success: message.success,
            revision: message.revision,
            snapshot: message.snapshot ? this.#hydrateGraphicsVram(message.snapshot) : undefined,
          });
        }
        break;
      }
    }
  };
}

export default SimulationClient;
