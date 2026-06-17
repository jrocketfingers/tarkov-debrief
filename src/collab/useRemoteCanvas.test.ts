// Tests for useRemoteCanvas — remote delta application.
//
// Covers: delta:added, delta:modified, delta:removed, snapshot apply,
// snapshot buffering (R1), idempotency guards, stale-ts check, and the
// isApplyingRemote flag.
//
// Design reference: claudedocs/design_p3_multiplayer.md §7

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fabric from 'fabric';
import { useRemoteCanvas } from './useRemoteCanvas';
import { isApplyingRemote } from './remoteFlag';
import type { InboundMessage } from './protocol';

// vi.mock is hoisted before imports by Vitest — it replaces the fabric module
// with a new object that HAS configurable properties, allowing per-test
// mockImplementation overrides without the ESM "namespace not configurable" error.
vi.mock('fabric', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fabric')>();
  return {
    ...actual,
    util: {
      ...actual.util,
      // Default: copy each input object (preserving __id and other custom props).
      enlivenObjects: vi.fn(async (objs: Record<string, unknown>[]) =>
        objs.map((o) => ({ ...o })),
      ),
    },
  };
});

// ---- Mock canvas helpers ---------------------------------------------------

type FabricObj = Record<string, unknown>;

function makeFabricObj(id: string, extra: Record<string, unknown> = {}): FabricObj {
  return { __id: id, ...extra };
}

