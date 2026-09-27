import { IG_ORIGIN, classify, igFetch, type Signal } from './http';
import { jitter, sleep } from './throttle';
import type { Verdict } from './types';

/**
 * Quien desaparece de la lista no siempre se ha ido: pudo ser suspendido, o la
 * lectura se lo saltó. Llamarlo baja sería mentir.
 */

export interface VerifyOpts {
  /** Tope de peticiones: comprobar cuesta una por persona. */
  budget: number;
  /** Ritmo heredado de la enumeracion que acaba de correr. */
  delayMs: number;
}

export interface VerifyResult {
  verdicts: Record<string, Verdict>;
  requests: number;
  /** Lo que obligo a parar, si paro. El scheduler decide la espera. */
  stopped: Signal | null;
  /** Ids que quedaron sin comprobar por presupuesto o por la parada. */
  pending: string[];
}

/**
 * Comprueba una por una si las bajas siguen existiendo.
 * Se para ante la primera senal de bloqueo: insistir es lo que no hay que hacer.
 */
export async function verifyRemovals(ids: string[], opts: VerifyOpts): Promise<VerifyResult> {
  const verdicts: Record<string, Verdict> = {};
  let requests = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;

    if (requests >= opts.budget) return { verdicts, requests, stopped: null, pending: ids.slice(i) };
    if (requests > 0) await sleep(jitter(opts.delayMs));

    // No usa users/{id}/info/: desde el 24/9/2026 da 429 a alguna sesión (HALLAZGOS §7).
    const res = await igFetch(`${IG_ORIGIN}/api/v1/friendships/show/${id}/`);
    requests++;

    // Aqui un 404 es la respuesta, no un fallo: esa cuenta ya no existe.
    if (res.status === 404) {
      verdicts[id] = 'gone';
      continue;
    }

    const signal = classify(res);
    if (signal.severity === 'soft' || signal.severity === 'hard' || signal.severity === 'auth') {
      return { verdicts, requests, stopped: signal, pending: ids.slice(i) };
    }

    // followed_by dice si la baja es de verdad; cualquier otra forma queda en duda.
    const fb = signal.severity === 'ok' ? (res.body as { followed_by?: unknown } | null)?.followed_by : undefined;
    verdicts[id] = fb === false ? 'left' : fb === true ? 'still' : 'unknown';
  }

  return { verdicts, requests, stopped: null, pending: [] };
}

/** Cuenta veredictos para la bitacora y el diagnostico. */
export function tally(verdicts: Record<string, Verdict>): Record<Verdict, number> {
  const out: Record<Verdict, number> = { left: 0, gone: 0, still: 0, unknown: 0 };
  for (const v of Object.values(verdicts)) out[v]++;
  return out;
}
