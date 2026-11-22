import type FrameRateLimit from "../types/simulation/frameRateLimit";

export const CLOCK_FREQUENCY_STEPS = [1, 2, 5, 10, 20, 30, 60] as const;

export type ClockFrequencyStep = (typeof CLOCK_FREQUENCY_STEPS)[number];

// Minimal- und Maximalwert für das Desktop-.CircuitProject-XML-Schema
export const XML_MIN_FREQUENCY = 1;
export const XML_MAX_FREQUENCY = 50;

// Rundet eine beliebige Frequenz (z. B. 1..50 aus XML) auf die nächstgelegene UI-Stufe
export function roundToNearestFrequencyStep(rawFrequency: number): ClockFrequencyStep {
  if (!Number.isFinite(rawFrequency)) {
    return 10;
  }
  if (rawFrequency <= CLOCK_FREQUENCY_STEPS[0]) {
    return CLOCK_FREQUENCY_STEPS[0];
  }

  let bestStep: ClockFrequencyStep = CLOCK_FREQUENCY_STEPS[0];
  let bestDistance = Math.abs(rawFrequency - bestStep);

  for (let i = 1; i < CLOCK_FREQUENCY_STEPS.length; i++) {
    const candidate = CLOCK_FREQUENCY_STEPS[i];
    const distance = Math.abs(rawFrequency - candidate);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestStep = candidate;
    }
  }

  return bestStep;
}

// Begrenzt eine Frequenz für den XML-Export auf den gültigen Schema-Bereich (1..50 Hz)
export function clampXmlFrequency(rawFrequency: number): number {
  if (!Number.isFinite(rawFrequency)) {
    return 10;
  }
  return Math.max(XML_MIN_FREQUENCY, Math.min(XML_MAX_FREQUENCY, Math.round(rawFrequency)));
}

// Leitet das passende UI-Taktlimit aus den Projekteinstellungen ab
export function resolveFrequencyFromProject(
  frequency: number,
  isMaximumSpeed: boolean,
): FrameRateLimit {
  if (isMaximumSpeed) {
    return "max";
  }
  return roundToNearestFrequencyStep(frequency);
}

// Formatiert eine gemessene Taktfrequenz sprachabhängig in Hz, kHz oder MHz
export function formatClockFrequency(hz: number, locale: string): string {
  if (!Number.isFinite(hz) || hz <= 0) {
    return "0 Hz";
  }
  if (hz < 999.5) {
    const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(hz));
    return `${formatted} Hz`;
  }
  if (hz < 999_950) {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(hz / 1000);
    return `${formatted} kHz`;
  }
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(hz / 1_000_000);
  return `${formatted} MHz`;
}

// Formatiert die Anzahl ausgeführter Simulationsschritte (Ticks) sprachabhängig mit Tausendertrennzeichen
export function formatStepCount(steps: number, locale: string): string {
  const safe = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safe);
}
