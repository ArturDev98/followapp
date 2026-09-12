import { captureList } from '../lib/capture';
import type { CaptureResult } from '../lib/types';

/**
 * PLAN B: el service worker se basta solo desde la S1, esto quedo fuera del
 * manifest. Se conserva compilable por si Instagram endurece las cookies.
 */

function readUserIdFromDocument(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)ds_user_id=([^;]*)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export async function captureFromPage(budget: number): Promise<CaptureResult | { error: string }> {
  const userId = readUserIdFromDocument();
  if (!userId) return { error: 'sin ds_user_id en document.cookie' };
  return captureList(userId, 'followers', { budget });
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if ((msg as { kind?: string })?.kind !== 'capture-from-page') return false;

  const budget = (msg as { budget?: number }).budget ?? 150;
  captureFromPage(budget)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
  return true; // respuesta asincrona
});
