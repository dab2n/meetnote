// 툴바 아이콘 = meetnote 패널 스위치.
// 확장이 네이티브 앱을 직접 못 켜니까, 이미 떠 있는 로컬 서버에게 부탁한다.
// (네이티브 메시징 호스트를 깔면 서버 없이도 되지만, 매니페스트를 크롬 프로필에
//  설치해야 해서 이 쪽이 훨씬 싸다.)
const SERVER = "http://127.0.0.1:8787";

async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

chrome.action.onClicked.addListener(async () => {
  try {
    const r = await fetch(`${SERVER}/show`, { method: "POST" });
    if (!r.ok) throw new Error(r.status);
    await flash("●", "#4a86ff");
  } catch {
    // 서버가 꺼져 있으면 확장이 할 수 있는 게 없다. 켜는 법을 알려준다.
    await flash("!", "#ff5c8f");
    chrome.tabs.create({ url: "data:text/html;charset=utf-8," + encodeURIComponent(`
      <meta charset=utf-8><title>meetnote</title>
      <body style="font:14px/1.7 -apple-system,system-ui;padding:40px;max-width:520px">
      <h2>meetnote 서버가 꺼져 있습니다</h2>
      <p>터미널에서 한 번만 켜두면 됩니다.</p>
      <pre style="background:#f3f4f6;padding:14px;border-radius:10px">cd ~/projects/meetnote && ./pin.sh</pre>
      <p>그 다음부터는 툴바 아이콘으로 패널을 띄우고 닫을 수 있습니다.</p>`) });
  }
});
