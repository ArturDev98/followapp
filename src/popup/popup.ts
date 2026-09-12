import type { Broadcast, HistoryResponse, Msg } from '../lib/messages';
import type { Profile, Relations } from '../lib/types';
import { KIND_LABEL, POLL_CHOICES } from '../lib/types';
import { initials, releaseAvatars, resolveAvatar } from '../lib/avatars';
import { LOCALES, initLocale, locale, setLocale, t, type Locale } from '../lib/i18n';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const brand = $<HTMLHeadingElement>('brand');
const handle = $<HTMLSpanElement>('handle');
const nFollowers = $<HTMLElement>('nfollowers');
const nFollowing = $<HTMLElement>('nfollowing');
const paneAct = $<HTMLDivElement>('actividad');
const paneNfb = $<HTMLDivElement>('sincorresponder');
const badgeAct = $<HTMLSpanElement>('n-act');
const badgeNfb = $<HTMLSpanElement>('n-nfb');
const statusEl = $<HTMLSpanElement>('status');
const statusText = $<HTMLSpanElement>('status-text');
const watchEl = $<HTMLInputElement>('watch');
const goBtn = $<HTMLButtonElement>('go');
const bar = $<HTMLElement>('pbar');
const diag = $<HTMLDivElement>('diag');
const loading = $<HTMLDivElement>('loading');
const loadingText = $<HTMLSpanElement>('loading-text');
const loadingN = $<HTMLSpanElement>('loading-n');
const langEl = $<HTMLSelectElement>('lang');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
const panes = [...document.querySelectorAll<HTMLElement>('.pane')];

function ask<T>(msg: Msg): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ------------------------------------------------------------------ tiempo

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('t_now');
  if (m < 60) return t('t_min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('t_hour', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('t_yesterday') : t('t_days', { n: d });
}

function until(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return t('u_now');
  const s = Math.round(ms / 1000);
  if (s < 90) return t('u_sec', { n: s });
  const m = Math.ceil(s / 60);
  return m < 60 ? t('u_min', { n: m }) : t('u_hour', { n: Math.round(m / 60) });
}

/** Agrupa por día natural, que es como la gente recuerda las cosas. */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const hoy = new Date();
  const mismo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return t('d_today');
  if (mismo(d, new Date(hoy.getTime() - 86400000))) return t('d_yesterday');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
}

/** A partir de aquí el hueco entre revisiones deja de ser despreciable. */
const HUECO_MS = 8 * 60 * 60 * 1000;

/** Duración en palabras, para explicar cuánto tiempo estuvimos sin mirar. */
function duracion(ms: number): string {
  const h = Math.round(ms / 3600000);
  return h < 48 ? t('dur_hours', { n: h }) : t('dur_days', { n: Math.round(h / 24) });
}

/** Solo los textos de tiempo, cada segundo: repintar perdería el scroll. */
let ticker: ReturnType<typeof setInterval> | null = null;

function retime(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-ago]')) {
    const ts = Number(el.dataset['ago']);
    if (ts) el.textContent = ago(ts);
  }
  const next = Number(statusText.dataset['until']);
  if (next && !running) statusText.textContent = t('st_next', { t: until(next) });
}

// ---------------------------------------------------------------- pestañas

function showTab(name: string): void {
  for (const t of tabs) {
    const on = t.dataset['tab'] === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }
  for (const p of panes) p.hidden = p.id !== name;
}

for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset['tab'] ?? 'actividad'));

// ------------------------------------------------------------------ gente

function personRow(p: Profile, right: string): string {
  const anon = p.username.startsWith('id:');
  return `
    <div class="person">
      <span class="av" data-id="${esc(p.id)}"${p.avatar ? ` data-url="${esc(p.avatar)}"` : ''}>${esc(
        initials(p.username),
      )}</span>
      <span class="who">
        <span class="u">${anon ? t('unknown_account') : '@' + esc(p.username)}</span>
        ${p.fullName ? `<span class="n">${esc(p.fullName)}</span>` : ''}
      </span>
      ${right}
    </div>`;
}

/** Las fotos entran después; durante una revisión no se descargan. */
async function hydrateAvatars(root: HTMLElement): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>('.av[data-id]')];
  for (let i = 0; i < nodes.length; i += 6) {
    await Promise.all(
      nodes.slice(i, i + 6).map(async (el) => {
        const id = el.dataset['id'];
        if (!id || el.classList.contains('loaded')) return;
        const url = await resolveAvatar(id, el.dataset['url'] ?? null);
        if (!url) return;
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('loaded');
      }),
    );
  }
}

// --------------------------------------------------------------- actividad

