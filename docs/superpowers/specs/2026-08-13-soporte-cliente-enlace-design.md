# Soporte a cliente por enlace autorizador

Fecha: 2026-08-13
Estado: diseño aprobado, sin implementar

## Problema

Luismi necesita sacar una conversación concreta fuera del Mac para dar
asistencia a un cliente. El cliente abre un enlace en su móvil, habla con el
agente y manda fotos; Luismi ve el hilo en vivo desde su app y puede intervenir
o cortar. Human-in-the-loop: el enlace es la autorización.

Lo que hoy existe (`lan-client.html` + invitación LAN) no sirve tal cual: es el
panel completo de operador —terminal xterm, explorador de ficheros, selector de
sesiones— y su modelo de acceso remoto asume Cloudflare Access con identidad del
equipo. Un cliente no tiene esa identidad ni puede ver esa superficie.

## Qué se reutiliza

| Pieza existente | Uso |
| --- | --- |
| `main/lan-session-invites.js` | Patrón de token efímero acotado a `{cwd, sessionId, cli}`. Se copia el patrón, no se reutiliza el store (ver decisión D3) |
| Motor del relay de Telegram | Transcript JSONL como fuente de verdad, fin de turno por último `assistant` no-sidechain con `stop_reason: 'end_turn'`, lectura parcial por offset |
| `main/pty-prompt-write.js` | `writePromptThenEnter` para todo write al PTY |
| `main/untrusted-input.js` | `sanitizeChannelText` en todo texto que entra por canal |
| `main/lan-audit.js` | Eventos de auditoría |
| Perfiles / panel 📚 | Persona y conocimiento precargado del experto que atiende |

## Decisiones

- **D1 — Superficie propia.** El cliente abre `support-chat.html`, página nueva
  de burbujas. No es `lan-client.html` con cosas ocultas por CSS: lo oculto se
  desoculta.
- **D2 — Listener aparte.** `main/support-server.js` escucha en su propio
  puerto y solo sabe servir `support-chat.html` y el WS de soporte. El túnel
  apunta ahí. El `ws-server` LAN sigue siendo solo LAN, sin cambios en su
  exposición. Filtrar por cabeceras de `cloudflared` no vale: se falsifican.
- **D3 — Store de invitaciones propio.** Soporte necesita horas (2 h por
  defecto, 8 h máximo, un solo cliente por enlace). No se toca el `MAX_TTL_MS`
  de 30 min del invite LAN: relajarlo debilitaría el acceso de operador.
- **D4 — El contenido sale del transcript, nunca del TUI.** Regla dura del
  runbook. El canal de soporte es un consumidor más del motor del relay.
- **D5 — Chat limpio.** El cliente arranca en blanco. El agente conserva
  contexto y conocimiento; el cliente nunca ve rutas, comandos, salidas de
  terminal ni lo hablado antes. Filtrado por construcción, no por lista negra.
- **D6 — Modo mixto por sesión.** Al crear el enlace se elige `moderado` o
  `autonomo`.
- **D7 — Agente sin herramientas de escritura.** La sesión de soporte corre con
  un perfil que solo conversa sobre su conocimiento: no edita ficheros, no
  ejecuta comandos, no navega.
- **D8 — Fotos sí.** Suben al listener de soporte, aterrizan en
  `userData/support-uploads/<inviteId>/`, se pasan al agente por ruta absoluta
  y se borran al cerrar la sesión.
- **D9 — Cloudflare Tunnel efímero, sin Access.** El túnel es imprescindible:
  sin él el enlace solo abre dentro de la LAN. Queda público porque el cliente
  no puede autenticarse en Access; la única llave es el invite. El túnel no
  arranca con la app: se enciende al crear el primer enlace y se apaga al
  cerrar el último.
- **D10 — Dos modos de túnel, `quick` por defecto.** `quick` usa
  `trycloudflare.com`: cero configuración, cero coste, URL distinta en cada
  arranque. Eso no molesta aquí porque el enlace se genera en el momento y se
  manda ya construido — la advertencia del 2026-08-07 contra Quick Tunnel
  aplicaba a la publicación permanente del acceso de operador, no a un túnel
  que vive lo que dura una asistencia. `named` usa un hostname propio cuando
  haya dominio: solo cambia configuración, no código. `support-tunnel.js`
  soporta los dos desde el principio.

## Componentes

| Módulo | Responsabilidad | Depende de |
| --- | --- | --- |
| `main/support-invites.js` | Crear, validar, consumir y expirar invitaciones `{id, token, sessionId, cwd, cli, mode, label, ttl, createdAt, claimedAt}`. Un solo cliente por enlace | `crypto` |
| `main/support-server.js` | Listener HTTP+WS propio. Sirve `support-chat.html` y nada más. Valida el invite en cada conexión | `support-invites`, `support-channel`, `support-uploads` |
| `main/support-channel.js` | Traduce transcript → burbujas y mensaje del cliente → PTY. Aplica `sanitizeChannelText` y delimitación anti-inyección | motor del relay, `pty-prompt-write`, `untrusted-input` |
| `main/support-moderation.js` | Cola de respuestas retenidas por invite: `pendiente` → `enviada` \| `editada` \| `descartada` | — |
| `main/support-uploads.js` | Recepción de fotos: tipo permitido, tamaño máximo, cuota por invite, borrado al cerrar | — |
| `main/support-tunnel.js` | Ciclo de vida de `cloudflared`: arrancar, comprobar salud, parar. Best-effort, nunca bloquea la app | — |
| `support-chat.html` + su módulo de renderer | Vista del cliente: burbujas, campo de texto, subir foto, estado de conexión | — |
| Panel de soporte en el renderer de la app | Crear enlace (modo, TTL, etiqueta), QR, hilo en vivo, aprobar/editar/enviar, escribir como humano, cortar | IPC |
| IPC en `main/ws-server-ipc.js` o módulo hermano | `support:create-invite`, `support:list`, `support:approve`, `support:send-as-human`, `support:revoke` | — |

