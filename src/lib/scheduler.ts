import { readUserId, type Severity } from './http';
import { captureCounts, captureList } from './capture';
import { appendSnapshot, saveProfiles } from './snapshots';
import { getMeta, setMeta } from './db';
import { POLL_CHOICES, POLL_DEFAULT_MINUTES } from './types';
import type { CaptureProgress, Counts, Profile, SnapshotKind, StopReason } from './types';

/**
 * Maquina de estados de la captura pasiva, por reloj.
 * El poll mira el contador (1 peticion); enumerar solo si algo se movio.
 */

// ---------------------------------------------------------------- constantes

export const ALARM_POLL = 'followapp:poll';
export const ALARM_RESUME = 'followapp:resume';

/** Continuacion de una enumeracion troceada. Corto: hay trabajo a medias. */
const RESUME_MINUTES = 2;

/**
 * Tope por disparo. No lo impone Instagram sino el service worker, que Chrome
 * mata si tarda: 60 peticiones a 3 s son ~3 min.
 */
const TICK_BUDGET = 60;

/** Barrido completo forzado, pase lo que pase con los contadores. */
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/** Esperas tras un bloqueo, por gravedad. */
const COOLDOWN_SOFT_MS = 35 * 60 * 1000;
const COOLDOWN_HARD_MS = 6 * 60 * 60 * 1000;

// -------------------------------------------------------------------- estado

/** Enumeracion a medias que hay que continuar en el proximo disparo. */
export interface Pending {
  kind: SnapshotKind;
  cursor: string;
  /** Ids acumulados entre disparos: sin esto no se puede cerrar el snapshot. */
  ids: string[];
  startedAt: number;
  chunks: number;
}

/**
 * Un bloqueo por sesión no es como uno por ritmo: reintentar sin sesión no
 * cuesta ni una petición, y reintentar tras un 429 es justo lo que no hay
 * que hacer. El botón de revisar los trata distinto.
 */
export type BlockKind = 'auth' | 'soft' | 'hard';

export interface SchedulerState {
  enabled: boolean;
  /** Minutos entre polls. Ver POLL_CHOICES. */
  pollMinutes: number;
  lastCounts: Counts | null;
  lastPollAt: number | null;
  lastSweepAt: number | null;
  /** Hasta cuando no se toca nada, tras un bloqueo. */
  blockedUntil: number | null;
  blockedReason: string | null;
  /**
   * De qué clase es la espera. Sin esto hay que adivinarla leyendo el texto
   * del motivo, que además está traducido.
   */
  blockedKind: BlockKind | null;
  pending: Pending | null;
  /** Linea base de latencia, heredada entre tandas. */
  baseline: number | null;
  /** Ultimas lineas de bitacora, para que el popup cuente que pasa. */
  log: LogEntry[];
}

export interface LogEntry {
  at: number;
  text: string;
  level: 'info' | 'warn' | 'bad';
}

const EMPTY: SchedulerState = {
  enabled: false,
  pollMinutes: POLL_DEFAULT_MINUTES,
  lastCounts: null,
  lastPollAt: null,
  lastSweepAt: null,
  blockedUntil: null,
  blockedReason: null,
  blockedKind: null,
  pending: null,
  baseline: null,
  log: [],
};

const KEY = 'scheduler';
const LOG_MAX = 40;

export async function getState(): Promise<SchedulerState> {
  const s = await getMeta<SchedulerState>(KEY);
  return { ...EMPTY, ...(s ?? {}) };
}

async function save(patch: Partial<SchedulerState>): Promise<SchedulerState> {
  const next = { ...(await getState()), ...patch };
  await setMeta(KEY, next);
  return next;
}

async function log(text: string, level: LogEntry['level'] = 'info'): Promise<void> {
  const s = await getState();
  const entry: LogEntry = { at: Date.now(), text, level };
  await save({ log: [entry, ...s.log].slice(0, LOG_MAX) });
}

