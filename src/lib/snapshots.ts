import { STORE_PROFILES, STORE_SNAPSHOTS, getAll, req, tx } from './db';
import type {
  ChangeEvent,
  Counts,
  Diff,
  Profile,
  Relations,
  SnapshotKind,
  SnapshotRecord,
} from './types';

/** Cada cuantos deltas se reescribe una base completa. */
const REBASE_EVERY = 30;

// ------------------------------------------------------------------ perfiles

/** Upsert de perfiles. Conserva el `seenAt` mas reciente. */
export async function saveProfiles(profiles: Omit<Profile, 'seenAt'>[], seenAt: number): Promise<void> {
  if (profiles.length === 0) return;
  await tx([STORE_PROFILES], 'readwrite', (t) => {
    const s = t.objectStore(STORE_PROFILES);
    for (const p of profiles) s.put({ ...p, seenAt });
  });
}

export async function getProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  if (ids.length === 0) return map;

  await tx([STORE_PROFILES], 'readonly', async (t) => {
    const s = t.objectStore(STORE_PROFILES);
    for (const id of ids) {
      const p = await req(s.get(id) as IDBRequest<Profile | undefined>);
      if (p) map.set(id, p);
    }
  });

  return map;
}

/** Perfil conocido, o el id pelado. Inventar un username seria mentir. */
function hydrate(ids: string[], cache: Map<string, Profile>, seenAt: number): Profile[] {
  return ids.map(
    (id) => cache.get(id) ?? { id, username: `id:${id}`, fullName: null, avatar: null, seenAt },
  );
}

// ---------------------------------------------------------------- snapshots

