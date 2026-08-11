---
name: feedback-claude-electron-deploy
description: "Tras tocar código de claude-electron, ejecutar npm run deploy automáticamente — no pedirle a Luismi que pruebe sin haber desplegado primero"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1ff6df98-5240-44ec-b7fd-5cc6ba71a023
---

# Tras editar código de `claude-electron`, deploy automático

Cuando toque `main.js`, `telegram-bridge.js`, `renderer.js`, `preload.js` o cualquier archivo del repo `~/Desktop/LUISMI/claude-electron/`, **ejecutar `npm run deploy` yo mismo** antes de pedirle a Luismi que pruebe.

**Why:** El 2026-05-14 le decía "cambios hechos, prueba" tras editar `main.js` y `telegram-bridge.js`, pero el binario `dist/mac/CLAUDE-NOVAK.app` (que es lo que se ejecuta con `Cmd+Shift+Space`) seguía siendo el viejo. Luismi probó en Telegram, no vio cambios, y se confundió: "¿qué hago yo mal?". El error era mío: no había desplegado.

**How to apply:**
- Tras Edit/Write a cualquier archivo del repo `claude-electron` (excepto `*.md` puros): lanzar `cd /Users/isabel/Desktop/LUISMI/claude-electron && npm run deploy` antes de cerrar la tarea.
- Mejor en background (1-3 min) y avisar a Luismi de que está deploying.
- Solo después, pedir test en Telegram / UI.
- Excepción: si Luismi pide explícitamente "no despliegues aún" o equivalente.

**Relacionado:** [[project_claude_novak]] — distribución desde `dist/mac/`, no /Applications. `npm run deploy` = mata + build x64 + abre.

## 2026-08-11 — ACTUALIZACIÓN: deploy ya NO es automático; push confirmado incluido

La regla de arriba (deploy automático sin pedir permiso) quedó **obsoleta** — no
refleja cómo se trabaja hoy. Confirmado en varias rondas de la sesión 2026-08-10/11:
tras un cambio de código se prueba primero en dev (osascript + CDP), y el deploy a
`/Applications` solo se ejecuta cuando Luismi lo pide explícitamente ("despliega" /
confirmando "¿despliego?"). Esto ya estaba también en el runbook del proyecto
(`AGENTS.md`, protocolo de despliegue) — esta ficha se había quedado atrás.

**`git push` confirmado incluido en "comitea y despliega"**: en esta misma sesión
hice push sin que se pidiera aparte en una ronda, lo señalé, quedó ambiguo — Luismi
lo resolvió explícitamente con "PUSH" tras preguntárselo. A partir de ahora, en
`claude-electron`, cuando pida "comitea y despliega" el push a `origin/main` va
incluido, no hace falta pedirlo aparte cada vez. (La regla global de pedir
autorización explícita de push sigue vigente para el resto de proyectos/repos —
esta es una excepción específica de este proyecto, confirmada por Luismi.)
