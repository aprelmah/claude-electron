// VoiceHelper — puente entre POWER-AGENT (Node) y el motor de voz de macOS.
//
// Node no puede hablar con Speech.framework ni con VoiceProcessingIO, y esas
// dos piezas son justo las que hacen viable el modo voz en este Mac:
//   · Speech en modo servidor  → 617 ms al primer texto, 1022 ms al cerrar
//     (el on-device da RTF 2,5-7,5 en este i7 de 2014: inservible)
//   · VoiceProcessingIO        → cancela el altavoz, así que el micro abierto
//     no se oye a sí mismo y el manos libres funciona sin auriculares
// Ambas cifras están medidas, no estimadas (docs/superpowers/specs, §3).
//
// Protocolo: una línea JSON por mensaje, stdin → comandos, stdout → eventos.

import Foundation
import Speech
import AVFoundation

// ── Salida: una línea JSON por evento ────────────────────────────────────
// Asíncrona a propósito: emit() se llama también desde el hilo de CoreAudio
// (barge-in), y bloquearlo con E/S provoca cortes en el audio.
let outQueue = DispatchQueue(label: "voicehelper.out")

func emit(_ obj: [String: Any]) {
    outQueue.async {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let line = String(data: data, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }
}

// Vacía la cola antes de morir. Sin esto, salir se come los eventos que aún
// no habían llegado a stdout: el último `final` o un `error` fatal se pierden
// y Node se queda esperando una respuesta que ya nadie va a mandar.
func exitDraining(_ code: Int32) -> Never {
    outQueue.sync { }
    exit(code)
}

func fail(_ message: String, fatal: Bool = false) {
    emit(["type": "error", "message": message, "fatal": fatal])
}

// ── Motor ────────────────────────────────────────────────────────────────
final class VoiceEngine: NSObject, AVSpeechSynthesizerDelegate {
    private let locale: String
    private let engine = AVAudioEngine()
    private let synth = AVSpeechSynthesizer()
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?

    private var listening = false
    private var authorized = false
    private var vocabulary: [String] = []
    private var voiceId: String?
    private var speakingId: String?
    // Escala de AVSpeechUtterance.rate (0..1, 0,5 = normal del sistema).
    // 0,52 medido como el punto cómodo por defecto en es-ES.
    private var speechRate: Float = 0.52

    // Endpointing propio. 1,1 s sale de la medición: el texto se estabiliza a
    // ~1,0 s de callar. El de Apple es más lento y no es configurable.
    private let silenceToEndTurn: TimeInterval = 1.1
    private let voiceThreshold: Float = 0.012

    private var speechStartedAt: Date?
    private var lastVoiceAt: Date?
    private var lastText = ""
    private var endTimer: Timer?

    init(locale: String = "es-ES") {
        self.locale = locale
        super.init()
        synth.delegate = self
    }

    // ── Permisos ─────────────────────────────────────────────────────────
    // Ojo: requestAuthorization NO responde si el proceso no corre dentro de
    // una app con bundle lanzada por LaunchServices. Como helper hijo de
    // POWER-AGENT.app hereda su identidad TCC y sí responde.
    func authorize(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                fail("permiso de reconocimiento denegado (estado \(status.rawValue))", fatal: true)
                done(false); return
            }
            AVCaptureDevice.requestAccess(for: .audio) { micOk in
                guard micOk else {
                    fail("permiso de micrófono denegado", fatal: true)
                    done(false); return
                }
                DispatchQueue.main.async {
                    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: self.locale)) else {
                        fail("sin reconocedor para \(self.locale)", fatal: true)
                        done(false); return
                    }
                    self.recognizer = rec
                    self.authorized = true
                    emit(["type": "ready",
                          "locale": self.locale,
                          "onDeviceAvailable": rec.supportsOnDeviceRecognition])
                    done(true)
                }
            }
        }
    }

    // ── Escucha ──────────────────────────────────────────────────────────
    func start() {
        // Permisos en perezoso: el helper arranca sin pedir nada y solo los
        // solicita al ir a escuchar de verdad. Así Node puede consultarle las
        // voces sin que macOS suelte un diálogo, y el binario es ejecutable
        // (y testeable) fuera de la app.
        guard authorized else {
            authorize { ok in if ok { DispatchQueue.main.async { self.start() } } }
            return
        }
        guard !listening, let rec = recognizer else { return }
        guard rec.isAvailable else { fail("reconocedor no disponible (¿sin red?)"); return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        // Servidor, no on-device: decisión medida, ver cabecera.
        req.requiresOnDeviceRecognition = false
        req.shouldReportPartialResults = true
        if !vocabulary.isEmpty { req.contextualStrings = vocabulary }
        request = req

        resetTurn()

        task = rec.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let e = error as NSError? {
                // 216/301 = cancelaciones normales al cerrar el turno.
                if e.code != 216 && e.code != 301 { fail("reconocimiento: \(e.localizedDescription)") }
                return
            }
            guard let text = result?.bestTranscription.formattedString, !text.isEmpty else { return }
            guard text != self.lastText else { return }
            self.lastText = text
            emit(["type": "partial", "text": text])
        }

        do { try openMic() } catch {
            fail("no se pudo abrir el micrófono: \(error.localizedDescription)")
            teardown(); return
        }

        listening = true
        emit(["type": "listening"])
    }

    private func openMic() throws {
        let input = engine.inputNode
        // SIN cancelación de eco (setVoiceProcessingEnabled), decidido el
        // 2026-08-05 con las pruebas reales delante. VoiceProcessingIO existía
        // para el barge-in (hablarle encima con el TTS sonando), pero el micro
        // ya se cierra mientras habla (main/voice-session.js), así que no
        // protegía nada — y cobraba caro: pasa el nodo a 4 canales (el
        // reconocedor no los digiere → error 1110 "no speech detected") y mete
        // el proceso en modo comunicación, con macOS bajando TODO el audio del
        // sistema (ducking) mientras el micro esté abierto. Verificado en vivo:
        // sin VP transcribe igual y la música no baja. Precio asumido: con
        // música alta de fondo el reconocimiento pierde — se baja la música.

        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            // El reconocedor solo digiere mono/estéreo. Ver monoCopy.
            self.request?.append(VoiceEngine.monoCopy(buffer) ?? buffer)
            self.onAudio(level: VoiceEngine.rms(buffer))
        }
        engine.prepare()
        try engine.start()
    }

    // Guarda defensiva: SFSpeechAudioBufferRecognitionRequest solo digiere
    // mono/estéreo. Con más canales acepta los buffers sin rechistar y devuelve
    // `kAFAssistantErrorDomain 1110` ("no speech detected") con el audio lleno
    // de voz — lo hacía VoiceProcessingIO (4 canales, bug real 2026-08-05,
    // 912 buffers con rms 0,07 y ni una palabra) y lo puede hacer cualquier
    // interfaz de audio externa multicanal. El canal 0 es el del micro; basta
    // copiarlo a mono (mismo sample rate, mismo float32 no entrelazado).
    private static func monoCopy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard buffer.format.channelCount > 2 else { return buffer }
        guard let src = buffer.floatChannelData?[0] else { return nil }
        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                      sampleRate: buffer.format.sampleRate,
                                      channels: 1,
                                      interleaved: false),
              let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: buffer.frameLength),
              let dst = out.floatChannelData?[0] else { return nil }
        out.frameLength = buffer.frameLength
        dst.assign(from: src, count: Int(buffer.frameLength))
        return out
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        return (sum / Float(n)).squareRoot()
    }

    private func onAudio(level: Float) {
        guard level > voiceThreshold else { return }

        // Barge-in: hablas encima → se calla en el acto. Esto es lo que hace
        // que parezca conversación, más que la latencia bruta.
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
            emit(["type": "user-interrupt"])
        }

        let now = Date()
        if speechStartedAt == nil {
            speechStartedAt = now
            emit(["type": "speech-detected"])
        }
        lastVoiceAt = now
    }

    private func resetTurn() {
        speechStartedAt = nil; lastVoiceAt = nil; lastText = ""
        endTimer?.invalidate()
        endTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self, let last = self.lastVoiceAt, self.speechStartedAt != nil else { return }
            guard Date().timeIntervalSince(last) > self.silenceToEndTurn else { return }
            self.closeTurn()
        }
    }

    private func closeTurn() {
        endTimer?.invalidate(); endTimer = nil
        let text = lastText.trimmingCharacters(in: .whitespacesAndNewlines)
        stopAudio()
        listening = false
        if text.isEmpty { emit(["type": "empty"]) }
        else { emit(["type": "final", "text": text]) }
        // Node decide si reabrir el micro: mientras Claude piensa, no escuchamos.
    }

    func stop() {
        guard listening else { return }
        stopAudio(); listening = false
        emit(["type": "stopped"])
    }

    private func stopAudio() {
        endTimer?.invalidate(); endTimer = nil
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        // Cinturón: si algún día vuelve VoiceProcessing, soltarlo aquí es lo
        // que evita que el proceso se quede en "modo comunicación" con macOS
        // bajando todo el audio del sistema (pasó el 2026-08-05). Hoy es un
        // no-op porque openMic ya no lo activa.
        try? engine.inputNode.setVoiceProcessingEnabled(false)
        request?.endAudio()
        task?.cancel()
        request = nil; task = nil
    }

    private func teardown() { stopAudio(); listening = false }

    // ── Habla ────────────────────────────────────────────────────────────
    func speak(id: String, text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            emit(["type": "speech-end", "id": id, "skipped": true]); return
        }
        let u = AVSpeechUtterance(string: text)
        if let vid = voiceId, let v = AVSpeechSynthesisVoice(identifier: vid) { u.voice = v }
        else { u.voice = AVSpeechSynthesisVoice(language: locale) }
        u.rate = speechRate
        speakingId = id
        emit(["type": "speech-start", "id": id])
        synth.speak(u)
    }

    func shutUp() {
        guard synth.isSpeaking else { return }
        synth.stopSpeaking(at: .immediate)
    }

    func setVocabulary(_ words: [String]) {
        // contextualStrings admite ~100 términos; más allá degrada.
        vocabulary = Array(words.prefix(100))
    }

    func setVoice(_ identifier: String?) { voiceId = identifier }

    // Mismo tope que sanitizeVoiceRate en Node (main/config-store.js): aunque
    // Node ya acota, el helper no se fía de su entrada — cualquier proceso
    // puede hablarle por stdin.
    func setRate(_ value: Double?) {
        guard let v = value, v.isFinite else { return }
        speechRate = Float(min(0.7, max(0.3, v)))
    }

    func listVoices() {
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(String(locale.prefix(2))) }
            .map { v -> [String: Any] in
                let q: String
                switch v.quality {
                case .premium: q = "premium"
                case .enhanced: q = "enhanced"
                default: q = "default"
                }
                return ["id": v.identifier, "name": v.name, "language": v.language, "quality": q]
            }
        emit(["type": "voices", "voices": voices])
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        emit(["type": "speech-end", "id": speakingId ?? "", "finished": true])
        speakingId = nil
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        emit(["type": "speech-end", "id": speakingId ?? "", "finished": false])
        speakingId = nil
    }
}

