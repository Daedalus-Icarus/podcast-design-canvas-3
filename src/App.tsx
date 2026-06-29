import { useEpisodeStore } from './store';
import { ImportScreen } from './components/ImportScreen';
import { PresetScreen } from './components/PresetScreen';
import { PreviewScreen } from './components/PreviewScreen';
import type { EpisodeStage } from './types';

const STEPS: { stage: EpisodeStage; label: string }[] = [
  { stage: 'import', label: 'Import' },
  { stage: 'preset', label: 'Preset' },
  { stage: 'preview', label: 'Preview & export' },
];

function BrandMark() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-name">
        Podcast Design Canvas
      </span>
    </div>
  );
}

function Stepper({ active }: { active: EpisodeStage }) {
  const activeIdx = STEPS.findIndex((s) => s.stage === active);
  return (
    <div className="stepper" aria-label="Workflow progress">
      {STEPS.map((s, i) => (
        <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span className="step-line" />}
          <div className={`step-seg ${i === activeIdx ? 'active' : ''} ${i < activeIdx ? 'done' : ''}`}>
            <span className="dot">{i < activeIdx ? '✓' : i + 1}</span>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function Landing() {
  const startEpisode = useEpisodeStore((s) => s.startEpisode);
  return (
    <>
      <div className="hero">
        <div className="card-eyebrow" style={{ marginBottom: 18 }}>
          Canva, for podcast production
        </div>
        <h1>Turn synced speaker recordings into a polished episode.</h1>
        <p className="lead">
          Upload separate per-speaker video, pick a layout, preview the composed show, and export a
          real, downloadable video — entirely in your browser.
        </p>
        <button
          type="button"
          className="primary cta"
          onClick={() => startEpisode('Untitled Episode')}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> New episode
        </button>
        <div className="hero-features">
          <span className="feature-pill">
            <span className="num">1</span> Import speakers
          </span>
          <span className="feature-pill">
            <span className="num">2</span> Choose a preset
          </span>
          <span className="feature-pill">
            <span className="num">3</span> Preview &amp; export
          </span>
        </div>
      </div>
    </>
  );
}

export function App() {
  const stage = useEpisodeStore((s) => s.stage);
  const episode = useEpisodeStore((s) => s.episode);

  if (!episode) {
    return (
      <div className="app">
        <header className="topbar">
          <BrandMark />
        </header>
        <Landing />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <BrandMark />
        <Stepper active={stage} />
      </header>

      {stage === 'import' && <ImportScreen />}
      {stage === 'preset' && <PresetScreen />}
      {stage === 'preview' && <PreviewScreen />}
    </div>
  );
}
