# Modo voz — checklist para probarlo tú, Luismi

Esto es lo único que falta del modo voz. El código, los tests (943, todos verdes) y toda la
documentación están terminados. Lo que queda no lo puede hacer un agente: hay que darle un
permiso a macOS en un diálogo, y hay que oír con tus oídos si se calla cuando le hablas encima.

Calcula unos 10-15 minutos. Ve en orden: los primeros puntos son los que, si fallan, bloquean
todo lo demás.

Antes de empezar: la app tiene que estar recién desplegada (`/Applications/POWER-AGENT.app`,
build de hoy). Ábrela normal, con doble clic o desde Finder.

---

## 1. El permiso de micrófono (esto va primero, es lo que más puede bloquear)

**Qué hacer:** abre la app, elige un proyecto y una sesión de **Claude** (no Codex — el modo voz
no funciona con Codex, lo explico más abajo). Busca el botón nuevo en la barra de arriba: está a
la derecha del icono de "burbuja de chat" (sub-chat) y a la izquierda del icono de la chincheta
(fijar ventana). Es un icono de **ondas**, como un ecualizador de barras — no es el micrófono
normal, ese sigue en la barra del terminal y es el dictado de siempre. Púlsalo.

**Qué debería pasar:** macOS te pregunta si autorizas el micrófono, y luego si autorizas el
reconocimiento de voz. Dile que sí a las dos.

**Qué significa si NO pasa:**
- Si no sale ningún diálogo y el botón se queda con un **borde naranja/ámbar** (sin relleno de
  color, sin parpadeo): el motor de voz no ha arrancado. Pasa el ratón por encima del botón, debe
  decir algo como "el motor de voz no arrancó (¿permiso de micrófono?); pulsa para reintentar".
  Prueba a pulsarlo otra vez. Si sigue igual, ve al apartado "Si algo falla" al final.
- Si dijiste que NO por error: ve a Ajustes del sistema → Privacidad y seguridad → Micrófono (y
  también → Reconocimiento de voz), busca POWER-AGENT y actívalo a mano. Luego vuelve a pulsar el
  botón.
- **Nota importante:** como la app no está firmada digitalmente, es posible que macOS te vuelva a
  pedir este permiso cada vez que se reinstale una versión nueva (cada `npm run deploy`). No es un
  fallo, es de esperar.

## 2. Con Codex activo, el botón debe estar apagado y deshabilitado

**Qué hacer:** si tienes una sesión de Codex abierta (en vez de Claude), mira el botón de ondas.

**Qué debería pasar:** se ve gris/apagado y no se puede pulsar. Si pasas el ratón por encima,
dice algo como "Modo voz — solo disponible con Claude, no con Codex".

**Qué significa si NO pasa:** si el botón se puede pulsar con Codex activo, o si cambias de
Claude a Codex (desde el selector de la barra de arriba, desde Ajustes, o reanudando una sesión
antigua de Codex) y el botón se queda "encendido" en vez de apagarse solo — anótalo, es justo el
bug que más preocupa: un botón que dice que está escuchando cuando en realidad no puede.

## 3. Hablar y ver el texto aparecer

**Qué hacer:** con el modo voz encendido (botón en rojo, parpadeando — es el estado
"escuchando"), di una frase cualquiera en voz alta y normal, sin gritar ni susurrar.

**Qué debería pasar:** según hablas, va apareciendo el texto reconocido en un aviso flotante
abajo, en el centro de la pantalla. Debería notarse casi inmediato (menos de 1 segundo desde que
empiezas a hablar).

**Qué significa si NO pasa:** si tarda mucho en aparecer texto, o no aparece nada aunque estés
hablando claro, anótalo — puede ser el micro mal seleccionado en macOS, o un problema de red (este
modo usa los servidores de Apple, así que sin conexión no funciona: prueba el punto 11 más abajo).

## 4. Callar y que conteste solo

**Qué hacer:** termina la frase y quédate callado.

**Qué debería pasar:** en poco más de un segundo de silencio, el botón cambia a **morado/violeta**
fijo (sin parpadeo) — está "pensando". Al rato, el botón se pone **verde** y empieza a oírse la
respuesta leída en voz alta. No hay que tocar nada en ningún momento.

**Qué significa si NO pasa:** si te quedas callado y el botón sigue en rojo sin pasar a morado, o
se queda "pensando" para siempre sin llegar nunca a hablar, anótalo con lo más exacto posible: qué
dijiste, cuánto esperaste, y en qué color se quedó el botón.