`support-chat.html` y todo `.js` nuevo en raíz se añaden a mano a `build.files`
del `package.json` (whitelist).

## Flujo

1. Luismi, en una tab, pulsa **Dar soporte**. Elige modo, TTL y etiqueta del
   cliente. Si el túnel no corre, se levanta.
2. Sale URL + QR. La URL lleva `?invite=<token>` y nada más; jamás el Bearer.
3. El cliente abre. El invite se reclama (un solo uso) y se fija a ese
   navegador. Chat limpio.
4. El cliente escribe → `sanitizeChannelText` → texto delimitado como entrada
   no confiable → `writePromptThenEnter` al PTY de esa sesión.
5. Fin de turno detectado por transcript:
   - `moderado`: la respuesta queda retenida; el cliente ve «escribiendo…» y
     Luismi recibe aviso. Luismi envía, edita o descarta.
   - `autonomo`: sale directa al cliente; Luismi la ve pasar y puede cortar.
6. Luismi puede escribir como humano en cualquier momento: la burbuja va
   marcada distinta del agente.
7. Cierre por expiración o corte manual: WS cerrado, uploads borrados, evento
   de auditoría. Si no queda ningún enlace vivo, el túnel se para.

## Seguridad

Modelo de amenaza: el cliente es **no confiable** y el hostname es público.

- Superficie mínima: el puerto de soporte no sirve `lan-client.html`, ni
  `/status`, ni `/vendor/` salvo lo que necesite la vista de chat.
- El invite es la única llave: un solo uso, TTL corto, revocable, y su fuga se
  corta parando el enlace.
- Inyección de prompt: `sanitizeChannelText` limpia caracteres de control, **no
  intenciones**. La defensa real es D7 — sin herramientas de escritura, una
  inyección consigue como mucho que el agente diga una tontería.
- **El modo moderado controla lo que se dice, no lo que se hace.** Cuando la
  respuesta se retiene, el agente ya ejecutó lo que fuera durante el turno. Se
  retiene el mensaje, no sus efectos. Con D7 esto es aceptable; si algún día se
  relaja D7, esta garantía desaparece.
- Los uploads no se sirven de vuelta por HTTP: entran, se pasan por ruta al
  agente y se borran.
- Todo evento relevante se audita: creación, reclamación, mensajes por turno
  (metadatos, no contenido), moderación, cierre.

## Errores

| Caso | Comportamiento |
| --- | --- |
| Invite inválido, caducado o ya reclamado | Página genérica de «enlace no disponible». Sin detalles que distingan los tres casos |
| PTY caído o sesión muerta | Aviso a Luismi y espera visible al cliente. **Prohibido fallback headless** (regla del runbook) |
| Túnel caído | El enlace no resuelve. La app lo detecta y lo marca en el panel; no reintenta en bucle |
| Foto rechazada (tipo, tamaño, cuota) | Error explícito al cliente, fichero descartado en servidor |
| Dos pestañas con el mismo invite | La segunda se rechaza: un enlace, un cliente |

## Tests

Node `--test`, puertos en la banda propia del fichero dentro de 12000–19900.

- `support-invites`: un solo uso, expiración por TTL, revocación, rechazo de
  token con formato inválido.
- `support-server`: pedir `/lan-client.html` al puerto de soporte devuelve 404;
  conexión sin invite se rechaza; conexión con invite caducado se rechaza.
- `support-channel`: el texto del cliente pasa por `sanitizeChannelText` antes
  de tocar el PTY; el turno se cierra por `stop_reason: 'end_turn'`.
- `support-moderation`: retención, edición, descarte y que una respuesta
  descartada jamás se emite.
- `support-uploads`: rechazo por tipo y tamaño; borrado efectivo al cerrar.

## Fuera de alcance v1

Varios clientes en el mismo enlace, historial persistente entre sesiones de
soporte, facturación o cuota de tokens por cliente, y notas de voz del cliente.

## Prerrequisitos

- `cloudflared` instalado en el Mac. Es lo único imprescindible: la v1 arranca
  en modo `quick`, sin dominio (confirmado con Luismi el 2026-08-13, no tiene).
- Dominio en Cloudflare: **opcional**, para pasar a modo `named`. Aporta URL
  estable y con tu marca, que ante un cliente inspira más confianza que un
  `trycloudflare.com` aleatorio. No bloquea la v1.
- Si algún día se usa `named`, ese hostname queda **fuera** de la política de
  Cloudflare Access que protege los hostnames de operador.
