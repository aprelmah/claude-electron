# Fichas de ejemplo sembradas en la KB de WhatsApp (2026-08-02)

A petición de Luismi, para probar el pipeline KB (`[[kb_whatsapp_2026_08_02]]`) con
material real en vez de inventado. Fuente: `~/Desktop/turbo e/.claude/memory/{tech,manuales}/`
(proyecto separado de documentación de productos Turbo Energy — baterías/inversores solares,
marca de Luismi). Guardadas con `saveKbCard` en `~/.claude/whatsapp-bridge/kb/`:

- `bateria-no-comunica-inversor.md` — LED rojo / F58 / códigos 31-32 batería. 4 soluciones:
  cable y puerto → protocolo (P1-TRB/P06-VCT/P04-VOL) → tipo de batería en el inversor → DIP en paralelo.
- `sin-respaldo-corte-luz.md` — GRID vs LOAD/Backup. 4 soluciones: puerto de conexión →
  nivel de carga → seguridad modo isla (diferenciales) → escalar con datos.
- `inversor-f59-cada-noche.md` — caso real de foro (ForoElectricidad). 4 soluciones:
  confirmar sin FV → posición pinza CT → dead-band → escalar.

## Validación E2E con CLI real (script en scratchpad de sesión, no queda en el repo)
- Frases coloquiales → ficha correcta en los 3 casos (selector haiku ~6-7s).
- Multi-turno: "ya miré el cable, sigue sin verla" → pasó a Solución 2 (protocolo) SIN
  repetir la Solución 1 (cable), gracias al historial + reglas de `KB_ANSWER_RULES`.
- Pregunta de precio (sin ficha) → escalada correcta. Saludo → smalltalk, sin resolver nada.

## Nota
Estas son fichas de **prueba**, con contenido técnico real pero sin validar por Luismi
como texto definitivo de cara a cliente. Antes de dejarlas en producción con auto-reply
activo de verdad, revisarlas/editarlas desde Configuración → Fichas.