export async function listSnapshots(kind: SnapshotKind = 'followers'): Promise<SnapshotRecord[]> {
  const all = await getAll<SnapshotRecord>(STORE_SNAPSHOTS);
  return all.filter((s) => s.kind === kind).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * Reconstruye los ids de un snapshot desde la base mas cercana.
 * Los incompletos quedan fuera: usarlos de base daria bajas falsas.
 */
export function reconstruct(history: SnapshotRecord[], upToId: number): Set<string> {
  const chain = history.filter((s) => s.complete);

  const idx = chain.findIndex((s) => s.id === upToId);
  if (idx === -1) return new Set(); // no existe, o es un snapshot incompleto

  let baseIdx = idx;
  while (baseIdx >= 0 && chain[baseIdx]?.ids === null) baseIdx--;
  if (baseIdx < 0) return new Set(); // cadena huerfana: no hay base

  const set = new Set(chain[baseIdx]?.ids ?? []);

  for (let i = baseIdx + 1; i <= idx; i++) {
    const s = chain[i];
    if (!s) continue;
    // Primero las bajas y luego las altas: si un id esta en ambos, gana el alta.
    for (const id of s.removed) set.delete(id);
    for (const id of s.added) set.add(id);
  }

  return set;
}

export interface AppendResult {
  record: SnapshotRecord;
  isBase: boolean;
  added: number;
  removed: number;
  /** null en el primer snapshot: no hay con que comparar. */
  previousId: number | null;
}

/**
 * Guarda como base o delta. Una captura incompleta nunca se compara:
 * enumerar a medias y restar da bajas falsas.
 */
export async function appendSnapshot(
  ids: string[],
  opts: { kind?: SnapshotKind; complete: boolean; chunked?: boolean; counts: Counts | null; takenAt?: number },
): Promise<AppendResult> {
  const kind = opts.kind ?? 'followers';
  const takenAt = opts.takenAt ?? Date.now();

  const history = await listSnapshots(kind);
  const usable = history.filter((s) => s.complete);
  const prev = usable[usable.length - 1] ?? null;

  const now = new Set(ids);
  let added: string[] = [];
  let removed: string[] = [];

  if (prev?.id !== undefined && opts.complete) {
    const before = reconstruct(history, prev.id);
    for (const id of now) if (!before.has(id)) added.push(id);
    for (const id of before) if (!now.has(id)) removed.push(id);
  } else {
    // Primer snapshot, o captura incompleta: no hay diff que calcular.
    added = [];
    removed = [];
  }

  // La cadena la forman solo los completos, igual que en reconstruct().
  const chainLength = prev && prev.ids === null ? prev.chainLength + 1 : 1;

  // Base si: es el primero, si la captura vino incompleta, o si toca rebasar.
  const isBase = prev === null || !opts.complete || chainLength >= REBASE_EVERY;

  const record: SnapshotRecord = {
    takenAt,
    kind,
    complete: opts.complete,
    ...(opts.chunked ? { chunked: true } : {}),
    ids: isBase ? ids : null,
    chainLength: isBase ? 0 : chainLength,
    added,
    removed,
    counts: opts.counts,
  };

  const id = await tx([STORE_SNAPSHOTS], 'readwrite', (t) =>
    req(t.objectStore(STORE_SNAPSHOTS).add(record) as IDBRequest<IDBValidKey>),
  );

  record.id = Number(id);

  return {
    record,
    isBase,
    added: added.length,
    removed: removed.length,
    previousId: prev?.id ?? null,
  };
}

/**
 * Diff entre los dos ultimos snapshots completos.
 *
 * Devuelve perfiles, no ids: es lo que el popup necesita pintar.
 */
export async function latestDiff(kind: SnapshotKind = 'followers'): Promise<Diff | null> {
  const history = await listSnapshots(kind);
  const usable = history.filter((s) => s.complete && s.id !== undefined);
  const to = usable[usable.length - 1];
  if (!to?.id) return null;

  const from = usable[usable.length - 2] ?? null;

  const cache = await getProfiles([...to.added, ...to.removed]);
  const seenAt = to.takenAt;

  // El contador que toca segun la lista: no mezclar seguidores con seguidos.
  const countOf = (s: typeof to | null): number | null =>
    kind === 'followers' ? s?.counts?.followers ?? null : s?.counts?.following ?? null;

  return {
    kind,
    fromId: from?.id ?? null,
    toId: to.id,
    from: countOf(from),
    to: countOf(to) ?? reconstruct(history, to.id).size,
    added: hydrate(to.added, cache, seenAt),
    removed: hydrate(to.removed, cache, seenAt),
    // Leida en varias tandas: pudo cambiar por el camino y el diff lo arrastra.
    unreliable: Boolean(to.chunked) || Boolean(from?.chunked),
  };
}

/**
 * Cruza las dos ultimas listas: cero peticiones.
 * Si falta una devuelve ready:false en vez de un resultado a medias.
 */
export async function relations(): Promise<Relations> {
  const empty: Relations = { notFollowingBack: [], youDontFollowBack: [], mutual: 0, ready: false };

  const [fr, fg] = await Promise.all([listSnapshots('followers'), listSnapshots('following')]);

  const lastFr = fr.filter((s) => s.complete).pop();
  const lastFg = fg.filter((s) => s.complete).pop();
  if (lastFr?.id === undefined || lastFg?.id === undefined) return empty;

  const followers = reconstruct(fr, lastFr.id);
  const following = reconstruct(fg, lastFg.id);

  const notBack: string[] = [];
  const youNotBack: string[] = [];
  let mutual = 0;

  for (const id of following) {
    if (followers.has(id)) mutual++;
    else notBack.push(id);
  }
  for (const id of followers) {
    if (!following.has(id)) youNotBack.push(id);
  }

  const cache = await getProfiles([...notBack, ...youNotBack]);
  const seenAt = Math.max(lastFr.takenAt, lastFg.takenAt);

  return {
    notFollowingBack: hydrate(notBack, cache, seenAt),
    youDontFollowBack: hydrate(youNotBack, cache, seenAt),
    mutual,
    ready: true,
  };
}

/**
 * Actividad reciente de seguidores, la mas nueva primero.
 * Los diffs ya estan guardados en cada snapshot: esto solo los recorre.
 */
export async function recentChanges(limit = 60): Promise<ChangeEvent[]> {
  const history = await listSnapshots('followers');

  const completos = history.filter((s) => s.complete);

  type Crudo = { at: number; since: number | null; dir: 'in' | 'out'; id: string; unreliable: boolean };
  const crudos: Crudo[] = [];

  for (let i = 0; i < completos.length; i++) {
    const s = completos[i]!;
    const since = completos[i - 1]?.takenAt ?? null;
    const unreliable = Boolean(s.chunked);
    for (const id of s.removed) crudos.push({ at: s.takenAt, since, dir: 'out', id, unreliable });
    for (const id of s.added) crudos.push({ at: s.takenAt, since, dir: 'in', id, unreliable });
  }

  crudos.sort((a, b) => b.at - a.at);
  const recorte = crudos.slice(0, limit);

  const cache = await getProfiles(recorte.map((e) => e.id));
  return recorte.map((e) => ({
    at: e.at,
    since: e.since,
    dir: e.dir,
    profile: hydrate([e.id], cache, e.at)[0]!,
    unreliable: e.unreliable,
  }));
}

/** Resumen para la cabecera del popup. */
export async function summary(kind: SnapshotKind = 'followers'): Promise<{
  snapshots: number;
  bases: number;
  lastAt: number | null;
  lastCount: number | null;
}> {
  const history = await listSnapshots(kind);
  const last = history[history.length - 1] ?? null;
  // El recuento sale del ultimo COMPLETO: uno troceado no sabe cuanta gente hay.
  const lastComplete = history.filter((s) => s.complete).pop() ?? null;
  return {
    snapshots: history.length,
    bases: history.filter((s) => s.ids !== null).length,
    lastAt: last?.takenAt ?? null,
    lastCount: lastComplete?.id !== undefined ? reconstruct(history, lastComplete.id).size : null,
  };
}
