# AGENTS.md — POWER-AGENT

Punto de entrada para cualquier agente CLI (Claude Code, Codex, otros) que llegue al proyecto.

## Lo primero que tienes que hacer

1. **Leer `HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md` ENTERO**. Es la continuidad final más reciente de WhatsApp (race autoReply OFF, STOP/START bridge, QR live refresh, descarga media) y contiene estado operativo real al cierre.
2. **Leer `HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md` ENTERO**. Es el handoff base del release 1.3.0 (estado global, reglas duras, rollback, arquitectura).
3. Leer `CLAUDE.md` (runbook del proyecto: despliegue, regla crítica WhatsApp, scripts).
4. Si vas a tocar WhatsApp → leer `HARDENING-WA-AUTH.md`.
5. Si vas a tocar APIs de Electron → leer `ELECTRON-32-UPGRADE-NOTES.md`.
6. Si vas a tocar firma/distribución → leer `SIGNING-NOTARIZE-SETUP.md`.

## Estado actual (snapshot 2026-05-22)

- **Versión**: 1.3.0
- **Electron**: 32.3.3 LTS (Chromium 128, Node 20.18.0)
- **`main.js`**: 3157 LOC, modularizado en 34 archivos en `main/`
- **Branch**: `main` (limpio, push al día)
- **Tag release**: `release-1.3.0-2026-05-22`
- **App desplegada**: `/Applications/POWER-AGENT.app`
- **Bridge WhatsApp**: `~/.claude/whatsapp-bridge/` con auth token `X-Auth-Token`

## Reglas duras (resumen — el handoff las detalla)

- **NUNCA** envíes WhatsApp a número ambiguo sin prefijo internacional (ver `CLAUDE.md` sección "Regla critica WhatsApp").
- **NUNCA** llames al bridge WhatsApp en `127.0.0.1:3031` sin el header `X-Auth-Token` (lee con `whatsapp/whatsapp-auth.js`).
- **NUNCA** uses `File.path` en renderer (Electron 32 lo quitó). Usar `window.api.getPathForFile(file)`.
- **NUNCA** uses `protocol.registerFileProtocol` (deprecated). Usar `protocol.handle`.
- **NUNCA** escribas state crítico con `fs.writeFileSync` directo. Usar `main/atomic-writes.js`.
- **NUNCA** dejes que `whatsapp:save-config` acepte campos fuera de `WA_SAFE_CONFIG_FIELDS`.
- Antes de extraer más código de `main.js` a `main/*`: leer la sección "Fase 3 modularización" del handoff. Hay bloqueos arquitectónicos.

## Rollback de emergencia

```bash
git reset --hard pre-ola2-2026-05-22   # vuelve a 1.2.0 + Electron 20
# o más atrás:
git reset --hard pre-merge-ola1-2026-05-22   # vuelve a 1.1.0
git push origin main --force   # CUIDADO: destructivo
npm install && npm run deploy
```

## Comandos clave

```bash
npm test                # 107/94/0/13 esperado
npm run dev             # arranca sin compilar (necesita osascript para WindowServer)
npm run deploy          # build x64 + /Applications + xattr -cr + abre
npm run doctor          # diagnostics
npm run reset:state     # si la app crashea al arrancar
```

Detalle completo en el handoff.
