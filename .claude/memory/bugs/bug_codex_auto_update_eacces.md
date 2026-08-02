# BUG — el auto-update de codex fallaba dentro de la app (EACCES) y tiraba la sesión

**Fecha:** 2026-07-28 (noche) · **Cerrado en:** PR #4 (`fbb1b76`, `0416180`) · **Estado:** resuelto y desplegado

## Síntoma

En el prompt de codex dentro de POWER-AGENT:

```
✨ Update available! 0.133.0 -> 0.145.0
› 1. Update now (runs `npm install -g @openai/codex`)
```

Al pulsar `1` no se actualizaba nada y la app volvía al picker "elige sesión". Desde una Terminal normal el mismo update funcionaba.

## Causa raíz

Dos fallos encadenados:

1. **PATH mal ordenado.** `buildRuntimeEnv()` (`main/cli-resolver.js`) construía `extraPaths` con `/usr/local/bin` **delante** del bin de nvm. Codex resolvía el `node`/`npm` de sistema, cuyo prefix global es `/usr/local/lib/node_modules` — **no escribible**:

   ```
   npm error EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@openai'
   Error: `npm install -g @openai/codex` failed with status exit status: 243
   ```

   En una Terminal normal nvm va primero en el PATH e instala en el home, por eso allí sí funcionaba.

2. **Codex se cierra tras actualizarse** ("🎉 Update ran successfully! Please restart Codex."). El PTY moría con él y el renderer trataba el `pty-exit` como fin de sesión → picker.

## Método de repro (reutilizable)

Para cualquier fallo del tipo *"funciona en mi Terminal pero no dentro de la app"*: reproducir en un PTY con **el entorno exacto que genera la app**, no con el del shell.

```bash
# 1. Volcar el env real que la app le pasa al PTY
node -e "
const {createCliResolver}=require('./main/cli-resolver')
const c=createCliResolver(()=>cfg).ensureCliAvailable('codex')
require('fs').writeFileSync('/tmp/app_pty_env.json', JSON.stringify({bin:c.bin, env:c.env}))"

# 2. Lanzarlo en un pty.fork() de Python con ese env, fijando winsize
#    (sin TIOCSWINSZ la TUI no pinta NADA y parece que no arranca)
```

Con eso se capturó el `EACCES` literal sin tocar la app. Scripts de la sesión: en el scratchpad (`repro_app_env.py`).

Para reproducir el escenario tantas veces como haga falta: `npm install -g @openai/codex@0.133.0` y reponer `~/.codex/version.json` con `latest_version` alto y `dismissed_version` bajo.

## Arreglo

- **`main/cli-resolver.js`** — el bin de nvm va **antes** de `/usr/local/bin`. El PATH del PTY iguala así al de la Terminal del usuario. De paso, el PATH heredado se trocea antes de deduplicar (el `Set` anterior comparaba el PATH entero como un único string y no quitaba nada).
- **`main/cli-update-watch.js`** (nuevo) — detecta `Update ran successfully` en la salida del PTY, tolerando el marcador partido entre chunks. Tope de 1 reinicio por ventana de 10 min.
- **`main.js`** — `respawnAfterCliUpdate()` relanza la sesión con los mismos args (`session.lastPtyArgs`) en vez de emitir `pty-exit`. **No** vuelve a pasar por `ensureSessionWorkspace`: reutiliza el `session.gitWorkspace` ya creado.
- **`preload.js` + `renderer.js`** — canal `pty-restarting`: escribe el aviso, mantiene `has-pty`, no abre el picker.

## Verificación

- Repro del fallo con el env exacto de la app: `EACCES` reproducido.
- Con el fix, mismo escenario: `changed 2 packages in 6s` → `Update ran successfully`.
- End-to-end pilotando la app por CDP con codex bajado a 0.133 a propósito: pulsar `1` → update → `[Codex actualizado — reiniciando sesión…]` → **codex 0.145.0 arranca solo** en el mismo directorio. `pty-exit` recibidos: **0**. Picker: no aparece.
- 14 tests nuevos en `tests/cli-env-path.test.js` y `tests/cli-update-watch.test.js`.

## Efecto secundario a tener en cuenta

Actualizar codex 0.133 → 0.145 **retiró `gpt-5.3-codex`** para cuentas ChatGPT (`400: model is not supported`). Codex se auto-cambió a `codex-auto-review` —el modelo de auto-revisión, no el de trabajo— y lo escribió en `~/.codex/config.toml`. La migración oficial la anota la propia 0.145 en `[notice.model_migrations]`. El modelo a elegir es **`gpt-5.6-sol`** (línea agéntica de codex, opción 1 del selector `/model`).

Reglas derivadas, en `CLAUDE.md` §*Auto-update de los CLI dentro del PTY*.
