/** Untere Frequenzgrenze fuer den Standard-Summer in Hertz. */
export const SOUND_MIN_FREQUENCY = 20;

/** Obere Frequenzgrenze fuer den Standard-Summer in Hertz. */
export const SOUND_MAX_FREQUENCY = 20000;

/** Standardfrequenz des Summers beim Neuplatzieren (Kammerton A4). */
export const SOUND_DEFAULT_FREQUENCY = 440;

/** Maximale Wiedergabedauer eines Einzelschritts (F10) in Millisekunden. */
export const AUDIO_SINGLE_STEP_DURATION_MS = 250;

/** Standardwert fuer die globale Master-Lautstaerke in Prozent. */
export const AUDIO_DEFAULT_VOLUME = 70;

export type AudioPitchEntry = {
  midiNote: number;
  hex: string;
  mirrorHex: string;
  label: string;
  frequencyHz: number;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const NOISE_MIN_FILTER_HZ = 120;
const NOISE_MAX_FILTER_HZ = 12000;
const NOISE_MIN_RATE = 0.2;
const NOISE_MAX_RATE = 2.5;

const formatHexByte = (value: number): string =>
  `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;

const createMidiPitchEntry = (midiNote: number): AudioPitchEntry => {
  if (midiNote === 0) {
    return {
      midiNote: 0,
      hex: formatHexByte(0),
      mirrorHex: formatHexByte(128),
      label: "---",
      frequencyHz: 0,
    };
  }

  const noteName = NOTE_NAMES[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  const frequencyHz = 440 * Math.pow(2, (midiNote - 69) / 12);

  return {
    midiNote,
    hex: formatHexByte(midiNote),
    mirrorHex: formatHexByte(midiNote | 0x80),
    label: `${noteName}${octave}`,
    frequencyHz,
  };
};

/** 8-Bit-Notentabelle fuer den Synthesizer (Index 0 = Stumm, 1..127 = MIDI-Noten). */
export const MIDI_PITCH_TABLE: readonly AudioPitchEntry[] = Array.from(
  { length: 128 },
  (_, index) => createMidiPitchEntry(index),
);

/** Begrenzt eine Summer-Frequenz auf den zulaessigen Bereich 20..20000 Hz. */
export const clampSoundFrequency = (value: number): number => {
  if (!Number.isFinite(value)) {
    return SOUND_DEFAULT_FREQUENCY;
  }

  return Math.min(SOUND_MAX_FREQUENCY, Math.max(SOUND_MIN_FREQUENCY, value));
};

/** Maskiert Bit 7 des 8-Bit-Frequenzeingangs (128 -> 0, 129..255 -> 1..127). */
export const normalizeSynthesizerPitchInput = (raw8BitValue: number): number => {
  if (!Number.isFinite(raw8BitValue)) {
    return 0;
  }

  return Math.trunc(raw8BitValue) & 0x7f;
};

/** Loest einen 8-Bit-Frequenzwert in den MIDI-Eintrag auf oder gibt null bei Stille zurueck. */
export const resolveSynthesizerPitch = (raw8BitValue: number): AudioPitchEntry | null => {
  const normalized = normalizeSynthesizerPitchInput(raw8BitValue);
  if (normalized === 0) {
    return null;
  }

  return MIDI_PITCH_TABLE[normalized] ?? null;
};

/** Berechnet die Bandpass-Mittenfrequenz fuer den Noise-Modus oder null bei Stille. */
export const resolveNoiseFilterFrequency = (raw8BitValue: number): number | null => {
  const normalized = normalizeSynthesizerPitchInput(raw8BitValue);
  if (normalized === 0) {
    return null;
  }

  const ratio = (normalized - 1) / 126;
  return NOISE_MIN_FILTER_HZ * Math.pow(NOISE_MAX_FILTER_HZ / NOISE_MIN_FILTER_HZ, ratio);
};

/** Berechnet die Abspielgeschwindigkeit des Rauschpuffers im Noise-Modus oder null bei Stille. */
export const resolveNoisePlaybackRate = (raw8BitValue: number): number | null => {
  const normalized = normalizeSynthesizerPitchInput(raw8BitValue);
  if (normalized === 0) {
    return null;
  }

  const ratio = (normalized - 1) / 126;
  return NOISE_MIN_RATE + ratio * (NOISE_MAX_RATE - NOISE_MIN_RATE);
};

/** Rechnet den 8-Bit-Lautstaerkewert (0..255) quadratisch auf eine lineare Gain-Kurve (0..1) um. */
export const normalizeChannelGain = (rawVolume: number): number => {
  if (!Number.isFinite(rawVolume)) {
    return 0;
  }

  const clamped = Math.min(255, Math.max(0, rawVolume));
  const ratio = clamped / 255;
  return ratio * ratio;
};

/** Formatiert Notentabellen-Eintraege als kopierbaren TSV-Text fuer ROM/RAM-Planung. */
export const formatPitchTableCopyText = (
  entries: readonly AudioPitchEntry[] = MIDI_PITCH_TABLE,
): string => {
  const lines = entries.map((entry) => {
    const freqText = entry.frequencyHz > 0 ? entry.frequencyHz.toFixed(2) : "0";
    return `${entry.hex}\t${entry.midiNote}\t${entry.label}\t${freqText}\t${entry.mirrorHex}`;
  });
  return `Hex\tDec\tNote\tHz\t+128\n${lines.join("\n")}`;
};
