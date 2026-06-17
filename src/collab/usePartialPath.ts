/* eslint-disable @typescript-eslint/no-explicit-any */
// Partial-path streaming for P3.4 — live "ink on paper" effect while a peer
// draws.
//
// Sending side: on every mouse:move during a freehand stroke, reads the brush's
// _points array and broadcasts a path:stroke message (~60 fps). On path:created,
// broadcasts path:commit so remote peers remove the ghost.
//
// Receiving side: maintains a per-peer ghost Polyline registry. Creates a new
// Polyline on the first path:stroke for each strokeId; removes and re-creates it
// on each subsequent point update (Check C: Polyline.set({ points }) alone does
// not recalculate pathOffset, causing drift as the path grows — remove+re-add is
// the correct approach per design_p3_multiplayer.md §8.3). Removes the ghost on
// path:commit or peer:left.
//
// All canvas mutations on the receiving side go through setApplyingRemote so they
// bypass the undo stack and the broadcast effect. §7.1
//
// Design reference: claudedocs/design_p3_multiplayer.md §8

import * as fabric from 'fabric';
import { useEffect, useRef } from 'react';
import { setApplyingRemote } from './remoteFlag';
import type { BroadcastMessage, InboundMessage } from './protocol';
import type { Operator } from '../state/operators';
import type { OperatorId } from '../state/operators';
import type { Phase } from '../state/phase';

// Fallback stroke color when a peer has no claimed operator. §8.3
const PENCIL_COLOR = '#f00';

// Sync wrapper: sets the applyingRemote flag for the duration of fn so canvas
// mutations bypass the undo stack and broadcast effect. Mirrors withRemote in
// useRemoteCanvas but defined locally to avoid cross-module coupling.
function withRemote(fn: () => void): void {
  setApplyingRemote(true);
  try {
    fn();
  } finally {
    setApplyingRemote(false);
  }
}

type GhostOpts = {
  stroke: string;
  strokeWidth: number;
  strokeDashArray: number[] | undefined;
};

// Options preserved across remove+re-add so the ghost keeps its appearance on
// each point update. §8.3
function makeGhostOpts(operatorColor: string, phase: 'plan' | 'record'): GhostOpts {
  return {
    stroke: operatorColor,
    strokeWidth: 2,
    strokeDashArray: phase === 'plan' ? [10, 5] : undefined,
  };
}

function createGhost(
  points: fabric.Point[],
  opts: GhostOpts,
  peerId: string,
  ghostId: string,
): fabric.Polyline {
  const ghost = new fabric.Polyline(
    points.map((p) => ({ x: p.x, y: p.y })),
    {
      stroke: opts.stroke,
      strokeWidth: opts.strokeWidth,
      fill: 'transparent',
      evented: false,
      selectable: false,
      strokeDashArray: opts.strokeDashArray,
      // Prevent the ghost from appearing in exports or the replay timeline.
      excludeFromExport: true,
    },
  );
  // __peerId is required for peer:left cleanup. §8.4
  // __ghostId is used to match path:commit messages. §8.3
  (ghost as any).__peerId = peerId;
  (ghost as any).__ghostId = ghostId;
  return ghost;
}

