import type FrameRateLimit from "../../types/simulation/frameRateLimit";

import type SimulationClient from "./simulationClient";
import type { SimulationSnapshot } from "./workerMessages";

export type SnapshotSchedulerOptions = {
  client: SimulationClient;
  frameRateLimit: FrameRateLimit;
  onSnapshot: (snapshot: SimulationSnapshot) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
};

// Entkoppelte requestAnimationFrame-Abrufschleife nach dem Drop-Frame-Prinzip
export class SnapshotScheduler {
  readonly #client: SimulationClient;
  readonly #onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly #requestFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelFrame: (handle: number) => void;
  readonly #now: () => number;

  #frameRateLimit: FrameRateLimit;
  #rafId: number | null = null;
  #running = false;
  #pullInFlight = false;
  #droppedFrames = 0;
  #lastPullTime = 0;

  constructor(options: SnapshotSchedulerOptions) {
    this.#client = options.client;
    this.#frameRateLimit = options.frameRateLimit;
    this.#onSnapshot = options.onSnapshot;
    this.#requestFrame = options.requestFrame
      ?? (typeof requestAnimationFrame === "function"
        ? (cb) => requestAnimationFrame(cb)
        : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
    this.#cancelFrame = options.cancelFrame
      ?? (typeof cancelAnimationFrame === "function"
        ? (id) => cancelAnimationFrame(id)
        : (id) => clearTimeout(id));
    this.#now = options.now ?? (() => performance.now());
  }

  get isRunning(): boolean {
    return this.#running;
  }

  get isPullInFlight(): boolean {
    return this.#pullInFlight;
  }

  get droppedFrames(): number {
    return this.#droppedFrames;
  }

  setFrameRateLimit(limit: FrameRateLimit): void {
    this.#frameRateLimit = limit;
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#lastPullTime = this.#now();
    this.#scheduleNext();
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId !== null) {
      this.#cancelFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  #scheduleNext(): void {
    if (!this.#running) {
      return;
    }
    this.#rafId = this.#requestFrame(this.#onFrame);
  }

  #onFrame = (timestamp: number): void => {
    this.#rafId = null;
    if (!this.#running) {
      return;
    }

    const interval = this.#frameRateLimit === "max" ? 0 : 1000 / this.#frameRateLimit;
    const elapsed = timestamp - this.#lastPullTime;

    if (elapsed >= interval) {
      if (this.#pullInFlight) {
        // Überspringe diesen Render-Frame, solange der letzte Snapshot noch nicht verarbeitet wurde
        this.#droppedFrames++;
      } else {
        this.#pullInFlight = true;
        this.#lastPullTime = timestamp;
        void this.#client.pullSnapshot()
          .then((snap) => {
            if (this.#running) {
              this.#onSnapshot(snap);
            }
          })
          .catch(() => {})
          .finally(() => {
            this.#pullInFlight = false;
          });
      }
    }

    this.#scheduleNext();
  };
}

export default SnapshotScheduler;
