'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  discoverSkills,
  loadSkillsForPrompt,
  saveSkill,
} = require('../main/skills-registry')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'power-agent-skills-'))
}

test('descubre skills del proyecto y respeta la prioridad por id', async () => {
  const root = tempDir()
  const cwd = path.join(root, 'project')
  const userDataDir = path.join(root, 'user-data')
  fs.mkdirSync(path.join(cwd, '.power-agent', 'skills', 'review'), { recursive: true })
  fs.writeFileSync(
    path.join(cwd, '.power-agent', 'skills', 'review', 'SKILL.md'),
    '---\nname: Revisión local\ndescription: Revisa cambios\n---\n\nUsa tests y diff.\n'
  )
  await saveSkill({ userDataDir, id: 'review', content: 'Usa la skill global.' })

  const skills = discoverSkills({ cwd, userDataDir })
  const review = skills.find((skill) => skill.id === 'review')
  assert.ok(review)
  assert.equal(review.source, 'project')
  assert.equal(review.name, 'Revisión local')
  fs.rmSync(root, { recursive: true, force: true })
})

test('carga solo las skills solicitadas y devuelve ausentes', async () => {
  const root = tempDir()
  const userDataDir = path.join(root, 'user-data')
  await saveSkill({ userDataDir, id: 'review', content: 'Comprueba los tests.' })
  const result = loadSkillsForPrompt({ userDataDir }, ['review', 'missing'])
  assert.match(result.text, /Comprueba los tests/)
  assert.deepEqual(result.loaded.map((item) => item.id), ['review'])
  assert.deepEqual(result.missing, ['missing'])
  fs.rmSync(root, { recursive: true, force: true })
})
