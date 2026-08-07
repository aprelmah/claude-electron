'use strict'

// Test de humo: TODOS los módulos cargables bajo node deben poder requerirse
// sin petar. Caza en segundos el error de "export roto / require de un archivo
// que ya no existe / sintaxis válida pero módulo inconsistente" que node
// --check no ve y que antes solo aparecía al arrancar la app real.
//
// Fuera quedan los scripts de renderer/preload (necesitan DOM/contextBridge);
// main.js tampoco: arranca Electron entero al requerirse.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

function requirable(file) {
  return () => {
    const mod = require(file)
    assert.ok(mod && typeof mod === 'object' || typeof mod === 'function', `${file} no exporta nada`)
  }
}

describe('humo: main/*.js', () => {
  const dir = path.join(REPO_ROOT, 'main')
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    test(`require main/${f}`, requirable(path.join(dir, f)))
  }
})

describe('humo: whatsapp/*.js', () => {
  const dir = path.join(REPO_ROOT, 'whatsapp')
  // whatsapp-panel.js es script de renderer (IIFE sobre window/DOM), no módulo.
  const SKIP = new Set(['whatsapp-panel.js'])
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !SKIP.has(f))) {
    test(`require whatsapp/${f}`, requirable(path.join(dir, f)))
  }
})

describe('humo: módulos raíz cargables', () => {
  for (const f of ['telegram-bridge.js', 'headless-runners.js', 'voice-ui-state.js', 'prompt-capture.js']) {
    test(`require ${f}`, requirable(path.join(REPO_ROOT, f)))
  }
})
