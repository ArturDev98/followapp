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
| — | **Aprobada por la Chrome Web Store** | ✅ v1.0.0 · 13 sep 2026 |
| S4.5 | Arranque y diagnóstico | ✅ v1.0.1 |
| — | Marca de captura que sobrevivía al cierre del navegador | ✅ v1.0.2 |
| — | Semana de pruebas con conocidos | ⏳ 1 diagnóstico leído · ver `PRUEBAS.md` |
| S4.6 | Bajas falsas y ciclos de ir y venir | ✅ hecho |
| S4.7 | Ritmo: poll corto, suelos que escalan, frenos visibles | ✅ hecho |
| S5 | Backend y cuentas | tras la semana de pruebas |

Se publicó **no listada**: pasa la revisión completa y se instala por enlace,
pero no aparece en búsquedas. Era la única incógnita que no dependía de
nosotros, y por eso fue antes que el backend: un rechazo ahora costaba días, y
después de construir S5, S6 y S7 habría costado semanas de trabajo en el aire.

El backend espera a que la extensión haya corrido días seguidos en navegadores
que no son el nuestro. S5 monta servidores encima del motor de captura y mueve
la frontera de confianza, que es el argumento de venta entero: construirlo sobre
una semana de datos reales no es lo mismo que construirlo sobre una suposición.

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
alarma no es forma de verificar nada. Salen marcadas como tales en el
desplegable, pero **nada avisa después de elegirlas**: si una se queda puesta
por olvido, solo se nota abriendo el diagnóstico. Solo se llega desde el panel
oculto, así que el único que corre ese riesgo es quien desarrolla.

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

### S4.5 — Que la semana de pruebas produzca señal

Dos agujeros que solo se ven cuando la extensión sale de la máquina de quien la
escribió.

**La vigilancia venía apagada de fábrica.** El scheduler arranca con
`enabled: false` y nada lo enciende solo: quien instalaba, abría el popup y no
encontraba el interruptor «Automático» se quedaba con una extensión que no hacía
absolutamente nada, para siempre, sin un solo mensaje de error. Ahora la primera
apertura es una pantalla de bienvenida con un botón, que enciende la vigilancia
**y dispara la primera revisión en el momento** en vez de esperar a la alarma. Y
mientras esté apagada, el icono lleva un aviso ámbar: se ve sin abrir nada.

**No había forma de que un tester contara qué le pasa.** No hay telemetría ni la
va a haber — es el argumento de venta. Así que el canal es al revés: un botón
**copiar diagnóstico** produce un bloque de texto pegable con versión, estado,
contadores, snapshots y bitácora. Sin nombres de cuentas ni identificadores:
solo números y estados. Lo manda el usuario, a mano, si quiere.

**Y el diagnóstico se ofrece solo cuando hace falta.** Detrás de tres clics está
bien para quien escribió la extensión, pero quien más necesita mandar un informe
es justo quien no va a buscarlo ahí. Así que cuando hay un problema declarado
—sin sesión, bloqueo blando o duro— el aviso sale con el botón dentro, arriba
del listado, y el pie deja de repetir el mismo mensaje. Un botón fijo en el pie
habría sido ruido en el 99 % de las aperturas.

El tercer caso lo detecta el popup solo: **vigilancia activa y cero snapshots
después de un día** es la extensión rota en silencio, que es el fallo del que
nadie se enteraría nunca. La entrada más vieja de la bitácora dice desde cuándo
lo estamos intentando, así que no hizo falta guardar ningún campo nuevo.

**Y el popup decía que revisaba cuando no revisaba nada.** Con la sesión de
Instagram cerrada, `tick()` corta antes de la primera petición —eso siempre
estuvo bien— pero el service worker anunciaba `tick-start` *antes* de los
cortes, así que el popup pintaba «Revisando…» y su barra de progreso para una
revisión que no existió. Ahora el aviso lo dispara el scheduler cuando ya ha
pasado sus comprobaciones, que es el único momento en el que es verdad.

Y el pie prometía lo mismo por otra vía: durante una espera la alarma sigue
sonando, pero cada disparo se salta, así que «Próxima en 10 s» era falso
—la próxima de verdad era 35 minutos después—. Ahora durante una espera el pie
cuenta hacia el reintento, y la franja dice por qué. Uno el cuándo, la otra el
qué, sin repetirse.

**Y encender la vigilancia también es una promesa.** Marcar «Automático» creaba
la alarma sin mirar si había sesión, así que el interruptor se quedaba en verde
con una cuenta atrás —«Próxima en 58 s»— que no significaba nada hasta que el
primer disparo fallara un minuto después. Ahora la comprobación va donde ya
vivía, `requireSession()`: lee la cookie, y si no hay sesión deja la espera
apuntada para que la franja pueda explicarlo en el momento. Cuesta cero
peticiones, y `tick()` usa la misma función en vez de repetirla.

