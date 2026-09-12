export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Jitter +/-30%: un intervalo perfectamente regular es una firma de bot. */
export function jitter(ms: number): number {
  if (ms <= 0) return 0;
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i] ?? 0;
}

export interface GovernorOpts {
  /** Ritmo de partida. 3000 ms ≈ 20 req/min, muy por debajo de los 34 medidos. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Peticiones necesarias para ESTABLECER una linea base desde cero. */
  windowSize: number;
  /** Peticiones entre evaluaciones cuando YA hay linea base. */
  evalEvery: number;
  /** Deriva a partir de la cual se afloja. */
  driftSlow: number;
  /** Deriva a partir de la cual se frena en seco al maximo. */
  driftPause: number;
  /**
   * Linea base heredada. Sin ella el freno es decorativo: una cuenta pequena
   * gasta 4 peticiones y nunca llenaria la ventana.
   */
  baseline: number | null;
}

export const DEFAULT_GOVERNOR: GovernorOpts = {
  baseDelayMs: 3000,
  maxDelayMs: 30000,
  windowSize: 25,
  evalEvery: 8,
  driftSlow: 0.4,
  driftPause: 1.0,
  baseline: null,
};

/**
 * Gobernador de ritmo. Frena por deriva de latencia, no por el 429:
 * cuando llega el 429 ya te bloquearon.
 */
export class Governor {
  readonly #opts: GovernorOpts;
  #delayMs: number;
  #window: number[] = [];
  #all: number[] = [];
  #baseline: number | null = null;
  #slowdowns = 0;
  #lastDrift = 0;

  constructor(opts: Partial<GovernorOpts> = {}) {
    this.#opts = { ...DEFAULT_GOVERNOR, ...opts };
    this.#delayMs = this.#opts.baseDelayMs;
    this.#baseline = this.#opts.baseline;
  }

  get baseline(): number | null { return this.#baseline; }

  get delayMs(): number { return this.#delayMs; }
  get slowdowns(): number { return this.#slowdowns; }
  get drift(): number { return this.#lastDrift; }
  get count(): number { return this.#all.length; }

  /** Espera antes de la siguiente peticion. */
  pace(): Promise<void> {
    return sleep(jitter(this.#delayMs));
  }

  /** Registra la latencia y reajusta el ritmo al cerrar cada tramo. */
  record(ms: number): void {
    this.#all.push(ms);
    this.#window.push(ms);

    // Establecer una referencia desde cero exige muestras; compararse contra
    // una que ya existe, muchas menos.
    const need = this.#baseline === null ? this.#opts.windowSize : this.#opts.evalEvery;
    if (this.#window.length < need) return;

    const p50 = percentile([...this.#window].sort((a, b) => a - b), 0.5);
    this.#window = [];

    if (this.#baseline === null) {
      // Primer tramo: es la referencia contra la que se mide todo lo demas.
      this.#baseline = p50;
      return;
    }

    const drift = p50 / this.#baseline - 1;
    this.#lastDrift = drift;

    if (drift >= this.#opts.driftPause) {
      this.#delayMs = this.#opts.maxDelayMs;
      this.#slowdowns++;
    } else if (drift >= this.#opts.driftSlow) {
      this.#delayMs = Math.min(Math.round(this.#delayMs * 1.6), this.#opts.maxDelayMs);
      this.#slowdowns++;
    } else if (drift <= 0.1 && this.#delayMs > this.#opts.baseDelayMs) {
      // Se recupero: volver poco a poco, nunca de golpe.
      this.#delayMs = Math.max(Math.round(this.#delayMs / 1.25), this.#opts.baseDelayMs);
    }
  }

  stats(): { p50: number; p95: number } {
    const s = [...this.#all].sort((a, b) => a - b);
    return { p50: percentile(s, 0.5), p95: percentile(s, 0.95) };
  }

  /**
   * Linea base para la proxima tanda. Si esta hubo que frenar, se deja intacta:
   * incorporarla adormeceria el freno justo cuando mas falta hace.
   */
  nextBaseline(): number | null {
    if (this.#all.length < 4) return this.#baseline;

    const p50 = percentile([...this.#all].sort((a, b) => a - b), 0.5);
    if (this.#baseline === null) return p50;
    if (this.#slowdowns > 0) return this.#baseline;

    // Media exponencial: la referencia sigue a la realidad, pero despacio.
    return Math.round(this.#baseline * 0.7 + p50 * 0.3);
  }
}
