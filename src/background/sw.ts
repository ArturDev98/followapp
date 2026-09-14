import { recentChanges, relations, summary } from '../lib/snapshots';
import { getMeta, wipe } from '../lib/db';
import {
  ALARM_POLL,
  ALARM_RESUME,
  disable,
  enable,
  getState,
  requireSession,
  tick,
} from '../lib/scheduler';
import { isBusy, setBusy } from '../lib/busy';
import type { Broadcast, HistoryResponse, Msg, ProblemCode, TickResponse } from '../lib/messages';

/** Service worker: host de la captura, el almacenamiento y el scheduler. */

/** El popup escucha esto para pintar el progreso mientras dura la captura. */
function broadcast(b: Broadcast): void {
  // Falla si el popup se cerro; es esperado y no debe romper la captura.
  chrome.runtime.sendMessage(b).catch(() => {});
}

// --------------------------------------------------------------------- tick

/** Marca "ocupado" mientras dura, para que el popup no descargue avatares. */
async function runTick(force: boolean): Promise<TickResponse> {
  // Dos disparos a la vez se pisarian: mismo cursor, peticiones duplicadas.
  if (await isBusy()) {
    return { ran: false, skipped: 'ya hay un disparo en curso', requests: 0, enumerated: [] };
  }

  await setBusy(true);

  let result: TickResponse;
  try {
    const r = await tick({
      force,
      // Lo anuncia el scheduler cuando pasa sus cortes, no antes: sin sesión
      // no hay revisión, y pintar "Revisando…" seria mentir.
      onStart: () => broadcast({ kind: 'tick-start', force }),
      onProgress: (progress) => {
        // Renovar la marca: lo que la hace fiable es que caduca, y caducar a
        // mitad de una captura larga dejaria entrar un segundo disparo.
        void setBusy(true);
        broadcast({ kind: 'progress', progress });
      },
    });
    result = {
      ran: r.ran,
      ...(r.skipped !== undefined ? { skipped: r.skipped } : {}),
      requests: r.requests,
      enumerated: r.enumerated,
      state: r.state,
    };
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) };
  } finally {
    await setBusy(false);
  }

  broadcast({ kind: 'tick-done', result });
  return result;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_POLL && alarm.name !== ALARM_RESUME) return;
  // No se espera al resultado: el listener no puede ser async y el service
  // worker sigue vivo mientras haya fetch en curso.
  void runTick(false);
});

/**
 * Con la vigilancia apagada no pasa nada nunca, y eso no se ve desde fuera.
 * El aviso en el icono lo dice sin necesidad de abrir el popup.
 */
async function syncBadge(enabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: enabled ? '' : '!' });
  if (!enabled) await chrome.action.setBadgeBackgroundColor({ color: '#D6A550' });
}

/** Al instalar o al arrancar Chrome, reponer la alarma si estaba activa. */
async function restore(): Promise<void> {
  // Si el navegador acaba de arrancar no hay ninguna captura en curso: lo que
  // haya quedado marcado es de un worker que murio a medias.
  await setBusy(false);

  const s = await getState();
  await syncBadge(s.enabled);
  if (!s.enabled) return;
  const existing = await chrome.alarms.get(ALARM_POLL);
  if (!existing) await enable();
}

chrome.runtime.onInstalled.addListener(() => void restore());
chrome.runtime.onStartup.addListener(() => void restore());

// ----------------------------------------------------------------- historial

/** Un codigo, no un texto: el idioma lo decide el popup. */
function problemaDe(state: Awaited<ReturnType<typeof getState>>): ProblemCode {
  if (!state.blockedUntil || state.blockedUntil <= Date.now()) return null;

  switch (state.blockedKind) {
    case 'auth':
      return 'no-session';
    case 'hard':
      return 'hard-block';
    case 'soft':
      return 'soft-block';
    default:
      break;
  }

  // Estado escrito por la 1.0.0, que no guardaba la clase: leer el motivo es
  // lo unico que queda. Se cae solo en cuanto caduque esa espera.
  const r = state.blockedReason ?? '';
  if (r.includes('sesión')) return 'no-session';
  if (r.includes('duro')) return 'hard-block';
  return 'soft-block';
}

async function handleHistory(): Promise<HistoryResponse> {
  try {
    const [sumFr, sumFg, changes, rel, state, alarm, username] = await Promise.all([
      summary('followers'),
      summary('following'),
      recentChanges(),
      relations(),
      getState(),
      chrome.alarms.get(ALARM_POLL),
      getMeta<string>('username'),
    ]);

    return {
      ready: sumFr.snapshots > 0,
      username,
      counts: state.lastCounts,
      changes,
      relations: rel,
      summary: { followers: sumFr, following: sumFg },
      state,
      nextPollAt: alarm?.scheduledTime ?? null,
      busy: await isBusy(),
      problem: problemaDe(state),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ mensajes

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  switch (msg.kind) {
    case 'capture':
      runTick(true).then(sendResponse);
      return true;

    case 'history':
      handleHistory().then(sendResponse);
      return true;

    case 'watch':
      (msg.on ? enable(msg.minutes) : disable()).then(async (state) => {
        // Encender sin sesión dejaba el interruptor en verde con una cuenta
        // atrás que no significaba nada. Comprobarlo aquí no cuesta ni una
        // petición, y el popup ya puede explicarlo en el momento.
        const s = msg.on && !(await requireSession()) ? await getState() : state;
        await syncBadge(s.enabled);
        sendResponse({ state: s });
      });
      return true;

    case 'wipe':
      // wipe() vacia tambien el estado del scheduler, pero la alarma sobrevive:
      // sin reponerlo seguiria capturando con el interruptor en apagado.
      void (async () => {
        const antes = await getState();
        await wipe();
        await chrome.alarms.clear(ALARM_RESUME);
        if (antes.enabled) await enable(antes.pollMinutes);
        else await chrome.alarms.clear(ALARM_POLL);
        await syncBadge(antes.enabled);
        sendResponse({ ok: true });
      })();
      return true;

    default:
      return false;
  }
});
