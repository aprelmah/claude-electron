---
name: tech-whisper-anti-hallucinations
description: "Pipeline robusto whisper.cpp para transcripción en castellano sin alucinaciones (Iglesia de Jesucristo, Amara, [MÚSICA]...) y rápido en CPU"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 73da2acb-aecc-4f4c-8602-8bf9626cf682
---

# Whisper.cpp en castellano sin alucinaciones

## Por qué whisper.cpp y no openai/whisper Python
- openai/whisper (`pip install whisper`) usa PyTorch en CPU → en Mac Mid 2015 con modelo `small` tardaba **2+ minutos** para 5s de audio.
- whisper.cpp (`brew install whisper-cpp`) es C++ nativo con modelos GGML cuantizados → ~6-8s para 5s de audio con modelo `base-q5_1`. **10x más rápido en CPU**, calidad equivalente.

## Modelos GGML (en `~/.cache/whisper-cpp/`)
| Modelo | Tamaño | 5s audio | Calidad |
|---|---|---|---|
| `ggml-tiny-q5_1.bin` | 31 MB | ~2-3 s | regular |
| `ggml-base-q5_1.bin` | 57 MB | ~6-8 s | **buena (default)** |
| `ggml-small-q5_1.bin` | 181 MB | ~20 s | muy buena |
| `ggml-medium-q5_1.bin` | 540 MB | minutos | excelente |

Descarga: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<modelo>.bin`

## Pipeline completo (Node.js / spawn)
```js
// 1. Pre-check: mean volume sobre el INPUT ORIGINAL (no normalizado)
//    Si mean_volume < -50 dB → "Sin audio reconocible (silencio)."

// 2. ffmpeg: convertir a wav 16kHz mono + loudnorm EBU R128
ffmpeg -y -loglevel error -i input.webm \
  -ac 1 -ar 16000 \
  -af 'loudnorm=I=-16:TP=-1.5:LRA=11' \
  output.wav

// 3. whisper-cli con flags anti-alucinación
whisper-cli \
  -m ~/.cache/whisper-cpp/ggml-base-q5_1.bin \
  -l es \
  -nt \              # no timestamps en el txt
  -sns \             # suppress non-speech tokens ([MÚSICA], [Aplausos]...)
  -nth 0.3 \         # no-speech threshold (default 0.6, bajamos para que no asuma silencio fácilmente)
  --prompt "Transcripción en castellano." \  # mejora coherencia
  -otxt -of base_path \
  -f output.wav

// 4. Post-filter: regex contra alucinaciones típicas
const HALLUCINATIONS = [
  /iglesia de jesucristo/i,
  /santos de los .*ltimos d.as/i,
  /amara\.org/i,
  /subt.tulos? (realizados|por la comunidad|creados)/i,
  /subtitulado por/i,
  /^\s*\[?(m.sica|aplausos|risas|silencio|ruido)\]?\s*$/i,
  /gracias por ver/i,
  /suscr.bete/i
]
```

## Por qué cada flag
- `-sns` (suppress non-speech): quita tokens `[MÚSICA]`, `[Aplausos]`, etc. que whisper genera con audio marginal.
- `-nth 0.3` (no-speech threshold): default 0.6 hace que whisper "interprete" silencios como voz. Bajar a 0.3 reduce falsos positivos pero la detección de "no hay voz" no es perfecta — por eso el pre-check de volumen y post-filter son imprescindibles.
- `--prompt "Transcripción en castellano."`: prompt inicial que ancla al modelo en castellano formal. Reduce alucinaciones tipo "subscríbete" que vienen del training data de YouTube.
- `loudnorm`: normaliza loudness a -16 LUFS (estándar broadcast). Hace que el modelo reciba audio con volumen uniforme.

## Alucinaciones típicas observadas (training data leak)
- "Subtítulos realizados por la Iglesia de Jesucristo de los Santos de los Últimos Días."
- "Subtítulos por la comunidad de Amara.org"
- "[MÚSICA] [MÚSICA]"
- "Gracias por ver el vídeo"
- "Suscríbete al canal"

Whisper se entrenó con subtítulos de YouTube → cuando el audio es marginal, devuelve frases plausibles de su corpus.

## Aplicado en
- CLAUDE-NOVAK ([[project_claude_novak]]) — botón micro de la app + bridge Telegram (`onTranscribeFile`). Commit `0dfa36a` (2026-05-15).
