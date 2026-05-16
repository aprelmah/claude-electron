'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

function execFileP(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: stdout || '',
        stderr: stderr || (err ? String(err.message || err) : '')
      })
    })
  })
}

async function atomicWrite(filePath, content, mode) {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmp, content, 'utf8')
  if (typeof mode === 'number') {
    try { await fsp.chmod(tmp, mode) } catch {}
  }
  await fsp.rename(tmp, filePath)
}

async function ensureFile(filePath) {
  try {
    await fsp.access(filePath)
  } catch {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const fh = await fsp.open(filePath, 'a')
    await fh.close()
  }
}

async function sizeOf(filePath) {
  try {
    const st = await fsp.stat(filePath)
    return st.size
  } catch {
    return -1
  }
}

async function tailFile(filePath, maxBytes) {
  try {
    const st = await fsp.stat(filePath)
    const len = st.size
    if (len <= 0) return ''
    const start = Math.max(0, len - maxBytes)
    const fh = await fsp.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(len - start)
      await fh.read(buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function createInstaller() {
  const uid = os.userInfo().uid

  function domainTarget(label) {
    return `gui/${uid}/${label}`
  }

  function domain() {
    return `gui/${uid}`
  }

  async function bootoutSilent(plistPath, label) {
    // Forma 1: bootout gui/<uid> <plistPath>
    await execFileP('/bin/launchctl', ['bootout', domain(), plistPath])
    // Forma 2 (fallback): bootout gui/<uid>/<label> — ignoramos errores en ambas.
    await execFileP('/bin/launchctl', ['bootout', domainTarget(label)])
  }

  async function install(automation) {
    if (!automation) throw new Error('installer.install: automation requerido')
    const { scriptPath, plistPath, generatedScript, generatedPlist, logPath, label } = automation
    if (!scriptPath || !plistPath || !logPath || !label) {
      throw new Error('installer.install: faltan paths o label en automation')
    }
    if (!generatedScript || !generatedPlist) {
      throw new Error('installer.install: faltan generatedScript / generatedPlist')
    }

    await fsp.mkdir(path.dirname(scriptPath), { recursive: true })
    await fsp.mkdir(path.dirname(plistPath), { recursive: true })
    await fsp.mkdir(path.dirname(logPath), { recursive: true })

    await atomicWrite(scriptPath, generatedScript, 0o755)
    await atomicWrite(plistPath, generatedPlist, 0o644)
    await ensureFile(logPath)

    // Bootout silencioso previo (puede no estar cargado, ok).
    await bootoutSilent(plistPath, label)

    const bootstrap = await execFileP('/bin/launchctl', ['bootstrap', domain(), plistPath])
    if (bootstrap.code !== 0) {
      return { ok: false, error: `launchctl bootstrap exit ${bootstrap.code}: ${bootstrap.stderr.trim() || bootstrap.stdout.trim() || 'sin output'}` }
    }

    const print = await execFileP('/bin/launchctl', ['print', domainTarget(label)])
    if (print.code !== 0) {
      return { ok: false, error: `launchctl print ${domainTarget(label)} exit ${print.code}: ${print.stderr.trim() || 'no cargado'}` }
    }

    return { ok: true }
  }

  async function uninstall(automation) {
    if (!automation) throw new Error('installer.uninstall: automation requerido')
    const { scriptPath, plistPath, label } = automation
    if (label && plistPath) {
      await bootoutSilent(plistPath, label)
    }
    if (plistPath) {
      try { await fsp.unlink(plistPath) } catch (err) { if (err.code !== 'ENOENT') { /* ignora */ } }
    }
    if (scriptPath) {
      try { await fsp.unlink(scriptPath) } catch (err) { if (err.code !== 'ENOENT') { /* ignora */ } }
    }
    return { ok: true }
  }

  async function runOnce(automation) {
    if (!automation) throw new Error('installer.runOnce: automation requerido')
    const { label, logPath } = automation
    if (!label) throw new Error('installer.runOnce: label requerido')
    if (!logPath) throw new Error('installer.runOnce: logPath requerido')

    await ensureFile(logPath)
    const startSize = await sizeOf(logPath)
    const startTs = Date.now()

    const kick = await execFileP('/bin/launchctl', ['kickstart', '-k', domainTarget(label)])
    if (kick.code !== 0) {
      const logTail = await tailFile(logPath, 8 * 1024)
      return {
        ok: false,
        durationMs: Date.now() - startTs,
        logTail,
        error: `launchctl kickstart exit ${kick.code}: ${kick.stderr.trim() || kick.stdout.trim() || 'sin output'}`
      }
    }

    // Poll del log: si crece y luego se queda 3s sin crecer → terminado.
    const MAX_WAIT_MS = 60_000
    const POLL_MS = 500
    const QUIET_THRESHOLD_MS = 3_000
    let lastSize = startSize
    let lastChangeAt = Date.now()
    let everGrew = false
    const deadline = Date.now() + MAX_WAIT_MS

    while (Date.now() < deadline) {
      await sleep(POLL_MS)
      const cur = await sizeOf(logPath)
      if (cur > lastSize) {
        lastSize = cur
        lastChangeAt = Date.now()
        everGrew = true
      } else if (everGrew && (Date.now() - lastChangeAt) >= QUIET_THRESHOLD_MS) {
        break
      }
    }

    const durationMs = Date.now() - startTs
    const logTail = await tailFile(logPath, 8 * 1024)
    // Heurística simple: si el log contiene "ERROR" en las últimas líneas, marcamos ok=false.
    const ok = !/\b(ERROR|FAIL(ED)?)\b/i.test(logTail.slice(-2048))
    return { ok, durationMs, logTail }
  }

  async function readLog(automation, { lines = 200 } = {}) {
    if (!automation) throw new Error('installer.readLog: automation requerido')
    const { logPath } = automation
    if (!logPath) throw new Error('installer.readLog: logPath requerido')
    try {
      await fsp.access(logPath)
    } catch {
      return ''
    }
    const res = await execFileP('/usr/bin/tail', ['-n', String(lines), logPath])
    if (res.code === 0) return res.stdout
    // fallback: leer todo si tail falla
    try {
      const raw = await fsp.readFile(logPath, 'utf8')
      const arr = raw.split('\n')
      return arr.slice(-lines).join('\n')
    } catch {
      return ''
    }
  }

  async function unloadLaunchd(automation) {
    if (!automation) throw new Error('installer.unloadLaunchd: automation requerido')
    const { plistPath, label } = automation
    if (!label || !plistPath) throw new Error('installer.unloadLaunchd: faltan plistPath/label')
    await bootoutSilent(plistPath, label)
    return { ok: true }
  }

  async function loadLaunchd(automation) {
    if (!automation) throw new Error('installer.loadLaunchd: automation requerido')
    const { plistPath, label } = automation
    if (!label || !plistPath) throw new Error('installer.loadLaunchd: faltan plistPath/label')
    try {
      await fsp.access(plistPath)
    } catch {
      return { ok: false, error: `Plist no existe en disco: ${plistPath}` }
    }
    // Bootout previo silencioso por si quedó cargado.
    await bootoutSilent(plistPath, label)
    const bootstrap = await execFileP('/bin/launchctl', ['bootstrap', domain(), plistPath])
    if (bootstrap.code !== 0) {
      return { ok: false, error: `launchctl bootstrap exit ${bootstrap.code}: ${bootstrap.stderr.trim() || bootstrap.stdout.trim() || 'sin output'}` }
    }
    return { ok: true }
  }

  async function isRunning(automation) {
    if (!automation || !automation.label) return false
    const res = await execFileP('/bin/launchctl', ['print', domainTarget(automation.label)])
    if (res.code !== 0) return false
    const out = (res.stdout || '') + '\n' + (res.stderr || '')
    return /state\s*=\s*(running|spawning)/i.test(out)
  }

  async function stopRun(automation) {
    if (!automation || !automation.label) throw new Error('installer.stopRun: label requerido')
    const res = await execFileP('/bin/launchctl', ['kill', 'SIGTERM', domainTarget(automation.label)])
    if (res.code !== 0) {
      return { ok: false, error: `launchctl kill exit ${res.code}: ${res.stderr.trim() || res.stdout.trim() || 'sin output'}` }
    }
    return { ok: true }
  }

  return { install, uninstall, runOnce, readLog, unloadLaunchd, loadLaunchd, isRunning, stopRun }
}

module.exports = { createInstaller }
