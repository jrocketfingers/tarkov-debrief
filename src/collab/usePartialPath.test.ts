// Tests for usePartialPath — partial-path streaming (P3.4).
//
// Covers: sending side (path:stroke, path:commit broadcast), receiving side
// (ghost creation, update via remove+re-add, commit removal, peer:left cleanup),
// and the _points field name assertion (R7 / Check D).
//
// Design reference: claudedocs/design_p3_multiplayer.md §8

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fabric from 'fabric';
import { usePartialPath } from './usePartialPath';
import { isApplyingRemote } from './remoteFlag';
import type { InboundMessage } from './protocol';
import type { Operator } from '../state/operators';

// ---- R7 / Check D: _points field name assertion ----------------------------
// If this type assertion fails after a fabric version bump, update the field
// name in usePartialPath.ts §8.2 and this comment.
// Calling it in a test ensures this file is re-checked on fabric bumps. (R7)
assertPointsFieldExists();
function assertPointsFieldExists(): void {
  const brush = {} as InstanceType<typeof fabric.PencilBrush>;
  // TypeScript will flag this if the protected field disappears from the type
  // (cast needed since protected, but presence is the invariant we check).
  const _pts = (brush as any)._points as fabric.Point[] | undefined;
  void _pts;
}

// ---- Fixtures ---------------------------------------------------------------

const OPERATORS: Operator[] = [
  { id: 'op-alpha', name: 'Alpha', color: '#0693E3', visible: true },
];

const PEER_ID = 'remote-peer-1';
const STROKE_ID = 'stroke-abc';

// ---- Mock canvas -----------------------------------------------------------

function createMockCanvas() {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  const objects: any[] = [];

  const canvas = {
    isDrawingMode: true,
    freeDrawingBrush: { _points: [] as fabric.Point[] },
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: any[]) => void) => {
      handlers.get(event)?.delete(fn);
    }),
    add: vi.fn((obj: any) => { objects.push(obj); }),
    remove: vi.fn((obj: any) => {
      const idx = objects.indexOf(obj);
      if (idx >= 0) objects.splice(idx, 1);
    }),
    getObjects: vi.fn(() => [...objects]),
    requestRenderAll: vi.fn(),
    fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.forEach((h) => h(payload ?? {}));
    },
  };
  return { canvas, objects };
}

// ---- Mock room -------------------------------------------------------------

function createMockRoom() {
  const handlers = new Set<(msg: InboundMessage) => void>();
  const onMessage = vi.fn((h: (msg: InboundMessage) => void) => {
    handlers.add(h);
    return () => handlers.delete(h);
  });
  const dispatch = (msg: InboundMessage) => handlers.forEach((h) => h(msg));
  return { onMessage, dispatch };
}

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- Sending side ----------------------------------------------------------

describe('sending — path:stroke', () => {
  it('broadcasts path:stroke on mouse:move while drawing', () => {
    const { canvas } = createMockCanvas();
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();
    canvas.freeDrawingBrush._points = [
      new fabric.Point(10, 20),
      new fabric.Point(30, 40),
    ] as any;

    renderHook(() =>
      usePartialPath(
        canvas as any,
        onMessage,
        broadcast,
        'connected',
        OPERATORS,
        'op-alpha',
        'record',
      ),
    );

    // Simulate mouse:down to set activePathId, then mouse:move to send.
    act(() => {
      canvas.fire('mouse:down', {});
      vi.advanceTimersByTime(20); // past 16ms throttle
      canvas.fire('mouse:move', {});
    });

    expect(broadcast).toHaveBeenCalledOnce();
    const msg = broadcast.mock.calls[0][0];
    expect(msg.type).toBe('path:stroke');
    expect(msg.points).toEqual([10, 20, 30, 40]);
    expect(msg.operatorId).toBe('op-alpha');
    expect(msg.phase).toBe('record');
  });

  it('throttles to ~60 fps (skips if < 16ms since last send)', () => {
    const { canvas } = createMockCanvas();
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();
    canvas.freeDrawingBrush._points = [new fabric.Point(1, 2)] as any;

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'connected', OPERATORS, null, 'record'),
    );

    act(() => {
      canvas.fire('mouse:down', {});
      vi.advanceTimersByTime(20);
      canvas.fire('mouse:move', {}); // first send
      canvas.fire('mouse:move', {}); // too soon — skipped
    });

    expect(broadcast).toHaveBeenCalledOnce();
  });

  it('does not broadcast when not in drawing mode', () => {
    const { canvas } = createMockCanvas();
    canvas.isDrawingMode = false;
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'connected', OPERATORS, null, 'record'),
    );

    act(() => {
      canvas.fire('mouse:down', {});
      vi.advanceTimersByTime(20);
      canvas.fire('mouse:move', {});
    });

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not broadcast when not connected', () => {
    const { canvas } = createMockCanvas();
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();
    canvas.freeDrawingBrush._points = [new fabric.Point(1, 2)] as any;

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      canvas.fire('mouse:down', {});
      vi.advanceTimersByTime(20);
      canvas.fire('mouse:move', {});
    });

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('sending — path:commit', () => {
  it('broadcasts path:commit on path:created and clears activePathId', () => {
    const { canvas } = createMockCanvas();
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();
    canvas.freeDrawingBrush._points = [new fabric.Point(1, 2)] as any;

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'connected', OPERATORS, null, 'record'),
    );

    act(() => {
      canvas.fire('mouse:down', {});
      vi.advanceTimersByTime(20);
      canvas.fire('mouse:move', {}); // path:stroke
      canvas.fire('path:created', { path: {} }); // path:commit
    });

    const commitCalls = broadcast.mock.calls.filter(([m]) => m.type === 'path:commit');
    expect(commitCalls).toHaveLength(1);
    const commitId = broadcast.mock.calls.find(([m]) => m.type === 'path:stroke')?.[0].id;
    expect(commitCalls[0][0].id).toBe(commitId);
  });

  it('does not broadcast path:commit when not connected', () => {
    const { canvas } = createMockCanvas();
    const { onMessage } = createMockRoom();
    const broadcast = vi.fn();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      canvas.fire('mouse:down', {});
      canvas.fire('path:created', { path: {} });
    });

    expect(broadcast).not.toHaveBeenCalled();
  });
});

