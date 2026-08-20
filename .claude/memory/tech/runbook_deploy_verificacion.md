# Runbook — despliegue, arranque y verificación

Operativo vivo, mudado del runbook el 2026-08-20 (el `AGENTS.md` pasaba de 20 KB; el contrato
de capas fija ~15 KB). En el runbook queda la regla y el porqué; aquí viven los comandos.

**Antes que nada: `npm run verify`.** Contesta en 1,7 s si el deploy está al día, si hay
proceso con ventana, si el lock es legítimo y si el bridge está donde debe. Es de solo
lectura: diagnostica y se calla — no mata, no borra, no despliega. Detalle en
`tech_verify_script_2026_08_20.md`.

## Regla de oro

Después de cualquier cambio de código, probar SIEMPRE en modo dev antes de empaquetar.

⚠️ `pkill -f "POWER-AGENT.app"` NO mata la app empaquetada. Dev y empaquetada NUNCA conviven
(mismo `userData` → mismo `SingletonLock`; la segunda instancia se suicida EN SILENCIO).

## Arranque en dev

```bash
# 1. Matar cualquier instancia previa (dev Y empaquetada)
osascript -e 'quit app "POWER-AGENT"' 2>/dev/null          # empaquetada: cierre ordenado (dispara before-quit)
pkill -9 -f "claude-electron/node_modules/electron" 2>/dev/null   # dev
sleep 3

# 2. Si murió a lo bruto, limpiar el lock huérfano (si no, el siguiente arranque se suicida sin mensaje)
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
# OJO: SingletonLock es un SYMLINK COLGANTE (apunta a "<hostname>-<pid>", que no existe como
# fichero), así que `[ -e ]` da FALSE aunque el lock esté ahí y esta línea no disparaba NUNCA.
# Con -L sí. Y el pid del target dice si el lock es legítimo o huérfano, sin heurística.
[ -L "$UD/SingletonLock" ] && ! pgrep -f "claude-electron/node_modules/electron" >/dev/null \
  && rm -f "$UD/SingletonLock" "$UD/SingletonSocket" "$UD/SingletonCookie"

# 3. Lanzar en la sesión gráfica del usuario vía osascript (Claude Code no tiene WindowServer)
cat > /tmp/launch_poweragent.scpt << 'EOF'
set projectPath to "/Users/isabel/Desktop/LUISMI/claude-electron"
set cmd to "cd " & quoted form of projectPath & " && npm start"
tell application "Terminal"
    activate
    do script cmd
end tell
EOF
osascript /tmp/launch_poweragent.scpt
```

Un `quit` ordenado retira el `SingletonLock` él solo (medido el 2026-08-20 cerrando y
relanzando la empaquetada): el paso 2 es para cuando se mató a lo bruto.

## Verificaciones

```bash
# Corre el dev (no el empaquetado):
ps aux | grep electron | grep -v grep | head -2   # debe mostrar node_modules/electron/... --app-path=.../claude-electron
# Y tiene VENTANA:
ps aux | grep "claude-electron/node_modules/electron" | grep -v grep | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
# Debe aparecer --type=renderer; solo gpu-process+utility = arrancó sin ventana (lock huérfano típico)

# Para la EMPAQUETADA el grep de arriba NO SIRVE: su binario se llama POWER-AGENT, no electron
# (con la app corriendo, `ps aux | grep electron` solo devuelve Docker). Va por ruta del bundle:
ps -Awwo args= | grep "[P]OWER-AGENT.app/Contents" | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
```

Los dos comandos de esta sección estuvieron meses dando la respuesta equivocada porque se
leían en vez de ejecutarse: `bugs/bug_runbook_verificaciones_falsas_2026_08_20.md`. Si vas a
copiar un comando de verificación de cualquier documento, ejecútalo una vez y comprueba que
distingue el caso bueno del malo.

Checklist post-cambio: `node --check main.js` y `node --check renderer.js` → matar instancias
→ dev por osascript → verificar con ps → probar la feature → solo si OK, `npm run deploy`.
(Los dos `node --check` los cubre ya el hook de sintaxis del harness y `npm run verify` sobre
los 140 ficheros del árbol; el resto sigue siendo a mano.)

## Deploy a /Applications

`npm run deploy` (mata instancias, build x64, copia a `/Applications/POWER-AGENT.app`,
`xattr -cr`, abre vía Finder). Mac Intel → usar SIEMPRE `dist/mac/POWER-AGENT.app` (arm64
sería el binario equivocado sin avisar).

Verificar el deploy por contenido/timestamp del asar **y por PROCESO con ventana**
(`--type=renderer`): una dev viva sobrevive al kill del script, retiene el `SingletonLock` y
la empaquetada se suicida en silencio aunque el script diga "✅ abierto" (2026-08-15).
`npm run verify` hace las dos comprobaciones —incluidos 3 canarios del asar por hash contra
HEAD— y compara contra el último commit que toca **código empaquetado**, no contra HEAD (un
`docs(...)` sobre `.claude/memory/` daría "desfasado" siendo correcto).
