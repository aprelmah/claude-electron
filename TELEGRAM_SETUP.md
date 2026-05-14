# Telegram Setup (CLAUDE-NOVAK)

## 1) Crear bot y obtener token
1. En Telegram abre `@BotFather`.
2. Ejecuta `/newbot`.
3. Copia el token `123456:AA...`.

## 2) Obtener tu user ID numerico
1. En Telegram abre `@userinfobot`.
2. Copia tu `id` numerico (ejemplo `12345678`).

## 3) Configurar en la app
1. Abre CLAUDE-NOVAK.
2. Pulsa `Configuracion` (engranaje).
3. En `Telegram`:
   - Activa `Activar puente Telegram`.
   - Pega `Bot token`.
   - En `Allowed users` pega tu ID numerico.
4. Pulsa `Guardar configuracion`.

## 4) Probar
1. Abre chat con tu bot.
2. Envia `/status`.
3. Envia texto normal: debe entrar al terminal del Mac.
4. Envia una nota de voz: debe transcribir y enviar al terminal.

## 5) Seguridad minima recomendada
- No compartas el token.
- Usa siempre `allowed users`.
- Si se filtra el token:
  1. Regeneralo en `@BotFather`.
  2. Actualiza configuracion en la app.
