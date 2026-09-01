// 화면 우상단에 고정되는 항상-위 글라스 패널. 녹음 · 파일 추가 · export 를 전부 여기서 한다.
//
// 왜 네이티브인가:
//  - 크롬 Document PiP는 위치를 못 잡고(moveTo 무시) 탭이 닫히면 같이 죽는다.
//  - chrome.tabCapture 는 툴바 아이콘 실물 클릭(activeTab)이 있어야만 열린다. 패널에서 못 부른다.
// 그래서 녹음도 ScreenCaptureKit(시스템 오디오) + AVAudioEngine(마이크)으로 직접 한다.
// UI는 서버가 주는 /panel 페이지.
//
//   ./pin.sh
import AppKit
import AVFoundation
import ScreenCaptureKit
import Speech
import WebKit

let PANEL_URL = "http://127.0.0.1:8787/panel"
let SERVER = "http://127.0.0.1:8787"
let W: CGFloat = 264
let MARGIN: CGFloat = 14
let RADIUS: CGFloat = 28

// 앱을 어디로 옮겨도 저장소를 찾을 수 있게, 빌드할 때 Info.plist에 경로를 박아둔다.
let REPO = (Bundle.main.object(forInfoDictionaryKey: "MeetnoteRepo") as? String)
    .map { URL(fileURLWithPath: $0) } ?? Bundle.main.bundleURL.deletingLastPathComponent()
let OUTDIR = REPO.appendingPathComponent("out")

func stamp() -> String {
    let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; return f.string(from: Date())
}

/// 회의 하나당 디렉터리 하나. 서버가 여기 안의 파일만 받아준다.
func newDir() throws -> URL {
    let d = OUTDIR.appendingPathComponent(stamp())
    try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
}

// MARK: - 녹음

/// 시스템 오디오(상대방 목소리)와 마이크(내 목소리)를 한 파일로 섞는다.
/// 둘 중 하나만 권한이 나도 그쪽만으로 녹음한다.
final class Recorder: NSObject, SCStreamOutput {
    private let engine = AVAudioEngine()
    private let mix = AVAudioMixerNode()
    private let player = AVAudioPlayerNode()
    private var stream: SCStream?
    private var file: AVAudioFile?
    private let q = DispatchQueue(label: "meetnote.audio")
    private var warned = false

    var onLevel: ((Float) -> Void)?
    private(set) var url: URL?
    private(set) var sysAudio = false
    private(set) var mic = false

    /// UI에 띄울 경고. 둘 다 되면 빈 문자열.
    var warning: String {
        if !mic && !sysAudio { return "⚠︎ 마이크·화면기록 권한이 둘 다 없어 무음만 녹음됩니다" }
        if !sysAudio { return "⚠︎ 화면기록 권한이 없어 내 마이크만 녹음됩니다" }
        if !mic { return "⚠︎ 마이크 권한이 없어 상대방 소리만 녹음됩니다" }
        return ""
    }

    func start() async throws -> URL {
        let dir = try newDir()
        let dst = dir.appendingPathComponent("input.m4a")

        // 시스템 오디오는 48k 스테레오 float으로 온다. 파일도 이 포맷 기준으로 잡는다.
        let sysFmt = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
        engine.attach(mix)
        engine.attach(player)
        engine.connect(player, to: mix, format: sysFmt)

        // AVAudioEngine이 알아서 물어봐주길 기다리면 조용히 무음이 녹음된다. 직접 물어본다.
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        let micFmt = engine.inputNode.outputFormat(forBus: 0)
        mic = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized && micFmt.sampleRate > 0
        if mic { engine.connect(engine.inputNode, to: mix, format: micFmt) }
        engine.connect(mix, to: engine.mainMixerNode, format: nil)
        engine.mainMixerNode.outputVolume = 0  // 스피커로 되돌리면 하울링난다

        // 파일 포맷은 첫 버퍼를 보고 정한다. 미리 채널 수를 박아두면 write(from:)이
        // 포맷 불일치로 조용히 실패해서 0바이트 파일이 나온다.
        mix.installTap(onBus: 0, bufferSize: 4096, format: nil) { [weak self] buf, _ in
            guard let self else { return }
            if self.file == nil {
                self.file = try? AVAudioFile(forWriting: dst, settings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: buf.format.sampleRate,
                    AVNumberOfChannelsKey: buf.format.channelCount,
                    AVEncoderBitRateKey: 64_000,
                ])
            }
            do { try self.file?.write(from: buf) } catch {
                if !self.warned { self.warned = true; NSLog("녹음 쓰기 실패: \(error)") }
            }
            self.onLevel?(rms(buf))
        }
        engine.prepare()
        try engine.start()
        player.play()

