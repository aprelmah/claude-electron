'use strict'

// Botón "Compartir por internet": dos Quick Tunnels de cloudflared (uno al
// HTTP del cliente LAN, otro al WebSocket) sin cuenta ni configuración. Vive
// aquí, con el spawn inyectado, para que la suite cubra sin Electron todo lo
// que decide: parseo del banner, chunks partidos, timeout, limpieza de hijos.
//
// Las URLs que produce son EFÍMERAS a propósito: jamás se persisten en la
// config (los getters del ws-server las consultan en caliente y el invite ya
// es la única llave que viaja en enlaces públicos). Un túnel muerto vacía las
// URLs al instante: antes un enlace roto que un enlace que miente.

// El banner imprime https://<aleatorio>.trycloudflare.com, pero los logs de
// cloudflared también citan api.trycloudflare.com (su propia API): excluirla.
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i

// Rolling buffer por proceso: de sobra para el banner sin acumular logs.
const MAX_BUFFER = 16384

function extractTryCloudflareUrl(text) {
  const match = TUNNEL_URL_RE.exec(String(text || ''))
  return match ? match[0].toLowerCase() : null
}

function toWssUrl(httpsUrl) {
  return String(httpsUrl || '').replace(/^https:/i, 'wss:')
}

function createLanTunnelManager({ spawnFn, getPorts, urlTimeoutMs = 40000, log, cloudflaredBin } = {}) {
  const doSpawn = typeof spawnFn === 'function'
    ? spawnFn
    : (cmd, args) => require('child_process').spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const logger = typeof log === 'function' ? log : () => {}
  // Ruta absoluta inyectada desde cli-resolver: la app empaquetada no tiene
  // /usr/local/bin en el PATH y 'cloudflared' a pelo da ENOENT.
  const bin = typeof cloudflaredBin === 'string' && cloudflaredBin ? cloudflaredBin : 'cloudflared'

  let state = 'stopped' // stopped | starting | running | error
  let lastError = ''
  let clientUrl = ''
  let wsUrl = ''
  let children = []
  let startPromise = null

  function killChildren() {
    for (const child of children) {
      try { if (child && !child.killed) child.kill('SIGTERM') } catch {}
    }
    children = []
  }

  function fail(message) {
    state = 'error'
    lastError = message
    clientUrl = ''
    wsUrl = ''
    killChildren()
  }

  function spawnTunnel(targetUrl) {
    const child = doSpawn(bin, ['tunnel', '--no-autoupdate', '--url', targetUrl])
    children.push(child)
    return child
  }

  function waitForUrl(child, label) {
    return new Promise((resolve, reject) => {
      let buffer = ''
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        fn(value)
      }
      const onData = (chunk) => {
        buffer = (buffer + String(chunk)).slice(-MAX_BUFFER)
        const url = extractTryCloudflareUrl(buffer)
        if (url) finish(resolve, url)
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', (err) => {
        const hint = err?.code === 'ENOENT'
          ? 'cloudflared no está instalado (brew install cloudflared)'
          : `cloudflared falló: ${err?.message || err}`
        finish(reject, new Error(`Túnel ${label}: ${hint}`))
      })
      child.on('exit', (code) => {
        // Con el túnel ya en marcha este exit lo trata watchChildren; aquí solo
        // importa morir ANTES de dar la URL.
        finish(reject, new Error(`Túnel ${label}: cloudflared terminó (código ${code}) antes de dar la URL`))
      })
    })
  }

  function watchChildren() {
    for (const child of children) {
      child.on('exit', () => {
        if (state !== 'running') return
        logger('[lan-tunnel] un cloudflared murió con el túnel en marcha')
        fail('El túnel se cayó (cloudflared terminó). Vuelve a compartir para levantar otro.')
      })
    }
  }

  async function start({ serverRunning } = {}) {
    if (state === 'running') return { ok: true, clientUrl, wsUrl }
    if (startPromise) return startPromise
    if (!serverRunning) {
      throw new Error('Activa primero el servidor LAN: sin él no hay nada que compartir.')
    }
    const ports = typeof getPorts === 'function' ? getPorts() : {}
    const httpPort = Number(ports?.httpPort)
    const wsPort = Number(ports?.wsPort)
    if (!Number.isFinite(httpPort) || !Number.isFinite(wsPort)) {
      throw new Error('No sé en qué puertos escucha el servidor LAN.')
    }

    state = 'starting'
    lastError = ''
    startPromise = (async () => {
      const clientChild = spawnTunnel(`http://127.0.0.1:${httpPort}`)
      const wsChild = spawnTunnel(`http://127.0.0.1:${wsPort}`)
      let timer = null
      try {
        const urls = await Promise.race([
          Promise.all([
            waitForUrl(clientChild, 'del cliente'),
            waitForUrl(wsChild, 'del WebSocket')
          ]),
          new Promise((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error(`El túnel no dio URL a tiempo (${Math.round(urlTimeoutMs / 1000)}s). ¿Hay internet?`)),
              urlTimeoutMs
            )
            if (typeof timer.unref === 'function') timer.unref()
          })
        ])
        clientUrl = urls[0]
        wsUrl = toWssUrl(urls[1])
        state = 'running'
        watchChildren()
        logger(`[lan-tunnel] activo: ${clientUrl}`)
        return { ok: true, clientUrl, wsUrl }
      } catch (err) {
        fail(err?.message || String(err))
        throw err
      } finally {
        if (timer) clearTimeout(timer)
        startPromise = null
      }
    })()
    return startPromise
  }

  function stop() {
    killChildren()
    state = 'stopped'
    lastError = ''
    clientUrl = ''
    wsUrl = ''
  }

  function getStatus() {
    return { state, error: lastError, clientUrl, wsUrl }
  }

  return {
    start,
    stop,
    getStatus,
    getPublicClientUrl: () => (state === 'running' ? clientUrl : ''),
    getPublicWsUrl: () => (state === 'running' ? wsUrl : '')
  }
}

module.exports = { createLanTunnelManager, extractTryCloudflareUrl, toWssUrl }
