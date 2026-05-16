---
name: tech-xterm-dictation-macos
description: Cómo hacer que el dictado nativo de macOS (Fn-Fn / Control-Control) funcione dentro de un terminal xterm.js embebido en Electron
metadata: 
  node_type: memory
  type: reference
  originSessionId: 73da2acb-aecc-4f4c-8602-8bf9626cf682
---

# xterm.js + dictado nativo macOS

## Problema
El dictado de macOS (`Fn-Fn` o `Control-Control`) NO se activa cuando el cursor está dentro de un terminal xterm.js en Electron. El icono del micrófono no aparece. Solo funciona en `<input>` / `<textarea>` "estándar" del SO.

## Causa raíz
xterm.js usa internamente un `<textarea>` oculto (`.xterm-helper-textarea`) para capturar teclas e IME. Por defecto está posicionado **fuera de la pantalla** (hack histórico para arreglar cursor parpadeante de IE) con `left: -9999px` o similar. Como no es "visible" para el sistema de servicios de texto de macOS, Dictation no lo detecta como input válido y no se activa.

VS Code lo evita usando su propio binding nativo a Microsoft Cognitive Services Speech SDK (`@vscode/node-speech`, ONNX cuantizado), no es xterm.js puro.

## Solución
Override CSS que trae el helper-textarea a una posición visible pero diminuta (2x2 px, opacity ~0):

```css
.xterm-helper-textarea {
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  width: 2px !important;
  height: 2px !important;
  opacity: 0.01 !important;
  z-index: 9999 !important;
  pointer-events: none !important;
}
```

`pointer-events: none` evita que robe clicks dirigidos al canvas del terminal. xterm.js le da foco programáticamente al clickear → macOS detecta `<textarea>` con foco → atajo de dictado funciona → al dictar, el SO inyecta texto que dispara `compositionend` → `CompositionHelper` de xterm.js lo envía al PTY.

## Referencias
- [xterm.js CompositionHelper.ts](https://github.com/xtermjs/xterm.js/blob/master/src/browser/input/CompositionHelper.ts) — maneja compositionstart/update/end, declara explícitamente soporte para `speech input or IME`.
- [Issue #3065](https://github.com/xtermjs/xterm.js/issues/3065) — helper-textarea fuera de pantalla.
- [Issue #1939](https://github.com/xtermjs/xterm.js/issues/1939) — IME composition broken en macOS.

## Probado en
- macOS 12.7.6 Monterey, Electron 20.x, xterm 5.5.0.
- Aplicado en CLAUDE-NOVAK ([[project_claude_novak]]) commit `0dfa36a` (2026-05-15).

## Limitaciones
- No funciona si el usuario no tiene `AppleDictationAutoEnable = 1` ni perfil ES descargado en macOS.
- En Monterey el dictado básico va a servidores Apple (es muy rápido aún así). En Ventura+ es on-device con pack ES.