El interruptor se queda encendido a propósito: representa lo que el usuario
quiere, no lo que se puede hacer ahora mismo. En cuanto vuelva a entrar en
Instagram, la vigilancia sigue sola.

**Un bloqueo no es como otro.** «Revisar» forzaba el disparo saltándose
cualquier espera, incluidas las de ritmo: insistir justo después de que
Instagram pidiera calma es lo contrario de lo que hay que hacer, y es la parte
de la zona gris de ToS que sí está en nuestra mano. Ahora forzar solo salta las
esperas por sesión —reintentar sin sesión no cuesta ni una petición— y el botón
se desactiva mientras haya un bloqueo blando o duro.

Para poder distinguirlos, el estado guarda `blockedKind`. Antes la clase de
bloqueo se adivinaba buscando la palabra «sesión» dentro del motivo, que es un
texto en español: habría fallado en cuanto alguien lo tradujera.

**De paso, un estado zombi.** `wipe()` vacía también el estado del scheduler,
pero la alarma sobrevivía: después de borrar el historial la extensión seguía
capturando con el interruptor pintado en apagado. Ahora el borrado repone la
vigilancia si estaba activa, y la para del todo si no.

### 1.0.2 — La marca de «captura en curso» no podía ser un booleano

Cerrar el navegador a mitad de una revisión dejaba el popup diciendo
«Revisando…» para siempre. El síntoma era feo; la causa, mucho peor.

`captureRunning` vivía en `chrome.storage.local` y se apagaba en un `finally`.
Chrome mata el service worker cuando le conviene —y cerrar el navegador lo mata
siempre—, así que ese `finally` puede no llegar a ejecutarse nunca. Y un
booleano encendido así se queda encendido para siempre:

```ts
if (await isBusy()) return { ran: false, skipped: 'ya hay un disparo en curso' };
```

Cada disparo posterior se descartaba en esa primera línea, antes de escribir
una sola línea de bitácora. La alarma seguía sonando, el popup seguía pintando
«Revisando…», y la extensión no volvía a capturar jamás. **Muerta y con cara de
estar trabajando**, que es exactamente el fallo del que un usuario no se entera
—y el que la franja de diagnóstico no habría detectado, porque `p_stuck` mira
que no haya snapshots y aquí los había.

Ahora la marca es **una hora, no un sí/no**, y vive en `lib/busy.ts` porque la
leen dos sitios por motivos distintos: el scheduler para no pisar un disparo
con otro, y la caché de avatares para no descargar fotos mientras se mide la
latencia. Cada uno se había escrito su propio lector; ahora comparten uno.

Tres capas, independientes a propósito:

1. **Caduca.** Sin señales de vida en 10 minutos, la marca es de un worker
   muerto y se descarta. Un disparo gasta 60 peticiones a ~3 s: tres minutos,
   seis si el gobernador afloja.
2. **Se renueva mientras haya progreso real.** Cada página enumerada vuelve a
   sellarla, para que una cuenta grande no caduque a media captura.
3. **Al arrancar Chrome se limpia.** Si el navegador acaba de abrirse, no hay
   ninguna captura en curso: lo que quede marcado es basura.

El booleano que dejaron las versiones anteriores se limpia al leerlo, así que
quien tenga la extensión encallada se desencalla solo al actualizar.

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

### S4.6 — Una baja que no lo era

«Te dejó de seguir» es la única frase que la extensión dice con seguridad, y
hasta ahora la decía también cuando no se había ido nadie: una cuenta
suspendida, eliminada o desactivada desaparece de la lista exactamente igual
que una que te deja de seguir, y restar dos listas no distingue una cosa de la
otra.

Es el error que más caro sale, porque el usuario **puede comprobarlo**: abre el
perfil, ve que no existe, y desde ese momento no se cree nada más de lo que le
digamos. En un informe para quien mira métricas en vez de caras, pesa todavía
más.

**La prueba cuesta una petición.** `users/{id}/info/` sobre el id de la baja:
un 404 es una cuenta que ya no existe; un 200 con perfil es alguien que sigue
ahí y se fue de verdad. Cada baja queda con un veredicto —`left`, `gone` o
`unknown`— guardado junto al snapshot que la detectó.

| Módulo | Responsabilidad |
|---|---|
| `lib/verify.ts` | Comprueba si una baja sigue existiendo, con tope y freno |

