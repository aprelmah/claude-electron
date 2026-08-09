'use strict';

const SECURITY_MODES = Object.freeze({
  SAFE: 'safe',
  TRUSTED: 'trusted',
});

const SAFE_CLAUDE_PERMISSION_MODE = 'acceptEdits';
const SAFE_CODEX_SANDBOX = 'workspace-write';

function normalizeSecurityMode(value, fallback = SECURITY_MODES.SAFE) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === SECURITY_MODES.TRUSTED || candidate === 'bypass' || candidate === 'bypasspermissions') {
    return SECURITY_MODES.TRUSTED;
  }
  if (candidate === SECURITY_MODES.SAFE || candidate === 'sandbox' || candidate === 'default') {
    return SECURITY_MODES.SAFE;
  }
  return fallback === SECURITY_MODES.TRUSTED ? SECURITY_MODES.TRUSTED : SECURITY_MODES.SAFE;
}

function resolveHeadlessSecurity({
  cli,
  securityMode,
  permissionMode,
  codexSandbox,
} = {}) {
  const mode = normalizeSecurityMode(securityMode);
  const normalizedCli = String(cli || '').trim().toLowerCase();

  if (normalizedCli === 'claude') {
    if (mode === SECURITY_MODES.TRUSTED) {
      return {
        mode,
        args: ['--permission-mode', 'bypassPermissions'],
        bypassPermissions: true,
        description: 'Claude puede ejecutar acciones sin pedir confirmación.',
      };
    }
    const selectedPermissionMode = String(permissionMode || SAFE_CLAUDE_PERMISSION_MODE).trim();
    return {
      mode,
      args: ['--permission-mode', selectedPermissionMode || SAFE_CLAUDE_PERMISSION_MODE],
      bypassPermissions: false,
      description: `Claude usa el modo de permisos ${selectedPermissionMode || SAFE_CLAUDE_PERMISSION_MODE}.`,
    };
  }

  if (normalizedCli === 'codex') {
    if (mode === SECURITY_MODES.TRUSTED) {
      return {
        mode,
        args: ['--dangerously-bypass-approvals-and-sandbox'],
        bypassPermissions: true,
        description: 'Codex puede ejecutar acciones sin sandbox ni aprobaciones.',
      };
    }
    const selectedSandbox = String(codexSandbox || SAFE_CODEX_SANDBOX).trim();
    return {
      mode,
      args: ['--sandbox', selectedSandbox || SAFE_CODEX_SANDBOX, '--approve-for-me'],
      bypassPermissions: false,
      description: `Codex usa sandbox ${selectedSandbox || SAFE_CODEX_SANDBOX} con aprobaciones automáticas.`,
    };
  }

  throw new Error(`CLI no soportado para política de ejecución: ${cli}`);
}

function normalizeSkills(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return [...new Set(source
    .map((item) => String(item || '').trim())
    .filter((item) => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(item)))]
    .slice(0, 16);
}

function preflightTask(task = {}) {
  const errors = [];
  const warnings = [];
  if (!task || typeof task !== 'object') {
    return {
      ok: false,
      errors: ['La tarea no es un objeto válido.'],
      warnings: [],
      securityMode: SECURITY_MODES.SAFE,
      skills: [],
    };
  }
  const cli = String(task.cli || '').trim().toLowerCase();
  const prompt = String(task.prompt || '').trim();
  const securityMode = normalizeSecurityMode(task.securityMode);
  const skills = normalizeSkills(task.skills);
  if (!String(task.name || '').trim()) errors.push('Falta el nombre de la tarea.');
  if (!['claude', 'codex'].includes(cli)) errors.push('La tarea debe usar Claude o Codex.');
  if (!prompt) errors.push('Falta el prompt de la tarea.');
  if (prompt.length > 120000) errors.push('El prompt supera el límite de 120.000 caracteres.');
  if (task.resume && !String(task.sessionId || '').trim()) {
    warnings.push('Resume está activado sin sessionId: esta primera ejecución arrancará una sesión nueva.');
  }
  if (securityMode === SECURITY_MODES.TRUSTED) {
    warnings.push('Modo confiado: la tarea podrá ejecutar acciones sin las barreras normales.');
  }
  if (task.cwd && /^(?:\\\\|\/\/|\/Volumes\/)/.test(String(task.cwd))) {
    warnings.push('El cwd parece remoto o externo; revísalo antes de permitir escrituras.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    cli,
    securityMode,
    skills,
  };
}

function formatPreflightFailure(result) {
  if (!result || result.ok) return '';
  return result.errors.length > 0
    ? `Preflight bloqueado: ${result.errors.join(' ')}`
    : 'Preflight bloqueado: configuración no válida.';
}

module.exports = {
  SECURITY_MODES,
  SAFE_CLAUDE_PERMISSION_MODE,
  SAFE_CODEX_SANDBOX,
  normalizeSecurityMode,
  normalizeSkills,
  resolveHeadlessSecurity,
  preflightTask,
  formatPreflightFailure,
};
