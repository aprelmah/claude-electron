#!/bin/bash
#
# verify.sh — Definition of Done ejecutable de POWER-AGENT.
#
# SOLO LECTURA Y NO DESTRUCTIVO, sin matices: este script no para procesos, no
# borra locks, no toca el bridge de WhatsApp y no despliega. Diagnostica y
# reporta. La garantía es verificable con un grep — la blinda
# tests/verify-script.test.js, que falla si aquí aparece un verbo destructivo.
#
# Uso:  bash scripts/verify.sh [--full] [--quiet] [--help]
# Exit: 0 sin KO (los WARN no cambian el exit), 1 con algún KO, 2 error de uso.
#
# Escrito para bash 3.2 (el que trae macOS 12): sin globstar, sin arrays
# asociativos. Y sin `timeout`/`gtimeout`, que no están instalados en este Mac.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

MODE_FULL=0
MODE_QUIET=0

usage() {
  cat <<'EOF'
POWER-AGENT · verify — Definition of Done ejecutable (solo lectura)

  bash scripts/verify.sh            rápido (~1 s): sintaxis, build.files, deploy,
                                    proceso, lock, bridge
  bash scripts/verify.sh --full     + suite de tests + sync con origin (red)
  bash scripts/verify.sh --quiet    solo las líneas KO y el veredicto final
  bash scripts/verify.sh --help     esto

Veredicto: exit 0 si no hay ningún KO; exit 1 si hay alguno. Un WARN informa,
no suspende.

Este script NO modifica nada: ni procesos, ni locks, ni el bridge, ni el deploy.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --full)  MODE_FULL=1 ;;
    --quiet) MODE_QUIET=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "verify.sh: opción desconocida '$1' (usa --help)" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ] && [ "$MODE_QUIET" -eq 0 ]; then
  C_OK="$(printf '\033[32m')"; C_WARN="$(printf '\033[33m')"
  C_KO="$(printf '\033[31m')"; C_DIM="$(printf '\033[2m')"; C_RST="$(printf '\033[0m')"
else
  C_OK=""; C_WARN=""; C_KO=""; C_DIM=""; C_RST=""
fi

N_OK=0; N_WARN=0; N_KO=0

# En --quiet solo se pinta lo que suspende: un veredicto KO sin la línea que lo
# explica no sirve de nada.
line()  { [ "$MODE_QUIET" -eq 1 ] && return 0; printf '%s%-7s%s %-14s %s\n' "$2" "$1" "$C_RST" "$3" "$4"; }
ok()    { N_OK=$((N_OK+1));   line "[OK]"   "$C_OK"   "$1" "$2"; }
warn()  { N_WARN=$((N_WARN+1)); line "[WARN]" "$C_WARN" "$1" "$2"; }
ko()    { N_KO=$((N_KO+1));   printf '%s%-7s%s %-14s %s\n' "$C_KO" "[KO]" "$C_RST" "$1" "$2"; }
info()  { line "[INFO]" "$C_DIM" "$1" "$2"; }
skip()  { line "[SKIP]" "$C_DIM" "$1" "$2"; }

# Los pathspec de git salen de build.files, así que la lista de "qué es código
# empaquetado" se automantiene. Hay que NORMALIZARLOS: en un pathspec de git el
# `*` cruza las barras, así que `main/**/*` exige una segunda `/` y NO matchea
# `main/foo.js`. Sin quitar el `/**/*`, el check del deploy daría un falso OK
# justo cuando el último cambio vive en un fichero directo de main/.
build_files_pathspec() {
  node -e '
    const p = require("./package.json")
    const specs = (p.build && p.build.files ? p.build.files : [])
      .filter(f => !/^node_modules/.test(f))
      .map(f => f.replace(/\/\*\*\/\*$/, "").replace(/\/\*\*$/, ""))
    console.log([...new Set(specs)].join(" "))
  ' 2>/dev/null
}

SPECS="$(build_files_pathspec)"

