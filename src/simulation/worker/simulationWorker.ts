import CircuitRunner from "./circuitRunner";
import type { SimulationSnapshot, WorkerCommand, WorkerResponse } from "./workerMessages";
import CircuitException from "../compiler/circuitException";

let runner: CircuitRunner | null = null;

// Typisierter Message-Handler des WebWorkers
self.onmessage = (event: MessageEvent<WorkerCommand>): void => {
  const message = event.data;

  try {
    switch (message.type) {
      case "INIT": {
        if (runner) {
          runner.dispose();
          runner = null;
        }

        runner = new CircuitRunner(message.circuit, {
          historySize: message.historySize,
          sharedBuffer: message.sharedBuffer,
          onStatusChange: (status, telemetry) => {
            postResponse({
              type: "STATUS_UPDATE",
              status,
              telemetry,
            });
          },
        });

        postResponse({
          type: "READY",
          success: true,
          probeCount: runner.probeCount,
          buttonCount: runner.buttonCount,
          stateCount: runner.circuitState.count,
        });
        break;
      }

      case "START": {
        runner?.start();
        break;
      }

      case "PAUSE": {
        runner?.pause();
        break;
      }

      case "STOP": {
        const persistentMemories = runner ? runner.collectPersistentMemories() : [];
        runner?.stop();
        postResponse({
          type: "STOPPED",
          requestId: message.requestId,
          persistentMemories,
        });
        break;
      }

      case "SET_SPEED": {
        runner?.setSpeed(message.frameRateLimit);
        break;
      }

      case "STEP": {
        if (!runner) {
          postResponse({
            type: "ERROR",
            error: "Simulation ist nicht initialisiert.",
          });
          return;
        }

        const result = runner.step(message.count ?? 1, message.events, { incrementalVram: true });
        postResponse({
          type: "STEP_DONE",
          stepsCompleted: result.stepsCompleted,
          maxAppliedEventStep: result.maxAppliedEventStep,
          snapshot: result.snapshot,
        });
        break;
      }

      case "SET_BUTTON": {
        runner?.setButtonState(message.buttonId, message.pressed);
        break;
      }

      case "TOGGLE_BUTTON": {
        runner?.toggleButton(message.buttonId);
        break;
      }

      case "SET_SENSOR_VALUE": {
        runner?.setSensorValue(message.sensorId, message.value);
        break;
      }

      case "PULL_SNAPSHOT": {
        if (!runner) {
          postResponse({
            type: "ERROR",
            error: "Simulation ist nicht initialisiert.",
          });
          return;
        }

        const snapshot = runner.getSnapshot({ incrementalVram: true });
        postResponse({
          type: "SNAPSHOT",
          snapshot,
        });
        break;
      }

      case "READ_MEMORY_SLICE": {
        const slice = runner
          ? runner.readMemorySlice(message.memoryInstanceId, message.startAddress, message.count)
          : null;
        postResponse({
          type: "MEMORY_SLICE",
          requestId: message.requestId,
          slice,
        });
        break;
      }

      case "WRITE_MEMORY_CELL": {
        const result = runner
          ? runner.writeMemoryCell(
            message.memoryInstanceId,
            message.address,
            message.value,
            { incrementalVram: true },
          )
          : { success: false, revision: 0 };
        postResponse({
          type: "MEMORY_CELL_WRITTEN",
          requestId: message.requestId,
          ...result,
        });
        break;
      }

      case "FLUSH_PERSISTENT_MEMORIES": {
        const persistentMemories = runner ? runner.collectPersistentMemories() : [];
        postResponse({
          type: "PERSISTENT_MEMORIES_FLUSHED",
          requestId: message.requestId,
          persistentMemories,
        });
        break;
      }

      case "READ_PROBE_HISTORY": {
        const history = runner ? runner.readProbeHistory(message.probeId) : null;
        postResponse({
          type: "PROBE_HISTORY",
          requestId: message.requestId,
          history,
        });
        break;
      }

      case "MARK_PROBE_HISTORY": {
        const history = runner ? runner.markProbeHistory(message.probeId) : null;
        postResponse({
          type: "PROBE_HISTORY",
          requestId: message.requestId,
          history,
        });
        break;
      }

      case "SET_OSCILLOSCOPING": {
        const data = runner ? runner.setOscilloscoping(message.enabled) : null;
        postResponse({
          type: "OSCILLOSCOPE_DATA",
          requestId: message.requestId,
          data,
        });
        break;
      }

      case "READ_OSCILLOSCOPE": {
        const data = runner ? runner.readOscilloscope() : null;
        postResponse({
          type: "OSCILLOSCOPE_DATA",
          requestId: message.requestId,
          data,
        });
        break;
      }

      case "CLEAR_OSCILLOSCOPE": {
        const data = runner ? runner.clearOscilloscope() : null;
        postResponse({
          type: "OSCILLOSCOPE_DATA",
          requestId: message.requestId,
          data,
        });
        break;
      }
    }
  } catch (error) {
    const err = error as Error;
    const circuitErr = error instanceof CircuitException ? error : null;
    postResponse({
      type: "ERROR",
      error: err.message ?? "Unerwarteter Simulationsfehler im WebWorker.",
      errorType: err.name,
      ...(circuitErr ? { causeType: circuitErr.causeType, location: circuitErr.location } : {}),
    });
  }
};

const workerScope = self as unknown as {
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

function collectSnapshotTransferables(snapshot: SimulationSnapshot): Transferable[] {
  const buffers = new Set<Transferable>();
  if (snapshot.stateArray.buffer instanceof ArrayBuffer) {
    buffers.add(snapshot.stateArray.buffer);
  }
  if (snapshot.graphicsArrays) {
    for (const entry of Object.values(snapshot.graphicsArrays)) {
      if (entry.vram && entry.vram.byteLength > 0 && entry.vram.buffer instanceof ArrayBuffer) {
        buffers.add(entry.vram.buffer);
      }
    }
  }
  return Array.from(buffers);
}

function postResponse(response: WorkerResponse): void {
  if (response.type === "SNAPSHOT" || response.type === "STEP_DONE") {
    workerScope.postMessage(response, collectSnapshotTransferables(response.snapshot));
    return;
  }
  if (response.type === "MEMORY_SLICE" && response.slice) {
    workerScope.postMessage(response, [response.slice.bytes.buffer]);
    return;
  }
  if (response.type === "MEMORY_CELL_WRITTEN" && response.snapshot) {
    workerScope.postMessage(response, collectSnapshotTransferables(response.snapshot));
    return;
  }
  workerScope.postMessage(response);
}

export {};
