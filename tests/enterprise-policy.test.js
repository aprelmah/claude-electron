const { describe, test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const {
  DEFAULT_ROLE_ID,
  normalizeEnterpriseConfig,
  resolveEffectiveSessionContext
} = require(path.join(REPO_ROOT, 'main', 'enterprise-policy.js'))

describe('enterprise-policy.normalizeEnterpriseConfig', () => {
  test('aplica defaults, dedupe y sanea operadores/roles', () => {
    const cfg = normalizeEnterpriseConfig({
      enabled: true,
      roles: [
        { id: 'Admin', name: 'Admin', permissions: { 'fs.read': true }, allowedRoots: ['/tmp', '/tmp'] },
        { id: 'Admin', name: 'Duplicado' }
      ],
      operators: [
        { id: 'OP-1', name: 'Secretaria', username: 'sec.retaria', roleId: 'admin', defaultProfileId: 'perfil-a' },
        { id: 'OP-1', name: 'duplicado', username: 'otra' }
      ]
    }, { profileIds: ['perfil-a', 'perfil-b'] })

    assert.strictEqual(cfg.enabled, true)
    assert.ok(Array.isArray(cfg.roles))
    assert.ok(cfg.roles.some((r) => r.id === DEFAULT_ROLE_ID), 'incluye rol por defecto')
    assert.ok(cfg.roles.some((r) => r.id === 'admin'), 'conserva rol custom saneado')
    assert.strictEqual(cfg.operators.length, 1, 'dedupe por id')
    assert.strictEqual(cfg.operators[0].id, 'op-1')
    assert.strictEqual(cfg.operators[0].roleId, 'admin')
    assert.strictEqual(cfg.operators[0].defaultProfileId, 'perfil-a')
  })
})

describe('enterprise-policy.resolveEffectiveSessionContext', () => {
  const profiles = [
    { id: 'default', name: 'Personal', mcpServers: ['github', 'slack'], personaPrompt: 'Persona perfil default' },
    { id: 'perfil-a', name: 'Perfil A', mcpServers: ['github', 'notion'], personaPrompt: 'Persona perfil A' }
  ]

  test('mantiene modo legacy si enterprise está deshabilitado', () => {
    const ctx = resolveEffectiveSessionContext({
      enterprise: { enabled: false },
      profiles,
      activeProfileId: 'default',
      remoteContext: { operatorId: 'op-1' },
      legacyAllowedRoots: ['/Users/demo/work']
    })
    assert.strictEqual(ctx.mode, 'legacy')
    assert.strictEqual(ctx.enterpriseApplied, false)
    assert.strictEqual(ctx.profileId, 'default')
    assert.deepStrictEqual(ctx.allowedRoots, [path.resolve('/Users/demo/work')])
  })

  test('mantiene modo legacy si no llega contexto remoto explícito', () => {
    const ctx = resolveEffectiveSessionContext({
      enterprise: { enabled: true, roles: [], operators: [] },
      profiles,
      activeProfileId: 'default',
      remoteContext: {},
      legacyAllowedRoots: ['/Users/demo/work']
    })
    assert.strictEqual(ctx.mode, 'legacy')
    assert.strictEqual(ctx.enterpriseApplied, false)
  })

  test('resuelve operador/rol/perfil/persona y política MCP', () => {
    const ctx = resolveEffectiveSessionContext({
      enterprise: {
        enabled: true,
        roles: [{
          id: 'secretaria-role',
          name: 'Secretaria',
          permissions: {
            'pty.execute': true,
            'fs.read': true,
            'fs.write': false,
            'fs.list': true,
            'fs.delete': false,
            'fs.rename': false,
            'viewer.open': true,
            'automations.manage': false
          },
          allowedRoots: ['/Users/demo/secretaria'],
          readOnlyRoots: ['/Users/demo/secretaria/clientes'],
          allowedMcpServers: ['github']
        }],
        operators: [{
          id: 'secretaria',
          name: 'Secretaria',
          username: 'secretaria',
          roleId: 'secretaria-role',
          defaultProfileId: 'perfil-a',
          personaPrompt: 'Persona de operadora'
        }]
      },
      profiles,
      activeProfileId: 'default',
      remoteContext: { operatorId: 'secretaria' },
      legacyAllowedRoots: ['/Users/demo/work']
    })

    assert.strictEqual(ctx.mode, 'enterprise')
    assert.strictEqual(ctx.enterpriseApplied, true)
    assert.strictEqual(ctx.operatorId, 'secretaria')
    assert.strictEqual(ctx.roleId, 'secretaria-role')
    assert.strictEqual(ctx.profileId, 'perfil-a')
    assert.strictEqual(ctx.personaResolved, 'Persona de operadora')
    assert.strictEqual(ctx.personaSource, 'operator')
    assert.deepStrictEqual(ctx.allowedRoots, [path.resolve('/Users/demo/secretaria')])
    assert.deepStrictEqual(ctx.readOnlyRoots, [path.resolve('/Users/demo/secretaria/clientes')])
    assert.deepStrictEqual(ctx.allowedMcpServers, ['github'], 'intersección rol/perfil')
    assert.strictEqual(ctx.permissions['fs.write'], false)
    assert.strictEqual(ctx.permissions['fs.read'], true)
  })

  test('si operador no existe usa fallback controlado sin romper sesión', () => {
    const ctx = resolveEffectiveSessionContext({
      enterprise: {
        enabled: true,
        roles: [{ id: 'gerente', name: 'Gerente', permissions: { 'fs.read': true } }],
        operators: []
      },
      profiles,
      activeProfileId: 'default',
      remoteContext: { operatorId: 'inexistente', profileId: 'perfil-a', roleId: 'tambien-invalido' },
      legacyAllowedRoots: ['/Users/demo/work']
    })

    assert.strictEqual(ctx.mode, 'enterprise')
    assert.strictEqual(ctx.operatorId, '')
    assert.strictEqual(ctx.profileId, 'perfil-a')
    assert.strictEqual(ctx.roleId, 'default-role')
    assert.ok(ctx.fallbackReasons.includes('operator-not-found-or-disabled'))
  })
})
