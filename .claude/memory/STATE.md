# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-07 noche (segundo tramo), cierre de sesión._

# 🚦 EMPIEZA POR AQUÍ — Sesiones de codex: identificación y picker (2026-08-07 noche, 2º tramo)

Empezó con una pregunta sobre dos iconos de la topbar y acabó en 6 arreglos, todos disparados por Luismi probando en vivo. Reglas duras nuevas en CLAUDE.md §"Sesiones de codex: cómo se identifican y cómo se listan". Detalle del bug en `bugs/bug_codex_sessionid_picker_resume_2026_08_07.md`.

## Estado de entrega (verificado al cierre)

- `main` **ahead 5** de `origin/main` al escribir esto → **pusheado en este mismo cierre** (ver "Notas operativas" si el push falló). HEAD **`88aed1b`**, árbol limpio salvo los docs de este wrap.
- 5 commits: `32c6d75` (📌 prompt escrito + canal `pty-notice`), `d9b1475` (sessionId codex), `f3538ed` (picker: worktree + títulos), `4b0bfe9` (menú de directorio + conversación ocupada), `88aed1b` (reglas en CLAUDE.md).
- Tests: **1295 (1289 pass / 0 fail / 6 skip)** — el tramo empezó en 1233.
- Deploy: **HECHO** (5 deploys, el último tras los commits), asar verificado por CONTENIDO en cada uno.

## Próximo paso

- **Probar en vivo lo desplegado** (nada de esto lo ha confirmado Luismi todavía): el 📌 con un prompt escrito sin enviar; el picker de codex con títulos legibles; reanudar una sesión de codex sin ver el menú de directorio.
- **Cerrar el `codex resume` vivo en Terminal.app** (PID 53592 desde las 19:18, sesión `019fdd2a`): mientras siga abierto, esa conversación no se puede reanudar en la app (ahora avisa claro, ya no muere en silencio).
- Sigue vivo el backlog aprobado de más abajo (jardinero de memoria, escáner de skills, vocab de voz).
- Heredados: `/doctor` desde el móvil sin probar; quitar el `1` dummy de `telegram.allowedUsers`; el icono del panel (pulso) se camufla.

## Backlog aprobado por Luismi (2026-08-07 noche, "apúntalos y haremos")

Segunda ronda de robos de Hermes, por orden de valor:

1. **Jardinero de memoria** (el gordo; transversal, no de la app): Hermes acota la memoria con presupuesto visible y obliga a podar. El sistema de Luismi crece sin tope — `~/claude-shared/memory/02-feedback.md` ya pesa 73KB y el MEMORY.md del proyecto suma un bloque por sesión; todo entra al contexto de arranque. Hacer: pase periódico (o skill `/jardinero`) que compacte sesiones viejas en resúmenes, pode lo obsoleto y muestre presupuesto por archivo.
2. **Escáner de skills de terceros** (tarde corta): reutilizar `main/untrusted-input.js` en un `/revisar-skill` que pase revista a un SKILL.md/plugin antes de instalarlo (exfil, comandos destructivos, Unicode invisible), estilo el scanner del Skills Hub de Hermes.
3. **Vocabulario del modo voz** (tarde corta): el helper YA tiene `{cmd:'vocab'}` (contextualStrings) en el protocolo y nadie lo llama. Mandarle la jerga del proyecto activo (nombres de módulos, "worktree", "eatbook") al encender el modo voz.

## Qué se arregló en este tramo

1. **El botón 📌 abría vacío** (`prompt-capture.js`, nuevo): recordaba solo prompts YA ENVIADOS y no veía nada de lo que entra por `injectToPty` (dictado 🎤, arrastrar archivos, doble clic). La lógica sale de `renderer.js` para poder testearla (11 tests).
2. **Sesión codex nueva adoptaba la conversación anterior** (el mismo bug del mediodía en la rama que quedó como deuda). Y al quitar el fallback ciego apareció el defecto que tapaba: `lastLocalInputAt` en el filtro convertía "¿de quién es esta conversación?" en "actividad de los últimos 3,5 s". Criterio bueno: el `session_id` de codex es **UUIDv7** y lleva su hora de nacimiento dentro.
3. **El picker de codex enseñaba sesiones de mayo**: los rollouts graban el cwd del worktree; se atribuyen al repo por el nombre determinista del worktree (`worktreeSlugFor`), en el índice Y en el walk de respaldo.
4. **Todos los títulos iguales** ("# AGENTS.md instructions for…"): el primer `role:user` es preámbulo inyectado, y el prompt real estaba en el **byte 85.882** (fuera de los 64 KB que se leían). Índice a v2, que además valida su versión al cargar.
5. **Menú de directorio al reanudar codex**: lo contesta la app ("usar el directorio actual") y avisa por la barra de estado. El primer intento no disparó: el TUI pinta palabra a palabra y sin ANSI el texto queda **sin espacios**.
6. **`already has an active writer`**: codex se niega a reanudar una conversación abierta en otro sitio y moría sin explicar nada. Ahora sale un `pty-error` claro.

