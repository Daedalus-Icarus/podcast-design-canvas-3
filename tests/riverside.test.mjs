// tests/riverside.test.mjs — DOM-free link parsing + manifest normalization for
// the Riverside-style episode import (issue #195). Media generation lives in the
// browser and is exercised by scripts/verify-riverside-import.mjs instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPDC } from "./_load.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDC = loadPDC(root);
const R = PDC.riverside;

test("the sample link resolves to the embedded 3-speaker manifest", () => {
  const parsed = R.parseLink(R.SAMPLE_LINK);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.manifest, "sample link should resolve to a manifest");
  const m = R.normalizeManifest(parsed.manifest);
  assert.equal(m.tracks.length, 3);
  assert.deepEqual(m.tracks.map((t) => t.bucket), ["host", "guest1", "guest2"]);
});

test("parseLink rejects empty input with a helpful error", () => {
  const parsed = R.parseLink("");
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error);
});

test("parseLink accepts a raw JSON manifest string", () => {
  const raw = JSON.stringify({
    source: "riverside",
    episode: { title: "Custom" },
    tracks: [
      { bucket: "host", social: "https://x.com/a", color: "#111" },
      { bucket: "guest1", social: "https://x.com/b", color: "#222" },
    ],
  });
  const parsed = R.parseLink(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.manifest.title, "Custom");
  assert.equal(parsed.manifest.tracks.length, 2);
});

test("a non-sample Riverside share link is deferred, not faked", () => {
  const parsed = R.parseLink("https://riverside.fm/share/some-other-episode");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.deferred, true, "live network import must not be simulated");
  assert.ok(!parsed.manifest, "non-sample links must not resolve to embedded media");
});

test("a manifest URL/path is returned for fetching at resolve time", () => {
  const parsed = R.parseLink("fixtures/riverside-episode-sample.json");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.manifestUrl, "fixtures/riverside-episode-sample.json");
});

test("unrecognized input is rejected", () => {
  const parsed = R.parseLink("not a link at all");
  assert.equal(parsed.ok, false);
});

test("normalizeManifest requires at least two known speaker buckets", () => {
  assert.equal(R.normalizeManifest({ tracks: [{ bucket: "host" }] }), null);
  assert.equal(R.normalizeManifest({ tracks: [{ bucket: "director" }, { bucket: "host" }] }), null);
});

test("normalizeManifest ignores unknown buckets and keeps canonical order", () => {
  const m = R.normalizeManifest({
    tracks: [
      { bucket: "guest2", social: "https://x.com/c" },
      { bucket: "director" },
      { bucket: "host", social: "https://x.com/a" },
      { bucket: "guest1", social: "https://x.com/b" },
    ],
  });
  assert.deepEqual(m.tracks.map((t) => t.bucket), ["host", "guest1", "guest2"]);
});

test("normalizeManifest accepts a speakers alias and socialLink alias", () => {
  const m = R.normalizeManifest({
    tracks: [
      { role: "host", socialLink: "https://x.com/a" },
      { role: "guest1", socialLink: "https://x.com/b" },
    ],
  });
  assert.equal(m.tracks.length, 2);
  assert.equal(m.tracks[0].social, "https://x.com/a");
});

test("normalizeManifest defaults a missing color seed without dropping the track", () => {
  const m = R.normalizeManifest({
    tracks: [{ bucket: "host" }, { bucket: "guest1" }],
  });
  assert.equal(m.tracks[0].color, "#6c8cff");
});

test("the sample manifest fixture matches the embedded sample", async () => {
  const fs = await import("node:fs");
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, "fixtures", "riverside-episode-sample.json"), "utf8"),
  );
  const embedded = R.normalizeManifest(R.SAMPLE_MANIFEST);
  const fromFixture = R.normalizeManifest(fixture);
  assert.deepEqual(
    fromFixture.tracks.map((t) => t.bucket),
    embedded.tracks.map((t) => t.bucket),
  );
  assert.equal(fromFixture.title, embedded.title);
});