# ───────────────────────────────────────────────────────────── contexto ──
if [ "$MODE_QUIET" -eq 0 ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  HEAD_DESC="$(git log -1 --format='%h %cd %s' --date=format:'%Y-%m-%d %H:%M' 2>/dev/null || echo '?')"
  printf '\n%sPOWER-AGENT · verify%s  %s  ·  %s\n\n' "$C_DIM" "$C_RST" "$BRANCH" "$HEAD_DESC"
fi

DIRTY_ALL="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [ "$DIRTY_ALL" = "0" ]; then
  info "árbol" "limpio"
else
  info "árbol" "$DIRTY_ALL fichero(s) sin commitear"
fi

# ───────────────────────────────────────────────────── C1 · sintaxis ──
# `for f in main/**/*.js` NO expande en bash 3.2 (no hay globstar): queda el
# literal y node --check "falla" sobre un fichero que no existe. Por eso find.
SRC_DIRS="main whatsapp scheduler tasks automations"
SYNTAX_FILES="$(
  {
    find . -maxdepth 1 -name '*.js' -type f
    for d in $SRC_DIRS; do
      if [ -d "$d" ]; then
        find "$d" -name '*.js' -type f -not -path '*/node_modules/*'
      fi
    done
  } 2>/dev/null | sed 's|^\./||' | sort
)"

# Un `node --check` por fichero son 140 procesos: 13 s. Compilar con el wrapper
# de CommonJS dentro de UN proceso es lo mismo que hace --check por dentro y
# tarda 0,3 s. El wrapper importa: sin él, un `return` de nivel superior (legal
# en CJS) daría un falso positivo.
SYN_OUT="$(node - $SYNTAX_FILES <<'NODE' 2>&1
const fs = require('fs')
const vm = require('vm')
const WRAP_A = '(function (exports, require, module, __filename, __dirname) {'
let n = 0, bad = 0, first = ''
for (const f of process.argv.slice(2)) {
  n++
  try {
    new vm.Script(WRAP_A + fs.readFileSync(f, 'utf8') + '\n})', { filename: f })
  } catch (e) {
    bad++
    if (!first) first = f + ': ' + e.message
  }
}
console.log(n + '|' + bad + '|' + first)
NODE
)"
syn_total="$(printf '%s' "$SYN_OUT" | tail -1 | cut -d'|' -f1)"
syn_bad="$(printf '%s' "$SYN_OUT" | tail -1 | cut -d'|' -f2)"
syn_first="$(printf '%s' "$SYN_OUT" | tail -1 | cut -d'|' -f3-)"

if [ -z "${syn_bad:-}" ]; then
  ko "sintaxis" "no se pudo ejecutar el chequeo: $SYN_OUT"
elif [ "$syn_bad" -eq 0 ]; then
  ok "sintaxis" "$syn_total ficheros, 0 errores"
else
  ko "sintaxis" "$syn_bad/$syn_total con error — $syn_first"
fi

# ───────────────────────────────────────────── C2 · build.files (whitelist) ──
# build.files es una WHITELIST: un .js/.html nuevo en la raíz que nadie declara
# a mano simplemente NO viaja en el asar, y la app empaquetada revienta sin que
# nada avise en dev.
BF="$(node -e '
  const fs = require("fs")
  const files = (require("./package.json").build || {}).files || []
  const declared = new Set(files.filter(f => !f.includes("*")))
  const onDisk = fs.readdirSync(".").filter(f => !f.startsWith(".") && /\.(js|html)$/.test(f))
  const orphans = onDisk.filter(f => !declared.has(f))
  const ghosts = [...declared].filter(f => /\.(js|html|css)$/.test(f) && !fs.existsSync(f))
  console.log(onDisk.length + "|" + orphans.join(" ") + "|" + ghosts.join(" "))
' 2>/dev/null)"

BF_TOTAL="$(printf '%s' "$BF" | cut -d'|' -f1)"
BF_ORPHANS="$(printf '%s' "$BF" | cut -d'|' -f2)"
BF_GHOSTS="$(printf '%s' "$BF" | cut -d'|' -f3)"
BF_NEW="$(git ls-files --others --exclude-standard 2>/dev/null | grep -E '^[^/]+\.(js|html)$' | tr '\n' ' ')"

if [ -z "${BF_TOTAL:-}" ]; then
  ko "build.files" "no se pudo leer package.json build.files"
elif [ -n "$BF_ORPHANS" ]; then
  ko "build.files" "huérfanos (no viajarán en el asar): $BF_ORPHANS"
elif [ -n "$BF_GHOSTS" ]; then
  warn "build.files" "$BF_TOTAL en raíz, 0 huérfanos · declarados que ya no existen: $BF_GHOSTS"
else
  ok "build.files" "$BF_TOTAL en raíz, 0 huérfanos, 0 fantasmas"
fi
[ -n "$BF_NEW" ] && info "build.files" "sin commitear en raíz: $BF_NEW"

# ─────────────────────────────────────────────────────── C3 · tests (--full) ──
if [ "$MODE_FULL" -eq 0 ]; then
  skip "tests" "usa --full"
