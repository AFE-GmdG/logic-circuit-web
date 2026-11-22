import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Jam from "../../types/circuit/jam";

import type CircuitMap from "./circuitMap";
import SymbolMap, { type Parameter, type Result } from "./symbolMap";

// Verwaltet alle primitiven SymbolMaps während der Schaltungskompilierung analog zu SymbolMapList in C#
export class SymbolMapList {
  readonly #symbols = new Map<string, SymbolMap>();

  #getSymbolKey(circuitMap: CircuitMap, circuitSymbol: CircuitSymbol): string {
    return `${circuitMap.path()}:${circuitSymbol.circuitSymbolId}`;
  }

  addSymbol(circuitMap: CircuitMap, circuitSymbol: CircuitSymbol): SymbolMap {
    const key = this.#getSymbolKey(circuitMap, circuitSymbol);
    let map = this.#symbols.get(key);
    if (!map) {
      map = new SymbolMap(circuitMap, circuitSymbol);
      this.#symbols.set(key, map);
    }
    return map;
  }

  addResult(circuitMap: CircuitMap, jam: Jam, bitNumber: number): Result {
    const symbol = circuitMap.findSymbol(jam.circuitSymbolId);
    if (!symbol) {
      throw new Error(`Symbol ${jam.circuitSymbolId} nicht gefunden`);
    }
    const map = this.addSymbol(circuitMap, symbol);
    return map.addResult(circuitMap, jam, bitNumber);
  }

  addParameter(result: Result, circuitMap: CircuitMap, jam: Jam, bitNumber: number): Parameter {
    const symbol = circuitMap.findSymbol(jam.circuitSymbolId);
    if (!symbol) {
      throw new Error(`Symbol ${jam.circuitSymbolId} nicht gefunden`);
    }
    const map = this.addSymbol(circuitMap, symbol);
    return map.addParameter(result, circuitMap, jam, bitNumber);
  }

  remove(map: SymbolMap): void {
    const key = this.#getSymbolKey(map.circuitMap, map.circuitSymbol);
    this.#symbols.delete(key);
  }

  getSymbolMap(circuitMap: CircuitMap, circuitSymbol: CircuitSymbol): SymbolMap | undefined {
    return this.#symbols.get(this.#getSymbolKey(circuitMap, circuitSymbol));
  }

  get symbolMaps(): SymbolMap[] {
    return Array.from(this.#symbols.values());
  }
}

export default SymbolMapList;
