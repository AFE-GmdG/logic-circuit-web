import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type FrameRateLimit from "../../types/simulation/frameRateLimit";
import type GraphicsArraySnapshot from "../../types/simulation/graphicsArraySnapshot";
import type {
  OscilloscopeChannelSnapshot,
  OscilloscopeSnapshot,
  ProbeHistorySnapshot,
} from "../../types/simulation/oscilloscope";

import type {
  AudioChannelSnapshot,
  ButtonSnapshot,
  MemorySliceData,
  PersistentMemoryDump,
  ProbeSnapshot,
  ScheduledButtonEvent,
  SensorSnapshot,
  SimulationSnapshot,
  SimulationTelemetry,
} from "./workerMessages";
import CircuitMap from "../compiler/circuitMap";
import FunctionButton from "../functions/io/functionButton";
import FunctionGraphicsArray from "../functions/io/functionGraphicsArray";
import FunctionLedMatrix from "../functions/io/functionLedMatrix";
import FunctionProbe from "../functions/io/functionProbe";
import FunctionSensor from "../functions/io/functionSensor";
import FunctionSound from "../functions/io/functionSound";
import FunctionSynthesizer from "../functions/io/functionSynthesizer";
import FunctionMemory from "../functions/memory/functionMemory";
import CircuitState from "../state/circuitState";

const MAX_SPEED_BATCH_MIN_STEPS = 9_500;
const MAX_SPEED_BATCH_MAX_STEPS = 10_500;
const MAX_SPEED_BATCH_TIME_MS = 0.75;
const TIME_CHECK_STRIDE = 64;
const FREQUENCY_WINDOW_MS = 500;

type ImmediateHandle = unknown;

type GlobalWithImmediate = typeof globalThis & {
  setImmediate?: (callback: () => void) => ImmediateHandle;
  clearImmediate?: (handle: ImmediateHandle) => void;
};

export type CircuitRunnerOptions = {
  historySize?: number;
  frameRateLimit?: FrameRateLimit;
  sharedBuffer?: SharedArrayBuffer;
  oscilloscoping?: boolean;
  onStatusChange?: (
    status: "powerOn" | "powerOff" | "running" | "paused" | "oscillating",
    telemetry: SimulationTelemetry,
  ) => void;
};

// Controller für die Simulationsschleife analog zu CircuitRunner.cs
export class CircuitRunner {
  readonly #circuit: LogicalCircuit;
  readonly #circuitMap: CircuitMap;
  readonly #circuitState: CircuitState;
  readonly #probes = new Map<string, FunctionProbe>();
  readonly #probesByRawId = new Map<string, FunctionProbe[]>();
  readonly #buttons = new Map<string, FunctionButton>();
  readonly #buttonsByRawId = new Map<string, FunctionButton[]>();
  readonly #sensors = new Map<string, FunctionSensor>();
  readonly #ledMatrices = new Map<string, FunctionLedMatrix>();
  readonly #graphicsArrays = new Map<string, FunctionGraphicsArray>();
  readonly #lastSentGraphicsRevision = new Map<string, number>();
  readonly #memories = new Map<string, FunctionMemory>();
  readonly #audioChannels = new Map<string, FunctionSound | FunctionSynthesizer>();
  readonly #historySize: number;

  #isRunning = false;
  #isPaused = false;
  #isOscillating = false;
  #isOscilloscoping = false;
  #frameRateLimit: FrameRateLimit = 30;
  #actualFrequency = 0;
  #totalSteps = 0;

  #timerId: ReturnType<typeof setInterval> | null = null;
  #yieldTimerId: ReturnType<typeof setTimeout> | null = null;
  #yieldImmediateId: ImmediateHandle | null = null;
  #yieldChannel: MessageChannel | null = null;
  #loopScheduled = false;
  #loopToken = 0;
  #stepCountInWindow = 0;
  #windowStartTime = 0;

