'use strict'

const {
  discoverSkills,
  findSkill,
  saveSkill,
} = require('./skills-registry')

function registerSkillsIpc({ ipcMain, getUserDataDir, getDefaultCwd } = {}) {
  ipcMain.handle('skills:list', (_event, { cwd } = {}) => {
    const userDataDir = getUserDataDir()
    const selectedCwd = typeof cwd === 'string' && cwd.trim()
      ? cwd.trim()
      : (typeof getDefaultCwd === 'function' ? getDefaultCwd() : '')
    return discoverSkills({ userDataDir, cwd: selectedCwd })
  })

  ipcMain.handle('skills:get', (_event, { id, cwd } = {}) => {
    const userDataDir = getUserDataDir()
    const selectedCwd = typeof cwd === 'string' && cwd.trim()
      ? cwd.trim()
      : (typeof getDefaultCwd === 'function' ? getDefaultCwd() : '')
    const skill = findSkill({ userDataDir, cwd: selectedCwd }, id)
    if (!skill) return null
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      readOnly: skill.readOnly,
      content: skill.content,
    }
  })

  ipcMain.handle('skills:save', async (_event, payload = {}) => {
    const result = await saveSkill({
      userDataDir: getUserDataDir(),
      id: payload.id,
      name: payload.name,
      description: payload.description,
      content: payload.content,
    })
    return { ok: true, ...result }
  })
}

module.exports = { registerSkillsIpc }
