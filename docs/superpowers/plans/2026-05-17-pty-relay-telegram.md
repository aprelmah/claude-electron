# PTY Relay Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrutar mensajes de Telegram directamente a través del PTY activo de Claude (en lugar de spawnar un proceso headless con `--resume`), eliminando el coste de re-enviar el historial completo en cada turno.

**Architecture:** Cuando llega un mensaje de Telegram, `onRunQuery` en `main.js` comprueba si la sesión primaria tiene PTY activo con Claude. Si sí, escribe el mensaje en ese PTY y captura la salida hasta detectar 2 segundos de silencio (fin de respuesta). Si no, cae de vuelta al comportamiento actual (`runClaudeHeadless`). El bridge de Telegram no necesita cambios — la lógica es completamente transparente dentro de `onRunQuery`.

**Tech Stack:** Node.js, node-pty, Electron main process. Sin dependencias nuevas.

---

## Contexto del codebase

### Archivos relevantes

- **`/Users/isabel/Desktop/LUISMI/claude-electron/main.js`** — proceso principal Electron. Contiene:
  - `startPty(session, ...)` (línea ~436): spawna el PTY; en `proc.onData` envía datos al renderer vía IPC
  - `sessions` (Map wcId → session): cada sesión tiene `{ pty, cwd, activeCli, claudeSessionId, relayActive?, relayListener? }`
  - `onRunQuery` (línea ~1248): callback del bridge que actualmente llama siempre a `runClaudeHeadless`
  - `primaryWcId`: wcId de la ventana principal activa

- **`/Users/isabel/Desktop/LUISMI/claude-electron/telegram-bridge.js`** — bridge Telegram. No se toca en este plan.

### Flujo actual

```
Telegram msg → _runQuery → onRunQuery → runClaudeHeadless(--resume) → response
Coste: historial completo en cada mensaje
```

### Flujo nuevo (relay)

```
Telegram msg → _runQuery → onRunQuery → relayThroughPty → PTY activo → response
Coste: solo el turno nuevo (Claude lleva el contexto en su propia memoria)
Fallback automático a headless si no hay PTY activo
```

---

## File Structure

**Solo se modifica un archivo:** `main.js`

Cambios en `main.js`:
1. Función `stripAnsi(str)` — limpia códigos ANSI del output del PTY
2. Función `relayThroughPty(session, prompt, opts)` — escribe al PTY, captura respuesta
3. `proc.onData` en `startPty` — añadir dispatch al `relayListener` si está activo
4. `onRunQuery` — intentar relay antes de headless

---

## Task 1: stripAnsi + relayThroughPty + proc.onData hook

**Files:**
- Modify: `main.js`

### Contexto para el implementador

`startPty` está en la línea ~436 de `main.js`. Dentro, `proc.onData` (línea ~490) actualmente hace:

```js
proc.onData((data) => {
  if (!proc._alive) return
  const s = sessions.get(myWcId)
  if (!s || !s.win || s.win.isDestroyed()) return
  s.win.webContents.send('pty-data', data)
})
```

El objeto `session` se crea en la línea ~567:
```js
const session = {
  win, wcId, ordinal, pty: null, cols: 120, rows: 35,
  cwd: os.homedir(), activeCli: ..., treeWatcher: null, ...
}
```

---

- [ ] **Step 1: Añadir `stripAnsi` justo antes de `startPty`**

Busca la línea `function startPty(session, cols, rows, cwd, args = []) {` (~línea 436) en `main.js` e inserta ANTES de ella:

```js
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

async function relayThroughPty(session, prompt, { onText, signal } = {}) {
  if (!session?.pty || session.relayActive) return null

  session.relayActive = true

  return new Promise((resolve, reject) => {
    let buffer = ''
    let silenceTimer = null
    let echoPhase = true

    const SILENCE_MS = 2500
    const MAX_WAIT_MS = 120000

    const cleanup = () => {
      session.relayActive = false
      session.relayListener = null
      clearTimeout(silenceTimer)
      clearTimeout(maxTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const finish = () => {
      const clean = stripAnsi(buffer)
        .split('\n')
        .map(l => l.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      cleanup()
      onText?.(clean || '(sin respuesta)')
      resolve({ sessionId: session.claudeSessionId, text: clean })
    }

    const resetSilence = () => {
      clearTimeout(silenceTimer)
      silenceTimer = setTimeout(finish, SILENCE_MS)
    }

    const maxTimer = setTimeout(() => {
      cleanup()
      reject(Object.assign(new Error('Relay timeout'), { name: 'RelayTimeout' }))
    }, MAX_WAIT_MS)

    const onAbort = () => {
      cleanup()
      reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    // Ignorar echo del input durante los primeros 400ms
    setTimeout(() => { echoPhase = false }, 400)

    session.relayListener = (data) => {
      if (echoPhase) return
      buffer += data
      resetSilence()
    }

    // Inyectar el mensaje en el PTY
    session.pty.write(prompt + '\n')
    resetSilence()
  })
}
```

- [ ] **Step 2: Modificar `proc.onData` para despachar al relayListener**

Dentro de `startPty`, localiza el bloque `proc.onData` (~línea 490) y reemplázalo por:

```js
proc.onData((data) => {
  if (!proc._alive) return
  const s = sessions.get(myWcId)
  if (!s) return
  if (s.relayListener) s.relayListener(data)
  if (!s.win || s.win.isDestroyed()) return
  s.win.webContents.send('pty-data', data)
})
```

- [ ] **Step 3: Verificar sintaxis**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/main.js
```

Esperado: sin output (sin errores).

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat(telegram): stripAnsi + relayThroughPty + proc.onData hook"
```

---

## Task 2: Conectar relay en onRunQuery

**Files:**
- Modify: `main.js` (línea ~1248)

### Contexto para el implementador

El callback `onRunQuery` está en la línea ~1248 de `main.js`, dentro del bloque que inicializa el bridge de Telegram. Actualmente:

```js
onRunQuery: async (opts) => {
  const tg = appConfig.telegram || {}
  const cwd = getCwdSync()
  if (opts?.cli === 'codex') {
    return runCodexHeadless({ ...opts, cwd, model: tg.codexModel || '', effort: tg.codexEffort || '' })
  }
  const compacted = compactClaudeSessionIfNeeded({ sessionId: opts?.sessionId, prompt: opts?.prompt, cwd })
  return runClaudeHeadless({ ...opts, ...compacted, cwd, model: tg.claudeModel || '', effort: tg.claudeEffort || '' })
},
```

`primaryWcId` es una variable del scope del módulo que apunta al wcId de la ventana principal. `sessions` es el Map global de sesiones.

---

- [ ] **Step 1: Reemplazar `onRunQuery` con versión que intenta relay primero**

Localiza el bloque completo de `onRunQuery` (~línea 1248) y reemplázalo por:

```js
onRunQuery: async (opts) => {
  const tg = appConfig.telegram || {}
  const cwd = getCwdSync()
  if (opts?.cli === 'codex') {
    return runCodexHeadless({ ...opts, cwd, model: tg.codexModel || '', effort: tg.codexEffort || '' })
  }

  // Intentar relay directo por PTY si hay sesión primaria activa con Claude
  const primarySession = primaryWcId != null ? sessions.get(primaryWcId) : null
  if (primarySession?.pty && primarySession.activeCli === 'claude' && !primarySession.relayActive) {
    try {
      const relayResult = await relayThroughPty(primarySession, opts.prompt, {
        onText: opts.onText,
        signal: opts.signal
      })
      if (relayResult) return relayResult
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      // Cualquier otro error: caer a headless silenciosamente
    }
  }

  // Fallback: headless con --resume
  const compacted = compactClaudeSessionIfNeeded({ sessionId: opts?.sessionId, prompt: opts?.prompt, cwd })
  return runClaudeHeadless({ ...opts, ...compacted, cwd, model: tg.claudeModel || '', effort: tg.claudeEffort || '' })
},
```

- [ ] **Step 2: Verificar sintaxis**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/main.js
```

Esperado: sin output.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(telegram): relay PTY directo en onRunQuery, fallback a headless"
```

---

## Task 3: Prueba manual y ajuste del silenceTimer

**Files:**
- Modify: `main.js` (solo si el timeout de 2.5s necesita ajuste)

### Cómo probar

- [ ] **Step 1: Lanzar la app en modo dev**

```bash
pkill -f "electron \." 2>/dev/null; sleep 1
osascript /tmp/launch_poweragent.scpt
```

- [ ] **Step 2: Verificar que corre dev (no empaquetada)**

```bash
ps aux | grep electron | grep -v grep | head -2
# Debe mostrar: node_modules/electron/dist/Electron.app ... claude-electron
```

- [ ] **Step 3: Prueba de relay**

1. En la app: abrir carpeta, esperar que Claude arranque en el PTY
2. Pulsar 📱 para transferir sesión a Telegram
3. Desde Telegram: enviar un mensaje corto ("hola, ¿qué tal?")
4. Verificar que la respuesta llega en Telegram en <10 segundos
5. Verificar en el terminal de la app que el mensaje apareció como si lo hubieras escrito

- [ ] **Step 4: Si el relay no captura la respuesta completa (se corta)**

Aumentar `SILENCE_MS` de 2500 a 3500 en `relayThroughPty`:

```js
const SILENCE_MS = 3500
```

Verificar sintaxis y relanzar:
```bash
node --check main.js && osascript /tmp/launch_poweragent.scpt
```

- [ ] **Step 5: Si el relay captura basura al principio (echo del prompt)**

Aumentar el tiempo de echo-skip de 400ms a 800ms en `relayThroughPty`:

```js
setTimeout(() => { echoPhase = false }, 800)
```

- [ ] **Step 6: Commit final si hubo ajustes**

```bash
git add main.js
git commit -m "fix(telegram): ajuste de SILENCE_MS y echoPhase tras prueba manual"
```

---

## Verificación final

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/main.js
node --check /Users/isabel/Desktop/LUISMI/claude-electron/telegram-bridge.js
git log --oneline -5
```

Esperado:
```
feat(telegram): ajuste de SILENCE_MS...  (o sin este commit si no hubo ajustes)
feat(telegram): relay PTY directo en onRunQuery, fallback a headless
feat(telegram): stripAnsi + relayThroughPty + proc.onData hook
```

El bridge de Telegram no debe tener cambios — todo está encapsulado en `main.js`.