  readonly #onStatusChange?: (
    status: "powerOn" | "powerOff" | "running" | "paused" | "oscillating",
    telemetry: SimulationTelemetry,
  ) => void;

  constructor(circuit: LogicalCircuit, options: CircuitRunnerOptions = {}) {
    this.#circuit = circuit;
    this.#frameRateLimit = options.frameRateLimit ?? 30;
    this.#onStatusChange = options.onStatusChange;
    this.#historySize = Math.max(1, Math.trunc(options.historySize ?? 100));
    this.#isOscilloscoping = Boolean(options.oscilloscoping);

    this.#circuitMap = new CircuitMap(this.#circuit);
    this.#circuitState = this.#circuitMap.apply(this.#historySize);

    // Registrierte Funktionen indizieren (Probes, Buttons, LED-Matrizen, Speicher)
    for (const fn of this.#circuitState.functions) {
      if (fn instanceof FunctionProbe || fn.constructor.name.includes("Probe")) {
        const probeFn = fn as FunctionProbe;
        const id = probeFn.probeId ?? probeFn.label;
        this.#probes.set(id, probeFn);
        const rawId = probeFn.rawProbeId ?? id;
        const list = this.#probesByRawId.get(rawId) ?? [];
        list.push(probeFn);
        this.#probesByRawId.set(rawId, list);
      } else if (fn instanceof FunctionButton || fn.constructor.name.includes("Button")) {
        const btnFn = fn as FunctionButton;
        const id = btnFn.buttonId ?? `btn_${this.#buttons.size}`;
        this.#buttons.set(id, btnFn);
        const rawId = btnFn.rawButtonId ?? id;
        const list = this.#buttonsByRawId.get(rawId) ?? [];
        list.push(btnFn);
        this.#buttonsByRawId.set(rawId, list);
      } else if (fn instanceof FunctionSensor) {
        this.#sensors.set(fn.sensorId, fn);
      } else if (fn instanceof FunctionLedMatrix) {
        this.#ledMatrices.set(fn.matrixId, fn);
      } else if (fn instanceof FunctionGraphicsArray) {
        this.#graphicsArrays.set(fn.graphicsInstanceId, fn);
      } else if (fn instanceof FunctionMemory) {
        this.#memories.set(fn.memoryInstanceId, fn);
      } else if (fn instanceof FunctionSound || fn instanceof FunctionSynthesizer) {
        this.#audioChannels.set(fn.channelId, fn);
      }
    }
  }

  get circuit(): LogicalCircuit {
    return this.#circuit;
  }

  get circuitMap(): CircuitMap {
    return this.#circuitMap;
  }

  get circuitState(): CircuitState {
    return this.#circuitState;
  }

  get isRunning(): boolean {
    return this.#isRunning;
  }

  get isPaused(): boolean {
    return this.#isPaused;
  }

  get isOscillating(): boolean {
    return this.#isOscillating;
  }

  get isOscilloscoping(): boolean {
    return this.#isOscilloscoping;
  }

  get frameRateLimit(): FrameRateLimit {
    return this.#frameRateLimit;
  }

  get actualFrequency(): number {
    return this.#actualFrequency;
  }

  get totalSteps(): number {
    return this.#totalSteps;
  }

  get probeCount(): number {
    return this.#probes.size;
  }

  get buttonCount(): number {
    return this.#buttons.size;
  }

  get hasClocks(): boolean {
    return this.#circuitState.hasClocks;
  }

  get memoryCount(): number {
    return this.#memories.size;
  }

  get graphicsArrayCount(): number {
    return this.#graphicsArrays.size;
  }

  #resolveMemory(memoryInstanceId: string): FunctionMemory | FunctionGraphicsArray | null {
    const direct = this.#memories.get(memoryInstanceId);
    if (direct) {
      return direct;
    }
    const directGraphics = this.#graphicsArrays.get(memoryInstanceId);
    if (directGraphics) {
      return directGraphics;
    }
    let matched: FunctionMemory | FunctionGraphicsArray | null = null;
    for (const mem of this.#memories.values()) {
      if (mem.memoryId === memoryInstanceId) {
        if (matched) {
          return null;
        }
        matched = mem;
      }
    }
    for (const ga of this.#graphicsArrays.values()) {
      if (ga.graphicsArrayId === memoryInstanceId) {
        if (matched) {
          return null;
        }
        matched = ga;
      }
    }
    return matched;
  }

  // Liest eine bedarfsgesteuerte Speicherseite für den Live-Inspektor aus dem Worker
  readMemorySlice(
    memoryInstanceId: string,
    startAddress: number,
    count: number,
  ): MemorySliceData | null {
    return this.#resolveMemory(memoryInstanceId)?.readSlice(startAddress, count) ?? null;
  }

  // Schreibt eine einzelne Speicher-/VRAM-Zelle ausschließlich im pausierten Zustand und propagiert den Zustand
  writeMemoryCell(
    memoryInstanceId: string,
    address: number,
    value: number,
    options?: { incrementalVram?: boolean },
  ): { success: boolean; revision: number; snapshot?: SimulationSnapshot } {
    const memory = this.#resolveMemory(memoryInstanceId);
    if (!memory || !memory.writable || (this.#isRunning && !this.#isPaused)) {
      return {
        success: false,
        revision: memory?.revision ?? 0,
      };
    }
    const updated = memory.setCell(address, value);
    if (!updated) {
      return {
        success: false,
        revision: memory.revision,
      };
    }
    if (!this.#isOscillating && !this.#circuitState.evaluate(false)) {
      this.#handleOscillation();
    }
    return {
      success: true,
      revision: memory.revision,
      snapshot: this.getSnapshot(options),
    };
  }

  // Aktiviert oder pausiert die zeitliche Oszilloskop-Aufzeichnung aller Messsonden
  setOscilloscoping(enabled: boolean): OscilloscopeSnapshot {
    this.#isOscilloscoping = enabled;
    if (enabled && this.#probes.size > 0) {
      const firstProbe = this.#probes.values().next().value;
      if (firstProbe && firstProbe.bitWidth > 0 && firstProbe.readBitHistory(0).length === 0) {
        this.#tickProbes();
      }
    }
    return this.readOscilloscope();
  }

  // Leert alle aufgezeichneten Oszilloskop-Spuren ohne die laufende Simulation zurückzusetzen
  clearOscilloscope(): OscilloscopeSnapshot {
    for (const probe of this.#probes.values()) {
      probe.clearTickHistory();
    }
    return this.readOscilloscope();
  }

  // Liefert die aktuellen Oszilloskop-Kanäle aller Messsonden sortiert nach Instanzpfad
  readOscilloscope(): OscilloscopeSnapshot {
    const channels: OscilloscopeChannelSnapshot[] = [];
    for (const probe of this.#probes.values()) {
      channels.push(probe.toOscilloscopeChannel());
    }
    channels.sort((a, b) => a.path.localeCompare(b.path) || a.probeId.localeCompare(b.probeId));
    const sampleCount = channels.reduce((max, ch) => Math.max(max, ch.sampleCount), 0);
    return {
      isOscilloscoping: this.#isOscilloscoping,
      historySize: this.#historySize,
      totalSteps: this.#totalSteps,
      sampleCount,
      channels,
    };
  }

  // Liefert den Wertänderungsverlauf einer einzelnen Messsonde
  readProbeHistory(probeId: string): ProbeHistorySnapshot | null {
    const probe = this.#resolveProbe(probeId);
    if (!probe) {
      return null;
    }
    probe.updateState();
    return probe.toHistorySnapshot();
  }

  // Fügt eine visuelle Markierung in den Wertänderungsverlauf einer Messsonde ein
  markProbeHistory(probeId: string): ProbeHistorySnapshot | null {
    const probe = this.#resolveProbe(probeId);
    if (!probe) {
      return null;
    }
    probe.updateState();
    probe.mark();
    return probe.toHistorySnapshot();
  }

  #resolveProbe(probeId: string): FunctionProbe | null {
    const direct = this.#probes.get(probeId);
    if (direct) {
      return direct;
    }
    const list = this.#probesByRawId.get(probeId);
    if (list && list.length === 1) {
      return list[0];
    }
    return null;
  }

  #tickProbes(): void {
    if (!this.#isOscilloscoping || this.#probes.size === 0) {
      return;
    }
    for (const probe of this.#probes.values()) {
      probe.tick();
    }
  }

  // Exportiert alle persistent konfigurierten RAM-Inhalte (onStart === "data") für das Projektmodell
  collectPersistentMemories(): PersistentMemoryDump[] {
    const result: PersistentMemoryDump[] = [];
    const seen = new Set<string>();
    for (const mem of this.#memories.values()) {
      if (!mem.isPersistent || seen.has(mem.memoryId)) {
        continue;
      }
      seen.add(mem.memoryId);
      result.push({
        memoryId: mem.memoryId,
        data: mem.exportEncodedData(),
      });
    }
    return result;
  }

  // Startet den kontinuierlichen Lauf
  start(): void {
    if (this.#isOscillating) {
      return;
    }
    this.#isRunning = true;
    this.#isPaused = false;
    this.#windowStartTime = performance.now();
    this.#stepCountInWindow = 0;

    // Initialer Stabilisierungsschritt
    if (!this.#circuitState.evaluate(false)) {
      this.#handleOscillation();
      return;
    }

    this.#notifyStatus("running");

    // Wenn die Schaltung keine Taktgeber besitzt, ist der Zustand nach dem initialen Schritt
    // stabil und ändert sich ausschließlich bei Benutzerinteraktionen (z. B. Tastern).
    // In diesem Fall wird keine CPU-intensive Endlosschleife gestartet.
    if (this.#circuitState.hasClocks) {
      this.#startExecutionLoop();
    } else {
      this.#actualFrequency = 0;
    }
  }

  // Pausiert den laufenden Simulationsbetrieb
  pause(): void {
    if (!this.#isRunning || this.#isPaused) {
      return;
    }
    this.#isPaused = true;
    this.#stopExecutionLoop();
    this.#actualFrequency = 0;
    this.#stepCountInWindow = 0;
    this.#notifyStatus("paused");
  }

  // Beendet die Simulation und setzt den Zustand zurück
  stop(): void {
    this.#stopExecutionLoop();
    this.#isRunning = false;
    this.#isPaused = false;
    this.#isOscilloscoping = false;
    this.#actualFrequency = 0;
    this.#totalSteps = 0;
    this.#stepCountInWindow = 0;
    this.#lastSentGraphicsRevision.clear();
    for (const probe of this.#probes.values()) {
      probe.clearTickHistory();
    }
    this.#notifyStatus("powerOff");
  }

  // Ändert die Simulationsgeschwindigkeit / Framerate dynamisch
  setSpeed(frameRateLimit: FrameRateLimit): void {
    this.#frameRateLimit = frameRateLimit;
    this.#windowStartTime = performance.now();
    this.#stepCountInWindow = 0;
    if (this.#circuitState.hasClocks && this.#isRunning && !this.#isPaused && !this.#isOscillating) {
      this.#stopExecutionLoop();
      this.#startExecutionLoop();
    }
  }

  // Führt exakt count Schritte deterministisch hintereinander aus (inkl. optionaler zeitgesteuerter Events)
  step(
    count = 1,
    events: ScheduledButtonEvent[] = [],
    options?: { incrementalVram?: boolean },
  ): {
    stepsCompleted: number;
    maxAppliedEventStep: number;
    snapshot: SimulationSnapshot;
    oscillating: boolean;
  } {
    const sortedEvents = events.length > 0
      ? events
        .map((ev, index) => ({ ev, index }))
        .sort((a, b) => (a.ev.atStep - b.ev.atStep) || (a.index - b.index))
        .map((entry) => entry.ev)
      : [];

    let eventCursor = 0;
    let appliedStepZeroEvent = false;
    let maxAppliedEventStep = -1;
    while (eventCursor < sortedEvents.length && sortedEvents[eventCursor].atStep <= 0) {
      this.#applyScheduledEvent(sortedEvents[eventCursor]);
      maxAppliedEventStep = Math.max(maxAppliedEventStep, sortedEvents[eventCursor].atStep);
      appliedStepZeroEvent = true;
      eventCursor++;
    }

    if (count <= 0) {
      if ((appliedStepZeroEvent || this.#totalSteps === 0) && !this.#isOscillating) {
        if (!this.#circuitState.evaluate(false)) {
          this.#handleOscillation();
        }
      }
      return {
        stepsCompleted: 0,
        maxAppliedEventStep,
        snapshot: this.getSnapshot(options),
        oscillating: this.#isOscillating,
      };
    }

    let steps = 0;
    const flipClock = this.#circuitState.hasClocks;
    for (let stepNumber = 1; stepNumber <= count; stepNumber++) {
      while (eventCursor < sortedEvents.length && sortedEvents[eventCursor].atStep === stepNumber) {
        this.#applyScheduledEvent(sortedEvents[eventCursor]);
        maxAppliedEventStep = Math.max(maxAppliedEventStep, sortedEvents[eventCursor].atStep);
        eventCursor++;
      }
      if (!this.#circuitState.evaluate(flipClock)) {
        this.#handleOscillation();
        break;
      }
      this.#tickProbes();
      steps++;
    }
    this.#totalSteps += steps;
    return {
      stepsCompleted: steps,
      maxAppliedEventStep,
      snapshot: this.getSnapshot(options),
      oscillating: this.#isOscillating,
    };
  }

  #resolveTargetButtons(buttonId: string): FunctionButton[] {
    const exact = this.#buttons.get(buttonId);
    if (exact) {
      return [exact];
    }
    return this.#buttonsByRawId.get(buttonId) ?? [];
  }

  // Interaktiver Tastendruck oder Loslassen
  setButtonState(buttonId: string, pressed: boolean): boolean {
    const buttons = this.#resolveTargetButtons(buttonId);
    if (buttons.length === 0) {
      return false;
    }
    for (const btn of buttons) {
      btn.press(pressed);
    }

    // Kombinatorisch sofort propagieren (auch im Pause-Modus), ohne den Takt fortzuschalten
    if (!this.#isOscillating) {
      if (!this.#circuitState.evaluate(false)) {
        this.#handleOscillation();
      } else if (!this.#circuitState.hasClocks) {
        this.#tickProbes();
      }
    }
    return true;
  }

  // Umschalten eines Wechselschalters (Toggle)
  toggleButton(buttonId: string): boolean {
    const buttons = this.#resolveTargetButtons(buttonId);
    if (buttons.length === 0) {
      return false;
    }
    for (const btn of buttons) {
      btn.toggle();
    }

    // Kombinatorisch sofort propagieren (auch im Pause-Modus), ohne den Takt fortzuschalten
    if (!this.#isOscillating) {
      if (!this.#circuitState.evaluate(false)) {
        this.#handleOscillation();
      } else if (!this.#circuitState.hasClocks) {
        this.#tickProbes();
      }
    }
    return true;
  }

  // Interaktives Setzen eines Sensorwerts (z. B. manuell, ASCII oder KeyCode)
  setSensorValue(sensorId: string, value: number): boolean {
    const sensor = this.#sensors.get(sensorId);
    if (!sensor) {
      return false;
    }
    sensor.setValue(value);

    // Kombinatorisch sofort propagieren (auch im Pause-Modus), ohne den Takt fortzuschalten
    if (!this.#isOscillating) {
      if (!this.#circuitState.evaluate(false)) {
        this.#handleOscillation();
      } else if (!this.#circuitState.hasClocks) {
        this.#tickProbes();
      }
    }
    return true;
  }

  #applyScheduledEvent(event: ScheduledButtonEvent): void {
    const buttons = this.#resolveTargetButtons(event.buttonId);
    for (const btn of buttons) {
      if (event.toggle) {
        btn.toggle();
      } else if (typeof event.on === "boolean") {
        if (btn.isToggle) {
          if (btn.isOn !== event.on) {
            btn.toggle();
          }
        } else {
          btn.press(event.on);
        }
      }
    }
  }

  // Erzeugt einen konsistenten atomaren Snapshot für den UI-Thread (optional mit inkrementellem VRAM-Diff)
  getSnapshot(options?: { incrementalVram?: boolean }): SimulationSnapshot {
    const stateArray = new Uint8Array(this.#circuitState.state);
    const probes: Record<string, ProbeSnapshot> = {};
    for (const [id, probe] of this.#probes) {
      probe.updateState();
      probes[id] = {
        probeId: id,
        label: probe.label,
        bitWidth: probe.bitWidth,
        value: probe.toNumeric(),
        text: probe.toText(true, probe.displayFormat),
      };
    }
    for (const [rawId, list] of this.#probesByRawId) {
      if (!probes[rawId] && list.length > 0) {
        const first = list[0];
        probes[rawId] = {
          probeId: rawId,
          label: first.label,
          bitWidth: first.bitWidth,
          value: first.toNumeric(),
          text: first.toText(true, first.displayFormat),
        };
      }
    }

    const buttons: Record<string, ButtonSnapshot> = {};
    for (const [id, button] of this.#buttons) {
      buttons[id] = {
        buttonId: id,
        isToggle: button.isToggle,
        isOn: button.isOn,
      };
    }
    for (const [rawId, list] of this.#buttonsByRawId) {
      if (!buttons[rawId] && list.length > 0) {
        buttons[rawId] = {
          buttonId: rawId,
          isToggle: list[0].isToggle,
          isOn: list.some((b) => b.isOn),
        };
      }
    }

    const ledMatrices: Record<string, number[][]> = {};
    for (const [id, matrix] of this.#ledMatrices) {
      matrix.evaluate();
      ledMatrices[id] = matrix.getCellValues();
    }

    const sensors: Record<string, SensorSnapshot> = {};
    for (const [id, sensor] of this.#sensors) {
      sensors[id] = {
        sensorId: id,
        sensorType: sensor.sensorType,
        bitWidth: sensor.bitWidth,
        value: sensor.value,
        text: sensor.displayText(),
      };
    }

    const memoryRevisions: Record<string, number> = {};
    for (const [instanceId, mem] of this.#memories) {
      memoryRevisions[instanceId] = mem.revision;
    }

    const incrementalVram = Boolean(options?.incrementalVram);
    const graphicsArrays: Record<string, GraphicsArraySnapshot> = {};
    for (const [instanceId, gaFn] of this.#graphicsArrays) {
      memoryRevisions[instanceId] = gaFn.revision;
      const shouldIncludeVram =
        !incrementalVram || this.#lastSentGraphicsRevision.get(instanceId) !== gaFn.revision;
      if (incrementalVram) {
        this.#lastSentGraphicsRevision.set(instanceId, gaFn.revision);
      }
      graphicsArrays[instanceId] = {
        instanceId,
        graphicsArrayId: gaFn.graphicsArrayId,
        width: gaFn.width,
        height: gaFn.height,
        bitsPerPixel: gaFn.bitsPerPixel,
        bitmapStride: gaFn.bitmapStride,
        revision: gaFn.revision,
        ...(shouldIncludeVram ? { vram: gaFn.copyVramBytes() } : {}),
      };
    }

    const audioChannels: Record<string, AudioChannelSnapshot> = {};
    for (const [channelId, audioFn] of this.#audioChannels) {
      audioChannels[channelId] = audioFn.toAudioSnapshot();
    }

    const telemetry: SimulationTelemetry = {
      isRunning: this.#isRunning,
      isPaused: this.#isPaused,
      isOscillating: this.#isOscillating,
      oscillationLocation: this.#isOscillating ? this.#circuitState.lastOscillatingLocation : null,
      hasClocks: this.#circuitState.hasClocks,
      hasProbes: this.#probes.size > 0,
      isOscilloscoping: this.#isOscilloscoping,
      actualFrequency: this.#actualFrequency,
      totalSteps: this.#totalSteps,
      timestamp: performance.now(),
    };

    const hasRevisions = this.#memories.size > 0 || this.#graphicsArrays.size > 0;
    return {
      stateArray,
      probes,
      buttons,
      sensors,
      ledMatrices,
      ...(this.#graphicsArrays.size > 0 ? { graphicsArrays } : {}),
      ...(hasRevisions ? { memoryRevisions } : {}),
      ...(this.#audioChannels.size > 0 ? { audioChannels } : {}),
      telemetry,
    };
  }

  // Ressourcen freigeben
  dispose(): void {
    this.stop();
    this.#probes.clear();
    this.#probesByRawId.clear();
    this.#buttons.clear();
    this.#buttonsByRawId.clear();
    this.#sensors.clear();
    this.#ledMatrices.clear();
    this.#graphicsArrays.clear();
    this.#lastSentGraphicsRevision.clear();
    this.#memories.clear();
    this.#audioChannels.clear();
  }

  #startExecutionLoop(): void {
    this.#stopExecutionLoop();
    if (this.#frameRateLimit === "max") {
      this.#scheduleMaxSpeedBatch();
    } else {
      const intervalMs = Math.max(1, Math.round(1000 / this.#frameRateLimit));
      this.#timerId = setInterval(() => {
        if (!this.#isRunning || this.#isPaused || this.#isOscillating) {
          return;
        }
        if (!this.#circuitState.evaluate(true)) {
          this.#handleOscillation();
          return;
        }
        this.#tickProbes();
        this.#totalSteps++;
        this.#stepCountInWindow++;
        this.#updateFrequencyMeasurement();
      }, intervalMs);
    }
  }

  #stopExecutionLoop(): void {
    this.#loopToken++;
    if (this.#timerId !== null) {
      clearInterval(this.#timerId);
      this.#timerId = null;
    }
    const globalImmediate = globalThis as GlobalWithImmediate;
    if (this.#yieldImmediateId !== null && typeof globalImmediate.clearImmediate === "function") {
      globalImmediate.clearImmediate(this.#yieldImmediateId);
      this.#yieldImmediateId = null;
    }
    if (this.#yieldTimerId !== null) {
      clearTimeout(this.#yieldTimerId);
      this.#yieldTimerId = null;
    }
    if (this.#yieldChannel !== null) {
      this.#yieldChannel.port1.onmessage = null;
      this.#yieldChannel.port1.close();
      this.#yieldChannel.port2.close();
      this.#yieldChannel = null;
    }
    this.#loopScheduled = false;
  }

  #ensureYieldChannel(): MessageChannel | null {
    if (typeof MessageChannel === "undefined") {
      return null;
    }
    if (!this.#yieldChannel) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent<number>) => {
        this.#runMaxSpeedBatch(event.data);
      };
      this.#yieldChannel = channel;
    }
    return this.#yieldChannel;
  }

  #scheduleMaxSpeedBatch(): void {
    if (this.#loopScheduled || !this.#isRunning || this.#isPaused || this.#isOscillating) {
      return;
    }
    this.#loopScheduled = true;
    const token = this.#loopToken;

    const globalImmediate = globalThis as GlobalWithImmediate;
    if (typeof globalImmediate.setImmediate === "function") {
      this.#yieldImmediateId = globalImmediate.setImmediate(() => {
        this.#yieldImmediateId = null;
        this.#runMaxSpeedBatch(token);
      });
      return;
    }

    const channel = this.#ensureYieldChannel();
    if (channel) {
      channel.port2.postMessage(token);
      return;
    }

    this.#yieldTimerId = setTimeout(() => {
      this.#yieldTimerId = null;
      this.#runMaxSpeedBatch(token);
    }, 0);
  }

  #runMaxSpeedBatch(token: number): void {
    if (token !== this.#loopToken || !this.#isRunning || this.#isPaused || this.#isOscillating) {
      this.#loopScheduled = false;
      return;
    }
    this.#loopScheduled = false;

    const batchSize =
      MAX_SPEED_BATCH_MIN_STEPS +
      Math.floor(Math.random() * (MAX_SPEED_BATCH_MAX_STEPS - MAX_SPEED_BATCH_MIN_STEPS + 1));
    const batchStart = performance.now();
    let completed = 0;

    // Zeitbudgetiertes Batch-Stepping mit variabler Schrittzahl zur Vermeidung von Stroboskop-/Aliasing-Effekten
    for (let i = 0; i < batchSize; i++) {
      if (!this.#circuitState.evaluate(true)) {
        this.#totalSteps += completed;
        this.#stepCountInWindow += completed;
        this.#handleOscillation();
        return;
      }
      this.#tickProbes();
      completed++;

      if ((completed & (TIME_CHECK_STRIDE - 1)) === 0) {
        if (performance.now() - batchStart >= MAX_SPEED_BATCH_TIME_MS) {
          // Zufällige Parität des gewürfelten Batches auch bei vorzeitigem Zeitbudget-Abbruch beibehalten
          if ((completed & 1) !== (batchSize & 1) && completed < batchSize) {
            if (!this.#circuitState.evaluate(true)) {
              this.#totalSteps += completed;
              this.#stepCountInWindow += completed;
              this.#handleOscillation();
              return;
            }
            this.#tickProbes();
            completed++;
          }
          break;
        }
      }
    }

    this.#totalSteps += completed;
    this.#stepCountInWindow += completed;
    this.#updateFrequencyMeasurement();

    if (token === this.#loopToken && this.#isRunning && !this.#isPaused && !this.#isOscillating) {
      this.#scheduleMaxSpeedBatch();
    }
  }

  #updateFrequencyMeasurement(): void {
    const now = performance.now();
    const elapsed = now - this.#windowStartTime;
    if (elapsed >= FREQUENCY_WINDOW_MS) {
      const measured = Math.round((this.#stepCountInWindow * 1000) / elapsed);
      this.#stepCountInWindow = 0;
      this.#windowStartTime = now;
      if (measured !== this.#actualFrequency) {
        this.#actualFrequency = measured;
        this.#notifyStatus("running");
      }
    }
  }

  #handleOscillation(): void {
    this.#isOscillating = true;
    this.#actualFrequency = 0;
    this.#stopExecutionLoop();
    this.#notifyStatus("oscillating");
  }

  #notifyStatus(status: "powerOn" | "powerOff" | "running" | "paused" | "oscillating"): void {
    if (this.#onStatusChange) {
      this.#onStatusChange(status, {
        isRunning: this.#isRunning,
        isPaused: this.#isPaused,
        isOscillating: this.#isOscillating,
        oscillationLocation: this.#isOscillating ? this.#circuitState.lastOscillatingLocation : null,
        hasClocks: this.#circuitState.hasClocks,
        hasProbes: this.#probes.size > 0,
        isOscilloscoping: this.#isOscilloscoping,
        actualFrequency: this.#actualFrequency,
        totalSteps: this.#totalSteps,
        timestamp: performance.now(),
      });
    }
  }
}

export default CircuitRunner;
