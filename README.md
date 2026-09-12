# FollowApp

Saber quién te dejó de seguir en Instagram, sin entregar tu contraseña y sin
pedir el ZIP a Meta. La captura ocurre en el navegador del usuario, con su
propia sesión.

**Plano completo del proyecto:** `research/plano.html`
**Mediciones que lo fundamentan:** `research/HALLAZGOS.md`

---

## Requisitos

Node **20.19+**. El repo está probado con 22.18.0.

```bash
nvm use 22.18.0
```

Node 16 no sirve: Vite 7 no arranca con él.

## Puesta en marcha

```bash
npm install
npm run build
```

Deja la extensión lista en `dist/`.

| Script | Qué hace |
|---|---|
| `npm run build` | Popup + service worker |
| `npm run dev` | Igual, en modo watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Borra `dist/` |

### Por qué hay tres configuraciones de Vite

Cada entry point necesita una forma de bundle distinta:

| Config | Produce | Por qué aparte |
|---|---|---|
| `vite.config.ts` | `popup.html` + `popup.js` | Único que vacía `dist/`, corre primero |
| `vite.sw.config.ts` | `service-worker.js` | Módulo ES **autocontenido** |
| `vite.content.config.ts` | `content.js` | IIFE; no corre por defecto |

El service worker va aparte para que **no comparta chunks con el popup**. Los
imports estáticos sí funcionan en un service worker MV3 de tipo módulo, pero si
alguna vez fallara el registro la extensión se rompería entera y en silencio:
sin alarmas, sin capturas y sin ningún error visible. Duplicar tres kilobytes
de código compartido es un precio ridículo por quitar de en medio esa clase de
fallo.

`build:content` existe pero no corre por defecto: los content scripts del
manifest no admiten `type: "module"`, y desde la S1 el content script está
fuera del manifest (ver *plan B*), así que construirlo sería malgastar bytes.

---

## Estado

| Sesión | Qué | Estado |
|---|---|---|
| S0 | Contexto de ejecución | ✅ plan A confirmado |
| S1 | Módulo de captura | ✅ hecho |
| S2 | Almacenamiento, diff y cruce | ✅ hecho |
| S3 | Scheduler | ✅ hecho |
| S4 | Popup: el MVP local | ✅ hecho |
| — | **Enviada a la Chrome Web Store** | ⏳ v1.0.0 en revisión desde el 12 sep 2026 |
| S5 | Backend y cuentas | a la espera del veredicto |

Se envió **no listada**: pasa la revisión completa y se instala por enlace, pero
no aparece en búsquedas. La revisión es la única incógnita que no depende de
nosotros, y por eso va antes que el backend: un rechazo ahora cuesta días, y
después de construir S5, S6 y S7 costaría semanas de trabajo en el aire.

Política de privacidad: <https://arturdev98.github.io/followapp/>

### S0 — Contexto de ejecución (resuelto)

El service worker MV3 **sí** puede leer la API con la sesión del usuario:
`chrome.cookies.get` devuelve el `ds_user_id`, la cookie de sesión viaja
aunque la petición salga del origen `chrome-extension://`, e Instagram no
rechaza el `Sec-Fetch-Site: cross-site`.

Consecuencia: **la captura no depende de que Instagram esté abierto**, y el
scheduler de la S3 puede ir por reloj. El content script funcionaba también y
se conserva como plan B en `src/content/probe.ts`, fuera del manifest.

### S1 — Módulo de captura

Cuatro piezas, cada una con una responsabilidad:

| Módulo | Responsabilidad |
|---|---|
| `lib/http.ts` | Transporte. `igFetch` y `classify`, que traduce la respuesta a una **gravedad** (`soft`, `hard`, `auth`, `shape`, `transient`). |
| `lib/endpoints.ts` | Adaptadores. Cada capacidad es una lista ordenada de candidatos. |
| `lib/throttle.ts` | Gobernador de ritmo. Vigila la deriva de latencia y afloja solo. |
| `lib/capture.ts` | Orquestador. `captureCounts` y `captureFollowers`, con presupuesto y cursor. |

**La regla que hace útil la capa de adaptadores:** se degrada al siguiente
candidato **solo ante fallo de forma**, nunca ante throttling. Si Instagram nos
frena, probar otro endpoint solo quema más peticiones. Un 429 no significa
«este endpoint murió», significa «para». Solo un 200 con el cuerpo cambiado
justifica pasar al siguiente.

**El freno no espera al 429.** Para cuando llega, ya te bloquearon. El
gobernador mide el p50 en tramos de 25 peticiones y lo compara con el primer
tramo: si la deriva supera el 40 % afloja, si supera el 100 % frena en seco.
Arranca a 20 req/min, muy por debajo de los 34 req/min que aguantaron sin
inmutarse en la prueba de estrés.

### S2 — Almacenamiento, diff y cruce de listas

