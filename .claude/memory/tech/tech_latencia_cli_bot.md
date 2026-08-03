# Latencia de los spawns del CLI: el entorno personal se hereda entero

_2026-08-03. Medido, no estimado._

## Cómo medir (esto es lo reutilizable)

`--output-format json` devuelve `duration_api_ms` aparte del total. Esa resta es todo:

```js
const t = process.hrtime.bigint()
const out = execFileSync(CLAUDE, [...args, '--output-format','json'], {encoding:'utf8'})
const wall = Number(process.hrtime.bigint()-t)/1e6
const api  = JSON.parse(out).duration_api_ms
// wall - api = lo que tarda el CLI en arrancar, sin el modelo
```

Sin esa separación no se distingue "el modelo piensa despacio" de "el CLI tarda en arrancar", y se optimiza el sitio equivocado. El JSON trae además `usage.input_tokens` / `cache_creation_input_tokens`, que delatan contexto que no pusiste tú.

## El hallazgo

Hipótesis inicial: el arranque del binario `claude` cuesta segundos. **Falsa** — `claude --version` son 224 ms.

Lo que sí pasaba: cada spawn del bot cargaba **el entorno personal completo** de Luismi — los ~10 servidores MCP configurados (Gmail, Drive, Calendar, Obsidian, Supabase…), el `CLAUDE.md` global, settings, hooks y skills. El bot no usa nada de eso (va con `--tools ''`), pero lo pagaba dos veces: en arranque y en tokens de entrada.

Con el prompt real (persona + una ficha, haiku):

| | arranque | API | total | tokens de entrada ajenos |
|---|---|---|---|---|
| sin flags | 3,6 s | 7,6 s | **11,2 s** | ~9.000 |
| con flags | 0,75 s | 6,2 s | **6,9 s** | 0 |

**4,3 s por turno**, y cada respuesta al cliente son DOS turnos (selector haiku + respuesta sonnet): **~8,6 s por mensaje**, sobre una mediana medida de 29 s.

## La regla

Todo spawn del CLI que **no sea una sesión interactiva de Luismi** va aislado:

```
--tools ''  --no-session-persistence  --strict-mcp-config  --setting-sources ''
```

Vive en `ISOLATION_ARGS` / `buildClaudeArgs()` (`whatsapp/whatsapp-auto-reply.js`), con test que lo caza si alguien los borra (`tests/whatsapp-cli-isolation.test.js`).

- `--setting-sources ''` **no rompe el login OAuth del Max**: auth y modelo siguen aplicando. Verificado en vivo.
- **NO usar `--bare`** con claude >=2.1.144: fuerza `ANTHROPIC_API_KEY` e ignora la sesión OAuth → "Not logged in".
- Las sesiones interactivas de Luismi (PTY de la app, sub-chat, task-sessions) **no** llevan esto: ahí sí quiere sus MCP y su `CLAUDE.md`.

Beneficio colateral y no menor: sin esto, un mensaje de WhatsApp de un desconocido entra a un proceso con los MCP de Gmail y Drive cargados. `--tools ''` impedía invocarlos, pero la superficie estaba ahí.

## Lo que queda

Los ~6,2 s restantes sí son el modelo generando. Palancas, ambas con coste:

- `kbAnswerModel` de sonnet a haiku → más rápido, peor ceñido a la ficha (que es justo lo que ese paso debe hacer bien).
- CLI → API directa con fast mode (hasta 2,5× en generación), pero **factura aparte del plan Max**: decisión de negocio, no técnica.

Lo que **no** ayuda: `--effort low` en el selector (medido, no cambia con haiku).
