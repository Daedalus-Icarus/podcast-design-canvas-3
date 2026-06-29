import { describe, it, expect } from 'vitest';
import { pickSupportedMimeType, extensionFor } from './recorder';

describe('recorder helpers', () => {
  it('returns a webm mime type by default', () => {
    const m = pickSupportedMimeType();
    expect(m).toContain('webm');
  });

  it('extensionFor maps webm and mp4', () => {
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionFor('video/mp4')).toBe('mp4');
  });
});
