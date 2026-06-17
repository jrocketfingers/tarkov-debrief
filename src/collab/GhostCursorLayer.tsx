// Ghost cursor overlay for P3.3 — renders a colored dot + label for each
// connected peer that has a known canvas-coordinate cursor position.
//
// Rendered as an HTML overlay (not fabric objects) so it stays out of the
// undo stack, eraser, export, and replay timeline.  pointer-events: none
// ensures the overlay doesn't intercept canvas mouse events.
//
// Coordinate conversion: peer cursors are broadcast in canvas coordinates
// (pre-viewportTransform). The 6-element affine matrix converts to screen
// coordinates (pixels inside the .Canvas container).
//
// Design reference: claudedocs/design_p3_multiplayer.md §9

import { useEffect, useRef, useState } from 'react';
import type { PeerInfo } from './protocol';
import type { Operator } from '../state/operators';
import './GhostCursorLayer.css';

type Props = {
  peers: PeerInfo[];
  operators: Operator[];
  // canvas.viewportTransform — 6-element affine matrix [a, b, c, d, e, f].
  // Passed from App.tsx which subscribes to the canvas viewport:transformed
  // event and stores it in React state so GhostCursorLayer re-renders on
  // pan/zoom. §9.1 (R8 — must be the full matrix, not a scalar zoom)
  viewportTransform: number[];
};

// How long (ms) before an idle cursor fades to low opacity. §9.2
const IDLE_TIMEOUT_MS = 2000;

// Fallback color for peers who haven't claimed an operator chip.
const FALLBACK_COLOR = '#888888';

type GhostCursorProps = {
  peer: PeerInfo;
  color: string;
  label: string;
  viewportTransform: number[];
};

function GhostCursor({ peer, color, label, viewportTransform }: GhostCursorProps) {
  // `active` drives the CSS class: 30% opacity while moving, 15% when idle.
  const [active, setActive] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the idle timer each time the cursor position object changes.
  // useRoom creates a new { x, y } object on every cursor message, so this
  // effect re-runs on every incoming cursor update. §9.2
  useEffect(() => {
    if (!peer.cursor) return;
    setActive(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setActive(false), IDLE_TIMEOUT_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [peer.cursor]); // new object ref on every cursor msg — intentional

  if (!peer.cursor) return null;

  // Canvas-space → screen-space via the 2D affine matrix.
  // viewportTransform = [a, b, c, d, e, f] represents:
  //   [ a  c  e ]
  //   [ b  d  f ]
  //   [ 0  0  1 ]
  // so: screenX = a*cx + c*cy + e,  screenY = b*cx + d*cy + f
  const [a, b, c, d, e, f] = viewportTransform;
  const screenX = a * peer.cursor.x + c * peer.cursor.y + e;
  const screenY = b * peer.cursor.x + d * peer.cursor.y + f;

  return (
    <div
      className={`GhostCursor ${active ? 'GhostCursor--active' : 'GhostCursor--idle'}`}
      style={{ left: screenX, top: screenY }}
      data-testid={`ghost-cursor-${peer.id}`}
    >
      <div
        className="GhostCursor-dot"
        style={{ backgroundColor: color }}
        data-testid={`ghost-cursor-dot-${peer.id}`}
      />
      {label && (
        <span className="GhostCursor-label">{label}</span>
      )}
    </div>
  );
}

export function GhostCursorLayer({ peers, operators, viewportTransform }: Props) {
  const peersWithCursor = peers.filter((p) => p.cursor !== null);
  if (peersWithCursor.length === 0) return null;

  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}
      aria-hidden="true"
    >
      {peersWithCursor.map((peer) => {
        const op = operators.find((o) => o.id === peer.operatorId);
        return (
          <GhostCursor
            key={peer.id}
            peer={peer}
            color={op?.color ?? FALLBACK_COLOR}
            label={op?.name ?? ''}
            viewportTransform={viewportTransform}
          />
        );
      })}
    </div>
  );
}
