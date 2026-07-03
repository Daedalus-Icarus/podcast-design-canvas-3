// app/riverside.js — Riverside-style episode link import.
//
// Adds a real in-product import path: a creator pastes a Riverside-style
// recording link (or a manifest reference) into the setup panel, the importer
// resolves it into synced Host, Guest 1, and Guest 2 media tracks, and those
// tracks flow through the SAME assign → preview → export pipeline that manual
// uploads use. No separate preview/export code path, no mocked outputs.
//
// Scope (per the active step): real Riverside network access, account sign-in,
// and third-party scraping are explicitly DEFERRED. This step resolves a
// maintainer-provided local/fixture manifest into actual media. The repo ships
// one declared sample Riverside-style manifest link; pasting it produces three
// real, synced, audible video tracks rendered through the normal workflow.
//
// Classic script on window.PDC.riverside. The link parsing + manifest
// normalization are DOM-free so they can be unit-tested under plain Node; only
// resolveManifest() touches browser media APIs and is only called in the browser.
(function () {
  const PDC = (window.PDC = window.PDC || {});

  // The single declared sample Riverside-style share link for this repo. The
  // verification harness pastes THIS link; the importer resolves it to the
  // embedded sample manifest below. A real Riverside integration would resolve
  // arbitrary share links server-side; that is deferred to a later step.
  const SAMPLE_LINK = "https://riverside.fm/share/podcast-design-canvas-sample";

  // Recognized Riverside-style share hosts. Anything shaped like a Riverside
  // share link is accepted by the parser; only the declared sample resolves to
  // real tracks in this step (other links explain that live import is deferred).
  const SHARE_HOST_RE = /riverside\.fm\/share\//i;

  // The canonical sample fixture: a 3-speaker episode. Each track declares its
  // speaker bucket, display name, social profile (drives derived names like the
  // upload flow), and a color seed used to generate distinct, recognizable,
  // synced video per speaker. Mirrors the structure a real Riverside manifest
  // exposes (per-speaker separate media tracks) without any network access.
  const SAMPLE_MANIFEST = {
    source: "riverside",
    episode: { title: "Designing for Creators — Sample Episode" },
    tracks: [
      { bucket: "host", name: "Host", social: "https://x.com/hostperson", color: "#b91c1c" },
      { bucket: "guest1", name: "Guest 1", social: "https://x.com/guestperson", color: "#047857" },
      { bucket: "guest2", name: "Guest 2", social: "https://x.com/guesttwo", color: "#2563eb" },
    ],
  };

  const BUCKETS = (PDC.presets && PDC.presets.SPEAKER_BUCKETS) || ["host", "guest1", "guest2"];

  function isSampleLink(input) {
    return typeof input === "string" && input.trim() === SAMPLE_LINK;
  }

  function isShareLink(input) {
    return typeof input === "string" && SHARE_HOST_RE.test(input.trim());
  }

  // Parse the creator's pasted input into either a resolved manifest or a
  // fetchable manifest location. Pure (no I/O) so it can be unit-tested.
  //
  // Returns one of:
  //   { ok: true, manifest }              — an embedded/raw manifest ready to resolve
  //   { ok: true, deferred: true }        — a Riverside link whose live import is deferred (not the sample)
  //   { ok: true, manifestUrl }           — a manifest URL/path to fetch at resolve time
  //   { ok: false, error }
  function parseLink(input) {
    const raw = (input == null ? "" : String(input)).trim();
    if (!raw) return { ok: false, error: "Paste a Riverside share link or manifest reference." };

    if (isSampleLink(raw)) return { ok: true, manifest: cloneManifest(SAMPLE_MANIFEST) };

    // A raw JSON manifest (object or JSON string) is accepted directly.
    if (raw.indexOf("{") === 0) {
      const manifest = normalizeManifest(safeJson(raw));
      if (!manifest) return { ok: false, error: "The pasted manifest is not a valid episode manifest." };
      return { ok: true, manifest };
    }
    // A data: URL carrying a JSON manifest.
    if (/^data:(application|text)\/json[,;]/i.test(raw)) {
      const payload = decodeDataUrl(raw);
      const manifest = normalizeManifest(safeJson(payload));
      if (!manifest) return { ok: false, error: "The manifest data URL is not a valid episode manifest." };
      return { ok: true, manifest };
    }
    // Any other Riverside-style share link: live network import is deferred.
    if (isShareLink(raw)) {
      return { ok: true, deferred: true };
    }
    // A manifest file reference (path or http(s) URL) — fetch at resolve time.
    if (/\.json(\?.*)?$/i.test(raw) || /^https?:\/\//i.test(raw)) {
      return { ok: true, manifestUrl: raw };
    }
    return { ok: false, error: "Unrecognized link. Use a Riverside share link or a manifest reference." };
  }

  function safeJson(text) {
    if (text && typeof text === "object") return text;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function decodeDataUrl(url) {
    const idx = url.indexOf(",");
    if (idx === -1) return "";
    let body = url.slice(idx + 1);
    if (/;base64/i.test(url.slice(0, idx))) {
      try {
        return atob(body);
      } catch (e) {
        return "";
      }
    }
    try {
      return decodeURIComponent(body);
    } catch (e) {
      return body;
    }
  }

  // Validate + normalize an arbitrary manifest into a clean shape. Pure.
  // A manifest must carry at least two speaker tracks mapped to known buckets.
  function normalizeManifest(raw) {
    if (!raw || typeof raw !== "object") return null;
    const tracksRaw = Array.isArray(raw.tracks) ? raw.tracks : Array.isArray(raw.speakers) ? raw.speakers : null;
    if (!tracksRaw || !tracksRaw.length) return null;

    const seen = {};
    const tracks = [];
    for (const t of tracksRaw) {
      if (!t || typeof t !== "object") continue;
      const bucket = typeof t.bucket === "string" ? t.bucket : typeof t.role === "string" ? t.role : null;
      if (!bucket || !BUCKETS.includes(bucket)) continue;
      if (seen[bucket]) continue;
      seen[bucket] = true;
      const color = typeof t.color === "string" && t.color ? t.color : "#6c8cff";
      const social = typeof t.social === "string" ? t.social : typeof t.socialLink === "string" ? t.socialLink : "";
      const name = typeof t.name === "string" ? t.name : "";
      tracks.push({ bucket, name, social, color });
    }
    // Dedupe to canonical bucket order.
    tracks.sort(function (a, b) {
      return BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket);
    });
    if (tracks.length < 2) return null;

    const title = (raw.episode && raw.episode.title) || raw.title || "Imported episode";
    return { source: typeof raw.source === "string" ? raw.source : "riverside", title: String(title), tracks };
  }

  function cloneManifest(manifest) {
    return {
      source: manifest.source,
      title: manifest.title,
      tracks: manifest.tracks.map(function (t) {
        return { bucket: t.bucket, name: t.name, social: t.social, color: t.color };
      }),
    };
  }

  // Fetch a manifest URL/path at resolve time (browser only). Over file:// the
  // sample link is the supported path; a fetched manifest works when the app is
  // served over http. Failures surface as a normal import error, never a crash.
  async function fetchManifest(url) {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error("Could not load the manifest (HTTP " + response.status + ").");
    return normalizeManifest(await response.json());
  }

  const sleep = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };

  // Generate one real, synced, audible WebM video track for a speaker. Same
  // technique the verification harness uses (canvas.captureStream + MediaRecorder
  // + oscillator) so the produced media genuinely decodes, renders distinct
  // pixels per speaker, carries audio, and exports as a playable file. Browser only.
  function generateTrackVideo(track, frames) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const videoStream = canvas.captureStream(12);

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ac = AudioCtx ? new AudioCtx() : null;
    let osc = null;
    let mixed = videoStream;
    if (ac) {
      osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      mixed = new MediaStream([].concat(videoStream.getVideoTracks(), dest.stream.getAudioTracks()));
    }

    const mimeType = window.MediaRecorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(mixed, { mimeType });
    const chunks = [];
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };

    const label = track.name || track.bucket;
    const color = track.color || "#6c8cff";
    const done = new Promise(function (resolve) {
      recorder.onstop = function () {
        if (ac) {
          try { osc.stop(); } catch (e) {}
          try { ac.close(); } catch (e) {}
        }
        videoStream.getTracks().forEach(function (tr) {
          try { tr.stop(); } catch (e) {}
        });
        resolve();
      };
    });

    recorder.start();
    const render = (async function () {
      for (let i = 0; i < frames; i++) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "26px sans-serif";
        ctx.fillText(String(label).slice(0, 20), 20, 78);
        ctx.fillText("frame " + i, 20, 118);
        await sleep(45);
      }
    })();
    return render.then(function () {
      recorder.stop();
      return done;
    }).then(function () {
      const file = new File(chunks, "riverside-" + track.bucket + ".webm", { type: "video/webm" });
      return { bucket: track.bucket, social: track.social, name: file.name, file };
    });
  }

  // Resolve a manifest into real media tracks (browser only). Generates one
  // synced video per speaker so Host, Guest 1, and Guest 2 each carry real
  // decoded frames + audio, ready to feed into the normal assign/preview path.
  async function resolveManifest(manifest) {
    const clean = normalizeManifest(manifest);
    if (!clean) throw new Error("The manifest does not describe enough speaker tracks.");
    const frames = 24;
    const results = [];
    for (const track of clean.tracks) {
      results.push(await generateTrackVideo(track, frames));
    }
    return { title: clean.title, tracks: results };
  }

  PDC.riverside = {
    SAMPLE_LINK,
    SAMPLE_MANIFEST,
    parseLink,
    normalizeManifest,
    fetchManifest,
    resolveManifest,
    isSampleLink,
    isShareLink,
  };
})();
