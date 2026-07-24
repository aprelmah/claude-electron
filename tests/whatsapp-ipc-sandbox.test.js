// SEC-H6 — sandbox de paths en IPC handlers de WhatsApp.
// Cubre que `whatsapp:transcribe-audio` y `whatsapp:save-media-as` rechazan
// paths fuera de roots permitidos (deny roots, traversal, paths absolutos
// arbitrarios) y aceptan los que están dentro de WA_MEDIA_DIR o TMP_DIR.
//
// Framework: node:test (built-in). Sin deps externas.

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { registerWhatsappIpc } = require(path.join(REPO_ROOT, 'main', 'whatsapp-ipc.js'))

// Mock minimalista de ipcMain: guarda handlers y permite invocarlos.
function makeIpcMock() {
  const handlers = new Map()
  return {
    ipcMain: {
      handle(channel, fn) { handlers.set(channel, fn) }
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`No handler for ${channel}`)
      // Primer arg en handlers reales es el event; pasamos null.
      return fn(null, ...args)
    },
    has(channel) { return handlers.has(channel) }
  }
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeAudioFile(dir, name) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, Buffer.from([0x4f, 0x67, 0x67, 0x53])) // header OGG fake
  return p
}

describe('SEC-H6: whatsapp:transcribe-audio sandbox', () => {
  let WA_MEDIA_DIR
  let TMP_DIR
  let ipc
  let transcribeCalls

  beforeEach(() => {
    WA_MEDIA_DIR = makeTmpDir('wa-media-')
    TMP_DIR = makeTmpDir('wa-tmp-')
    transcribeCalls = []
    ipc = makeIpcMock()
    registerWhatsappIpc({
      ipcMain: ipc.ipcMain,
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      winFromEvent: () => null,
      getClient: () => null,
      getClientLoadError: () => null,
      getReachable: () => false,
      getAllowedFsRoots: () => [WA_MEDIA_DIR, TMP_DIR],
      transcribeAudioFile: async (p) => {
        transcribeCalls.push(p)
        return 'mock-text'
      },
      buildRuntimeEnv: () => ({}),
      WA_CONFIG_PATH: path.join(TMP_DIR, 'wa-config.json'),
      WA_MEDIA_DIR,
      TMP_DIR
    })
  })

  afterEach(() => {
    fs.rmSync(WA_MEDIA_DIR, { recursive: true, force: true })
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  })

  test('rechaza path bajo ~/.ssh (DENY_ROOT)', async () => {
    const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa')
    const res = await ipc.invoke('whatsapp:transcribe-audio', sshPath)
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /Path not allowed/i)
    assert.strictEqual(transcribeCalls.length, 0, 'transcribeAudioFile no debe llamarse')
  })

  test('rechaza path con traversal ../../etc/passwd', async () => {
    const evil = path.join(WA_MEDIA_DIR, '..', '..', 'etc', 'passwd')
    const res = await ipc.invoke('whatsapp:transcribe-audio', evil)
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /Path not allowed/i)
    assert.strictEqual(transcribeCalls.length, 0)
  })

  test('rechaza path absoluto fuera de roots (ej. /etc/passwd)', async () => {
    const res = await ipc.invoke('whatsapp:transcribe-audio', '/etc/passwd')
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /Path not allowed/i)
    assert.strictEqual(transcribeCalls.length, 0)
  })

  test('rechaza path dentro de Library/Cookies (DENY_ROOT)', async () => {
    const cookies = path.join(os.homedir(), 'Library', 'Cookies', 'Cookies.binarycookies')
    const res = await ipc.invoke('whatsapp:transcribe-audio', cookies)
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /Path not allowed/i)
    assert.strictEqual(transcribeCalls.length, 0)
  })

  test('rechaza entradas no string', async () => {
    const r1 = await ipc.invoke('whatsapp:transcribe-audio', null)
    assert.strictEqual(r1.ok, false)
    const r2 = await ipc.invoke('whatsapp:transcribe-audio', 42)
    assert.strictEqual(r2.ok, false)
    const r3 = await ipc.invoke('whatsapp:transcribe-audio', '')
    assert.strictEqual(r3.ok, false)
    assert.strictEqual(transcribeCalls.length, 0)
  })

  test('rechaza string vacío sin tocar FS', async () => {
    const res = await ipc.invoke('whatsapp:transcribe-audio', '')
    assert.strictEqual(res.ok, false)
    assert.strictEqual(transcribeCalls.length, 0)
  })

  test('acepta audio dentro de WA_MEDIA_DIR', async () => {
    const audio = writeAudioFile(WA_MEDIA_DIR, 'voice-123.ogg')
    const res = await ipc.invoke('whatsapp:transcribe-audio', audio)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.text, 'mock-text')
    assert.strictEqual(transcribeCalls.length, 1)
    assert.strictEqual(transcribeCalls[0], audio)
  })

  test('acepta audio dentro de TMP_DIR', async () => {
    const audio = writeAudioFile(TMP_DIR, 'recording.webm')
    const res = await ipc.invoke('whatsapp:transcribe-audio', audio)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(transcribeCalls.length, 1)
  })

  test('rechaza archivo inexistente DESPUÉS de validar path', async () => {
    // Path safe pero archivo no existe → error de existencia, no de path
    const audio = path.join(WA_MEDIA_DIR, 'no-existe.ogg')
    const res = await ipc.invoke('whatsapp:transcribe-audio', audio)
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /archivo no existe/i)
    assert.strictEqual(transcribeCalls.length, 0)
  })
})

