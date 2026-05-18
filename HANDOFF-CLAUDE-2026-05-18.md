# HANDOFF CLAUDE — POWER-AGENT

Fecha: **2026-05-18**
Proyecto: `/Users/isabel/Desktop/LUISMI/claude-electron`

## Estado final verificado
- Rama: `main`
- Git: `HEAD == origin/main`
- Último commit: `f27ab5f`
- Árbol de trabajo: limpio
- App activa:
  - `/Users/isabel/Desktop/POWER-AGENT.app` -> symlink a `/Applications/POWER-AGENT.app`
  - `app.asar` timestamp: `May 17 23:43:33 2026`

## Qué se cerró en esta tanda (Telegram/PTy/UX/grafo)

1. **Relay PTY directo Telegram (sin `--resume` por turno cuando está enlazado)**
- Commit: `f4d2d61`
- Resultado: Telegram escribe contra la **sesión PTY viva** (Claude/Codex) en vez de abrir proceso nuevo por mensaje.
- Impacto: coste incremental mínimo (misma sesión viva), evita sobrecoste de contexto por turno.

2. **Modo espejo temporal + bucle dev**
- Commit: `7ad3aba`
- Se probó espejo PTY y comandos dev; luego el flujo estable quedó en modo privado durante relay activo para evitar ensuciar PTY local.

3. **Fix de arranque Codex por PATH/NVM**
- Commit: `aac6bfc`
- Síntoma resuelto: rutas rotas tipo `/.../DOCUMENTOS_AGENTE//Users/isabel/.nvm/.../codex`.
- Fix: fallback robusto de binarios + inyección PATH.

4. **Relay privado + desenlace + sync de contexto al desconectar**
- Commit: `c281a60`
- Botón Telegram ahora alterna **conectar/desconectar** si ya está enlazado.
- En desconexión se ejecuta sincronización de contexto (especialmente relevante en Codex).

5. **Sesiones editables (título original) + abrir JSONL fuente**
- Commit: `ca8675e`

6. **Barra de sesión activa (arriba de chat)**
- Commit: `94525d9`
- Muestra CLI, título de sesión y botón de **copiar UID exacta**.

7. **Lupa hover para elementos pequeños**
- Commit: `ae76c73`

8. **Grafo: cerebro protagonista + búsqueda + calientes + py/php/go**
- Commit: `f27ab5f`
- Root node: cerebro luminoso girando.
- Filtros: búsqueda con foco y modo `Calientes`.
- Dependencias: ampliadas a `py`, `php`, `go`.

## Comportamiento Telegram actual (importante)

### En app
- Botón Telegram (icono oficial azul) parpadea si hay enlace vivo (`tg-linked-live`).
- Click en botón:
  - Si NO enlazado -> conecta sesión viva a Telegram.
  - Si enlazado -> desconecta relay.

### En Telegram
- Soporta `/salir`, `/unlink`, `/disconnect` para soltar enlace de ese chat.
- Durante enlace:
  - el chat usa PTY directo,
  - no se usa fallback `--resume` por turno para ese chat enlazado.

## Regla de coste
- **Sí**: hablar por Telegram enlazado a PTY y hablar por PTY local usan la misma sesión viva.
- **No**: no hay relanzamiento por mensaje con `--resume` en el modo enlazado.

## Validación rápida sugerida
1. Abrir app del Escritorio (`/Users/isabel/Desktop/POWER-AGENT.app`).
2. Confirmar botón Telegram habilitable tras detectar sesión.
3. Conectar a Telegram con el botón.
4. Enviar `hola` desde Telegram y esperar respuesta del mismo CLI activo.
5. Desconectar desde botón o `/salir`.
6. Verificar que en la app se refleja estado desenlazado.

## Notas operativas para próximos cambios
- Mantener pruebas en `npm run dev` antes de empaquetar/deploy.
- No reintroducir parser de fin de turno por stream PTY para bloques largos: es inestable con TUI moderna.
- Si se toca relay, preservar exclusión de concurrencia para evitar dobles respuestas.

## Commits clave (orden reciente)
- `f27ab5f` graph: brain root node, search/hot filters, and py/php/go links
- `ae76c73` graph(ui): magnify hover for small elements
- `94525d9` ui: show active session title and copy exact UID
- `ca8675e` sessions: edit original title and open source jsonl
- `c281a60` feat(telegram): private relay mode, unlink toggle, and context sync on detach
- `aac6bfc` fix(codex): robust fallback nvm bin and PATH injection
- `7ad3aba` feat(telegram): modo espejo PTY y arranque dev
- `f4d2d61` feat(telegram): PTY relay directo y botón enlazado en vivo
