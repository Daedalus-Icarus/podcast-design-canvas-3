import { useEffect, useRef, useState } from 'react';
import { useEpisodeStore } from '../store';
import { getPreset } from '../presets';
import { EpisodeEngine } from '../engine';
import { recordEpisode, triggerDownload, pickSupportedMimeType, extensionFor } from '../recorder';
import type { RecordResult } from '../recorder';

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PreviewScreen() {
  const episode = useEpisodeStore((s) => s.episode);
  const goToStage = useEpisodeStore((s) => s.goToStage);
  const reset = useEpisodeStore((s) => s.reset);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EpisodeEngine | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [result, setResult] = useState<RecordResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const preset = getPreset(episode?.presetId ?? null);

  useEffect(() => {
    if (!canvasRef.current || !episode || !preset) return;
    const engine = new EpisodeEngine();
    engineRef.current = engine;
    engine.attach(canvasRef.current);
    let cancelled = false;
    engine
      .load(episode.speakers, preset)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) setLoadError(r.error ?? 'Failed to load media');
        setDuration(engine.duration);
      })
      .catch((e) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [episode, preset]);

  useEffect(() => {
    if (!playing && !exporting) return;
    const id = window.setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      setTime(e.currentTime);
      if (exporting) setExportProgress(Math.min(1, e.duration ? e.currentTime / e.duration : 0));
    }, 200);
    return () => window.clearInterval(id);
  }, [playing, exporting]);

  const onPlay = async () => {
    const e = engineRef.current;
    if (!e) return;
    setResult(null);
    e.seek(0);
    await e.play(() => setPlaying(false));
    setPlaying(true);
  };

  const onPause = () => {
    engineRef.current?.pause();
    setPlaying(false);
  };

  const onExport = async () => {
    const e = engineRef.current;
    if (!e) return;
    setExporting(true);
    setExportError(null);
    setResult(null);
    setExportProgress(0);
    try {
      e.seek(0);
      const mime = pickSupportedMimeType();
      const res = await recordEpisode(e, { mimeType: mime });
      setResult(res);
      const ext = extensionFor(res.mimeType);
      const slug = (episode?.title || 'episode').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      triggerDownload(res.url, `${slug}.${ext}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
      setPlaying(false);
    }
  };

  if (!preset) {
    return <div className="banner warn">No preset selected. Go back and choose one.</div>;
  }

  const progressPct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">
          <div>
            <div className="card-eyebrow">Step 3</div>
            <h2 style={{ marginTop: 2 }}>Preview</h2>
          </div>
          <span className="tag">{preset.name}</span>
        </div>

        <div className="preview-stage" style={{ marginTop: 14 }}>
          <canvas ref={canvasRef} />
          <div className="stage-tag">
            <span className="live" />
            LIVE COMPOSE
          </div>
        </div>

        {loadError && (
          <div className="banner danger" style={{ marginTop: 14 }}>
            {loadError}
          </div>
        )}

        <div className="transport">
          {!playing ? (
            <button
              type="button"
              className="play-btn"
              onClick={onPlay}
              disabled={exporting || !!loadError}
              aria-label="Play"
            >
              ▶
            </button>
          ) : (
            <button
              type="button"
              className="play-btn"
              onClick={onPause}
              disabled={exporting}
              aria-label="Pause"
            >
              ⏸
            </button>
          )}
          <div className="scrub" aria-hidden="true">
            <div className="fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="time-readout">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-eyebrow">Export</div>
        <h2 style={{ marginTop: 2 }}>Render &amp; download</h2>
        <p className="muted">
          Produces a real downloadable video from your uploaded media in the selected layout. Rendering
          runs in real time and stops automatically at the end of the longest track.
        </p>

        <div className="export-panel" style={{ marginTop: 16 }}>
          <div className="export-cta">
            <button
              type="button"
              className="primary"
              onClick={onExport}
              disabled={exporting || !!loadError}
            >
              {exporting ? 'Rendering…' : '⬇ Export & download'}
            </button>
            {!exporting && !result && (
              <span className="muted">Ready when you are.</span>
            )}
            {exporting && <span className="muted">{Math.round(exportProgress * 100)}%</span>}
          </div>

          {exporting && (
            <div className="progress-track">
              <div className="bar" style={{ width: `${Math.round(exportProgress * 100)}%` }} />
            </div>
          )}

          {exportError && <div className="banner danger">{exportError}</div>}

          {result && (
            <div className="result">
              <div className="result-head">
                <span className="ok">
                  <span className="check">✓</span> Export ready
                </span>
                <a href={result.url} download={`episode.${extensionFor(result.mimeType)}`}>
                  Download again
                </a>
              </div>
              <div className="result-meta">
                {(result.blob.size / 1_000_000).toFixed(1)} MB · {result.mimeType}
              </div>
              <video src={result.url} controls />
            </div>
          )}
        </div>
      </div>

      <div className="actions">
        <button type="button" className="ghost" onClick={() => goToStage('preset')} disabled={exporting}>
          ← Back
        </button>
        <button type="button" className="ghost" onClick={reset} disabled={exporting}>
          Start new episode
        </button>
      </div>
    </div>
  );
}