describe('SEC-H6: whatsapp:save-media-as sandbox', () => {
  let WA_MEDIA_DIR
  let TMP_DIR
  let ipc

  beforeEach(() => {
    WA_MEDIA_DIR = makeTmpDir('wa-media-')
    TMP_DIR = makeTmpDir('wa-tmp-')
    ipc = makeIpcMock()
    registerWhatsappIpc({
      ipcMain: ipc.ipcMain,
      dialog: {
        // Si llegamos aquí significa que pasó la validación de path.
        // Cancelamos para no escribir nada al FS del usuario.
        showSaveDialog: async () => ({ canceled: true })
      },
      winFromEvent: () => null,
      getClient: () => null,
      getClientLoadError: () => null,
      getReachable: () => false,
      getAllowedFsRoots: () => [WA_MEDIA_DIR, TMP_DIR],
      transcribeAudioFile: async () => '',
      buildRuntimeEnv: () => ({}),
      WA_CONFIG_PATH: path.join(TMP_DIR, 'wa-config.json'),
      WA_MEDIA_DIR,
      TMP_DIR
    })
  })

  afterEach(() => {
    fs.rmSync(WA_MEDIA_DIR, { recursive: true, force: true })
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  })

  test('rechaza URL inválida (no wa-media://)', async () => {
    const res = await ipc.invoke('whatsapp:save-media-as', 'https://evil.example/x.jpg', 'x.jpg')
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /URL de media inválida/i)
  })

  test('mediaFileNameFromUrl neutraliza traversal en URL', async () => {
    // Aunque la URL contenga `..`, path.basename + isPathSafe lo neutralizan.
    const res = await ipc.invoke(
      'whatsapp:save-media-as',
      'wa-media://%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
      'evil.txt'
    )
    // Cae en URL inválida o media no encontrada (basename quedará vacío o seguro)
    assert.strictEqual(res.ok, false)
  })

  test('acepta wa-media://<file> existente y sigue al save dialog', async () => {
    writeAudioFile(WA_MEDIA_DIR, 'audio-1.ogg')
    const res = await ipc.invoke('whatsapp:save-media-as', 'wa-media://audio-1.ogg', 'mi-audio.ogg')
    // Cancelamos el save dialog → ok:false con canceled:true (no error de path)
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.canceled, true)
  })

  test('media inexistente devuelve error tras pasar validación path', async () => {
    const res = await ipc.invoke('whatsapp:save-media-as', 'wa-media://no-existe.ogg', 'x.ogg')
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /no encontrada/i)
  })
})

describe('SEC-H6: whatsapp:send-image/audio/document sandbox (regresión)', () => {
  // Ya existía isMediaInputSafe; tests aquí blindan que el contrato no se rompa.
  let WA_MEDIA_DIR
  let TMP_DIR
  let ipc
  let sendMediaCalls

  beforeEach(() => {
    WA_MEDIA_DIR = makeTmpDir('wa-media-')
    TMP_DIR = makeTmpDir('wa-tmp-')
    sendMediaCalls = []
    const mockClient = {
      sendMedia: async (jid, p, kind, opts) => {
        sendMediaCalls.push({ jid, p, kind, opts })
        return { ok: true }
      }
    }
    ipc = makeIpcMock()
    registerWhatsappIpc({
      ipcMain: ipc.ipcMain,
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      winFromEvent: () => null,
      getClient: () => mockClient,
      getClientLoadError: () => null,
      getReachable: () => true,
      getAllowedFsRoots: () => [WA_MEDIA_DIR, TMP_DIR],
      transcribeAudioFile: async () => '',
      buildRuntimeEnv: () => ({}),
      WA_CONFIG_PATH: path.join(TMP_DIR, 'wa-config.json'),
      WA_MEDIA_DIR,
      TMP_DIR
    })
  })

  afterEach(() => {
    fs.rmSync(WA_MEDIA_DIR, { recursive: true, force: true })
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  })

  test('send-image rechaza path en ~/.ssh', async () => {
    const sshKey = path.join(os.homedir(), '.ssh', 'id_rsa')
    const res = await ipc.invoke('whatsapp:send-image', '123@s.whatsapp.net', sshKey, 'pwnd')
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /not allowed/i)
    assert.strictEqual(sendMediaCalls.length, 0)
  })

  test('send-audio rechaza traversal', async () => {
    const evil = path.join(WA_MEDIA_DIR, '..', '..', 'etc', 'passwd')
    const res = await ipc.invoke('whatsapp:send-audio', '123@s.whatsapp.net', evil, true)
    assert.strictEqual(res.ok, false)
    assert.strictEqual(sendMediaCalls.length, 0)
  })

  test('send-document acepta data URL inline (sin tocar FS)', async () => {
    const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQK'
    const res = await ipc.invoke('whatsapp:send-document', '123@s.whatsapp.net', dataUrl, 'doc.pdf')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(sendMediaCalls.length, 1)
    assert.strictEqual(sendMediaCalls[0].p, dataUrl)
  })

  test('send-image acepta path absoluto en WA_MEDIA_DIR', async () => {
    const img = writeAudioFile(WA_MEDIA_DIR, 'photo.jpg')
    const res = await ipc.invoke('whatsapp:send-image', '123@s.whatsapp.net', img, 'caption')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(sendMediaCalls.length, 1)
    assert.strictEqual(sendMediaCalls[0].p, img)
  })
})