## 5. Háblale encima mientras está contestando (esto es lo más importante de todo el checklist)

**Qué hacer:** en cuanto el botón se ponga verde y empiece a leer la respuesta, interrúmpelo
hablando tú por encima, con voz normal.

**Qué debería pasar:** se calla **en el acto**, el botón vuelve a ponerse rojo (escuchando) sin
que hayas tocado nada, y puedes seguir hablando como si nada.

**Qué significa si NO pasa:** si sigue leyendo por encima de tu voz sin callarse, es el fallo más
grave posible del modo voz — anótalo con detalle (qué estabas diciendo, si hablaste fuerte o
flojo, si había ruido de fondo) y repórtalo antes que cualquier otro punto.

## 6. Lo mismo, pero por el altavoz del Mac, sin auriculares

**Qué hacer:** repite el punto 5, pero asegúrate de que el sonido sale por el altavoz del
ordenador (no auriculares ni AirPods) y de que el volumen está a un nivel normal, ni muy bajo ni
al máximo.

**Qué debería pasar:** exactamente igual que en el punto 5 — se calla cuando le hablas.

**Qué significa si NO pasa:** si la app se interrumpe **a sí misma** sin que tú digas nada (el
micrófono capta su propia voz saliendo del altavoz y se confunde), es el problema contrario y
también grave: anótalo. Esto ya se comprobó una vez con éxito durante el desarrollo, pero conviene
repetirlo con tu Mac y tu volumen real.

**Aviso aparte, no es un fallo si pasa:** si hay ruido de fondo constante y fuerte en la
habitación (tele, ventilador, gente hablando) mientras la app está leyendo en voz alta, es posible
que se autointerrumpa por ese ruido. Es un límite conocido, no hace falta que lo reportes salvo
que pase en una habitación tranquila.

## 7. Decir "hazlo" y comprobar que entra en la sesión de trabajo, no en un chat aparte

**Qué hacer:** con una sesión de Claude en marcha donde ya le hayas pedido algo (por ejemplo, que
lea un archivo o proponga un cambio), activa el modo voz y di algo como "hazlo", "aplícalo" o
"ejecuta eso".

**Qué debería pasar:** la orden entra en la sesión principal donde estabas trabajando — verás la
terminal de esa sesión reaccionar al comando de voz, como si lo hubieras escrito tú.

**Qué significa si NO pasa:** si la orden no llega a ningún sitio, o llega pero a un panel lateral
distinto en vez de a la sesión principal, anótalo.

## 8. El primer turno de una charla (no un encargo) — punto que puede fallar por timing

**Qué hacer:** con el modo voz encendido, en vez de dar una orden de "hazlo", **pregúntale algo**
sin más — por ejemplo "¿qué hora es en Tokio ahora mismo?" o "explícame qué hace este proyecto en
dos frases". Tiene que ser la **primera** pregunta de este tipo desde que encendiste el modo voz
en esta sesión.

**Qué debería pasar:** contesta hablando, igual que en el punto 4.

**Qué significa si NO pasa:** este es un punto que los desarrolladores dejaron marcado como "no
medido, solo estimado" — hay un tiempo de arranque interno (algo más de un segundo) que nunca se
ha comprobado con el sistema real, y si no basta, la primera pregunta se puede perder o tardar
mucho más de lo normal. Si el PRIMER intento de charla (no de encargo) falla o tarda muchísimo más
que las siguientes veces, es exactamente el caso que hay que confirmar: anótalo diciendo si era la
primera vez que preguntabas algo así en esa sesión, y prueba otra vez para ver si la SEGUNDA
pregunta va mejor.

## 9. Un encargo con herramientas — que lea la conclusión, no el trabajo técnico

**Qué hacer:** pídele por voz algo que le obligue a usar herramientas (leer varios archivos,
hacer una búsqueda, editar código) y espera a que termine.

**Qué debería pasar:** cuando acaba, te lee en voz alta un resumen en prosa de lo que hizo o
concluyó — nunca fragmentos de código, ni diffs, ni rutas de archivo larguísimas leídas letra a
letra.

**Qué significa si NO pasa:** si te lee código, diffs, o cosas técnicas ilegibles en voz alta,
anótalo con un ejemplo de lo que dijo.

## 10. Que entienda bien los nombres propios del proyecto

**Qué hacer:** di en voz alta, con naturalidad, tres nombres técnicos del repo — por ejemplo
"voice session", "relay through pty" y "subchat pty" (o cualquier otro nombre de módulo o archivo
que uses a menudo).

