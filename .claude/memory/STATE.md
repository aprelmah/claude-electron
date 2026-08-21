# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-21 noche (verificado contra git, filesystem, hash del asar y `npm run verify` en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` → `## main...origin/main`, sin ahead/behind). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `c75a636 docs(runbook): poda 16,3 → 15,6 KB`, `ec27340 docs(memory): cierre 2026-08-21 noche`, `9544b5e feat(lan): el móvil escribe en una barra; xterm deja de recibir el teclado`.
- Tests: **1690 pass, 0 fail, 6 skipped** (1672 + 10 de `mirror-input-send` + 1 e2e de `mirror:send`; el resto ya estaba). Suite completa en el pre-commit de `9544b5e`, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app` v1.3.0, asar del **2026-08-21 23:09**, verificado **por CONTENIDO**: `lan-mirror.html`, `main/ws-server.js`, `main/mirror-input-send.js`, `main.js` y `renderer.js` son byte-idénticos a HEAD (sha256).
- **`npm run verify` da 1 KO de RELOJ, no de contenido**: el deploy (23:09) se hizo ANTES del commit (23:20), así que su regla "asar ≥ último commit de código" dispara aunque el paquete lleve exactamente el código de HEAD — la propia línea `contenido 3/3 canarios idénticos a HEAD` lo desmiente. Si se despliega antes de commitear, este KO es esperado; comprobar por hash antes de creerlo.
- App corriendo **con ventana** (pid 52308, `--type=renderer`), lock legítimo, sin dev viva.
- **Bridge de WhatsApp: APAGADO y deshabilitado** (launchd, no cargado, 3031 libre). Sigue siendo el estado que Luismi quiere por defecto.

## Última sesión (2026-08-21 noche — el móvil deja de teclearle al PTY)

- **Bug del espejo cerrado y probado en real.** Luismi reportó duplicados escribiendo desde Android; salieron los tres síntomas juntos (letras dobles, palabra repetida, ENTER doble). Causa: **xterm entrega al PTY cada evento del teclado según llega y GBoard no teclea, COMPONE** — y `autocorrect`/`autocapitalize` no son estándar en Android, así que xterm los pone y el teclado los ignora. Ningún atributo lo arregla.
- **`9544b5e`** — el terminal del espejo pasa a `disableStdin` (es PANTALLA), se escribe en una barra con `<textarea>` y el texto sale ENTERO por un mensaje nuevo `mirror:send`. El troceado vive en `main/mirror-input-send.js` (puro y testeado): texto y ENTER en escrituras APARTE, saltos finales recortados y bracketed paste **solo si el TUI lo pidió** (el modo se aprende de `\x1b[?2004h/l` en el stream del host). Botones ⏎ / ⇢ / ⏎-solo, y toggle **⌨** que devuelve el teclado directo (apagado por defecto, se recuerda en el móvil).
- **Regla nueva**: la excepción RAW del espejo es para las **TECLAS** (`#keys`), no para el texto — el texto pasa por `sanitizeChannelText`, como el audio.
- Detalle: `bugs/bug_espejo_teclado_movil_duplicado_2026_08_21.md` y `tech/tech_lan_tunel_espejo_2026_08_15.md` § 2026-08-21 (noche).

## Riesgos abiertos

- **`npm run verify` NO detecta una página muerta** (heredado del cierre anterior): dice "proceso con ventana" con la UI rota por un `SyntaxError`. **Arrancar ≠ funcionar.** Candidato de mejora: comprobación de salud de la UI.
- **Y ahora se sabe que su regla de deploy es de reloj, no de contenido** (ver arriba). Segunda mejora candidata para `verify`: comparar por hash y degradar el KO a INFO cuando el asar coincide con HEAD.
- Sin cobertura: la barra del espejo (foco, autoGrow, toggle) vive en el HTML remoto, que ningún test toca. Solo el troceado está testeado.
- Sin probar en real: el multilínea con bracketed paste contra el TUI de claude (verificado en test, no en el móvil).

## Próximo paso

- **Uso real del espejo** con la barra nueva. Si aparecen duplicados otra vez: mirar PRIMERO si el toggle ⌨ está encendido (es el modo viejo y se persiste en el `localStorage` del móvil).
- **Decisión pendiente de Luismi**: el techo de 4 h del renewal del QR sigue intacto a propósito.
- ~~Poda del runbook~~ **HECHA** (`c75a636`): 16,3 → **15,6 KB**. LAN/túnel/espejo salen del cajón de relay a sección propia, y se comprimieron los nombres de función (verificando uno a uno que están en su ficha antes de quitarlos). Bajada real 725 B, no los ~2 KB estimados: el resto de ese bloque son invariantes y comprimirlos más sería tirar reglas. Para bajar de verdad habría que mudar una sección entera — decisión de producto, no técnica.

## Notas operativas

- **Para pruebas de varios días, desplegar a `/Applications`** — dev es solo para verificación puntual.
- **El script de deploy dice "✅ abierto" aunque la app se haya suicidado**: si hay una dev viva, sobrevive a su kill, retiene el `SingletonLock` y la empaquetada muere en silencio. Verificar SIEMPRE tras desplegar (proceso + lock).
- Un `<script src>` nuevo en `index.html` comparte ámbito global con `renderer.js`: nada de `const`/`let`/destructuring que repita un nombre. Lo vigila `tests/renderer-global-scope-collisions.test.js`.
- El JS inline de `lan-mirror.html` no lo comprueba ningún test: tras tocarlo, extraer los `<script>` y pasarles `node --check` (hecho en esta sesión desde el scratchpad).
- `tests/telegram-relay-concurrent-turns.test.js:87` es **sensible a timing**: si falla suelto, repetir antes de investigar.
- Node del sistema v24.13.0; el CI usa 20.18.0.
