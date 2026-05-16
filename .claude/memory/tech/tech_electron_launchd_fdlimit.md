---
name: tech-electron-launchd-fdlimit
description: "Fix para \"low max file descriptors\" en apps Electron lanzadas por launchd (Finder, /Applications)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1371455-b105-4349-890c-01f33c479faf
---

# Electron + launchd + file descriptors

## Síntoma
Una app Electron empaquetada (`.app`) abierta desde Finder, Launchpad o `/Applications/` ejecuta un CLI hijo (por ejemplo `claude` o `codex`) y este crashea con:
```
error: An unknown error occurred, possibly due to low max file descriptors
Current limit: 8192
```

Pero la **misma app** corriendo via `npm run start` desde Terminal funciona sin problemas.

## Diagnóstico real
- `launchctl limit maxfiles` típicamente devuelve `256 unlimited` en macOS (soft=256, hard=unlimited del system).
- Apps lanzadas por launchd heredan soft limit ridículo. Electron lo sube internamente a ~8192. CLIs como claude lo agotan rápido escaneando directorios grandes (ej. `.claude/` con miles de jsonl) → crash.
- Terminal (zsh/bash) suele tener ulimit alto (1M+) por configuración en .bashrc/.zshrc — por eso `npm run start` funciona.
- **Path no importa**: app en `/Applications/` vs `~/Desktop/foo/dist/mac/` con bundle idéntico (SHA256) puede comportarse distinto según cómo se lanza (Finder vs `open` desde Terminal).

## Solución: bash wrapper antes de spawn
En lugar de `spawn(bin, args, ...)`, envolver en bash que sube ulimit:

```js
function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function buildFdLimitCommand(bin, args = []) {
  const parts = [shellQuote(bin), ...args.map(shellQuote)]
  return `ulimit -n 65536 2>/dev/null || true; exec ${parts.join(' ')}`
}

// Subprocess (child_process):
spawn('/bin/bash', ['-c', buildFdLimitCommand(bin, args)], {
  cwd, env,
  stdio: ['ignore', 'pipe', 'pipe']
})

// PTY (node-pty):
pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(bin, args)], {
  name: 'xterm-256color', cols, rows, cwd, env
})
```

Claves:
- `2>/dev/null || true` para que no falle si el sistema no permite subir.
- `exec` para que el shell SE REEMPLACE por el binario (no overhead, no shell extra).
- Quoting con comillas simples y escape de `'` como `'\''` (forma segura POSIX).

## Logging para verificar (opcional)
```js
return `echo "[$(date +%H:%M:%S)] before ulimit=$(ulimit -n) hard=$(ulimit -Hn)" >> /tmp/fd.log; ulimit -n 65536 2>/dev/null || true; echo "[$(date +%H:%M:%S)] after ulimit=$(ulimit -n)" >> /tmp/fd.log; exec ${parts.join(' ')}`
```
Y `tail /tmp/fd.log` después de un crash para ver soft/hard antes y después.

## Si el bash wrapper no es suficiente
Significa que el HARD limit del proceso padre (Electron) está cap por launchd. En ese caso:
- Subir el system maxfiles con `sudo launchctl limit maxfiles 65536 524288` (no persiste tras reboot).
- Persistirlo con `/Library/LaunchDaemons/limit.maxfiles.plist` (instalación a nivel sistema).
- Suele ser overkill — el bash wrapper basta en la mayoría de casos.

## Aplicado en
`/Users/isabel/Desktop/LUISMI/claude-electron/main.js`, función `buildFdLimitCommand` + uso en `startPty`, `runClaudeHeadless`, `runCodexHeadless`. Commit `6cae455`.

## Por qué este caso es delicado en macOS
- Bundle idéntico en distintas rutas (SHA256 igual) puede tener distinto comportamiento en runtime.
- TCC (Transparency Consent Control) asocia permisos por **bundle path** — moverla a /Applications puede revocar permisos. Pero en este caso concreto el problema era rlimits, no TCC.
- Para apps no firmadas, Gatekeeper a veces hace App Translocation a `/private/var/folders/...` y los rlimits/paths se vuelven impredecibles.
