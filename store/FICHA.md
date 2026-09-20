# Ficha de la Chrome Web Store

Todo lo que hay que pegar en el panel de desarrollador. Español e inglés.

---

## Nombre

Máximo 75 caracteres. Ya sale del `manifest` vía `_locales`, pero conviene
tenerlo a mano:

- **ES** — FollowApp — quién te dejó de seguir
- **EN** — FollowApp — Instagram unfollower tracker

## Descripción corta

Máximo 132 caracteres. Es lo que se ve en los resultados de búsqueda.

- **ES** — Descubre quién te dejó de seguir en Instagram. Sin contraseña, sin ZIP y sin que nada salga de tu navegador.
- **EN** — See who unfollowed you on Instagram. No password, no data export, nothing leaves your browser.

---

## Descripción larga — ES

> Instagram no te avisa cuando alguien te deja de seguir. Si tienes unos cientos
> de seguidores, es imposible darse cuenta.
>
> FollowApp lleva la cuenta por ti.
>
> **Sin contraseña.** No te pedimos tus datos de Instagram y nunca los vemos.
> La extensión usa la sesión que ya tienes abierta en el navegador, igual que
> cuando entras a Instagram en una pestaña.
>
> **Sin descargar el ZIP.** Otras herramientas te obligan a pedirle a Meta una
> copia de tus datos y esperar hasta 48 horas. Aquí no hay nada que pedir ni
> que subir.
>
> **Sin servidores.** No hay ninguno. Todo se guarda en tu propio navegador y
> no se envía a ninguna parte. Ni analítica, ni seguimiento, ni cuentas.
>
> ─────────────────
>
> **QUÉ HACE**
>
> • Quién te dejó de seguir, con su foto y cuándo se detectó
> • Quién empezó a seguirte
> • Quién no te sigue de vuelta
> • Distingue una baja real de una cuenta suspendida o borrada
> • Agrupa a quien te sigue y te deja de seguir una y otra vez
> • Toca cualquier nombre y se abre su perfil de Instagram
> • Revisión automática en segundo plano, sin que tengas que abrir nada
> • Historial por días, para ver la evolución
>
> ─────────────────
>
> **CÓMO FUNCIONA**
>
> Cada hora comprueba tu número de seguidores. Eso es una sola consulta. Solo
> si el número cambió, lee la lista completa para averiguar quién entró y quién
> salió, y espera entre lecturas lo que haga falta según lo grande que sea tu
> cuenta. Así la extensión es discreta y tu cuenta no corre riesgos.
>
> Cuando alguien desaparece de tu lista, comprueba si su cuenta sigue
> existiendo antes de decirte nada: una cuenta suspendida o borrada también
> desaparece, y eso no es lo mismo que alguien que te deja de seguir. Si de
> verdad se fue, te lo dice con su nombre y su foto, guardados antes de que
> se fuera.
>
> ─────────────────
>
> **LO QUE NO HACE**
>
> • No pide tu contraseña
> • No sigue ni deja de seguir a nadie por ti
> • No espía cuentas ajenas: solo la tuya
> • No envía tus datos a ningún sitio
>
> Disponible en español e inglés.

---

## Descripción larga — EN

> Instagram never tells you when someone unfollows you. With a few hundred
> followers, you simply can't notice.
>
> FollowApp keeps track for you.
>
> **No password.** We never ask for your Instagram credentials and never see
> them. The extension uses the session your browser already has, the same one
> you use when you open Instagram in a tab.
>
> **No data export.** Other tools make you request a copy of your data from
> Meta and wait up to 48 hours. Here there is nothing to request and nothing
> to upload.
>
> **No servers.** There are none. Everything is stored in your own browser and
> sent nowhere. No analytics, no tracking, no accounts.
>
> ─────────────────
>
> **WHAT IT DOES**
>
> • Who unfollowed you, with their picture and when it was detected
> • Who started following you
> • Who doesn't follow you back
> • Tells a real unfollow apart from a suspended or deleted account
> • Groups the accounts that follow and unfollow you over and over
> • Tap any name to open their Instagram profile
> • Automatic background checks — nothing to open
> • Day-by-day history so you can see the trend
>
> ─────────────────
>
> **HOW IT WORKS**
>
> Every hour it checks your follower count. That is a single request. Only if
> the number changed does it read the full list to find out who joined and who
> left, waiting between reads for as long as the size of your account calls
> for. That keeps the extension quiet and your account safe.
>
> When someone disappears from your list, it checks whether their account still
> exists before telling you anything: a suspended or deleted account disappears
> too, and that is not the same as someone unfollowing you. If they really
> left, you get their name and picture, saved before they went.
>
> ─────────────────
>
> **WHAT IT DOESN'T DO**
>
> • Never asks for your password
> • Never follows or unfollows anyone for you
> • Never spies on other people's accounts — only yours
> • Never sends your data anywhere
>
> Available in English and Spanish.

---

## Categoría

**Social & Communication**

## Justificación de permisos

El panel pide una frase por permiso. Estas son directas y ciertas.

| Campo | Texto |
|---|---|
| `cookies` | Reads the Instagram session id (`ds_user_id`) to identify which account belongs to the user. The value never leaves the browser and is never transmitted. |
| `storage` | Stores the user's language and check-interval preferences, plus the scheduler state. |
| `alarms` | Schedules the periodic background check that detects follower changes. |
| `host: www.instagram.com` | Reads the user's own followers and following lists to compute who joined and who left. |
| `host: *.cdninstagram.com`, `*.fbcdn.net` | Downloads profile pictures so they can be shown next to each name. Instagram's image URLs expire, so the images are cached locally. |
| **Remote code** | No. All code ships inside the package; nothing is fetched or evaluated at runtime. |

## Uso de datos — declaración

Marcar **únicamente**:

- [x] Personally identifiable information — *usernames and profile pictures of the user's own followers*

Y confirmar las tres casillas finales:

- [x] No se venden a terceros
- [x] No se usan para fines ajenos a la funcionalidad principal
- [x] No se usan para determinar solvencia ni para préstamos

> **Nota sobre la primera casilla:** aunque nada sale del navegador, Chrome
> considera «manejo» también el procesamiento local. Declararlo y explicar en
> la política que no se transmite es más seguro que no marcarlo.

## Visibilidad

**Pública** desde la 1.0.3. Las tres primeras versiones fueron no listadas —se
instalaban por enlace y no salían en búsquedas— para pasar la revisión sin
exponerse mientras el motor no había corrido fuera de la máquina del autor.
Con seis días de datos reales sin un solo bloqueo, ese motivo dejó de aplicar.

Al listarla, la descripción larga deja de ser un trámite: es lo primero que lee
alguien que no te conoce, y compite con herramientas que piden el ZIP de Meta o
directamente la contraseña. Los tres «sin» —sin contraseña, sin ZIP, sin
servidores— van arriba por eso.

## Capturas

5 como máximo, a **1280×800**. Orden sugerido:

1. **Actividad con bajas** — el caso que vende el producto
2. **No te siguen de vuelta** — la segunda función más buscada
3. **Revisión en curso** — la franja de progreso, prueba de que trabaja solo
4. **Bienvenida** — lo primero que ve un usuario nuevo, y que arrancar es un clic
5. **En inglés** — demuestra el soporte de idiomas

`store/montar-capturas.py` las compone a partir de capturas crudas del popup.
