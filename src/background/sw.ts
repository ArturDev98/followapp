import { recentChanges, relations, summary } from '../lib/snapshots';
import { getMeta, wipe } from '../lib/db';
import {
  ALARM_POLL,
  ALARM_RESUME,
  disable,
  enable,
  getState,
  isBusy,
  setBusy,
  tick,
} from '../lib/scheduler';
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
  broadcast({ kind: 'tick-start', force });

  let result: TickResponse;
  try {
    const r = await tick({
      force,
      onProgress: (progress) => broadcast({ kind: 'progress', progress }),
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

/** Al instalar o al arrancar Chrome, reponer la alarma si estaba activa. */
async function restore(): Promise<void> {
  const s = await getState();
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
      (msg.on ? enable(msg.minutes) : disable()).then((state) => sendResponse({ state }));
      return true;

    case 'wipe':
      wipe()
        .then(() => chrome.alarms.clear(ALARM_RESUME))
        .then(() => sendResponse({ ok: true }));
      return true;

    default:
      return false;
  }
});
