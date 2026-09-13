// 툴바 아이콘 클릭 = meetnote 열기. 이미 열린 탭이 있으면 그 탭으로 간다.
// 로컬 서버가 떠 있으면 로컬(구독으로 새 맵 생성)을, 아니면 배포본(보기 전용)을 연다.
// 아이콘 우클릭 = 지금 보는 탭 위에 회의 녹음 패널을 띄운다.

const LOCAL = "http://127.0.0.1:8787/notes/";
const PUBLIC = "https://dab2n.github.io/meetnote/";

async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2200);
}

async function localUp() {
  try { return (await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(800) })).ok; }
  catch { return false; }
}

chrome.action.onClicked.addListener(async () => {
  const url = (await localUp()) ? LOCAL : PUBLIC;
  const [tab] = await chrome.tabs.query({ url: url + "*" });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  if (url === PUBLIC) flash("웹", "#6b6f7a");   // 로컬 서버가 꺼져 배포본을 열었다는 표시
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "panel", title: "이 탭에 회의 녹음 패널 띄우기", contexts: ["action"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "panel") return;
  if (!tab?.id || /^(chrome|edge|about|devtools):|chrome\.google\.com\/webstore/.test(tab.url || "")) {
    return flash("!", "#c53f2d");   // 크롬 내부 페이지에는 끼어들 수 없다
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["panel.js"] });
  } catch {
    flash("!", "#c53f2d");
  }
});
