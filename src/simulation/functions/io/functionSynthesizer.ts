import type SynthesizerMode from "../../../types/circuit/synthesizerMode";
import { STATE_ON1 } from "../../../types/simulation/state";

import {
  normalizeChannelGain,
  resolveNoiseFilterFrequency,
  resolveNoisePlaybackRate,
  resolveSynthesizerPitch,
} from "../../../utils/audioPitchTable";

import Probe from "./probe";
import type CircuitState from "../../state/circuitState";
import type { AudioChannelSnapshot } from "../../worker/workerMessages";

export type FunctionSynthesizerOptions = {
  channelId: string;
  mode: SynthesizerMode;
};

// Akustische 8-Bit-Synthesizer-Funktion (Parameter-Layout: [0..7]=Frequency, [8..15]=Volume, [16]=Enable)
export class FunctionSynthesizer extends Probe {
  readonly channelId: string;
  readonly mode: SynthesizerMode;

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    options: FunctionSynthesizerOptions,
  ) {
    super(circuitState, parameter);
    this.channelId = options.channelId;
    this.mode = options.mode;
  }

  get isEnabled(): boolean {
    return this.get(16) === STATE_ON1;
  }

  get rawFrequency(): number {
    return this.#readByte(0);
  }

  get rawVolume(): number {
    return this.#readByte(8);
  }

  get reportName(): string {
    return "Synthesizer";
  }

  evaluate(): boolean {
    this.updateState();
    return false;
  }

  toAudioSnapshot(): AudioChannelSnapshot {
    this.updateState();
    const rawFrequency = this.rawFrequency;
    const rawVolume = this.rawVolume;
    const enabled = this.isEnabled;

    if (!enabled) {
      return {
        channelId: this.channelId,
        kind: "synthesizer",
        active: false,
        mode: this.mode,
        frequencyHz: null,
        channelGain: 0,
        noisePlaybackRate: null,
        rawPitch: rawFrequency,
        rawVolume,
      };
    }

    const channelGain = normalizeChannelGain(rawVolume);
    if (this.mode === "noise") {
      const filterHz = resolveNoiseFilterFrequency(rawFrequency);
      const playbackRate = resolveNoisePlaybackRate(rawFrequency);
      const active = filterHz !== null && channelGain > 0;
      return {
        channelId: this.channelId,
        kind: "synthesizer",
        active,
        mode: this.mode,
        frequencyHz: filterHz,
        channelGain,
        noisePlaybackRate: playbackRate,
        rawPitch: rawFrequency,
        rawVolume,
      };
    }

    const pitch = resolveSynthesizerPitch(rawFrequency);
    const active = pitch !== null && channelGain > 0;
    return {
      channelId: this.channelId,
      kind: "synthesizer",
      active,
      mode: this.mode,
      frequencyHz: pitch ? pitch.frequencyHz : null,
      channelGain,
      noisePlaybackRate: null,
      rawPitch: rawFrequency,
      rawVolume,
    };
  }

  #readByte(offset: number): number {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (this.get(offset + bit) === STATE_ON1) {
        value |= 1 << bit;
      }
    }
    return value;
  }
}

export default FunctionSynthesizer;
