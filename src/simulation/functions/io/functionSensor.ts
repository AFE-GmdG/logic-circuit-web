import type SensorType from "../../../types/circuit/sensorType";

import i18n from "../../../i18n";
import { wpfKeyCodeToLabel } from "../../../utils/keyGesture";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";
import type IFunctionClock from "../iFunctionClock";

export const DEFAULT_RANDOM_MIN = 10;
export const DEFAULT_RANDOM_MAX = 20;
export const DEFAULT_RANDOM_DATA = "A:14";

export type SensorPoint = {
  tick: number;
  value: number;
};

export type FunctionSensorConfig = {
  sensorId: string;
  sensorType: SensorType;
  bitWidth: number;
  data?: string;
  random?: () => number;
  now?: () => Date;
};

// Begrenzt einen Zahlenwert per Bitmaske auf die konfigurierte Bitbreite (1..32)
export function normalizeSensorValue(value: number, bitWidth: number): number {
  const clampedBits = Math.max(1, Math.min(32, Math.floor(bitWidth)));
  if (clampedBits >= 32) {
    return value >>> 0;
  }
  const mask = ((1 << clampedBits) - 1) >>> 0;
  return (value >>> 0) & mask;
}

// Parst eine vorzeichenlose Hexadezimalzahl (max. 8 Stellen) oder liefert null
export function parseHexUint(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9a-fA-F]{1,8}$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 16);
  return Number.isFinite(parsed) ? (parsed >>> 0) : null;
}

// Parst einen einzelnen Tick:Wert-Eintrag (beide hexadezimal) analog zu Sensor.TryParsePoint
export function tryParseSensorPoint(
  text: string,
  bitWidth: number,
): { ok: true; point: SensorPoint } | { ok: false; error: string } {
  const parts = text.trim().split(":");
  if (parts.length !== 2) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidPoint", { text }),
    };
  }
  const tick = parseHexUint(parts[0]);
  if (tick === null || tick > 0x7fffffff) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidTick", { tick: parts[0], text }),
    };
  }
  const rawValue = parseHexUint(parts[1]);
  if (rawValue === null) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidValue", { value: parts[1], text }),
    };
  }
  return {
    ok: true,
    point: {
      tick,
      value: normalizeSensorValue(rawValue, bitWidth),
    },
  };
}

// Parst eine Leerzeichen-getrennte Sensor-Serie mit streng monoton steigenden Ticks
export function parseSensorSeries(
  data: string,
  bitWidth: number,
): { ok: true; points: SensorPoint[] } | { ok: false; error: string } {
  const tokens = data.trim().split(/\s+/).filter(Boolean);
  const points: SensorPoint[] = [];
  let lastTick = -1;

  for (const token of tokens) {
    const parsed = tryParseSensorPoint(token, bitWidth);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.point.tick <= lastTick) {
      return {
        ok: false,
        error: i18n.t("errors.sensor.nonIncreasingTick", {
          tick: parsed.point.tick.toString(16).toUpperCase(),
        }),
      };
    }
    lastTick = parsed.point.tick;
    points.push(parsed.point);
  }

  return { ok: true, points };
}

// Parst eine Sensor-Serie tolerant oder gibt null bei Fehlern zurück
export function tryParseSensorSeries(data: string, bitWidth: number): SensorPoint[] | null {
  const result = parseSensorSeries(data, bitWidth);
  return result.ok ? result.points : null;
}

// Serialisiert Sensor-Datenpunkte zurück ins kompakte Hex-Format "tick:value ..."
export function saveSensorSeries(points: SensorPoint[]): string {
  return points
    .map((p) => `${p.tick.toString(16).toUpperCase()}:${p.value.toString(16).toUpperCase()}`)
    .join(" ");
}

// Parst den Intervallbereich "min:max" (hexadezimal, min >= 1, max >= min) für den Zufallssensor
export function tryParseRandomRange(
  data: string,
): { ok: true; min: number; max: number } | { ok: false; error: string } {
  const trimmed = data.trim();
  if (!trimmed) {
    return { ok: true, min: DEFAULT_RANDOM_MIN, max: DEFAULT_RANDOM_MAX };
  }
  const parts = trimmed.split(":");
  if (parts.length !== 2) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidRandomRange"),
    };
  }
  const min = parseHexUint(parts[0]);
  const max = parseHexUint(parts[1]);
  if (min === null || min < 1 || min > 0x7fffffff) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidRandomMin"),
    };
  }
  if (max === null || max < min || max > 0x7fffffff) {
    return {
      ok: false,
      error: i18n.t("errors.sensor.invalidRandomMax"),
    };
  }
  return { ok: true, min, max };
}

// Formatiert den aktuellen Sensorwert lesbar für UI und Snapshots
export function formatSensorValueText(
  sensorType: SensorType,
  value: number,
  bitWidth: number,
): string {
  const normalized = normalizeSensorValue(value, bitWidth);
  if (sensorType === "keyCode") {
    return wpfKeyCodeToLabel(normalized) || "None";
  }
  if (sensorType === "ascii") {
    if (normalized >= 32 && normalized <= 126) {
      return String.fromCharCode(normalized);
    }
    if (normalized === 0) {
      return "0";
    }
  }
  const hexDigits = Math.max(1, Math.ceil(Math.max(1, Math.min(32, bitWidth)) / 4));
  return normalized.toString(16).toUpperCase().padStart(hexDigits, "0");
}

