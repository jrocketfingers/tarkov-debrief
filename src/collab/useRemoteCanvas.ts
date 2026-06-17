/* eslint-disable @typescript-eslint/no-explicit-any */
// Applies remote canvas deltas from the WebSocket room to the local fabric
// canvas, bypassing the local undo stack.
//
// Design reference: claudedocs/design_p3_multiplayer.md §7
//
// Key invariants:
//   - All canvas mutations here are wrapped in setApplyingRemote(true/false)
//     or withRemote() so useUndo's listeners and the App.tsx broadcast effect
//     both skip them. See §7.1.
//   - enlivenObjects is fabric v7's Promise-based API — no callbacks. §7.3
//   - Groups (e.g. arrow groups) require full re-enliven on modify; plain
//     objects use an in-place transform patch. §7.4 (R14)
//   - Snapshot application removes existing annotation objects first, then
//     enlivens the snapshot array. loadFromJSON is intentionally avoided
//     because it would also remove the locally-loaded map image. §4.4
//   - Deltas that arrive during the async snapshot enliven are buffered and
//     drained in order after the snapshot resolves. §4.4 (R1)

import * as fabric from 'fabric';
import { useEffect, useRef } from 'react';
import { isApplyingRemote, setApplyingRemote } from './remoteFlag';
import type { InboundMessage } from './protocol';

export { isApplyingRemote };

// Custom property extras fabric must serialize/deserialize on every object.
// Mirrors the extras array used at broadcast time in App.tsx. §4.2
// Typed as string[] (not const-array) because toObject() expects any[].
export const EXTRAS: string[] = ['__id', '__operatorId', '__phase', '__seq', '__markType', '__arrowTip'];

// Sync canvas mutation wrapper. Sets the module flag for the duration of the
// synchronous fn call, then clears it. For async operations (snapshot enliven)
// the caller must manage the flag directly — withRemote cannot span an await.
function withRemote(fn: () => void): void {
  setApplyingRemote(true);
  try {
    fn();
  } finally {
    setApplyingRemote(false);
  }
}

// Minimal room interface required by this hook. Using Pick rather than the
// full UseRoomReturn to keep the dependency surface narrow.
export type RemoteCanvasRoom = {
  onMessage: (handler: (msg: InboundMessage) => void) => () => void;
};

type DeltaMsg =
  | (InboundMessage & { type: 'delta:added' })
  | (InboundMessage & { type: 'delta:modified' })
  | (InboundMessage & { type: 'delta:removed' });

