'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { decideKbTabs } = require('../kb-tabs-state')

test('kb-tabs: con conocimiento ON se ven Casos, Fichas y Aplicar', () => {
  const r = decideKbTabs({ enabled: true, activeTab: 'chat' })
  assert.deepEqual(r, { showCasos: true, showFichas: true, showApply: true, nextTab: 'chat', tabChanged: false })
})

test('kb-tabs: con conocimiento OFF desaparecen las dos pestañas y el botón', () => {
  const r = decideKbTabs({ enabled: false, activeTab: 'chat' })
  assert.equal(r.showCasos, false)
  assert.equal(r.showFichas, false)
  assert.equal(r.showApply, false)
})

test('kb-tabs: apagar estando en Casos o Fichas devuelve al Chat', () => {
  for (const tab of ['casos', 'fichas']) {
    const r = decideKbTabs({ enabled: false, activeTab: tab })
    assert.equal(r.nextTab, 'chat', `desde ${tab}`)
    assert.equal(r.tabChanged, true, `desde ${tab}`)
  }
})

test('kb-tabs: apagar estando en Chat no mueve de pestaña', () => {
  const r = decideKbTabs({ enabled: false, activeTab: 'chat' })
  assert.equal(r.nextTab, 'chat')
  assert.equal(r.tabChanged, false)
})

test('kb-tabs: encender no cambia de pestaña aunque estés en Casos', () => {
  const r = decideKbTabs({ enabled: true, activeTab: 'casos' })
  assert.equal(r.nextTab, 'casos')
  assert.equal(r.tabChanged, false)
})

test('kb-tabs: sin datos asume conocimiento ON y pestaña chat (comportamiento histórico)', () => {
  const r = decideKbTabs()
  assert.equal(r.showCasos, true)
  assert.equal(r.nextTab, 'chat')
})
