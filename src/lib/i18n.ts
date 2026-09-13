/**
 * Traducción con selector propio.
 * `_locales` de Chrome sigue el idioma del navegador y no deja elegirlo.
 */

export const LOCALES = [
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'en', label: 'EN', name: 'English' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

const es = {
  followers: 'seguidores',
  following: 'seguidos',

  tab_activity: 'Actividad',
  tab_notback: 'No te siguen',

  welcome_t: 'Vamos a ver quién te deja de seguir',
  welcome_b: 'FollowApp revisa tus seguidores cada pocas horas y te avisa de quién entra y quién se va. Todo se queda en este navegador.',
  welcome_go: 'Empezar a vigilar',
  welcome_note: 'La primera revisión solo guarda una copia de tu lista: es con la que se compararán las siguientes.',

  empty_first_t: 'Todavía no hay nada que comparar',
  empty_first_b: 'La primera revisión guarda una copia de tus seguidores. Desde la siguiente verás quién entra y quién se va.',
  empty_none_t: 'Sin movimientos',
  empty_none_b: 'Nadie ha entrado ni se ha ido desde que empezamos a mirar.',
  empty_cross_t: 'Aún no se puede cruzar',
  empty_cross_b: 'Hace falta una revisión completa para comparar tus dos listas.',
  empty_mutual_t: 'Todo recíproco',
  empty_mutual_b: 'Todas las cuentas que sigues te siguen de vuelta.',

  ev_out: 'Te dejó de seguir',
  ev_in: 'Te siguió',
  unknown_account: 'Cuenta desconocida',
  cross_header: 'Les sigues y no te siguen · {n}',

  scan_followers: 'Revisando tus seguidores…',
  scan_following: 'Revisando a quién sigues…',

  gap_notice: 'Sin revisar durante {d}: pudo ocurrir en cualquier momento de ese rato.',
  chunked_notice: 'Alguna revisión se hizo por partes: puede faltar o sobrar alguien.',

  st_scanning: 'Revisando…',
  st_next: 'Próxima {t}',
  st_last: 'Revisado {t}',
  st_never: 'Sin revisar todavía',
  st_paused: 'Vigilancia apagada',
  st_wait: 'En pausa · se reintenta {t}',
  st_error: 'No se pudo leer el historial.',

  auto: 'Automático',
  review: 'Revisar',

  p_no_session: 'Inicia sesión en Instagram para seguir revisando.',
  p_hard: 'Instagram pidió una pausa larga. Abre su app y vuelve más tarde.',
  p_soft: 'Instagram pidió esperar un rato. Se reintenta solo.',
  p_stuck: 'Llevamos más de un día intentando leer tu lista sin conseguirlo.',
  alert_copy: 'Copiar diagnóstico',
  alert_hint: 'Pégaselo a quien te pasó la extensión: cuenta qué está fallando, sin nombres de cuentas.',

  t_now: 'ahora mismo',
  t_min: 'hace {n} min',
  t_hour: 'hace {n} h',
  t_yesterday: 'ayer',
  t_days: 'hace {n} días',

  u_now: 'ahora',
  u_sec: 'en {n} s',
  u_min: 'en {n} min',
  u_hour: 'en {n} h',

  d_today: 'Hoy',
  d_yesterday: 'Ayer',

  dur_hours: '{n} h',
  dur_days: '{n} días',

  diag_interval: 'intervalo',
  diag_copy: 'copiar diagnóstico',
  diag_copied: 'copiado ✓',
  diag_copy_fail: 'no se pudo copiar',
  diag_privacy: 'Sin nombres de cuentas ni identificadores.',
  diag_wipe: 'borrar historial',
  diag_wipe_ask: '¿Borrar todo el historial guardado?',
  diag_baseline: 'latencia base',
  diag_pending: 'a medias',
  diag_waiting: 'en espera',
  diag_snaps: '{n} snap · {b} base',
  diag_chunks: '{n} en {c} tandas',
  test_suffix: ' · prueba',
  language: 'idioma',
} as const;

type Catalog = Record<keyof typeof es, string>;

const en: Catalog = {
  followers: 'followers',
  following: 'following',

  tab_activity: 'Activity',
  tab_notback: "Don't follow back",

  welcome_t: "Let's find out who unfollows you",
  welcome_b: 'FollowApp checks your followers every few hours and tells you who comes and goes. Everything stays in this browser.',
  welcome_go: 'Start watching',
  welcome_note: 'The first check only saves a snapshot of your list: that is what the next ones compare against.',

  empty_first_t: 'Nothing to compare yet',
  empty_first_b: 'The first check saves a snapshot of your followers. From the next one you will see who comes and goes.',
  empty_none_t: 'No changes',
  empty_none_b: 'Nobody has joined or left since we started watching.',
  empty_cross_t: "Can't compare yet",
  empty_cross_b: 'A full check is needed to compare your two lists.',
  empty_mutual_t: 'All mutual',
  empty_mutual_b: 'Every account you follow follows you back.',

  ev_out: 'Unfollowed you',
  ev_in: 'Followed you',
  unknown_account: 'Unknown account',
  cross_header: "You follow them, they don't follow back · {n}",

  scan_followers: 'Checking your followers…',
  scan_following: 'Checking who you follow…',

  gap_notice: 'Not checked for {d}: it could have happened any time in between.',
  chunked_notice: 'One check ran in parts: someone may be missing or extra.',

  st_scanning: 'Checking…',
  st_next: 'Next {t}',
  st_last: 'Checked {t}',
  st_never: 'Not checked yet',
  st_paused: 'Watching is off',
  st_wait: 'Paused · retrying {t}',
  st_error: "Couldn't read the history.",

  auto: 'Automatic',
  review: 'Check now',

  p_no_session: 'Sign in to Instagram to keep checking.',
  p_hard: 'Instagram asked for a long pause. Open their app and come back later.',
  p_soft: 'Instagram asked us to wait. It will retry on its own.',
  p_stuck: "We've been trying to read your list for over a day without success.",
  alert_copy: 'Copy diagnostics',
  alert_hint: 'Paste it to whoever sent you the extension: it says what is failing, with no account names.',

  t_now: 'just now',
  t_min: '{n} min ago',
  t_hour: '{n} h ago',
  t_yesterday: 'yesterday',
  t_days: '{n} days ago',

  u_now: 'now',
  u_sec: 'in {n} s',
  u_min: 'in {n} min',
  u_hour: 'in {n} h',

  d_today: 'Today',
  d_yesterday: 'Yesterday',

  dur_hours: '{n} h',
  dur_days: '{n} days',

  diag_interval: 'interval',
  diag_copy: 'copy diagnostics',
  diag_copied: 'copied ✓',
  diag_copy_fail: "couldn't copy",
  diag_privacy: 'No account names or identifiers.',
  diag_wipe: 'wipe history',
  diag_wipe_ask: 'Delete all saved history?',
  diag_baseline: 'latency baseline',
  diag_pending: 'partial',
  diag_waiting: 'waiting',
  diag_snaps: '{n} snap · {b} base',
  diag_chunks: '{n} in {c} runs',
  test_suffix: ' · test',
  language: 'language',
};

const CATALOGS: Record<Locale, Catalog> = { es, en };
const KEY = 'locale';

let actual: Locale = 'es';

export function locale(): Locale {
  return actual;
}

/** Preferencia guardada; si no hay, la del navegador; si no, español. */
export async function initLocale(): Promise<Locale> {
  try {
    const r = await chrome.storage.local.get(KEY);
    const guardado = r[KEY];
    if (guardado === 'es' || guardado === 'en') {
      actual = guardado;
      return actual;
    }
  } catch {
    /* sin storage: seguimos con la deteccion */
  }
  actual = chrome.i18n.getUILanguage().toLowerCase().startsWith('es') ? 'es' : 'en';
  return actual;
}

export async function setLocale(l: Locale): Promise<void> {
  actual = l;
  await chrome.storage.local.set({ [KEY]: l });
}

export function t(key: keyof Catalog, vars?: Record<string, string | number>): string {
  let s: string = CATALOGS[actual][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
