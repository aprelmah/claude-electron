# INDEX — mapa de fichas de `.claude/memory/`

Una línea por ficha: qué es y cuándo leerla. Toda ficha nueva se registra aquí (contrato de capas del runbook). Actualizado: 2026-08-11.

## Estado y proyecto

- `STATE.md` — estado vivo verificado (rama, tests, deploy, próximo paso). SIEMPRE lo primero.
- `project_power_agent.md` — qué es POWER-AGENT, historia y rebranding. Contexto general del proyecto.
- `project_backup_nas_v2.md` — diseño del backup al NAS QNAP (snapshots rsync + link-dest). Leer antes de tocar `copiada-naa.sh`.
- `feedback_claude_electron_deploy.md` — cómo quiere Luismi los deploys y las pruebas en este proyecto.
- `audit_code_review_2026_08_03.md` — revisión multi-agente del pipeline KB de WhatsApp: 15 defectos, todos cerrados.

## Runbooks por subsistema (operativo vigente, movido del CLAUDE.md el 2026-08-09)

- `tech/runbook_execution_policy_delegations.md` — política de ejecución, registro de skills y delegaciones: límites, persistencia y worktrees (09-08-2026).
- `tech/runbook_relay_telegram.md` — relay claude por JSONL, forks del sessionId y sus guardas, badge de modelo, auto-update de CLIs. Leer antes de tocar relay/sesiones/PTY.
- `tech/runbook_git_por_sesion.md` — aislamiento git por worktree, finalize, regla para spawns nuevos, limitaciones. Leer antes de añadir cualquier spawn.
- `tech/runbook_modo_voz.md` — modo voz completo: motor, helper Swift, endpointing, lectura a trozos, cola de habla. Leer antes de tocar voz.
- `tech/runbook_codex_sesiones.md` — UUIDv7, atribución por worktree, TUI sin espacios, un solo writer. Leer antes de tocar sesiones codex.
- `tech/runbook_telegram_bridge.md` — comandos del bot, notas de voz (Apple/whisper), bot de avisos separado, configuración de la app.
- `tech/runbook_hermes_robos.md` — pairing por código, saneado de canal, detector de repetidos, doctor, bandeja de decisiones, panel 📈, reglas de tests.
- `tech/runbook_incidentes_2026_05.md` — crash de arranque de mayo (SIGABRT/savedState), fixes permanentes y notas operativas de recuperación.
- `tech/runbook_kb_conocimiento.md` — conocimiento por proyecto: **11-08-2026: ventana modal retirada, ahora 3 pestañas hermanas Chat/Casos/Fichas dentro del IDE** (`kb-panel.js`), Casos editables/borrables individualmente, voz en el editor de Caso, auto-ajuste al redimensionar. Imports @ del CLAUDE.md, destilador PDF/web/YouTube, auto-commit tras cada escritura, aplicar a sesión, reglas duras y patrón CDP de verificación de UI. Leer antes de tocar `kb-panel.js`/`kb-ipc.js`/`knowledge-base.js`.

## Fichas técnicas (lecciones con el porqué)

