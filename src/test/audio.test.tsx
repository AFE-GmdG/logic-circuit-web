import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Sound from "../types/circuit/sound";
import type Synthesizer from "../types/circuit/synthesizer";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpSimulationActions from "../types/mcp/mcpSimulationActions";
import { NATIVE_PROJECT_SCHEMA_VERSION } from "../types/storage/nativeProjectFormat";

import AudioEngine from "../audio/audioEngine";
import { stepSimulationTool } from "../mcp/mcpSimulationTools";
import { executeMcpTool, getComponentCatalogTool } from "../mcp/mcpTools";
import CircuitException from "../simulation/compiler/circuitException";
import CircuitMap from "../simulation/compiler/circuitMap";
import CircuitRunner from "../simulation/worker/circuitRunner";
import { APP_SETTINGS_STORAGE_KEY, DEFAULT_APP_SETTINGS, saveAppSettings } from "../utils/appSettingsStorage";
import {
  AUDIO_SINGLE_STEP_DURATION_MS,
  clampSoundFrequency,
  formatPitchTableCopyText,
  MIDI_PITCH_TABLE,
  normalizeChannelGain,
  normalizeSynthesizerPitchInput,
  resolveNoiseFilterFrequency,
  resolveNoisePlaybackRate,
  resolveSynthesizerPitch,
} from "../utils/audioPitchTable";
import {
  circuitContainsAudio,
  circuitContainsDisplays,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createSound,
  createSynthesizer,
  rotateSymbol,
} from "../utils/circuitLayout";
import { parseNativeProject } from "../utils/storage/nativeProjectReader";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { createWire } from "../utils/wireUtils";
import { analyzeDesktopExportCompatibility } from "../utils/xml/desktopExportCompatibility";
import { serializeCircuitProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

import OptionsDialog from "../components/app/optionsDialog";
import PropertyDialog from "../components/propertyDialog";
import StatusBar from "../components/statusBar";
import SoundShape from "../components/symbols/io/soundShape";
import SynthesizerShape from "../components/symbols/io/synthesizerShape";

const createMockParam = (initial = 0): AudioParam => {
  let current = initial;
  return {
    get value() {
      return current;
    },
    set value(next: number) {
      current = next;
    },
    setValueAtTime: vi.fn((val: number) => {
      current = val;
    }),
    cancelScheduledValues: vi.fn(),
  } as unknown as AudioParam;
};

type MockContextTracker = {
  context: AudioContext;
  oscillators: { type: OscillatorType; frequency: AudioParam }[];
  bufferSources: { loop: boolean; playbackRate: AudioParam }[];
  filters: { type: BiquadFilterType; frequency: AudioParam; Q: AudioParam }[];
  compressors: { threshold: AudioParam; ratio: AudioParam }[];
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createMockAudioContext = (): MockContextTracker => {
  const oscillators: MockContextTracker["oscillators"] = [];
  const bufferSources: MockContextTracker["bufferSources"] = [];
  const filters: MockContextTracker["filters"] = [];
  const compressors: MockContextTracker["compressors"] = [];
  const resume = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);

  const context = {
    currentTime: 0,
    sampleRate: 44100,
    state: "suspended",
    destination: {} as AudioDestinationNode,
    resume,
    close,
    createGain: () => ({
      gain: createMockParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createDynamicsCompressor: () => {
      const comp = {
        threshold: createMockParam(-6),
        knee: createMockParam(12),
        ratio: createMockParam(8),
        attack: createMockParam(0.003),
        release: createMockParam(0.1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      compressors.push(comp);
      return comp as unknown as DynamicsCompressorNode;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createOscillator: () => {
      const osc = {
        type: "sine" as OscillatorType,
        frequency: createMockParam(440),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      oscillators.push(osc);
      return osc as unknown as OscillatorNode;
    },
    createBufferSource: () => {
      const src = {
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: createMockParam(1),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      bufferSources.push(src);
      return src as unknown as AudioBufferSourceNode;
    },
    createBiquadFilter: () => {
      const filter = {
        type: "bandpass" as BiquadFilterType,
        frequency: createMockParam(1000),
        Q: createMockParam(2),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(filter);
      return filter as unknown as BiquadFilterNode;
    },
  } as unknown as AudioContext;

  return {
    context,
    oscillators,
    bufferSources,
    filters,
    compressors,
    resume,
    close,
  };
};

describe("US-021 / T-022: Akustische Ausgabekomponenten (Summer & 8-Bit-Synthesizer)", () => {
  const globalWindowContainer = globalThis as { window?: unknown };
  const hasOriginalWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const originalWindow = globalWindowContainer.window;

  afterEach(() => {
    vi.useRealTimers();
    if (hasOriginalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
    } else {
      delete globalWindowContainer.window;
    }
  });

  describe("8-Bit-Notentabelle, Bit-7-Spiegelung und Gain-Kurve", () => {
    it("ignoriert Bit 7 am Frequenzeingang (0/128 stumm, 1..127 == 129..255)", () => {
      expect(normalizeSynthesizerPitchInput(0)).toBe(0);
      expect(normalizeSynthesizerPitchInput(128)).toBe(0);
      expect(normalizeSynthesizerPitchInput(69)).toBe(69);
      expect(normalizeSynthesizerPitchInput(197)).toBe(69);
      expect(normalizeSynthesizerPitchInput(255)).toBe(127);

      expect(resolveSynthesizerPitch(0)).toBeNull();
      expect(resolveSynthesizerPitch(128)).toBeNull();

      const a4 = resolveSynthesizerPitch(69);
      const a4Mirror = resolveSynthesizerPitch(197);
      expect(a4).not.toBeNull();
      expect(a4?.label).toBe("A4");
      expect(a4?.frequencyHz).toBeCloseTo(440, 6);
      expect(a4Mirror).toEqual(a4);

      expect(MIDI_PITCH_TABLE).toHaveLength(128);
      expect(resolveSynthesizerPitch(60)?.label).toBe("C4");
      expect(resolveSynthesizerPitch(60)?.frequencyHz).toBeCloseTo(261.6256, 3);
    });

    it("berechnet Noise-Filterfrequenz, Rauschgeschwindigkeit, Frequenz-Clamping und quadratischen Gain", () => {
      expect(resolveNoiseFilterFrequency(0)).toBeNull();
      expect(resolveNoiseFilterFrequency(128)).toBeNull();
      expect(resolveNoisePlaybackRate(128)).toBeNull();

      const lowFilter = resolveNoiseFilterFrequency(10)!;
      const midFilter = resolveNoiseFilterFrequency(64)!;
      const highFilter = resolveNoiseFilterFrequency(127)!;
      expect(lowFilter).toBeLessThan(midFilter);
      expect(midFilter).toBeLessThan(highFilter);
      expect(resolveNoiseFilterFrequency(197)).toBeCloseTo(resolveNoiseFilterFrequency(69)!, 6);

      expect(resolveNoisePlaybackRate(10)!).toBeLessThan(resolveNoisePlaybackRate(100)!);

      expect(clampSoundFrequency(5)).toBe(20);
      expect(clampSoundFrequency(99999)).toBe(20000);
      expect(clampSoundFrequency(Number.NaN)).toBe(440);

      expect(normalizeChannelGain(0)).toBe(0);
      expect(normalizeChannelGain(255)).toBe(1);
      expect(normalizeChannelGain(128)).toBeCloseTo(Math.pow(128 / 255, 2), 6);

      const copyText = formatPitchTableCopyText();
      expect(copyText).toContain("0x45\t69\tA4\t440.00\t0xC5");
    });
  });

  describe("Geometrie, Kategorien, isDisplay=false und rekursives circuitContainsAudio", () => {
    it("erzeugt Sound (3x3) und Synthesizer (3x4 F/V/E) mit isDisplay=false unter displays", () => {
      const sound = createSound("snd-1", "bottom", "Piezo", "Testnote", 880, "sawtooth");
      expect(sound.symbolWidth).toBe(3);
      expect(sound.symbolHeight).toBe(3);
      expect(sound.category).toBe("displays");
      expect(sound.isDisplay).toBe(false);
      expect(sound.frequency).toBe(880);
      expect(sound.waveform).toBe("sawtooth");
      expect(sound.pins[0].gridPoint).toEqual({ x: 1, y: 3 });

      const probe = createCircuitProbe("prb-1");
      expect(probe.category).toBe("displays");
      expect(probe.isDisplay).toBe(false);

      const synth = createSynthesizer("syn-1", "noise", "CH1", "Noise Gen");
      expect(synth.symbolWidth).toBe(3);
      expect(synth.symbolHeight).toBe(4);
      expect(synth.category).toBe("displays");
      expect(synth.isDisplay).toBe(false);
      expect(synth.mode).toBe("noise");

      const pinFreq = synth.pins.find((p) => p.name === "Frequency")!;
      const pinVol = synth.pins.find((p) => p.name === "Volume")!;
      const pinEnable = synth.pins.find((p) => p.name === "Enable")!;
      expect(pinFreq.bitWidth).toBe(8);
      expect(pinFreq.gridPoint).toEqual({ x: 0, y: 1 });
      expect(pinVol.bitWidth).toBe(8);
      expect(pinVol.gridPoint).toEqual({ x: 0, y: 3 });
      expect(pinEnable.bitWidth).toBe(1);
      expect(pinEnable.gridPoint).toEqual({ x: 1, y: 4 });

      const project = createEmptyCircuitProject();
      const sym = createCircuitSymbol(synth, project.logicalCircuits[0].logicalCircuitId, 4, 2);
      const rotated = rotateSymbol(sym, "clockwise");
      expect(rotated.rotation).toBe("right");
      const enableJam = rotated.jams.find((j) => j.pin.jamNotation === "E")!;
      expect(enableJam.absolutePoint).toEqual({ x: 3, y: 4 });
    });

    it("erkennt Audio-Bauteile rekursiv (zyklussicher) und schließt isDisplay für Audio aus", () => {
      const root = createDefaultLogicalCircuit("lc-root", "Main");
      const child = createDefaultLogicalCircuit("lc-child", "AudioChild");
      const cyclic = createDefaultLogicalCircuit("lc-cyclic", "CycleNode");

      expect(circuitContainsAudio(root)).toBe(false);

      const synth = createSynthesizer("syn-sub", "square");
      child.circuitSymbols.push(createCircuitSymbol(synth, child.logicalCircuitId, 2, 2));
      expect(circuitContainsDisplays(child)).toBe(false);

      root.circuitSymbols.push(createCircuitSymbol(child, root.logicalCircuitId, 4, 4));
      cyclic.circuitSymbols.push(createCircuitSymbol(cyclic, cyclic.logicalCircuitId, 1, 1));

      const mapById = new Map<string, LogicalCircuit>([
        [root.logicalCircuitId, root],
        [child.logicalCircuitId, child],
        [cyclic.logicalCircuitId, cyclic],
      ]);

      expect(circuitContainsAudio(root, mapById)).toBe(true);
      expect(circuitContainsAudio(cyclic, mapById)).toBe(false);
    });
  });

  describe("Compiler-Validierung und polyphone Simulation", () => {
    it("meldet Compiler-Fehler bei unbeschaltetem Frequency-, Volume- oder Enable-Pin am Synthesizer", () => {
      const synth = createSynthesizer("syn-err", "square");
      const symSynth = createCircuitSymbol(synth, "lc-main", 10, 4);

      const buildUnconnectedTest = (connectF: boolean, connectV: boolean, connectE: boolean) => {
        const lc = createDefaultLogicalCircuit("lc-main", "Main");
        const wires = [];
        const symbols = [symSynth];

        if (connectF) {
          const cFreq = createConstant("c-freq", 8, 69, "right");
          const sFreq = createCircuitSymbol(cFreq, lc.logicalCircuitId, 4, 4);
          symbols.push(sFreq);
          wires.push(createWire(lc.logicalCircuitId, { x: 6, y: 5 }, { x: 10, y: 5 }, "w-f"));
        }
        if (connectV) {
          const cVol = createConstant("c-vol", 8, 255, "right");
          const sVol = createCircuitSymbol(cVol, lc.logicalCircuitId, 4, 6);
          symbols.push(sVol);
          wires.push(createWire(lc.logicalCircuitId, { x: 6, y: 7 }, { x: 10, y: 7 }, "w-v"));
        }
        if (connectE) {
          const cEn = createConstant("c-en", 1, 1, "right");
          const sEn = createCircuitSymbol(cEn, lc.logicalCircuitId, 8, 8);
          symbols.push(sEn);
          wires.push(
            createWire(lc.logicalCircuitId, { x: 10, y: 9 }, { x: 11, y: 9 }, "w-e"),
            createWire(lc.logicalCircuitId, { x: 11, y: 9 }, { x: 11, y: 8 }, "w-e2"),
          );
        }
        lc.circuitSymbols.push(...symbols);
        lc.wires.push(...wires);
        const map = new CircuitMap(lc);
        map.apply();
      };

      expect(() => buildUnconnectedTest(false, true, true)).toThrow(CircuitException);
      expect(() => buildUnconnectedTest(true, false, true)).toThrow(CircuitException);
      expect(() => buildUnconnectedTest(true, true, false)).toThrow(CircuitException);
    });

    it("liefert polyphone Live-Audiokanaele fuer Sound und mehrere Synthesizer im CircuitRunner", () => {
      const lc = createDefaultLogicalCircuit("lc-poly", "Poly");
      const sound = createSound("snd-1", "left", "Bell", "", 880, "triangle");
      const synth1 = createSynthesizer("syn-1", "square", "Lead");
      const synth2 = createSynthesizer("syn-2", "noise", "Perc");

      const symSound = createCircuitSymbol(sound, lc.logicalCircuitId, 6, 1, "up", "sym-snd");
      const btnSound = createCircuitButton("btn-snd", "S", true);
      const symBtnSound = createCircuitSymbol(btnSound, lc.logicalCircuitId, 2, 1);

      const symSynth1 = createCircuitSymbol(synth1, lc.logicalCircuitId, 10, 10, "up", "sym-s1");
      const cF1 = createConstant("cf1", 8, 197, "right");
      const cV1 = createConstant("cv1", 8, 255, "right");
      const cE1 = createConstant("ce1", 1, 1, "right");

      const symSynth2 = createCircuitSymbol(synth2, lc.logicalCircuitId, 22, 10, "up", "sym-s2");
      const cF2 = createConstant("cf2", 8, 80, "right");
      const cV2 = createConstant("cv2", 8, 128, "right");
      const btnE2 = createCircuitButton("btn-e2", "N", true);

      lc.circuitSymbols.push(
        symBtnSound,
        symSound,
        createCircuitSymbol(cF1, lc.logicalCircuitId, 4, 10),
        createCircuitSymbol(cV1, lc.logicalCircuitId, 4, 12),
        createCircuitSymbol(cE1, lc.logicalCircuitId, 8, 14),
        symSynth1,
        createCircuitSymbol(cF2, lc.logicalCircuitId, 16, 10),
        createCircuitSymbol(cV2, lc.logicalCircuitId, 16, 12),
        createCircuitSymbol(btnE2, lc.logicalCircuitId, 20, 14),
        symSynth2,
      );

      lc.wires.push(
        createWire(lc.logicalCircuitId, { x: 4, y: 2 }, { x: 6, y: 2 }, "w-s"),
        createWire(lc.logicalCircuitId, { x: 6, y: 11 }, { x: 10, y: 11 }, "w-f1"),
        createWire(lc.logicalCircuitId, { x: 6, y: 13 }, { x: 10, y: 13 }, "w-v1"),
        createWire(lc.logicalCircuitId, { x: 10, y: 15 }, { x: 11, y: 15 }, "w-e1a"),
        createWire(lc.logicalCircuitId, { x: 11, y: 15 }, { x: 11, y: 14 }, "w-e1b"),
        createWire(lc.logicalCircuitId, { x: 18, y: 11 }, { x: 22, y: 11 }, "w-f2"),
        createWire(lc.logicalCircuitId, { x: 18, y: 13 }, { x: 22, y: 13 }, "w-v2"),
        createWire(lc.logicalCircuitId, { x: 22, y: 15 }, { x: 23, y: 15 }, "w-e2a"),
        createWire(lc.logicalCircuitId, { x: 23, y: 15 }, { x: 23, y: 14 }, "w-e2b"),
      );

      const runner = new CircuitRunner(lc);
      runner.step(1);
      runner.toggleButton("btn-snd");
      runner.toggleButton("btn-e2");
      const snap = runner.getSnapshot();

      expect(snap.audioChannels?.["sym-snd"]).toMatchObject({
        kind: "sound",
        active: true,
        mode: "triangle",
        frequencyHz: 880,
        channelGain: 1,
      });
      expect(snap.audioChannels?.["sym-s1"]).toMatchObject({
        kind: "synthesizer",
        active: true,
        mode: "square",
        rawPitch: 197,
        rawVolume: 255,
      });
      expect(snap.audioChannels?.["sym-s1"]?.frequencyHz).toBeCloseTo(440, 5);
      expect(snap.audioChannels?.["sym-s2"]?.active).toBe(true);
      expect(snap.audioChannels?.["sym-s2"]?.mode).toBe("noise");
      expect(snap.audioChannels?.["sym-s2"]?.noisePlaybackRate).toBeGreaterThan(0);

      runner.toggleButton("btn-e2");
      expect(runner.getSnapshot().audioChannels?.["sym-s2"]?.active).toBe(false);
      runner.dispose();
    });
  });

  describe("Web Audio Engine (Soft Limiter, Polyphonie & 250-ms Einzelschritt)", () => {
    it("steuert mehrere Stimmen, 250-ms F10-Re-Trigger und sofortiges Verstummen bei Pause/Mute", () => {
      vi.useFakeTimers();
      const mock = createMockAudioContext();
      const engine = new AudioEngine({ createContext: () => mock.context });

      engine.setMasterSettings(80, false);
      engine.syncChannels(
        [
          {
            channelId: "c1",
            kind: "sound",
            active: true,
            mode: "sine",
            frequencyHz: 440,
            channelGain: 1,
          },
          {
            channelId: "c2",
            kind: "synthesizer",
            active: true,
            mode: "noise",
            frequencyHz: 1500,
            channelGain: 0.5,
            noisePlaybackRate: 1.4,
          },
        ],
        "singleStep",
      );

      expect(engine.activeVoiceCount).toBe(2);
      expect(mock.compressors).toHaveLength(1);
      expect(mock.oscillators).toHaveLength(1);
      expect(mock.bufferSources).toHaveLength(1);
      expect(mock.filters).toHaveLength(1);
      expect(mock.bufferSources[0].loop).toBe(true);

      // Re-Trigger nach 150 ms verlaengert den Einzelschritt um weitere 250 ms
      vi.advanceTimersByTime(150);
      expect(engine.activeVoiceCount).toBe(2);
      engine.syncChannels(
        [
          {
            channelId: "c1",
            kind: "sound",
            active: true,
            mode: "sine",
            frequencyHz: 880,
            channelGain: 1,
          },
        ],
        "singleStep",
      );
      expect(engine.activeVoiceCount).toBe(1);
      expect(mock.oscillators[0].frequency.value).toBe(880);

      vi.advanceTimersByTime(AUDIO_SINGLE_STEP_DURATION_MS - 10);
      expect(engine.activeVoiceCount).toBe(1);

      vi.advanceTimersByTime(20);
      expect(engine.activeVoiceCount).toBe(0);

      // Stummschaltung & Dispose raeumen sauber auf
      engine.syncChannels(
        [
          {
            channelId: "c1",
            kind: "sound",
            active: true,
            mode: "square",
            frequencyHz: 523.25,
            channelGain: 1,
          },
        ],
        "continuous",
      );
      expect(engine.activeVoiceCount).toBe(1);
      engine.setMasterSettings(80, true);
      expect(engine.activeVoiceCount).toBe(0);

      engine.dispose();
      expect(mock.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("Natives Projektformat & Desktop XML Export", () => {
    it("serialisiert Sound + Synthesizer verlustfrei im nativen Format und warnt beim Desktop-XML-Export", () => {
      const project = createEmptyCircuitProject("AudioProj", "Main", "lc-main", "proj-audio");
      const lc = project.logicalCircuits[0];
      const sound = createSound("snd-rt", "right", "BZ", "Summer", 1046.5, "square");
      const synth = createSynthesizer("syn-rt", "sawtooth", "SYN1", "Lead Synth");

      project.sounds.push(sound);
      project.synthesizers.push(synth);
      project.circuits.set(sound.circuitId, sound);
      project.circuits.set(synth.circuitId, synth);

      const symSound = createCircuitSymbol(sound, lc.logicalCircuitId, 2, 2, "up", "sym-snd");
      const symSynth = createCircuitSymbol(synth, lc.logicalCircuitId, 8, 2, "up", "sym-syn");
      lc.circuitSymbols.push(symSound, symSynth);
      project.circuitSymbols.push(symSound, symSynth);

      const json = serializeNativeProject(project);
      const rawDoc = JSON.parse(json) as { schemaVersion: number };
      expect(rawDoc.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);

      const parsed = parseNativeProject(json);
      expect(parsed.sounds).toHaveLength(1);
      expect(parsed.synthesizers).toHaveLength(1);
      expect(parsed.synthesizers[0]).toMatchObject({
        synthesizerId: "syn-rt",
        mode: "sawtooth",
        notation: "SYN1",
        note: "Lead Synth",
      });

      const compat = analyzeDesktopExportCompatibility(project);
      expect(compat.hasWarnings).toBe(true);
      expect(compat.warnings.some((w) => w.code === "unsupported-component-kind")).toBe(true);

      const xml = serializeCircuitProjectToXml(project);
      expect(xml).toContain("lc:Sound");
      expect(xml).not.toContain("syn-rt");
    });
  });

  describe("UI-Komponenten, kopierbare Notentabelle & StatusBar Mute", () => {
    it("rendert SoundShape und SynthesizerShape inklusive F/V/E-Pins und Aktiv-Indikator", () => {
      const synth = createSynthesizer("syn-ui", "noise", "N1");
      const html = renderToStaticMarkup(
        <svg width={100} height={100}>
          <SoundShape width={48} height={48} frequency={440} waveform="sine" isActive={true} />
          <SynthesizerShape
            width={48}
            height={64}
            mode="noise"
            isActive={true}
            pins={synth.pins}
          />
        </svg>,
      );
      expect(html).toContain("data-component=\"SoundShape\"");
      expect(html).toContain("data-active=\"true\"");
      expect(html).toContain("NOI");
      expect(html).toContain(">F<");
      expect(html).toContain(">V<");
      expect(html).toContain(">E<");
    });

    it("rendert Sound- & Synthesizer-Dialog inklusive user-select: text Notenreferenz und OptionsDialog-Audio", () => {
      const project = createEmptyCircuitProject("DlgAudio", "Main", "lc-main");
      const synth = createSynthesizer("syn-dlg", "square", "S1");
      const sound = createSound("snd-dlg", "left", "BEEP", "", 587.33, "triangle");
      const symSynth = createCircuitSymbol(synth, "lc-main", 4, 4, "up", "sym-dlg");
      const symSound = createCircuitSymbol(sound, "lc-main", 10, 4, "up", "sym-snd-dlg");

      const synthHtml = renderToStaticMarkup(
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <PropertyDialog
            isOpen={true}
            symbol={symSynth}
            initialPitchTableOpen={true}
            onSaveSymbol={vi.fn()}
            onClose={vi.fn()}
          />
        </SimulationContext.Provider>,
      );
      expect(synthHtml).toContain("data-testid=\"property-synthesizer-mode\"");
      expect(synthHtml).toContain("data-testid=\"property-synthesizer-preview-btn\"");
      expect(synthHtml).toContain("data-testid=\"pitch-reference-table\"");
      expect(synthHtml).toContain("user-select:text");
      expect(synthHtml).toContain("0x45");
      expect(synthHtml).toContain("A4");
      expect(synthHtml).toContain("440.00");

      const soundHtml = renderToStaticMarkup(
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <PropertyDialog
            isOpen={true}
            symbol={symSound}
            onSaveSymbol={vi.fn()}
            onClose={vi.fn()}
          />
        </SimulationContext.Provider>,
      );
      expect(soundHtml).toContain("data-testid=\"property-sound-waveform\"");
      expect(soundHtml).toContain("data-testid=\"property-sound-frequency\"");
      expect(soundHtml).toContain("data-testid=\"property-sound-preview-btn\"");
      expect(soundHtml).toContain("587.33");

      const optionsHtml = renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <OptionsDialog isOpen={true} onClose={vi.fn()} />
        </CircuitContextProvider>,
      );
      expect(optionsHtml).toContain("data-testid=\"options-audio-volume\"");
      expect(optionsHtml).toContain("value=\"70\"");
      expect(optionsHtml).toContain("data-testid=\"options-audio-muted\"");
    });

    it("aktualisiert Synthesizer-Modus und Sound-Eigenschaften mit Delta-Undo/Redo und Dialog-Anzeige", () => {
      const project = createEmptyCircuitProject("AudioProps", "Main", "lc-main");
      let capturedCtx!: React.ContextType<typeof CircuitContext>;
      const Capture: React.FC = () => {
        capturedCtx = React.useContext(CircuitContext);
        return null;
      };

      renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <Capture />
        </CircuitContextProvider>,
      );

      let placedSynth!: CircuitSymbol;
      let placedSound!: CircuitSymbol;
      React.act(() => {
        placedSynth = capturedCtx.addSymbol(
          { type: "synthesizer", name: "Synthesizer", synthesizerMode: "sine" },
          { x: 4, y: 4 },
        );
        placedSound = capturedCtx.addSymbol(
          { type: "sound", name: "Sound", pinSide: "left", frequency: 440, waveform: "sine" },
          { x: 12, y: 4 },
        );
      });

      const getSynthSym = () =>
        capturedCtx.currentCircuit.circuitSymbols.find(
          (s) => s.circuitSymbolId === placedSynth.circuitSymbolId,
        )!;
      const getSoundSym = () =>
        capturedCtx.currentCircuit.circuitSymbols.find(
          (s) => s.circuitSymbolId === placedSound.circuitSymbolId,
        )!;

      expect((getSynthSym().circuit as Synthesizer).mode).toBe("sine");
      expect((getSoundSym().circuit as Sound).waveform).toBe("sine");

      // Kombinierte Aktualisierung + reines Modus-Update muessen Delta fuer Undo/Redo erfassen
      React.act(() => {
        capturedCtx.updateCircuitSymbolProperties(placedSynth.circuitSymbolId, {
          synthesizerMode: "sawtooth",
          notation: "LEAD",
        });
      });

      const synthAfterSaw = getSynthSym();
      expect((synthAfterSaw.circuit as Synthesizer).mode).toBe("sawtooth");
      expect(synthAfterSaw.circuit.notation).toBe("LEAD");
      expect(
        capturedCtx.project.synthesizers.find(
          (s) => s.synthesizerId === synthAfterSaw.circuit.circuitId,
        )?.mode,
      ).toBe("sawtooth");

      const sawDialogHtml = renderToStaticMarkup(
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <PropertyDialog isOpen={true} symbol={synthAfterSaw} onClose={vi.fn()} />
        </SimulationContext.Provider>,
      );
      expect(sawDialogHtml).toContain("value=\"sawtooth\" selected=\"\"");

      const entriesBeforeModeOnly = capturedCtx.history.entries.length;
      React.act(() => {
        capturedCtx.updateCircuitSymbolProperties(placedSynth.circuitSymbolId, {
          synthesizerMode: "noise",
        });
      });

      const synthAfterNoise = getSynthSym();
      expect((synthAfterNoise.circuit as Synthesizer).mode).toBe("noise");
      expect(synthAfterNoise.circuit.notation).toBe("LEAD");
      expect(capturedCtx.history.entries).toHaveLength(entriesBeforeModeOnly + 1);
      const latestSynthDelta = capturedCtx.history.entries[capturedCtx.history.pointer - 1];
      expect(latestSynthDelta.type).toBe("updateProperty");
      if (latestSynthDelta.type === "updateProperty") {
        expect(latestSynthDelta.changes.synthesizerMode).toEqual({
          before: "sawtooth",
          after: "noise",
        });
      }

      const noiseDialogHtml = renderToStaticMarkup(
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <PropertyDialog isOpen={true} symbol={synthAfterNoise} onClose={vi.fn()} />
        </SimulationContext.Provider>,
      );
      expect(noiseDialogHtml).toContain("value=\"noise\" selected=\"\"");

      // Sound-Wellenform und Frequenz aktualisieren und isoliertes Waveform-Delta pruefen
      React.act(() => {
        capturedCtx.updateCircuitSymbolProperties(placedSound.circuitSymbolId, {
          waveform: "triangle",
          frequency: 880,
          pinSide: "right",
          notation: "BZ",
        });
      });
      expect((getSoundSym().circuit as Sound).waveform).toBe("triangle");
      expect((getSoundSym().circuit as Sound).frequency).toBe(880);
      expect((getSoundSym().circuit as Sound).pinSide).toBe("right");
      expect(getSoundSym().circuit.notation).toBe("BZ");

      const soundTriDialogHtml = renderToStaticMarkup(
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <PropertyDialog isOpen={true} symbol={getSoundSym()} onClose={vi.fn()} />
        </SimulationContext.Provider>,
      );
      expect(soundTriDialogHtml).toContain("value=\"triangle\" selected=\"\"");

      const entriesBeforeWaveOnly = capturedCtx.history.entries.length;
      React.act(() => {
        capturedCtx.updateCircuitSymbolProperties(placedSound.circuitSymbolId, {
          waveform: "square",
        });
      });
      expect((getSoundSym().circuit as Sound).waveform).toBe("square");
      expect(capturedCtx.history.entries).toHaveLength(entriesBeforeWaveOnly + 1);

      // Undo/Redo rueckwaerts und wieder vorwaerts durch alle Sound- & Synthesizer-Aenderungen
      React.act(() => {
        capturedCtx.undo();
      });
      expect((getSoundSym().circuit as Sound).waveform).toBe("triangle");

      React.act(() => {
        capturedCtx.undo();
      });
      expect((getSoundSym().circuit as Sound).waveform).toBe("sine");
      expect((getSoundSym().circuit as Sound).frequency).toBe(440);
      expect((getSoundSym().circuit as Sound).pinSide).toBe("left");

      React.act(() => {
        capturedCtx.undo();
      });
      expect((getSynthSym().circuit as Synthesizer).mode).toBe("sawtooth");

      React.act(() => {
        capturedCtx.undo();
      });
      expect((getSynthSym().circuit as Synthesizer).mode).toBe("sine");
      expect(getSynthSym().circuit.notation).toBe("");

      React.act(() => {
        capturedCtx.redo();
      });
      React.act(() => {
        capturedCtx.redo();
      });
      React.act(() => {
        capturedCtx.redo();
      });
      React.act(() => {
        capturedCtx.redo();
      });
      expect((getSynthSym().circuit as Synthesizer).mode).toBe("noise");
      expect(getSynthSym().circuit.notation).toBe("LEAD");
      expect((getSoundSym().circuit as Sound).waveform).toBe("square");
      expect((getSoundSym().circuit as Sound).frequency).toBe(880);
    });

    it("blendet Mute-Button in der StatusBar ohne Audio aus und mit (auch Subschaltung) ein", () => {
      const emptyProj = createEmptyCircuitProject("NoAudio", "Main", "lc-main");
      const htmlWithoutAudio = renderToStaticMarkup(
        <CanvasContextProvider>
          <CircuitContextProvider initialProject={emptyProj}>
            <SimulationContextProvider>
              <StatusBar />
            </SimulationContextProvider>
          </CircuitContextProvider>
        </CanvasContextProvider>,
      );
      expect(htmlWithoutAudio).not.toContain("data-testid=\"status-bar-mute-btn\"");

      const subAudioProj = createEmptyCircuitProject("WithSubAudio", "Main", "lc-main");
      const mainLc = subAudioProj.logicalCircuits[0];
      const subLc = createDefaultLogicalCircuit("lc-sub-audio", "SubAudio");
      const synth = createSynthesizer("syn-nested", "sine");
      subAudioProj.synthesizers.push(synth);
      subAudioProj.circuits.set(synth.circuitId, synth);
      const nestedSym = createCircuitSymbol(synth, subLc.logicalCircuitId, 2, 2);
      subLc.circuitSymbols.push(nestedSym);
      subAudioProj.logicalCircuits.push(subLc);
      subAudioProj.circuits.set(subLc.circuitId, subLc);
      const placedSub = createCircuitSymbol(subLc, mainLc.logicalCircuitId, 4, 4);
      mainLc.circuitSymbols.push(placedSub);
      subAudioProj.circuitSymbols.push(placedSub);

      let capturedCtx!: React.ContextType<typeof CircuitContext>;
      const Capture: React.FC = () => {
        capturedCtx = React.useContext(CircuitContext);
        return null;
      };

      const htmlWithAudio = renderToStaticMarkup(
        <CanvasContextProvider>
          <CircuitContextProvider initialProject={subAudioProj}>
            <SimulationContextProvider>
              <Capture />
              <StatusBar />
            </SimulationContextProvider>
          </CircuitContextProvider>
        </CanvasContextProvider>,
      );
      expect(htmlWithAudio).toContain("data-testid=\"status-bar-mute-btn\"");
      expect(htmlWithAudio).toContain("aria-pressed=\"false\"");

      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageMap.set(key, value);
        },
        removeItem: (key: string) => {
          storageMap.delete(key);
        },
        clear: () => {
          storageMap.clear();
        },
        key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
        get length() {
          return storageMap.size;
        },
      } as Storage;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: { localStorage: mockStorage },
      });
      saveAppSettings({ ...DEFAULT_APP_SETTINGS, audioMuted: true }, APP_SETTINGS_STORAGE_KEY);
      expect(capturedCtx).toBeDefined();

      const htmlAfterMute = renderToStaticMarkup(
        <CanvasContextProvider>
          <CircuitContextProvider initialProject={subAudioProj}>
            <SimulationContextProvider>
              <StatusBar />
            </SimulationContextProvider>
          </CircuitContextProvider>
        </CanvasContextProvider>,
      );
      expect(htmlAfterMute).toContain("aria-pressed=\"true\"");
      expect(htmlAfterMute).toContain("mute-btn muted");
    });
  });

  describe("MCP-Integration fuer Sound & Synthesizer", () => {
    it("meldet Probe, Sound & Synthesizer unter displays und liefert Live-Audiostatus", async () => {
      const project = createEmptyCircuitProject("McpAudio", "Main", "lc-main");
      const snapshot: McpCircuitSnapshot = {
        project,
        currentCircuit: project.logicalCircuits[0],
        selectedSymbolIds: [],
        selectedTextNoteIds: [],
        isSimulating: false,
      };

      const catalog = getComponentCatalogTool(snapshot, {
        category: "displays",
        includeSubCircuits: false,
      });
      const types = catalog.components.map((c) => c.type);
      expect(types).toContain("probe");
      expect(types).toContain("sound");
      expect(types).toContain("synthesizer");

      const synthCatalog = getComponentCatalogTool(snapshot, {
        type: "synthesizer",
        includeSubCircuits: false,
      });
      expect(synthCatalog.components[0]?.defaultSize).toEqual({ width: 3, height: 4 });
      expect(synthCatalog.components[0]?.isDisplay).toBe(false);

      const synth = createSynthesizer("syn-mcp", "triangle", "CH2");
      const symSynth = createCircuitSymbol(synth, "lc-main", 10, 4, "up", "sym-mcp-syn");
      const cF = createConstant("cf-m", 8, 69, "right");
      const cV = createConstant("cv-m", 8, 200, "right");
      const cE = createConstant("ce-m", 1, 1, "right");
      project.synthesizers.push(synth);
      project.constants.push(cF, cV, cE);
      project.circuits.set(synth.circuitId, synth);
      project.circuits.set(cF.circuitId, cF);
      project.circuits.set(cV.circuitId, cV);
      project.circuits.set(cE.circuitId, cE);
      const lc = project.logicalCircuits[0];
      lc.circuitSymbols.push(
        createCircuitSymbol(cF, lc.logicalCircuitId, 4, 4),
        createCircuitSymbol(cV, lc.logicalCircuitId, 4, 6),
        createCircuitSymbol(cE, lc.logicalCircuitId, 8, 8),
        symSynth,
      );
      lc.wires.push(
        createWire(lc.logicalCircuitId, { x: 6, y: 5 }, { x: 10, y: 5 }, "wm-f"),
        createWire(lc.logicalCircuitId, { x: 6, y: 7 }, { x: 10, y: 7 }, "wm-v"),
        createWire(lc.logicalCircuitId, { x: 10, y: 9 }, { x: 11, y: 9 }, "wm-e1"),
        createWire(lc.logicalCircuitId, { x: 11, y: 9 }, { x: 11, y: 8 }, "wm-e2"),
      );

      const runner = new CircuitRunner(lc);
      runner.step(1);
      const simSnap = runner.getSnapshot();
      const simMap = new CircuitMap(lc);
      simMap.apply();

      const mockSimActions: McpSimulationActions = {
        getState: () => ({
          isSimulating: true,
          isPaused: true,
          isRunning: false,
          isOscillating: false,
          simulationError: null,
          actualFrequency: 0,
          frameRateLimit: 30,
          snapshot: simSnap,
          rootCircuitMap: simMap,
          selectedCircuitMap: simMap,
        }),
        startSimulation: async () => simSnap,
        pauseSimulation: () => {},
        stopSimulation: async () => {},
        reset: async () => {},
        step: async (count = 1) => ({
          stepsCompleted: count,
          snapshot: simSnap,
          rootCircuitMap: simMap,
        }),
        ensurePausedSimulation: async () => ({ snapshot: simSnap, rootCircuitMap: simMap }),
        setFrameRateLimit: () => {},
        selectCircuitMap: () => {},
        setButtonState: async () => simSnap,
        toggleButton: async () => simSnap,
        pullSnapshot: async () => simSnap,
      };

      const stepResult = (await stepSimulationTool(
        {
          ...snapshot,
          isSimulating: true,
          simulation: mockSimActions,
        },
        { action: "step", steps: 1, includeState: true },
      )) as {
        state: {
          audioChannels: Array<{ kind: string; active: boolean; frequencyHz: number }>;
          symbols: Array<{ kind: string; synthesizer?: { active: boolean } }>;
        };
      };

      expect(stepResult.state.audioChannels).toHaveLength(1);
      expect(stepResult.state.audioChannels[0]?.kind).toBe("synthesizer");
      expect(stepResult.state.audioChannels[0]?.active).toBe(true);
      expect(stepResult.state.audioChannels[0]?.frequencyHz).toBeCloseTo(440, 5);
      const symReport = stepResult.state.symbols.find((s) => s.kind === "synthesizer");
      expect(symReport?.synthesizer?.active).toBe(true);

      await expect(
        executeMcpTool("get_component_catalog", { category: "displays" }, snapshot),
      ).resolves.toMatchObject({ categories: expect.arrayContaining(["displays"]) });

      runner.dispose();
    });
  });
});
