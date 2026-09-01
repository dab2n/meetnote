// 화면 좌상단에 고정되는 항상-위 썸네일 패널.
// 크롬 Document PiP는 위치를 못 잡고(moveTo 무시, 크롬 재시작하면 우하단으로 복귀)
// 탭이 닫히면 같이 죽는다. 그래서 이 창만 네이티브다. UI는 서버의 /panel 을 그대로 띄운다.
//
//   swiftc -O pin.swift -o pin && ./pin &
import AppKit
import WebKit

let URLSTR = "http://127.0.0.1:8787/panel"
let WIDTH: CGFloat = 240
let MARGIN: CGFloat = 12
let RADIUS: CGFloat = 18

final class Pin: NSObject, WKScriptMessageHandler, NSApplicationDelegate {
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: WIDTH, height: 120),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
    var web: WKWebView!

    func applicationDidFinishLaunching(_ n: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "pin")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")  // 창 모서리 둥글게 깎으려면 투명해야 한다
        web.wantsLayer = true
        web.layer?.cornerRadius = RADIUS
        web.layer?.masksToBounds = true

        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.contentView = web
        place(height: 120)
        panel.orderFrontRegardless()

        web.load(URLRequest(url: URL(string: URLSTR)!))
    }

    // 좌상단 고정. 메뉴바/노치를 피하려고 visibleFrame 기준으로 잡는다.
    func place(height: CGFloat) {
        guard let s = NSScreen.main else { return }
        let v = s.visibleFrame
        panel.setFrame(NSRect(x: v.minX + MARGIN, y: v.maxY - height - MARGIN,
                              width: WIDTH, height: height),
                       display: true, animate: false)
    }

    // 페이지가 자기 내용 높이를 알려주면 창을 거기 맞춘다 (썸네일 <-> 펼친 상태)
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let h = m.body as? Double else { return }
        place(height: min(max(CGFloat(h), 56), 400))
    }
}

let app = NSApplication.shared
let pin = Pin()
app.delegate = pin
app.setActivationPolicy(.accessory)  // Dock 아이콘 없이 떠 있기만 한다
app.run()
