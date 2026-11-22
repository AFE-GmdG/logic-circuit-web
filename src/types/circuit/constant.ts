import type Circuit from "./circuit";
import type PinSide from "./pinSide";

// Konstanten-Signalquelle (1..32 Bit) analog zu Constant.cs
type Constant = Circuit & {
  kind: "constant";
  constantId: string;
  bitWidth: number;
  value: number;
  pinSide: PinSide;
  isHex?: boolean;
};

export default Constant;
