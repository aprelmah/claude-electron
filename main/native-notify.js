'use strict'

// Electron 42+ usa UNNotification en macOS, que exige app firmada. Sin firma la
// notificación no se muestra y emite 'failed'. Este helper detecta ese caso en
// runtime y degrada al fallback que le pase cada llamante.

function createNotifier (deps = {}) {
  const {
    Notification = require('electron').Notification,
    log = (msg) => console.warn('[notify]', msg)
  } = deps

  let broken = false

  function notify (opts = {}) {
    const { title, body, silent = false, onClick = null, fallback = null } = opts

    const degrade = (reason, err) => {
      if (!broken) {
        broken = true
        log(`notificaciones nativas no disponibles (${reason}${err ? ': ' + (err.message || err) : ''}) → usando fallback`)
      }
      if (typeof fallback === 'function') {
        try { fallback(reason) } catch (e) { log('fallback falló: ' + (e?.message || e)) }
      }
      return { shown: false, reason }
    }

    if (broken) return degrade('previo')

    try {
      if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
        return degrade('unsupported')
      }
      const n = new Notification({ title: String(title || ''), body: String(body || ''), silent })
      n.on('failed', (_event, err) => { degrade('failed', err) })
      if (typeof onClick === 'function') n.on('click', () => { try { onClick() } catch {} })
      n.show()
      return { shown: true, notification: n }
    } catch (err) {
      return degrade('threw', err)
    }
  }

  notify.isBroken = () => broken
  notify.reset = () => { broken = false }
  return notify
}

module.exports = { createNotifier }
