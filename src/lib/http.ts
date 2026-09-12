import type { IgResponse } from './types';

/** App id del cliente web de Instagram. Obligatorio en todas las llamadas. */
export const IG_APP_ID = '936619743392459';

export const IG_ORIGIN = 'https://www.instagram.com';

/**
 * Gravedad de lo que respondio Instagram. El gobernador reacciona distinto a
 * cada una, asi que no basta con un booleano ok/error.
 */
export type Severity =
  | 'ok'
  | 'transient'   // 5xx o fallo de red: reintentable en segundos
  | 'shape'       // 200 pero el cuerpo no tiene la forma esperada -> probar otro adaptador
  | 'soft'        // please_wait / 429: parar la tanda, volver en ~30 min
  | 'hard'        // feedback_required: horas, y el usuario debe abrir la app
  | 'auth';       // require_login / 401: la sesion no sirve

export interface Signal {
  severity: Severity;
  reason: string;
}

export const OK: Signal = { severity: 'ok', reason: 'ok' };

export async function igFetch(url: string): Promise<IgResponse> {
  const t0 = performance.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'x-requested-with': 'XMLHttpRequest',
        accept: '*/*',
      },
    });
  } catch (e) {
    return {
      status: 0,
      ms: Math.round(performance.now() - t0),
      body: null,
      netError: e instanceof Error ? e.message : String(e),
    };
  }

  const ms = Math.round(performance.now() - t0);

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no-JSON: normalmente una pagina de bloqueo */
  }

  return { status: res.status, ms, body, netError: null };
}

/**
 * Clasifica por gravedad. Las senales de Instagram van antes que los codigos
 * HTTP: un 429 con feedback_required es mucho mas grave que un 429 solo.
 */
export function classify(r: IgResponse): Signal {
  if (r.netError) return { severity: 'transient', reason: `red: ${r.netError}` };

  const b = r.body as Record<string, unknown> | null;

  if (b) {
    if (b['message'] === 'feedback_required') {
      return { severity: 'hard', reason: 'feedback_required' };
    }
    if (b['require_login'] === true) {
      return { severity: 'auth', reason: 'require_login' };
    }
    if (typeof b['message'] === 'string' && /wait a few minutes/i.test(b['message'])) {
      return { severity: 'soft', reason: 'please_wait_a_few_minutes' };
    }
    if (b['spam'] === true) {
      return { severity: 'soft', reason: 'spam: true' };
    }
  }

  if (r.status === 401 || r.status === 403) {
    return { severity: 'auth', reason: `HTTP ${r.status}` };
  }
  if (r.status === 429) {
    return { severity: 'soft', reason: 'HTTP 429' };
  }
  if (r.status >= 500) {
    return { severity: 'transient', reason: `HTTP ${r.status}` };
  }
  if (!b) {
    return { severity: 'shape', reason: `HTTP ${r.status} sin cuerpo JSON` };
  }
  if (b['status'] === 'fail') {
    return { severity: 'shape', reason: `status=fail :: ${String(b['message'] ?? '—')}` };
  }

  return OK;
}

/** Lee el ds_user_id desde el service worker, donde no existe `document`. */
export async function readUserId(): Promise<string | null> {
  try {
    const c = await chrome.cookies.get({ url: IG_ORIGIN, name: 'ds_user_id' });
    return c?.value ?? null;
  } catch {
    return null;
  }
}
