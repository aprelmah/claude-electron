---
name: tech-llm-plist-truncation
description: Bug observado en Claude Opus generando plists launchd — corta antes del </plist>. Workaround repairPlist en generator
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2e9c12d6-032c-4786-b2bc-824f09b1e89f
---

# LLM corta plists XML sin cerrar `</plist>`

Bug observado **consistentemente** con Claude Opus (probablemente otros LLMs también) al generar `.plist` launchd dentro de un bloque `<PLIST>...</PLIST>` en su respuesta: termina con `</dict>` correcto pero **olvida** el `</plist>` final.

Resultado: `plutil -lint` falla con `Encountered unexpected EOF` y `launchctl bootstrap` con `exit 5: Input/output error`.

## Workaround implementado en POWER-AGENT

`automations/generator.js` → función `repairPlist(raw)`:

```js
function repairPlist(raw) {
  let p = String(raw).trimEnd()
  if (!/<\/plist>\s*$/i.test(p)) {
    const afterPlist = p.replace(/^[\s\S]*?<plist[^>]*>/i, '')
    const opens = (afterPlist.match(/<dict>/gi) || []).length
    const closes = (afterPlist.match(/<\/dict>/gi) || []).length
    for (let i = closes; i < opens; i++) p += '\n</dict>'
    p += '\n</plist>\n'
  } else if (!p.endsWith('\n')) {
    p += '\n'
  }
  return p
}
```

Se ejecuta tras `extractBlock` y antes de devolver al installer. Cuenta `<dict>` abiertos vs cerrados, cierra los que faltan, añade `</plist>` final.

## Otros casos de "respuesta truncada" del LLM observados

- **Script entero reemplazado por `...`** (3 bytes literal): el chat del agente al "Aplicar y reinstalar" puede generar un script vacío si la respuesta no contiene `<SCRIPT>...</SCRIPT>` bien formado. Mitigación: validar mínimo 100 bytes y shebang antes de instalar.
- **Bloque SCRIPT sin cierre**: similar al plist, ocasional. La validación `script.startsWith('#!')` en `generator.js` lo detecta, pero no cubre todos los casos. Mejor: tras extraer, validar también que termina con `\n` y no en mitad de una línea.

## Reglas en `automation-builder` SKILL.md

Las reglas innegociables ahora incluyen un checklist explícito de "antes de devolver":
- Plist cierra con `</plist>` y `</dict>` balanceados.
- Script comienza con shebang y termina con newline.

Ver `/Users/isabel/.claude/skills/luismi/automation-builder/SKILL.md`.

## Lección

Cualquier output estructurado de un LLM (XML, JSON, código) **debe pasar por parsing+validación+reparación automática** antes de usarlo en producción. No fiarse de que el LLM cierra correctamente — siempre los hay que se cortan.
