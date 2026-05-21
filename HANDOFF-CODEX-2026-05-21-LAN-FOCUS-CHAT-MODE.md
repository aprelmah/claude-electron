# HANDOFF · 2026-05-21 · LAN Focus Chat Mode

## Cambio aplicado

Se añadió un modo `móvil/tablet` dentro de sesiones LAN para dejar la pantalla en `solo chat`:

- botón nuevo en el switch de vista: `Modo móvil/tablet`
- al activar:
  - fuerza `Chat simple`
  - oculta topbar, onboarding, extras, keybar, pie de chat y botón de terminal
- al desactivar:
  - restaura layout normal

Archivo tocado:

- `lan-client.html`

## Claves técnicas

- estado UI en `body[data-focus-chat]`
- estado runtime en `appState.focusChatMode`
- función central `setFocusChatMode(enabled)`
- protección en `setChatView()` para impedir entrar a `terminal` mientras el foco chat esté activo

## Verificación rápida

- parse JS embebido de `lan-client.html`: OK
- `node --check main.js`: OK
- `node --check main/ws-server.js`: OK

## Uso

1. Entrar en sesión LAN.
2. Pulsar `Modo móvil/tablet`.
3. Para volver, pulsar `Salir modo móvil/tablet`.

