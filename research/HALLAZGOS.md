# FollowApp — Hallazgos técnicos

Medido sobre sesión real de Chrome, cuenta propia (`arturo.isazaa`, 92 seguidores).
Fecha: 2026-09-12. Herramienta: `research/probes/ig-ratelimit-probe.js`.

---

## 1. Endpoints

| Endpoint | Estado | Latencia | Devuelve |
|---|---|---|---|
| `GET /api/v1/users/{id}/info/` | ✅ **vivo** | 1123 ms | `follower_count` **y** `following_count` |
| `GET /api/v1/friendships/{id}/followers/?count=N&max_id=` | ✅ **vivo** | ~450 ms | página de usuarios + `next_max_id` |
| `GET /api/v1/users/web_profile_info/?username=` | ❌ **muerto** | 159 ms | HTTP 429 |

Cabecera obligatoria en todas: `x-ig-app-id: 936619743392459`. Cookies same-origin.

### `web_profile_info` está capado globalmente

429 en **159 ms**, tanto desde IP de datacenter sin sesión como desde navegador
con sesión válida. Un rechazo tan rápido es un corte en el edge, no un
rate-limit calculado sobre la actividad del usuario. No es recuperable con
backoff ni con proxies. **No usar.**

### La petición barata

`users/{id}/info/` cubre ambos contadores en **una sola petición**. Es la base
de la estrategia de poll: vigilar seguidores y seguidos sin enumerar nada.

---

## 2. Paginación

**El servidor capa las páginas en 25, ignorando el `count` solicitado.**

Pedido `count=50` → devueltos `23, 23, 25, 21` (total 92, exacto, sin duplicados).
El tamaño por página es variable pero nunca supera 25.

- `next_max_id` es un cursor **reanudable**: persistible para trocear la
  enumeración entre sesiones.
- Su ausencia es la señal fiable de fin de lista.

### Coste de un snapshot completo — `ceil(N / 25)` peticiones

| Seguidores | Peticiones | a 2,5 s | a 0,8 s |
|---|---|---|---|
| 500 | 20 | 1,0 min | 0,4 min |
| 1.000 | 40 | 2,0 min | 0,8 min |
| 2.500 | 100 | 4,9 min | 2,1 min |
| 10.000 | 400 | 19,7 min | 8,3 min |
| 100.000 | 4.000 | 3,3 h | 1,4 h |

---

## 3. Rate limiting

### Prueba de estrés: 150 peticiones sostenidas, sin throttling

`stress({ maxTotal: 150, delayMs: 800 })` — 38 barridos completos de la lista.

| Métrica | Valor |
|---|---|
| Peticiones totales | 150 |
| Duración | 4,4 min |
| Ritmo efectivo | **33,8 req/min** |
| Throttling | **ninguno** |
| Deriva de latencia | `+0%, -1%, -5%, -15%, -5%, -11%` |

**La deriva salió negativa: las peticiones se aceleraron.** El patrón previo al
bloqueo de Instagram es el inverso — la latencia trepa por tramos antes de que
aparezca ningún error. No hubo nada de eso. No rozamos el techo: no estuvimos
cerca. La mejora se explica por conexiones ya calientes.

### Qué queda probado y qué no

✅ **Probado**: 150 peticiones consecutivas a 34 req/min son seguras.
Eso son **3.750 seguidores en una sola pasada** (150 × 25), sin trocear ni
persistir cursores.

❌ **No probado**: que 2.000 req/hora sean seguras. La ventana fue de 4,4 min.
Puede existir un presupuesto horario que no llegamos a tocar. Sabemos el
comportamiento en burst, no el sostenido largo.

**Implicación clave: hay margen de sobra para ir despacio.** Si 34 req/min es
cómodo, el producto puede operar a 15-20 req/min y ser invisible. La captura
pasiva no necesita correr.

### Señales de bloqueo, de menor a mayor gravedad

1. **Deriva de latencia al alza** — aviso temprano, sin error. Es el umbral
   útil para el diseño: aflojar aquí, no en el 429.
2. `please_wait_a_few_minutes` — bloqueo blando, ~30 min sobre el endpoint
3. HTTP 429
4. `feedback_required` — bloqueo duro, horas + login desde la app oficial

