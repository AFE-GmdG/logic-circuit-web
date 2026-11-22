import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";

import CircuitRunner from "../../simulation/worker/circuitRunner";
import SimulationClient from "../../simulation/worker/simulationClient";
import type { WorkerCommand, WorkerResponse } from "../../simulation/worker/workerMessages";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createGate,
} from "../../utils/circuitLayout";

function makeWire(wireId: string, logicalCircuitId: string, point1: GridPoint, point2: GridPoint): Wire {
  return {
    wireId,
    logicalCircuitId,
    x1: point1.x,
    y1: point1.y,
    x2: point2.x,
    y2: point2.y,
    point1,
    point2,
  };
}

// Minimaler Mock-Worker für die Vitest-Umgebung
class MockSimulationWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => void) | null = null;

  #runner: CircuitRunner | null = null;

  postMessage(message: WorkerCommand): void {
    // Simuliert die Logik von simulationWorker.ts
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
            this.#emit({ type: "ERROR", error: "Nicht initialisiert" });
            return;
          }
          const res = this.#runner.step(message.count ?? 1);
          this.#emit({
            type: "STEP_DONE",
            stepsCompleted: res.stepsCompleted,
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

        case "PULL_SNAPSHOT": {
          if (!this.#runner) {
            this.#emit({ type: "ERROR", error: "Nicht initialisiert" });
            return;
          }
          this.#emit({
            type: "SNAPSHOT",
            snapshot: this.#runner.getSnapshot(),
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
          const res = this.#runner
            ? this.#runner.writeMemoryCell(message.memoryInstanceId, message.address, message.value)
            : { success: false, revision: 0 };
          this.#emit({
            type: "MEMORY_CELL_WRITTEN",
            requestId: message.requestId,
            ...res,
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
      this.#emit({ type: "ERROR", error: e.message, errorType: e.name });
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

describe("Worker-Protokoll & SimulationClient", () => {
  it("initialisiert die Schaltung im Worker und empfängt die Bauteilanzahl", async () => {
    const circuit = createDefaultLogicalCircuit("main", "ClientInitTest");
    const probe = createCircuitProbe("p-1", "TestProbe");
    circuit.circuitSymbols = [createCircuitSymbol(probe, "main", 0, 0, "up", "sym-p")];

    const mockWorker = new MockSimulationWorker();
    const client = new SimulationClient(mockWorker);

    const initResult = await client.init(circuit);
    expect(initResult.success).toBe(true);
    expect(initResult.probeCount).toBe(1);
    expect(initResult.buttonCount).toBe(0);

    client.terminate();
  });

  it("steuert deterministisches Stepping und Snapshot-Pull über das Protokoll", async () => {
    const circuit = createDefaultLogicalCircuit("main", "ClientStepTest");

    const btn = createCircuitButton("btn-step", "btn-step", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-b");

    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "main", 10, 0, "up", "sym-n");

    const probe = createCircuitProbe("probe-step", "ProbeStep");
    const probeSym = createCircuitSymbol(probe, "main", 20, 1, "up", "sym-p");

    circuit.circuitSymbols = [btnSym, notSym, probeSym];

    const bOut = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const nIn = notSym.jams.find((j) => j.pin.pinType === "input")!;
    const nOut = notSym.jams.find((j) => j.pin.pinType === "output")!;
    const pIn = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", bOut.absolutePoint, nIn.absolutePoint),
      makeWire("w2", "main", nOut.absolutePoint, pIn.absolutePoint),
    ];

    const mockWorker = new MockSimulationWorker();
    const client = new SimulationClient(mockWorker);

    await client.init(circuit);

    // Teste einzelnen Schritt
    const step1 = await client.step(1);
    expect(step1.stepsCompleted).toBe(1);
    expect(step1.snapshot.probes["probe-step"].value).toBe(1);

    // Taster drücken & Snapshot abrufen
    client.setButtonState("btn-step", true);
    await client.step(1);

    const snapshot = await client.pullSnapshot();
    expect(snapshot.probes["probe-step"].value).toBe(0);

    client.terminate();
  });

  it("empfängt Statusmeldungen und Telemetriedaten", async () => {
    const circuit = createDefaultLogicalCircuit("main", "ClientStatusTest");
    const mockWorker = new MockSimulationWorker();
    const client = new SimulationClient(mockWorker);

    const statuses: string[] = [];
    client.onStatusChange((status) => {
      statuses.push(status);
    });

    await client.init(circuit);
    client.start();
    client.pause();
    client.stop();

    expect(statuses).toContain("running");
    expect(statuses).toContain("paused");
    expect(statuses).toContain("powerOff");

    client.terminate();
  });

  it("löst parallele pullSnapshot-Anfragen strikt in FIFO-Reihenfolge ohne Promise-Verlust auf", async () => {
    const circuit = createDefaultLogicalCircuit("main", "ConcurrentPullTest");
    const mockWorker = new MockSimulationWorker();
    const client = new SimulationClient(mockWorker);

    await client.init(circuit);

    const [snap1, snap2, snap3] = await Promise.all([
      client.pullSnapshot(),
      client.pullSnapshot(),
      client.pullSnapshot(),
    ]);

    expect(snap1.stateArray.length).toBeGreaterThan(0);
    expect(snap2.stateArray.length).toBe(snap1.stateArray.length);
    expect(snap3.stateArray.length).toBe(snap1.stateArray.length);
    expect(client.isSnapshotPending).toBe(false);

    client.terminate();
  });
});