**Qué debería pasar:** el texto reconocido (el que aparece en el aviso flotante mientras hablas)
se parece razonablemente a lo que dijiste.

**Qué significa si NO pasa:** si los transcribe mal de forma sistemática (por ejemplo "voice
session" sale como "voy sesión" o cosas sin sentido), no es necesariamente un fallo del código: es
un ajuste pendiente y conocido (el sistema tiene forma de aprenderse vocabulario técnico, pero
todavía no está conectado). Anótalo igualmente, con ejemplos concretos de qué dijiste y qué
entendió.

## 11. Sin conexión a internet, que avise en vez de quedarse colgado

**Qué hacer:** corta el wifi del Mac (o desconecta el cable) con el modo voz encendido, y prueba a
hablar.

**Qué debería pasar:** algún tipo de aviso claro de que algo va mal (un mensaje de error visible),
no un silencio eterno ni la app pareciendo colgada.

**Qué significa si NO pasa:** si se queda "pensando" o "escuchando" sin decir nada durante mucho
rato y sin ningún aviso, anótalo. Este modo necesita internet siempre (usa los servidores de
Apple), así que sin red no debería intentar disimularlo.

## 12. Cómo suena la voz, en general

**Qué hacer:** simplemente, escucha un par de respuestas completas y valora si la voz te resulta
agradable o al menos aceptable de escuchar.

**Qué debería pasar:** una voz que se entienda bien, aunque sea artificial.

**Qué significa si NO pasa:** las voces que trae macOS de fábrica en español suenan bastante
robóticas. Si te resulta molesto, hay una voz mejor (*Mónica Mejorada*) que se descarga desde
Ajustes del sistema → Accesibilidad → Contenido hablado → Gestionar voces — es un paso manual tuyo,
no algo que arregle el código. Dime si quieres que alguien te la deje seleccionada por defecto (hoy
no hay un botón en la app para elegir voz, solo se puede fijar tocando un archivo de configuración).

## 13. El botón, en general: que nunca mienta sobre lo que está pasando

**Qué hacer:** a lo largo de toda la prueba, fíjate en el color del botón de ondas:

- **Sin color, como cualquier otro botón** → apagado, en reposo.
- **Rojo y parpadeando** → escuchando.
- **Morado/violeta fijo** → pensando, el micro está cerrado a propósito, hablar no sirve de nada
  en ese momento.
- **Verde** → hablando (leyendo la respuesta).
- **Borde naranja/ámbar, sin relleno** → roto, no ha podido arrancar (ver punto 1).

**Qué debería pasar:** el color siempre coincide con lo que realmente está haciendo la app. Al
apagar el modo voz (pulsando el botón otra vez, en cualquier color), siempre vuelve a "sin color".

**Qué significa si NO pasa:** si en algún momento el botón se queda "pegado" en rojo, morado o
verde sin que la app esté haciendo realmente eso (por ejemplo, sigue en rojo pero no reacciona
aunque le hables, o sigue en verde mucho después de que se haya callado del todo), es el fallo más
importante que puede haber en la interfaz: un botón que miente sobre el estado real. Anótalo con
el máximo detalle posible: qué hiciste justo antes, y cuánto tiempo llevaba así cuando te diste
cuenta.

---

## Si algo falla: qué mirar y qué recoger

1. **Mira la ventana de Terminal donde se lanzó la app** (si la app está corriendo en modo
   desarrollo, vía `npm start`) — ahí suele salir el motivo técnico del fallo. Si es la app
   instalada normal (doble clic), no hay Terminal visible; en ese caso pasa directamente al punto
   siguiente.
2. Ejecuta `npm run doctor` desde una terminal en la carpeta del proyecto
   (`/Users/isabel/Desktop/LUISMI/claude-electron`) y guarda lo que imprime. **Aviso: hoy este
   comando todavía no comprueba nada específico del modo voz** (ni el binario de voz, ni las
   herramientas de compilación de Apple), así que si el fallo es justo ahí, `doctor` no lo va a
   detectar — igualmente es útil para descartar el resto.
3. Anota, para cada fallo: qué punto del checklist era, qué esperabas que pasara, qué pasó de
   verdad, y en qué color se quedó el botón (si aplica). Con eso basta para que se pueda reproducir
   sin tener que estar delante contigo.
4. No hace falta que arregles nada tú, ni que reinicies la app repetidamente probando cosas al
   azar — con la nota del punto 3 es suficiente para retomarlo.
