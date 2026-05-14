# CLAUDE-NOVAK Runbook

## Scope
- Project path: `/Users/isabel/Desktop/claude-electron`
- App type: Electron desktop app with `node-pty` terminal + Whisper dictation.
- Client install checklist: `INSTALACION_CLIENTE.md`

## Incident history
- Date: **2026-05-14**
- Symptom 1: app crash on startup (`SIGABRT`, stack in `_RegisterApplication` / `NSApplication`).
- Symptom 2: packaged app crash with secure-restorable-state warning behavior.
- Symptom 3: `.dmg` build failure from constrained environments.

## Root cause summary
- Startup crash was tied to macOS saved application state + missing explicit secure restorable-state opt-in.
- DMG build failure was environment-level: `hdiutil` cannot run in sandboxed sessions (`Cannot start hdiejectd because app is sandboxed`).

## Permanent fixes applied
1. `package.json` now includes:
   - `build.mac.extendInfo.NSApplicationSupportsSecureRestorableState = true`
2. New recovery script:
   - `npm run reset:state`
   - Backs up these folders if present:
     - `~/Library/Saved Application State/com.github.Electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-novak.savedState`
3. New diagnostics script:
   - `npm run doctor`
4. More robust CLI resolution in `main.js`:
   - Uses env vars / `~/.local/bin` / PATH fallback for `claude`, `codex`, `whisper`.
5. PTY hardening in main/renderer:
   - Validates active CLI before spawn.
   - Emits `pty-error` to UI with explicit message instead of silent failure.
   - Restart/session resume paths now reject properly on spawn errors.
   - CLI switch includes rollback to previous CLI if restart fails.

## Standard commands
- Dev run: `npm run start`
- Full build: `npm run dist`
- ZIP only: `npm run build:zip`
- DMG only: `npm run build:dmg`
- Diagnostics: `npm run doctor`
- Reset saved state: `npm run reset:state`

## Operational notes
- If app starts crashing again:
  1. `npm run doctor`
  2. `npm run reset:state`
  3. Rebuild (`npm run build:zip` or `npm run dist`)
- If `npm run start` fails only in restricted/sandboxed execution runners:
  - Verify again in a normal local terminal session (outside sandbox).
  - This specific crash signature can be environment-related (`SIGABRT` before app JS loads).
- If DMG fails with `hdiutil`/`hdiejectd` sandbox errors:
  - Run DMG build outside sandbox/restricted session.
- ZIP artifacts are usually reliable even when DMG fails in constrained environments.

## Build artifacts
- Output folder: `dist/`
- Intel app: `dist/mac/CLAUDE-NOVAK.app`
- Apple Silicon app: `dist/mac-arm64/CLAUDE-NOVAK.app`
- Intel DMG: `dist/CLAUDE-NOVAK-1.0.0.dmg`
- ARM64 DMG: `dist/CLAUDE-NOVAK-1.0.0-arm64.dmg`
