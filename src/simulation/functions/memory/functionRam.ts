import FunctionMemory from "./functionMemory";

// Simulationsfunktion für beschreibbaren Arbeitsspeicher (RAM) analog zu FunctionRam.cs
export class FunctionRam extends FunctionMemory {
  evaluate(): boolean {
    if (this.isWriteAllowed()) {
      this.write();
    }
    return this.read();
  }

  get reportName(): string {
    return `RAM ${this.addressBitWidth}x${this.dataBitWidth}`;
  }
}

export default FunctionRam;
