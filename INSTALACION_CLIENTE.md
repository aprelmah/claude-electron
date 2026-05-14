# CLAUDE-NOVAK - Checklist de Instalacion (macOS)

## 1. Paquete correcto para el cliente
- Intel (i5/i7 antiguos): `CLAUDE-NOVAK-1.0.0.dmg`
- Apple Silicon (M1/M2/M3): `CLAUDE-NOVAK-1.0.0-arm64.dmg`

Comprobar CPU del cliente:
- Menu Apple -> `Acerca de este Mac`

## 2. Instalacion estandar
1. Abrir el archivo `.dmg`.
2. Arrastrar `CLAUDE-NOVAK.app` a `Aplicaciones`.
3. Cerrar y expulsar el `.dmg`.

## 3. Primera ejecucion (obligatorio una vez)
1. Ir a `Aplicaciones`.
2. Click derecho en `CLAUDE-NOVAK.app` -> `Abrir`.
3. Confirmar `Abrir` en el aviso de seguridad.

## 4. Permisos
- Si el cliente usa dictado: permitir `Microfono`.
- Ruta: `Ajustes del sistema` -> `Privacidad y seguridad` -> `Microfono`.

## 5. Verificacion minima post-instalacion
1. La app abre sin cerrarse sola.
2. Se ve la terminal interna.
3. Puede escribir un comando basico.
4. Cambiar entre `Claude` y `Codex` no rompe la sesion.
5. Cerrar y abrir de nuevo funciona.

## 6. Soporte rapido si no abre
1. Cerrar la app.
2. Borrar estado guardado conflictivo:
   - `~/Library/Saved Application State/com.luismi.claude-novak.savedState`
   - `~/Library/Saved Application State/com.github.Electron.savedState`
3. Abrir de nuevo con click derecho -> `Abrir`.

## 7. Diagnostico tecnico (equipo interno)
En maquina de soporte:

```bash
cd ~/Desktop/claude-electron
npm run doctor
npm run reset:state
```

## 8. Operacion diaria del cliente
- Abrir desde `Aplicaciones` o fijar en `Dock`.
- No usar `npm run start` en cliente final (solo desarrollo).

