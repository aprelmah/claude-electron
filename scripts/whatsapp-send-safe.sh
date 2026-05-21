#!/usr/bin/env bash
set -euo pipefail

BRIDGE_URL="${WA_BRIDGE_URL:-http://127.0.0.1:3031}"
STATUS_URL="${BRIDGE_URL%/}/status"
SEND_URL="${BRIDGE_URL%/}/send/text"
LAUNCH_AGENT="${WA_BRIDGE_LAUNCH_AGENT:-$HOME/Library/LaunchAgents/com.luismi.whatsapp-bridge.plist}"
DEFAULT_CC="${WA_DEFAULT_COUNTRY_CODE:-34}"
READY_TIMEOUT="${WA_BRIDGE_READY_TIMEOUT_SEC:-30}"
ALLOW_IMPLICIT_CC="${WA_ALLOW_IMPLICIT_CC:-0}"

usage() {
  echo "Uso: $(basename "$0") [--cc <codigo_pais>] <telefono|jid> <mensaje>"
  echo "Ejemplo ES: $(basename "$0") --cc 34 678568983 'Hola Isabel'"
  echo "Ejemplo MX: $(basename "$0") --cc 52 5512345678 'Hola Isabel'"
  echo "Tip: con formato internacional puedes usar + o 00 (ej: +15551234567 / 0015551234567)"
  echo "Seguridad: sin --cc, un número local (9 dígitos) se bloquea por defecto."
}

CC_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cc)
      if [[ -z "${2:-}" ]]; then
        echo "ERROR: falta valor para --cc" >&2
        exit 1
      fi
      CC_OVERRIDE="$(printf '%s' "$2" | tr -cd '0-9')"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

raw_to="$1"
shift
message="$*"
ACTIVE_CC="${CC_OVERRIDE:-$DEFAULT_CC}"

json_status() {
  curl -sS "$STATUS_URL" 2>/dev/null || true
}

wait_ready() {
  local i s
  for ((i=1; i<=READY_TIMEOUT; i++)); do
    s="$(json_status)"
    if [[ "$s" == *'"ready"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_bridge_ready() {
  if wait_ready; then
    return 0
  fi
  launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
  launchctl load "$LAUNCH_AGENT"
  wait_ready
}

normalize_to() {
  local value="$1"
  if [[ "$value" == *@* ]]; then
    printf '%s' "$value"
    return 0
  fi

  if [[ "$value" =~ ^\+ ]]; then
    local intl
    intl="$(printf '%s' "$value" | tr -cd '0-9')"
    [[ -n "$intl" ]] || return 1
    printf '%s' "$intl"
    return 0
  fi

  local digits
  digits="$(printf '%s' "$value" | tr -cd '0-9')"
  if [[ -z "$digits" ]]; then
    return 1
  fi

  if [[ "$digits" =~ ^00[0-9]+$ ]]; then
    printf '%s' "${digits#00}"
    return 0
  fi

  # Si llega móvil nacional (9 dígitos), lo forzamos a E.164 con prefijo país.
  if [[ ${#digits} -eq 9 ]]; then
    if [[ -z "$CC_OVERRIDE" && "$ALLOW_IMPLICIT_CC" != "1" ]]; then
      echo "ERROR: número local ambiguo ($digits). Usa --cc <pais> o formato internacional (+...)." >&2
      return 2
    fi
    printf '%s%s' "$ACTIVE_CC" "$digits"
    return 0
  fi

  printf '%s' "$digits"
}

send_text() {
  local to="$1"
  local msg="$2"
  node - "$to" "$msg" "$SEND_URL" <<'NODE'
const http = require('http')
const { URL } = require('url')

const [to, message, sendUrl] = process.argv.slice(2)
const u = new URL(sendUrl)
const payload = JSON.stringify({ to, message })

const req = http.request({
  hostname: u.hostname,
  port: Number(u.port || 80),
  path: u.pathname,
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  },
  timeout: 15000
}, (res) => {
  let body = ''
  res.setEncoding('utf8')
  res.on('data', (d) => { body += d })
  res.on('end', () => {
    process.stdout.write(body)
    if (res.statusCode >= 200 && res.statusCode < 300) process.exit(0)
    process.exit(1)
  })
})

req.on('timeout', () => {
  req.destroy(new Error('timeout'))
})

req.on('error', (err) => {
  process.stderr.write(String(err && err.message ? err.message : err) + '\n')
  process.exit(2)
})

req.write(payload)
req.end()
NODE
}

if ! ensure_bridge_ready; then
  echo "ERROR: bridge WhatsApp no está ready en ${BRIDGE_URL}" >&2
  exit 2
fi

if ! target="$(normalize_to "$raw_to")"; then
  rc=$?
  if [[ $rc -eq 2 ]]; then
    exit 4
  fi
  echo "ERROR: número/JID inválido: $raw_to" >&2
  exit 1
fi

resp=""
if ! resp="$(send_text "$target" "$message")"; then
  echo "ERROR enviando a $target: ${resp:-sin respuesta}" >&2
  exit 3
fi

if [[ "$resp" != *'"ok":true'* ]]; then
  echo "ERROR respuesta bridge: $resp" >&2
  exit 3
fi

msg_id="$(printf '%s' "$resp" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -n "$msg_id" ]]; then
  echo "OK to=$target id=$msg_id"
else
  echo "OK to=$target"
fi
