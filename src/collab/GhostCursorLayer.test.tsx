// Tests for GhostCursorLayer — ghost cursor overlay for P3.3.
//
// Covers: rendering, coordinate conversion, fade-to-idle timer,
// fade reset on cursor update, disconnect cleanup.
//
// Design reference: claudedocs/design_p3_multiplayer.md §9

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GhostCursorLayer } from './GhostCursorLayer';
import type { PeerInfo } from './protocol';
import type { Operator } from '../state/operators';

// ---- Fixtures -----------------------------------------------------------------

const OPERATORS: Operator[] = [
  { id: 'op-alpha', name: 'Alpha', color: '#0693E3', visible: true },
  { id: 'op-bravo', name: 'Bravo', color: '#FCB900', visible: true },
];

// Identity transform: screen coords === canvas coords.
const IDENTITY_VPT = [1, 0, 0, 1, 0, 0];

// Scale 2× + translate: screenX = 2*cx + 50, screenY = 2*cy + 100.
const SCALED_VPT = [2, 0, 0, 2, 50, 100];

function makePeer(id: string, operatorId: string | null, cursor: { x: number; y: number } | null): PeerInfo {
  return { id, operatorId, cursor };
}

// ---- Tests --------------------------------------------------------------------

describe('GhostCursorLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when no peers have cursor positions', () => {
    const { container } = render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', null)]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a cursor dot for each peer with a cursor', () => {
    render(
      <GhostCursorLayer
        peers={[
          makePeer('bob', 'op-alpha', { x: 10, y: 20 }),
          makePeer('carol', 'op-bravo', { x: 30, y: 40 }),
        ]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    expect(screen.getByTestId('ghost-cursor-bob')).toBeTruthy();
    expect(screen.getByTestId('ghost-cursor-carol')).toBeTruthy();
  });

  it('uses the operator color for the dot', () => {
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    const dot = screen.getByTestId('ghost-cursor-dot-bob');
    expect((dot as HTMLElement).style.backgroundColor).toBe('rgb(6, 147, 227)'); // #0693E3
  });

  it('falls back to grey for peers without an operator', () => {
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', null, { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    const dot = screen.getByTestId('ghost-cursor-dot-bob');
    // #888888 = rgb(136, 136, 136)
    expect((dot as HTMLElement).style.backgroundColor).toBe('rgb(136, 136, 136)');
  });

  it('converts canvas coords to screen coords with identity transform', () => {
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 100, y: 200 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    const cursor = screen.getByTestId('ghost-cursor-bob') as HTMLElement;
    expect(cursor.style.left).toBe('100px');
    expect(cursor.style.top).toBe('200px');
  });

  it('applies scale + translation from the viewport transform', () => {
    // SCALED_VPT: screenX = 2*cx + 50, screenY = 2*cy + 100
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 50, y: 75 })]}
        operators={OPERATORS}
        viewportTransform={SCALED_VPT}
      />,
    );
    const cursor = screen.getByTestId('ghost-cursor-bob') as HTMLElement;
    expect(cursor.style.left).toBe('150px'); // 2*50 + 50
    expect(cursor.style.top).toBe('250px');  // 2*75 + 100
  });

  it('starts active (0.30 opacity class)', () => {
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    const cursor = screen.getByTestId('ghost-cursor-bob');
    expect(cursor.classList.contains('GhostCursor--active')).toBe(true);
    expect(cursor.classList.contains('GhostCursor--idle')).toBe(false);
  });

  it('switches to idle class after 2s with no cursor update', () => {
    render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    act(() => { vi.advanceTimersByTime(2000); });

    const cursor = screen.getByTestId('ghost-cursor-bob');
    expect(cursor.classList.contains('GhostCursor--idle')).toBe(true);
    expect(cursor.classList.contains('GhostCursor--active')).toBe(false);
  });

  it('resets to active when cursor position object changes', () => {
    const { rerender } = render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    // Let it go idle.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId('ghost-cursor-bob').classList.contains('GhostCursor--idle')).toBe(true);

    // New cursor object (new reference) arrives — should reset to active.
    act(() => {
      rerender(
        <GhostCursorLayer
          peers={[makePeer('bob', 'op-alpha', { x: 10, y: 10 })]}
          operators={OPERATORS}
          viewportTransform={IDENTITY_VPT}
        />,
      );
    });
    expect(screen.getByTestId('ghost-cursor-bob').classList.contains('GhostCursor--active')).toBe(true);
  });

  it('removes cursor element when peer.cursor becomes null', () => {
    const { rerender } = render(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', { x: 0, y: 0 })]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    expect(screen.getByTestId('ghost-cursor-bob')).toBeTruthy();

    rerender(
      <GhostCursorLayer
        peers={[makePeer('bob', 'op-alpha', null)]}
        operators={OPERATORS}
        viewportTransform={IDENTITY_VPT}
      />,
    );
    expect(screen.queryByTestId('ghost-cursor-bob')).toBeNull();
  });
});