Fuera del repo: **`wrap-codex` reescrito** (`~/.codex/skills/wrap-codex/SKILL.md`, 179 líneas, backup `.bak.20260807`) — antes solo tocaba el `STATE.md`, así que cerrar con Codex perdía la memoria larga.

## Notas operativas

- **Método que funcionó y método que no**: los dos últimos bugs se resistieron a la lectura de código y cayeron con una **sonda de 30 líneas** sobre un PTY controlado (`tech/tech_sondar_cli_en_pty.md`). Tres hipótesis descartadas antes; la sonda acertó al primer intento.
- **Arreglar en cadena destapa el defecto de debajo**: si un fix correcto "revela" un fallo nuevo en el mismo sitio, suele ser la misma avería más abajo, no un bug nuevo.
- El handoff a Terminal NO es un spawn nuevo de PTY: abre una Terminal externa tras finalizar el worktree. Ojo, **deja un `codex`/`claude` vivo ahí fuera** y codex no admite dos escritores en el mismo hilo.
- Verificación por CDP en modo dev: `npx electron . --remote-debugging-port=9222` vía Terminal/osascript (el skill `verify` documenta el resto).
- `npx asar extract-file` SIEMPRE desde el scratchpad (extrae al cwd; ya pisó `main.js` una vez).
- Trampa vigente: `npm run deploy` no mata la instancia dev → SingletonLock → la empaquetada se suicida en silencio. Matar dev a mano antes.
- El helper de voz se prueba SUELTO por stdin/stdout para lo que no toque micrófono; lo que toca micrófono solo funciona como hijo de la app empaquetada.

---

# Sesión anterior — Profesionalización + doctor a demanda (2026-08-07 noche, 1er tramo)

Luismi pidió "si POWER-AGENT fuera tuyo, ¿qué harías?" y autorizó ejecutarlo entero en /loop. 4 fases + 4 remates pedidos en vivo. Reglas en CLAUDE.md §"Profesionalización (2026-08-07 noche)".

- `main` == `origin/main`, HEAD `a6c8c6e`. 10 commits: `f1b317d` (flakes+humo), `fb6ca9d` (doctor), `880b890` (propuestas+builder panel), `24043c9` (cableado app), `057dbb0` (docs), `0697bda` (CSS modal), `68c7817` (hora bitácora), `9d8fedb` (doctor manual panel), `2cbb03d` (/doctor Telegram), `a6c8c6e` (🩺 en /menu). Tests 1233. Deploy hecho, botón 🩺 probado en vivo.
- Los DOS flakes históricos eran la misma causa: puertos de test dentro del rango efímero del SO (49152–65535). Banda movida a 18500–19900. Test de humo `module-load-smoke.test.js` (73 requires).
- Doctor in-app (`main/health-watchdog.js`, 08:00 + botón 🩺 + `/doctor`), bandeja única de decisiones en el 🔔, panel "¿qué está pasando?" (📈).
- Antes, misma sesión (tarde): **aislamiento git por carpeta** (`gitIsolationExcludes` + selector + badge 🌿) — `dbbc772`+`62de42d`+`f6cfc90`.

# Sesión anterior — 4 robos de Hermes Agent (2026-08-07 tarde)

Veredicto: Hermes es el mejor agente personal genérico, pero no sustituye a POWER-AGENT (no pilota Claude Code, cobraría por API teniendo Max, sin el WhatsApp de negocio). 6 commits `d7fa0fd..5f0f089`, tests 1124, probado en vivo. Emparejamiento por código, saneado anti-inyección (`untrusted-input.js`), detector de encargos repetidos, búsqueda en contenido de sesiones.

# Sesión anterior — sessionId envenenado en sesión nueva (2026-08-07 mediodía)

`6956fd5` + `4e2814b` pusheados, tests 1079, deploy verificado por asar. Regla dura que nació aquí y volvió a hacer falta hoy: **un sessionId adivinado no se persiste jamás en la sesión**.
