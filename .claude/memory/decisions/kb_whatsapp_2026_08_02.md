# Decisión: base de conocimiento (KB) del bot de WhatsApp (2026-08-02)

## Qué pidió Luismi
El bot solo debe resolver dudas que estén en una base de conocimiento que él escribe y
mantiene ("me juego el cuello"): relacionar el problema del cliente con una ficha y dar
LA solución descrita. Objetivo: quitar trabajo humano en lo repetitivo. Velocidad vital.

## Diseño elegido: selector LLM en 2 pasos + grounding verificado (NO vector DB)
- Fichas `.md` en `~/.claude/whatsapp-bridge/kb/` con frontmatter `id` + `sintomas`
  (coloquiales — es lo único que ve el clasificador). README y plantilla en esa carpeta.
- Pipeline en `respondFromKb` (`whatsapp/whatsapp-client.js`):
  1. **Selector** (haiku, 30s timeout): índice completo + mensaje → JSON
     `{tipo: kb|smalltalk|sin_ficha, ids}`. Parse fail-safe: basura → sin_ficha.
  2. **sin_ficha** → `escalateToHuman`: mensaje honesto (`kbEscalateText`), chat a MANUAL.
  3. **kb** → turno con SOLO las fichas elegidas + `KB_ANSWER_RULES` (persona + prohibido
     conocimiento propio + marcador `[KB:id]` obligatorio en la última línea),
     modelo `kbAnswerModel` (default **sonnet** — el seguro barato).
  4. **Verificación programática** (`verifyGroundedReply`): sin marcador / ficha no
     permitida / `[KB:ninguna]` / vacío → escalada. El marcador se recorta antes de enviar.
  5. **smalltalk** → persona + `SMALLTALK_RULES` (solo cortesía, prohibido resolver).
- Auditoría: cada decisión en `~/.claude/whatsapp-bridge/kb-audit.jsonl`.
- Config nueva (normalizeConfig, defaults en código): `kbMode` ('strict' default | 'off'),
  `kbAnswerModel` ('sonnet'), `kbEscalateText`. En whitelist `WA_SAFE_CONFIG_FIELDS`.
- **Sin fichas en kb/ → flujo persona libre de siempre** (no rompe nada hasta que Luismi
  escriba la primera ficha real; las `_plantilla`/`.example` no cuentan).

## Por qué NO RAG con embeddings/vector store
Sin API key (todo OAuth CLI) no hay endpoint de embeddings; infra local = frágil y opaca.
A escala <500 fichas, el selector LLM sobre el índice es mejor matching en español
coloquial y 100% auditable. Si crece: prefiltro léxico local delante, mismo diseño.

## Validación (2026-08-02)
- Módulo puro `whatsapp/whatsapp-kb.js` + 16 tests (`tests/whatsapp-kb.test.js`). Suite 595/0.
- E2E con CLI real: "la maquinita de los tickets no me saca las facturas" → ficha
  impresora → pasos exactos, verificado; pregunta de precios sin ficha → escalada;
  "hola buenos días" → smalltalk. Selector ~7s, respuesta sonnet ~6s.
- Latencia total por respuesta: ~30-40s (ventana 11s + selector + respuesta + humanize).

## Ampliación misma tarde: editor de fichas en la app + multi-solución + ficha activa
- **Editor en la app** (pedido por Luismi, "a nivel cliente"): Configuración WhatsApp →
  pestaña **Fichas** — lista, crear, editar, borrar. IPC `whatsapp:kb-list/get/save/delete`
  (`main/whatsapp-ipc.js`, id regex + path SIEMPRE server-side, sin traversal), preloads
  duplicados actualizados, UI en `whatsapp-panel.js` (kbShowList/kbShowEditor/kbAddSolRow).
  ⚠️ Regla: dentro del modal NO hay `.hidden` global — regla propia
  `#wa-kb-*.hidden { display:none }` en el CSS inyectado (bug real cazado por CDP).
- **Multi-solución**: fichas con `## Solución N: título` (helpers `parseCardSections`/
  `buildCardBody`, roundtrip testeado). `KB_ANSWER_RULES` guía UNA solución cada vez,
  usa el historial para no repetir descartadas, agotadas → `[KB:ninguna]`.
- **Ficha activa por chat** (`chat.kbActive`, TTL 30 min): los mensajes siguientes van
  directos a la ficha en curso sin re-clasificar (multi-turno rápido y coherente);
  `[KB:ninguna]` con ficha activa → re-clasifica; escalada limpia `kbActive`.
- E2E validado con CLI real: T1 da Solución 1; T2 ("ya lo hice y sigue igual") da la
  Solución 2 sin repetir; T3 agotadas → `[KB:ninguna]` → escalada. UI verificada por CDP
  con screenshots (crear + guardar + listar). Tests 600 (594 pass / 0 fail).

## Ronda de velocidad/naturalidad (misma tarde, feedback en vivo de Luismi)
1. **Mensaje vago pero relacionado con un tema de las fichas** ("tengo un problema con mi batería", enviado por Noa): antes escalaba directo. Nuevo tipo de selector `vago` (junto a kb/smalltalk/sin_ficha), con historial de contexto en `buildSelectorPrompt`. Tope de **1 pregunta de aclaración** (`nextClarifyState`, TTL 30 min, `chat.kbClarify`) — si tras preguntar sigue vago, ahí sí escala. Validado con CLI real: pregunta → cliente da detalle → acierta ficha; si sigue vago, escala sin preguntar dos veces.
2. **"tarda un huevo"**: ventana de agrupación 11s→6s, humanización de envío recortada a la mitad (typing máx 9s→5s).
3. **"cada cuántos segundos contesta, no parece aleatorio, eso canta"**: la ventana de agrupación era un número FIJO — el único componente sin jitter de todo el pipeline. Ahora `nextAggregateSilenceMs()` sortea 4-8s en cada ráfaga, nunca el mismo valor dos veces. Aclarado además que el "Claude escribiendo…" del panel es SOLO vista interna de Luismi — el cliente real ve su propio "escribiendo…" aparte, gobernado por `humanizeBeforeSend` en el bridge, solo los segundos justo antes de enviar.

## Pendiente
- Luismi debe escribir las fichas reales (20-30 dudas frecuentes) desde la pestaña Fichas.
- El symlink `~/Desktop/FICHAS-WHATSAPP` → kb/ sigue existiendo (ya redundante con la UI).
- Sin resolver: el bot dispara el pipeline completo (agrupación+selector) incluso para cierres triviales tipo "gracias"/"ok" — funciona pero es gasto de más; no se ha decidido si el bot debería reconocer cierre de conversación y callar.
