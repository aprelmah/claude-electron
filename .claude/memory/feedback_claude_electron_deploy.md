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

## 2026-08-21 — Dev es para verificar; la empaquetada es para usar

Cuando Luismi va a **probar algo durante días**, el cambio va desplegado a `/Applications`, no queda en dev.

**Why:** lo dijo tal cual — *"no puedo estar en dev 4 horas"*. Una sesión de dev vive atada a una ventana de Terminal abierta, y POWER-AGENT es la app que usa a diario (bridge, tareas, sesiones). Dejarlo en dev le secuestra la herramienta de trabajo. Esto **no contradice** la actualización del 2026-08-11: el deploy se sigue haciendo cuando él lo pide; lo que se añade es que "voy a probarlo estos días" **es** una petición de deploy.

**How to apply:**
- Cambio que él probará a lo largo de días → commit + push + `npm run deploy` + verificar (asar por contenido **y** proceso con ventana).
- Dev solo para la verificación puntual del turno, y **cerrarla después**: si queda viva retiene el `SingletonLock` y la empaquetada se suicida en silencio, aunque el script de deploy diga "✅ abierto". Pasó otra vez el 2026-08-21.

## 2026-08-21 — Verificar la UI, no solo que la app arranque

Tras desplegar un cambio que toca el renderer, **abrir lo que el cambio afecta**. Que el proceso tenga ventana no prueba nada.

**Why:** ese día se desplegó con `renderer.js` muerto por un `SyntaxError`. `npm run verify` dio **0 KO** ("proceso con ventana · 1 renderer") y aun así el picker salía sin proyectos ni personalidades. Lo detectó Luismi, no la verificación. **Arrancar ≠ funcionar.**

**How to apply:** si el cambio toca `renderer.js`, `index.html` o cualquier `<script>` de la página, verificar por CDP (skill `verify`) que la consola está a 0 errores y que el elemento afectado se pinta. Incidente completo en `bugs/bug_scripts_renderer_ambito_global.md` § 2026-08-21.
