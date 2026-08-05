# Modo voz — arquitectura real y pendientes (post-implementación)

_2026-08-05. Complementa `tech_modo_voz_mediciones.md` (mediciones y trampas del Swift, escrito ANTES de implementar, sesión 2026-08-04 noche). Este archivo es el después: qué se construyó de verdad, dónde se desvió del plan y qué queda abierto tras las 8 tareas de implementación + Tarea 9 pasos 1, 2 y 4 (documentación). Sigue faltando el paso 3 (prueba manual con micrófono) — checklist en `CHECKLIST-VOZ-MANUAL.md`, raíz del repo._

## Los seis módulos de `main/` + la UI

| pieza | responsabilidad |
|---|---|
| `main/voice-helper-process.js` | proceso hijo del `.swift`, reensamblado NDJSON, freno de reintentos (patrón de `main/native-notify.js`) |
| `main/voice-session.js` | máquina de estados `idle→listening→thinking→speaking`, dueña del proceso helper |
| `main/voice-router.js` | charla (sub-chat) vs encargo (sesión madre), por patrones de texto — el toggle manual de la UI siempre gana a la detección |
| `main/voice-send-target.js` | dónde escribe cada turno y qué transcript vigilar; aquí viven las trampas del fork del sessionId |
| `main/voice-speakable.js` | markdown → prosa hablable (fuera código, diffs, tablas, URLs; si no queda nada, no se habla) |
| `main/voice-turn-watcher.js` | vigila el `.jsonl` hasta `turnComplete`, reutilizando `main/relay-transcript-helpers.js` |
| `voice-ui-state.js` (raíz) | lógica pura evento→acción de UI, sin DOM ni IPC — `renderer.js` no se testea en ningún sitio del repo, este módulo es el patrón para poder testear algo de la interfaz |

Swift: `voice-helper/VoiceHelper.swift` → compilado a `resources/voice-helper` (fuera del asar, vía `extraResources` en `package.json`; un binario dentro del asar no es ejecutable).

IPC (`preload.js` / `main.js`): `voice:enable`, `voice:disable`, `voice:set-mode`, `voice:state` (invoke) + push `voice:event`. Un solo dueño por app (`voiceOwnerWcId` en `main.js`), no por ventana.

## Desviaciones reales del plan (con el motivo)

1. **El micro NO se cierra mientras habla, solo mientras piensa.** El plan pedía cerrado en los dos estados. El barge-in (`user-interrupt`) sale del callback del tap de audio (`onAudio` en el Swift); con el micro cerrado ese callback no se ejecuta y el barge-in sería código muerto. Cerrado mientras THINKING (la ventana larga) sigue cubriendo el riesgo de ruido de sala que preocupaba al plan. Riesgo residual: ruido de sala constante por encima del umbral RMS (0,012) auto-interrumpe la lectura — audible al instante, se recupera solo. Detalle: `.superpowers/sdd/2026-08-04-voz-en-directo/task-6-report.md` §2.
2. **El gate "solo claude" vive en dos sitios, no solo en `voice-session.js`.** El contrato inicial de la Tarea 6 decía que bastaba con revalidar dentro del módulo (por turno). El renderer añade una segunda capa proactiva: deshabilita el botón con codex activo, y lo apaga solo si cambias de CLI con la voz encendida — porque la revalidación de `voice-session.js` es reactiva al siguiente turno, no al instante del cambio, y sin la capa del renderer el botón se quedaba "escuchando" (rojo, pulsando) con un CLI que ya no servía. Cubre tres vías reales: selector de CLI de la topbar, Ajustes → CLI por defecto, y reanudar una sesión de codex desde el modal de sesiones anteriores. Detalle: `task-8-report.md` §3 y §7.1.
3. **`sendToTarget` no vive en `main.js` sino en `main/voice-send-target.js`.** Desviación del contrato original de la Tarea 6 (que lo daba por hecho inline), aprobada sin reservas en revisión: es donde viven todas las trampas del fork del sessionId, y todas necesitaban test aislado.

## Pendientes conocidos (no bloqueantes, pero reales)

- **Exclusión mutua voz↔Telegram sin cerrar.** El modo voz solo LEE `session.relayActive`, nunca lo marca mientras dura su propio turno. Un Telegram que llega a mitad de un turno de voz (el caso más probable: un turno de voz dura decenas de segundos) mezcla las dos respuestas en el mismo PTY. No corrompe nada (el TUI encola) pero cruza respuestas. Solución acordada, sin implementar: cerrojo con caducidad `session.voiceTurnUntil = Date.now() + 180000`, que `relayThroughPty` respetaría igual que `relayActive` y que caduca solo. Detalle en "§Git automático por sesión" de `CLAUDE.md`.
- **`extraResources` sin verificar con un `npm run dist` real.** Solo se ha probado con los hooks `pre*` de `build:zip`/`dist`. Si el bit de ejecución del binario no sobrevive a la copia, el helper falla solo en la app empaquetada, nunca en dev.
- **Solo se ha compilado `x86_64`.** Este Mac es Intel; un build `arm64` empaquetaría el binario equivocado sin avisar (no hay chequeo de arquitectura en `extraResources`).
- **`{cmd:'vocab'}` existe en el protocolo del helper pero nadie lo manda.** Si el punto del checklist manual sobre nombres de módulos del repo sale mal, este es el enganche que falta — no un fallo del reconocimiento en sí.
- **No hay selector de voz en la UI.** `cli.voiceId` se persiste (whitelist `SAFE_CLI`) y se manda al helper tras cada `enable()`, pero hoy solo se puede fijar editando el config JSON a mano (`~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json`).
- **`scripts/doctor.sh` no diagnostica el modo voz.** No comprueba `resources/voice-helper` ni si `swiftc`/Xcode Command Line Tools están instalados. Si el checklist manual falla por un binario ausente, `doctor.sh` no lo va a decir todavía.
- **La detección de fork del sessionId cubre el sub-chat de voz y el spawn con `--resume`, pero NO el pool de PTYs ocultos de Telegram ni las task-sessions** (regla ya conocida y documentada del repo, heredada, no específica del modo voz).

## Checklist manual (Tarea 9, paso 3)

Vive en `CHECKLIST-VOZ-MANUAL.md`, raíz del repo — escrito para Luismi, no para un agente. Es el único paso de la Tarea 9 que un agente no puede cerrar: el permiso de micrófono/reconocimiento lo concede un humano en un diálogo de macOS, y el barge-in hay que oírlo.

## Enlaces

- Mediciones y trampas del Swift (pre-implementación): `tech_modo_voz_mediciones.md`
- Spec: `docs/superpowers/specs/2026-08-04-voz-en-directo-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-voz-en-directo.md`
- Informes de cada tarea de la SDD: `.superpowers/sdd/2026-08-04-voz-en-directo/task-{1..8}-report.md`
- Registro de revisión con todas las rondas: `.superpowers/sdd/2026-08-04-voz-en-directo/progress.md`
