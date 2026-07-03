// scripts/verify-riverside-import.mjs
// Drives the shipped app in headless Chrome and proves issue #195: from the
// normal new-episode setup a creator can paste the repo's declared sample
// Riverside-style manifest link into the Riverside/import-link control, click
// Import, and observe three speaker buckets populated as Host, Guest 1, and
// Guest 2 with three REAL synced videos rendering in the preview. It then
// switches Split, Stack, and Spotlight and confirms the imported videos
// rerender in distinct layouts, and finally clicks Export and loads the
// produced file back into a <video>: real dimensions, non-trivial bytes, and
// decodable audio. No mocked media or verifier-only paths — the importer
// generates real WebM tracks in-browser and they flow through the same
// assign → preview → export pipeline uploads use. Mirrors the CDP harness used
// by the other rendered checks.
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
  throw new Error("Chrome/Chromium was not found. Set CHROME_BIN to run Riverside import verification.");
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
  const waitFor = async (fn, label, tries) => { for (let i = 0; i < (tries || 200); i++) { if (fn()) return; await sleep(50); } throw new Error(label); };

  await waitFor(() => window.PDC && window.PDC.riverside && document.querySelector("#riverside-link") && document.querySelector("#riverside-import-btn"), "Riverside import controls should exist");
  await waitFor(() => document.querySelector("#export"), "export control should exist");

  const linkInput = document.querySelector("#riverside-link");
  const importBtn = document.querySelector("#riverside-import-btn");

  // Paste the repo's declared sample Riverside-style manifest link and import.
  linkInput.value = window.PDC.riverside.SAMPLE_LINK;
  linkInput.dispatchEvent(new Event("input", { bubbles: true }));

  // Buckets start empty before import.
  assert(document.querySelectorAll(".bucket.filled").length === 0, "no buckets should be filled before import");

  importBtn.click();

  // Wait until all three buckets are populated by the importer.
  await waitFor(
    () => document.querySelectorAll(".bucket.filled").length === 3,
    "import should populate Host, Guest 1, and Guest 2 buckets",
    600,
  );
  await waitFor(() => !document.querySelector("#export").disabled, "export should be enabled after import");

  const filled = [...document.querySelectorAll(".bucket.filled")].map((b) => b.dataset.bucket);
  assert(JSON.stringify(filled) === JSON.stringify(["host", "guest1", "guest2"]), "filled buckets should be Host, Guest 1, Guest 2 in order, got " + JSON.stringify(filled));

  // Derived names should come from the imported social links, like uploads.
  assert(document.querySelector('.bucket[data-bucket="host"] .bucket-name').textContent === "hostperson", "host name should derive from imported social link");
  assert(document.querySelector('.bucket[data-bucket="guest1"] .bucket-name').textContent === "guestperson", "guest1 name should derive from imported social link");
  assert(document.querySelector('.bucket[data-bucket="guest2"] .bucket-name').textContent === "guesttwo", "guest2 name should derive from imported social link");

  // Imported media must be backed by real blob URLs feeding the same decoder pipeline.
  await waitFor(() => document.querySelectorAll("video[data-speaker]").length === 3, "three hidden decoder videos should back the imported tracks");
  const videos = [...document.querySelectorAll("video[data-speaker]")];
  await Promise.all(videos.map((v) =>
    v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? null : new Promise((res) => v.addEventListener("loadeddata", res, { once: true })),
  ));
  assert(videos.every((v) => v.videoWidth > 0 && v.videoHeight > 0), "imported videos should decode real dimensions");
  assert(videos.every((v) => v.src.startsWith("blob:")), "imported videos should be backed by blob URLs");

  function regionAvgColor(x0, y0, x1, y1) {
    const c = document.getElementById("stage-canvas");
    const w = c.width, h = c.height;
    const data = c.getContext("2d").getImageData(0, 0, w, h).data;
    const xa = Math.floor(x0 / 100 * w), xb = Math.floor(x1 / 100 * w);
    const ya = Math.floor(y0 / 100 * h), yb = Math.floor(y1 / 100 * h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }
  function dom(color) {
    if (color.r > color.g + 25 && color.r > color.b + 25) return "red";
    if (color.g > color.r + 25 && color.g > color.b + 25) return "green";
    if (color.b > color.r + 25 && color.b > color.g + 25) return "blue";
    return "mixed";
  }
  function canvasLitPct() {
    const c = document.getElementById("stage-canvas");
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 14 || data[i + 1] > 14 || data[i + 2] > 14) lit++;
    return Math.round((lit / (data.length / 4)) * 100);
  }
  async function clickPreset(id) {
    document.querySelector('[data-preset="' + id + '"]').click();
    await sleep(500);
  }

  // Confirm the imported videos render and rerender in distinct layouts across
  // Split, Stack, and Spotlight — the same composition path uploads use.
  document.querySelector("#play").click();
  await sleep(600);
  let splitPct = canvasLitPct();
  assert(splitPct >= 5, "split should show nonblank imported pixels (" + splitPct + "%)");

  await clickPreset("stack");
  assert(document.querySelector("#stage-canvas").dataset.preset === "stack", "should switch to stack");
  const stackRects = window.PDC.presets.getPreset("stack").layout(3);
  const stackRows = stackRects.map((rect) => dom(regionAvgColor(rect.x + 2, rect.y + 2, rect.x + rect.w - 2, rect.y + rect.h - 2)));
  assert(stackRows[0] === "red" && stackRows[1] === "green" && stackRows[2] === "blue", "stack rows should show host/guest1/guest2 imported feeds, got " + JSON.stringify(stackRows));

  await clickPreset("spotlight");
  assert(document.querySelector("#stage-canvas").dataset.preset === "spotlight", "should switch to spotlight");
  const sp = window.PDC.presets.getPreset("spotlight").layout(3);
  assert(sp[0].w === 100 && sp[0].h === 100, "spotlight host should fill the stage");
  assert(dom(regionAvgColor(25, 25, 75, 75)) === "red", "spotlight center should show the host feed");

  // Buckets stay populated across preset switches.
  assert(document.querySelectorAll(".bucket.filled").length === 3, "imported buckets should survive preset switches");
  assert(!document.querySelector("#export").disabled, "export should stay enabled after preset cycling");

  // Export the imported composition and confirm a genuinely playable file with
  // non-trivial bytes and decodable audio — same gate as uploaded exports.
  await clickPreset("split");
  const result = document.querySelector("#export-result");
  result.hidden = true; result.innerHTML = "";
  await waitFor(() => !document.querySelector("#export").disabled, "export should be enabled before export click");
  document.querySelector("#export").click();
  await waitFor(
    () => document.querySelector("#export-download") && document.querySelector("#export-playback"),
    "export should produce a downloadable result",
    600,
  );
  const dl = document.querySelector("#export-download");
  const href = dl.getAttribute("href");
  assert(href && href.indexOf("blob:") === 0, "export should produce a real blob URL");
  const blob = await (await fetch(href)).blob();
  assert(blob.size > 2048, "exported file should carry real bytes, got " + blob.size);
  const v = document.createElement("video");
  v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
  assert(v.videoWidth > 0 && v.videoHeight > 0, "exported file should be a playable video with real dimensions");
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let peak = 0;
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i += 97) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
    }
  } catch (e) {
    throw new Error("exported file has no decodable audio track (" + e.name + ")");
  } finally { ac.close(); }
  assert(peak > 1e-4, "exported audio from imported tracks must be audible, peak=" + peak);

  return {
    linkImported: window.PDC.riverside.SAMPLE_LINK,
    filledBuckets: filled,
    decodedVideos: videos.map((v) => ({ speaker: v.dataset.speaker, width: v.videoWidth, height: v.videoHeight })),
    splitLitPct: splitPct,
    stackRows,
    exportedBytes: blob.size,
    exportedDimensions: v.videoWidth + "x" + v.videoHeight,
    exportedAudioPeak: Number(peak.toFixed(4)),
  };
})()
`;

async function main() {
  const chrome = findChrome();
  const port = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdc-riverside-"));
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
    // Generous budget: in-browser generation of three synced WebM tracks plus export.
    const result = await send("Runtime.evaluate", { expression: browserExpression, awaitPromise: true, returnByValue: true, timeout: 90000 });
    ws.close();
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    console.log("verify-riverside-import: OK — sample link imported 3 synced tracks, rendered across presets, exported a playable file");
    console.log(JSON.stringify(result.result.value, null, 2));
  } finally {
    await stopChrome(child);
    await removeDirEventually(profileDir);
  }
}

main().catch((e) => { console.error(`verify-riverside-import: ${e.message}`); process.exit(1); });
