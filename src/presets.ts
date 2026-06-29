import type { Preset, FrameRect, SpeakerBucket } from './types';

export const PRESETS: Preset[] = [
  {
    id: 'side-by-side',
    name: 'Side by Side',
    description: 'Two speakers framed equally. Best for balanced conversations.',
    pacing: 'steady',
    background: '#101318',
    frames: [
      { bucket: 'host', x: 0.04, y: 0.12, w: 0.44, h: 0.76 },
      { bucket: 'guest1', x: 0.52, y: 0.12, w: 0.44, h: 0.76 },
      { bucket: 'guest2', x: 0.52, y: 0.12, w: 0.44, h: 0.76 },
    ],
  },
  {
    id: 'spotlight-host',
    name: 'Spotlight Host',
    description: 'Host is prominent, guest is inset. Great for interview shows.',
    pacing: 'calm',
    background: '#0c0f14',
    frames: [
      { bucket: 'host', x: 0.05, y: 0.08, w: 0.6, h: 0.84 },
      { bucket: 'guest1', x: 0.69, y: 0.1, w: 0.26, h: 0.36 },
      { bucket: 'guest2', x: 0.69, y: 0.54, w: 0.26, h: 0.36 },
    ],
  },
  {
    id: 'stacked-trio',
    name: 'Stacked Trio',
    description: 'Three equal tiles across the frame. For full panels.',
    pacing: 'lively',
    background: '#141821',
    frames: [
      { bucket: 'host', x: 0.04, y: 0.14, w: 0.28, h: 0.72 },
      { bucket: 'guest1', x: 0.36, y: 0.14, w: 0.28, h: 0.72 },
      { bucket: 'guest2', x: 0.68, y: 0.14, w: 0.28, h: 0.72 },
    ],
  },
];

export function getPreset(id: string | null): Preset | null {
  if (!id) return null;
  return PRESETS.find((p) => p.id === id) ?? null;
}

export function frameForBucket(preset: Preset, bucket: SpeakerBucket): FrameRect | null {
  return preset.frames.find((f) => f.bucket === bucket) ?? null;
}
