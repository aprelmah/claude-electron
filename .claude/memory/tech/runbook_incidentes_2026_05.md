# Runbook — Historial de incidentes de arranque (2026-05-14) y notas operativas

> Movido íntegro del CLAUDE.md raíz el 2026-08-09 (dieta del runbook, R6).

## Incident history

- Date: **2026-05-14**
- Symptom 1: app crash on startup (`SIGABRT`, stack in `_RegisterApplication` / `NSApplication`).
- Symptom 2: packaged app crash with secure-restorable-state warning behavior.
- Symptom 3: `.dmg` build failure from constrained environments.

## Root cause summary

- Startup crash was tied to macOS saved application state + missing explicit secure restorable-state opt-in.
- DMG build failure was environment-level: `hdiutil` cannot run in sandboxed sessions (`Cannot start hdiejectd because app is sandboxed`).

## Permanent fixes applied

1. `package.json` incluye `build.mac.extendInfo.NSApplicationSupportsSecureRestorableState = true`.
2. Script de recuperación: `npm run reset:state` — respalda si existen:
   - `~/Library/Saved Application State/com.github.Electron.savedState`
   - `~/Library/Saved Application State/com.luismi.claude-electron.savedState`
   - `~/Library/Saved Application State/com.luismi.claude-novak.savedState`
3. Diagnóstico: `npm run doctor`.
4. Resolución de CLI robusta en `main.js`: env vars / `~/.local/bin` / PATH fallback para `claude`, `codex`, `whisper`.
5. PTY hardening en main/renderer: valida CLI activo antes del spawn; emite `pty-error` con mensaje explícito; restart/resume rechazan bien en errores de spawn; el cambio de CLI hace rollback al anterior si falla el restart.

## Operational notes

- Si la app vuelve a crashear al arrancar: `npm run doctor` → `npm run reset:state` → rebuild (`npm run build:zip` o `npm run dist`).
- Si `npm run start` falla solo en runners restringidos/sandbox: verificar en una terminal local normal (el `SIGABRT` antes de cargar JS puede ser del entorno).
- Si el DMG falla con errores `hdiutil`/`hdiejectd` de sandbox: correr el build del DMG fuera del sandbox. Los ZIP suelen ser fiables incluso cuando el DMG falla.