        // 화면 녹화 권한이 없으면 여기서 던진다. 그때는 마이크만으로 계속 간다.
        // Preflight를 먼저 불러야 시스템 설정 목록에 이 앱이 나타난다.
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false,
                                                                              onScreenWindowsOnly: true)
            guard let display = content.displays.first else { throw Err("디스플레이 없음") }
            let cfg = SCStreamConfiguration()
            cfg.capturesAudio = true
            cfg.excludesCurrentProcessAudio = true
            cfg.width = 2; cfg.height = 2          // 영상은 안 쓴다. 최소로 깎는다.
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let s = SCStream(filter: SCContentFilter(display: display, excludingWindows: []),
                             configuration: cfg, delegate: nil)
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: q)
            try await s.startCapture()
            stream = s
            sysAudio = true
        } catch {
            NSLog("시스템 오디오 실패(마이크만 녹음): \(error)")
        }
        url = dst
        return dst
    }

    func stop() -> URL? {
        if let s = stream { Task { try? await s.stopCapture() } }
        stream = nil
        mix.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        file = nil          // 닫아야 moov atom이 쓰인다
        return url
    }

    func stream(_ s: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let buf = pcm(from: sb), engine.isRunning else { return }
        player.scheduleBuffer(buf, completionHandler: nil)
    }
}

struct Err: Error, LocalizedError {
    let m: String
    init(_ m: String) { self.m = m }
    var errorDescription: String? { m }
}

func rms(_ b: AVAudioPCMBuffer) -> Float {
    guard let ch = b.floatChannelData?[0] else { return 0 }
    var sum: Float = 0
    for i in 0..<Int(b.frameLength) { sum += ch[i] * ch[i] }
    return b.frameLength == 0 ? 0 : (sum / Float(b.frameLength)).squareRoot()
}

func pcm(from sb: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let fd = CMSampleBufferGetFormatDescription(sb),
          var asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee,
          let fmt = AVAudioFormat(streamDescription: &asbd) else { return nil }
    let n = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
    guard n > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: n) else { return nil }
    buf.frameLength = n
    CMSampleBufferCopyPCMDataIntoAudioBufferList(
        sb, at: 0, frameCount: Int32(n), into: buf.mutableAudioBufferList)
    return buf
}

// MARK: - 패널

/// 헤더 부분을 잡고 끌면 창이 움직인다. WKWebView가 마우스를 다 먹어서
/// isMovableByWindowBackground 만으로는 안 잡히기 때문에 투명한 손잡이를 덮어둔다.
final class DragView: NSView {
    var onReset: () -> Void = {}
    var onMoved: () -> Void = {}
    // 패널이 키 윈도우가 아닐 때 첫 클릭이 활성화에 먹히면 드래그가 시작되지 않는다.
    override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
    override func mouseDown(with e: NSEvent) {
        if e.clickCount == 2 { return onReset() }
        window?.performDrag(with: e)   // 드래그가 끝나야 돌아온다
        onMoved()
    }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
}

