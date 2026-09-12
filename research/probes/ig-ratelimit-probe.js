/**
 * FollowApp — Probe de rate-limit para captura pasiva de seguidores  (v2)
 * ========================================================================
 *
 * CAMBIOS RESPECTO A v1
 *   - web_profile_info esta capado globalmente (429 a la primera peticion,
 *     tanto desde IP de datacenter como desde sesion real). Se retira.
 *   - Nueva FASE 0: descubrimiento de endpoints. Prueba varios candidatos
 *     para el contador y reporta cual responde y que campos trae.
 *   - Ningun fallo de fase aborta el probe. La FASE 2 (paginacion), que es
 *     el dato que realmente importa, se ejecuta siempre.
 *
 * COMO SE USA
 *   1. Abre https://www.instagram.com/ logueado, en Chrome.
 *   2. F12 -> pestaña "Console".
 *   3. Chrome bloquea el primer pegado: escribe   allow pasting   y Enter.
 *   4. Pega este archivo entero y Enter.
 *   5. Lanza:   await probe()
 *
 * SEGURIDAD
 *   Se detiene AL PRIMER sintoma de throttling en la paginacion.
 *   Cap por defecto: 25 peticiones.
 *   Peor caso realista: "please_wait_a_few_minutes", bloqueo blando de
 *   ~30 min sobre el endpoint, sin consecuencias sobre la cuenta.
 *
 * PERFILES
 *   await probe()                      -> conservador  (25 req, 2500ms)
 *   await probe({ pageSize: 100 })     -> prueba paginas grandes
 *   await probe({ delayMs: 0, maxRequests: 60 })  -> burst, busca el techo duro
 *   await probe({ skipDiscovery: true })          -> salta la FASE 0
 */

const IG_APP_ID = '936619743392459';

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Jitter +/-30% para no generar un patron de intervalos perfectamente regular. */
function jitter(ms) {
  if (!ms) return 0;
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

async function igFetch(url) {
  const t0 = performance.now();
  let res, body = null, netError = null;

  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'x-requested-with': 'XMLHttpRequest',
        'accept': '*/*',
      },
    });
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), body: null, netError: e.message };
  }

  const ms = Math.round(performance.now() - t0);
  try { body = await res.json(); } catch (_) { /* no-JSON = mala señal */ }

  return { status: res.status, ms, body, netError };
}

/**
 * Clasifica la respuesta.
 * Devuelve null si todo va bien, o un string con el motivo de parada.
 */
function detectThrottle(r) {
  const status = r.status;
  const body = r.body;

  if (r.netError)     return 'error de red: ' + r.netError;
  if (status === 429) return 'HTTP 429 (Too Many Requests)';
  if (status === 401) return 'HTTP 401 (sesion invalida o require_login)';
  if (status === 403) return 'HTTP 403 (prohibido / checkpoint)';
  if (status >= 500)  return 'HTTP ' + status + ' (error de servidor)';
  if (!body)          return 'HTTP ' + status + ' con cuerpo no-JSON (posible pagina de bloqueo)';
  if (body.require_login)                   return 'require_login: true';
  if (body.message === 'feedback_required') return 'feedback_required (bloqueo DURO)';
  if (typeof body.message === 'string' && /wait a few minutes/i.test(body.message)) {
    return 'please_wait_a_few_minutes (bloqueo blando ~30min)';
  }
  if (body.status === 'fail') return 'status=fail :: ' + (body.message || '(sin mensaje)');
  if (body.spam) return 'spam: true';
  return null;
}