// ── Bucle de comandos ────────────────────────────────────────────────────
let engine = VoiceEngine(locale: ProcessInfo.processInfo.environment["VOICE_LOCALE"] ?? "es-ES")

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let cmd = msg["cmd"] as? String else { return }

    DispatchQueue.main.async {
        switch cmd {
        case "authorize": engine.authorize { _ in }
        case "start":  engine.start()
        case "stop":   engine.stop()
        case "speak":  engine.speak(id: msg["id"] as? String ?? "", text: msg["text"] as? String ?? "")
        case "shutup": engine.shutUp()
        case "vocab":  engine.setVocabulary(msg["words"] as? [String] ?? [])
        case "voice":  engine.setVoice(msg["id"] as? String)
        case "rate":   engine.setRate(msg["value"] as? Double)
        case "voices": engine.listVoices()
        case "quit":   exitDraining(0)
        default:       fail("comando desconocido: \(cmd)")
        }
    }
}

// stdin en hilo aparte: el principal lo necesita CoreAudio y los timers.
let stdinThread = Thread {
    while let line = readLine(strippingNewline: true) { handle(line) }
    // Node cerró el pipe. La salida se encola en la cola principal, NO se
    // ejecuta aquí: los comandos ya leídos están esperando su turno en esa
    // misma cola y salir a pelo se los llevaría por delante sin ejecutarlos.
    DispatchQueue.main.async { exitDraining(0) }
}
stdinThread.start()

emit(["type": "hello", "pid": ProcessInfo.processInfo.processIdentifier])

RunLoop.main.run()
