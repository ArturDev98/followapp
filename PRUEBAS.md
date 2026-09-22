# Semana de pruebas

Cómo seguir a los testers sin telemetría, y qué mirar mientras tanto.

---

## El mensaje que se les manda

Corto. Un tester que recibe instrucciones largas no prueba nada.

> Te paso FollowApp, la extensión que te dice quién te dejó de seguir en
> Instagram. No pide contraseña y no sale nada de tu navegador.
>
> 1. Instálala desde este enlace: <ENLACE>
> 2. Ábrela desde el icono de extensiones (arriba a la derecha de Chrome)
>    y dale a **Empezar a vigilar**.
> 3. Ya está. Ábrela de vez en cuando a ver qué cuenta.
>
> Un aviso: si le das a **Revisar** y no ves que pase nada, es normal. Acaba
> de mirar tu lista hace poco y espera un rato antes de volver a leerla —
> cuanto más grande es la cuenta, más espera.
>
> Si ves algo raro —o si no ves nada en dos días— avísame y te digo cómo
> sacarme el diagnóstico.

Ese aviso del botón está ahí porque la extensión todavía no lo explica sola:
el suelo entre lecturas solo consta en la bitácora. En una cuenta de 500
seguidores son 40 minutos, así que es lo primero con lo que se choca alguien
que la acaba de instalar y quiere verla funcionar. Se arregla en la próxima
versión; mientras tanto, lo dice el mensaje.

Dos cosas importan de ese mensaje: **que la fijen en la barra** (si no, el icono
queda escondido en el menú de extensiones y nunca la abren) y **que le den al
botón**. Sin el botón no corre nada.

## Cuando algo falla

**Si la extensión se da cuenta sola** —no hay sesión de Instagram, Instagram
frenó, o lleva más de un día vigilando sin conseguir leer la lista— el aviso
sale solo arriba del listado, con el botón de copiar al lado y una línea que
explica qué hacer con el texto. Ahí no hay que enseñarle nada a nadie.

**Si no se da cuenta** —te dice que alguien te dejó de seguir y es mentira, o
simplemente no cuenta nada— el diagnóstico se saca a mano:

1. Abrir la extensión.
2. **Tres clics** sobre el nombre «FollowApp», arriba a la izquierda.
3. Botón **copiar diagnóstico**.
4. Pegarlo en el chat.

Sale un bloque de texto como este:

```
FollowApp 1.0.1 · es · Chrome 140.0.0.0 · Windows NT 10.0
vigilancia: activa, poll cada 240 min
próximo poll: 13/09, 18:42
contadores: 92 seguidores · 118 seguidos
seguidores: 7 snapshots · 1 base · última 13/09, 16:02
seguidos: 7 snapshots · 1 base · última 13/09, 16:02
latencia base: 480 ms
bitácora:
  13/09, 16:02 [info] Sin cambios · 92 seguidores, 118 seguidos · 1 petición
  ...
```

No lleva nombres de cuentas ni identificadores de nadie: solo números, estados y
la bitácora. Lo manda el usuario a mano porque **no hay ningún servidor** al que
mandarlo automáticamente, y ese es justamente el argumento de venta.

## Qué mirar en cada diagnóstico

| Señal | Qué significa |
|---|---|
| `vigilancia: apagada` | Nunca le dio al botón. No es un fallo de la extensión |
| `snapshots: 0` con vigilancia activa | La captura no llegó a terminar: mirar la bitácora |
| `en espera ... bloqueo duro` | Instagram frenó de verdad. Anotar el tamaño de la cuenta |
| `latencia base` subiendo entre informes | El gobernador está midiendo deriva: es la señal que buscamos |
| `a medias: ... en N tandas` | Cuenta grande troceando. Anotar cuántas tandas necesita |
| `leidos X, el contador dice Y: se acepta` | Normal: el contador va con retraso respecto a la lista |
| `...: faltan demasiados` | Falta una página entera o más: ahí sí se descarta la lectura |
| `bajas: N · M ya no existían` | **El dato 3**: cuántas de las bajas no eran bajas |
| `rachas de ir y venir: N` | Cuentas que entran y salen: cuánto ruido quita el agrupado |
| `p95 X ms` en cada lectura | Sube respecto a la latencia base = Instagram está frenando |
| `frenó N veces` | **El dato 1**: el gobernador aflojó. Anotar el tamaño de la cuenta |
| `Se relee X en N min` | El suelo pospuso una lectura. Normal en cuentas grandes |

