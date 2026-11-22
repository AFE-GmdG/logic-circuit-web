import type Jam from "../../types/circuit/jam";

export function getJamKey(jam: Jam): string {
  return `${jam.circuitSymbolId}:${jam.pin.pinId}`;
}

// Repräsentiert eine gerichtete Verbindung zwischen zwei Jams analog zu Connection.cs
export class Connection {
  readonly inJam: Jam;
  readonly outJam: Jam;

  constructor(inJam: Jam, outJam: Jam) {
    this.inJam = inJam;
    this.outJam = outJam;
  }
}

// Verwaltet alle ermittelten Signalverbindungen einer Schaltungshierarchie analog zu ConnectionSet.cs
export class ConnectionSet {
  readonly #connectedCircuits = new Set<string>();
  readonly #outputs = new Map<string, Map<string, Connection>>();

  isConnected(logicalCircuitId: string): boolean {
    return this.#connectedCircuits.has(logicalCircuitId);
  }

  markConnected(logicalCircuitId: string): void {
    this.#connectedCircuits.add(logicalCircuitId);
  }

  connect(inJam: Jam, outJam: Jam): Connection {
    const outKey = getJamKey(outJam);
    const inKey = getJamKey(inJam);

    let inputs = this.#outputs.get(outKey);
    if (!inputs) {
      inputs = new Map<string, Connection>();
      this.#outputs.set(outKey, inputs);
    }

    const existing = inputs.get(inKey);
    if (existing) {
      return existing;
    }

    const connection = new Connection(inJam, outJam);
    inputs.set(inKey, connection);
    return connection;
  }

  selectByOutput(outJam: Jam): Connection[] {
    const outKey = getJamKey(outJam);
    const inputs = this.#outputs.get(outKey);
    if (!inputs) {
      return [];
    }
    return Array.from(inputs.values());
  }
}

export default ConnectionSet;
