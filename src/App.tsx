import { useState } from 'react';
import { useEpisodeStore } from './store';
import { ImportScreen } from './components/ImportScreen';
import { PresetScreen } from './components/PresetScreen';
import { PreviewScreen } from './components/PreviewScreen';
import type { EpisodeStage } from './types';

const STEP_LABELS: { stage: EpisodeStage; label: string }[] = [
  { stage: 'import', label: '1. Import' },
  { stage: 'preset', label: '2. Preset' },
  { stage: 'preview', label: '3. Preview & export' },
];

export function App() {
  const stage = useEpisodeStore((s) => s.stage);
  const episode = useEpisodeStore((s) => s.episode);
  const startEpisode = useEpisodeStore((s) => s.startEpisode);
  const [started, setStarted] = useState(false);

  if (!started || !episode) {
    return (
      <div className="app">
        <header>
          <h1>Podcast Design Canvas</h1>
          <p>Turn synced speaker recordings into a polished, publishable episode.</p>
        </header>
        <div className="card">
          <p>
            Create a new episode, upload separate synced video files per speaker, choose a layout, and
            export a real downloadable video — all in your browser.
          </p>
          <button
            type="button"
            className="primary"
            style={{ marginTop: 12 }}
            onClick={() => {
              startEpisode('Untitled Episode');
              setStarted(true);
            }}
          >
            + New episode
          </button>
        </div>
      </div>
    );
  }

  const activeIdx = STEP_LABELS.findIndex((s) => s.stage === stage);

  return (
    <div className="app">
      <header>
        <h1>Podcast Design Canvas</h1>
        <p>{episode.title}</p>
      </header>

      <div className="steps">
        {STEP_LABELS.map((s, i) => (
          <div
            key={s.stage}
            className={`step ${i === activeIdx ? 'active' : ''} ${i < activeIdx ? 'done' : ''}`}
          >
            {s.label}
          </div>
        ))}
      </div>

      {stage === 'import' && <ImportScreen />}
      {stage === 'preset' && <PresetScreen />}
      {stage === 'preview' && <PreviewScreen />}
    </div>
  );
}