| Módulo | Responsabilidad |
|---|---|
| `lib/db.ts` | Envoltorio mínimo de IndexedDB, sin dependencias |
| `lib/snapshots.ts` | Base + deltas, reconstrucción, diff, cruce y caché de perfiles |

**Dos listas, un contador.** Seguidores y seguidos comparten endpoint, forma de
respuesta y código: solo cambia un segmento de la ruta. Y `users/{id}/info/`
trae los dos contadores de una vez, así que capturar ambas listas cuesta
`1 + ceil(F/25) + ceil(G/25)` peticiones, no dos contadores.

**El cruce sale gratis.** «Quién no te sigue de vuelta» es intersección de los
dos últimos snapshots completos: cero peticiones. Si falta una de las dos
listas devuelve `ready: false` en vez de un resultado a medias — decir «42 no
te siguen de vuelta» sin tener la lista de seguidores sería mentir con
confianza.

**Los perfiles salen gratis.** La respuesta de `friendships/followers/` ya trae
`username`, `full_name` y `profile_pic_url` de cada persona. La caché se llena
durante la enumeración sin una sola petición extra. Los snapshots guardan solo
IDs; los perfiles viven en su propia tabla, una fila por persona, para no
duplicar diez mil perfiles cada día.

**Base + deltas.** Cada 30 snapshots se guarda una base completa; entre medias
solo las diferencias. Reconstruir un momento cualquiera es caminar desde la
base más cercana hacia delante. Todos los registros llevan `added`/`removed`,
base incluida, para que el historial de diffs sobreviva a la compactación.

**Una captura incompleta nunca se compara.** Si el presupuesto se agotó y la
enumeración quedó troceada, restar contra el snapshot anterior daría bajas
falsas de gente que simplemente no llegamos a leer. Esas capturas se guardan
como base marcada `complete: false` y el diff las salta.

### Cómo probarlo

1. `npm run build`
2. Chrome → `chrome://extensions` → **Modo de desarrollador**
3. **Cargar descomprimida** → carpeta `dist/`
4. Con sesión iniciada en Instagram, clic en el icono:
   - **Poll** — una petición, los dos contadores
   - **Capturar** — enumera las dos listas, guarda y muestra diffs y cruce
   - **borrar** — vacía el historial

La primera captura crea las bases y no tiene con qué comparar. A partir de la
segunda el popup muestra quién entró y quién se fue en cada lista, y el cruce
con quién no te sigue de vuelta.

### S3 — Vigilancia en segundo plano

`lib/scheduler.ts` implementa la máquina de estados sobre `chrome.alarms`.

**El poll no enumera.** Cada 4 h lee el contador: **una petición**, los dos
números. Solo si alguno se movió se dispara la enumeración de esa lista. Seis
polls al día cuestan seis peticiones.

**Barrido diario forzado.** Si entre dos polls entra un seguidor y se va otro,
el contador no cambia y el movimiento pasaría desapercibido. Una vez cada 24 h
se enumeran ambas listas pase lo que pase.

**Presupuesto de 60 peticiones por disparo.** No es el límite de Instagram
—verificamos 150 sin inmutarse— sino el del service worker, que Chrome mata si
tarda demasiado. A 3 s de ritmo son unos 3 min. Las cuentas grandes se
completan en varios disparos encadenados por una alarma de continuación a 2
min, acumulando los ids entre tandas hasta poder cerrar el snapshot.

**Una lista leída en varias tandas se marca `chunked`.** Es válida, pero pudo
cambiar por el camino, así que el diff contra ella avisa. Es lo que hace
significativo el campo `unreliable`.

**Esperas por gravedad.** `please_wait` o 429 → 35 min. `feedback_required` →
6 h, porque además necesita que el usuario abra la app oficial.

**El intervalo se elige desde el popup.** Producción son 4 h; hay opciones de
2 y 15 min marcadas como *prueba*, porque esperar cuatro horas a que salte una
alarma no es forma de verificar nada. El popup avisa con un banner cuando hay
un intervalo de prueba activo, para que no se quede puesto por olvido.

#### Los dos arreglos de medición

1. **La línea base del gobernador persiste entre tandas.** Sin esto el freno
   era decorativo: una cuenta pequeña gasta 4 peticiones por captura y nunca
   llenaría una ventana de 25, así que jamás llegaría a medir deriva. Con una
   referencia heredada bastan 8 muestras para evaluar. Y si una tanda tuvo que
   frenar, la referencia **no se actualiza**: incorporar una tanda degradada
   subiría el listón y adormecería el freno justo cuando más falta hace.
2. **Los avatares no se descargan durante una captura.** Van al CDN, no a la
   API, pero compiten por la misma conexión e inflarían la latencia medida. El
   service worker marca `captureRunning` y el popup sirve solo desde caché
   mientras dure; al terminar, reintenta lo que se saltó.

### S4 — El popup deja de ser un banco de pruebas

