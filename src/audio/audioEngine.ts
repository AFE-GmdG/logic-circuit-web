import type SynthesizerMode from "../types/circuit/synthesizerMode";

import { AUDIO_DEFAULT_VOLUME, AUDIO_SINGLE_STEP_DURATION_MS } from "../utils/audioPitchTable";

export type AudioPlaybackMode = "continuous" | "singleStep";

export type AudioEngineChannel = {
  channelId: string;
  kind: "sound" | "synthesizer";
  active: boolean;
  mode: SynthesizerMode;
  frequencyHz: number | null;
  channelGain: number;
  noisePlaybackRate?: number | null;
};

export type AudioEngineOptions = {
  createContext?: () => AudioContext;
};

type ActiveVoice = {
  channelId: string;
  kind: "sound" | "synthesizer";
  mode: SynthesizerMode;
  sourceNode: OscillatorNode | AudioBufferSourceNode;
  filterNode: BiquadFilterNode | null;
  voiceGain: GainNode;
};

const LIMITER_THRESHOLD_DB = -6;
const LIMITER_KNEE_DB = 12;
const LIMITER_RATIO = 8;
const LIMITER_ATTACK_SEC = 0.003;
const LIMITER_RELEASE_SEC = 0.1;
const NOISE_FILTER_Q = 2.0;

const applyParamImmediate = (param: AudioParam | undefined, value: number, now: number): void => {
  if (!param) {
    return;
  }
  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, now);
  } else {
    param.value = value;
  }
};

/**
 * Polyphone Web-Audio-Engine fuer Standard-Summer und 8-Bit-Synthesizer mit Soft-Limiter,
 * Bandpass-Noise-Synthese und zeitlich begrenzter Einzelschritt-Ausgabe (250 ms).
 */
