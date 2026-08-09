# Archivo de handoffs (mayo 2026) — SOLO arqueología

Archivados el 2026-08-09 (dieta del runbook). **Ninguno contiene reglas vigentes**: todo lo operativo vivo está en `AGENTS.md` (runbook), `.claude/memory/STATE.md` (estado) y `.claude/memory/tech/runbook_*.md` (detalle por subsistema). Se conservan para rastrear el porqué histórico de decisiones de mayo de 2026. Índice anotado (era la sección "Latest Handoff" del CLAUDE.md antiguo):

- `HANDOFF-CLAUDE-2026-05-23-TELEGRAM-HIDDEN-PTY-POOL.md` — sesión 23 may (noche): pool de PTYs ocultos para enlace universal Mac→Telegram. Nuevo `main/telegram-hidden-pty-pool.js` (TTL 15min, LRU max 3, sweep 60s). Codex sigue por headless.
- `HANDOFF-CLAUDE-2026-05-23-FASE-B-LISTADO-EFICIENTE.md` — Fase B listado eficiente: stream JSONL + caches persistentes por mtime+size, paginación 50+. Regla que sigue viva (en runbook): `createSessionListing` usa late binding (getter) para índices.
- `HANDOFF-CLAUDE-2026-05-23-CWD-FIRST-STARTUP.md` — arranque cwd-first, multi-PTY, `main/recent-cwds.js`. Origen de la regla `build.files` es whitelist.
- `HANDOFF-CLAUDE-2026-05-22-NIGHT-TASKS-AGENT-FIRST-ROLLBACK.md` — refactor Tareas a agente-first → revertido a form clásico + botón 📌.
- `HANDOFF-CODEX-2026-05-22-WHATSAPP-GRUPOS-AUTO-GLOBAL.md` — grupos WhatsApp forzados a MANUAL + botón AUTO TODO.
- `HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md` — continuidad final WhatsApp (STOP/START bridge, QR modal, descarga media, race autoReply OFF).
- `HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md` — release 1.3.0: Electron 32 LTS (hoy 43), main.js modularizado a 34 módulos, WhatsApp bridge con auth token, hot session switch. Tag `release-1.3.0-2026-05-22`.
- `HANDOFF-CODEX-2026-05-21-*` (8 ficheros) — saga sesión remota LAN: modo empresa multioperador, ACL FS, flujo cámara/archivo chat-first, locks de sesión, UX móvil.
- `HANDOFF-CODEX-2026-05-20-LAN-REMOTE-OPERATIONS.md` — operaciones LAN remotas.
- `HANDOFF-CLAUDE-2026-05-19-*` (3 ficheros) — WhatsApp hardening + features + audio fix.
- `HANDOFF-CLAUDE-2026-05-18*.md` (6 ficheros) — Telegram relay PTY, sesiones, lupa, grafo cerebro, chat latency, reactor raíz x3.
- `HANDOFF-AGENT-PTY.md` — agente PTY original.
- `ELECTRON-32-UPGRADE-NOTES.md` — notas del upgrade a Electron 32 (superadas por `ELECTRON-43-UPGRADE-NOTES.md`, que sigue en la raíz).
