import { PRESETS } from '../presets';
import { useEpisodeStore } from '../store';
import type { Preset } from '../types';

function PresetThumb({ preset }: { preset: Preset }) {
  return (
    <div className="preset-thumb" style={{ background: preset.background }}>
      {preset.frames.map((f, i) => (
        <div
          key={i}
          className="frame"
          style={{
            left: `${f.x * 100}%`,
            top: `${f.y * 100}%`,
            width: `${f.w * 100}%`,
            height: `${f.h * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export function PresetScreen() {
  const presetId = useEpisodeStore((s) => s.episode?.presetId ?? null);
  const setPreset = useEpisodeStore((s) => s.setPreset);
  const goToStage = useEpisodeStore((s) => s.goToStage);

  return (
    <div className="stack">
      <div className="card">
        <strong>Choose a preset style</strong>
        <p className="muted">
          Pick a layout and pacing. You can preview the composed episode next, before exporting.
        </p>
        <div className="preset-grid" style={{ marginTop: 14 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-card ${presetId === p.id ? 'selected' : ''}`}
              onClick={() => setPreset(p.id)}
              aria-pressed={presetId === p.id}
            >
              <PresetThumb preset={p} />
              <h4>{p.name}</h4>
              <p>{p.description}</p>
              <span className="tag" style={{ marginTop: 6, display: 'inline-block' }}>
                pacing: {p.pacing}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="ghost" onClick={() => goToStage('import')}>
          Back
        </button>
        <button type="button" className="primary" disabled={!presetId} onClick={() => goToStage('preview')}>
          Continue to preview
        </button>
      </div>
    </div>
  );
}
