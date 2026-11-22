import type CircuitFunction from "../functions/circuitFunction";

const INT32_MAX = 2147483647;

// Deterministische Abarbeitungs-Warteschlange für die Schaltungssimulation analog zu DirtyList in CircuitState.cs
export class DirtyList {
  #current: CircuitFunction[] = [];
  #next: CircuitFunction[] = [];
  #seed: number;
  #iteration = 1;
  #index = 0;
  #offset = 0;
  #step = 0;

  delay = 0;

  constructor(seed = 123456789) {
    this.#seed = seed | 0;
  }

  // Reiht eine Funktion in die Auswertung für die nächste Iteration ein, falls sie nicht bereits eingereiht ist.
  add(func: CircuitFunction): void {
    if (func.iteration < this.#iteration) {
      func.iteration = this.#iteration;
      this.#next.push(func);
    }
  }

  // Reiht mehrere Funktionen ein.
  addMultiple(funcs: Iterable<CircuitFunction>): void {
    for (const f of funcs) {
      this.add(f);
    }
  }

  // Holt die nächste auszuwertende Funktion oder null, wenn alle Schaltungsteile stabil sind.
  get(): CircuitFunction | null {
    let count = this.#current.length;
    if (count <= this.#index) {
      count = this.#next.length;
      if (count <= 0) {
        return null;
      }

      this.#iteration++;
      this.#current = this.#next;
      this.#next = [];
      this.#index = 1;

      // Schrittweite: Durch INT32_MAX (Primzahl) wird jedes Element von current exakt einmal besucht
      this.#step = (INT32_MAX % count) | 0;

      // Schneller LCG-Zufallsgenerator analog zu C#
      this.#seed = (Math.imul(214013, this.#seed) + 2531011) | 0;
      const random = Math.abs(INT32_MAX & this.#seed) % count;
      this.#offset = random;

      if (this.delay > 0 && count > 1) {
        const max = Math.min(this.delay, count - 1);
        for (let i = 0; i < max; i++) {
          const deferred = this.get();
          if (deferred) {
            this.add(deferred);
          }
        }
      }

      return this.#current[random] ?? null;
    }

    this.#index++;
    let random = (this.#offset - this.#step) | 0;
    if (random < 0) {
      random += count;
    }
    this.#offset = random;

    return this.#current[random] ?? null;
  }

  clear(): void {
    this.#current = [];
    this.#next = [];
    this.#index = 0;
  }
}

export default DirtyList;
