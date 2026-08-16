# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-16 mañana (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` sin ahead/behind antes de la memoria de este cierre). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `50c21d0 fix(picker): personalidad y conocimiento solo en el paso de proyecto` y `23199a4 feat(kb): conocimiento apagado por defecto — se activa carpeta a carpeta`.
- Tests: **1630 pass, 0 fail, 6 skipped** (1636 totales) — suite completa en el pre-commit hook de ambos commits, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-16 10:35** = el código commiteado (verificado por contenido: `profileBarEl` en `project-picker.js` y `KB_PREFS_DEFAULT = false` en `main/kb-prefs.js`) y app corriendo con ventana (`--type=renderer`), sin dev viva.
- **Disco: 6,0 GB libres** tras borrar `dist/` (2 GB, con OK de Luismi) — el primer deploy falló por ENOSPC con el disco al 100%. Sigue justo; limpieza mayor pendiente (fuera del proyecto).

## Última sesión (2026-08-16 mañana — conocimiento OFF por defecto y el picker ordenado)

- **`KB_PREFS_DEFAULT = false`**: el conocimiento se activa carpeta a carpeta. Semántica de `kb-prefs.json` invertida: sin entrada = OFF; carpetas que estaban ON implícito salen sin Casos/Fichas hasta marcarlas una vez. Fallbacks alineados en picker, popover AGENTE y `kb-panel.js`; tests de `kb-prefs` invertidos.
- **Decisión de producto**: personalidad y conocimiento se eligen en el paso de PROYECTO del picker y valen para el proyecto entero; en "Elige sesión" la barra no aparece (dentro de la app se cambian en AGENTE). No duplicar controles entre pasos.
- Fallo propio de la sesión, revertido en caliente: añadí una segunda casilla en "Elige sesión" sin ver que `.picker-profile-bar` es markup común a las dos vistas (vive fuera de las `<section>`) → duplicada. Trampa documentada en la ficha.
- `showViewProject()` ahora resetea `state.cwd` y `kbPending`: la casilla ya no escribía contra la carpeta anterior al volver con "Cambiar".
- Detalle técnico: `tech/runbook_kb_conocimiento.md` § 2026-08-16.

## Próximo paso

- **Escanear un QR contra la EMPAQUETADA** (el dev funcionó la sesión anterior; el asar está verificado por contenido, no por uso real del QR).
- **Caso "invitar a cliente" a medias como producto** ("somos tres"): el candidato de diseño es el device-flow con aprobación en el Mac. Decidir y diseñar.
- Techo de 4 h del renewal del espejo es fijo: si Luismi consolida el uso de jornada completa, hacerlo configurable.
- Seguridad decidida-no-ejecutada: Cloudflare Access (túnel fijo con dominio + login por email) si POWER-AGENT se usa con clientes reales.
- Arrastrados: Origin-check del WS, poda de exports, session-listing async, flake puerto 16849, **picker/`kb-panel.js` sin cobertura** (hoy volvió a morder: los dos ajustes del picker los cazó Luismi probando, no la suite), LAN/voz remota y worker del grafo empaquetado sin prueba en real.

## Notas operativas

- **Conocimiento default OFF** (`main/kb-prefs.js`); la barra PERSONALIDAD+CONOCIMIENTO del picker solo en el paso de proyecto. `KB_DEFAULT` en `project-picker.js` espeja `KB_PREFS_DEFAULT` (el picker no puede hacer require).
- **QR espejo: 1 uso / 90 s; renewal solo lo emite el servidor, no encadenable, techo 4 h.** Constantes en `main/lan-session-invites.js` (`MIRROR_QR_*`, `MIRROR_RENEWAL_*`).
- `showShareInternetBar` acepta `qr` (data URL); toda llamada sin él lo oculta.
- **Binario externo que la app spawnee → ruta absoluta vía `main/cli-resolver.js`** (la empaquetada no hereda `/usr/local/bin`).
- La vista Chat de `lan-client.html` NO pinta stream crudo del PTY: "ver el terminal" = vista terminal o `lan-mirror.html`.
- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por asar DESDE el scratchpad **y por PROCESO con ventana** (dev viva retiene el SingletonLock y la empaquetada se suicida en silencio).