elif [ ! -d node_modules ]; then
  # Un worktree de sesión no tiene node_modules: la suite ahí escupe decenas de
  # MODULE_NOT_FOUND que no son regresiones. Mejor no dar una cifra que miente.
  warn "tests" "sin node_modules (¿worktree de sesión?) — no se corre la suite"
else
  TEST_LOG="$(mktemp -t verify-tests)"
  node --test --test-reporter=spec tests/*.test.js >"$TEST_LOG" 2>&1
  TEST_RC=$?
  # El resumen no-TTY sale como "ℹ pass 1635". Las líneas de cada test acaban en
  # "(1.35ms)", así que solo el resumen termina en dígitos: de ahí el tail -1.
  T_PASS="$(sed -n 's/^.* pass \([0-9][0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)"
  T_FAIL="$(sed -n 's/^.* fail \([0-9][0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)"
  T_SKIP="$(sed -n 's/^.* skipped \([0-9][0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)"
  if [ "$TEST_RC" -eq 0 ] && [ "${T_FAIL:-1}" = "0" ]; then
    ok "tests" "${T_PASS:-?} pass · 0 fail · ${T_SKIP:-0} skipped"
  else
    ko "tests" "${T_PASS:-?} pass · ${T_FAIL:-?} fail · ${T_SKIP:-0} skipped — log: $TEST_LOG"
    [ "$MODE_QUIET" -eq 0 ] && grep -E '^(not ok|✖|✗)' "$TEST_LOG" | head -10
  fi
fi

# ────────────────────────────────────────────────────────────── C4 · deploy ──
APP=""
for d in /Applications "$HOME/Applications"; do
  [ -d "$d/POWER-AGENT.app" ] && { APP="$d/POWER-AGENT.app"; break; }
done

if [ -z "$APP" ]; then
  warn "deploy" "no hay POWER-AGENT.app instalada"
else
  ASAR="$APP/Contents/Resources/app.asar"
  ASAR_CT="$(stat -f '%m' "$ASAR" 2>/dev/null)"
  ASAR_TS="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$ASAR" 2>/dev/null)"

  # Comparar contra HEAD MIENTE: un commit de solo memoria/docs es posterior al
  # asar sin que el código haya cambiado. La referencia es el último commit que
  # toca código EMPAQUETADO ($SPECS va sin comillas a propósito: son N pathspec).
  CODE_CT="$(git log -1 --format='%ct' -- $SPECS 2>/dev/null)"
  CODE_DESC="$(git log -1 --format='%h %cd' --date=format:'%Y-%m-%d %H:%M' -- $SPECS 2>/dev/null)"

  if [ -z "${ASAR_CT:-}" ]; then
    ko "deploy" "$APP sin app.asar legible"
  elif [ -z "${CODE_CT:-}" ]; then
    warn "deploy" "asar $ASAR_TS · no se pudo datar el último commit de código"
  elif [ "$ASAR_CT" -ge "$CODE_CT" ]; then
    ok "deploy" "asar $ASAR_TS ≥ código $CODE_DESC"
  else
    ko "deploy" "asar $ASAR_TS DESFASADO ($(( (CODE_CT - ASAR_CT) / 3600 ))h por detrás de $CODE_DESC)"
  fi

  # Verificación por CONTENIDO, que es lo que manda el runbook: el timestamp
  # solo dice cuándo se copió, no qué lleva dentro. Canarios: los dos ficheros
  # gordos + el fichero empaquetado que cambió en el último commit de código,
  # que es justo el que se dejaría fuera un deploy rancio.
  CANARY_LAST="$(git log -1 --name-only --format='' -- $SPECS 2>/dev/null | sed '/^$/d' | head -1)"
  CANARIES="main.js renderer.js"
  [ -n "$CANARY_LAST" ] && CANARIES="$CANARIES $CANARY_LAST"

  # Se usa la API de Node de @electron/asar, que devuelve el fichero en memoria.
  # La CLI `asar extract-file` NO: extrae al cwd, y el 2026-08-09 eso se llevó
  # por delante el main.js de la raíz. Sin escribir, el pie no tiene dónde
  # dispararse — y el script se queda sin necesidad de limpiar nada.
  CANARY_OUT="$(node - "$ASAR" $CANARIES <<'NODE' 2>/dev/null
const crypto = require('crypto')
const { execFileSync } = require('child_process')
let asar
try { asar = require('@electron/asar') } catch (e) { console.log('SINLIB'); process.exit(0) }
const [archive, ...files] = process.argv.slice(2)
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
for (const f of files) {
  let a, b
  try { a = sha(asar.extractFile(archive, f)) } catch (e) { console.log('NOASAR ' + f); continue }
  try { b = sha(execFileSync('git', ['show', 'HEAD:' + f], { maxBuffer: 1 << 28 })) } catch (e) { console.log('NOGIT ' + f); continue }
  console.log((a === b ? 'IGUAL ' : 'DISTINTO ') + f)
}
NODE
)"

  if [ "$CANARY_OUT" = "SINLIB" ] || [ -z "$CANARY_OUT" ]; then
    warn "contenido" "sin @electron/asar: no se pudo verificar el contenido del asar"
  else
    C_TOTAL="$(printf '%s\n' "$CANARY_OUT" | sed '/^$/d' | wc -l | tr -d ' ')"
    C_EQ="$(printf '%s\n' "$CANARY_OUT" | grep -c '^IGUAL ')"
    C_BAD="$(printf '%s\n' "$CANARY_OUT" | grep -v '^IGUAL ' | sed '/^$/d' | tr '\n' ' ')"
    if [ "$C_EQ" = "$C_TOTAL" ]; then
      ok "contenido" "$C_EQ/$C_TOTAL canarios idénticos a HEAD ($(printf '%s' "$CANARIES" | tr ' ' ','))"
    else
      ko "contenido" "$C_EQ/$C_TOTAL idénticos — $C_BAD"
    fi
  fi

  # Si hay cambios sin commitear en ficheros empaquetados, el asar no puede
  # coincidir con nada: los canarios comparan contra HEAD, no contra el disco.
  DIRTY_SHIPPED="$(git status --porcelain -- $SPECS 2>/dev/null | sed '/^$/d' | tr '\n' ' ')"
  [ -n "$DIRTY_SHIPPED" ] && warn "deploy" "código empaquetado sin commitear: $DIRTY_SHIPPED"

  APP_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null)"
  PKG_VER="$(node -e 'console.log(require("./package.json").version)' 2>/dev/null)"
  if [ -n "${APP_VER:-}" ] && [ "$APP_VER" != "${PKG_VER:-}" ]; then
    warn "versión" "app $APP_VER ≠ package.json $PKG_VER"
  else
    info "deploy" "$APP · v${APP_VER:-?}"
  fi
fi

# ───────────────────────────────────────────────────────────── C5 · proceso ──
# La empaquetada se detecta por la RUTA DEL BUNDLE, nunca con `grep electron`:
# su binario se llama POWER-AGENT, así que el grep clásico no la ve jamás.
DEV_PIDS="$(pgrep -f 'claude-electron/node_modules/electron' 2>/dev/null | tr '\n' ' ')"
PKG_PIDS="$(pgrep -f 'POWER-AGENT.app/Contents/MacOS/POWER-AGENT' 2>/dev/null | tr '\n' ' ')"
REN_DEV="$(ps -Awwo args= 2>/dev/null | grep 'claude-electron/node_modules/electron' | grep -c -- '--type=renderer')"
REN_PKG="$(ps -Awwo args= 2>/dev/null | grep 'POWER-AGENT.app/Contents' | grep -c -- '--type=renderer')"

if [ -n "$DEV_PIDS" ] && [ -n "$PKG_PIDS" ]; then
  # Comparten userData, o sea el mismo SingletonLock: la segunda se suicida en
  # silencio. Convivir no es un aviso, es un fallo.
  ko "proceso" "dev ($DEV_PIDS) y empaquetada ($PKG_PIDS) a la vez — nunca conviven"
elif [ -n "$DEV_PIDS" ]; then
  if [ "${REN_DEV:-0}" -ge 1 ]; then
    ok "proceso" "dev viva (${DEV_PIDS% }) con ventana · $REN_DEV renderer"
  else
    warn "proceso" "dev viva (${DEV_PIDS% }) SIN --type=renderer: ventana cerrada o arranque abortado"
  fi
elif [ -n "$PKG_PIDS" ]; then
  if [ "${REN_PKG:-0}" -ge 1 ]; then
    ok "proceso" "empaquetada viva (${PKG_PIDS% }) con ventana · $REN_PKG renderer"
  else
    warn "proceso" "empaquetada viva (${PKG_PIDS% }) SIN --type=renderer: ventana cerrada o arranque abortado"
  fi
else
  ok "proceso" "sin instancia corriendo"
fi

# ──────────────────────────────────────────────────────────────── C6 · lock ──
# SingletonLock es un SYMLINK COLGANTE: apunta a "<hostname>-<pid>", que no
# existe como fichero. `[ -e ]` da FALSE aunque el lock esté ahí — hay que usar
# -L. Y el pid del target dice si es legítimo o huérfano sin heurística ninguna.
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
LK="$UD/SingletonLock"
if [ -L "$LK" ]; then
  LK_TGT="$(readlink "$LK" 2>/dev/null)"
  LK_PID="${LK_TGT##*-}"
  case "${LK_PID:-x}" in
    ''|*[!0-9]*)
      warn "lock" "target ilegible: $LK_TGT" ;;
    *)
      LK_OWNER="$(ps -p "$LK_PID" -o comm= 2>/dev/null)"
      if [ -z "$LK_OWNER" ]; then
        ko "lock" "SingletonLock HUÉRFANO (pid $LK_PID no existe) — el próximo arranque se suicidará en silencio"
      elif printf '%s' "$LK_OWNER" | grep -qE 'POWER-AGENT|[Ee]lectron'; then
        ok "lock" "SingletonLock → pid $LK_PID vivo ($(basename "$LK_OWNER"))"
      else
        warn "lock" "SingletonLock → pid $LK_PID reutilizado por otro proceso ($LK_OWNER)"
      fi ;;
  esac
elif [ -e "$LK" ]; then
  warn "lock" "SingletonLock existe pero no es symlink"
else
  ok "lock" "sin SingletonLock"
fi

# ──────────────────────────────────────────── C7 · bridge WhatsApp (INFO) ──
# Solo lectura y solo informativo: aquí no se decide nada ni se toca nada. Son
# tres estados INDEPENDIENTES (puede arrancar / vive ahora / escucha).
WA_LABEL="com.luismi.whatsapp-bridge"
WA_OVERRIDE_RAW="$(launchctl print-disabled "gui/$(id -u)" 2>/dev/null | grep "$WA_LABEL")"
case "$WA_OVERRIDE_RAW" in
  # OJO: print-disabled se lee al revés — "=> true" significa DESHABILITADO.
  # Nunca imprimir el booleano crudo: se ha malinterpretado más de una vez.
  *'=> true'*)  WA_OVERRIDE="deshabilitado (no arranca solo)" ;;
  *'=> false'*) WA_OVERRIDE="habilitado (arranca con launchd)" ;;
  *)            WA_OVERRIDE="habilitado (sin override: es el default)" ;;
esac
if launchctl list 2>/dev/null | grep -q "$WA_LABEL"; then WA_LOADED="cargado"; else WA_LOADED="no cargado"; fi
if [ -n "$(lsof -nP -iTCP:3031 -sTCP:LISTEN 2>/dev/null)" ]; then WA_PORT="3031 escuchando"; else WA_PORT="3031 libre"; fi
info "whatsapp" "$WA_OVERRIDE · $WA_LOADED · $WA_PORT"

# ─────────────────────────────────────────────── C8 · sync origin (--full) ──
# Es red, por eso solo en --full. Y nunca suspende: ir por delante del remoto es
# información, no un fallo.
if [ "$MODE_FULL" -eq 1 ]; then
  REMOTE_SHA="$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}' | head -1)"
  LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null)"
  if [ -z "${REMOTE_SHA:-}" ]; then
    warn "origin" "no se pudo consultar el remoto"
  elif [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then
    ok "origin" "HEAD == origin/main (${LOCAL_SHA:0:7})"
  elif git cat-file -e "$REMOTE_SHA" 2>/dev/null; then
    COUNTS="$(git rev-list --left-right --count "$LOCAL_SHA...$REMOTE_SHA" 2>/dev/null)"
    warn "origin" "divergencia con origin/main — ahead/behind: $(printf '%s' "$COUNTS" | tr '\t' '/')"
  else
    warn "origin" "origin/main (${REMOTE_SHA:0:7}) tiene commits que no están aquí"
  fi
else
  skip "origin" "usa --full (es red)"
fi

# ────────────────────────────────────────────────────────────── veredicto ──
if [ "$N_KO" -gt 0 ]; then
  printf '\n%sVEREDICTO: KO%s  (%d KO · %d WARN · %d OK)\n\n' "$C_KO" "$C_RST" "$N_KO" "$N_WARN" "$N_OK"
  exit 1
fi
if [ "$N_WARN" -gt 0 ]; then
  printf '\n%sVEREDICTO: OK con avisos%s  (0 KO · %d WARN · %d OK)\n\n' "$C_WARN" "$C_RST" "$N_WARN" "$N_OK"
  exit 0
fi
printf '\n%sVEREDICTO: OK%s  (0 KO · 0 WARN · %d OK)\n\n' "$C_OK" "$C_RST" "$N_OK"
exit 0