export function usePartialPath(
  canvas: fabric.Canvas | null,
  onRoomMessage: (handler: (msg: InboundMessage) => void) => () => void,
  broadcast: (msg: BroadcastMessage) => void,
  // Accepts string (not the relay RoomStatus union) so both the relay and P2P
  // hooks can pass their status. The only check is === 'connected'. §6.1
  roomStatus: string,
  operators: Operator[],
  activeOperatorId: OperatorId | null,
  phase: Phase,
): void {
  // Ref-mirrors so event handlers always read the current value without
  // needing to re-register (ref-mirror pattern, same as useFreehand). §3.3
  const statusRef = useRef(roomStatus);
  statusRef.current = roomStatus;
  const operatorIdRef = useRef(activeOperatorId);
  operatorIdRef.current = activeOperatorId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const operatorsRef = useRef(operators);
  operatorsRef.current = operators;
  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;

  useEffect(() => {
    if (!canvas) return;
    const cv = canvas;
    let active = true;

    // ---- Sending side -------------------------------------------------------

    // Unique ID per in-progress stroke; set on mouse:down, cleared on
    // path:created. Remote peers use it to match path:stroke frames to their
    // ghost and path:commit to the final delta:added. §8.2
    const activePathId = { current: null as string | null };
    let lastSend = 0;
    // How many brush points were included in the last broadcast. Each frame we
    // send only pts.slice(lastSentCount) so the receiver accumulates them
    // rather than retransmitting the entire growing array. §8.2 bandwidth opt.
    let lastSentCount = 0;

    const onMouseDown = () => {
      if (!cv.isDrawingMode) return;
      activePathId.current = crypto.randomUUID();
      lastSentCount = 0;
    };

    const onMouseMove = () => {
      if (!cv.isDrawingMode) return;
      if (!activePathId.current) return;
      if (statusRef.current !== 'connected') return;

      const now = Date.now();
      if (now - lastSend < 33) return; // ~30 fps cap (was 16 ms / 60 fps)
      lastSend = now;

      // _points is a protected field on PencilBrush (fabric v7 line 43 of
      // PencilBrush.ts: `declare protected _points: Point[]`). Access via cast.
      // R7: verify field name on fabric version bumps; see test file assertion.
      const brush = cv.freeDrawingBrush;
      const pts = (brush as any)._points as fabric.Point[] | undefined;
      if (!pts?.length) return;

      // Delta-only: send only points added since the last frame. The receiver
      // appends them to a per-stroke accumulator so the ghost always reflects
      // the full stroke. Avoids re-transmitting the entire growing array.
      const newPts = pts.slice(lastSentCount);
      if (newPts.length === 0) return;
      lastSentCount = pts.length;

      broadcastRef.current({
        type: 'path:stroke',
        id: activePathId.current,
        operatorId: operatorIdRef.current,
        phase: phaseRef.current,
        // Round to 1 decimal — sub-pixel precision not needed for ghost rendering.
        points: newPts.flatMap((p) => [
          Math.round(p.x * 10) / 10,
          Math.round(p.y * 10) / 10,
        ]),
      });
    };

    const onPathCreated = () => {
      const id = activePathId.current;
      if (!id) return;
      activePathId.current = null;
      lastSentCount = 0;
      if (statusRef.current !== 'connected') return;
      // delta:added for the committed object is broadcast by the App.tsx
      // broadcast effect on the object:added event — no duplication needed.
      broadcastRef.current({ type: 'path:commit', id });
    };

    cv.on('mouse:down', onMouseDown);
    cv.on('mouse:move', onMouseMove);
    cv.on('path:created', onPathCreated);

    // ---- Receiving side -----------------------------------------------------

    // Ghost path registry: strokeId → { ghost, opts }.
    // Opts are preserved so remove+re-add doesn't need to re-derive them.
    const ghostPaths = new Map<string, { ghost: fabric.Polyline; opts: GhostOpts }>();
    // Accumulated points per stroke. The sender now broadcasts delta-only
    // points each frame (only new points since the last send), so we must
    // append them here to reconstruct the full stroke for each ghost update.
    const strokePoints = new Map<string, fabric.Point[]>();

    const unsub = onRoomMessage((msg) => {
      if (!active) return;

      if (msg.type === 'path:stroke') {
        // msg.points is delta-only — deserialize and append to accumulator.
        const newPts: fabric.Point[] = [];
        for (let i = 0; i + 1 < msg.points.length; i += 2) {
          newPts.push(new fabric.Point(msg.points[i], msg.points[i + 1]));
        }
        if (newPts.length === 0) return;

        const acc = strokePoints.get(msg.id);
        let allPoints: fabric.Point[];
        if (!acc) {
          strokePoints.set(msg.id, newPts);
          allPoints = newPts;
        } else {
          for (const p of newPts) acc.push(p);
          allPoints = acc;
        }

        const entry = ghostPaths.get(msg.id);

        if (!entry) {
          // First frame for this stroke: create the ghost.
          const op = operatorsRef.current.find((o) => o.id === msg.operatorId);
          const opts = makeGhostOpts(op?.color ?? PENCIL_COLOR, msg.phase);
          const ghost = createGhost(allPoints, opts, msg.peerId, msg.id);
          ghostPaths.set(msg.id, { ghost, opts });
          withRemote(() => {
            cv.add(ghost);
            cv.requestRenderAll();
          });
        } else {
          // Subsequent frame: remove + re-add with updated points.
          // Plain set({ points }) leaves pathOffset stale and causes visual
          // drift as the path grows beyond its initial bounding box. §8.3 Check C
          const newGhost = createGhost(allPoints, entry.opts, msg.peerId, msg.id);
          withRemote(() => {
            cv.remove(entry.ghost);
            cv.add(newGhost);
            cv.requestRenderAll();
          });
          entry.ghost = newGhost;
        }
        return;
      }

      if (msg.type === 'path:commit') {
        const entry = ghostPaths.get(msg.id);
        if (entry) {
          withRemote(() => {
            cv.remove(entry.ghost);
            cv.requestRenderAll();
          });
          ghostPaths.delete(msg.id);
        }
        strokePoints.delete(msg.id);
        // delta:added for the final path arrives shortly after via the
        // drawing peer's App.tsx broadcast effect. §8.3
        return;
      }

      if (msg.type === 'peer:left') {
        let changed = false;
        for (const [id, { ghost }] of ghostPaths) {
          if ((ghost as any).__peerId === msg.peerId) {
            // __peerId set at creation — without it this cleanup silently
            // no-ops. §8.4, design doc §0b correction.
            withRemote(() => cv.remove(ghost));
            ghostPaths.delete(id);
            strokePoints.delete(id);
            changed = true;
          }
        }
        if (changed) cv.requestRenderAll();
      }
    });

    return () => {
      active = false;
      cv.off('mouse:down', onMouseDown);
      cv.off('mouse:move', onMouseMove);
      cv.off('path:created', onPathCreated);
      unsub();
      // Remove any in-flight ghost paths on cleanup (e.g., room leave
      // mid-stroke, canvas unmount).
      for (const { ghost } of ghostPaths.values()) {
        cv.remove(ghost);
      }
      ghostPaths.clear();
      strokePoints.clear();
    };
  // broadcast is stable via useCallback; onRoomMessage is stable (empty deps).
  // Remaining deps are ref-mirrored so we never re-register the handlers.
  }, [canvas, onRoomMessage]);
}
