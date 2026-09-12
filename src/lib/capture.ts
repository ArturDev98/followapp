import { countsAdapters, pageAdapters, runAdapters, type AdapterCtx } from './endpoints';
import { Governor, sleep, type GovernorOpts } from './throttle';
import type { Severity } from './http';
import type {
  CaptureProgress,
  CaptureResult,
  CaptureStats,
  Counts,
  IgResponse,
  Profile,
  SnapshotKind,
  StopReason,
} from './types';

/** Cuantas veces se reintenta un fallo transitorio antes de rendirse. */
const TRANSIENT_RETRIES = 2;
const TRANSIENT_BACKOFF_MS = 4000;

export interface CaptureOpts {
  /** Tope de peticiones de esta tanda. Es lo que permite trocear entre alarmas. */
  budget: number;
  /** Reanudar desde aqui. Omitir para empezar de cero. */
  cursor?: string | undefined;
  /** Conocido de capturas previas; habilita candidatos que lo necesitan. */
  username?: string | undefined;
  /**
   * Contadores ya leidos. Si se pasan, la captura NO gasta una peticion en
   * releerlos: capturar las dos listas seguidas debe costar un solo contador.
   */
  counts?: Counts | null | undefined;
  governor?: Partial<GovernorOpts> | undefined;
  onProgress?: ((p: CaptureProgress) => void) | undefined;
}

/** Traduce una gravedad a motivo de parada. */
function stopFor(sev: Severity): StopReason {
  switch (sev) {
    case 'soft': return 'soft-block';
    case 'hard': return 'hard-block';
    case 'auth': return 'auth';
    case 'transient': return 'error';
    default: return 'no-adapter';
  }
}

/** La peticion barata: un request, los dos contadores. Base del poll. */
export async function captureCounts(
  userId: string,
  username?: string | undefined,
): Promise<{ counts: Counts | null; username: string | null; adapterId: string | null; detail: string }> {
  const ctx: AdapterCtx = { userId, username };
  const out = await runAdapters(countsAdapters, ctx, undefined, () => {});

  if (!out.value) {
    return { counts: null, username: null, adapterId: out.adapterId, detail: out.signal.reason };
  }

  const { followers, following } = out.value;
  return {
    counts: { followers, following },
    username: out.value.username ?? null,
    adapterId: out.adapterId,
    detail: 'ok',
  };
}

/**
 * Enumera una lista: ceil(N/25) peticiones, no hay atajo. Si se agota el
 * presupuesto devuelve complete:false y el cursor para continuar.
 */
export async function captureList(
  userId: string,
  kind: SnapshotKind,
  opts: CaptureOpts,
): Promise<CaptureResult> {
  const gov = new Governor(opts.governor ?? {});
  const t0 = performance.now();

  const ids: string[] = [];
  const seen = new Set<string>();
  /** Los perfiles llegan dentro de la misma respuesta: no cuestan peticiones. */
  const profiles = new Map<string, Omit<Profile, 'seenAt'>>();

  const adapters = pageAdapters[kind];
  const total = kind === 'followers' ? opts.counts?.followers ?? null : opts.counts?.following ?? null;

  let cursor: string | null = opts.cursor ?? null;
  let requests = 0;
  let adapterId: string | null = null;
  let stopReason: StopReason = 'complete';
  let detail = 'lista completa';

  const finish = (): CaptureResult => {
    const { p50, p95 } = gov.stats();
    const stats: CaptureStats = {
      requests,
      elapsedMs: Math.round(performance.now() - t0),
      p50,
      p95,
      finalDelayMs: gov.delayMs,
      slowdowns: gov.slowdowns,
      adapter: adapterId,
      nextBaseline: gov.nextBaseline(),
    };
    return {
      kind,
      complete: stopReason === 'complete',
      ids,
      profiles: [...profiles.values()],
      cursor: stopReason === 'complete' ? null : cursor,
      stopReason,
      detail,
      stats,
    };
  };

  while (requests < opts.budget) {
    // Sin pausa antes de la primera: el ritmo separa peticiones, no las precede.
    if (requests > 0) await gov.pace();

    const ctx: AdapterCtx = { userId, username: opts.username };
    const tick = (r: IgResponse) => {
      requests++;
      if (r.netError === null) gov.record(r.ms);
    };

    let out = await runAdapters(adapters, ctx, cursor ?? undefined, tick);

    // Reintento acotado para fallos transitorios (5xx, red).
    let retries = 0;
    while (out.signal.severity === 'transient' && retries < TRANSIENT_RETRIES && requests < opts.budget) {
      retries++;
      await sleep(TRANSIENT_BACKOFF_MS * retries);
      out = await runAdapters(adapters, ctx, cursor ?? undefined, tick);
    }

    if (!out.value) {
      stopReason = stopFor(out.signal.severity);
      detail = out.skipped.length
        ? `${out.signal.reason} · descartados: ${out.skipped.join(', ')}`
        : out.signal.reason;
      return finish();
    }

    adapterId = out.adapterId;

    for (const id of out.value.ids) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    for (const p of out.value.profiles) profiles.set(p.id, p);

    opts.onProgress?.({ kind, requests, ids: ids.length, total, delayMs: gov.delayMs });

    cursor = out.value.cursor;

    if (cursor === null) {
      stopReason = 'complete';
      detail = 'fin de lista (sin next_max_id)';
      return finish();
    }
  }

  // Se acabo el presupuesto con la lista a medias: se reanuda con el cursor.
  stopReason = 'budget';
  detail = `presupuesto agotado (${opts.budget} peticiones); reanudable`;
  return finish();
}
