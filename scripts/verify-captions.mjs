// scripts/verify-captions.mjs
// Drives the shipped app in headless Chrome and proves transcript caption import
// into the timed visual-moments system, end to end:
//  * upload two generated speaker WebM videos (solid red/green, ~8s, with audio),
//  * import a WebVTT FILE (two cues, 0:00-0:03 and 0:04-0:07) through the real
//    caption file input, and confirm two CAPTION entries appear in the timed
//    moments list with their text and time ranges,
//  * sample canvas pixels during playback and scrubbing to prove each caption
//    renders only inside its cue window (and nothing in the 3-4s gap), and stays
//    attached over Stack and Spotlight,
//  * re-import the same two cues as SRT text through the paste box + Import,
//  * import an INVALID caption file and confirm a visible, recoverable error
//    while the uploaded videos, selected preset, social links, and existing
//    caption moments all remain intact,
//  * click the real Export action, load the produced WebM back into a <video>,
//    seek to 1.5s/3.5s/5.5s, and confirm the caption text is burned into the
//    decoded frames only at the cue times.
// Media and transcripts are generated in-browser and read through the product's
// own controls/download link — no committed fixtures or verifier-only paths.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "chromium", "chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  for (const c of candidates) if (spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0) return c;
  throw new Error("Chrome/Chromium was not found. Set CHROME_BIN to run captions verification.");
}
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t); child.off("exit", onExit); resolve(ok); };
    const onExit = () => finish(true);
    const t = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}
async function stopChrome(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 2000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2000);
}
async function removeDirEventually(dir) {
  for (let i = 0; i < 8; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch (e) { if (i === 7) return; await sleep(100 * (i + 1)); }
  }
}
async function fetchJson(url, attempts = 60) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); last = new Error("HTTP " + r.status); }
    catch (e) { last = e; }
    await sleep(250);
  }
  throw last;
}
function connectWebSocket(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) => {
    const callId = ++id;
    ws.send(JSON.stringify({ id: callId, method, params }));
    return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
  };
  return { ws, ready, send };
}