function renderActivity(h: HistoryResponse): void {
  const changes = h.changes ?? [];

  if (!h.ready) {
    paneAct.innerHTML = `
      <div class="empty">
        <strong>${t('empty_first_t')}</strong>
        ${t('empty_first_b')}
      </div>`;
    badgeAct.hidden = true;
    return;
  }

  if (changes.length === 0) {
    paneAct.innerHTML = `
      <div class="empty">
        <strong>${t('empty_none_t')}</strong>
        ${t('empty_none_b')}
      </div>`;
    badgeAct.hidden = true;
    return;
  }

  const salidas = changes.filter((c) => c.dir === 'out').length;
  badgeAct.hidden = salidas === 0;
  badgeAct.textContent = String(salidas);

  let html = '';
  let dia = '';
  let tanda = 0;
  let aviso = false;

  for (const c of changes) {
    const d = dayLabel(c.at);
    if (d !== dia) {
      dia = d;
      html += `<p class="day">${esc(d)}</p>`;
    }
    if (c.unreliable) aviso = true;

    // El hueco se avisa una vez por tanda, no en cada persona.
    if (c.at !== tanda) {
      tanda = c.at;
      const hueco = c.since ? c.at - c.since : 0;
      if (hueco > HUECO_MS) {
        html += `<p class="gap">${esc(t('gap_notice', { d: duracion(hueco) }))}</p>`;
      }
    }

    html += personRow(
      c.profile,
      `<span class="what ${c.dir}">
         <b>${c.dir === 'out' ? t('ev_out') : t('ev_in')}</b>
         <span class="t" data-ago="${c.at}">${ago(c.at)}</span>
       </span>`,
    );
  }

  paneAct.innerHTML =
    (aviso ? `<p class="notice">${esc(t('chunked_notice'))}</p>` : '') +
    html;
}

// --------------------------------------------------------- sin corresponder

function renderRelations(r: Relations | undefined): void {
  if (!r?.ready) {
    paneNfb.innerHTML = `
      <div class="empty">
        <strong>${t('empty_cross_t')}</strong>
        ${t('empty_cross_b')}
      </div>`;
    badgeNfb.hidden = true;
    return;
  }

  const gente = r.notFollowingBack;
  badgeNfb.hidden = gente.length === 0;
  badgeNfb.textContent = String(gente.length);

  paneNfb.innerHTML =
    gente.length === 0
      ? `<div class="empty">
           <strong>${t('empty_mutual_t')}</strong>
           ${t('empty_mutual_b')}
         </div>`
      : `<p class="day">${esc(t('cross_header', { n: gente.length }))}</p>` +
        gente.map((p) => personRow(p, '')).join('');
}

// -------------------------------------------------------------------- pie

const PROBLEM = {
  'no-session': 'p_no_session',
  'hard-block': 'p_hard',
  'soft-block': 'p_soft',
} as const;

let running = false;

function renderStatus(h: HistoryResponse): void {
  watchEl.checked = Boolean(h.state?.enabled);

  if (h.problem) {
    statusEl.className = 'status';
    delete statusText.dataset['until'];
    statusText.textContent = t(PROBLEM[h.problem]);
    return;
  }

  if (h.busy || running) {
    statusEl.className = 'status run';
    statusText.textContent = t('st_scanning');
    return;
  }

  if (h.state?.enabled && h.nextPollAt) {
    statusEl.className = 'status on';
    statusText.dataset['until'] = String(h.nextPollAt);
    statusText.textContent = t('st_next', { t: until(h.nextPollAt) });
    return;
  }

  const last = h.summary?.followers.lastAt ?? null;
  statusEl.className = 'status';
  delete statusText.dataset['until'];
  statusText.textContent = last ? t('st_last', { t: ago(last) }) : t('st_never');
}

// ------------------------------------------------------------ diagnóstico

let diagOn = false;
let golpes = 0;

/** Tres clics en el nombre revelan el diagnóstico. No estorba a nadie más. */
brand.addEventListener('click', () => {
  if (++golpes < 3) return;
  golpes = 0;
  diagOn = !diagOn;
  diag.hidden = !diagOn;
  void refresh();
});

