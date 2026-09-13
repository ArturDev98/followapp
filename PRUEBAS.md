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
> Si ves algo raro —o si no ves nada en dos días— avísame y te digo cómo
> sacarme el diagnóstico.

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
| `leidos X, el contador dice Y` | Desajuste de reconciliación: el caso que produce bajas falsas |

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