export default class AudioEngine {
  readonly #createContext: (() => AudioContext) | undefined;
  #context: AudioContext | null = null;
  #masterGain: GainNode | null = null;
  #limiter: DynamicsCompressorNode | null = null;
  #noiseBuffer: AudioBuffer | null = null;
  readonly #voices = new Map<string, ActiveVoice>();
  #masterVolume = AUDIO_DEFAULT_VOLUME;
  #muted = false;
  #stepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: AudioEngineOptions) {
    this.#createContext = options?.createContext;
  }

  /** Gibt die Anzahl aktuell aktiver Tonstimmen zurueck (hilfreich fuer Tests und Diagnose). */
  get activeVoiceCount(): number {
    return this.#voices.size;
  }

  /** Aktiviert bzw. entsperrt den AudioContext direkt in einem Benutzer-Event-Handler. */
  unlock(): void {
    if (!this.#ensureContext()) {
      return;
    }

    const ctx = this.#context;
    if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
      void ctx.resume().catch(() => {});
    }
  }

  /** Aktualisiert globale Master-Lautstaerke (0..100) und Stummschaltung. */
  setMasterSettings(volume: number, muted: boolean): void {
    const safeVolume = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : AUDIO_DEFAULT_VOLUME;
    this.#masterVolume = safeVolume;
    this.#muted = Boolean(muted);
    this.#applyMasterGain();

    if (this.#muted || this.#masterVolume <= 0) {
      this.silenceAll();
    }
  }

  /** Synchronisiert alle laufenden Tonstimmen mit dem aktuellen Simulations-Snapshot. */
  syncChannels(channels: readonly AudioEngineChannel[], playbackMode: AudioPlaybackMode): void {
    this.#clearStepTimer();

    if (this.#muted || this.#masterVolume <= 0) {
      this.#stopAllVoices();
      return;
    }

    const playable = channels.filter(
      (channel) =>
        channel.active &&
        channel.frequencyHz !== null &&
        Number.isFinite(channel.frequencyHz) &&
        channel.frequencyHz > 0 &&
        channel.channelGain > 0,
    );

    if (playable.length === 0) {
      this.#stopAllVoices();
      return;
    }

    if (!this.#ensureContext() || !this.#context || !this.#masterGain) {
      return;
    }

    const ctx = this.#context;
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      void ctx.resume().catch(() => {});
    }

    const playableById = new Map<string, AudioEngineChannel>();
    for (const channel of playable) {
      playableById.set(channel.channelId, channel);
    }

    for (const [channelId, voice] of this.#voices.entries()) {
      const next = playableById.get(channelId);
      if (!next || next.kind !== voice.kind || next.mode !== voice.mode) {
        this.#stopVoice(voice);
        this.#voices.delete(channelId);
      }
    }

    const now = ctx.currentTime ?? 0;
    for (const channel of playable) {
      const existing = this.#voices.get(channel.channelId);
      if (existing) {
        this.#updateVoice(existing, channel, now);
      } else {
        const created = this.#startVoice(ctx, this.#masterGain, channel, now);
        if (created) {
          this.#voices.set(channel.channelId, created);
        }
      }
    }

    if (playbackMode === "singleStep") {
      this.#stepTimer = setTimeout(() => {
        this.#stepTimer = null;
        this.#stopAllVoices();
      }, AUDIO_SINGLE_STEP_DURATION_MS);
    }
  }

  /** Spielt einen kurzen Test-Ton im angegebenen Modus ab (z. B. aus dem Eigenschaftsdialog). */
  playPreviewTone(mode: SynthesizerMode, frequencyHz: number): void {
    if (this.#muted || this.#masterVolume <= 0 || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
      return;
    }

    this.unlock();
    this.syncChannels(
      [
        {
          channelId: "__preview__",
          kind: mode === "noise" ? "synthesizer" : "sound",
          active: true,
          mode,
          frequencyHz,
          channelGain: 1,
          noisePlaybackRate: 1,
        },
      ],
      "singleStep",
    );
  }

  /** Beendet sofort alle aktiven Stimmen und verwirft laufende Einzelschritt-Timer. */
  silenceAll(): void {
    this.#clearStepTimer();
    this.#stopAllVoices();
  }

  /** Bereinigt saemtliche Audio-Ressourcen beim Unmount. */
  dispose(): void {
    this.silenceAll();

    try {
      this.#masterGain?.disconnect();
    } catch {
      // Ignoriere Disconnect-Fehler bereits geschlossener Nodes
    }
    try {
      this.#limiter?.disconnect();
    } catch {
      // Ignoriere Disconnect-Fehler bereits geschlossener Nodes
    }

    const ctx = this.#context;
    this.#masterGain = null;
    this.#limiter = null;
    this.#noiseBuffer = null;
    this.#context = null;

    if (ctx && typeof ctx.close === "function") {
      void ctx.close().catch(() => {});
    }
  }

  #clearStepTimer(): void {
    if (this.#stepTimer !== null) {
      clearTimeout(this.#stepTimer);
      this.#stepTimer = null;
    }
  }

  #ensureContext(): boolean {
    if (this.#context && this.#masterGain) {
      return true;
    }

    let createdContext: AudioContext | null = null;
    try {
      if (this.#createContext) {
        createdContext = this.#createContext();
      } else if (typeof window !== "undefined") {
        const win = window as Window & {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext;
        if (AudioContextCtor) {
          createdContext = new AudioContextCtor();
        }
      }
    } catch {
      return false;
    }

    if (!createdContext) {
      return false;
    }

    const limiter =
      typeof createdContext.createDynamicsCompressor === "function"
        ? createdContext.createDynamicsCompressor()
        : null;
    const masterGain = createdContext.createGain();
    const now = createdContext.currentTime ?? 0;

    if (limiter) {
      applyParamImmediate(limiter.threshold, LIMITER_THRESHOLD_DB, now);
      applyParamImmediate(limiter.knee, LIMITER_KNEE_DB, now);
      applyParamImmediate(limiter.ratio, LIMITER_RATIO, now);
      applyParamImmediate(limiter.attack, LIMITER_ATTACK_SEC, now);
      applyParamImmediate(limiter.release, LIMITER_RELEASE_SEC, now);
      masterGain.connect(limiter);
      limiter.connect(createdContext.destination);
    } else {
      masterGain.connect(createdContext.destination);
    }

    this.#context = createdContext;
    this.#limiter = limiter;
    this.#masterGain = masterGain;
    this.#noiseBuffer = this.#createNoiseBuffer(createdContext);
    this.#applyMasterGain();
    return true;
  }

  #createNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (typeof ctx.createBuffer !== "function") {
      return null;
    }

    const sampleRate = Math.max(8000, ctx.sampleRate || 44100);
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate);
    if (typeof buffer.getChannelData === "function") {
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] = Math.random() * 2 - 1;
      }
    }
    return buffer;
  }

  #applyMasterGain(): void {
    if (!this.#context || !this.#masterGain) {
      return;
    }
    const now = this.#context.currentTime ?? 0;
    const gainValue = this.#muted ? 0 : Math.min(1, Math.max(0, this.#masterVolume / 100));
    applyParamImmediate(this.#masterGain.gain, gainValue, now);
  }

  #startVoice(
    ctx: AudioContext,
    destination: GainNode,
    channel: AudioEngineChannel,
    now: number,
  ): ActiveVoice | null {
    const freqHz = channel.frequencyHz ?? 0;
    if (freqHz <= 0) {
      return null;
    }

    const voiceGain = ctx.createGain();
    applyParamImmediate(voiceGain.gain, Math.max(0, Math.min(1, channel.channelGain)), now);
    voiceGain.connect(destination);

    if (channel.mode === "noise") {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.#noiseBuffer;
      noiseSource.loop = true;
      if (channel.noisePlaybackRate && channel.noisePlaybackRate > 0) {
        applyParamImmediate(noiseSource.playbackRate, channel.noisePlaybackRate, now);
      }

      const filterNode =
        typeof ctx.createBiquadFilter === "function" ? ctx.createBiquadFilter() : null;
      if (filterNode) {
        filterNode.type = "bandpass";
        applyParamImmediate(filterNode.frequency, freqHz, now);
        applyParamImmediate(filterNode.Q, NOISE_FILTER_Q, now);
        noiseSource.connect(filterNode);
        filterNode.connect(voiceGain);
      } else {
        noiseSource.connect(voiceGain);
      }

      noiseSource.start(now);
      return {
        channelId: channel.channelId,
        kind: channel.kind,
        mode: channel.mode,
        sourceNode: noiseSource,
        filterNode,
        voiceGain,
      };
    }

    const oscillator = ctx.createOscillator();
    oscillator.type = channel.mode;
    applyParamImmediate(oscillator.frequency, freqHz, now);
    oscillator.connect(voiceGain);
    oscillator.start(now);

    return {
      channelId: channel.channelId,
      kind: channel.kind,
      mode: channel.mode,
      sourceNode: oscillator,
      filterNode: null,
      voiceGain,
    };
  }

  #updateVoice(voice: ActiveVoice, channel: AudioEngineChannel, now: number): void {
    const freqHz = channel.frequencyHz ?? 0;
    applyParamImmediate(voice.voiceGain.gain, Math.max(0, Math.min(1, channel.channelGain)), now);

    if (voice.mode === "noise") {
      const bufferSource = voice.sourceNode as AudioBufferSourceNode;
      if (channel.noisePlaybackRate && channel.noisePlaybackRate > 0) {
        applyParamImmediate(bufferSource.playbackRate, channel.noisePlaybackRate, now);
      }
      if (voice.filterNode && freqHz > 0) {
        applyParamImmediate(voice.filterNode.frequency, freqHz, now);
      }
      return;
    }

    const oscillator = voice.sourceNode as OscillatorNode;
    if (freqHz > 0) {
      applyParamImmediate(oscillator.frequency, freqHz, now);
    }
  }

  #stopVoice(voice: ActiveVoice): void {
    const now = this.#context?.currentTime ?? 0;
    applyParamImmediate(voice.voiceGain.gain, 0, now);

    try {
      voice.sourceNode.stop(now);
    } catch {
      // Bereits gestoppte Nodes ignorieren
    }
    try {
      voice.sourceNode.disconnect();
    } catch {
      // Disconnect-Fehler ignorieren
    }
    try {
      voice.filterNode?.disconnect();
    } catch {
      // Disconnect-Fehler ignorieren
    }
    try {
      voice.voiceGain.disconnect();
    } catch {
      // Disconnect-Fehler ignorieren
    }
  }

  #stopAllVoices(): void {
    for (const voice of this.#voices.values()) {
      this.#stopVoice(voice);
    }
    this.#voices.clear();
  }
}
