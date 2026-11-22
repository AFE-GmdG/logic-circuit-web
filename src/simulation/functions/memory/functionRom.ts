import type Memory from "../../../types/circuit/memory";

import FunctionMemory from "./functionMemory";
import type CircuitState from "../../state/circuitState";

// Simulationsfunktion für Nur-Lese-Speicher (ROM) analog zu FunctionRom.cs
export class FunctionRom extends FunctionMemory {
  constructor(
    circuitState: CircuitState,
    address: number[],
    result: number[],
    address2: number[] | null,
    result2: number[] | null,
    memory: Memory,
    memoryInstanceId: string,
  ) {
    super(
      circuitState,
      address,
      null,
      result,
      address2,
      result2,
      -1,
      memory,
      memoryInstanceId,
    );
  }

  evaluate(): boolean {
    return this.read();
  }

  get reportName(): string {
    return `ROM ${this.addressBitWidth}x${this.dataBitWidth}`;
  }
}

export default FunctionRom;
