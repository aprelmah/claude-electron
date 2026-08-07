# Sondar un CLI de terminal en un PTY controlado

Cuando POWER-AGENT no entiende lo que hace `claude` o `codex` dentro de su PTY, la forma
rápida de saber la verdad es **lanzar el mismo comando en un PTY propio y volcar los bytes
crudos a un fichero**. Complementa `tech_pilotar_app_por_cdp.md`: ese es para la interfaz,
este para procesos de terminal.

Nació el 2026-08-07: tres hipótesis por lectura de código no dieron con por qué el
auto-contestar del menú de codex no disparaba. La sonda lo resolvió al primer intento y de
paso destapó un segundo problema que nadie buscaba
(`bugs/bug_codex_sessionid_picker_resume_2026_08_07.md`).

## El script

Va al scratchpad de la sesión, nunca al repo. Usa el `node-pty` del propio proyecto — un
PTY de verdad, con `TERM`, es lo único que hace que el CLI pinte su TUI.

```js
'use strict'
const pty = require('/Users/isabel/Desktop/LUISMI/claude-electron/node_modules/node-pty')
const fs = require('fs')

const CWD = process.argv[2]
const SID = process.argv[3]
const ANSWER = process.argv[4] || '2'
const OUT = '<scratchpad>/resume-raw.txt'

// PATH con el node donde está instalado el CLI (v24 en este Mac; en v20.18.0 NO está codex).
const env = { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin` }
const p = pty.spawn('codex', ['resume', SID], { name: 'xterm-256color', cols: 120, rows: 40, cwd: CWD, env })

let all = ''
p.onData((d) => { all += d })
p.onExit(({ exitCode, signal }) => {
  fs.writeFileSync(OUT, all)
  console.log(`EXIT code=${exitCode} signal=${signal} bytes=${all.length}`)
  process.exit(0)
})

setTimeout(() => { fs.writeFileSync(OUT + '.pre', all); p.write(ANSWER) }, 5000)
setTimeout(() => { p.write('\r') }, 6500)
setTimeout(() => { fs.writeFileSync(OUT, all); try { p.kill() } catch {}; process.exit(0) }, 16000)
```

Volcar **antes** de responder (`.pre`) y al final: así se ve qué había en pantalla en el
momento de contestar, no solo el resultado.

## Cómo leerlo

```bash
cat -v resume-raw.txt | tail -25          # los escapes visibles
python3 -c "..."                          # buscar un fragmento y ver repr() + sin-ANSI
```

Comparar **el fragmento crudo con el mismo fragmento sin ANSI** es lo que descubre las
trampas de pintado. Ejemplo real:

```
crudo:    'Choose\x1b[2;8Hworking\x1b[2;16Hdirectory\x1b[2;26Hto…'
sin ANSI: 'Chooseworkingdirectorytoresumethissession'   ← ¡sin espacios!
```

## Trampas aprendidas

- **`EXIT code=1` con 0 bytes = el binario no arrancó.** Casi siempre el PATH: `codex` está
  en el node v24, no en el v20.18.0 que usan los tests. Comprobar con
  `ls ~/.nvm/versions/node/<v>/bin | grep codex`.
- **El error de verdad sale DESPUÉS de que el TUI se cierre**, en texto plano al final del
  volcado. Si solo mirabas la pantalla, te lo pierdes.
- **Reanudar una conversación no consume tokens** mientras no se envíe un prompt, así que la
  sonda es gratis. Enviar prompts sí gasta: no dejarla escribiendo texto real.
- El proceso queda vivo si el CLI abre su TUI: el `kill()` del timeout final es obligatorio,
  y conviene comprobar después con `ps aux | grep "[c]odex"` que no quedó nada suelto
  (un `codex` vivo bloquea el hilo para cualquier otro proceso).

## Cuándo usarla

- Un detector de patrones sobre la salida del PTY no dispara y el código parece correcto.
- El PTY muere sin mensaje visible en la app.
- Hace falta saber el orden real de los eventos (qué se pinta antes de qué).