const browserExpression = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const waitFor = async (fn, label, tries) => {
    for (let i = 0; i < (tries || 200); i++) { if (fn()) return; await sleep(50); }
    throw new Error(label);
  };

  async function makeVideo(name, color, freq) {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const ac = new AudioContext();
    const osc = ac.createOscillator(); osc.frequency.value = freq || 440;
    const d = ac.createMediaStreamDestination(); osc.connect(d); osc.start();
    const mix = new MediaStream([...stream.getVideoTracks(), ...d.stream.getAudioTracks()]);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
    const rec = new MediaRecorder(mix, { mimeType });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(250);
    for (let i = 0; i < 82; i++) { ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180); await sleep(100); }
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    osc.stop(); ac.close(); stream.getTracks().forEach((t) => t.stop());
    return new File(chunks, name, { type: "video/webm" });
  }
  const uploadTo = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); };
  const typeInto = (input, v) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); };

  // Caption band region: centered lower banner (bottom edge ~0.9h). "Present" =
  // mostly dark backing + some light text; "absent" = plain bright video.
  const CAP_REGION = { x0: 41, y0: 82, x1: 59, y1: 88 };
  function regionStats(canvas, region) {
    const w = canvas.width, h = canvas.height;
    const x0 = Math.floor(region.x0 / 100 * w), x1 = Math.floor(region.x1 / 100 * w);
    const y0 = Math.floor(region.y0 / 100 * h), y1 = Math.floor(region.y1 / 100 * h);
    const data = canvas.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let dark = 0, light = 0, bright = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 70 && g < 70 && b < 70) dark++;
      if (r > 180 && g > 180 && b > 180) light++;
      if (r > 110 || g > 110 || b > 110) bright++;
    }
    return { dark: dark / n, light: light / n, bright: bright / n };
  }
  const stage = () => document.querySelector("#stage-canvas");
  const capShown = () => { const s = regionStats(stage(), CAP_REGION); return s.dark > 0.45 && s.light > 0.003; };
  const capAbsent = () => { const s = regionStats(stage(), CAP_REGION); return s.dark < 0.12 && s.light < 0.01; };
  const captionItems = () => [...document.querySelectorAll("#moment-list li")].filter((li) => li.dataset.momentType === "caption");

  await waitFor(() => window.PDC && window.PDC.captions && document.querySelector('[data-file-bucket="host"]')
    && document.querySelector("#caption-file") && document.querySelector("#caption-text")
    && document.querySelector("#caption-load") && document.querySelector("#export") && document.querySelector("#scrub"),
    "shipped caption/moments/export controls should exist");

  const BOM = String.fromCharCode(0xFEFF);
  // Realistic exported .vtt: BOM + cue settings + no cue identifiers.
  const FILE_VTT = [
    BOM + "WEBVTT", "",
    "00:00:00.000 --> 00:00:03.000 line:85%", "WELCOME CAPTION", "",
    "00:00:04.000 --> 00:00:07.000 align:center", "SECOND CAPTION", "",
  ].join("\\n");
  // SRT for the paste path: numeric ids, comma millis, no WEBVTT header.
  const SRT = [
    "1", "00:00:00,000 --> 00:00:03,000", "WELCOME CAPTION", "",
    "2", "00:00:04,000 --> 00:00:07,000", "SECOND CAPTION", "",
  ].join("\\n");

  // Model check: both formats parse to the same two cues.
  {
    const scratch = window.PDC.episode.createEpisode({});
    assert(window.PDC.captions.importCaptionMoments(scratch, FILE_VTT).count === 2, "VTT should import two caption moments");
    const srtScratch = window.PDC.episode.createEpisode({});
    assert(window.PDC.captions.importCaptionMoments(srtScratch, SRT).count === 2, "SRT should import two caption moments");
  }

  // Upload two speaker videos through the normal Host and Guest controls.
  const [host, guest] = await Promise.all([
    makeVideo("host.webm", "#b91c1c", 300),
    makeVideo("guest.webm", "#10b981", 520),
  ]);
  uploadTo(document.querySelector('[data-file-bucket="host"]'), host);
  await sleep(100);
  uploadTo(document.querySelector('[data-file-bucket="guest1"]'), guest);
  await waitFor(() => document.querySelectorAll("video[data-speaker]").length === 2, "two decoder videos should exist");
  const vids = [...document.querySelectorAll("video[data-speaker]")];
  await waitFor(
    () => vids.every((v) => v.readyState >= 2 && isFinite(v.duration) && v.duration >= 7.2),
    "uploaded speakers should decode with a real duration covering both cue ranges", 400,
  );
  typeInto(document.querySelector('[data-link-bucket="host"]'), "https://x.com/hostperson");
  typeInto(document.querySelector('[data-link-bucket="guest1"]'), "https://x.com/guestperson");
  document.querySelector('[data-preset="split"]').click();
  await waitFor(() => stage().dataset.preset === "split", "Split preset should be active");

  // (1) FILE PATH: upload a real .vtt file and confirm caption MOMENTS appear.
  uploadTo(document.querySelector("#caption-file"), new File([FILE_VTT], "episode.vtt", { type: "text/vtt" }));
  await waitFor(() => /imported/i.test(document.querySelector("#caption-status").textContent || ""), "file upload should import captions, not reject", 200);
  assert((document.querySelector("#caption-error").hidden), "no error for a valid .vtt file");
  await waitFor(() => captionItems().length === 2, "two caption entries should appear in the moments list", 100);
  const listText = document.querySelector("#moment-list").textContent;
  assert(/Caption/.test(listText), "the moments list should label caption entries");
  assert(listText.includes("WELCOME CAPTION") && listText.includes("0:00") && listText.includes("0:03"), "list shows first caption + range");
  assert(listText.includes("SECOND CAPTION") && listText.includes("0:04") && listText.includes("0:07"), "list shows second caption + range");
  // Import jumps the timeline onto the first cue, so a caption is visible now.
  await waitFor(() => capShown() && stage().dataset.caption === "1", "imported caption should render immediately over the preview", 120);

  // (2) PLAYBACK: restart from 0 and watch the schedule unfold live.
  document.querySelector("#restart").click();
  await waitFor(() => capShown(), "caption should appear during playback inside 0-3s (Split)", 120);
  await waitFor(() => capAbsent(), "caption should disappear once playback passes 0:03", 200);
  await waitFor(() => capShown(), "second caption should appear during playback inside 4-7s (Split)", 200);

  // (3) SCRUB: pause, sample exact times.
  function pausePreview() {
    const btn = document.querySelector("#play");
    if (btn.textContent.indexOf("Pause") !== -1) btn.click();
  }
  const scrub = document.querySelector("#scrub");
  async function scrubTo(t) {
    await waitFor(() => !scrub.disabled && Number(scrub.max) >= 7, "scrub bar should span the episode", 100);
    scrub.value = String(t);
    scrub.dispatchEvent(new Event("input", { bubbles: true }));
  }
  pausePreview();
  await scrubTo(1.5);
  await waitFor(() => capShown() && stage().dataset.caption === "1", "scrubbed to 1.5s: caption shown (Split)");
  await scrubTo(3.5);
  await waitFor(() => capAbsent() && stage().dataset.caption === "0", "scrubbed to 3.5s: no caption (Split)");
  assert(regionStats(stage(), CAP_REGION).bright > 0.5, "at 3.5s the caption band should show plain bright video");
  await scrubTo(5);
  await waitFor(() => capShown(), "scrubbed to 5s: second caption shown (Split)");

  // (4) PRESET SWITCHES: caption moments render over Stack and Spotlight too.
  const presetStats = {};
  for (const presetId of ["stack", "spotlight"]) {
    document.querySelector('[data-preset="' + presetId + '"]').click();
    await waitFor(() => stage().dataset.preset === presetId, presetId + " preset should apply");
    assert(captionItems().length === 2, "caption moments should survive switching to " + presetId);
    pausePreview();
    await scrubTo(1.5);
    await waitFor(() => capShown(), presetId + ": caption should render over the recomposed layout at 1.5s");
    await scrubTo(3.5);
    await waitFor(() => capAbsent(), presetId + ": no caption at 3.5s");
    await scrubTo(5);
    await waitFor(() => capShown(), presetId + ": second caption at 5s");
    presetStats[presetId] = regionStats(stage(), CAP_REGION);
  }
  document.querySelector('[data-preset="split"]').click();
  await waitFor(() => stage().dataset.preset === "split", "back to Split");

  // (5) PASTE PATH (SRT): a probe that can 'fill' text can drive this. Re-import
  // the same two cues as SRT and confirm the caption moments are replaced (still 2).
  const capText = document.querySelector("#caption-text");
  capText.value = SRT; capText.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#caption-load").click();
  await waitFor(() => /pasted text/i.test(document.querySelector("#caption-status").textContent || ""), "pasted SRT should import captions", 200);
  assert(captionItems().length === 2, "SRT re-import should leave exactly two caption moments");

  // (6) INVALID FILE: a visible, recoverable error that does NOT wipe state.
  const preset0 = stage().dataset.preset;
  const hostLink0 = document.querySelector('[data-link-bucket="host"]').value;
  uploadTo(document.querySelector("#caption-file"), new File(["this is not a caption file"], "bad.txt", { type: "text/plain" }));
  await waitFor(() => !document.querySelector("#caption-error").hidden && document.querySelector("#caption-error").textContent.trim(), "an invalid caption file should show a visible error", 100);
  assert(document.querySelectorAll("video[data-speaker]").length === 2, "invalid import must not drop uploaded speaker videos");
  assert(stage().dataset.preset === preset0, "invalid import must not change the selected preset");
  assert(document.querySelector('[data-link-bucket="host"]').value === hostLink0, "invalid import must not clear social links");
  assert(captionItems().length === 2, "invalid import must not clear existing caption moments");

  // (7) EXPORT: caption moments burned into the decoded frames at cue times.
  await waitFor(() => !document.querySelector("#export").disabled, "Export should be enabled");
  document.querySelector("#export").click();
  await waitFor(
    () => document.querySelector("#export-download") && document.querySelector("#export-playback"),
    "export should produce a downloadable result", 700,
  );
  const resultText = document.querySelector("#export-result").textContent || "";
  assert(!/failed/i.test(resultText), "export must not report failure: " + resultText);
  const href = document.querySelector("#export-download").getAttribute("href");
  assert(href && href.indexOf("blob:") === 0, "download link should be a real blob URL");
  const blob = await (await fetch(href)).blob();
  assert(blob.size > 4096, "exported file should carry real bytes, got " + blob.size);

  const v = document.createElement("video");
  v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
  assert(v.videoWidth > 0 && v.videoHeight > 0, "exported file should be a playable video with real dimensions");
  if (!isFinite(v.duration)) {
    v.currentTime = 1e7;
    await waitFor(() => isFinite(v.duration), "exported duration should resolve", 200);
  }
  assert(v.duration >= 6.2, "export should cover both cue ranges, duration=" + v.duration);

  const probe = document.createElement("canvas");
  probe.width = v.videoWidth; probe.height = v.videoHeight;
  async function seekAndSample(t) {
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.removeEventListener("seeked", fin); resolve(); };
      v.addEventListener("seeked", fin);
      setTimeout(fin, 4000);
      try { v.currentTime = t; } catch (e) { fin(); }
    });
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; resolve(); };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fin);
      setTimeout(fin, 300);
    });
    probe.getContext("2d").drawImage(v, 0, 0, probe.width, probe.height);
    return { t, caption: regionStats(probe, CAP_REGION), frame: regionStats(probe, { x0: 0, y0: 0, x1: 100, y1: 100 }) };
  }
  const inFirst = await seekAndSample(1.5);
  const inGap = await seekAndSample(3.5);
  const inSecond = await seekAndSample(5.5);
  const burnedIn = (s) => s.dark > 0.3 && s.light > 0.0015;
  const plainVideo = (s) => s.dark < 0.15;
  assert(inFirst.frame.bright > 0.2, "exported frame at 1.5s should be nonblank");
  assert(burnedIn(inFirst.caption), "caption should be burned into the exported frame at 1.5s: " + JSON.stringify(inFirst.caption));
  assert(inGap.frame.bright > 0.2, "exported frame at 3.5s should be nonblank");
  assert(plainVideo(inGap.caption) && inGap.caption.light < 0.02, "no caption should be burned in at 3.5s: " + JSON.stringify(inGap.caption));
  assert(inSecond.frame.bright > 0.2, "exported frame at 5.5s should be nonblank");
  assert(burnedIn(inSecond.caption), "second caption should be burned into the exported frame at 5.5s: " + JSON.stringify(inSecond.caption));

  return {
    captionMomentsListed: captionItems().length,
    captionStatus: document.querySelector("#caption-status").textContent,
    preview: { stackCapAt5: presetStats.stack, spotlightCapAt5: presetStats.spotlight },
    exportBytes: blob.size,
    exportDuration: Number(v.duration.toFixed(2)),
    exportSamples: { inFirst, inGap, inSecond },
  };
})()
`;

async function main() {
  const chrome = findChrome();
  const port = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdc-captions-"));
  const entryUrl = pathToFileURL(path.join(root, "index.html")).href;
  const child = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required", "--allow-file-access-from-files",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, entryUrl,
  ]);
  try {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome did not expose a page target");
    const { ws, ready, send } = connectWebSocket(page.webSocketDebuggerUrl);
    await ready;
    await send("Runtime.enable");
    // 120s budget: two ~8s media generations, playback + scrub + preset sampling,
    // SRT re-import, invalid-file check, one full-length export, three decode-seeks.
    const result = await send("Runtime.evaluate", { expression: browserExpression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    ws.close();
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    console.log("verify-captions: OK — WebVTT/SRT import creates timed caption moments that render across presets and burn into the export; invalid files error without wiping state");
    console.log(JSON.stringify(result.result.value, null, 2));
  } finally {
    await stopChrome(child);
    await removeDirEventually(profileDir);
  }
}

main().catch((e) => { console.error(`verify-captions: ${e.message}`); process.exit(1); });
