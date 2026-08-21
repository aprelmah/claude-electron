# Bug — el espejo duplicaba lo que Luismi escribía desde el móvil (2026-08-21 noche)

**Síntoma** (reportado por Luismi, Android/GBoard): escribiendo en el espejo LAN "a veces se
duplica y hace cosas raras". Al concretar salieron **los tres a la vez**: letras dobles
(`hhoollaa`), la palabra entera repetida al meter un espacio o corregir, y el ENTER
disparándose dos veces.

## Qué NO era

El servidor. Se descartó leyendo: `ws-server.js` escribe la tecla al PTY **una sola vez**
(`msgType === 'input'` → `session.ptyProcess.write`), `attachLanMirror` (`main.js:889`)
escribe una vez a `s.pty`, y ningún camino reenvía. Tampoco era doble attach: los watchers
son por sesión y cada uno tiene su propio socket.

Tampoco era falta de atributos. `xterm-helper-textarea` ya nace con `autocorrect="off"` y
`autocapitalize="off"` — se verificó dentro del bundle de `@xterm/xterm` 5.5.0.

## Causa raíz

**xterm.js está hecho para teclados físicos**: entrega al PTY cada evento según llega. El
teclado de Android no teclea, **COMPONE**:

- reescribe la palabra entera cuando metes un espacio o aceptas una corrección,
- emite `composition*` **e** `input` por el mismo carácter,
- e **ignora `autocorrect`/`autocapitalize`**, que no son atributos estándar en Android —
  xterm los pone y GBoard los ignora. Por eso el "arreglo por atributos" no existe.

Cada una de esas tres cosas produce uno de los tres síntomas. No era intermitente: era
sistemático con ese teclado, y casi invisible en iPhone (de ahí el "a veces").

## Arreglo (`9544b5e`)

No parchear el IME: **no darle el teclado del móvil a xterm**.

- El terminal del espejo pasa a `disableStdin: true` — es **PANTALLA**.
- Se escribe en un `<textarea>` normal (con corrección del móvil, y **viendo** lo que vas a
  mandar) y el texto sale ENTERO en un mensaje nuevo `mirror:send`. Las rarezas del IME
  quedan confinadas al textarea, donde son inofensivas porque las ves antes de enviar.
- El troceado —la única decisión con consecuencias— vive en `main/mirror-input-send.js`,
  puro y testeado, porque **el HTML remoto no lo cubre ningún test**:
  - texto y ENTER en escrituras **APARTE** (regla `pty-prompt-write`),
  - saltos finales recortados (dos ENTER seguidos envían dos veces),
  - multilínea envuelto en **bracketed paste** (`\x1b[200~…\x1b[201~`) SOLO si consta que el
    TUI lo pidió; el modo se aprende de `\x1b[?2004h/l` en el stream del host (con cola de 7
    caracteres, porque un chunk puede cortar la secuencia). Sin constancia, va crudo: **no se
    inventa una secuencia de control**.
- Botones: **⏎** (texto + ENTER), **⇢** (sin ENTER, para menús que responden a tecla suelta),
  **⏎** solo-Enter en la fila de teclas, y **⌨** que devuelve el teclado directo (apagado por
  defecto, avisa al encenderlo, se recuerda en el `localStorage` del móvil).
- Si el WS está caído al enviar, avisa y **no borra lo escrito**.

## Reglas que deja

1. **La excepción RAW del espejo es para las TECLAS, no para el texto.** `#keys` sigue
   escribiendo crudo (sanear mataría Esc, Tab, Ctrl·C); el texto del textarea pasa por
   `sanitizeChannelText`, igual que el audio del espejo.
2. **Un IME no es un teclado.** Ningún atributo HTML domestica la composición en Android.
   Si hay que escribir desde un móvil hacia un PTY: campo propio y mensaje entero.
3. **Un dato de control se aprende, no se supone.** El bracketed paste se activa porque el
   host lo anunció por el stream; si nunca lo anunció, no se usa.
4. Si alguien vuelve a reportar duplicados: **mirar primero si tiene el ⌨ encendido** — es el
   modo viejo, a un click, y se persiste entre recargas.

## Estado

Desplegado y **probado en real por Luismi desde Android: funciona**. Tests 1690/0/6 (+11:
`tests/mirror-input-send.test.js` y un e2e en `tests/ws-server-mirror.test.js` contra el
servidor real). Sin cobertura: la barra en sí (foco, autoGrow, toggle) vive en el HTML remoto.
Sin probar en real: el multilínea con bracketed paste contra el TUI de claude.
