'use strict'

// Diagnóstico del espejo LAN para el móvil. Existe porque el fallo real llegaba
// como pantalla en blanco: el cliente pintaba "Invitación caducada" ante
// cualquier cierre 4403 y "Sin conexión" ante todo lo demás, así que tres
// averías muy distintas (token quemado, host inalcanzable, WS bloqueado) eran
// indistinguibles desde el móvil y la única salida parecía ser reiniciar.
//
// Vive fuera de lan-mirror.html porque la suite corre sin Electron y sin
// navegador: la página lo carga por <script src>, y aquí se puede testear.

const QR_REFRESH_SAFETY_MS = 15000
const QR_REFRESH_MIN_MS = 0

const MESSAGES = {
  'invite-invalid': {
    title: 'Invitación caducada',
    detail: 'El QR dura 90 s y un solo uso, y el acceso caduca 4 h después de escanearlo. Genera uno nuevo en la app: 🌐 → 🪞.'
  },
  'target-gone': {
    title: 'El terminal se cerró en el Mac',
    detail: 'La sesión que estabas espejando ya no existe. Abre el terminal en la app y vuelve a pulsar 🌐 → 🪞.'
  },
  'unavailable': {
    title: 'Este servidor no admite modo espejo',
    detail: 'La app del Mac es más antigua que esta página. Actualízala y vuelve a intentarlo.'
  },
  'host-unreachable': {
    title: 'No alcanzo el Mac',
    detail: 'No hay respuesta de {target}. Si es una IP local (192.168.x.x) tienes que estar en la misma WiFi que el Mac; si esperabas un enlace de internet, el túnel se cayó y hay que generar el QR otra vez.'
  },
  'ws-blocked': {
    title: 'El Mac responde, pero el terminal no',
    detail: 'La página cargó, así que {target} existe: lo que no pasa es el WebSocket. Suele ser la red del móvil o un proxy bloqueando ese puerto.'
  },
  dropped: {
    title: 'Se cortó la conexión',
    detail: 'Reconectando…'
  },
  exhausted: {
    title: 'No consigo reconectar',
    detail: 'Comprueba la cobertura. Si sigue sin ir, genera un QR nuevo en la app: 🌐 → 🪞.'
  }
}

function trim(value, max = 300) {
  const text = String(value == null ? '' : value).trim()
  return text.length > max ? text.slice(0, max) : text
}

function formatTarget(host, port) {
  const safeHost = trim(host, 260)
  const safePort = Number.parseInt(String(port ?? ''), 10)
  if (!safeHost) return 'el servidor'
  return Number.isFinite(safePort) && safePort > 0 ? `${safeHost}:${safePort}` : safeHost
}

// El código del servidor manda sobre cualquier heurística: cuando llega, ya
// sabe la causa exacta. La inferencia por alcance solo actúa cuando el WS murió
// sin que el servidor llegara a decir nada.
function resolveKind({ everOpened, closeCode, serverCode, reachable }) {
  const code = trim(serverCode, 60).toUpperCase()
  if (code === 'SESSION_INVITE_INVALID') return 'invite-invalid'
  if (code === 'MIRROR_TARGET_GONE') return 'target-gone'
  if (code === 'MIRROR_UNAVAILABLE') return 'unavailable'
  if (Number(closeCode) === 4403) return 'invite-invalid'
  if (Number(closeCode) === 4401) return 'invite-invalid'
  if (!everOpened) {
    if (reachable === false) return 'host-unreachable'
    if (reachable === true) return 'ws-blocked'
    return 'host-unreachable'
  }
  return 'dropped'
}

function describeMirrorFailure(input = {}) {
  const {
    everOpened = false,
    closeCode = null,
    serverCode = '',
    serverMessage = '',
    reachable = null,
    host = '',
    port = null,
    attemptsExhausted = false
  } = input

  const kind = resolveKind({ everOpened, closeCode, serverCode, reachable })
  const retryable = kind === 'dropped' || kind === 'host-unreachable' || kind === 'ws-blocked'
  const effectiveKind = kind === 'dropped' && attemptsExhausted ? 'exhausted' : kind
  const template = MESSAGES[effectiveKind] || MESSAGES.exhausted
  const target = formatTarget(host, port)

  let detail = template.detail.replace('{target}', target)
  if (attemptsExhausted && retryable && effectiveKind !== 'exhausted') {
    detail = `${detail} ${MESSAGES.exhausted.detail}`
  }

  return {
    kind: effectiveKind,
    title: trim(serverMessage, 300) || template.title,
    detail,
    target,
    retry: retryable && !attemptsExhausted
  }
}

// El QR caduca en 90 s sin cambiar de aspecto: quien lo mira no distingue uno
// vivo de uno muerto. Se renueva con margen para que la ventana nunca se cierre
// mientras el popover sigue abierto.
// Number(null) es 0 y Number('') también: sin este filtro un expiresAt ausente
// pasaría por marca de tiempo válida y programaría un refresco inmediato.
function toTimestamp(value) {
  if (value == null || value === '') return NaN
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

function computeQrRefreshDelay({ expiresAt, now, safetyMs = QR_REFRESH_SAFETY_MS } = {}) {
  const expires = toTimestamp(expiresAt)
  const current = toTimestamp(now)
  if (Number.isNaN(expires) || Number.isNaN(current)) return null
  const margin = Number.isFinite(Number(safetyMs)) ? Number(safetyMs) : QR_REFRESH_SAFETY_MS
  return Math.max(QR_REFRESH_MIN_MS, expires - current - margin)
}

function formatQrCountdown(expiresAt, now) {
  const expires = toTimestamp(expiresAt)
  const current = toTimestamp(now)
  if (Number.isNaN(expires) || Number.isNaN(current)) return ''
  const remaining = expires - current
  if (remaining <= 0) return 'caducado'
  return `caduca en ${Math.max(1, Math.round(remaining / 1000))} s`
}

// El mismo fichero se carga por require() en la app y se INYECTA tal cual dentro
// de lan-mirror.html al servirla (ws-server lo sustituye por el marcador). Por
// eso las dos salidas van con guarda: en el navegador no existe `module`, y en
// Node no existe `window`. Sin endpoint nuevo y sin duplicar la lógica.
const API = {
  describeMirrorFailure,
  computeQrRefreshDelay,
  formatQrCountdown,
  QR_REFRESH_SAFETY_MS
}

if (typeof module !== 'undefined' && module.exports) module.exports = API
if (typeof window !== 'undefined') window.MirrorConnectionStatus = API
