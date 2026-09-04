// 툴바 아이콘 = 지금 보고 있는 탭 위에 meetnote 패널을 띄우고 닫는 스위치.
// 패널 자체가 녹음·인식·도식화를 다 한다. 로컬 서버는 없어도 되고,
// 켜져 있으면 회의가 끝난 뒤 전사문을 넘겨 정식 회의록까지 만든다.

async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2200);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || /^(chrome|edge|about|devtools):|chrome\.google\.com\/webstore/.test(tab.url || "")) {
    return flash("!", "#c53f2d");   // 크롬 내부 페이지에는 끼어들 수 없다
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["panel.js"] });
  } catch {
    flash("!", "#c53f2d");
  }
});
