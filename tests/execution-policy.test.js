'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SECURITY_MODES,
  normalizeSecurityMode,
  normalizeSkills,
  resolveHeadlessSecurity,
  preflightTask,
  formatPreflightFailure,
} = require('../main/execution-policy');

test('la política segura de Claude no usa bypassPermissions', () => {
  const result = resolveHeadlessSecurity({ cli: 'claude', securityMode: 'safe' });
  assert.equal(result.mode, SECURITY_MODES.SAFE);
  assert.deepEqual(result.args, ['--permission-mode', 'acceptEdits']);
  assert.equal(result.bypassPermissions, false);
});

test('la política confiada de Claude conserva el modo explícito de bypass', () => {
  const result = resolveHeadlessSecurity({ cli: 'claude', securityMode: 'trusted' });
  assert.deepEqual(result.args, ['--permission-mode', 'bypassPermissions']);
  assert.equal(result.bypassPermissions, true);
});

test('la política segura de Codex limita sandbox y aprobaciones', () => {
  const result = resolveHeadlessSecurity({ cli: 'codex', securityMode: 'safe' });
  assert.deepEqual(result.args, ['--sandbox', 'workspace-write', '--approve-for-me']);
  assert.equal(result.bypassPermissions, false);
});

test('normaliza alias y skills sin duplicados ni nombres inseguros', () => {
  assert.equal(normalizeSecurityMode('bypassPermissions'), SECURITY_MODES.TRUSTED);
  assert.deepEqual(normalizeSkills('planning, planning, bad name, ui-kit'), ['planning', 'ui-kit']);
});

test('el preflight permite la primera ejecución de una tarea con resume', () => {
  const result = preflightTask({
    name: 'Revisión',
    cli: 'claude',
    prompt: 'Revisa el repositorio',
    resume: true,
  });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /sesión nueva/);
  assert.equal(formatPreflightFailure(result), '');
});

test('el preflight permite una tarea segura válida y avisa de trusted', () => {
  const safe = preflightTask({ name: 'Test', cli: 'codex', prompt: 'Lee los tests', skills: ['review'] });
  assert.equal(safe.ok, true);
  assert.equal(safe.securityMode, SECURITY_MODES.SAFE);
  assert.deepEqual(safe.skills, ['review']);

  const trusted = preflightTask({ name: 'Test', cli: 'claude', prompt: 'Hazlo', securityMode: 'trusted' });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.warnings.length, 1);
});