// ------------------------------------------------------------------- alarmas

export async function enable(minutes?: number): Promise<SchedulerState> {
  const cur = await getState();
  const every = minutes ?? cur.pollMinutes ?? POLL_DEFAULT_MINUTES;
  const label = POLL_CHOICES.find((c) => c.minutes === every)?.label ?? `${every} min`;

  // create() sobre una alarma existente la reemplaza, asi que cambiar el
  // intervalo es simplemente volver a crearla.
  await chrome.alarms.create(ALARM_POLL, {
    periodInMinutes: every,
    // El primer disparo no espera un ciclo entero: con 4 h seria una eternidad
    // antes de saber si funciona.
    delayInMinutes: Math.min(1, every),
  });

  await log(`Vigilancia activada · poll cada ${label}`);
  return save({ enabled: true, pollMinutes: every });
}

export async function disable(): Promise<SchedulerState> {
  await chrome.alarms.clear(ALARM_POLL);
  await chrome.alarms.clear(ALARM_RESUME);
  await log('Vigilancia detenida', 'warn');
  return save({ enabled: false });
}

/**
 * Devuelve el id del usuario, o deja la espera apuntada si no hay sesion.
 * No gasta ni una peticion: es leer una cookie. Encender la vigilancia
 * promete revisar, asi que quien lo promete comprueba primero que puede.
 */
export async function requireSession(): Promise<string | null> {
  const id = await readUserId();
  if (id) return id;

  await save({
    blockedUntil: Date.now() + COOLDOWN_SOFT_MS,
    blockedReason: 'sin sesión de Instagram',
    blockedKind: 'auth',
  });
  await log('Sin sesión de Instagram: no se puede capturar', 'warn');
  return null;
}

async function scheduleResume(): Promise<void> {
  await chrome.alarms.create(ALARM_RESUME, { delayInMinutes: RESUME_MINUTES });
}

/** Traduce un motivo de parada a espera, o null si no hay que esperar. */
function cooldownFor(reason: StopReason): { ms: number; text: string; kind: BlockKind } | null {
  switch (reason) {
    case 'soft-block':
      return { ms: COOLDOWN_SOFT_MS, text: 'Instagram pidió esperar', kind: 'soft' };
    case 'hard-block':
      return {
        ms: COOLDOWN_HARD_MS,
        text: 'bloqueo duro: abre la app oficial de Instagram',
        kind: 'hard',
      };
    case 'auth':
      return { ms: COOLDOWN_SOFT_MS, text: 'sin sesión de Instagram', kind: 'auth' };
    default:
      return null;
  }
}

/** Lo mismo para el poll, que responde con gravedad en vez de con motivo. */
function cooldownForSeverity(s: Severity): { ms: number; kind: BlockKind } {
  if (s === 'auth') return { ms: COOLDOWN_SOFT_MS, kind: 'auth' };
  if (s === 'hard') return { ms: COOLDOWN_HARD_MS, kind: 'hard' };
  return { ms: COOLDOWN_SOFT_MS, kind: 'soft' };
}

// ---------------------------------------------------------- reconciliacion

/**
 * Verifica lo enumerado contra el contador. Faltar gente produce bajas falsas,
 * asi que ante desajuste se marca incompleto y se reintenta en el proximo poll.
 */
async function reconcile(
  userId: string,
  kind: SnapshotKind,
  got: number,
  expected: number | null,
  username: string | undefined,
  budgetLeft: number,
): Promise<{ ok: boolean; counts: Counts | null; requests: number; note: string }> {
  if (expected === null || got === expected) {
    return { ok: true, counts: null, requests: 0, note: '' };
  }
  if (budgetLeft < 1) {
    return { ok: false, counts: null, requests: 0, note: `leidos ${got}, esperados ${expected}` };
  }

  // El contador pudo moverse MIENTRAS enumerabamos: releerlo lo aclara.
  const fresh = await captureCounts(userId, username);
  const n = kind === 'followers' ? fresh.counts?.followers ?? null : fresh.counts?.following ?? null;

  if (n === got) {
    return {
      ok: true,
      counts: fresh.counts,
      requests: 1,
      note: `el contador se movio de ${expected} a ${got} durante la lectura`,
    };
  }

  return {
    ok: false,
    counts: fresh.counts,
    requests: 1,
    note: `leidos ${got}, el contador dice ${n ?? expected}`,
  };
}