// Berechnet den 32-Bit-BCD-Zeitwert (HHMMSScc) für den Clock-Sensor
function computeClockBcdValue(now: Date): number {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const centiseconds = Math.floor(now.getMilliseconds() / 10);

  const bcd =
    ((Math.floor(hours / 10) & 0xf) << 28)
    | ((hours % 10) << 24)
    | ((Math.floor(minutes / 10) & 0xf) << 20)
    | ((minutes % 10) << 16)
    | ((Math.floor(seconds / 10) & 0xf) << 12)
    | ((seconds % 10) << 8)
    | ((Math.floor(centiseconds / 10) & 0xf) << 4)
    | (centiseconds % 10);

  return bcd >>> 0;
}

// Simulationsfunktion für den Sensor-Baustein analog zu FunctionSensor.cs
export class FunctionSensor extends CircuitFunction implements IFunctionClock {
  readonly sensorId: string;
  readonly sensorType: SensorType;
  readonly bitWidth: number;
  readonly #rng: () => number;
  readonly #now: () => Date;

  #value = 0;
  #lastEvaluatedValue = -1;

  // Zustand für Random-Modus
  #randomMin = DEFAULT_RANDOM_MIN;
  #randomMax = DEFAULT_RANDOM_MAX;
  #nextRandomFlip = 1;

  // Zustand für Series/Loop-Modus
  readonly #seriesPoints: SensorPoint[];
  #seriesTick = 0;
  #seriesIndex = 0;
  #seriesStopped = false;

  constructor(
    circuitState: CircuitState,
    result: number[],
    config: FunctionSensorConfig,
  ) {
    super(circuitState, null, result);
    this.sensorId = config.sensorId;
    this.sensorType = config.sensorType;
    this.bitWidth = Math.max(1, Math.min(32, Math.floor(config.bitWidth)));
    this.#rng = config.random ?? Math.random;
    this.#now = config.now ?? (() => new Date());

    const rawData = config.data ?? "";
    if (this.sensorType === "manual") {
      const parsed = parseHexUint(rawData);
      this.#value = parsed !== null ? normalizeSensorValue(parsed, this.bitWidth) : 0;
      this.#seriesPoints = [];
    } else if (this.sensorType === "random") {
      const range = tryParseRandomRange(rawData);
      if (range.ok) {
        this.#randomMin = range.min;
        this.#randomMax = range.max;
      }
      this.#nextRandomFlip = this.#pickRandomInterval();
      this.#seriesPoints = [];
    } else if (this.sensorType === "series" || this.sensorType === "loop") {
      this.#seriesPoints = tryParseSensorSeries(rawData, this.bitWidth) ?? [];
      this.#seriesStopped = this.#seriesPoints.length === 0;
    } else {
      this.#seriesPoints = [];
    }
  }

  get reportName(): string {
    return `Sensor(${this.sensorType})`;
  }

  get value(): number {
    return this.#value;
  }

  // Liefert die formatierte Anzeige des aktuellen Sensorwerts
  displayText(): string {
    return formatSensorValueText(this.sensorType, this.#value, this.bitWidth);
  }

  // Setzt den Sensorwert von außen (z. B. manuelle Eingabe, ASCII oder KeyCode)
  setValue(value: number): void {
    const normalized = normalizeSensorValue(value, this.bitWidth);
    if (this.#value !== normalized) {
      this.#value = normalized;
      this.circuitState.markUpdated(this);
    }
  }

  // Wählt ein zufälliges Flip-Intervall in [min, max) bzw. min falls min === max
  #pickRandomInterval(): number {
    if (this.#randomMax <= this.#randomMin) {
      return Math.max(1, this.#randomMin);
    }
    const span = this.#randomMax - this.#randomMin;
    return this.#randomMin + Math.floor(this.#rng() * span);
  }

  // Wählt einen zufälligen Wert im Bereich [0, 2^bitWidth - 1]
  #pickRandomValue(): number {
    if (this.bitWidth >= 32) {
      return Math.floor(this.#rng() * 0x100000000) >>> 0;
    }
    const limit = (1 << this.bitWidth) >>> 0;
    return Math.floor(this.#rng() * limit) >>> 0;
  }

  // Taktflanken-Update analog zu FunctionSensor.Flip
  flip(): boolean {
    const previous = this.#value;

    switch (this.sensorType) {
      case "manual":
      case "ascii":
      case "keyCode":
        return this.#lastEvaluatedValue !== this.#value;

      case "random": {
        this.#nextRandomFlip -= 1;
        if (this.#nextRandomFlip <= 0) {
          this.#nextRandomFlip = this.#pickRandomInterval();
          this.#value = this.#pickRandomValue();
        }
        return this.#value !== previous;
      }

      case "series":
      case "loop": {
        if (this.#seriesStopped || this.#seriesPoints.length === 0) {
          return false;
        }
        const point = this.#seriesPoints[this.#seriesIndex];
        if (point && point.tick === this.#seriesTick) {
          this.#value = point.value;
          this.#seriesIndex += 1;
          if (this.#seriesIndex >= this.#seriesPoints.length) {
            if (this.sensorType === "loop") {
              this.#seriesIndex = 0;
              this.#seriesTick = 0;
            } else {
              this.#seriesStopped = true;
            }
          } else {
            this.#seriesTick += 1;
          }
          return this.#value !== previous;
        }
        this.#seriesTick += 1;
        return false;
      }

      case "sequence": {
        this.#value = normalizeSensorValue(this.#value + 1, this.bitWidth);
        return this.#value !== previous;
      }

      case "clock": {
        this.#value = normalizeSensorValue(computeClockBcdValue(this.#now()), this.bitWidth);
        return this.#value !== previous;
      }
    }
  }

  // Schreibt den aktuellen Sensorwert bitweise in den CircuitState
  evaluate(): boolean {
    this.#lastEvaluatedValue = this.#value;
    return this.setResultValue(this.#value);
  }
}

export default FunctionSensor;
