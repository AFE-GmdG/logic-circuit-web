import type Circuit from "./circuit";
import type PinSide from "./pinSide";
import type SoundWaveform from "./soundWaveform";

// Audio-Ausgangsbaustein analog zu Sound.cs
type Sound = Circuit & {
  kind: "sound";
  soundId: string;
  pinSide: PinSide;
  frequency?: number;
  waveform?: SoundWaveform;
};

export default Sound;
