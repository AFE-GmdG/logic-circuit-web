import type SoundWaveform from "../../../types/circuit/soundWaveform";
import { STATE_ON1 } from "../../../types/simulation/state";

import { clampSoundFrequency, SOUND_DEFAULT_FREQUENCY } from "../../../utils/audioPitchTable";

import Probe from "./probe";
import type CircuitState from "../../state/circuitState";
import type { AudioChannelSnapshot } from "../../worker/workerMessages";

export type FunctionSoundOptions = {
  channelId: string;
  frequency?: number;
  waveform?: SoundWaveform;
};

// Akustische Ausgabefunktion fuer den Standard-Summer analog zu FunctionSound.cs
export class FunctionSound extends Probe {
  readonly channelId: string;
  readonly frequency: number;
  readonly waveform: SoundWaveform;

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    options: FunctionSoundOptions,
  ) {
    super(circuitState, parameter);
    this.channelId = options.channelId;
    this.frequency = clampSoundFrequency(options.frequency ?? SOUND_DEFAULT_FREQUENCY);
    this.waveform = options.waveform ?? "sine";
  }

  get isOn(): boolean {
    return this.get(0) === STATE_ON1;
  }

  get reportName(): string {
    return "Sound";
  }

  evaluate(): boolean {
    this.updateState();
    return false;
  }

  toAudioSnapshot(): AudioChannelSnapshot {
    this.updateState();
    const active = this.isOn;
    return {
      channelId: this.channelId,
      kind: "sound",
      active,
      mode: this.waveform,
      frequencyHz: active ? this.frequency : null,
      channelGain: active ? 1 : 0,
    };
  }
}

export default FunctionSound;