- `tech/tech_modo_voz.md` — arquitectura real del modo voz post-implementación y pendientes.
- `tech/tech_modo_voz_mediciones.md` — mediciones de motores STT en este i7 (RTF, latencias). NO repetir las mediciones.
- `tech/tech_modo_voz_permisos_macos.md` — permisos de micrófono con app sin firmar; bundle VoiceHelper.app en deploy.sh.
- `tech/tech_voces_apple_siri_bloqueadas.md` — las voces de Siri están capadas por entitlement de sistema. Cerrado con datos: no reintentar.
- `tech/tech_whisper_anti_hallucinations.md` — filtros anti-alucinación del dictado whisper.
- `tech/tech_xterm_dictation_macos.md` — dictado nativo de macOS sobre xterm.js: trampas.
- `tech/tech_telegram_pty_pool.md` — pool de PTYs ocultos de Telegram (TTL, LRU, binding); regla "sin fallback headless con binding".
- `tech/tech_telegram_bridge_headless.md` — ruta headless del bridge: spawn, orígenes, límites.
- `tech/tech_latencia_cli_bot.md` — latencia de spawns del CLI: el entorno personal se hereda entero.
- `tech/tech_codex_cli_quirks.md` — rarezas del CLI de codex (flags, resume, sandbox).
- `tech/tech_electron_launchd_fdlimit.md` — límite de file descriptors al lanzar Electron desde launchd.
- `tech/tech_electron_multi_window.md` — multi-ventana en Electron: ciclo de vida y trampas.
- `tech/tech_launchctl_modern.md` — launchctl moderno (bootstrap/bootout vs load) en este macOS.
- `tech/tech_llm_plist_truncation.md` — los LLM truncan plists largos: cómo generarlos seguros.
- `tech/tech_macos_bash_rsync_landmines.md` — minas de bash/rsync en macOS (BSD vs GNU).
- `tech/tech_pilotar_app_por_cdp.md` — pilotar POWER-AGENT por Chrome DevTools Protocol para probar de verdad.
- `tech/tech_sondar_cli_en_pty.md` — sondar un CLI en un PTY controlado (la sonda que cerró los bugs de codex).
- `tech/tech_perfiles_persona_invisible.md` — persona por perfil vía `--append-system-prompt` (invisible, aditiva, al spawn) y persona VIVA por hook; el perfil activo es config GLOBAL que `startPty` lee en el spawn, y se puede elegir desde el picker de arranque; WhatsApp es otro sistema. Leerla antes de tocar perfiles, personas o el selector del picker.
- `tech/security_audit_2026-06-01.md` — auditoría de seguridad de junio: hallazgos y estado.

## Bugs resueltos (leer si reaparece el síntoma)

- `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md` — flake intermitente `cancelledByParent` en esos dos tests, sin relación con lo que se toque; SIN resolver, solo documentado (10-08-2026).
- `bugs/bug_task_manager_skills_multiselect_2026_08_09.md` — selector nativo múltiple de skills difícil de limpiar en macOS y corrección visual (09-08-2026).
- `bugs/bug_scripts_renderer_ambito_global.md` — un `const` duplicado en scripts sueltos del renderer mata la página; los tests no lo ven.
- `bugs/bug_relay_telegram_transcript.md` — el relay mandaba la pantalla raspada en vez de la respuesta (transcript no localizado).
- `bugs/bug_codex_sessionid_picker_resume_2026_08_07.md` — codex: id equivocado, picker congelado, resume roto (saga completa).
- `bugs/bug_codex_auto_update_eacces.md` — auto-update de codex moría por EACCES (PATH del PTY con node equivocado).
- `bugs/bug_pty_hereda_sesion_2026_08_03.md` — los PTYs heredaban la identidad de la sesión que lanzó la app.
- `bugs/bug_telegram_titulo_sesion_2026_08_04.md` — la instrucción de la app secuestraba el título de las sesiones de Telegram.
- `bugs/bug_wa_qr_loggedout_2026_08_03.md` — el QR no reaparecía tras `loggedOut` de WhatsApp.
- `bugs/bug_wa_qr_rate_limit_2026_08_02.md` — modal QR vacío por rate limit del propio bridge.
- `bugs/bug_wa_sendtext_reconexion_2026_08_02.md` — envío perdido al coincidir con reconexión del bridge (→ `bridgeFetchWithRetry`).

## Decisiones (producto y arquitectura)

- `decisions/lan-remoto-seguro-2026-08-07.md` — acceso LAN/remoto seguro: selector de proyectos, invitaciones, HTTPS/WSS, plan Cloudflare.
- `decisions/bridge_en_git_2026_08_03.md` — el bridge de Baileys entra en git (`whatsapp-bridge/`).
- `decisions/kb_whatsapp_2026_08_02.md` — diseño de la base de conocimiento del bot de WhatsApp (selector → ancla → marcador verificado).
- `decisions/kb_fichas_ejemplo_turbo_2026_08_02.md` — ⚠️ 3 fichas de ejemplo (Turbo Energy) sembradas en la KB real sin validar por Luismi.
- `decisions/kill_switch_whatsapp_2026_08_02.md` — cuál es el kill switch del bot de WhatsApp y dónde vive.
- `decisions/telegram_proyecto_manda_2026_08_04.md` — el proyecto elegido en Telegram manda sobre lo abierto en el Mac.
