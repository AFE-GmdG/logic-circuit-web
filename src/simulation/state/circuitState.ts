import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";
import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import DirtyList from "./dirtyList";
import type CircuitFunction from "../functions/circuitFunction";
import { isFunctionClock } from "../functions/iFunctionClock";

// Zentrale Zustandsverwaltung und Auswertungs-Engine analog zu CircuitState.cs
export class CircuitState {
  readonly #dirty: DirtyList;
  #stateArray: Uint8Array | null = null;
  #dependentList: CircuitFunction[][] | null = null;
  readonly #functionsList: CircuitFunction[] = [];
  readonly #clockList: CircuitFunction[] = [];
  readonly #probeList: CircuitFunction[] = [];
  readonly #triStateGroupList: CircuitFunction[] = [];
  readonly #postEvaluateList: CircuitFunction[] = [];
  readonly #updatedSet = new Set<CircuitFunction>();
  readonly #functionLocations = new Map<CircuitFunction, SimulationErrorLocation>();
  #lastOscillatingLocation: SimulationErrorLocation | null = null;

  count: number;
  onFunctionUpdated?: () => void;

  constructor(reserveState = 3, seed = 123456789) {
    this.#dirty = new DirtyList(seed);
    this.count = reserveState;
  }

  // Liefert den rohen Uint8Array-Zustandsvektor
  get state(): Uint8Array {
    if (!this.#stateArray) {
      this.#ensureStateAllocated();
    }
    return this.#stateArray!;
  }

  get functions(): readonly CircuitFunction[] {
    return this.#functionsList;
  }

  get hasProbes(): boolean {
    return this.#probeList.length > 0;
  }

  get probes(): readonly CircuitFunction[] {
    return this.#probeList;
  }

  get hasClocks(): boolean {
    return this.#clockList.length > 0;
  }

  get clocks(): readonly CircuitFunction[] {
    return this.#clockList;
  }

  get lastOscillatingLocation(): SimulationErrorLocation | null {
    return this.#lastOscillatingLocation;
  }

  // Ordnet einer Simulationsfunktion das zugehörige Bauteil im Schaltplan zu
  setFunctionLocation(fn: CircuitFunction, location: SimulationErrorLocation): void {
    this.#functionLocations.set(fn, location);
  }

  getFunctionLocation(fn: CircuitFunction): SimulationErrorLocation | undefined {
    return this.#functionLocations.get(fn);
  }

  // Reserviert einen neuen Signalindex im flachen Zustandsvektor
  reserveState(): number {
    return this.count++;
  }

  // Registriert eine Funktion bei der Zustands-Engine
  defineFunction(fn: CircuitFunction): void {
    this.#ensureStateAllocated();
    this.#functionsList.push(fn);

    if (isFunctionClock(fn)) {
      this.#clockList.push(fn);
    }

    if ("evaluateAfterSettle" in fn && (fn as { evaluateAfterSettle?: boolean }).evaluateAfterSettle) {
      this.#postEvaluateList.push(fn);
      return;
    }

    let inputCount = 0;
    for (const param of fn.parameter) {
      if (param >= 0 && param < this.#dependentList!.length) {
        this.#dependentList![param].push(fn);
        inputCount++;
      }
    }

    if (inputCount <= 0) {
      this.#dirty.add(fn);
    } else if (fn.constructor.name.includes("Probe")) {
      this.#probeList.push(fn);
    }

    if (fn.constructor.name.includes("TriStateGroup")) {
      this.#triStateGroupList.push(fn);
    }
  }

  // Schließt die Definition ab und baut die Abhängigkeitsgraphen (Dependent) auf
  endDefinition(externalBuffer?: ArrayBufferLike): void {
    if (externalBuffer && externalBuffer.byteLength >= this.count) {
      const externalState = new Uint8Array(externalBuffer, 0, this.count);
      if (this.#stateArray) {
        externalState.set(this.#stateArray);
      }
      this.#stateArray = externalState;
    } else {
      this.#ensureStateAllocated();
    }

    // Für jede Funktion alle Funktionen sammeln, die von ihren Ausgängen abhängen
    for (const fn of this.#functionsList) {
      if (fn.result.length > 0) {
        const dependents = new Set<CircuitFunction>();
        for (const res of fn.result) {
          if (res >= 0 && res < this.#dependentList!.length) {
            for (const dep of this.#dependentList![res]) {
              dependents.add(dep);
            }
          }
        }
        fn.dependent = Array.from(dependents);
      }
    }

    // Tri-State-Gruppen initial als dirty markieren
    for (const group of this.#triStateGroupList) {
      if (group.dependent) {
        this.#dirty.addMultiple(group.dependent);
      }
    }
  }

  // Markiert eine Funktion (z. B. Taster oder Sensor) als extern verändert
  markUpdated(fn: CircuitFunction): void {
    this.#updatedSet.add(fn);
    if (this.onFunctionUpdated) {
      this.onFunctionUpdated();
    }
  }

  // Liest einen Signalzustand (schneller direkter Array-Zugriff)
  get(index: number): State {
    if (!this.#stateArray) {
      this.#ensureStateAllocated();
    }
    if (index < 0 || index >= this.#stateArray!.length) {
      return STATE_OFF;
    }
    return this.#stateArray![index] as State;
  }

  // Schreibt einen Signalzustand
  set(index: number, value: State): void {
    if (!this.#stateArray) {
      this.#ensureStateAllocated();
    }
    if (index >= 0 && index < this.#stateArray!.length) {
      this.#stateArray![index] = value;
    }
  }

  // Führt einen Evaluationsschritt durch. Gibt false zurück, wenn eine Schwingung/Oszillation erkannt wurde.
  evaluate(flipClock: boolean): boolean {
    this.#ensureStateAllocated();

    // Extern veränderte Funktionen einreihen
    if (this.#updatedSet.size > 0) {
      for (const fn of this.#updatedSet) {
        this.#dirty.add(fn);
      }
      this.#updatedSet.clear();
    }

    // Taktflanke invertieren falls angefordert
    if (flipClock) {
      for (const clk of this.#clockList) {
        if (isFunctionClock(clk) && clk.flip()) {
          this.#dirty.add(clk);
        }
      }
    }

    const maxRetry = 3;
    let attempt = 0;
    this.#dirty.delay = attempt;

    const stateLen = this.#stateArray!.length;
    let oscillation = Math.max(16, stateLen * stateLen);

    let fn: CircuitFunction | null;
    while ((fn = this.#dirty.get()) !== null) {
      if (fn.evaluate()) {
        if (fn.dependent) {
          this.#dirty.addMultiple(fn.dependent);
        }
        if (--oscillation < 0) {
          if (attempt >= maxRetry) {
            this.#lastOscillatingLocation = this.#functionLocations.get(fn) ?? null;
            return false; // Oszillationserkennung: Schaltung schwingt endlos
          }
          oscillation = Math.max(16, stateLen * stateLen);
          this.#dirty.delay = ++attempt;
        }
      }
    }

    // Zustandsbehaftete Senken (z. B. gemultiplexte LED-Matrix) erst nach dem Einschwingen auswerten
    for (const postFn of this.#postEvaluateList) {
      postFn.evaluate();
    }

    return true;
  }

  #ensureStateAllocated(): void {
    if (!this.#stateArray) {
      this.#stateArray = new Uint8Array(this.count);
      this.#stateArray[0] = STATE_OFF;
      this.#stateArray[1] = STATE_ON0;
      this.#stateArray[2] = STATE_ON1;

      this.#dependentList = Array.from({ length: this.count }, () => []);
    }
  }
}

export default CircuitState;