/// 테두리 없는 패널은 기본적으로 키 윈도우가 못 된다. FigJam 보드 URL을 타이핑하려면 필요하다.
final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class Pin: NSObject, WKScriptMessageHandler, NSApplicationDelegate {
    let panel = KeyPanel(contentRect: NSRect(x: 0, y: 0, width: W, height: 130),
                         styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
    var web: WKWebView!
    let rec = Recorder()
    var staged: URL?          // 녹음이 끝났거나 사용자가 고른 파일
    var timer: Timer?
    var startedAt = Date()
    /// 사용자가 옮긴 위치(창의 좌상단). nil이면 기본 자리(화면 우상단).
    var anchor: CGPoint? {
        didSet {
            anchor.map { UserDefaults.standard.set([$0.x, $0.y], forKey: "anchor") }
                ?? UserDefaults.standard.removeObject(forKey: "anchor")
        }
    }

    /// 앱만 눌러도 다 돌아가야 한다. 서버가 없으면 여기서 띄운다.
    /// 로그인 셸로 띄우는 이유: 터미널과 같은 PATH(파이썬 3.12)와 ANTHROPIC_API_KEY를 물려받는다.
    func ensureServer() {
        var r = URLRequest(url: URL(string: "\(SERVER)/health")!)
        r.timeoutInterval = 1
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            guard (resp as? HTTPURLResponse)?.statusCode != 200 else { return }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/zsh")
            p.arguments = ["-lc",
                "cd '\(REPO.path)' && exec python3 -u server.py >> /tmp/meetnote-server.log 2>&1"]
            try? p.run()
        }.resume()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        ensureServer()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "pin")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.cornerRadius = RADIUS
        web.layer?.cornerCurve = .continuous       // 애플식 둥근 모서리
        web.layer?.masksToBounds = true

        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        // WKWebView 안에 넣으면 웹뷰가 마우스를 먼저 먹는다. 형제로 올려야 손잡이가 잡힌다.
        let box = NSView(frame: NSRect(x: 0, y: 0, width: W, height: 130))
        box.wantsLayer = true
        box.layer?.cornerRadius = RADIUS
        box.layer?.cornerCurve = .continuous
        box.layer?.masksToBounds = true
        web.frame = box.bounds
        web.autoresizingMask = [.width, .height]
        box.addSubview(web)

        // 오른쪽 끝 34pt는 닫기 버튼 몫으로 비워둔다. 안 그러면 손잡이가 클릭을 다 먹는다.
        let drag = DragView(frame: NSRect(x: 0, y: box.bounds.height - 30, width: W - 34, height: 30))
        drag.autoresizingMask = [.minYMargin]
        drag.onReset = { [weak self] in
            guard let self else { return }
            anchor = nil
            place(panel.frame.height, animate: true)
        }
        // 위치는 "사용자가 끌었을 때"만 기억한다. didMove를 듣게 하면 place()의
        // 애니메이션이나 화면 클램프까지 사용자 이동으로 저장돼 창이 코너로 기어간다.
        drag.onMoved = { [weak self] in
            guard let f = self?.panel.frame else { return }
            self?.anchor = CGPoint(x: f.minX, y: f.maxY)
        }
        box.addSubview(drag)
        panel.contentView = box

        if let a = UserDefaults.standard.array(forKey: "anchor") as? [Double], a.count == 2 {
            anchor = CGPoint(x: a[0], y: a[1])
        }
        place(130, animate: false)
        panel.orderFrontRegardless()

        loadPanel()

        // 모니터가 바뀌거나 해상도가 변해도 자리를 다시 잡는다
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in self.map { $0.place($0.panel.frame.height, animate: false) } }

        // 손잡이가 진짜 맨 위에 있는지 확인 (마우스 없이 검증할 방법이 이것뿐이다)
        if CommandLine.arguments.contains("--hittest") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                let h = self.panel.frame.height
                let hit = self.panel.contentView?.hitTest(NSPoint(x: 130, y: h - 12))
                let body = self.panel.contentView?.hitTest(NSPoint(x: 130, y: h - 80))
                let x = self.panel.contentView?.hitTest(NSPoint(x: W - 16, y: h - 14))
                let line = "header=\(hit?.className ?? "nil") body=\(body?.className ?? "nil") 닫기=\(x?.className ?? "nil") firstMouse=\(hit?.acceptsFirstMouse(for: nil) ?? false)\n"
                try? line.write(toFile: "/tmp/meetnote-hittest.log", atomically: true, encoding: .utf8)
                exit(0)
            }
        }

        rec.onLevel = { [weak self] l in
            DispatchQueue.main.async { self?.push("level", "\(min(100, Int(l * 900)))") }
        }
    }

    /// 서버가 막 켜졌으면 아직 안 받는다. 붙을 때까지 다시 시도한다.
    func loadPanel(_ tries: Int = 0) {
        web.load(URLRequest(url: URL(string: PANEL_URL)!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self, tries < 12 else { return }
            if web.url == nil || web.title?.isEmpty != false { loadPanel(tries + 1) }
        }
    }

    /// 기본은 화면 우상단. 한 번 옮기면 그 좌상단을 기준으로 붙어 있는다.
    /// 메뉴바/노치를 피해 visibleFrame 기준.
    func place(_ h: CGFloat, animate: Bool) {
        guard let s = NSScreen.main else { return }
        let v = s.visibleFrame
        let top = anchor ?? CGPoint(x: v.maxX - W - MARGIN, y: v.maxY - MARGIN)
        var f = NSRect(x: top.x, y: top.y - h, width: W, height: h)
        // 모니터가 바뀌거나 창이 길어져서 화면 밖으로 나가면 끌어들인다
        f.origin.x = min(max(f.minX, v.minX), max(v.minX, v.maxX - W))
        f.origin.y = min(max(f.minY, v.minY), max(v.minY, v.maxY - h))
        if animate {
            NSAnimationContext.runAnimationGroup {
                $0.duration = 0.26
                $0.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
                panel.animator().setFrame(f, display: true)
            }
        } else {
            panel.setFrame(f, display: true)
        }
    }

    func push(_ fn: String, _ arg: String) {
        web.evaluateJavaScript("window.native_\(fn)?.(\(arg))", completionHandler: nil)
    }

    func state(_ s: String, _ obj: String = "{}") { push("state", "'\(s)', \(obj)") }

    // MARK: JS -> 네이티브
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let b = m.body as? [String: Any], let t = b["t"] as? String else { return }
        switch t {
        case "fit":
            if let h = b["h"] as? Double { place(min(max(CGFloat(h), 56), 420), animate: true) }
        case "rec":   startRec()
        case "stop":  stopRec()
        case "pick":  pick()
        case "export":
            if let target = b["target"] as? String { send(target, b["board"] as? String ?? "") }
        case "close":
            if timer != nil { stopRec() }   // 녹음 중이었으면 파일은 살려두고 끈다
            NSApp.terminate(nil)
        case "focus":
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
        case "reset": staged = nil; state("idle")
        case "settings":
            // ponytail: 애드혹 서명이라 pin.swift를 고쳐 다시 빌드하면 화면기록 권한이 초기화된다.
            // 자주 거슬리면 개발자 인증서로 서명하면 된다.
            NSWorkspace.shared.open(URL(string:
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        default: break
        }
    }

    func startRec() {
        Task { @MainActor in
            do {
                _ = try await rec.start()
                startedAt = Date()
                timer?.invalidate()
                timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                    guard let self else { return }
                    self.push("time", "\(Int(Date().timeIntervalSince(self.startedAt)))")
                }
                state("recording", "{warn:'\(esc(rec.warning))'}")
            } catch {
                state("error", "{msg:'녹음 시작 실패: \(esc(error.localizedDescription))'}")
            }
        }
    }

    func stopRec() {
        timer?.invalidate(); timer = nil
        staged = rec.stop()
        ready(staged?.lastPathComponent ?? "녹음")
    }

    /// WKWebView의 <input type=file>은 .nonactivatingPanel에서 안 열린다. 네이티브로 연다.
    func pick() {
        NSApp.activate(ignoringOtherApps: true)
        let p = NSOpenPanel()
        p.allowedContentTypes = ["txt", "md", "mp3", "m4a", "wav", "webm", "mp4", "aac"]
            .compactMap { UTType(filenameExtension: $0) }
        p.allowsMultipleSelection = false
        p.begin { [weak self] r in
            guard let self, r == .OK, let src = p.url else { return }
            do {
                let dst = try newDir().appendingPathComponent("input." + src.pathExtension.lowercased())
                try FileManager.default.copyItem(at: src, to: dst)
                self.staged = dst
                self.ready(src.lastPathComponent)
            } catch {
                self.state("error", "{msg:'파일 복사 실패: \(esc(error.localizedDescription))'}")
            }
        }
    }

    func ready(_ name: String) {
        let dir = staged?.deletingLastPathComponent().path ?? ""
        state("ready", "{name:'\(esc(name))', dir:'\(esc(dir))'}")
    }

    /// 파일은 이미 out/ 안에 있다. 경로만 알려주면 서버가 집어간다.
    func send(_ target: String, _ board: String) {
        guard let path = staged?.path else { return state("error", "{msg:'보낼 파일이 없습니다'}") }
        state("working", "{}")
        var r = URLRequest(url: URL(string: "\(SERVER)/local")!)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(
            withJSONObject: ["path": path, "target": target, "board": board])
        URLSession.shared.dataTask(with: r) { [weak self] data, resp, err in
            DispatchQueue.main.async {
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let key = (try? JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any])
                    .flatMap { $0?["key"] as? String }
                guard err == nil, (200..<300).contains(code), let key else {
                    return self?.state("error",
                        "{msg:'서버에 못 보냈습니다 (\(code))\\n로컬 서버가 떠 있나요?'}") ?? ()
                }
                self?.state("working", "{key:'\(key)'}")
            }
        }.resume()
    }
}

