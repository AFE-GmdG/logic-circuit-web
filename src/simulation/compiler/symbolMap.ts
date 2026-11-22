import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Gate from "../../types/circuit/gate";
import type Jam from "../../types/circuit/jam";

import i18n from "../../i18n";

import CircuitException from "./circuitException";
import type CircuitMap from "./circuitMap";
import type CircuitState from "../state/circuitState";

export function getJamBitKey(jam: Jam, bitNumber: number): string {
  return `${jam.circuitSymbolId}:${jam.pin.pinId}:${bitNumber}`;
}

// Basisklasse für Zustandselemente (Result und Parameter) analog zu StateIndex in C#
export abstract class StateIndex {
  readonly circuitMap: CircuitMap;
  readonly jam: Jam;
  readonly bitNumber: number;

  constructor(circuitMap: CircuitMap, jam: Jam, bitNumber: number) {
    this.circuitMap = circuitMap;
    this.jam = jam;
    this.bitNumber = bitNumber;
  }
}

// Repräsentiert das erzeugte Ausgangssignal eines primitiven Bausteins analog zu Result in C#
export class Result extends StateIndex {
  triStateGroup: Set<Result> | null = null;
  readonly parameters: Parameter[] = [];
  stateIndex = 0;
  privateIndex = 0;

  constructor(circuitMap: CircuitMap, jam: Jam, bitNumber: number) {
    super(circuitMap, jam, bitNumber);
    const ownerSymbol = circuitMap.findSymbol(jam.circuitSymbolId);
    const circuit = ownerSymbol?.circuit ?? null;
    const gateType = circuit?.kind === "gate" ? (circuit as Gate).gateType : null;
    if (gateType === "triState1" || gateType === "triState2") {
      this.triStateGroup = new Set<Result>([this]);
    }
  }

  get isTriState(): boolean {
    return this.triStateGroup !== null;
  }

  add(parameter: Parameter): void {
    this.parameters.push(parameter);
  }

  // Verknüpft mehrere Tri-State-Treiber zu einer gemeinsamen Gruppe analog zu Result.Link
  link(other: Result): void {
    if (!this.isTriState || !other.isTriState) {
      const locSym = this.circuitMap.findSymbol(this.jam.circuitSymbolId);
      throw new CircuitException(
        i18n.t("errors.compiler.onlyTriStateMayShare"),
        "userError",
        locSym ? this.circuitMap.getSymbolLocation(locSym) : undefined,
      );
    }
    if (this.triStateGroup !== other.triStateGroup) {
      for (const p of other.parameters) {
        this.parameters.push(p);
      }
      for (const r of other.triStateGroup!) {
        this.triStateGroup!.add(r);
      }
      for (const r of this.triStateGroup!) {
        r.triStateGroup = this.triStateGroup;
      }
    }
  }

  // Allokiert einen oder zwei Indizes im flachen CircuitState-Array analog zu Result.Allocate
  allocate(circuitState: CircuitState): void {
    if (this.triStateGroup && this.triStateGroup.size > 0) {
      if (this.stateIndex === 0) {
        const sharedState = circuitState.reserveState();
        for (const r of this.triStateGroup) {
          r.stateIndex = sharedState;
        }
      }
      this.privateIndex = circuitState.reserveState();
    } else if (this.stateIndex === 0) {
      this.stateIndex = circuitState.reserveState();
    }
  }
}

// Repräsentiert den Eingang eines primitiven Bausteins analog zu Parameter in C#
export class Parameter extends StateIndex {
  readonly result: Result;

  constructor(result: Result, circuitMap: CircuitMap, jam: Jam, bitNumber: number) {
    super(circuitMap, jam, bitNumber);
    this.result = result;
  }
}

// Kartiert alle Results und Parameters für eine konkrete platzierte Bauteil-Instanz analog zu SymbolMap in C#
export class SymbolMap {
  readonly circuitMap: CircuitMap;
  readonly circuitSymbol: CircuitSymbol;
  readonly #resultMap = new Map<string, Result>();
  readonly #parameterMap = new Map<string, Parameter>();

  constructor(circuitMap: CircuitMap, circuitSymbol: CircuitSymbol) {
    this.circuitMap = circuitMap;
    this.circuitSymbol = circuitSymbol;
  }

  get results(): Result[] {
    return Array.from(this.#resultMap.values());
  }

  get parameters(): Parameter[] {
    return Array.from(this.#parameterMap.values());
  }

  get hasResults(): boolean {
    return this.#resultMap.size > 0;
  }

  addResult(circuitMap: CircuitMap, jam: Jam, bitNumber: number): Result {
    const key = getJamBitKey(jam, bitNumber);
    let res = this.#resultMap.get(key);
    if (!res) {
      res = new Result(circuitMap, jam, bitNumber);
      this.#resultMap.set(key, res);
    }
    return res;
  }

  addParameter(result: Result, circuitMap: CircuitMap, jam: Jam, bitNumber: number): Parameter {
    const key = getJamBitKey(jam, bitNumber);
    const existing = this.#parameterMap.get(key);
    if (existing) {
      if (!existing.result.isTriState || !result.isTriState) {
        if (
          existing.result === result &&
          existing.circuitMap === circuitMap &&
          existing.jam === jam &&
          existing.bitNumber === bitNumber
        ) {
          return existing;
        }
        throw new CircuitException(
          i18n.t("errors.compiler.multipleDriversOnInput", {
            pinName: jam.pin.name,
            circuitName: this.circuitMap.circuit.name,
          }),
          "userError",
          this.circuitMap.getSymbolLocation(this.circuitSymbol),
        );
      }
      existing.result.link(result);
      return existing;
    }

    const parameter = new Parameter(result, circuitMap, jam, bitNumber);
    this.#parameterMap.set(key, parameter);
    result.add(parameter);
    return parameter;
  }

  getResult(jam: Jam, bitNumber: number): Result | undefined {
    return this.#resultMap.get(getJamBitKey(jam, bitNumber));
  }

  getParameter(jam: Jam, bitNumber: number): Parameter | undefined {
    return this.#parameterMap.get(getJamBitKey(jam, bitNumber));
  }

  allResults(jam: Jam): Result[] {
    const prefix = `${jam.circuitSymbolId}:${jam.pin.pinId}:`;
    return Array.from(this.#resultMap.entries())
      .filter(([k]) => k.startsWith(prefix))
      .sort((a, b) => a[1].bitNumber - b[1].bitNumber)
      .map((entry) => entry[1]);
  }

  allParameters(jam: Jam): Parameter[] {
    const prefix = `${jam.circuitSymbolId}:${jam.pin.pinId}:`;
    return Array.from(this.#parameterMap.entries())
      .filter(([k]) => k.startsWith(prefix))
      .sort((a, b) => a[1].bitNumber - b[1].bitNumber)
      .map((entry) => entry[1]);
  }
}

export default SymbolMap;