function createTrackedCanvas() {
  const objects: FabricObj[] = [];
  const canvas = {
    add: vi.fn((obj: FabricObj) => { objects.push(obj); }),
    remove: vi.fn((obj: FabricObj) => {
      const idx = objects.indexOf(obj);
      if (idx >= 0) objects.splice(idx, 1);
    }),
    getObjects: vi.fn(() => [...objects] as FabricObj[]),
    requestRenderAll: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { canvas, objects };
}

function asCanvas(c: ReturnType<typeof createTrackedCanvas>['canvas']): fabric.Canvas {
  return c as unknown as fabric.Canvas;
}

// ---- Mock room helpers -----------------------------------------------------

function createMockRoom() {
  const handlers = new Set<(msg: InboundMessage) => void>();
  const onMessage = vi.fn((handler: (msg: InboundMessage) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  });
  const dispatch = (msg: InboundMessage) => handlers.forEach((h) => h(msg));
  return { onMessage, dispatch };
}

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  // Reset the mock to its default pass-through implementation before each test.
  vi.mocked(fabric.util.enlivenObjects).mockReset();
  vi.mocked(fabric.util.enlivenObjects).mockImplementation(
    async (objs: Record<string, unknown>[]) =>
      objs.map((o) => ({ ...o } as unknown as fabric.FabricObject)),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- delta:added -----------------------------------------------------------

describe('delta:added', () => {
  it('enlivens the object and adds it to the canvas', async () => {
    const { canvas } = createTrackedCanvas();
    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    await act(async () => {
      dispatch({
        type: 'delta:added',
        peerId: 'bob',
        obj: { __id: 'abc', type: 'rect' },
        ts: 1,
      });
    });

    expect(canvas.add).toHaveBeenCalledOnce();
    const added = (canvas.add as ReturnType<typeof vi.fn>).mock.calls[0][0] as FabricObj;
    expect(added.__id).toBe('abc');
  });

  it('does not double-add when the object is already on canvas', async () => {
    const { canvas, objects } = createTrackedCanvas();
    // Pre-populate with an object that has the same __id.
    const existing = makeFabricObj('abc');
    objects.push(existing);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    await act(async () => {
      dispatch({
        type: 'delta:added',
        peerId: 'bob',
        obj: { __id: 'abc', type: 'rect' },
        ts: 1,
      });
    });

    expect(canvas.add).not.toHaveBeenCalled();
  });

  it('does not add if canvas unmounts before enlivenObjects resolves', async () => {
    const { canvas } = createTrackedCanvas();
    const { onMessage, dispatch } = createMockRoom();
    let resolveEnliven!: (v: fabric.FabricObject[]) => void;
    vi.mocked(fabric.util.enlivenObjects).mockImplementationOnce(
      () =>
        new Promise<fabric.FabricObject[]>((res) => {
          resolveEnliven = res;
        }),
    );

    const { unmount } = renderHook(() =>
      useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()),
    );

    act(() => {
      dispatch({ type: 'delta:added', peerId: 'bob', obj: { __id: 'lateAdd' }, ts: 1 });
    });

    unmount(); // effect cleanup runs — sets active = false

    await act(async () => {
      resolveEnliven([makeFabricObj('lateAdd') as unknown as fabric.FabricObject]);
    });

    expect(canvas.add).not.toHaveBeenCalled();
  });
});

// ---- delta:modified --------------------------------------------------------

describe('delta:modified', () => {
  it('applies a transform patch in-place for non-group objects', async () => {
    const target: FabricObj = {
      __id: 'tgt',
      set: vi.fn(),
      setCoords: vi.fn(),
    };
    const { canvas } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockReturnValue([target]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({
        type: 'delta:modified',
        peerId: 'bob',
        id: 'tgt',
        isGroup: false,
        patch: { left: 50, top: 100 },
        ts: 999,
      });
    });

    expect((target.set as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ left: 50, top: 100 });
    expect((target.setCoords as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('swaps the object for group modify via enlivenObjects', async () => {
    // msg.isGroup=true drives the group-swap path; instanceof check is in the
    // broadcast sender, not the receiver. The receiver branches purely on the flag.
    const oldObj = makeFabricObj('grp');
    const { canvas, objects } = createTrackedCanvas();
    objects.push(oldObj);
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockImplementation(() => [...objects]);

    const newObj = makeFabricObj('grp', { type: 'group' });
    vi.mocked(fabric.util.enlivenObjects).mockResolvedValueOnce([
      newObj as unknown as fabric.FabricObject,
    ]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    await act(async () => {
      dispatch({
        type: 'delta:modified',
        peerId: 'bob',
        id: 'grp',
        isGroup: true,
        patch: { __id: 'grp', type: 'group' },
        ts: 999,
      });
    });

    expect(canvas.remove).toHaveBeenCalledWith(oldObj);
    expect(canvas.add).toHaveBeenCalledWith(newObj);
  });

  it('skips stale modify when incoming ts ≤ local __lastModifiedTs', () => {
    const target: FabricObj = {
      __id: 'tgt',
      __lastModifiedTs: 1000,
      set: vi.fn(),
      setCoords: vi.fn(),
    };
    const { canvas } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockReturnValue([target]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({
        type: 'delta:modified',
        peerId: 'bob',
        id: 'tgt',
        isGroup: false,
        patch: { left: 10 },
        ts: 500, // older than local 1000
      });
    });

    expect((target.set as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('is a no-op when object id not found', () => {
    const { canvas } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({
        type: 'delta:modified',
        peerId: 'bob',
        id: 'missing',
        isGroup: false,
        patch: { left: 0 },
        ts: 1,
      });
    });

    expect(canvas.remove).not.toHaveBeenCalled();
    expect(canvas.add).not.toHaveBeenCalled();
  });
});

// ---- delta:removed ---------------------------------------------------------

describe('delta:removed', () => {
  it('removes the target object from canvas', () => {
    const target = makeFabricObj('del');
    const { canvas, objects } = createTrackedCanvas();
    objects.push(target);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({ type: 'delta:removed', peerId: 'bob', id: 'del', ts: 1 });
    });

    expect(canvas.remove).toHaveBeenCalledWith(target);
  });

  it('is a no-op for an unknown id', () => {
    const { canvas } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({ type: 'delta:removed', peerId: 'bob', id: 'nope', ts: 1 });
    });

    expect(canvas.remove).not.toHaveBeenCalled();
  });
});

// ---- snapshot --------------------------------------------------------------

describe('snapshot', () => {
  it('clears annotation objects and adds snapshot objects', async () => {
    const existing = makeFabricObj('old');
    const { canvas, objects } = createTrackedCanvas();
    objects.push(existing);
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockImplementation(() => [...objects]);

    const snapObj = makeFabricObj('snap1');
    vi.mocked(fabric.util.enlivenObjects).mockResolvedValueOnce([
      snapObj as unknown as fabric.FabricObject,
    ]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    await act(async () => {
      dispatch({
        type: 'snapshot',
        canvas: [{ __id: 'snap1' }],
        peers: [],
        seq: 1,
      });
    });

    expect(canvas.remove).toHaveBeenCalledWith(existing);
    expect(canvas.add).toHaveBeenCalledWith(snapObj);
  });

  it('does not add duplicate objects if they arrived via delta before enliven resolved', async () => {
    const { canvas, objects } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockImplementation(() => [...objects]);

    // Simulate a delta:added that arrives during the async enliven gap by
    // adding the object to `objects` before the mock promise resolves.
    let resolveEnliven!: (v: fabric.FabricObject[]) => void;
    vi.mocked(fabric.util.enlivenObjects).mockImplementationOnce(
      () =>
        new Promise<fabric.FabricObject[]>((res) => {
          resolveEnliven = res;
        }),
    );

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({ type: 'snapshot', canvas: [{ __id: 'dup' }], peers: [], seq: 1 });
    });

    // Simulate the object being added to the canvas (e.g. via a buffered delta)
    // before resolveEnliven fires.
    objects.push(makeFabricObj('dup'));

    await act(async () => {
      resolveEnliven([makeFabricObj('dup') as unknown as fabric.FabricObject]);
    });

    // canvas.add should NOT have been called because the object was already there.
    expect(canvas.add).not.toHaveBeenCalled();
  });
});

// ---- snapshot buffering (R1) -----------------------------------------------

describe('snapshot buffering', () => {
  it('buffers delta:added that arrives during snapshot enliven and drains after', async () => {
    const { canvas, objects } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockImplementation(() => [...objects]);

    let resolveSnapshot!: (v: fabric.FabricObject[]) => void;
    vi.mocked(fabric.util.enlivenObjects)
      // First call: snapshot enliven — hold until we resolve manually.
      .mockImplementationOnce(
        () =>
          new Promise<fabric.FabricObject[]>((res) => {
            resolveSnapshot = res;
          }),
      )
      // Second call: the buffered delta:added enliven.
      .mockImplementationOnce(async (objs: Record<string, unknown>[]) =>
        objs.map((o) => ({ ...o } as unknown as fabric.FabricObject)),
      );

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({ type: 'snapshot', canvas: [], peers: [], seq: 1 });
    });

    // Delta arrives WHILE snapshot is pending — must be buffered, not applied.
    act(() => {
      dispatch({ type: 'delta:added', peerId: 'bob', obj: { __id: 'buffered' }, ts: 2 });
    });

    // Still zero canvas.add calls because snapshot is still pending.
    expect(canvas.add).not.toHaveBeenCalled();

    // Now resolve the snapshot enliven.
    await act(async () => {
      resolveSnapshot([]);
    });

    // After drain, the buffered delta:added should have been applied.
    expect(canvas.add).toHaveBeenCalledOnce();
    const added = (canvas.add as ReturnType<typeof vi.fn>).mock.calls[0][0] as FabricObj;
    expect(added.__id).toBe('buffered');
  });
});

