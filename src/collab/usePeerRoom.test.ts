// Smoke tests for the usePeerRoom public utilities.
// Full lifecycle tests require a WS + WebRTC environment not available in jsdom.

import { describe, it, expect, beforeEach } from 'vitest';
import { tick, merge, now, resetForTesting } from './lamport';
import { ICE_SERVERS } from './iceServers';

beforeEach(() => {
  resetForTesting();
});

describe('lamport clock', () => {
  it('tick() increments and returns new value', () => {
    expect(tick()).toBe(1);
    expect(tick()).toBe(2);
  });

  it('merge() advances clock past remote value', () => {
    tick(); // clock = 1
    merge(5); // clock = max(1, 5) + 1 = 6
    expect(now()).toBe(6);
  });

  it('merge() does not regress when remote is stale', () => {
    tick(); tick(); tick(); // clock = 3
    merge(1); // clock = max(3, 1) + 1 = 4
    expect(now()).toBe(4);
  });

  it('tick() after merge() continues from merged value', () => {
    merge(10); // clock = 11
    expect(tick()).toBe(12);
  });
});

describe('ICE_SERVERS', () => {
  it('provides at least one STUN server and at least one TURN server', () => {
    const allUrls = ICE_SERVERS.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(allUrls.some((u) => u.startsWith('stun:'))).toBe(true);
    expect(allUrls.some((u) => u.startsWith('turn:') || u.startsWith('turns:'))).toBe(true);
  });
});
