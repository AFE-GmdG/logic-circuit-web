// Kanonische Gattertypen analog zu GateType.cs im C#-Original
type GateType =
  | "nop"
  | "clock"
  | "not"
  | "or"
  | "and"
  | "xor"
  | "led"
  | "triState1"
  | "triState2";

export default GateType;
