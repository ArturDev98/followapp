/**
 * Marca de "hay una captura en curso". La leen dos sitios por motivos
 * distintos: el scheduler para no pisar un disparo con otro, y la cache de
 * avatares para no descargar fotos mientras se mide la latencia.
 *
 * Es una hora, no un booleano. Chrome mata el service worker cuando le
 * conviene —y cerrar el navegador lo mata siempre—, asi que el `finally` que
 * la apagaba puede no llegar a correr nunca. Un booleano encendido asi se
 * queda encendido para siempre: el popup dice "Revisando..." eternamente y
 * cada disparo posterior se descarta por "ya hay uno en curso". La extension
 * queda muerta y con cara de estar trabajando, que es la peor forma de morir.
 */

const KEY = 'captureRunning';

/**
 * Sin señales de vida durante este rato, la marca es de un worker muerto.
 * Un disparo gasta 60 peticiones a ~3 s: tres minutos, seis si el gobernador
 * afloja. Diez deja margen de sobra sin dejar la extension clavada un dia.
 */
const RANCIA_MS = 10 * 60 * 1000;

/** Renueva la marca. Se vuelve a llamar en cada página enumerada. */
export async function setBusy(on: boolean): Promise<void> {
  try {
    if (on) await chrome.storage.local.set({ [KEY]: Date.now() });
    else await chrome.storage.local.remove(KEY);
  } catch {
    /* sin storage no hay nada que coordinar */
  }
}

export async function isBusy(): Promise<boolean> {
  let marca: unknown;
  try {
    marca = (await chrome.storage.local.get(KEY))[KEY];
  } catch {
    return false;
  }

  // La 1.0.1 y anteriores guardaban un booleano. Si quedo encendido es
  // justamente el caso que esto arregla, asi que se limpia y se sigue.
  if (typeof marca !== 'number') {
    if (marca === true) await setBusy(false);
    return false;
  }

  if (Date.now() - marca < RANCIA_MS) return true;
  await setBusy(false);
  return false;
}