Fuera latencias, adaptadores, cursores, recuentos de snapshots y el botón de
poll. Un usuario no técnico no tiene por qué leer `require_login`.

**Actividad, no «último diff».** Los diffs ya estaban guardados en cada
snapshot; `recentChanges()` los recorre y produce una cronología agrupada por
día. Es lo que convierte un panel de depuración en algo que alguien abriría
cada mañana.

**Errores en lenguaje llano.** `require_login` → «Inicia sesión en Instagram
para seguir revisando.» `feedback_required` → «Instagram pidió una pausa
larga.»

**El diagnóstico sigue accesible:** tres clics en el nombre «FollowApp»
despliegan snapshots, línea base, bitácora, el selector de intervalo y el
borrado.

**Layout:** cabecera y pie fijos, solo el listado hace scroll. Durante una
revisión, una franja pegada arriba del listado con el progreso real
(`48 / 94`), visible estés donde estés en la lista.

### Pendiente para más adelante

#### Intervalo adaptativo según el tamaño de la cuenta

Hoy el intervalo es fijo: 4 h para todos. Una cuenta de 100 seguidores no tiene
por qué esperar lo mismo que una de 100.000.

**Pero el coste no está en el poll.** El poll es **una petición siempre**, sea
cual sea el tamaño de la cuenta — ese es todo el sentido de la estrategia del
contador. Incluso cada 15 minutos son 96 peticiones al día: nada.

Lo caro es la **enumeración**, y esa escala con `ceil(N/25)`:

| Seguidores | Peticiones por enumeración |
|---|---|
| 100 | 4 |
| 1.000 | 40 |
| 10.000 | 400 |
| 100.000 | 4.000 |

El riesgo real no es pollear poco: es que una cuenta grande **enumere
demasiado**. Un perfil de 100.000 seguidores gana y pierde gente cada pocos
minutos, así que su contador cambia en casi todos los polls. Con un poll cada
15 min serían 96 enumeraciones diarias de 4.000 peticiones cada una.

Así que el diseño no es «intervalo según tamaño» sino **dos perillas**:

1. **Poll corto para todos** — 15-30 min. Es una petición.
2. **Suelo entre enumeraciones**, escalado por coste. Con un presupuesto de
   ~2.000 peticiones diarias de enumeración:

| Seguidores | Enumeraciones/día | Suelo |
|---|---|---|
| 100 | sin límite práctico | ninguno |
| 10.000 | 5 | ~5 h |
| 100.000 | 0,5 | ~48 h |

Con eso, una cuenta pequeña detecta una baja **en minutos** en vez de en horas,
y una grande no se autodestruye. El barrido diario forzado se mantiene aparte,
como red de seguridad.

- **Cuentas borradas vs. bajas reales.** Una cuenta suspendida desaparece de la
  lista igual que quien te deja de seguir. Decir «te dejó de seguir» sobre una
  cuenta que Instagram eliminó es un error que molesta.
- **Ciclos de follow/unfollow.** Las cuentas que siguen y dejan de seguir en
  bucle —práctica habitual de bots de crecimiento— inundan la cronología con
  el mismo nombre repetido. Conviene agruparlas.

### Pruebas

La lógica que no se puede verificar a ojo se prueba compilando el módulo suelto
y ejecutándolo con Node. Cubre la cadena base/delta, el rebase a mitad, los
snapshots incompletos fuera de la cadena, y el cruce de listas.

| Veredicto | Significa |
|---|---|
| `COMPLETA` | Se enumeró la lista entera |
| `REANUDABLE` | Se agotó el presupuesto; el cursor permite continuar |
| `BLOQUEO BLANDO` | Instagram pidió esperar; reintentar en ~30 min |
| `SIN ADAPTADOR` | Ningún candidato respondió con forma válida — Meta cambió algo |

---

## Estructura

```
src/
  lib/http.ts        Transporte y clasificación por gravedad
  lib/endpoints.ts   Adaptadores: candidatos por capacidad
  lib/throttle.ts    Gobernador de ritmo (deriva de latencia)
  lib/capture.ts     Orquestador: presupuesto, cursor, reanudación
  lib/db.ts          Envoltorio de IndexedDB
  lib/snapshots.ts   Base + deltas, reconstrucción, diff, cruce, caché de perfiles
  lib/scheduler.ts   Máquina de estados de la vigilancia (chrome.alarms)
  lib/avatars.ts     Caché de fotos en bytes
  lib/types.ts       Tipos de dominio
  lib/messages.ts    Contratos entre popup y service worker
  background/sw.ts   Host de la captura
  content/probe.ts   Plan B, fuera del manifest
  popup.html         Banco de pruebas
  popup/popup.ts
public/
  manifest.json      MV3 · permisos: cookies, storage
research/
  plano.html         Arquitectura, riesgos y roadmap
  HALLAZGOS.md       Mediciones reales de la API
  probes/            El probe original de consola
```
