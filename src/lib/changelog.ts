import type { Locale } from './i18n';

/** Lo que ve el usuario al actualizar. La clave es la versión del manifest. */
export interface Novedades {
  title: string;
  items: string[];
}

/** Al publicar una versión, añadir aquí su entrada; sin entrada, no sale aviso. */
export const CHANGELOG: Record<string, { en: Novedades } & Partial<Record<Locale, Novedades>>> = {
  '1.0.7': {
    es: {
      title: 'Novedades',
      items: [
        'Las cuentas grandes ya no releen su lista entera cada hora, y la de seguidos también se mantiene al día',
        'Si Instagram pide esperar a mitad de una revisión, FollowApp espera de verdad en vez de reintentar cada 2 minutos, y sigue donde lo dejó',
        'Cada baja se comprueba: si la cuenta ya no existe, o si en realidad te sigue y la revisión se la saltó, no te decimos que te dejó de seguir',
      ],
    },
    en: {
      title: "What's new",
      items: [
        'Large accounts no longer re-read their whole list every hour, and your following list now stays up to date too',
        'If Instagram asks to wait in the middle of a check, FollowApp now actually waits instead of retrying every 2 minutes, and picks up where it left off',
        "Every unfollow is double-checked: if the account is gone, or it still follows you and the check just missed it, we won't report it as an unfollow",
      ],
    },
  },
};

/** El service worker la deja al actualizar; el popup la borra al enseñarla. */
export const CHANGELOG_PENDING_KEY = 'changelogPending';

/** Solo la versión actual, en el idioma del popup o en inglés. */
export function novedadesDe(version: string, lang: Locale): Novedades | null {
  const e = CHANGELOG[version];
  return e ? (e[lang] ?? e.en) : null;
}