// ------------------------------------------------------------------- el tick

export interface TickResult {
  ran: boolean;
  /** Por que no se hizo nada, si ran es false. */
  skipped?: string;
  requests: number;
  enumerated: SnapshotKind[];
  state: SchedulerState;
}

export interface TickOpts {
  /** Ignora contadores y barre las dos listas. Lo usa el boton "Capturar ya". */
  force?: boolean;
  onProgress?: ((p: CaptureProgress) => void) | undefined;
  /**
   * Se llama cuando la revisión va a empezar de verdad, después de los
   * cortes. Anunciarla antes pinta un «Revisando…» que no ocurre.
   */
  onStart?: (() => void) | undefined;
}

/**
 * Un disparo. Orden: lo que quedo a medias, barrido diario, y lo que el
 * contador diga que cambio.
 */
export async function tick(opts: TickOpts = {}): Promise<TickResult> {
  const state = await getState();
  const now = Date.now();

  // Forzar salta la espera solo si era por sesión: reintentar sin sesión no
  // cuesta una petición, pero reintentar tras un 429 es lo contrario de parar.
  const saltable = opts.force && state.blockedKind === 'auth';
  if (state.blockedUntil && state.blockedUntil > now && !saltable) {
    const mins = Math.ceil((state.blockedUntil - now) / 60000);
    return { ran: false, skipped: `en espera ${mins} min · ${state.blockedReason ?? ''}`, requests: 0, enumerated: [], state };
  }

  const userId = await requireSession();
  if (!userId) {
    return {
      ran: false,
      skipped: 'sin sesión',
      requests: 0,
      enumerated: [],
      state: await getState(),
    };
  }

  // A partir de aquí sí va a salir tráfico: ahora se puede anunciar.
  opts.onStart?.();

  const username = (await getMeta<string>('username')) ?? undefined;
  let requests = 0;

  // --- La peticion barata. Una sola, y trae los dos contadores.
  const c = await captureCounts(userId, username);
  requests++;
  if (c.username) await setMeta('username', c.username);

  if (!c.counts) {
    const cd = cooldownForSeverity(c.severity);
    const s = await save({
      blockedUntil: now + cd.ms,
      blockedReason: c.detail,
      blockedKind: cd.kind,
    });
    await log(`Poll falló: ${c.detail}`, 'bad');
    return { ran: false, skipped: c.detail, requests, enumerated: [], state: s };
  }

  await save({
    lastPollAt: now,
    lastCounts: c.counts,
    blockedUntil: null,
    blockedReason: null,
    blockedKind: null,
  });

  // --- Que toca enumerar.
  const sweepDue = !state.lastSweepAt || now - state.lastSweepAt >= SWEEP_EVERY_MS;
  const queue: SnapshotKind[] = [];

  if (state.pending) {
    // Lo a medias manda: hasta cerrarlo, no hay snapshot que valga.
    queue.push(state.pending.kind);
  } else if (opts.force || sweepDue) {
    queue.push('followers', 'following');
  } else {
    const prev = state.lastCounts;
    if (!prev || prev.followers !== c.counts.followers) queue.push('followers');
    if (!prev || prev.following !== c.counts.following) queue.push('following');
  }

  if (queue.length === 0) {
    await log(`Sin cambios · ${c.counts.followers} seguidores, ${c.counts.following} seguidos · 1 petición`);
    return { ran: true, requests, enumerated: [], state: await getState() };
  }

  const why = state.pending ? 'continuación' : opts.force ? 'manual' : sweepDue ? 'barrido diario' : 'el contador cambió';
  await log(`Enumerando ${queue.join(' y ')} · ${why}`);

  // --- Enumerar, respetando el presupuesto del disparo.
  const enumerated: SnapshotKind[] = [];
  let baseline = state.baseline;

  for (const kind of queue) {
    const left = TICK_BUDGET - requests;
    if (left <= 0) break;

    const pend = state.pending?.kind === kind ? state.pending : null;

    const res = await captureList(userId, kind, {
      budget: left,
      cursor: pend?.cursor,
      username: c.username ?? username,
      counts: c.counts,
      governor: { baseline },
      onProgress: opts.onProgress,
    });

    requests += res.stats.requests;
    baseline = res.stats.nextBaseline;

    const takenAt = Date.now();
    await saveProfiles(res.profiles, takenAt);

    // Unir con lo que ya se habia recogido en disparos anteriores.
    const merged = pend ? dedupe([...pend.ids, ...res.ids]) : res.ids;

    if (res.complete) {
      const chunks = (pend?.chunks ?? 0) + 1;
      const nombre = kind === 'followers' ? 'Seguidores' : 'Seguidos';
      const esperado = kind === 'followers' ? c.counts.followers : c.counts.following;

      const rec = await reconcile(
        userId,
        kind,
        merged.length,
        esperado,
        c.username ?? username,
        TICK_BUDGET - requests,
      );
      requests += rec.requests;

      // Si el contador se movio durante la lectura, el bueno es el fresco.
      const counts = rec.counts ?? c.counts;

      await appendSnapshot(merged, {
        kind,
        // Un desajuste significa que faltan personas. Guardar esto como
        // completo produciria bajas falsas en el proximo diff.
        complete: rec.ok,
        // Una lista leida a lo largo de varios disparos pudo cambiar por el
        // camino: el snapshot es valido pero el diff puede arrastrar drift.
        chunked: chunks > 1,
        counts,
        takenAt,
      });

      await save({ pending: null });

      if (rec.ok) {
        enumerated.push(kind);
        await log(
          `${nombre}: ${merged.length} · ${res.stats.requests} peticiones` +
            (chunks > 1 ? ` · cerrado tras ${chunks} tandas` : '') +
            (rec.note ? ` · ${rec.note}` : ''),
        );
      } else {
        await log(`${nombre}: descartado, ${rec.note}. Se reintenta en el próximo poll.`, 'warn');
      }
    } else if (res.cursor) {
      // Presupuesto agotado con la lista a medias: guardar y continuar luego.
      await save({
        pending: {
          kind,
          cursor: res.cursor,
          ids: merged,
          startedAt: pend?.startedAt ?? takenAt,
          chunks: (pend?.chunks ?? 0) + 1,
        },
      });
      await log(`${kind === 'followers' ? 'Seguidores' : 'Seguidos'}: ${merged.length} recogidos, continúa luego`, 'warn');
      await scheduleResume();
      break;
    } else {
      // Paro por bloqueo o error: no hay cursor con el que continuar.
      const cd = cooldownFor(res.stopReason);
      if (cd) {
        await save({
          blockedUntil: Date.now() + cd.ms,
          blockedReason: cd.text,
          blockedKind: cd.kind,
          pending: null,
        });
        await log(`Parada: ${cd.text}`, res.stopReason === 'hard-block' ? 'bad' : 'warn');
      } else {
        await log(`Parada: ${res.detail}`, 'bad');
      }
      break;
    }
  }

  const patch: Partial<SchedulerState> = { baseline };
  // El barrido solo cuenta si se cerraron las DOS listas.
  if (enumerated.length === 2) patch.lastSweepAt = Date.now();

  return { ran: true, requests, enumerated, state: await save(patch) };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

export type { Profile };