Tres límites para que la comprobación no se convierta en un problema nuevo:

- **Ocho por disparo.** Una purga grande no puede comerse la tanda entera.
- **Se para a la primera señal de bloqueo.** Lo que quede sin comprobar se
  marca dudoso, no se calla: pintarlo como baja segura sería repetir el error.
- **Solo seguidores.** Una baja en «seguidos» la hizo el propio usuario.

**Y el que va y viene.** Quien entra y sale varias veces no son cinco noticias,
es un hecho solo: la actividad lo agrupa en una línea con el número de vueltas
cuando se ha ido dos veces o más en 30 días. El rojo queda reservado para las
bajas que lo son.

**El primer diagnóstico real destapó la otra mitad del problema.** La
reconciliación comparaba lo enumerado con el contador y descartaba el snapshot
ante *cualquier* desajuste. Pero el peligro no es simétrico: leer **de menos**
significa que falta gente, y esa gente sale como baja falsa en el diff
siguiente; leer **de más** solo puede ser el contador con retraso —medido: tres
horas y media— o alguien que se fue durante la lectura, que es la verdad y
saldrá como baja de todas formas. Descartar esa lectura costaba la enumeración
entera y retrasaba la detección. Ahora solo se descarta a la baja. El caso está
documentado con la bitácora que lo prueba en `PRUEBAS.md`.

### S4.7 — El ritmo deja de ser el mismo para todos

La primera semana de datos reales dijo dos cosas a la vez: que el motor va
**muy** sobrado en una cuenta pequeña, y que nada impedía que una grande se
suicidara. Las dos se arreglan con la misma idea: **el ritmo tiene que salir de
lo que cuesta leer la lista, no de una constante**.

**El poll baja de 4 h a 1 h.** Cuesta una petición y la respuesta tarda 317 ms;
cuatro horas era prudencia sin motivo. La diferencia para el usuario es que «te
dejó de seguir hace 4 h» pasa a «hace 1 h», que es la distancia entre un dato y
una sensación. Quien eligió su intervalo a mano se queda con el suyo: el estado
guarda ahora `pollChosen`, y sin esa marca la extensión adopta el valor por
defecto **también cuando baja**, que si no la mejora nunca llega a quien ya la
tiene instalada.

**El suelo entre lecturas escala con `ceil(N/25)`**, que es lo que de verdad
cuesta enumerar:

| Cuenta | Peticiones por lectura | Suelo automático | Suelo del botón |
|---|---|---|---|
| 105 seguidores | 5 | 30 min | 10 min |
| 3.750 | 150 | 15 h | 5 h |
| 10.000 | 400 | 20 h (tope) | 6 h (tope) |

Los 150 de una cuenta de 3.750 son **la prueba de estrés entera de una
sentada**. Sin suelo, un contador que oscila —y oscila ±1 sin parar— dispararía
esas 150 peticiones en cada poll. El barrido diario sigue sin mirar suelos: es
la garantía de un dato al día como mínimo.

**Y el botón «Revisar» deja de ser gratis.** En el diagnóstico hay dos capturas
manuales separadas por un minuto: 14 peticiones en 60 s en una cuenta de 105.
En una de 3.750 habrían sido **300 en dos minutos**, que es el camino más corto
a un bloqueo duro. Ahora el botón tiene su propio suelo, más corto que el
automático —lo pide el usuario— pero nunca cero.

**El gobernador por fin se ve.** Medía cuántas veces tuvo que aflojar y el p95
de latencia, y no lo contaba en ninguna parte. Ahora cada lectura lo deja en la
bitácora:

```
Seguidores: 105 · 5 peticiones · p95 480 ms
```

Es la única forma de saber dónde está el techo de una cuenta grande **sin
esperar a que alguien se bloquee**, y el dato que la semana de pruebas no podía
producir de ninguna otra manera.

### Para la siguiente versión

Cosas conocidas que no entraron en la 1.0.3, apuntadas para no perderlas:

| Qué | Por qué quedó fuera |
|---|---|
| El popup no explica el suelo: pulsar «Revisar» y que no pase nada solo consta en la bitácora | Es plomería entre el service worker y la interfaz. En pruebas cerradas se cubre avisando al tester, y no compensaba retrasar la revisión de Google |
| Reintentar los veredictos `unknown` en disparos posteriores con presupuesto sobrante | Mejora el dato 3, pero se pinta «sin confirmar», que ya es honesto |
| El techo por encima de 3.750 seguidores | No es código: hace falta una cuenta grande que instale la 1.0.3 |

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
  lib/verify.ts      Comprueba si una baja es una cuenta que ya no existe
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
