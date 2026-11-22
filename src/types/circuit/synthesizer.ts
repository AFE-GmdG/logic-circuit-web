import type Circuit from "./circuit";
import type SynthesizerMode from "./synthesizerMode";

type Synthesizer = Circuit & {
  kind: "synthesizer";
  synthesizerId: string;
  mode: SynthesizerMode;
};

export default Synthesizer;
