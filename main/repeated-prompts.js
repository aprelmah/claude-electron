'use strict'

// Detector de tareas repetidas — adaptación del "learning loop" de Hermes
// Agent al modelo cockpit de POWER-AGENT: la app no aprende sola, pero SÍ ve
// todos los encargos que entran por canal (Telegram, bot de avisos, voz). Si
// el mismo encargo se repite 3+ veces en 30 días, se propone convertirlo en
// tarea programada (📌) o en skill. Sin LLM: normalización + Jaccard de tokens.
//
// El store es un JSON pequeño en userData (atomic writes, patrón del repo).
// Falso negativo = todo sigue igual; falso positivo = una notificación de más.

const fs = require('fs')
const crypto = require('crypto')
const { atomicWriteJsonSync } = require('./atomic-writes')

const DAY_MS = 24 * 3600 * 1000
const DEFAULTS = {
  windowMs: 30 * DAY_MS,
  cooldownMs: 7 * DAY_MS,
  minRepeats: 3,
  threshold: 0.72,
  minLength: 25,
  minTokens: 4,
  maxClusters: 300,
  maxHitsPerCluster: 20,
  // Reintentos inmediatos del mismo encargo (fallo de sesión, doble tap) no
  // son "repeticiones": un hit por cluster por minuto como mucho.
  minGapMs: 60 * 1000
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokensOf(text) {
  return normalizeText(text).split(' ').filter((t) => t.length > 1)
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens)
  const b = new Set(bTokens)
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function createRepeatedPromptDetector({
  storePath,
  now = Date.now,
  windowMs = DEFAULTS.windowMs,
  cooldownMs = DEFAULTS.cooldownMs,
  minRepeats = DEFAULTS.minRepeats,
  threshold = DEFAULTS.threshold,
  minLength = DEFAULTS.minLength,
  minTokens = DEFAULTS.minTokens,
  maxClusters = DEFAULTS.maxClusters,
  maxHitsPerCluster = DEFAULTS.maxHitsPerCluster,
  minGapMs = DEFAULTS.minGapMs
} = {}) {
  if (!storePath) throw new Error('repeated-prompts: storePath requerido')

  let clusters = loadStore()

  function loadStore() {
    try {
      const raw = fs.readFileSync(storePath, 'utf8')
      const data = JSON.parse(raw)
      if (Array.isArray(data?.clusters)) return data.clusters
    } catch {}
    return []
  }

  function saveStore() {
    try { atomicWriteJsonSync(storePath, { clusters }) } catch {}
  }

  function pruneClusters(ts) {
    const cutoff = ts - windowMs
    clusters = clusters
      .map((c) => ({ ...c, hits: (c.hits || []).filter((h) => h.ts > cutoff) }))
      .filter((c) => c.hits.length > 0)
    if (clusters.length > maxClusters) {
      clusters.sort((a, b) => (b.hits.at(-1)?.ts || 0) - (a.hits.at(-1)?.ts || 0))
      clusters = clusters.slice(0, maxClusters)
    }
  }

  function record({ text, source } = {}) {
    const raw = String(text || '').trim()
    const toks = tokensOf(raw)
    if (raw.length < minLength || toks.length < minTokens) {
      return { repeated: false, ignored: true }
    }
    const ts = now()
    pruneClusters(ts)

    let best = null
    let bestScore = 0
    for (const c of clusters) {
      const score = jaccard(toks, c.tokens)
      if (score > bestScore) { bestScore = score; best = c }
    }

    let cluster
    if (best && bestScore >= threshold) {
      cluster = best
    } else {
      cluster = { tokens: toks, example: raw.slice(0, 300), hits: [], proposedAt: 0 }
      clusters.push(cluster)
    }
    const lastHit = cluster.hits.at(-1)
    if (lastHit && ts - lastHit.ts < minGapMs) {
      saveStore()
      return { repeated: false, ignored: true }
    }
    cluster.hits.push({ ts, source: String(source || '') })
    if (cluster.hits.length > maxHitsPerCluster) cluster.hits = cluster.hits.slice(-maxHitsPerCluster)

    const count = cluster.hits.length
    const enCooldown = cluster.proposedAt && ts - cluster.proposedAt < cooldownMs
    // Un cluster descartado a mano no vuelve a proponer jamás.
    const descartado = cluster.proposal?.status === 'dismissed' || cluster.proposal?.status === 'done'
    let repeated = false
    if (count >= minRepeats && !enCooldown && !descartado) {
      repeated = true
      cluster.proposedAt = ts
      cluster.proposal = { status: 'pending', at: ts }
    }
    saveStore()
    return repeated
      ? { repeated: true, count, example: cluster.example }
      : { repeated: false }
  }

  function proposalIdOf(cluster) {
    return crypto.createHash('sha1').update(cluster.example || '').digest('hex').slice(0, 12)
  }

  // Propuestas pendientes para la bandeja de decisiones.
  function listProposals() {
    pruneClusters(now())
    return clusters
      .filter((c) => c.proposal?.status === 'pending')
      .map((c) => ({ id: proposalIdOf(c), example: c.example, count: c.hits.length, at: c.proposal.at }))
  }

  // status: 'done' (se creó la tarea/skill) o 'dismissed' (no molestar más).
  function resolveProposal(id, status) {
    const st = status === 'done' ? 'done' : 'dismissed'
    for (const c of clusters) {
      if (c.proposal?.status === 'pending' && proposalIdOf(c) === String(id || '')) {
        c.proposal = { ...c.proposal, status: st, resolvedAt: now() }
        saveStore()
        return { ok: true }
      }
    }
    return { ok: false, reason: 'not-found' }
  }

  function listClusters() {
    pruneClusters(now())
    return clusters.map((c) => ({ example: c.example, count: c.hits.length, proposedAt: c.proposedAt || 0 }))
  }

  return { record, listClusters, listProposals, resolveProposal }
}

module.exports = { createRepeatedPromptDetector, normalizeText, tokensOf, jaccard }