export function useRemoteCanvas(
  canvas: fabric.Canvas | null,
  room: RemoteCanvasRoom,
  unerasable: Set<string>,
): void {
  // Buffer for delta messages that arrive while a snapshot is being applied.
  // fabric.util.enlivenObjects is async, so deltas can queue on the WebSocket
  // before the Promise resolves. We drain in arrival order after the snapshot
  // lands. §4.4 (R1)
  const pendingBufferRef = useRef<DeltaMsg[]>([]);
  const snapshotPendingRef = useRef(false);

  useEffect(() => {
    if (!canvas) return;
    // Capture as non-null so nested functions don't need repeated null checks.
    const cv = canvas;
    // Guard against stale closures after canvas change or unmount. Any
    // in-flight enlivenObjects promises check this before mutating canvas.
    let active = true;

    function applyDelta(msg: DeltaMsg): void {
      if (msg.type === 'delta:added') applyAdded(msg);
      else if (msg.type === 'delta:modified') applyModified(msg);
      else applyRemoved(msg);
    }

    function applyAdded(msg: InboundMessage & { type: 'delta:added' }): void {
      const id = msg.obj.__id as string | undefined;
      if (!id) return;

      // Checks both top-level objects AND group children. Group-child check
      // is needed for the arrow double-broadcast: the raw path (uuid-A) is
      // broadcast before the group swap, so uuid-A ends up as a child of the
      // group (uuid-B). Without the child check, the path's delta:added would
      // pass the guard and add a standalone duplicate. §7.3
      function isPresent(searchId: string): boolean {
        return cv.getObjects().some((o) => {
          if ((o as any).__id === searchId) return true;
          if (o instanceof fabric.Group) {
            return (o as fabric.Group).getObjects().some(
              (c) => (c as any).__id === searchId,
            );
          }
          return false;
        });
      }

      // Sync idempotency guard before the async gap. §7.3
      if (isPresent(id)) return;

      fabric.util.enlivenObjects([msg.obj as Record<string, unknown>]).then((enlivened) => {
        const fabricObj = enlivened[0] as fabric.FabricObject | undefined;
        if (!active) return;
        if (!fabricObj) return;
        // Re-check after async gap: a snapshot or prior delta may have
        // added this object while enlivenObjects was pending. §7.3 (R21)
        if (isPresent(id)) return;

        withRemote(() => {
          // Arrow postprocess double-broadcast: the raw path is broadcast
          // before the group swap. When the group arrives, any top-level
          // object whose __id matches a group child is a stale raw-path
          // duplicate — remove it so only the group remains. §7.3
          if (fabricObj instanceof fabric.Group) {
            for (const child of (fabricObj as fabric.Group).getObjects()) {
              const childId = (child as any).__id as string | undefined;
              if (!childId) continue;
              const stale = cv.getObjects().find(
                (o) => (o as any).__id === childId,
              ) as fabric.FabricObject | undefined;
              if (stale) cv.remove(stale);
            }
          }
          cv.add(fabricObj);
          cv.requestRenderAll();
        });
      });
    }

    function applyModified(msg: InboundMessage & { type: 'delta:modified' }): void {
      const target = cv.getObjects().find((o) => (o as any).__id === msg.id) as fabric.FabricObject | undefined;
      if (!target) return;

      // Client-side stale check. The server already filters stale modifies
      // (§5.3), but a buffered-reconnect flush can replay out of order.
      // last-server-timestamp-wins: skip if the incoming ts ≤ what we have.
      const localTs: number = (target as any).__lastModifiedTs ?? 0;
      if (msg.ts !== undefined && msg.ts <= localTs) return;

      if (msg.isGroup) {
        // Arrow groups and other fabric.Group marks need full re-enliven +
        // swap because their internal path/polygon geometry may have changed —
        // an in-place set() cannot reconstruct group children. §7.4 (R14)
        fabric.util.enlivenObjects([msg.patch as Record<string, unknown>]).then((enlivened) => {
          const newObj = enlivened[0] as fabric.FabricObject | undefined;
          if (!active || !newObj) return;
          // Re-find in case a concurrent delta removed the original.
          const current = cv.getObjects().find((o) => (o as any).__id === msg.id) as fabric.FabricObject | undefined;
          if (!current) return;
          withRemote(() => {
            cv.remove(current);
            cv.add(newObj);
            cv.requestRenderAll();
          });
        });
      } else {
        // Transform-only patch: apply in-place. target.set with only
        // transform props does not fire object:modified (fabric only fires
        // that from user handle interaction), so withRemote is defensive
        // correctness here rather than strictly necessary.
        withRemote(() => {
          (target as any).set(msg.patch);
          target.setCoords();
          (target as any).__lastModifiedTs = msg.ts ?? Date.now();
          cv.requestRenderAll();
        });
      }
    }

    function applyRemoved(msg: InboundMessage & { type: 'delta:removed' }): void {
      const target = cv.getObjects().find((o) => (o as any).__id === msg.id) as fabric.FabricObject | undefined;
      if (!target) return;
      // The map image has no __id so it can't appear in a delta:removed, but
      // guard explicitly to be safe.
      if (target instanceof fabric.Image && unerasable.has(target.getSrc())) return;

      withRemote(() => {
        cv.remove(target);
        cv.requestRenderAll();
      });
    }

    const unsub = room.onMessage((msg) => {
      if (!active) return;

      if (msg.type === 'snapshot') {
        snapshotPendingRef.current = true;
        pendingBufferRef.current = [];

        // Remove existing annotation objects (those tagged with __id).
        // The map image has no __id and stays. withRemote prevents the
        // broadcast effect from echoing these removals back to the room. §4.4 (R17)
        withRemote(() => {
          const toRemove = cv.getObjects().filter((o) => !!(o as any).__id);
          for (const obj of toRemove) cv.remove(obj as fabric.FabricObject);
        });

        // Hold the flag through the entire async enliven so canvas.add
        // calls inside the .then() don't trigger the broadcast effect.
        // (withRemote cannot span an await — we set the flag manually.) §4.4
        setApplyingRemote(true);

        fabric.util.enlivenObjects(msg.canvas as Record<string, unknown>[])
          .then((fabricObjs) => {
            if (!active) {
              setApplyingRemote(false);
              return;
            }
            // Idempotency: deltas buffered during enliven may have already
            // added some of these objects.
            const existingIds = new Set(
              cv
                .getObjects()
                .map((o) => (o as any).__id as string | undefined)
                .filter(Boolean),
            );
            for (const raw of fabricObjs) {
              const obj = raw as fabric.FabricObject;
              const id = (obj as any).__id as string | undefined;
              if (!id || existingIds.has(id)) continue;
              cv.add(obj);
            }
            cv.requestRenderAll();

            setApplyingRemote(false);

            // Drain deltas that arrived while enlivenObjects was pending.
            const buffered = pendingBufferRef.current;
            pendingBufferRef.current = [];
            snapshotPendingRef.current = false;
            for (const bufferedMsg of buffered) {
              applyDelta(bufferedMsg);
            }
          })
          .catch(() => {
            if (!active) return;
            setApplyingRemote(false);
            snapshotPendingRef.current = false;
            pendingBufferRef.current = [];
          });
        return;
      }

      if (
        msg.type === 'delta:added' ||
        msg.type === 'delta:modified' ||
        msg.type === 'delta:removed'
      ) {
        // Buffer if snapshot is in-flight; apply immediately otherwise. §4.4 (R1)
        if (snapshotPendingRef.current) {
          pendingBufferRef.current.push(msg as DeltaMsg);
          return;
        }
        applyDelta(msg as DeltaMsg);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  // room.onMessage is stable (useCallback with empty deps in useRoom). §6.2
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, room.onMessage, unerasable]);
}