// ---- isApplyingRemote flag -------------------------------------------------

describe('isApplyingRemote', () => {
  it('is false outside of a delta apply', () => {
    expect(isApplyingRemote()).toBe(false);
  });

  it('is false after a synchronous delta:removed completes', () => {
    const target = makeFabricObj('x');
    const { canvas } = createTrackedCanvas();
    (canvas.getObjects as ReturnType<typeof vi.fn>).mockReturnValue([target]);

    const { onMessage, dispatch } = createMockRoom();
    renderHook(() => useRemoteCanvas(asCanvas(canvas), { onMessage }, new Set()));

    act(() => {
      dispatch({ type: 'delta:removed', peerId: 'bob', id: 'x', ts: 1 });
    });

    // After the synchronous delta apply, the flag must be cleared.
    expect(isApplyingRemote()).toBe(false);
  });
});

// ---- R13: serialize → enlivenObjects round-trip ----------------------------

describe('serialize → enlivenObjects round-trip (R13)', () => {
  it('custom props survive a toObject → enlivenObjects cycle', async () => {
    // Use the real enlivenObjects for this test (pass-through still needed
    // since the mock default is already a copy — but we use a real Rect here).
    const actual = await vi.importActual<typeof import('fabric')>('fabric');
    vi.mocked(fabric.util.enlivenObjects).mockImplementation(
      actual.util.enlivenObjects.bind(actual.util),
    );

    const rect = new actual.Rect({ width: 10, height: 10, left: 0, top: 0 });
    (rect as any).__id = 'r1';
    (rect as any).__operatorId = 'alpha';
    (rect as any).__phase = 'plan';

    const serialized = (rect as any).toObject(['__id', '__operatorId', '__phase']);
    const [revived] = await actual.util.enlivenObjects([serialized]);

    expect((revived as any).__id).toBe('r1');
    expect((revived as any).__operatorId).toBe('alpha');
    expect((revived as any).__phase).toBe('plan');
  });
});
