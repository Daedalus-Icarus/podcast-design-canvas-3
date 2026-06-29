import { describe, it, expect } from 'vitest';
import { PRESETS, getPreset, frameForBucket } from './presets';
import type { Preset } from './types';

describe('presets', () => {
  it('exposes at least one preset (issue #1 acceptance: choose a preset)', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(1);
  });

  it('every preset has frames for host, guest1, and guest2', () => {
    for (const p of PRESETS as Preset[]) {
      const buckets = p.frames.map((f) => f.bucket);
      expect(buckets).toContain('host');
      expect(buckets).toContain('guest1');
      expect(buckets).toContain('guest2');
    }
  });

  it('every frame lies within the 0..1 normalized canvas', () => {
    for (const p of PRESETS) {
      for (const f of p.frames) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w).toBeLessThanOrEqual(1.0001);
        expect(f.y + f.h).toBeLessThanOrEqual(1.0001);
        expect(f.w).toBeGreaterThan(0);
        expect(f.h).toBeGreaterThan(0);
      }
    }
  });

  it('getPreset returns null for unknown ids', () => {
    expect(getPreset(null)).toBeNull();
    expect(getPreset('does-not-exist')).toBeNull();
  });

  it('frameForBucket returns the matching frame or null', () => {
    const p = PRESETS[0];
    expect(frameForBucket(p, 'host')?.bucket).toBe('host');
    expect(frameForBucket(p, 'guest1')?.bucket).toBe('guest1');
    expect(frameForBucket(p, 'guest2')?.bucket).toBe('guest2');
  });
});
