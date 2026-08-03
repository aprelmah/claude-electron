'use strict'

// CLI resolution module: claude / codex / whisper binaries.
// Stateless helpers; the active appConfig is injected via getConfig().

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const USER_LOCAL_BIN = path.join(os.homedir(), '.local/bin')
const PYTHON39_BIN = path.join(os.homedir(), 'Library/Python/3.9/bin')
const HOMEBREW_BIN = '/usr/local/bin'

// Identidad de la sesión de Claude Code que haya lanzado la app. Nunca debe
// heredarla un PTY hijo — ver buildRuntimeEnv().
const CLAUDE_SESSION_IDENTITY_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT'
]

function resolveCommand(candidates) {
  for (const cmd of candidates) {
    if (!cmd) continue
    if (!cmd.includes('/')) return cmd
    if (fs.existsSync(cmd)) return cmd
  }
  return candidates.find(Boolean) || ''
}

function resolveLatestNvmNodeBinDir() {
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try {
    const versions = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v\d+/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    if (!versions.length) return ''
    const binDir = path.join(root, versions[versions.length - 1], 'bin')
    return fs.existsSync(binDir) ? binDir : ''
  } catch {
    return ''
  }
}

const LATEST_NVM_NODE_BIN = resolveLatestNvmNodeBinDir()
const LATEST_NVM_CODEX_BIN = LATEST_NVM_NODE_BIN ? path.join(LATEST_NVM_NODE_BIN, 'codex') : ''

const FALLBACK_CLAUDE_BIN = resolveCommand([
  process.env.CLAUDE_BIN,
  path.join(USER_LOCAL_BIN, 'claude'),
  'claude'
])

const FALLBACK_CODEX_BIN = resolveCommand([
  process.env.CODEX_BIN,
  LATEST_NVM_CODEX_BIN,
  path.join(USER_LOCAL_BIN, 'codex'),
  path.join(os.homedir(), '.nvm/versions/node/v24.15.0/bin/codex'),
  'codex'
])

const FALLBACK_WHISPER_BIN = resolveCommand([
  process.env.WHISPER_BIN,
  path.join(HOMEBREW_BIN, 'whisper-cli'),
  'whisper-cli'
])

const FFMPEG_BIN = resolveCommand([
  process.env.FFMPEG_BIN,
  path.join(PYTHON39_BIN, 'ffmpeg'),
  path.join(HOMEBREW_BIN, 'ffmpeg'),
  'ffmpeg'
])

function commandExists(command, env) {
  if (!command) return false
  if (command.includes('/')) return fs.existsSync(command)
  const probe = spawnSync('/bin/bash', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { env })
  return probe.status === 0
}

// Factory takes a getter for the active app config so the resolver always
// reads fresh values without import-time snapshots.
function createCliResolver(getConfig) {
  function getConfiguredBin(cli) {
    const cfg = getConfig?.() || {}
    const cli2 = cfg.cli || {}
    if (cli === 'codex') return cli2.codexBin || FALLBACK_CODEX_BIN
    return cli2.claudeBin || FALLBACK_CLAUDE_BIN
  }

  function getConfiguredWhisperBin() {
    const cfg = getConfig?.() || {}
    return (cfg.cli && cfg.cli.whisperBin) || FALLBACK_WHISPER_BIN
  }

  function buildRuntimeEnv() {
    const baseEnv = { ...process.env }
    // Forzamos color en los CLI embebidos aunque la app herede NO_COLOR del entorno.
    delete baseEnv.NO_COLOR
    if (baseEnv.CLICOLOR === '0') delete baseEnv.CLICOLOR
    if (baseEnv.CLICOLOR_FORCE === '0') delete baseEnv.CLICOLOR_FORCE
    if (baseEnv.FORCE_COLOR === '0') delete baseEnv.FORCE_COLOR

    // Si la app se lanzó desde una sesión de Claude Code (un `npm run deploy`, un
    // `open -a` desde un agente), hereda su identidad. El PTY hijo se cree
    // entonces una sub-sesión de aquella y DESACTIVA el guardado del transcript:
    //   "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"
    // Eso rompe en silencio media app — sin .jsonl no hay --resume, ni historial,
    // ni relay de Telegram (que lee ese fichero para saber qué contestó Claude),
    // ni pool de PTYs ocultos, ni task-sessions. El único síntoma es una línea
    // amarilla al fondo del TUI que es facilísimo no ver.
    // Los PTYs de la app son siempre sesiones de primer nivel: se corta la herencia.
    for (const k of CLAUDE_SESSION_IDENTITY_VARS) delete baseEnv[k]

    // El bin de nvm va ANTES de /usr/local/bin a propósito: si gana el node de
    // sistema, su prefix global es /usr/local/lib/node_modules (no escribible) y
    // el auto-update de codex ("1. Update now") revienta con EACCES. Con nvm
    // delante, el PATH del PTY iguala al de una Terminal normal.
    const extraPaths = [USER_LOCAL_BIN]
    if (LATEST_NVM_NODE_BIN) extraPaths.push(LATEST_NVM_NODE_BIN)
    extraPaths.push(PYTHON39_BIN, HOMEBREW_BIN)
    const cfg = getConfig?.() || {}
    const cli = cfg.cli || {}
    for (const candidate of [cli.claudeBin, cli.codexBin, cli.whisperBin]) {
      if (candidate && candidate.includes('/')) extraPaths.push(path.dirname(candidate))
    }
    const inheritedPath = (process.env.PATH || '').split(':').filter(Boolean)
    const mergedPath = Array.from(new Set([...extraPaths, ...inheritedPath])).join(':')
    return {
      ...baseEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      FORCE_COLOR: '1',
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: mergedPath
    }
  }

  function cliMeta(cli) {
    if (cli === 'codex') return { name: 'Codex', bin: getConfiguredBin('codex'), envVar: 'CODEX_BIN' }
    return { name: 'Claude', bin: getConfiguredBin('claude'), envVar: 'CLAUDE_BIN' }
  }

  function ensureCliAvailable(cli) {
    const meta = cliMeta(cli)
    const env = buildRuntimeEnv()
    if (!commandExists(meta.bin, env)) {
      return {
        ok: false,
        error: `${meta.name} no está disponible (${meta.bin}). Ajusta ${meta.envVar} o instala el comando en PATH.`
      }
    }
    return { ok: true, ...meta, env }
  }

  return {
    getConfiguredBin,
    getConfiguredWhisperBin,
    buildRuntimeEnv,
    cliMeta,
    ensureCliAvailable
  }
}

module.exports = {
  createCliResolver,
  resolveCommand,
  resolveLatestNvmNodeBinDir,
  commandExists,
  USER_LOCAL_BIN,
  PYTHON39_BIN,
  HOMEBREW_BIN,
  CLAUDE_SESSION_IDENTITY_VARS,
  LATEST_NVM_NODE_BIN,
  LATEST_NVM_CODEX_BIN,
  FALLBACK_CLAUDE_BIN,
  FALLBACK_CODEX_BIN,
  FALLBACK_WHISPER_BIN,
  FFMPEG_BIN
}
