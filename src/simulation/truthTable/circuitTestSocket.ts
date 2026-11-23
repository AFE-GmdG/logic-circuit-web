import type GridPoint from "../../types/canvas/gridPoint";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Pin from "../../types/circuit/pin";
import type {
  CombinationalPurityAnalysis,
  NonCombinationalReason,
  NonCombinationalReasonKind,
  TruthTableBuildOptions,
  TruthTableBuildResult,
} from "../../types/simulation/truthState";
import TruthState from "../../types/simulation/truthState";

import {
  comparePins,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
} from "../../utils/circuitLayout";

import CircuitMap from "../compiler/circuitMap";
import type CircuitFunction from "../functions/circuitFunction";
import FunctionButton from "../functions/io/functionButton";
import FunctionClock from "../functions/io/functionClock";
import FunctionConstant from "../functions/io/functionConstant";
import FunctionGraphicsArray from "../functions/io/functionGraphicsArray";
import FunctionProbe from "../functions/io/functionProbe";
import FunctionSensor from "../functions/io/functionSensor";
import FunctionRam from "../functions/memory/functionRam";
import type CircuitState from "../state/circuitState";

export const DEFAULT_MAX_TRUTH_TABLE_ROWS = 4096;

export type InputPinSocket = {
  pin: Pin;
  constant: Constant;
  symbol: CircuitSymbol;
  function: FunctionConstant | null;
};

export type OutputPinSocket = {
  pin: Pin;
  probe: CircuitProbe;
  symbol: CircuitSymbol;
  function: FunctionProbe | null;
};

function collectCircuitPins(circuit: LogicalCircuit, project?: CircuitProject): Pin[] {
  const pinMap = new Map<string, Pin>();

  for (const pin of circuit.logicalPins) {
    pinMap.set(pin.pinId, pin);
  }

  if (project) {
    for (const pin of project.pins) {
      if (pin.circuitId === circuit.logicalCircuitId && !pinMap.has(pin.pinId)) {
        pinMap.set(pin.pinId, pin);
      }
    }
  }

  for (const sym of circuit.circuitSymbols) {
    if (sym.circuit.kind === "pin" && !pinMap.has(sym.circuit.circuitId)) {
      const devPin = sym.circuit.pins[0];
      const pinType: "input" | "output" = devPin?.pinType === "output" ? "input" : "output";
      pinMap.set(sym.circuit.circuitId, {
        kind: "pin",
        pinId: sym.circuit.circuitId,
        circuitId: circuit.logicalCircuitId,
        bitWidth: devPin?.bitWidth ?? 1,
        pinType,
        pinSide: pinType === "input" ? "left" : "right",
        inverted: devPin?.inverted ?? false,
        name: sym.circuit.name,
        note: sym.circuit.note,
        jamNotation: devPin?.jamNotation ?? "",
        gridPoint: devPin?.gridPoint ?? { x: 0, y: 0 },
        index: 0,
      });
    }
  }

  return Array.from(pinMap.values());
}

// Prüft, ob eine Schaltung mindestens einen Eingangs-Pin und einen Ausgangs-Pin besitzt (CircuitTestSocket.IsTestable)
export function isTestable(circuit: LogicalCircuit | null | undefined, project?: CircuitProject): boolean {
  if (!circuit) {
    return false;
  }
  const pins = collectCircuitPins(circuit, project);
  return pins.some((pin) => pin.pinType === "input") && pins.some((pin) => pin.pinType === "output");
}

function classifyStatefulFunction(fn: CircuitFunction): NonCombinationalReasonKind | null {
  if (fn instanceof FunctionRam) {
    return "ram";
  }
  if (fn instanceof FunctionClock) {
    return "clock";
  }
  if (fn instanceof FunctionSensor) {
    return "sensor";
  }
  if (fn instanceof FunctionButton) {
    return "button";
  }
  if (fn instanceof FunctionGraphicsArray) {
    return "graphicsArray";
  }
  return null;
}

