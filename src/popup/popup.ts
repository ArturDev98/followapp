import type { Broadcast, HistoryResponse, Msg } from '../lib/messages';
import type { ChangeEvent, Profile, Relations } from '../lib/types';
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
const alertEl = $<HTMLDivElement>('alert');
const alertText = $<HTMLParagraphElement>('alert-text');
const alertCopy = $<HTMLButtonElement>('alert-copy');
const alertHint = $<HTMLParagraphElement>('alert-hint');
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
  if (next && !running) statusText.textContent = t(claveCuenta(), { t: until(next) });
}

type ClaveCuenta = 'st_next' | 'st_wait' | 'st_floor';

/** La cuenta atrás del pie puede ir hacia la próxima revisión, hacia el final
 *  de una espera o hacia la próxima lectura. El ticker necesita saber cuál. */
function claveCuenta(): ClaveCuenta {
  const k = statusText.dataset['untilKey'];
  return k === 'st_wait' || k === 'st_floor' ? k : 'st_next';
}

function cuentaAtras(ts: number, clave: ClaveCuenta): void {
  statusText.dataset['until'] = String(ts);
  statusText.dataset['untilKey'] = clave;
  statusText.textContent = t(clave, { t: until(ts) });
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

  // Sin username no hay perfil que abrir: Instagram no enruta por id.
  const nombre = anon
    ? `<span class="u">${t('unknown_account')}</span>`
    : `<a class="u" href="https://www.instagram.com/${encodeURIComponent(p.username)}/" target="_blank" rel="noopener noreferrer" title="${esc(t('open_profile'))}">@${esc(p.username)}</a>`;

  return `
    <div class="person">
      <span class="av" data-id="${esc(p.id)}"${p.avatar ? ` data-url="${esc(p.avatar)}"` : ''}>${esc(
        initials(p.username),
      )}</span>
      <span class="who">
        ${nombre}
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

/** Nunca se encendio y nunca se capturo: no hay nada que contar todavia. */
function sinEstrenar(h: HistoryResponse): boolean {
  return !h.state?.enabled && (h.summary?.followers.snapshots ?? 0) === 0;
}

function renderWelcome(): void {
  paneAct.innerHTML = `
    <div class="welcome">
      <strong>${esc(t('welcome_t'))}</strong>
      <p>${esc(t('welcome_b'))}</p>
      <button class="go" type="button" id="start">${esc(t('welcome_go'))}</button>
      <p class="fine">${esc(t('welcome_note'))}</p>
    </div>`;
  badgeAct.hidden = true;

  $<HTMLButtonElement>('start').addEventListener('click', async (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    await setWatch(true);
    // Sin esto la primera revision esperaria al primer disparo de la alarma.
    void ask({ kind: 'capture' }).catch(() => {});
  });
}

/** Qué pasó con esta persona: la racha manda sobre el movimiento suelto. */
function whatCell(c: ChangeEvent): string {
  const clase = c.cycle ? 'cycle' : c.verdict === 'gone' ? 'gone' : c.dir;
  const texto = c.cycle
    ? t('ev_cycle', { n: c.cycle.times })
    : c.dir === 'in'
      ? t('ev_in')
      : c.verdict === 'gone'
        ? t('ev_gone')
        : t('ev_out');

  // Solo se marca lo que se intentó comprobar y no se pudo, no lo antiguo.
  const duda = !c.cycle && c.dir === 'out' && c.verdict === 'unknown';

  return `<span class="what ${clase}">
         <b>${esc(texto)}</b>
         ${duda ? `<span class="q">${esc(t('ev_unconfirmed'))}</span>` : ''}
         <span class="t" data-ago="${c.at}">${ago(c.at)}</span>
       </span>`;
}

function renderActivity(h: HistoryResponse): void {
  const changes = h.changes ?? [];

  if (sinEstrenar(h)) {
    renderWelcome();
    return;
  }

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

  // Una cuenta que ya no existe no es una baja: contarla asustaría por nada.
  const salidas = changes.filter((c) => c.dir === 'out' && c.verdict !== 'gone').length;
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

    html += personRow(c.profile, whatCell(c));
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
        // El límite se explica una vez, donde la gente pregunta por él.
        `<p class="gap">${esc(t('cross_hint'))}</p>` +
        gente.map((p) => personRow(p, '')).join('');
}

// -------------------------------------------------------------------- pie

const PROBLEM = {
  'no-session': 'p_no_session',
  'hard-block': 'p_hard',
  'soft-block': 'p_soft',
} as const;

let running = false;

/**
 * Cuándo se vuelve a leer la lista, si el último disparo no la leyó porque el
 * suelo no había pasado. Sin esto, pulsar «Revisar» parece no hacer nada.
 */
let releeA: number | null = null;

/** Último historial pintado: el botón de copiar lo necesita al pulsarlo. */
let ultimo: HistoryResponse | null = null;

/**
 * Vigilando desde hace más de un día y ni un solo snapshot: está rota en
 * silencio, que es el fallo del que nadie se entera. La entrada más vieja de
 * la bitácora dice desde cuándo lo intentamos, sin guardar un campo nuevo.
 */
function atascada(h: HistoryResponse): boolean {
  if (!h.state?.enabled || (h.summary?.followers.snapshots ?? 0) > 0) return false;
  const primera = h.state.log.at(-1);
  return Boolean(primera && Date.now() - primera.at > 24 * 60 * 60 * 1000);
}

/** La franja dice qué pasa; el pie, cuándo se reintenta. Sin solaparse. */
function renderAlert(h: HistoryResponse): void {
  const motivo = h.problem ? PROBLEM[h.problem] : atascada(h) ? 'p_stuck' : null;
  alertEl.hidden = motivo === null;
  if (!motivo) return;

  alertText.textContent = t(motivo);
  alertCopy.textContent = t('alert_copy');
  alertHint.textContent = t('alert_hint');
}

alertCopy.addEventListener('click', async () => {
  if (!ultimo) return;
  alertCopy.textContent = (await copiar(diagText(ultimo))) ? t('diag_copied') : t('diag_copy_fail');
  setTimeout(() => (alertCopy.textContent = t('alert_copy')), 1800);
});

function renderStatus(h: HistoryResponse): void {
  watchEl.checked = Boolean(h.state?.enabled);

  if (h.busy || running) {
    statusEl.className = 'status run';
    delete statusText.dataset['until'];
    statusText.textContent = t('st_scanning');
    return;
  }

  // Durante una espera la alarma sigue sonando, pero cada disparo se salta.
  // Anunciar la próxima revisión aquí prometería algo que no va a ocurrir; lo
  // que falta saber es cuándo se reintenta. El qué lo cuenta la franja.
  const espera = h.state?.blockedUntil ?? 0;
  if (espera > Date.now()) {
    statusEl.className = 'status off';
    cuentaAtras(espera, 'st_wait');
    return;
  }

  // Un disparo que solo miró el contador no cambia la lista, y callarlo deja
  // al usuario creyendo que el botón está roto.
  if (releeA && releeA > Date.now()) {
    statusEl.className = 'status on';
    cuentaAtras(releeA, 'st_floor');
    return;
  }

  if (h.state?.enabled && h.nextPollAt) {
    statusEl.className = 'status on';
    cuentaAtras(h.nextPollAt, 'st_next');
    return;
  }

  const last = h.summary?.followers.lastAt ?? null;
  delete statusText.dataset['until'];
  delete statusText.dataset['untilKey'];

  // Apagada con historial detras es un aviso: ese historial se esta quedando viejo.
  statusEl.className = last && !h.state?.enabled ? 'status off' : 'status';
  if (!h.state?.enabled) {
    statusText.textContent = last ? t('st_paused') : t('st_never');
    return;
  }
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

/**
 * Bloque pegable con el que un tester puede contar qué le pasa. No hay
 * servidores ni telemetría: lo manda el usuario, a mano, si quiere.
 */
function diagText(h: HistoryResponse): string {
  const s = h.state;
  const ua = navigator.userAgent;
  const chromeV = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '?';
  const so = /\(([^;)]+)/.exec(ua)?.[1]?.trim() ?? '?';
  const cuando = (ts: number): string =>
    new Date(ts).toLocaleString(locale(), {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const L = [
    `FollowApp ${chrome.runtime.getManifest().version} · ${locale()} · Chrome ${chromeV} · ${so}`,
    `vigilancia: ${s?.enabled ? `activa, poll cada ${s.pollMinutes} min` : 'apagada'}`,
  ];
  if (h.nextPollAt) L.push(`próximo poll: ${cuando(h.nextPollAt)}`);
  L.push(
    `contadores: ${h.counts?.followers ?? '—'} seguidores · ${h.counts?.following ?? '—'} seguidos`,
  );

  for (const k of ['followers', 'following'] as const) {
    const x = h.summary?.[k];
    if (!x) continue;
    L.push(
      `${KIND_LABEL[k]}: ${x.snapshots} snapshots · ${x.bases} base · última ${
        x.lastAt ? cuando(x.lastAt) : '—'
      }`,
    );
  }

  // Cuantas bajas resultaron no serlo: es el numero que la semana de pruebas
  // no puede sacar de ningun otro sitio.
  const bajas = (h.changes ?? []).filter((c) => c.dir === 'out');
  if (bajas.length) {
    const fuera = bajas.filter((c) => c.verdict === 'gone').length;
    const dudosas = bajas.filter((c) => c.verdict === 'unknown').length;
    L.push(`bajas: ${bajas.length} · ${fuera} ya no existían · ${dudosas} sin confirmar`);
  }
  const rachas = (h.changes ?? []).filter((c) => c.cycle).length;
  if (rachas) L.push(`rachas de ir y venir: ${rachas}`);

  if (s?.baseline) L.push(`latencia base: ${s.baseline} ms`);
  if (s?.pending) {
    L.push(
      `a medias: ${KIND_LABEL[s.pending.kind]} · ${s.pending.ids.length} ids en ${
        s.pending.chunks
      } tandas`,
    );
  }
  if (s?.blockedUntil && s.blockedUntil > Date.now()) {
    L.push(`en espera hasta ${cuando(s.blockedUntil)} · ${s.blockedReason ?? ''}`);
  }
  if (s?.countsDown) {
    L.push(
      `contador: caído desde ${cuando(s.countsDown.since)} · ${s.countsDown.reason} · ` +
        `se reprueba ${cuando(s.countsDown.until)} (vez ${s.countsDown.streak})`,
    );
  }
  if (h.problem) L.push(`problema: ${h.problem}`);

  if (s?.log.length) {
    L.push('bitácora:');
    for (const e of s.log.slice(0, 20)) L.push(`  ${cuando(e.at)} [${e.level}] ${e.text}`);
  }

  return L.join('\n');
}

/** El popup no siempre tiene foco; execCommand aguanta donde la API falla. */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

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
      <button type="button" class="copy" id="copy">${esc(t('diag_copy'))}</button>
      <button type="button" id="wipe">${esc(t('diag_wipe'))}</button>
    </div>
    <p class="fine">${esc(t('diag_privacy'))}</p>
    ${log ? `<div class="log">${log}</div>` : ''}`;

  $<HTMLButtonElement>('copy').addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.textContent = (await copiar(diagText(h))) ? t('diag_copied') : t('diag_copy_fail');
    setTimeout(() => (b.textContent = t('diag_copy')), 1800);
  });

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

  ultimo = h;
  handle.textContent = h.username ? `@${h.username}` : '—';
  nFollowers.textContent = String(h.counts?.followers ?? h.summary?.followers.lastCount ?? '—');
  nFollowing.textContent = String(h.counts?.following ?? h.summary?.following.lastCount ?? '—');

  renderActivity(h);
  renderRelations(h.relations);
  renderAlert(h);
  renderStatus(h);
  renderDiag(h);

  // Insistir mientras Instagram pide calma es justo lo que no hay que hacer.
  // Sin sesión, en cambio, reintentar no cuesta ni una petición.
  goBtn.disabled =
    Boolean(h.busy) || h.problem === 'soft-block' || h.problem === 'hard-block';
  loading.hidden = !h.busy && !running;
  // El popup pudo abrirse a mitad de una captura: sin tick-start no hubo
  // etiqueta, y la franja salia con el aspa girando y sin decir nada.
  if (!loading.hidden && !loadingText.textContent) loadingText.textContent = t('st_scanning');
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

    case 'tick-done': {
      // Solo cuando no se leyó ninguna lista: si alguna se leyó, el cambio ya
      // se ve arriba y el pie hace mejor trabajo contando la próxima revisión.
      const espera = b.result.postponed ?? [];
      const leyo = (b.result.enumerated ?? []).length > 0;
      releeA = !leyo && espera.length
        ? Date.now() + Math.min(...espera.map((x) => x.minutes)) * 60000
        : null;

      // Sin tick-start no hubo revisión: no hay barra que cerrar.
      if (running) {
        bar.style.width = '100%';
        setTimeout(() => (bar.style.width = '0'), 400);
      }
      running = false;
      loading.hidden = true;
      void refresh();
      break;
    }
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
