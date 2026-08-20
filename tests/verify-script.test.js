'use strict'

// Blindaje de scripts/verify.sh.
//
// verify.sh es la Definition of Done ejecutable, y lo que la hace utilizable a
// ciegas es que sea SOLO LECTURA: se corre en cualquier momento, con la app
// viva, sin miedo. Esa garantía no puede depender de que quien lo edite se
// acuerde — se comprueba aquí. Si alguien "mejora" el script metiéndole un
// borrado del lock huérfano o un pkill de la instancia dev, la suite lo para.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'verify.sh')

describe('scripts/verify.sh existe y es ejecutable', () => {
  test('el fichero está donde package.json lo busca', () => {
    assert.ok(fs.existsSync(SCRIPT_PATH), 'falta scripts/verify.sh')
  })

  test('tiene bit de ejecución', () => {
    const mode = fs.statSync(SCRIPT_PATH).mode
    assert.ok((mode & 0o111) !== 0, 'scripts/verify.sh no es ejecutable (chmod +x)')
  })

  test('package.json lo expone como npm run verify', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    assert.strictEqual(pkg.scripts.verify, 'bash ./scripts/verify.sh')
  })
})

describe('scripts/verify.sh no contiene verbos destructivos', () => {
  const SRC = fs.readFileSync(SCRIPT_PATH, 'utf8')

  // Cada entrada es [etiqueta, regex, por qué]. La regex se aplica al fichero
  // ENTERO, comentarios incluidos: si el verbo no puede ni escribirse, no hay
  // forma de colarlo "solo en un caso".
  const PROHIBIDOS = [
    ['pkill', /\bpkill\b/, 'matar procesos es cosa del deploy, no del diagnóstico'],
    ['kill', /\bkill\b/, 'ni siquiera hijos propios: la garantía es sin matices'],
    ['killall', /\bkillall\b/, 'idem'],
    ['rm recursivo o forzado', /\brm\s+-[a-zA-Z]*[rf]/, 'borrar locks o temporales no es diagnosticar'],
    ['git destructivo', /\bgit\s+(reset|checkout|clean|restore|stash)\b/, 'verify.sh jamás toca el árbol de trabajo'],
    ['launchctl mutante', /\blaunchctl\s+(bootout|bootstrap|enable|disable|kickstart|load|unload|start|stop)\b/, 'el bridge de WhatsApp es intocable: solo print-disabled y list'],
    ['npm run deploy', /npm\s+run\s+deploy/, 'verificar no es desplegar'],
    ['osascript quit', /osascript[^\n]*quit/, 'no se cierran apps del usuario'],
    ['redirección destructiva a la app', /> *\/Applications/, 'nada escribe en /Applications']
  ]

  for (const [etiqueta, regex, porque] of PROHIBIDOS) {
    test(`no usa ${etiqueta}`, () => {
      assert.ok(!regex.test(SRC), `verify.sh contiene "${etiqueta}": ${porque}`)
    })
  }

  test('el único fichero que crea es el log de la suite, y va a TMPDIR', () => {
    // Solo cuentan las redirecciones de shell: `>` precedido de espacio, `;` o
    // `(`. Así quedan fuera las flechas `=>` de los node -e (antes va un `=`) y
    // los `2>&1` (antes va un dígito). Destinos permitidos: /dev/null y el log.
    const PERMITIDOS = ['/dev/null', '"$TEST_LOG"']
    const sospechosas = []
    const re = /(?:^|[ \t;(])>>?[ \t]*([^&\s;|)]+)/gm
    let m
    while ((m = re.exec(SRC)) !== null) {
      if (!PERMITIDOS.includes(m[1])) sospechosas.push(m[1])
    }
    assert.deepStrictEqual(sospechosas, [], `redirecciones a fichero inesperadas: ${sospechosas.join(', ')}`)
  })
})

// Las tres trampas que costaron una investigación entera. No son estilo: son la
// diferencia entre un check que dice la verdad y uno que da un falso OK.
describe('scripts/verify.sh conserva los invariantes medidos', () => {
  const SRC = fs.readFileSync(SCRIPT_PATH, 'utf8')

  test('el SingletonLock se prueba con -L, nunca con -e en la rama principal', () => {
    // Es un symlink COLGANTE (apunta a "<hostname>-<pid>", que no existe como
    // fichero): con -e da false aunque el lock esté ahí, así que un check
    // basado en -e no detectaría jamás un huérfano. El -e del elif sí vale:
    // cubre el caso raro de que el lock no sea un symlink.
    assert.ok(SRC.includes('if [ -L "$LK" ]; then'), 'el lock debe probarse con [ -L ]')
    assert.ok(!SRC.includes('\nif [ -e "$LK" ]'), 'la rama principal no puede usar [ -e ]')
  })

  test('los pathspec de build.files se normalizan quitando /**/*', () => {
    // En un pathspec de git el `*` cruza las barras: "main/**/*" exige una
    // segunda "/" y NO matchea "main/foo.js". Sin normalizar, el deploy sale
    // "al día" justo cuando el último cambio vive en un fichero de main/.
    assert.ok(SRC.includes('replace(/\\/\\*\\*\\/\\*$/'), 'falta la normalización de "/**/*" en el pathspec')
  })

  test('la app empaquetada se detecta por la ruta del bundle, no por "electron"', () => {
    // El binario de la empaquetada se llama POWER-AGENT: `grep electron` no la
    // ve nunca, y el check de "¿tiene ventana?" daría siempre negativo.
    assert.ok(SRC.includes('POWER-AGENT.app/Contents/MacOS/POWER-AGENT'), 'falta la detección por ruta del bundle')
  })

  test('el deploy se compara contra el último commit de código, no contra HEAD', () => {
    assert.ok(SRC.includes("git log -1 --format='%ct' -- $SPECS"), 'el asar debe datarse contra $SPECS')
  })
})
