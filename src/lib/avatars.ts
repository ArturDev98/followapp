import { STORE_AVATARS, req, tx } from './db';

/**
 * Cache de fotos en BYTES: las URLs de fbcdn caducan en horas y no se dejan
 * incrustar desde chrome-extension://. Solo para quien se va a mostrar.
 */

interface AvatarRecord {
  id: string;
  blob: Blob;
  storedAt: number;
}

/** Object URLs vivos, para revocarlos al cerrar el popup. */
const live = new Set<string>();

async function captureRunning(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get('captureRunning');
    return r['captureRunning'] === true;
  } catch {
    return false;
  }
}

async function readCached(id: string): Promise<Blob | null> {
  const r = await tx([STORE_AVATARS], 'readonly', (t) =>
    req(t.objectStore(STORE_AVATARS).get(id) as IDBRequest<AvatarRecord | undefined>),
  );
  return r?.blob ?? null;
}

async function writeCached(id: string, blob: Blob): Promise<void> {
  await tx([STORE_AVATARS], 'readwrite', (t) => {
    t.objectStore(STORE_AVATARS).put({ id, blob, storedAt: Date.now() } satisfies AvatarRecord);
  });
}

/** Object URL para un <img>, o null si no hay foto (el llamante pone iniciales). */
export async function resolveAvatar(id: string, url: string | null): Promise<string | null> {
  try {
    let blob = await readCached(id);

    if (!blob) {
      if (!url) return null;

      // Durante una captura no se descarga: inflaria la latencia que mide el
      // gobernador. La cache sigue sirviendo; el resto se resuelve al terminar.
      if (await captureRunning()) return null;

      const res = await fetch(url);
      if (!res.ok) return null;
      blob = await res.blob();
      if (blob.size === 0) return null;
      await writeCached(id, blob);
    }

    const objUrl = URL.createObjectURL(blob);
    live.add(objUrl);
    return objUrl;
  } catch {
    return null;
  }
}

/** Libera los object URLs creados. El popup lo llama al descargarse. */
export function releaseAvatars(): void {
  for (const u of live) URL.revokeObjectURL(u);
  live.clear();
}

/** Iniciales para cuando no hay foto. Determinista y sin peticiones. */
export function initials(username: string): string {
  const clean = username.replace(/^id:/, '').replace(/[^a-zA-Z0-9]/g, '');
  return (clean.slice(0, 2) || '??').toUpperCase();
}