func esc(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: " ")
}

import UniformTypeIdentifiers

// MARK: - 전사 (온디바이스, API 키 불필요)

/// macOS 26 SpeechAnalyzer. 오디오를 통째로 넘기면 한국어 전사문이 나온다.
/// 진행률은 `P 0.42` 로 stdout에 흘려서 서버가 읽어간다.
func transcribeFile(_ src: URL, to dst: URL) async throws {
    let t = SpeechTranscriber(locale: Locale(identifier: "ko-KR"), preset: .transcription)
    if let req = try await AssetInventory.assetInstallationRequest(supporting: [t]) {
        FileHandle.standardError.write("한국어 음성 모델 내려받는 중…\n".data(using: .utf8)!)
        try await req.downloadAndInstall()
    }
    let file = try AVAudioFile(forReading: src)
    let dur = max(1, Double(file.length) / file.fileFormat.sampleRate)

    let analyzer = SpeechAnalyzer(modules: [t])
    let collect = Task { () -> String in
        var out = ""
        for try await r in t.results where r.isFinal {
            out += String(r.text.characters)
            print("P \(min(0.99, CMTimeGetSeconds(r.range.end) / dur))")
            fflush(stdout)
        }
        return out
    }
    _ = try await analyzer.analyzeSequence(from: file)
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    let text = try await collect.value
    try text.trimmingCharacters(in: .whitespacesAndNewlines)
        .write(to: dst, atomically: true, encoding: .utf8)
    print("P 1.0")
}

