export type SpeakerBucket = 'host' | 'guest1' | 'guest2';

export interface Speaker {
  id: string;
  bucket: SpeakerBucket;
  name: string;
  socialLink: string;
  file: File;
  objectUrl: string;
}

export interface Episode {
  id: string;
  title: string;
  speakers: Speaker[];
  presetId: string | null;
  createdAt: number;
}

export type EpisodeStage = 'import' | 'preset' | 'preview';

export interface FrameRect {
  bucket: SpeakerBucket;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Pacing = 'calm' | 'steady' | 'lively';

export interface Preset {
  id: string;
  name: string;
  description: string;
  pacing: Pacing;
  background: string;
  frames: FrameRect[];
}
