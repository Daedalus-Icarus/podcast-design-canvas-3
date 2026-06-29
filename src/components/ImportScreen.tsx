import { useRef } from 'react';
import { useEpisodeStore, BUCKET_LABELS, canAdvanceToPreset, isValidSocialLink } from '../store';
import type { SpeakerBucket } from '../types';

const ACCEPTED = 'video/*,audio/*';

function BucketPicker({ value, onChange }: { value: SpeakerBucket; onChange: (b: SpeakerBucket) => void }) {
  const buckets: SpeakerBucket[] = ['host', 'guest1', 'guest2'];
  return (
    <div className="bucket-pills" role="radiogroup" aria-label="Speaker bucket">
      {buckets.map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={value === b}
          className={`bucket-pill ${value === b ? 'active' : ''}`}
          onClick={() => onChange(b)}
        >
          {BUCKET_LABELS[b]}
        </button>
      ))}
    </div>
  );
}

export function ImportScreen() {
  const fileRef = useRef<HTMLInputElement>(null);
  const episode = useEpisodeStore((s) => s.episode);
  const startEpisode = useEpisodeStore((s) => s.startEpisode);
  const addSpeakerFile = useEpisodeStore((s) => s.addSpeakerFile);
  const setSpeakerBucket = useEpisodeStore((s) => s.setSpeakerBucket);
  const setSpeakerName = useEpisodeStore((s) => s.setSpeakerName);
  const setSpeakerSocial = useEpisodeStore((s) => s.setSpeakerSocial);
  const removeSpeaker = useEpisodeStore((s) => s.removeSpeaker);
  const setPresetStage = useEpisodeStore((s) => s.goToStage);
  const error = useEpisodeStore((s) => s.error);

  const speakers = episode?.speakers ?? [];

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) addSpeakerFile(f);
  };

  const validSocials = speakers.every((s) => isValidSocialLink(s.socialLink));
  const ready = canAdvanceToPreset(episode) && validSocials;

  return (
    <div className="stack">
      <div className="card">
        <label className="muted" htmlFor="ep-title">
          Episode title
        </label>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            id="ep-title"
            type="text"
            placeholder="My Podcast — Episode 1"
            defaultValue={episode?.title}
            onBlur={(e) => startEpisode(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Upload separate synced speaker recordings (one file per person). Riverside-style exports work
          best.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Speaker files</strong>
          <button type="button" onClick={() => fileRef.current?.click()}>
            + Add speaker file(s)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            multiple
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div className="stack" style={{ marginTop: 14 }}>
          {speakers.length === 0 && (
            <div className="empty">No files yet. Add at least two speaker recordings to continue.</div>
          )}
          {speakers.map((s) => (
            <div key={s.id} className="speaker-row">
              <div>
                <div className="label">File</div>
                <div className="file-name">{s.file.name}</div>
                <div style={{ marginTop: 8 }} className="label">
                  Bucket
                </div>
                <BucketPicker value={s.bucket} onChange={(b) => setSpeakerBucket(s.id, b)} />
              </div>
              <div className="stack">
                <div>
                  <div className="label">Display name</div>
                  <input
                    type="text"
                    placeholder="e.g. Alex Lee"
                    value={s.name}
                    onChange={(e) => setSpeakerName(s.id, e.target.value)}
                  />
                </div>
                <div>
                  <div className="label">Social link (optional, improves accuracy)</div>
                  <input
                    type="url"
                    placeholder="https://twitter.com/handle"
                    value={s.socialLink}
                    onChange={(e) => setSpeakerSocial(s.id, e.target.value)}
                    aria-invalid={!isValidSocialLink(s.socialLink)}
                  />
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="ghost" onClick={() => removeSpeaker(s.id)}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="banner warn" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="primary" disabled={!ready} onClick={() => setPresetStage('preset')}>
          Continue to presets
        </button>
      </div>
    </div>
  );
}