if let i = CommandLine.arguments.firstIndex(of: "--transcribe"), CommandLine.arguments.count > i + 2 {
    let src = URL(fileURLWithPath: CommandLine.arguments[i + 1])
    let dst = URL(fileURLWithPath: CommandLine.arguments[i + 2])
    Task {
        do { try await transcribeFile(src, to: dst) } catch {
            FileHandle.standardError.write("전사 실패: \(error)\n".data(using: .utf8)!)
            exit(1)
        }
        exit(0)
    }
    RunLoop.main.run()
}

// 오디오 그래프가 실제로 파일을 만드는지 확인용. `pin --selftest` (권한 프롬프트가 뜬다)
if CommandLine.arguments.contains("--selftest") {
    let r = Recorder()
    Task {
        do {
            let u = try await r.start()
            try await Task.sleep(nanoseconds: 3_000_000_000)
            _ = r.stop()
            try await Task.sleep(nanoseconds: 500_000_000)
            let n = (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? Int) ?? 0
            let line = "selftest: \(n)바이트 마이크=\(r.mic) 시스템오디오=\(r.sysAudio) screenTCC=\(CGPreflightScreenCaptureAccess())\n"
            print(line)
            try? line.write(toFile: "/tmp/meetnote-selftest.log", atomically: true, encoding: .utf8)
        } catch { print("selftest 실패: \(error)") }
        exit(0)
    }
    RunLoop.main.run()
}

let app = NSApplication.shared
let pin = Pin()
app.delegate = pin
app.setActivationPolicy(.accessory)
app.run()