function renderDiag(h: HistoryResponse): void {
  const s = h.state;
  if (!diagOn || !s) return;

  const rows = [
    `<dt>seguidores</dt><dd>${h.summary?.followers.snapshots ?? 0} snap · ${
      h.summary?.followers.bases ?? 0
    } base</dd>`,
    `<dt>seguidos</dt><dd>${h.summary?.following.snapshots ?? 0} snap · ${
      h.summary?.following.bases ?? 0
    } base</dd>`,
  ];
  if (s.baseline) rows.push(`<dt>${esc(t('diag_baseline'))}</dt><dd>${s.baseline} ms</dd>`);
  if (s.pending) {
    rows.push(
      `<dt>a medias</dt><dd>${esc(KIND_LABEL[s.pending.kind])} · ${s.pending.ids.length} en ${
        s.pending.chunks
      } tandas</dd>`,
    );
  }
  if (s.blockedUntil && s.blockedUntil > Date.now()) {
    rows.push(`<dt>en espera</dt><dd>${esc(s.blockedReason ?? '')}</dd>`);
  }

  const log = s.log
    .slice(0, 8)
    .map(
      (e) =>
        `<div class="logline l-${e.level}"><span class="t" data-ago="${e.at}">${ago(
          e.at,
        )}</span><span>${esc(e.text)}</span></div>`,
    )
    .join('');

  diag.innerHTML = `
    <dl>${rows.join('')}</dl>
    <div class="row">
      <span>${esc(t('diag_interval'))}</span>
      <select id="every">
        ${POLL_CHOICES.map(
          (c) =>
            `<option value="${c.minutes}"${c.minutes === s.pollMinutes ? ' selected' : ''}>${
              c.label
            }${c.test ? t('test_suffix') : ''}</option>`,
        ).join('')}
      </select>
      <button type="button" id="wipe">${esc(t('diag_wipe'))}</button>
    </div>
    ${log ? `<div class="log">${log}</div>` : ''}`;

  $<HTMLSelectElement>('every').addEventListener('change', (e) => {
    const minutes = Number((e.target as HTMLSelectElement).value);
    if (watchEl.checked) void setWatch(true, minutes);
  });

  $<HTMLButtonElement>('wipe').addEventListener('click', async () => {
    if (!confirm(t('diag_wipe_ask'))) return;
    await ask({ kind: 'wipe' });
    await refresh();
  });
}

// --------------------------------------------------------------- refresco

async function refresh(): Promise<void> {
  const h = await ask<HistoryResponse>({ kind: 'history' });
  if (h.error) {
    statusEl.className = 'status';
    statusText.textContent = t('st_error');
    return;
  }

  handle.textContent = h.username ? `@${h.username}` : '—';
  nFollowers.textContent = String(h.counts?.followers ?? h.summary?.followers.lastCount ?? '—');
  nFollowing.textContent = String(h.counts?.following ?? h.summary?.following.lastCount ?? '—');

  renderActivity(h);
  renderRelations(h.relations);
  renderStatus(h);
  renderDiag(h);

  goBtn.disabled = Boolean(h.busy);
  loading.hidden = !h.busy && !running;
  if (ticker === null) ticker = setInterval(retime, 1000);

  void hydrateAvatars(document.body);
}

async function setWatch(on: boolean, minutes?: number): Promise<void> {
  watchEl.disabled = true;
  await ask({ kind: 'watch', on, ...(minutes !== undefined ? { minutes } : {}) });
  watchEl.disabled = false;
  await refresh();
}

/** Etiquetas fijas del HTML. Se reaplican al cambiar de idioma. */
function applyLabels(): void {
  $('l-followers').textContent = t('followers');
  $('l-following').textContent = t('following');
  $('l-tab-act').textContent = t('tab_activity');
  $('l-tab-nfb').textContent = t('tab_notback');
  $('l-auto').textContent = t('auto');
  goBtn.textContent = t('review');
  langEl.innerHTML = LOCALES.map(
    (l) => `<option value="${l.code}"${l.code === locale() ? ' selected' : ''}>${l.label}</option>`,
  ).join('');
}

langEl.addEventListener('change', async () => {
  await setLocale(langEl.value as Locale);
  applyLabels();
  await refresh();
});

watchEl.addEventListener('change', () => void setWatch(watchEl.checked));
goBtn.addEventListener('click', () => void ask({ kind: 'capture' }).catch(() => {}));

// ---------------------------------------------------------------- avisos

chrome.runtime.onMessage.addListener((m: unknown) => {
  const b = m as Broadcast;
  if (!b?.kind) return;

  switch (b.kind) {
    case 'tick-start':
      running = true;
      goBtn.disabled = true;
      statusEl.className = 'status run';
      statusText.textContent = t('st_scanning');
      loadingText.textContent = t('scan_followers');
      loadingN.textContent = '';
      loading.hidden = false;
      bar.style.width = '2%';
      break;

    case 'progress': {
      const p = b.progress;
      loadingText.textContent = p.kind === 'followers' ? t('scan_followers') : t('scan_following');
      loadingN.textContent = p.total ? `${p.ids} / ${p.total}` : String(p.ids);
      if (p.total) bar.style.width = `${Math.max(2, Math.min(100, (p.ids / p.total) * 100))}%`;
      break;
    }

    case 'tick-done':
      running = false;
      loading.hidden = true;
      bar.style.width = '100%';
      setTimeout(() => (bar.style.width = '0'), 400);
      void refresh();
      break;
  }
});

window.addEventListener('pagehide', () => {
  if (ticker !== null) clearInterval(ticker);
  releaseAvatars();
});

void (async () => {
  await initLocale();
  applyLabels();
  await refresh();
})();
