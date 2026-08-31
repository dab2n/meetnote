// 팝업은 닫히면 죽는다. 녹음은 offscreen 문서가 들고 있고, 여기는 중계만 한다.
const OFFSCREEN = "offscreen.html";

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: ["USER_MEDIA"],
      justification: "회의 탭 오디오를 녹음한다",
    });
  }
}

async function setState(state, extra = {}) {
  await chrome.storage.session.set({ state, ...extra });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.to !== "bg") return;
  (async () => {
    try {
      if (msg.cmd === "start") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.url?.startsWith("chrome://")) throw new Error("이 탭은 녹음할 수 없습니다 (chrome:// 페이지)");
        await ensureOffscreen();
        // 사용자 제스처(팝업 클릭) 직후에만 발급된다.
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await chrome.runtime.sendMessage({ to: "off", cmd: "start", streamId });
        await setState("recording", { startedAt: Date.now(), title: tab.title || "회의" });
      } else if (msg.cmd === "stop") {
        await chrome.runtime.sendMessage({ to: "off", cmd: "stop" });
        await setState("ready");
      } else if (msg.cmd === "export") {
        await setState("sending");
        const r = await chrome.runtime.sendMessage({ to: "off", cmd: "export", target: msg.target });
        if (!r?.ok) throw new Error(r?.error || "전송 실패");
        await setState("sent");
      } else if (msg.cmd === "reset") {
        await chrome.runtime.sendMessage({ to: "off", cmd: "reset" }).catch(() => {});
        await setState("idle");
      }
      reply({ ok: true });
    } catch (e) {
      await setState("error", { error: String(e.message || e) });
      reply({ ok: false, error: String(e.message || e) });
    }
  })();
  return true; // async reply
});