// Analysiert die kompilierte Signaltopologie auf Rückkopplungsschleifen (Zyklen) und zustandsbehaftete Bausteine
export function analyzeCombinationalPurity(circuitState: CircuitState): CombinationalPurityAnalysis {
  const reasons: NonCombinationalReason[] = [];
  const seenKeys = new Set<string>();
  let hasFeedbackLoops = false;
  let hasStatefulComponents = false;

  const pushReason = (kind: NonCombinationalReasonKind, fn: CircuitFunction): void => {
    const loc = circuitState.getFunctionLocation(fn);
    const dedupeKey = `${kind}:${loc?.symbolId ?? fn.reportName}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    reasons.push({
      kind,
      reportName: fn.reportName,
      circuitId: loc?.circuitId,
      symbolId: loc?.symbolId,
      x: loc?.x,
      y: loc?.y,
    });
  };

  for (const fn of circuitState.functions) {
    const statefulKind = classifyStatefulFunction(fn);
    if (statefulKind !== null) {
      hasStatefulComponents = true;
      pushReason(statefulKind, fn);
    }
  }

  // Iterative 3-Farben-Tiefensuche über den abhängigen Funktionsgraphen zur Zykluserkennung
  const color = new Map<CircuitFunction, 0 | 1 | 2>();
  for (const fn of circuitState.functions) {
    color.set(fn, 0);
  }

  type StackFrame = {
    fn: CircuitFunction;
    deps: CircuitFunction[];
    nextIdx: number;
  };

  for (const startFn of circuitState.functions) {
    if (color.get(startFn) !== 0) {
      continue;
    }
    color.set(startFn, 1);
    const stack: StackFrame[] = [
      {
        fn: startFn,
        deps: startFn.dependent ?? [],
        nextIdx: 0,
      },
    ];

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.nextIdx < top.deps.length) {
        const dep = top.deps[top.nextIdx]!;
        top.nextIdx++;
        const depColor = color.get(dep) ?? 0;
        if (depColor === 1) {
          hasFeedbackLoops = true;
          pushReason("feedbackLoop", dep);
        } else if (depColor === 0) {
          color.set(dep, 1);
          stack.push({
            fn: dep,
            deps: dep.dependent ?? [],
            nextIdx: 0,
          });
        }
      } else {
        color.set(top.fn, 2);
        stack.pop();
      }
    }
  }

  return {
    isPurelyCombinational: !hasFeedbackLoops && !hasStatefulComponents,
    hasFeedbackLoops,
    hasStatefulComponents,
    reasons,
  };
}

// Isoliertes Test-Socket analog zu CircuitTestSocket.cs zur vollständigen bzw. gefilterten Wahrheitstabellen-Auswertung
export class CircuitTestSocket {
  readonly #inputs: InputPinSocket[];
  readonly #outputs: OutputPinSocket[];
  readonly #inputBitCount: number;
  readonly #totalCombinations: bigint;
  readonly #circuitMap: CircuitMap;
  readonly #circuitState: CircuitState;

  constructor(circuit: LogicalCircuit, project?: CircuitProject) {
    const rawPins = collectCircuitPins(circuit, project);
    const symbolCoordsByCircuitId = new Map<string, GridPoint>();
    for (const sym of circuit.circuitSymbols) {
      if (sym.circuit.kind === "pin") {
        const point: GridPoint = { x: sym.x, y: sym.y };
        symbolCoordsByCircuitId.set(sym.circuit.circuitId, point);
        symbolCoordsByCircuitId.set(sym.circuitId, point);
      }
    }

    const sortedPins = [...rawPins].sort((a, b) => comparePins(a, b, symbolCoordsByCircuitId));
    const inputSockets: InputPinSocket[] = [];
    const outputSockets: OutputPinSocket[] = [];
    const replacedSymbols = new Map<string, CircuitSymbol>();

    for (const pin of sortedPins) {
      const pinSymbol = circuit.circuitSymbols.find(
        (sym) =>
          sym.circuit.kind === "pin" &&
          (sym.circuitId === pin.pinId || sym.circuit.circuitId === pin.pinId),
      );
      if (!pinSymbol) {
        continue;
      }

      if (pin.pinType === "input") {
        const constant = createConstant(
          `socket-const-${pin.pinId}`,
          pin.bitWidth,
          0,
          "right",
          true,
          pinSymbol.circuit.symbolWidth,
          pinSymbol.circuit.symbolHeight,
        );
        const symbol = createCircuitSymbol(
          constant,
          circuit.logicalCircuitId,
          pinSymbol.x,
          pinSymbol.y,
          pinSymbol.rotation,
          `socket-in-sym-${pin.pinId}`,
        );
        if (pinSymbol.jams[0] && symbol.jams[0]) {
          symbol.jams[0] = {
            ...symbol.jams[0],
            x: pinSymbol.jams[0].x,
            y: pinSymbol.jams[0].y,
            absolutePoint: { ...pinSymbol.jams[0].absolutePoint },
            effectivePinType: "output",
          };
        }
        inputSockets.push({ pin, constant, symbol, function: null });
        replacedSymbols.set(pinSymbol.circuitSymbolId, symbol);
      } else {
        const probe = createCircuitProbe(
          `socket-probe-${pin.pinId}`,
          pin.name,
          "left",
          pinSymbol.circuit.symbolWidth,
          pinSymbol.circuit.symbolHeight,
          true,
        );
        probe.name = pin.name;
        const symbol = createCircuitSymbol(
          probe,
          circuit.logicalCircuitId,
          pinSymbol.x,
          pinSymbol.y,
          pinSymbol.rotation,
          `socket-out-sym-${pin.pinId}`,
        );
        if (pinSymbol.jams[0] && symbol.jams[0]) {
          symbol.jams[0] = {
            ...symbol.jams[0],
            x: pinSymbol.jams[0].x,
            y: pinSymbol.jams[0].y,
            absolutePoint: { ...pinSymbol.jams[0].absolutePoint },
            effectivePinType: "input",
          };
        }
        outputSockets.push({ pin, probe, symbol, function: null });
        replacedSymbols.set(pinSymbol.circuitSymbolId, symbol);
      }
    }

    const isolatedCircuit: LogicalCircuit = {
      ...circuit,
      logicalPins: [],
      circuitSymbols: circuit.circuitSymbols.map(
        (sym) => replacedSymbols.get(sym.circuitSymbolId) ?? sym,
      ),
      wires: [...circuit.wires],
      textNotes: [...circuit.textNotes],
    };

    this.#circuitMap = new CircuitMap(isolatedCircuit);
    this.#circuitState = this.#circuitMap.apply(1);

    const constantBySymbolId = new Map<string, FunctionConstant>();
    const probeBySymbolId = new Map<string, FunctionProbe>();
    for (const fn of this.#circuitState.functions) {
      const loc = this.#circuitState.getFunctionLocation(fn);
      if (!loc?.symbolId) {
        continue;
      }
      if (fn instanceof FunctionConstant) {
        constantBySymbolId.set(loc.symbolId, fn);
      } else if (fn instanceof FunctionProbe) {
        probeBySymbolId.set(loc.symbolId, fn);
      }
    }

    for (const inputSocket of inputSockets) {
      inputSocket.function = constantBySymbolId.get(inputSocket.symbol.circuitSymbolId) ?? null;
    }

    for (const outputSocket of outputSockets) {
      const probeFn = probeBySymbolId.get(outputSocket.symbol.circuitSymbolId) ?? null;
      outputSocket.function = probeFn && probeFn.parameterCount > 0 ? probeFn : null;
    }

    this.#inputs = inputSockets.filter((s) => s.function !== null);
    this.#outputs = outputSockets.filter((s) => s.function !== null);
    this.#inputBitCount = this.#inputs.reduce((sum, s) => sum + s.pin.bitWidth, 0);
    this.#totalCombinations = 1n << BigInt(this.#inputBitCount);
  }

  get inputs(): readonly InputPinSocket[] {
    return this.#inputs;
  }

  get outputs(): readonly OutputPinSocket[] {
    return this.#outputs;
  }

  get inputBitCount(): number {
    return this.#inputBitCount;
  }

  get totalCombinations(): bigint {
    return this.#totalCombinations;
  }

  get circuitMap(): CircuitMap {
    return this.#circuitMap;
  }

  get circuitState(): CircuitState {
    return this.#circuitState;
  }

  evaluate(): boolean {
    return this.#circuitState.evaluate(true);
  }

  analyzeCombinationalPurity(): CombinationalPurityAnalysis {
    return analyzeCombinationalPurity(this.#circuitState);
  }

  buildTruthTable(options: TruthTableBuildOptions = {}): TruthTableBuildResult {
    const maxCount = options.maxCount ?? DEFAULT_MAX_TRUTH_TABLE_ROWS;
    const keepGoing = options.keepGoing ?? (() => true);
    const include = options.include ?? null;
    const reportProgress = options.reportProgress;

    const inputCount = this.#inputs.length;
    const outputCount = this.#outputs.length;
    if (inputCount === 0 || outputCount === 0) {
      return {
        rows: [],
        truncated: false,
        oscillation: false,
      };
    }

    for (const inputSocket of this.#inputs) {
      if (inputSocket.function) {
        this.#circuitState.markUpdated(inputSocket.function);
      }
    }

    const outputBitWidths = this.#outputs.map((o) => o.function!.parameterCount);
    const total = this.#totalCombinations;
    const onePercent = total / 100n;
    let progressCounter = 0n;
    let progress = 0;

    const rows: TruthState[] = [];
    let truncated = false;

    for (let value = 0n; value < total; value++) {
      if (rows.length >= maxCount || !keepGoing()) {
        truncated = true;
        break;
      }

      let bit = 0n;
      for (let i = inputCount - 1; i >= 0; i--) {
        const inputSocket = this.#inputs[i]!;
        const bw = inputSocket.pin.bitWidth;
        const mask = bw < 32 ? (1n << BigInt(bw)) - 1n : 0xffffffffn;
        const v = Number((value >> bit) & mask) | 0;
        inputSocket.function!.value = v;
        bit += BigInt(bw);
      }

      if (!this.#circuitState.evaluate(true)) {
        return {
          rows: null,
          truncated,
          oscillation: true,
        };
      }

      const row = new TruthState(inputCount, outputCount);
      for (let i = 0; i < inputCount; i++) {
        row.input[i] = this.#inputs[i]!.function!.value | 0;
      }
      for (let i = 0; i < outputCount; i++) {
        const probeFn = this.#outputs[i]!.function!;
        const bits = new Array(probeFn.parameterCount);
        for (let b = 0; b < probeFn.parameterCount; b++) {
          bits[b] = probeFn.get(b);
        }
        row.rawStates[i] = bits;
      }

      const unpacked = row.unpack(outputBitWidths);
      if (!unpacked || !include || include(row)) {
        rows.push(row);
      }

      if (reportProgress) {
        progressCounter++;
        if (progressCounter > onePercent) {
          progressCounter = 0n;
          if (onePercent === 0n) {
            progress = Math.min(100, (Number(value + 1n) * 100) / Number(total));
          } else {
            progress = Math.min(progress + 1, 100);
          }
          reportProgress(progress);
        }
      }
    }

    if (reportProgress && !truncated && progress < 100) {
      reportProgress(100);
    }

    return {
      rows,
      truncated,
      oscillation: false,
    };
  }
}

export default CircuitTestSocket;
