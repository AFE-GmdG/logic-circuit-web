import type Circuit from "./circuit";
import type MemoryOnStart from "./memoryOnStart";

// Speicherbaustein (ROM / RAM) analog zu Memory.cs
type Memory = Circuit & {
  kind: "memory";
  memoryId: string;
  writable: boolean;
  writeOn1: boolean;
  onStart: MemoryOnStart;
  addressBitWidth: number;
  dataBitWidth: number;
  dualPort: boolean;
  data: string;
};

export default Memory;