## Las preguntas que hay que hacerles

Tres, y no más. Al cuarto día, no el primero.

1. ¿La abriste alguna vez desde que la instalaste?
2. ¿Te ha contado algo que no supieras?
3. ¿Le creíste? (si dijo que alguien le dejó de seguir, ¿era verdad?)

La tercera es la importante: es la que detecta las **bajas falsas** por cuentas
suspendidas, que es el error que más duele en las reseñas.

## Lo que esta semana tiene que dejar por escrito

Datos que ningún probe puede dar y que bloquean decisiones ya tomadas en el plano:

- **El techo real por encima de 3.750 seguidores.** Ahora mismo es extrapolación.
- **Cuántas enumeraciones diarias aguanta una cuenta mediana** sin que Instagram
  frene. Es el número que calibra el suelo entre enumeraciones.
- **Cuántas veces se confunde una cuenta suspendida con una baja real.**

---

## Lo que dejó · 19 sep 2026

Un diagnóstico completo de una cuenta pequeña —**105 seguidores, 45 seguidos**—
con seis días de vigilancia en 1.0.2 y poll cada 4 h.

### Ni un freno en seis días

Ni un `soft`, ni un `hard`, ni un `feedback_required` en toda la bitácora.
Latencia base **317 ms** y sin deriva: el gobernador nunca tuvo que aflojar, y
espera 3 s entre peticiones que tardan 0,3 s.

El día más cargado fue el 18/9: cinco enumeraciones de seguidores —una
descartada—, tres de seguidos y seis polls, **~40 peticiones en el día**. Dos de
esas enumeraciones salieron **con un minuto de diferencia** porque alguien pulsó
«Revisar» dos veces: 14 peticiones en 60 s, sin que Instagram dijera nada.

| Dato que bloqueaba S5 | Estado |
|---|---|
| Techo por encima de 3.750 seguidores | ❌ sigue siendo extrapolación: la cuenta probada tiene 105 |
| Enumeraciones diarias que aguanta una cuenta | ⚠️ 4 al día en una cuenta de 105, a 5 peticiones cada una |
| Bajas falsas por cuentas suspendidas | ❌ el diagnóstico es de 1.0.2, anterior a los veredictos |

El segundo dato hay que leerlo con cuidado: lo que Instagram cuenta no son
enumeraciones, son **peticiones**. Una cuenta de 105 gasta 5 por enumeración;
una de 3.750 gasta 150, que es la prueba de estrés entera. Esta cuenta confirma
la **forma** de la regla —el suelo tiene que escalar con `ceil(N/25)`— pero no
su valor en el extremo grande.

### El contador va con retraso, y nos costaba la lectura entera

Lo más útil del diagnóstico es un fallo que no se habría visto de otra forma:

```
18/9, 07:57 [warn] Seguidores: descartado, leidos 106, el contador dice 105.
18/9, 11:28 [info] Seguidores: 106 · 5 peticiones
```

A las 07:57 la enumeración leyó 106 y el contador decía 105, así que se
descartó el snapshot. Tres horas y media después, el contador ya decía 106 y
exactamente la misma lista se aceptó: **los 106 eran correctos desde el
principio**, y el contador de Instagram iba con retraso.

La regla de reconciliación era simétrica —cualquier desajuste, descartar— pero
el peligro no lo es. **Leer de menos** significa que falta gente, y esa gente
aparece como baja falsa en el diff siguiente: descartar está bien. **Leer de
más** no puede significar eso: o el contador va con retraso, o alguien se fue
durante la lectura y saldrá como baja en el próximo diff, que es la verdad.
Desde ahora solo se descarta a la baja.

Hay evidencia de sobra del mismo ruido en la otra dirección: dos capturas
manuales separadas por un minuto leyeron 107 y 106, y una de ellas anotó «el
contador se movio de 107 a 106 durante la lectura». En una cuenta de 105
seguidores el contador oscila ±1 constantemente.
