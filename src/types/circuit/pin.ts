import type BasePin from "./basePin";

// Platzierbarer Ein-/Ausgangs-Pin einer LogicalCircuit analog zu Pin.cs
type Pin = BasePin & {
  kind: "pin";
  index: number;
};

export default Pin;
