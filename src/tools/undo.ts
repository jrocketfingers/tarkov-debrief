// Undo: the data side of the action stack.
//
// What stays here (P0): the stack itself, the
// object:added/object:removed subscriptions that populate it, the
// REPLAY sentinel that prevents undo from feeding itself, and the
// onUndo callback.
//
// What moved out (P0): the window keydown listener. Cmd/Ctrl+Z is
// bound through useKeyboardShortcuts in App.tsx — see
// src/hooks/useKeyboardShortcuts.ts. The migration is atomic
// (design doc §4.6): if both listeners are ever live at the same
// time, undo will double-fire.
//
// What's new in P1 (design doc §4.10):
//   - TRANSIENT sentinel parallel to REPLAY. Callers tag objects
//     with `__transient = true` to suppress object:added /
//     object:removed recording. Used by preview objects (cone drag,
//     sightline rotation), the arrow path→group swap, and the
//     text-empty-add path. Cleared explicitly via unmarkTransient
//     when the caller is ready for normal recording.
//   - `modify` action variant carrying before/after serialized
//     state. Pushed when object:modified fires on a mark whose
//     spec exposes serialize/deserialize.
//   - selection:created snapshots the pre-edit state into a WeakMap
//     so the subsequent object:modified knows what `before` is.
//   - Public API additions: markTransient, unmarkTransient,
//     popLastAction, recordAdd, recordRemove. See returned object
//     at the bottom of the hook.
//
// Design references:
//   - claudedocs/design_p0_slice.md §4.6 (keyboard migration)
//   - claudedocs/design_p1_slice.md §4.10 (P1 extension)

import * as fabric from "fabric";
import { useCallback, useEffect, useRef } from "react";
import { getSpecByMarkType } from "./marks/registry";
import { readMarkType } from "./metadata";
import type { SerializedState } from "./marks/types";
import { isApplyingRemote } from "../collab/remoteFlag";

type Action =
  | { type: "add"; object: fabric.FabricObject }
  | { type: "remove"; object: fabric.FabricObject }
  | {
      type: "modify";
      object: fabric.FabricObject;
      before: SerializedState;
      after: SerializedState;
    };

// Sentinel attached to fabric objects during an undo replay so the
// object:added / object:removed listeners don't push the replay
// action back onto the stack (which would create an infinite ping-
// pong). Same pattern as the metadata helpers in tools/metadata.ts.
export const REPLAY = "__undoReplay" as const;

// Sentinel attached by callers (preview code, arrow postprocess,
// text init) to suppress recording of a specific object's add/remove
// events. Distinct from REPLAY: REPLAY is automatic and short-lived
// (set/cleared inside onUndo); TRANSIENT is caller-controlled and
// persists until unmarkTransient. See design doc §4.10.
export const TRANSIENT = "__transient" as const;

// Exported so the App.tsx broadcast effect can skip objects that are
// mid-replay or explicitly transient without depending on the hook itself.
// See design_p3_multiplayer.md §7.6 (Check A).
export function isFlagged(obj: fabric.FabricObject, key: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Boolean((obj as any)[key]);
}

function setFlag(obj: fabric.FabricObject, key: string, value: boolean): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (obj as any)[key] = value;
}

// Per-canvas-lifetime structure stored in a ref. We pull this out
// into its own type so the hook body stays readable.
interface UndoState {
  stack: Action[];
  // Pre-edit snapshots captured on selection:created. Keyed by the
  // fabric object identity; cleared on selection:cleared. WeakMap
  // so we don't pin objects in memory if they're erased mid-edit.
  snapshots: WeakMap<fabric.FabricObject, SerializedState>;
}

