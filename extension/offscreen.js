const SERVER = "http://127.0.0.1:8787";
let recorder = null, chunks = [], blob = null, stream = null, ctx = null, levelTimer = null;

async function start(streamId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  // 탭을 캡처하면 스피커 소리가 끊긴다. 다시 출력으로 흘려줘야 사람이 회의를 들을 수 있다.
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  src.connect(ctx.destination);

  // 컨트롤러에 실제 입력 레벨을 보여준다. "소리가 잡히고 있나?"에 답이 있어야 한다.
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  levelTimer = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
    chrome.storage.session.set({ level: Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 280)) });
  }, 200);

  chunks = []; blob = null;
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    clearInterval(levelTimer);
    chrome.storage.session.set({ level: 0 });
    blob = new Blob(chunks, { type: "audio/webm" });
    stream.getTracks().forEach((t) => t.stop());
    ctx.close(); ctx = null; stream = null;
  };
  recorder.start(1000); // 1초 단위로 뱉어야 긴 회의에서 메모리가 안 터진다
}

function stop() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
}

async function upload(target) {
  if (!blob) throw new Error("녹음된 오디오가 없습니다");
  const r = await fetch(`${SERVER}/upload?target=${encodeURIComponent(target)}&ext=webm`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.to !== "off") return;
  (async () => {
    try {
      if (msg.cmd === "start") await start(msg.streamId);
      else if (msg.cmd === "stop") stop();
      else if (msg.cmd === "export") await upload(msg.target);
      else if (msg.cmd === "reset") { stop(); blob = null; chunks = []; }
      reply({ ok: true });
    } catch (e) {
      reply({ ok: false, error: String(e.message || e) });
    }
  })();
  return true;
});
