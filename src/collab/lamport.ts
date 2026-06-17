// Lamport logical clock for P2P conflict resolution. Module-scoped singleton
// so all callers in the same browser tab share one clock.
//
// Contract: call tick() before every reliable-channel send and attach the
// returned value as `lc`. Call merge(remote) on every reliable-channel
// receive before processing the message. LWW for delta:modified uses `lc`:
// higher wins; lexicographic peerId breaks ties. §4.2 of design_p3_multiplayer_p2p.md
//
// WARNING: this module is a singleton — tests must call resetForTesting() in
// beforeEach or use vi.resetModules() to prevent inter-test clock bleed.

let clock = 0;

/** Increment before sending; attach returned value to outgoing message as `lc`. */
export function tick(): number {
  return ++clock;
}

/** Merge on receive; call before processing the message. */
export function merge(remote: number): void {
  clock = Math.max(clock, remote) + 1;
}

/** Read current clock value without incrementing. */
export function now(): number {
  return clock;
}

/** Reset to 0 — for use in tests only. */
export function resetForTesting(): void {
  clock = 0;
}
