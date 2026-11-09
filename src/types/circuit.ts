export type SignalState = "low" | "high" | "undefined";

export type GateType =
  | "and"
  | "or"
  | "not"
  | "xor"
  | "nand"
  | "nor"
  | "buffer"
  | "clock"
  | "button"
  | "constant"
  | "probe";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type ComponentPin = {
  id: string;
  name: string;
  type: "input" | "output";
  bitWidth: number;
  relativePosition: CanvasPoint;
};

export type CircuitComponent = {
  id: string;
  type: GateType;
  name: string;
  position: CanvasPoint;
  width: number;
  height: number;
  pins: ComponentPin[];
};

export type WireConnection = {
  id: string;
  fromComponentId: string;
  fromPinId: string;
  toComponentId: string;
  toPinId: string;
  points: CanvasPoint[];
};

export type LogicalCircuit = {
  id: string;
  name: string;
  description?: string;
  components: CircuitComponent[];
  wires: WireConnection[];
};