---

## 4. Consecuencias de diseño

**Poll por contador, enumeración bajo demanda.** 6 polls/día = 6 peticiones.
La enumeración completa solo se dispara si el contador se movió.

- *Punto ciego*: si entre polls entra 1 seguidor y se va 1, el contador no
  cambia. Se cubre forzando una enumeración completa 1 vez al día.
- El contador da el delta **neto**, nunca la identidad. Saber *quién* exige
  siempre re-enumerar la lista entera — no existe endpoint de diferencias.

**Tramos por tamaño de cuenta** (revisados tras la prueba de estrés):
- **≤ 3.750 seguidores** (≤150 req): snapshot completo en una pasada,
  **verificado empíricamente**. Cubre la práctica totalidad de cuentas
  personales. A 15-20 req/min son 8-10 min de captura pasiva de fondo.
- **3.750 – 25.000**: probablemente viable, sin verificar. Requiere medir el
  techo real antes de prometerlo.
- **> 25.000**: enumeración multi-sesión con `next_max_id` persistido. Riesgo
  de *drift* — si la lista cambia a mitad de la enumeración, hay altas o bajas
  que se cuelan entre trozos. Tolerable para un informe semanal, hay que
  documentarlo en el producto.

**La capa de captura necesita varios candidatos y degradación automática.**
Que `web_profile_info` haya muerto mientras `users/{id}/info/` sigue vivo es
exactamente la fragilidad estructural del modelo. La Fase 0 del probe es, en
pequeño, el patrón que necesita el producto en producción.

---

## 5. Contexto de ejecución (Sesión 0)

Medido con la extensión del spike, cargada descomprimida desde `dist/`.

| Contexto | userId vía | `users/{id}/info/` | `friendships/followers/` | Veredicto |
|---|---|---|---|---|
| **Service worker** | `chrome.cookies.get` | 200 · 1118 ms | 200 · 355 ms · 23 usuarios | ✅ **VIABLE** |
| **Content script** | `document.cookie` | 200 · 1035 ms | 200 · 289 ms · 23 usuarios | ✅ VIABLE |

### Las tres dudas, resueltas

El service worker hace la petición desde el origen `chrome-extension://` y
aun así:

1. `chrome.cookies.get` **sí** devuelve `ds_user_id` con el permiso `cookies`.
2. La cookie de sesión **sí** se adjunta pese a salir de otro origen — no se
   pierde por política SameSite.
3. Instagram **no** rechaza pese a recibir `Sec-Fetch-Site: cross-site`.

La diferencia de latencia entre contextos (~80 ms) es ruido, no señal. Y los
23 usuarios de la primera página coinciden con las dos mediciones anteriores:
el troceo es determinista por posición.

### Consecuencias de diseño

**El scheduler es por reloj.** `chrome.alarms` dispara a cualquier hora sin
depender de que el usuario tenga Instagram abierto. Era el mejor de los dos
escenarios posibles y es el que salió.

**El content script deja de ser necesario.** Se conserva como plan B
documentado por si Instagram endurece la política de cookies, pero sale del
manifest en la S1. Eso permite una dieta de permisos:

| Permiso | S0 | S1 | Motivo |
|---|---|---|---|
| `cookies` | sí | **sí** | `ds_user_id` desde el service worker |
| `storage` | sí | **sí** | cursor y estado del scheduler |
| `alarms` | no | **sí** | el poll periódico |
| `scripting` | sí | **no** | nunca se usó; era para el plan B |
| `tabs` | sí | **no** | solo servía para localizar la pestaña de Instagram |

Menos permisos es mejor argumento ante la revisión de la Chrome Web Store,
que es uno de los riesgos abiertos del plano.

---

## 6. Hipótesis sin verificar

**¿Viene la lista en orden cronológico inverso?** Si los seguidores más
recientes salieran siempre en la página 1, detectar *altas* costaría 1
petición en vez de `N/25`. Las *bajas* seguirían exigiendo enumeración
completa, porque quien se va puede estar en cualquier posición.

No está confirmado: Instagram aplica ranking propio a estas listas y el orden
no está documentado. **Test**: guardar la página 1 en dos snapshots separados
por una alta conocida y ver si aparece arriba.
