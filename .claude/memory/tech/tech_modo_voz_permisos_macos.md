# Permisos de micrófono en macOS para el modo voz (app sin firmar)

**Fecha:** 2026-08-05 · **Contexto:** primera prueba real del modo voz en `/Applications/POWER-AGENT.app`

Tres bloqueos distintos, en cascada, antes de que el micrófono llegara a funcionar. Ninguno era código del modo voz. Documentados para no volver a pagarlos.

## 1. Sin firma, los entitlements no se aplican

`build/entitlements.mac.plist` **ya tenía** `com.apple.security.device.audio-input`. Da igual: electron-builder solo los inyecta **al firmar**, y no hay certificado de Apple. La app quedaba `code object is not signed at all` y macOS respondía:

```
Prompting policy for hardened runtime; service: kTCCServiceMicrophone
requires entitlement com.apple.security.device.audio-input but it is missing
SecTaskCopySigningIdentifier(): [22: Invalid argument]   ← identidad: <ID of InvalidCode>
```

**Solución (ad-hoc, local):**

```bash
# 1) helper con su propio entitlements mínimo (solo audio-input)
codesign --force --sign - --entitlements helper-ent.plist \
  "/Applications/POWER-AGENT.app/Contents/Resources/voice-helper"
# 2) la app entera
codesign --force --deep --sign - --options runtime \
  --entitlements build/entitlements.mac.plist "/Applications/POWER-AGENT.app"
codesign --verify "/Applications/POWER-AGENT.app"   # debe decir: valid on disk
```

## 2. Un ejecutable suelto NO recibe permiso de micrófono

Tras firmar, el diálogo **seguía sin salir**. En los logs, quien pedía el micro aparecía como `identifier=voice-helper-5555…`: un binario pelado dentro de `Resources/`. macOS solo enseña el diálogo a procesos con **bundle `.app` propio, `CFBundleIdentifier` y sus claves `NS…UsageDescription`**.

**Solución:** empaquetar el helper como `VoiceHelper.app` dentro de `Contents/Resources/`, con `Info.plist` (`CFBundleIdentifier`, `LSBackgroundOnly`, `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`), firmarlo, y dejar `voice-helper` como symlink a su binario para no tocar `VOICE_HELPER_PATH`:

```bash
ln -sf "$R/VoiceHelper.app/Contents/MacOS/VoiceHelper" "$R/voice-helper"
```

⚠️ Lo suyo es hacerlo en `extraResources` del `package.json` y apuntar `VOICE_HELPER_PATH` dentro del bundle. Hoy está hecho **a mano sobre `/Applications`** y **cada `npm run deploy` lo borra**.

## 3. El permiso se atribuye al proceso RESPONSABLE, no al que abre el micro

Lanzar la app desde Terminal (para capturar logs) hacía que macOS atribuyera el permiso a **Terminal**, que estaba denegado en la lista de Micrófono. Síntoma: `permiso de micrófono denegado` sin diálogo ninguno, y POWER-AGENT sin aparecer en Ajustes.

**Regla:** para cualquier prueba de permisos, abrir la app **desde Finder/Launchpad** (padre = `launchd`), nunca desde Terminal.

```bash
osascript -e 'tell application "Finder" to open POSIX file "/Applications/POWER-AGENT.app"'
ps -o comm= -p $(ps -o ppid= -p $(pgrep -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT" | head -1))
# debe decir /sbin/launchd, no Terminal
```

Y el panel de Ajustes → Privacidad → Micrófono **no tiene botón para añadir apps**: solo lista las que macOS registró pidiéndolo. Si la app no aparece, es que nunca llegó a pedirlo de forma válida.

## Diagnóstico: los comandos que sirvieron

```bash
# por qué TCC deniega (lo dice literalmente)
log show --last 6m --predicate 'process == "tccd"' --info | grep -iE "Microphone|SpeechRecognition"

# qué hace el helper por dentro (audio, reconocimiento)
log show --last 5m --predicate 'process CONTAINS "voice-helper"' --info

# resetear para que vuelva a preguntar
tccutil reset Microphone com.luismi.claude-novak
tccutil reset SpeechRecognition com.luismi.claude-novak

# entitlements efectivos de un binario firmado
codesign -d --entitlements - <ruta>
```

`TCC.db` **no se puede leer** sin Acceso Total al Disco: usar `log show`, no sqlite.

## Estado al cerrar la sesión

Permiso resuelto: el micro se abre y CoreAudio inicializa bien (`InitializationResult = Success`, cancelación de eco activa). **Pero el reconocimiento devuelve `kAFAssistantErrorDomain Code=1110` ("no speech detected")**: le llegan buffers sin voz, con el volumen de entrada al 71% y el micro interno correcto. Sospecha en `VoiceHelper.swift:153-155` — el formato del nodo se lee justo después de `setVoiceProcessingEnabled(true)`, que lo cambia. Ver el bloque "EMPIEZA POR AQUÍ" de `STATE.md`.

Relacionado: [[bug-scripts-renderer-ambito-global]], `tech/tech_modo_voz.md`, `tech/tech_modo_voz_mediciones.md`.