export const useUndo = (
  canvas: fabric.Canvas | null,
  unerasable: Set<string>,
) => {
  // The stack + snapshot table are stored together so the public
  // API methods (popLastAction, recordAdd, …) can read/mutate them
  // without each one needing its own ref.
  const stateRef = useRef<UndoState>({
    stack: [],
    snapshots: new WeakMap(),
  });

  const onUndo = useCallback(() => {
    if (!canvas) return;
    const action = stateRef.current.stack.pop();
    if (!action) return;

    setFlag(action.object, REPLAY, true);
    try {
      if (action.type === "add") {
        canvas.remove(action.object);
      } else if (action.type === "remove") {
        canvas.add(action.object);
      } else {
        // modify: invoke the mark's deserializer to roll back to
        // the pre-edit state. Lookup happens via the spec registry;
        // if the spec or deserialize is gone (e.g. hot-reloaded
        // away during development), we silently no-op rather than
        // crashing — the user can still continue working.
        const markType = readMarkType(action.object);
        if (markType !== null) {
          const spec = getSpecByMarkType(markType);
          spec?.deserialize?.(action.object, action.before);
        }
      }
    } finally {
      // Always clear REPLAY, even if the canvas op threw — leaving
      // it set would orphan the object out of all future undo
      // tracking.
      setFlag(action.object, REPLAY, false);
    }
    canvas.requestRenderAll();
  }, [canvas]);

  // ---- Public API additions (design doc §4.10) ---------------------

  const markTransient = useCallback((obj: fabric.FabricObject) => {
    setFlag(obj, TRANSIENT, true);
  }, []);

  const unmarkTransient = useCallback((obj: fabric.FabricObject) => {
    setFlag(obj, TRANSIENT, false);
  }, []);

  const popLastAction = useCallback((): Action | null => {
    return stateRef.current.stack.pop() ?? null;
  }, []);

  const recordAdd = useCallback((obj: fabric.FabricObject) => {
    stateRef.current.stack.push({ type: "add", object: obj });
  }, []);

  const recordRemove = useCallback((obj: fabric.FabricObject) => {
    stateRef.current.stack.push({ type: "remove", object: obj });
  }, []);

  useEffect(() => {
    if (!canvas) return;
    const state = stateRef.current;

    const onAdd = ({ target }: { target: fabric.FabricObject }) => {
      // Remote delta: applied by useRemoteCanvas on behalf of a peer.
      // Personal undo only — remote actions must not touch the local stack.
      // See design_p3_multiplayer.md §7.1.
      if (isApplyingRemote()) return;
      // REPLAY: we're mid-undo; this add is the *result* of an
      // earlier remove being undone. Don't re-push.
      if (isFlagged(target, REPLAY)) return;
      // TRANSIENT: caller has explicitly opted out of recording
      // (cone preview, sightline preview, text init, the path
      // half of an arrow swap, …). Skip.
      if (isFlagged(target, TRANSIENT)) return;
      // The loaded map image is in `unerasable` (set up in App.tsx);
      // it must not enter the undo stack or else Ctrl+Z would
      // "undo" the map itself.
      if (target instanceof fabric.Image && unerasable.has(target.getSrc())) {
        return;
      }
      state.stack.push({ type: "add", object: target });
    };

    const onRemove = ({ target }: { target: fabric.FabricObject }) => {
      if (isApplyingRemote()) return;
      if (isFlagged(target, REPLAY)) return;
      if (isFlagged(target, TRANSIENT)) return;
      state.stack.push({ type: "remove", object: target });
    };

    // Direct-manipulation handle drags (Slice K) and any other
    // mutation that fires object:modified gets a `modify` action.
    // The mark spec's serialize/deserialize pair is the source of
    // truth for what "state" means for each mark type; useUndo
    // treats the result opaquely.
    const onModified = ({ target }: { target: fabric.FabricObject }) => {
      if (isApplyingRemote()) return;
      if (isFlagged(target, REPLAY)) return;
      if (isFlagged(target, TRANSIENT)) return;
      const markType = readMarkType(target);
      if (markType === null) return; // P0 freehand stroke — no modify support
      const spec = getSpecByMarkType(markType);
      if (!spec?.serialize || !spec?.deserialize) return;
      const before = state.snapshots.get(target);
      if (before === undefined) {
        // No pre-edit snapshot — this can happen if a modify fires
        // without a prior selection:created (e.g., programmatic
        // mutation). Skip rather than guess.
        return;
      }
      const after = spec.serialize(target);
      // Reference comparison after JSON normalization is the most
      // straightforward "did anything actually change" check for
      // the opaque SerializedState. The blobs are small (a handful
      // of numbers per mark) so the stringify cost is irrelevant.
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      state.stack.push({ type: "modify", object: target, before, after });
      // Update the snapshot to the new baseline so a follow-up edit
      // of the same selection records relative to the new state.
      state.snapshots.set(target, after);
    };

    // Capture pre-edit snapshots for mark-spec-aware objects when
    // they enter selection. Cleared on selection cleared so memory
    // doesn't accumulate selections that were never edited.
    type SelectionEvent = { selected?: fabric.FabricObject[] };
    const onSelectionCreated = (e: SelectionEvent) => {
      const selected = e.selected ?? [];
      for (const obj of selected) {
        const markType = readMarkType(obj);
        if (markType === null) continue;
        const spec = getSpecByMarkType(markType);
        if (!spec?.serialize) continue;
        state.snapshots.set(obj, spec.serialize(obj));
      }
    };
    const onSelectionUpdated = (e: SelectionEvent) => {
      // Treat updated identically to created for snapshot purposes —
      // a multi-select that adds an object should snapshot the new
      // one too.
      onSelectionCreated(e);
    };
    const onSelectionCleared = () => {
      // Snapshots are a WeakMap, so the GC will eventually drop
      // entries whose objects are gone. But for objects that
      // *remain on the canvas* after a selection clears, we want the
      // snapshots cleared too — otherwise a later selection+modify
      // cycle would compare against a stale baseline. WeakMaps
      // don't expose iteration; the workaround is to allocate a
      // fresh WeakMap and let the old one go. Cheap.
      state.snapshots = new WeakMap();
    };

    canvas.on("object:added", onAdd);
    canvas.on("object:removed", onRemove);
    canvas.on("object:modified", onModified);
    canvas.on("selection:created", onSelectionCreated);
    canvas.on("selection:updated", onSelectionUpdated);
    canvas.on("selection:cleared", onSelectionCleared);

    return () => {
      canvas.off("object:added", onAdd);
      canvas.off("object:removed", onRemove);
      canvas.off("object:modified", onModified);
      canvas.off("selection:created", onSelectionCreated);
      canvas.off("selection:updated", onSelectionUpdated);
      canvas.off("selection:cleared", onSelectionCleared);
    };
  }, [canvas, unerasable]);

  return {
    onUndo,
    // P1 additions (§4.10).
    markTransient,
    unmarkTransient,
    popLastAction,
    recordAdd,
    recordRemove,
  };
};

// Public typing of the hook's return shape. Other modules
// (useFreehand's arrow postprocess, the text tool, preview code)
// take this as a parameter so they don't have to depend on the hook
// itself.
export type UndoApi = ReturnType<typeof useUndo>;
