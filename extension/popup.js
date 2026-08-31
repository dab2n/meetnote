const SERVER = "http://127.0.0.1:8787";
const send = (cmd, extra = {}) => chrome.runtime.sendMessage({ to: "bg", cmd, ...extra });
const $ = (id) => document.getElementById(id);
const PANELS = ["idle", "recording", "ready", "sending", "sent", "error"];

let tick = null;

async function render() {
  const { state = "idle", startedAt, error } = await chrome.storage.session.get(["state", "startedAt", "error"]);
  PANELS.forEach((p) => $(p).classList.toggle("hidden", p !== state));
  clearInterval(tick);
  if (state === "recording") {
    const paint = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $("timer").textContent = `${String((s / 60) | 0).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    paint();
    tick = setInterval(paint, 500);
  }
  if (state === "error") $("errmsg").textContent = error || "알 수 없는 오류";
}

$("rec").onclick = async () => { await send("start"); render(); };
$("stop").onclick = async () => { await send("stop"); render(); };
for (const b of document.querySelectorAll("[data-t]")) {
  b.onclick = async () => { await send("export", { target: b.dataset.t }); render(); };
}
for (const id of ["again", "again2", "again3"]) $(id).onclick = async () => { await send("reset"); render(); };

chrome.storage.session.onChanged.addListener(render);
render();