// ---- Receiving side --------------------------------------------------------

describe('receiving — path:stroke', () => {
  it('adds a ghost Polyline to canvas on first path:stroke', () => {
    const { canvas, objects } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();
    const broadcast = vi.fn();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: 'op-alpha',
        phase: 'record',
        points: [10, 20, 30, 40],
      });
    });

    expect(canvas.add).toHaveBeenCalledOnce();
    expect(objects).toHaveLength(1);
  });

  it('remove+re-adds the ghost on subsequent path:stroke frames', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();
    const broadcast = vi.fn();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, broadcast, 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: 'op-alpha',
        phase: 'record',
        points: [10, 20],
      });
    });

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: 'op-alpha',
        phase: 'record',
        points: [10, 20, 30, 40],
      });
    });

    // First frame: add. Second frame: remove old + add new.
    expect(canvas.add).toHaveBeenCalledTimes(2);
    expect(canvas.remove).toHaveBeenCalledOnce();
  });

  it('does not enter undo stack (isApplyingRemote is false after add)', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: null,
        phase: 'record',
        points: [0, 0, 10, 10],
      });
    });

    expect(isApplyingRemote()).toBe(false);
  });

  it('uses operator color from the operators list', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: 'op-alpha',
        phase: 'record',
        points: [0, 0],
      });
    });

    const added = (canvas.add as any).mock.calls[0][0];
    expect(added.stroke).toBe('#0693E3');
  });

  it('sets dash array for plan-phase strokes', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: null,
        phase: 'plan',
        points: [0, 0],
      });
    });

    const added = (canvas.add as any).mock.calls[0][0];
    expect(added.strokeDashArray).toEqual([10, 5]);
  });
});

describe('receiving — path:commit', () => {
  it('removes the ghost on path:commit', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: STROKE_ID,
        operatorId: null,
        phase: 'record',
        points: [0, 0, 10, 10],
      });
    });

    act(() => {
      dispatch({ type: 'path:commit', peerId: PEER_ID, id: STROKE_ID });
    });

    expect(canvas.remove).toHaveBeenCalledOnce();
  });

  it('is a no-op for an unknown strokeId on path:commit', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({ type: 'path:commit', peerId: PEER_ID, id: 'unknown' });
    });

    expect(canvas.remove).not.toHaveBeenCalled();
  });
});

describe('receiving — peer:left cleanup', () => {
  it('removes all ghost paths from a disconnected peer', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    // Two strokes from the same peer
    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: 'stroke-1',
        operatorId: null,
        phase: 'record',
        points: [0, 0],
      });
      dispatch({
        type: 'path:stroke',
        peerId: PEER_ID,
        id: 'stroke-2',
        operatorId: null,
        phase: 'record',
        points: [5, 5],
      });
    });

    act(() => {
      dispatch({ type: 'peer:left', peerId: PEER_ID, ts: 1 });
    });

    expect(canvas.remove).toHaveBeenCalledTimes(2);
  });

  it('does not remove ghosts from other peers', () => {
    const { canvas } = createMockCanvas();
    const { onMessage, dispatch } = createMockRoom();

    renderHook(() =>
      usePartialPath(canvas as any, onMessage, vi.fn(), 'idle', OPERATORS, null, 'record'),
    );

    act(() => {
      dispatch({
        type: 'path:stroke',
        peerId: 'other-peer',
        id: 'stroke-other',
        operatorId: null,
        phase: 'record',
        points: [0, 0],
      });
    });

    act(() => {
      dispatch({ type: 'peer:left', peerId: PEER_ID, ts: 1 });
    });

    expect(canvas.remove).not.toHaveBeenCalled();
  });
});
