/** Que lista describe un snapshot. Ambas se capturan igual. */
export type SnapshotKind = 'followers' | 'following';

export const KIND_LABEL: Record<SnapshotKind, string> = {
  followers: 'seguidores',
  following: 'seguidos',
};

/**
 * Intervalos del poll de fondo. 4 h es produccion; 2 y 15 min son para probar
 * el scheduler sin esperar, y el popup las marca como tales.
 */
export const POLL_DEFAULT_MINUTES = 240;

export const POLL_CHOICES: { minutes: number; label: string; test?: boolean }[] = [
  { minutes: 2, label: '2 min', test: true },
  { minutes: 15, label: '15 min', test: true },
  { minutes: 60, label: '1 h' },
  { minutes: 240, label: '4 h' },
  { minutes: 720, label: '12 h' },
];

/** Respuesta cruda de una peticion a Instagram. */
export interface IgResponse {
  status: number;
  ms: number;
  body: unknown;
  netError: string | null;
}

/** Los dos contadores, que llegan juntos en una sola peticion. */
export interface Counts {
  followers: number | null;
  following: number | null;
}

/**
 * Perfil minimo. Llega YA dentro de la respuesta de enumeracion, asi que la
 * cache se llena sin gastar una sola peticion extra.
 */
export interface Profile {
  id: string;
  username: string;
  fullName: string | null;
  avatar: string | null;
  /** Cuando se vio por ultima vez en una enumeracion. */
  seenAt: number;
}

/**
 * Una pagina de la enumeracion. El servidor capa en 25 aunque pidas mas.
 * Seguidores y seguidos devuelven exactamente la misma forma.
 */
export interface ListPage {
  ids: string[];
  /** Perfiles de esos mismos ids, gratis. */
  profiles: Omit<Profile, 'seenAt'>[];
  /** next_max_id. `null` significa fin de lista, no error. */
  cursor: string | null;
}

/** Por que termino una captura. */
export type StopReason =
  | 'complete'        // se llego al final de la lista
  | 'budget'          // se agoto el presupuesto de peticiones de esta tanda
  | 'soft-block'      // Instagram pidio esperar; reintentar en ~30 min
  | 'hard-block'      // feedback_required; necesita horas y accion del usuario
  | 'auth'            // la sesion no sirve
  | 'no-adapter'      // ningun endpoint candidato respondio con forma valida
  | 'error';          // fallo irrecuperable de red

export interface CaptureStats {
  requests: number;
  elapsedMs: number;
  p50: number;
  p95: number;
  /** Ritmo final tras las correcciones del gobernador. */
  finalDelayMs: number;
  /** Cuantas veces el gobernador tuvo que frenar. */
  slowdowns: number;
  /** Que adaptador acabo sirviendo la paginacion. */
  adapter: string | null;
  /** Linea base de latencia a heredar en la proxima tanda. */
  nextBaseline: number | null;
}

export interface CaptureResult {
  kind: SnapshotKind;
  /** true solo si se enumero la lista entera. */
  complete: boolean;
  ids: string[];
  profiles: Omit<Profile, 'seenAt'>[];
  /** Si no esta completa, por aqui se reanuda. */
  cursor: string | null;
  stopReason: StopReason;
  /** Texto legible del motivo, para logs y telemetria. */
  detail: string;
  stats: CaptureStats;
}

export interface CaptureProgress {
  kind: SnapshotKind;
  requests: number;
  ids: number;
  /** Estimacion sobre el contador; null si no se pudo leer. */
  total: number | null;
  delayMs: number;
}

/**
 * Snapshot: base (lista completa en `ids`) o delta (solo diferencias).
 * added/removed estan siempre, para que el historial sobreviva al rebase.
 */
export interface SnapshotRecord {
  id?: number;
  takenAt: number;
  kind: SnapshotKind;
  /** false si la enumeracion se troceo y quedo a medias: el diff no es fiable. */
  complete: boolean;
  /**
   * La lista se leyo a lo largo de varios disparos del scheduler. El snapshot
   * es valido, pero pudo cambiar por el camino: el diff arrastra drift.
   */
  chunked?: boolean;
  /** Lista completa solo en registros base. */
  ids: string[] | null;
  /** Cuantos deltas encadenados hay por delante de la ultima base. */
  chainLength: number;
  added: string[];
  removed: string[];
  counts: Counts | null;
}

/** El resultado que ve el usuario. */
export interface Diff {
  kind: SnapshotKind;
  fromId: number | null;
  toId: number;
  from: number | null;
  to: number;
  added: Profile[];
  removed: Profile[];
  /** true si alguno de los dos snapshots comparados quedo troceado. */
  unreliable: boolean;
}

/** Un movimiento concreto: alguien entro o salio, y cuando. */
export interface ChangeEvent {
  /** Cuando se DETECTO, que no es cuando ocurrio. */
  at: number;
  /** Revision anterior: el hecho cae entre `since` y `at`. */
  since: number | null;
  dir: 'in' | 'out';
  profile: Profile;
  /** El snapshot se leyo en varias tandas: pudo cambiar por el camino. */
  unreliable: boolean;
}

/**
 * Cruce entre las dos listas. Es lo que responde a la pregunta que mas se
 * busca en este nicho: quien no te devuelve el follow.
 */
export interface Relations {
  /** Los sigues tu y no te siguen de vuelta. */
  notFollowingBack: Profile[];
  /** Te siguen y tu no les sigues. */
  youDontFollowBack: Profile[];
  mutual: number;
  /** false si falta alguna de las dos listas: el cruce no se puede calcular. */
  ready: boolean;
}
