import { IG_ORIGIN, igFetch, classify, type Signal } from './http';
import type { Counts, IgResponse, ListPage, SnapshotKind } from './types';

/**
 * Lista de candidatos por capacidad: Meta rota endpoints sin avisar.
 * Degrada solo ante fallo de forma; ante throttling, para.
 */

export interface AdapterCtx {
  userId: string;
  /** Conocido despues de la primera captura. Algunos candidatos lo necesitan. */
  username?: string | undefined;
}

export interface Adapter<T> {
  id: string;
  /**
   * Sabemos que esta muerto. Se prueba solo si todos los vivos fallaron por
   * forma, por si Meta lo resucita.
   */
  deprecated?: boolean;
  /** `null` si este candidato no puede construirse con el contexto dado. */
  url(ctx: AdapterCtx, cursor?: string | undefined): string | null;
  parse(body: unknown): T | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

// ---------------------------------------------------------------- contadores

export const countsAdapters: Adapter<Counts & { username?: string }>[] = [
  {
    // Primario: los dos contadores en una petición. Desde el 24/9/2026 da 429 de
    // edge a alguna sesión con la lista viva; el scheduler sigue sin él (HALLAZGOS §7).
    id: 'users/{id}/info',
    url: (ctx) => `${IG_ORIGIN}/api/v1/users/${ctx.userId}/info/`,
    parse: (body) => {
      const user = (body as { user?: Record<string, unknown> } | null)?.user;
      if (!user) return null;
      const followers = num(user['follower_count']);
      const following = num(user['following_count']);
      if (followers === null && following === null) return null;
      const uname = user['username'];
      return {
        followers,
        following,
        ...(typeof uname === 'string' ? { username: uname } : {}),
      };
    },
  },
  {
    // Muerto: 429 en el edge, igual desde datacenter que desde sesion valida.
    // Se conserva marcado por si Meta lo resucita; no cuesta nada.
    id: 'web_profile_info',
    deprecated: true,
    url: (ctx) =>
      ctx.username
        ? `${IG_ORIGIN}/api/v1/users/web_profile_info/?username=${encodeURIComponent(ctx.username)}`
        : null,
    parse: (body) => {
      const user = (body as { data?: { user?: Record<string, unknown> } } | null)?.data?.user;
      if (!user) return null;
      const fb = user['edge_followed_by'] as { count?: unknown } | undefined;
      const fl = user['edge_follow'] as { count?: unknown } | undefined;
      const followers = num(fb?.count);
      const following = num(fl?.count);
      if (followers === null && following === null) return null;
      return { followers, following };
    },
  },
];

// ------------------------------------------------------------ nombre propio

/** Solo hace falta si `info/` está caído: las listas no traen el nombre de uno mismo. */
export const usernameAdapters: Adapter<string>[] = [
  {
    // Medido el 24/9/2026: 200 en ~1,2 s. Trae también correo y teléfono: solo se lee el nombre.
    id: 'accounts/edit/web_form_data',
    url: () => `${IG_ORIGIN}/api/v1/accounts/edit/web_form_data/`,
    parse: (body) => {
      const u = (body as { form_data?: { username?: unknown } } | null)?.form_data?.username;
      return typeof u === 'string' && u !== '' ? u : null;
    },
  },
];

// ---------------------------------------------------------------- paginacion

/** Seguidores y seguidos solo difieren en un segmento de la ruta. */
function friendshipsAdapter(kind: SnapshotKind): Adapter<ListPage> {
  return {
    id: `friendships/{id}/${kind}`,
    url: (ctx, cursor) => {
      const u = new URL(`${IG_ORIGIN}/api/v1/friendships/${ctx.userId}/${kind}/`);
      // El servidor capa en 25 ignorando este valor. Pedimos 25 para no
      // fingir que controlamos algo que no controlamos.
      u.searchParams.set('count', '25');
      if (cursor) u.searchParams.set('max_id', cursor);
      return u.toString();
    },
    parse: (body) => {
      const b = body as { users?: unknown; next_max_id?: unknown } | null;
      if (!b || !Array.isArray(b.users)) return null;

      const ids: string[] = [];
      const profiles: ListPage['profiles'] = [];

      for (const raw of b.users) {
        const u = raw as Record<string, unknown>;
        const pk = u['pk'] ?? u['pk_id'];
        const id = typeof pk === 'string' ? pk : typeof pk === 'number' ? String(pk) : null;
        if (id === null) continue;

        ids.push(id);

        // El perfil viene en la misma respuesta: la cache sale gratis.
        const username = u['username'];
        if (typeof username === 'string') {
          const full = u['full_name'];
          const pic = u['profile_pic_url'];
          profiles.push({
            id,
            username,
            fullName: typeof full === 'string' && full !== '' ? full : null,
            avatar: typeof pic === 'string' ? pic : null,
          });
        }
      }

      // Ausencia de next_max_id es fin de lista, no error.
      const cursor = typeof b.next_max_id === 'string' ? b.next_max_id : null;
      return { ids, profiles, cursor };
    },
  };
}

export const pageAdapters: Record<SnapshotKind, Adapter<ListPage>[]> = {
  followers: [friendshipsAdapter('followers')],
  following: [friendshipsAdapter('following')],
};

// ------------------------------------------------------------------- runner

export interface AdapterOutcome<T> {
  value: T | null;
  adapterId: string | null;
  signal: Signal;
  /** Candidatos descartados por forma, para telemetria. */
  skipped: string[];
}

/** Prueba candidatos hasta que uno responda con forma valida. */
export async function runAdapters<T>(
  adapters: Adapter<T>[],
  ctx: AdapterCtx,
  cursor: string | undefined,
  onResponse: (r: IgResponse) => void,
): Promise<AdapterOutcome<T>> {
  const skipped: string[] = [];

  // Vivos primero; los marcados como muertos solo si no queda otra.
  const ordered = [...adapters].sort((a, b) => Number(a.deprecated ?? false) - Number(b.deprecated ?? false));

  let last: Signal = { severity: 'shape', reason: 'ningun candidato aplicable' };

  for (const a of ordered) {
    const url = a.url(ctx, cursor);
    if (url === null) {
      skipped.push(`${a.id} (contexto insuficiente)`);
      continue;
    }

    const res = await igFetch(url);
    onResponse(res);

    const signal = classify(res);
    last = signal;

    // Throttle, auth o fallo de red: parar aquí. Si el 429 era solo de este
    // endpoint, el scheduler sigue leyendo la lista sin contador.
    if (signal.severity !== 'ok' && signal.severity !== 'shape') {
      return { value: null, adapterId: a.id, signal, skipped };
    }

    if (signal.severity === 'ok') {
      const value = a.parse(res.body);
      if (value !== null) {
        return { value, adapterId: a.id, signal, skipped };
      }
      // 200 con forma inesperada: este candidato cambio. Al siguiente.
      skipped.push(`${a.id} (forma inesperada)`);
      last = { severity: 'shape', reason: `${a.id}: forma inesperada` };
      continue;
    }

    skipped.push(`${a.id} (${signal.reason})`);
  }

  return { value: null, adapterId: null, signal: last, skipped };
}
