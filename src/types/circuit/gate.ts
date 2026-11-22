import type Circuit from "./circuit";
import type DisplayColor from "./displayColor";
import type GateType from "./gateType";

// Deterministisches Logikgatter-, Taktgeber- oder LED-Bauteil analog zu Gate.cs
type Gate = Circuit & {
  kind: "gate";
  gateId: string;
  gateType: GateType;
  inputCount: number;
  invertedOutput: boolean;
  isOn?: boolean;
  color?: DisplayColor;
};

export default Gate;
