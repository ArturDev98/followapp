/**
 * FollowApp — Rastrear a una persona por todo el historial
 * =========================================================
 *
 * PARA QUE SIRVE
 *   Cuando alguien aparece como alta o baja y no cuadra con la realidad, esto
 *   dice si estuvo presente en cada snapshot. El patron delata la causa:
 *
 *      present · present · present · AUSENTE · present
 *                                    ^^^^^^^
 *     Un hueco en medio = se colo por la grieta de la paginacion. El cursor
 *     next_max_id no es una foto estable: si la lista se reordena entre dos
 *     peticiones (y seguir a alguien la reordena), quien estuviera en la
 *     frontera puede no salir en ninguna de las dos paginas. No le seguiste
 *     entonces: le perdimos de vista y luego le reencontramos.
 *
 *     ausente · ausente · ausente · present
 *     Alta de verdad. Le empezaste a seguir.
 *
 * COMO SE USA
 *   1. Abre el popup de FollowApp.
 *   2. Clic derecho sobre el popup -> Inspeccionar.
 *   3. En la consola que se abre, escribe   allow pasting   y Enter.
 *   4. Pega este archivo y Enter.
 *   5. Lanza:   await quien('cordonlindado')
 *
 *   Sin argumento lista un resumen de todo:   await quien()
 */

async function abrirDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('followapp');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function leerTodo(db, store) {
  return new Promise((resolve, reject) => {
    const q = db.transaction(store, 'readonly').objectStore(store).getAll();
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

/** Misma logica que lib/snapshots.ts: los incompletos quedan fuera. */
function reconstruir(history, upToId) {
  const chain = history.filter((s) => s.complete);
  const idx = chain.findIndex((s) => s.id === upToId);
  if (idx === -1) return new Set();

  let baseIdx = idx;
  while (baseIdx >= 0 && chain[baseIdx].ids === null) baseIdx--;
  if (baseIdx < 0) return new Set();

  const set = new Set(chain[baseIdx].ids ?? []);
  for (let i = baseIdx + 1; i <= idx; i++) {
    for (const id of chain[i].removed) set.delete(id);
    for (const id of chain[i].added) set.add(id);
  }
  return set;
}

async function quien(username) {
  const db = await abrirDb();
  const perfiles = await leerTodo(db, 'profiles');
  const snaps = await leerTodo(db, 'snapshots');

  if (!username) {
    console.log('%c[FollowApp] Resumen del historial', 'font-weight:bold;font-size:13px');
    for (const kind of ['followers', 'following']) {
      const h = snaps.filter((s) => s.kind === kind).sort((a, b) => a.id - b.id);
      console.log(`\n  ${kind} — ${h.length} snapshots`);
      for (const s of h) {
        const n = s.complete ? reconstruir(h, s.id).size : (s.ids?.length ?? 0);
        const esperado = kind === 'followers' ? s.counts?.followers : s.counts?.following;
        const desajuste = esperado != null && esperado !== n ? `  <<< contador decia ${esperado}` : '';
        console.log(
          `    #${String(s.id).padStart(3)} ${new Date(s.takenAt).toLocaleTimeString()} ` +
            `${s.ids === null ? 'delta' : 'base '} ${s.complete ? 'ok  ' : 'TRONC'} ` +
            `${String(n).padStart(4)} ids  +${s.added.length} -${s.removed.length}${desajuste}`,
        );
      }
    }
    console.log('\n  Para rastrear a alguien:  await quien("username")');
    return;
  }

  const limpio = String(username).replace(/^@/, '').toLowerCase();
  const persona = perfiles.find((p) => p.username?.toLowerCase() === limpio);

  if (!persona) {
    console.warn(`[FollowApp] No hay ningun perfil cacheado con el usuario "${limpio}".`);
    console.log('  Eso ya es un dato: nunca se llego a enumerar a esa persona.');
    return;
  }

  console.log(`%c[FollowApp] Rastro de @${persona.username}`, 'font-weight:bold;font-size:13px');
  console.log(`  id ${persona.id} · visto por ultima vez ${new Date(persona.seenAt).toLocaleString()}`);

  const informe = {};

  for (const kind of ['followers', 'following']) {
    const h = snaps.filter((s) => s.kind === kind).sort((a, b) => a.id - b.id);
    if (h.length === 0) continue;

    console.log(`\n  ${kind}:`);
    const marcas = [];

    for (const s of h) {
      if (!s.complete) {
        console.log(`    #${String(s.id).padStart(3)} ${new Date(s.takenAt).toLocaleTimeString()}  (troncado, fuera de la cadena)`);
        continue;
      }
      const set = reconstruir(h, s.id);
      const dentro = set.has(persona.id);
      marcas.push(dentro ? 1 : 0);

      const evento = s.added.includes(persona.id)
        ? '  <<< ALTA en este diff'
        : s.removed.includes(persona.id)
          ? '  <<< BAJA en este diff'
          : '';

      console.log(
        `    #${String(s.id).padStart(3)} ${new Date(s.takenAt).toLocaleTimeString()}  ` +
          `${dentro ? 'presente' : 'AUSENTE '}  (lista de ${set.size})${evento}`,
      );
    }

    informe[kind] = marcas;

    // Un hueco entre dos presencias es la firma de la grieta de paginacion.
    const s = marcas.join('');
    if (/1+0+1/.test(s)) {
      console.log(
        `%c    >>> VEREDICTO: hueco en medio (${s}). Se colo por la grieta de la paginacion,\n` +
          `        no es una alta real.`,
        'color:#D6A550;font-weight:bold',
      );
    } else if (/^0+1+$/.test(s) && marcas.length > 1) {
      console.log(`%c    >>> VEREDICTO: alta real (${s}). Entro y se quedo.`, 'color:#6FBE8C');
    } else if (/^1+0+$/.test(s)) {
      console.log(`%c    >>> VEREDICTO: baja real (${s}). Estaba y se fue.`, 'color:#E0736C');
    }
  }

  window.__rastro = informe;
  return informe;
}

console.log(
  '%c[FollowApp] diagnostico cargado.\n  await quien()            resumen de todos los snapshots\n  await quien("usuario")   rastro de una persona',
  'color:#4FC7D1;font-weight:bold',
);
