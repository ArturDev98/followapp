/**
 * Envoltorio minimo de IndexedDB, sin dependencias.
 * Funciona dentro del service worker, que es donde corre la captura.
 */

const DB_NAME = 'followapp';
const DB_VERSION = 2;

export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_PROFILES = 'profiles';
export const STORE_META = 'meta';
export const STORE_AVATARS = 'avatars';

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request fallo'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const s = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('takenAt', 'takenAt');
        s.createIndex('kind', 'kind');
      }

      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_AVATARS)) {
        db.createObjectStore(STORE_AVATARS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
  });

  return dbPromise;
}

/**
 * Espera al COMMIT, no solo a la ultima peticion: si no, una escritura puede
 * perderse cuando el service worker se duerme justo despues.
 */
export async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);

  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Transaccion fallida'));
    t.onabort = () => reject(t.error ?? new Error('Transaccion abortada'));
  });

  const result = await fn(t);
  await done;
  return result;
}

export const req = promisify;

/** Lee todos los registros de un store, en orden de clave. */
export async function getAll<T>(store: string): Promise<T[]> {
  return tx([store], 'readonly', (t) => promisify(t.objectStore(store).getAll() as IDBRequest<T[]>));
}

export async function getMeta<T>(key: string): Promise<T | null> {
  return tx([STORE_META], 'readonly', async (t) => {
    const r = await promisify(t.objectStore(STORE_META).get(key) as IDBRequest<{ key: string; value: T } | undefined>);
    return r?.value ?? null;
  });
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await tx([STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_META).put({ key, value });
  });
}

/** Borra todo. Util en desarrollo y para el boton de "empezar de cero". */
export async function wipe(): Promise<void> {
  await tx([STORE_SNAPSHOTS, STORE_PROFILES, STORE_AVATARS, STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_SNAPSHOTS).clear();
    t.objectStore(STORE_PROFILES).clear();
    t.objectStore(STORE_AVATARS).clear();
    t.objectStore(STORE_META).clear();
  });
}
