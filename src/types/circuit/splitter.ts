import type Circuit from "./circuit";

// Multi-Bit-Bus-Splitter / Bündler analog zu Splitter.cs
type Splitter = Circuit & {
  kind: "splitter";
  splitterId: string;
  bitWidth: number;
  pinCount: number;
  clockwise: boolean;
};

export default Splitter;