/** Busca recursivamente el primer campo cuyo nombre matchee, hasta profundidad 3. */
function findField(obj, re, depth) {
  depth = depth === undefined ? 3 : depth;
  if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
  for (const k of Object.keys(obj)) {
    if (re.test(k) && typeof obj[k] === 'number') return obj[k];
  }
  for (const k of Object.keys(obj)) {
    const hit = findField(obj[k], re, depth - 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * FASE 0 — Descubrimiento de endpoints.
 * Prueba candidatos para la "peticion barata" (el contador) y reporta
 * cual responde, con que latencia y que campos de conteo trae.
 */
async function discoverCountEndpoints(userId) {
  const candidates = [
    { name: 'users/{id}/info/',      url: 'https://www.instagram.com/api/v1/users/' + userId + '/info/' },
    { name: 'web_profile_info',      url: 'https://www.instagram.com/api/v1/users/web_profile_info/?username=__UNAME__' },
    { name: 'friendships/.../?count=1', url: 'https://www.instagram.com/api/v1/friendships/' + userId + '/followers/?count=1' },
  ];

  console.log('\n  FASE 0 — descubrimiento de endpoints para el contador');

  const results = [];
  let username = null;

  for (const c of candidates) {
    let url = c.url;
    if (url.indexOf('__UNAME__') !== -1) {
      if (!username) { console.log('    ' + c.name.padEnd(24) + ' SALTADO (sin username todavia)'); continue; }
      url = url.replace('__UNAME__', encodeURIComponent(username));
    }

    const r = await igFetch(url);
    const bad = detectThrottle(r);

    if (bad) {
      console.log('    ' + c.name.padEnd(24) + ' ' + String(r.ms).padStart(5) + 'ms  FALLO: ' + bad);
      results.push({ name: c.name, ok: false, reason: bad, ms: r.ms });
    } else {
      const followers = findField(r.body, /^follower_?count$|^followed_by/i);
      const following = findField(r.body, /^following_?count$|^follows_count$/i);
      if (!username) {
        username = (r.body.user && r.body.user.username) || null;
      }
      const fields = [];
      if (followers !== undefined) fields.push('followers=' + followers);
      if (following !== undefined) fields.push('following=' + following);
      console.log('    ' + c.name.padEnd(24) + ' ' + String(r.ms).padStart(5) + 'ms  OK   ' +
                  (fields.length ? fields.join('  ') : '(sin campos de conteo)'));
      results.push({ name: c.name, ok: true, ms: r.ms, followers, following, username });
    }

    await sleep(jitter(1200));
  }

  const best = results.filter(r => r.ok && r.followers !== undefined)[0] || results.filter(r => r.ok)[0] || null;
  if (best) {
    console.log('    -> mejor candidato: ' + best.name + '  (' + best.ms + 'ms, 1 peticion)');
  } else {
    console.warn('    -> ningun endpoint de contador disponible; sigo igualmente a la FASE 2');
  }
  return { results, best, username };
}

async function probe(opts) {
  opts = opts || {};
  const pageSize      = opts.pageSize      !== undefined ? opts.pageSize      : 50;
  const delayMs       = opts.delayMs       !== undefined ? opts.delayMs       : 2500;
  const maxRequests   = opts.maxRequests   !== undefined ? opts.maxRequests   : 25;
  const skipDiscovery = opts.skipDiscovery !== undefined ? opts.skipDiscovery : false;

  const userId = getCookie('ds_user_id');
  if (!userId) {
    console.error('[FollowApp] No encuentro la cookie ds_user_id. ¿Estas logueado en instagram.com?');
    return;
  }

  console.log('%c[FollowApp] Probe de rate-limit v2', 'font-weight:bold;font-size:14px');
  console.log('  config: pageSize=' + pageSize + '  delay=' + delayMs + 'ms(+/-30%)  cap=' + maxRequests + ' req');
  console.log('  user_id: ' + userId);

  // ---------- FASE 0 ----------
  let discovery = { results: [], best: null, username: null };
  if (!skipDiscovery) {
    try {
      discovery = await discoverCountEndpoints(userId);
    } catch (e) {
      console.warn('  FASE 0 fallo entera (' + e.message + '); sigo a la FASE 2');
    }
  }

  const followerCount = discovery.best ? discovery.best.followers : undefined;
  const uname = discovery.username || '(desconocido)';

  if (followerCount !== undefined) {
    console.log('    enumeracion completa costaria ~' + Math.ceil(followerCount / pageSize) +
                ' peticiones a ' + pageSize + '/pagina');
  }

  // ---------- FASE 2: enumeracion paginada (SIEMPRE se ejecuta) ----------
  console.log('\n  FASE 2 — enumeracion paginada (parada al primer sintoma)');

  const log = [];
  const seen = new Set();
  let maxId = null;
  let stopReason = 'cap alcanzado sin throttling';
  let n = 0;
  let dupes = 0;

  const tStart = performance.now();

  while (n < maxRequests) {
    let url = 'https://www.instagram.com/api/v1/friendships/' + userId + '/followers/?count=' + pageSize;
    if (maxId) url += '&max_id=' + encodeURIComponent(maxId);

    const r = await igFetch(url);
    n++;

    const bad = detectThrottle(r);
    if (bad) {
      stopReason = bad;
      console.warn('    #' + String(n).padStart(2) + ' ' + r.ms + 'ms  >>> PARADA: ' + bad);
      log.push({ req: n, ms: r.ms, users: 0, http: r.status, throttled: true });
      break;
    }

    const users = r.body.users || [];
    for (const u of users) {
      if (seen.has(u.pk)) dupes++;
      seen.add(u.pk);
    }

    // page size REAL devuelto vs pedido: revela el cap del servidor
    const flag = users.length < pageSize ? '  (pedidos ' + pageSize + ', devueltos ' + users.length + ')' : '';
    console.log('    #' + String(n).padStart(2) + ' ' + String(r.ms).padStart(5) + 'ms  +' +
                String(users.length).padStart(3) + ' users  total=' + seen.size + flag);
    log.push({ req: n, ms: r.ms, users: users.length, http: r.status, throttled: false });

    maxId = r.body.next_max_id;
    if (!maxId) {
      stopReason = 'fin de la lista (no hay next_max_id)';
      break;
    }

    if (n < maxRequests) await sleep(jitter(delayMs));
  }

  const elapsed = (performance.now() - tStart) / 1000;

  // ---------- Informe ----------
  const ok  = log.filter(l => !l.throttled);
  const lat = ok.map(l => l.ms).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length * 0.50)] : 0;
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : 0;
  const realPageSize = ok.length ? Math.max.apply(null, ok.map(l => l.users)) : 0;

  console.log('\n%c  INFORME', 'font-weight:bold');
  console.log('    peticiones OK ............ ' + ok.length);
  console.log('    usuarios unicos .......... ' + seen.size + (dupes ? '  (' + dupes + ' duplicados entre paginas)' : ''));
  console.log('    page size real ........... ' + realPageSize + ' (pedido: ' + pageSize + ')');
  console.log('    latencia p50 / p95 ....... ' + p50 + 'ms / ' + p95 + 'ms');
  console.log('    tiempo total ............. ' + elapsed.toFixed(1) + 's');
  console.log('    motivo de parada ......... ' + stopReason);

  if (followerCount && realPageSize) {
    const need = Math.ceil(followerCount / realPageSize);
    const secs = need * (delayMs / 1000) + need * (p50 / 1000);
    console.log('\n    EXTRAPOLACION para @' + uname + ' (' + followerCount + ' seguidores):');
    console.log('      snapshot completo = ' + need + ' peticiones ~= ' + (secs / 60).toFixed(1) + ' min a este ritmo');
    console.log('      estrategia contador: 6 polls/dia = 6 peticiones + enumeracion solo si cambia');
  }

  const result = {
    userId, username: uname, followerCount,
    discovery: discovery.results,
    config: { pageSize, delayMs, maxRequests },
    log, stopReason,
    uniqueUsers: seen.size, realPageSize, p50, p95, elapsed,
  };

  console.log('\n    objeto devuelto -> copy(window.__probe) para exportarlo');
  window.__probe = result;
  return result;
}

/**
 * stress() — Busca el TECHO de peticiones sostenidas.
 * ====================================================
 * probe() no puede encontrarlo en cuentas pequeñas: la lista se agota
 * en pocas paginas. stress() re-enumera la lista COMPLETA en bucle, de
 * cero cada vez, para generar volumen sostenido contra el mismo endpoint
 * y ver en que peticion salta el bloqueo.
 *
 * Vigila ademas la DERIVA DE LATENCIA: un p50 que sube por tramos suele
 * ser el aviso previo al bloqueo duro. Ese es el umbral que de verdad
 * interesa para el diseño, no el 429.
 *
 *   await stress()                        -> 150 peticiones a 800ms
 *   await stress({ maxTotal: 400 })       -> mas profundo
 *   await stress({ delayMs: 300 })        -> mas agresivo
 *
 * AVISO: esta funcion SI busca activamente el bloqueo. Lo esperable es
 * "please_wait_a_few_minutes" (~30 min de bloqueo blando sobre el
 * endpoint). No ejecutes otras pruebas durante ese rato.
 */
async function stress(opts) {
  opts = opts || {};
  const pageSize = opts.pageSize !== undefined ? opts.pageSize : 25;
  const delayMs  = opts.delayMs  !== undefined ? opts.delayMs  : 800;
  const maxTotal = opts.maxTotal !== undefined ? opts.maxTotal : 150;

  const userId = getCookie('ds_user_id');
  if (!userId) { console.error('[FollowApp] falta ds_user_id'); return; }

  console.log('%c[FollowApp] STRESS — busqueda del techo', 'font-weight:bold;font-size:14px;color:#c60');
  console.log('  ' + maxTotal + ' peticiones max, ' + delayMs + 'ms(+/-30%) entre ellas');
  console.log('  re-enumerando la lista completa en bucle\n');

  const lat = [];
  let total = 0, sweeps = 0, maxId = null, stopReason = 'cap alcanzado SIN throttling';
  const tStart = performance.now();

  outer:
  while (total < maxTotal) {
    sweeps++;
    maxId = null;

    while (total < maxTotal) {
      let url = 'https://www.instagram.com/api/v1/friendships/' + userId + '/followers/?count=' + pageSize;
      if (maxId) url += '&max_id=' + encodeURIComponent(maxId);

      const r = await igFetch(url);
      total++;

      const bad = detectThrottle(r);
      if (bad) {
        stopReason = bad;
        console.warn('  >>> PARADA en la peticion #' + total + ' (barrido ' + sweeps + '): ' + bad);
        break outer;
      }

      lat.push(r.ms);

      // informe por tramos de 25, para ver la deriva de latencia
      if (total % 25 === 0) {
        const tramo = lat.slice(-25).sort((a, b) => a - b);
        const med = tramo[Math.floor(tramo.length / 2)];
        const base = lat.slice(0, 10).sort((a, b) => a - b)[5] || med;
        const drift = base ? ((med / base - 1) * 100).toFixed(0) : '0';
        console.log('  #' + String(total).padStart(4) + '  p50 tramo: ' + String(med).padStart(5) +
                    'ms  (deriva vs inicio: ' + (drift >= 0 ? '+' : '') + drift + '%)');
      }

      maxId = r.body.next_max_id;
      if (!maxId) break;                 // fin de lista -> nuevo barrido
      await sleep(jitter(delayMs));
    }

    if (total < maxTotal) await sleep(jitter(delayMs));
  }

  const elapsed = (performance.now() - tStart) / 1000;
  const sorted = lat.slice().sort((a, b) => a - b);
  const first10 = sorted.slice(0, 10);
  const last10  = lat.slice(-10).sort((a, b) => a - b);

  console.log('\n%c  INFORME STRESS', 'font-weight:bold');
  console.log('    peticiones totales ....... ' + total);
  console.log('    barridos completos ....... ' + sweeps);
  console.log('    duracion ................. ' + (elapsed / 60).toFixed(1) + ' min');
  console.log('    ritmo efectivo ........... ' + (total / (elapsed / 60)).toFixed(1) + ' req/min');
  console.log('    p50 primeras 10 .......... ' + (first10[5] || 0) + 'ms');
  console.log('    p50 ultimas 10 ........... ' + (last10[5] || 0) + 'ms');
  console.log('    motivo de parada ......... ' + stopReason);

  const result = { total, sweeps, elapsed, stopReason, latencies: lat,
                   config: { pageSize, delayMs, maxTotal } };
  window.__stress = result;
  console.log('\n    objeto -> copy(window.__stress)');
  return result;
}

console.log('%c[FollowApp] probe v2 cargado.', 'color:#0a0;font-weight:bold');
console.log('  await probe()   -> snapshot + descubrimiento de endpoints');
console.log('  await stress()  -> busca el techo de peticiones (puede provocar bloqueo blando)');
