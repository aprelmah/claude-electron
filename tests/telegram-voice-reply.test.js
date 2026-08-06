'use strict'

// Audio va, audio viene: una consulta que entró como nota de voz responde con
// nota de voz (onMakeVoiceNote → sendVoice), con el pie de contexto de caption
// y SIN duplicar la respuesta en texto. Si la síntesis falla, cae a texto.

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge, buildMultipartBody } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

test('buildMultipartBody arma un multipart válido con campos y fichero', () => {
  const { body, contentType } = buildMultipartBody(
    { chat_id: '123', caption: 'pie' },
    { name: 'voice', filename: 'nota.ogg', contentType: 'audio/ogg', buffer: Buffer.from('OGGDATA') }
  )
  const boundary = contentType.match(/boundary=(.+)$/)[1]
  const texto = body.toString('utf-8')
  assert.ok(contentType.startsWith('multipart/form-data; boundary='))
  assert.ok(texto.includes(`--${boundary}\r\n`))
  assert.ok(texto.includes('Content-Disposition: form-data; name="chat_id"\r\n\r\n123'))
  assert.ok(texto.includes('Content-Disposition: form-data; name="caption"\r\n\r\npie'))
  assert.ok(texto.includes('Content-Disposition: form-data; name="voice"; filename="nota.ogg"'))
  assert.ok(texto.includes('Content-Type: audio/ogg'))
  assert.ok(texto.includes('OGGDATA'))
  assert.ok(texto.endsWith(`--${boundary}--\r\n`))
})

function makeBridge({ onRunQuery, onMakeVoiceNote, capture }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-voice-reply-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery,
    onMakeVoiceNote,
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: async () => ({ ok: true, linked: false }),
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {},
    onOpenTaskSession: async () => ({ ok: true })
  })
  bridge.running = true
  bridge.config = { defaultChatId: '111', allowedUsers: new Set(['111']) }
  bridge._sendMessage = async (chatId, text) => {
    capture.sent.push({ chatId: String(chatId), text })
    return { message_id: capture.sent.length }
  }
  bridge._sendChatAction = async (chatId, action) => {
    capture.actions.push(action)
  }
  bridge._sendVoiceNote = async (chatId, filePath, caption) => {
    capture.voiceNotes.push({ chatId: String(chatId), filePath, caption, existia: fs.existsSync(filePath) })
  }
  bridge._contextFooter = () => 'PIE-CONTEXTO'
  return { bridge, tmp }
}

function captura() {
  return { sent: [], actions: [], voiceNotes: [] }
}

test('respuesta a nota de voz sale como nota de voz, sin texto duplicado', async () => {
  const capture = captura()
  const tmpOgg = path.join(os.tmpdir(), `nota-${Date.now()}.ogg`)
  fs.writeFileSync(tmpOgg, 'ogg')
  const { bridge } = makeBridge({
    capture,
    onRunQuery: async ({ onText }) => {
      onText('Todo en orden por aquí.')
      return { sessionId: 's1', text: 'Todo en orden por aquí.' }
    },
    onMakeVoiceNote: async (texto) => {
      capture.textoSintetizado = texto
      return tmpOgg
    }
  })
  await bridge._runQuery('111', 'qué tal va todo', { voiceReply: true })
  assert.strictEqual(capture.voiceNotes.length, 1, 'manda una nota de voz')
  assert.strictEqual(capture.voiceNotes[0].caption, 'PIE-CONTEXTO')
  assert.ok(capture.voiceNotes[0].existia, 'el ogg existía al enviarlo')
  assert.strictEqual(capture.textoSintetizado, 'Todo en orden por aquí.')
  assert.ok(!capture.sent.some((m) => m.text.includes('Todo en orden')), 'la respuesta no va en texto')
  assert.ok(!fs.existsSync(tmpOgg), 'el ogg se borra tras enviarse')
  assert.ok(capture.actions.includes('record_voice'), 'acción "grabando nota de voz"')
})

test('si la síntesis falla, la respuesta cae a texto con pie', async () => {
  const capture = captura()
  const { bridge } = makeBridge({
    capture,
    onRunQuery: async ({ onText }) => {
      onText('Respuesta importante.')
      return { sessionId: 's1', text: 'Respuesta importante.' }
    },
    onMakeVoiceNote: async () => { throw new Error('sin helper') }
  })
  await bridge._runQuery('111', 'hola', { voiceReply: true })
  assert.strictEqual(capture.voiceNotes.length, 0)
  const conRespuesta = capture.sent.filter((m) => m.text.includes('Respuesta importante.'))
  assert.strictEqual(conRespuesta.length, 1, 'la respuesta llega en texto UNA vez')
  assert.ok(conRespuesta[0].text.includes('PIE-CONTEXTO'), 'con el pie de contexto')
})

test('sin voiceReply el flujo sigue siendo el de texto', async () => {
  const capture = captura()
  const { bridge } = makeBridge({
    capture,
    onRunQuery: async ({ onText }) => {
      onText('Texto normal.')
      return { sessionId: 's1', text: 'Texto normal.' }
    },
    onMakeVoiceNote: async () => { throw new Error('no debería llamarse') }
  })
  await bridge._runQuery('111', 'hola')
  assert.strictEqual(capture.voiceNotes.length, 0)
  assert.ok(capture.sent.some((m) => m.text.includes('Texto normal.')))
  assert.ok(!capture.actions.includes('record_voice'))
})
