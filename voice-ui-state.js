'use strict'

// Lógica pura del botón de modo voz y su HUD: sin DOM, sin IPC. Vive fuera de
// renderer.js para poder testearla con node:test (el DOM puro no se puede).
// renderer.js solo aplica estas decisiones al DOM; esto no decide nada por sí
// mismo, solo traduce.
//
// Doble carga: en el navegador (`<script src="voice-ui-state.js">`, sin
// bundler) queda en `window.VoiceUIState`; en node (tests) se exporta con
// `module.exports`. Mismo patrón que el resto de scripts sueltos del
// renderer (`project-picker.js`, `graph-renderer.js`), solo que estos son
// puros y por eso merece la pena separarlos.

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking']

const STATE_CLASS = {
  listening: 'voice-listening',
  thinking: 'voice-thinking',
  speaking: 'voice-speaking'
}

// null para 'idle' (o cualquier cosa rara): el botón vuelve a su aspecto por
// defecto quitando las tres clases, sin añadir ninguna.
function classNameForVoiceState(state) {
  return STATE_CLASS[state] || null
}

// El modo voz solo funciona con activeCli === 'claude' (main/voice-router.js
// lo rechaza con codex). Esto solo decide qué mostrar; la decisión real de si
// se puede encender la toma siempre voice:enable en el proceso main — esto es
// para que el botón no mienta *antes* de que el usuario lo pulse.
//
// El motivo se redacta con el CLI que llega, no con "Codex" fijo: hoy solo
// existen claude y codex, pero si apareciera un tercero el texto no debe
// seguir culpando a codex de algo que no hizo.
function voiceCliAvailability(cli) {
  const available = cli === 'claude'
  const label = cli ? String(cli).toUpperCase() : 'este asistente'
  return {
    available,
    title: available
      ? 'Modo voz — hablar con el agente'
      : `Modo voz — solo disponible con Claude, no con ${label}`,
    ariaLabel: available ? 'Activar modo voz' : `Modo voz no disponible con ${label}`
  }
}

// Traduce la respuesta de `voice:state()` (contrato Tarea 7 § 6: `{enabled,
// state, broken, mine}`) al aspecto del botón. `broken` es un eje aparte de
// encendido/apagado: el helper se rindió tras 3 intentos (típico, permiso de
// micrófono denegado) y "apagado" a secas sugiere que basta con pulsar una
// vez, cuando ya lo intentó solo y falló. Pulsar SÍ reintenta (`enable()`
// llama a `helper.reset()`), así que el título lo dice.
//
// `broken` gana siempre a la clase de estado: en la práctica no coexisten
// (el helper solo queda `broken` tras un error fatal, y un error fatal ya
// apagó el modo — `shutdown()` en voice-session.js), pero esta función no lo
// asume, por si ese acoplamiento cambia.
function voiceStateAppearance(s) {
  const mine = !!(s && s.mine)
  const enabled = !!(s && s.enabled)
  const broken = !!(s && s.broken)
  const on = mine && enabled

  if (broken) {
    return {
      on,
      cssClass: 'voice-broken',
      title: 'Modo voz — el motor de voz no arrancó (¿permiso de micrófono?); pulsa para reintentar',
      ariaLabel: 'Modo voz con fallo, pulsa para reintentar'
    }
  }

  return {
    on,
    cssClass: on ? classNameForVoiceState(s && s.state) : null,
    title: null,
    ariaLabel: null
  }
}

const MODE_ICON = { encargo: '⚡', charla: '💬' }

// Traduce un evento de `voice:event` (contrato en task-7-report.md § 6) a una
// acción de UI. `error` es el caso delicado: el evento no dice si fue fatal
// (solo lo fatal apaga el modo), así que se marca `recheckState` para que
// renderer.js vuelva a preguntar `voice:state()` en vez de asumir nada — un
// botón que asume está mintiendo la mitad de las veces.
function planForVoiceEvent(evt) {
  if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') return { action: 'none' }

  switch (evt.type) {
    case 'state':
      if (!VALID_STATES.includes(evt.state)) return { action: 'none' }
      return { action: 'set-state', state: evt.state }

    case 'partial':
      // Se pisa en cada evento: sin auto-ocultar (lo apaga el siguiente evento
      // o el toggle de apagado).
      return { action: 'hud', text: String(evt.text || ''), holdMs: 0 }

    case 'heard': {
      // El fallback es el destino por defecto (la sesión de trabajo), no el
      // sub-chat: un icono que miente sobre dónde ha ido el turno es peor que
      // ninguno, y ahí van los turnos salvo toggle manual.
      const icon = MODE_ICON[evt.mode] || '⚡'
      return { action: 'hud', text: `${icon} ${evt.text || ''}`, holdMs: 2600 }
    }

    case 'saying':
      return { action: 'hud', text: `🔊 ${String(evt.text || '').slice(0, 90)}`, holdMs: 2600 }

    case 'nothing-to-say':
      return { action: 'hud', text: '(sin nada que leer en voz)', holdMs: 2600 }

    case 'warn':
      return { action: 'status', level: 'warn', message: String(evt.message || 'aviso del modo voz') }

    case 'error':
      return {
        action: 'status',
        level: 'error',
        message: String(evt.message || 'error del modo voz'),
        recheckState: true
      }

    default:
      return { action: 'none' }
  }
}

// ── Toggle de destino (⚡ sesión de trabajo / 💬 sub-chat) ────────────────
// El destino por defecto es la sesión de trabajo (main/voice-router.js). Este
// toggle es la única forma de mandar un turno al sub-chat, así que tiene que
// decir SIEMPRE dónde va a caer lo próximo que digas — no dónde cayó lo
// último.
//
// Nombres largos a propósito: este fichero comparte ámbito global con
// renderer.js (ver el comentario del export, más abajo).
const VOICE_MODE_ICON = { encargo: '⚡', charla: '💬' }

function nextVoiceMode(actual) {
  return actual === 'charla' ? 'encargo' : 'charla'
}

// Cualquier valor raro cae en 'encargo': es el defecto real del router, y un
// botón que anuncia sub-chat cuando el turno va a la sesión de trabajo es peor
// que uno que se queda corto.
function voiceModeAppearance(mode) {
  const m = mode === 'charla' ? 'charla' : 'encargo'
  const esCharla = m === 'charla'
  return {
    mode: m,
    icon: VOICE_MODE_ICON[m],
    title: esCharla
      ? 'Lo que digas va al sub-chat lateral — pulsa para hablarle a la sesión de trabajo'
      : 'Lo que digas va a la sesión de trabajo — pulsa para hablarle al sub-chat',
    ariaLabel: esCharla ? 'Destino de la voz: sub-chat lateral' : 'Destino de la voz: sesión de trabajo'
  }
}

// OJO con el nombre: en el navegador esto NO es un módulo, es un `<script>`
// clásico, así que sus `const` de primer nivel caen en el mismo ámbito que los
// de renderer.js. Llamarlo `api` chocaba con el `api` de renderer.js y el
// fichero moría con `Identifier 'api' has already been declared`, dejando la
// página a medio cargar y TODOS los botones sin sus manejadores. Los tests no
// lo veían porque en node esto se carga con require, en su propio ámbito.
const voiceUiState = {
  VALID_STATES,
  classNameForVoiceState,
  voiceCliAvailability,
  voiceStateAppearance,
  planForVoiceEvent,
  nextVoiceMode,
  voiceModeAppearance
}

if (typeof module !== 'undefined' && module.exports) module.exports = voiceUiState
if (typeof window !== 'undefined') window.VoiceUIState = voiceUiState
