import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useFreehand, type FreehandSpec } from "./useFreehand";
import { asCanvas, createMockCanvas, fire } from "../../test/mockCanvas";
import { Tool, ToolType } from "../tool";
import { readOperator, readPhase, readMarkType } from "../metadata";

// `useFreehand` is the orchestration layer. The interesting paths
// to verify are:
//
//   1. The path:created handler tags operator + phase via the
//      ref-mirror (so a tag taken AFTER an operator switch reflects
//      the new operator, not the captured value at mount).
//   2. spec.markType opts into the tagMarkType call.
//   3. spec.onPathCreated receives the post-tag context.
//   4. canvas.isDrawingMode flips on activation and off on cleanup.
//
// The arrow path→group swap behavior is verified separately in
// arrow.test.ts (Phase 2); here we just confirm the postprocess
// receives the right context.

function baseTool(type: ToolType = ToolType.pencil): Tool {
  return { type, active: false, cursor: null };
}

describe("useFreehand", () => {
  it("activates drawing mode when tool matches", () => {
    const mock = createMockCanvas();
    mock.isDrawingMode = false;
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    renderHook(() =>
      useFreehand(
        asCanvas(mock),
        () => {},
        baseTool(ToolType.pencil),
        spec,
        null,
        "record",
        null,
      ),
    );
    expect(mock.isDrawingMode).toBe(true);
  });

  it("does not activate drawing mode when tool does not match", () => {
    const mock = createMockCanvas();
    mock.isDrawingMode = false;
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    renderHook(() =>
      useFreehand(
        asCanvas(mock),
        () => {},
        baseTool(ToolType.eraser),
        spec,
        null,
        "record",
        null,
      ),
    );
    expect(mock.isDrawingMode).toBe(false);
  });

  it("tags path:created paths with operator + phase via ref-mirror", () => {
    const mock = createMockCanvas();
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    const { rerender } = renderHook(
      ({ op, ph }: { op: string | null; ph: "record" | "plan" }) =>
        useFreehand(
          asCanvas(mock),
          () => {},
          baseTool(ToolType.pencil),
          spec,
          op,
          ph,
          null,
        ),
      {
        initialProps: {
          op: "alpha" as string | null,
          // Widen the literal so rerender accepts "plan" too.
          ph: "record" as "record" | "plan",
        },
      },
    );

    // Rerender with new props BEFORE firing path:created. The handler
    // should read the live values via the refs.
    rerender({ op: "bravo", ph: "plan" });

    const path = {} as unknown as Parameters<typeof readOperator>[0];
    fire(mock, "before:path:created", { path });
    fire(mock, "path:created", { path });

    expect(readOperator(path)).toBe("bravo");
    expect(readPhase(path)).toBe("plan");
  });

  it("does NOT tag markType when spec omits it (pencil case)", () => {
    const mock = createMockCanvas();
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    renderHook(() =>
      useFreehand(
        asCanvas(mock),
        () => {},
        baseTool(ToolType.pencil),
        spec,
        null,
        "record",
        null,
      ),
    );

    const path = {} as unknown as Parameters<typeof readMarkType>[0];
    fire(mock, "path:created", { path });

    // No markType → readMarkType returns null. This is the pencil
    // legacy behavior we preserve.
    expect(readMarkType(path)).toBeNull();
  });

  it("tags markType when spec provides it (arrow case)", () => {
    const mock = createMockCanvas();
    const spec: FreehandSpec = {
      toolType: ToolType.arrow,
      markType: "arrow",
    };
    renderHook(() =>
      useFreehand(
        asCanvas(mock),
        () => {},
        baseTool(ToolType.arrow),
        spec,
        null,
        "record",
        null,
      ),
    );

    const path = {} as unknown as Parameters<typeof readMarkType>[0];
    fire(mock, "before:path:created", { path });
    fire(mock, "path:created", { path });

    expect(readMarkType(path)).toBe("arrow");
  });

  it("calls spec.onPathCreated with the post-tag context", () => {
    const mock = createMockCanvas();
    const onPathCreated = vi.fn();
    const spec: FreehandSpec = {
      toolType: ToolType.arrow,
      markType: "arrow",
      onPathCreated,
    };
    renderHook(() =>
      useFreehand(
        asCanvas(mock),
        () => {},
        baseTool(ToolType.arrow),
        spec,
        "alpha",
        "plan",
        null,
      ),
    );

    const path = {} as unknown as Parameters<typeof readOperator>[0];
    fire(mock, "before:path:created", { path });
    fire(mock, "path:created", { path });

    expect(onPathCreated).toHaveBeenCalledTimes(1);
    const [pathArg, ctx] = onPathCreated.mock.calls[0]!;
    expect(pathArg).toBe(path);
    expect(ctx.operatorId).toBe("alpha");
    expect(ctx.phase).toBe("plan");
    // The tag should already be present by the time the postprocess
    // runs — its whole point is to inspect/modify a tagged path.
    expect(readOperator(pathArg)).toBe("alpha");
    expect(readMarkType(pathArg)).toBe("arrow");
  });

  it("deactivates drawing mode and removes listener on tool switch", () => {
    const mock = createMockCanvas();
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    const { rerender } = renderHook(
      ({ t }: { t: Tool }) =>
        useFreehand(
          asCanvas(mock),
          () => {},
          t,
          spec,
          null,
          "record",
          null,
        ),
      { initialProps: { t: baseTool(ToolType.pencil) } },
    );

    expect(mock.isDrawingMode).toBe(true);
    rerender({ t: baseTool(ToolType.eraser) });
    expect(mock.isDrawingMode).toBe(false);
    expect(mock.off).toHaveBeenCalledWith(
      "path:created",
      expect.any(Function),
    );
  });

  it("onChoice sets the tool to spec.toolType", () => {
    const mock = createMockCanvas();
    const setTool = vi.fn();
    const spec: FreehandSpec = { toolType: ToolType.arrow };
    const { result } = renderHook(() =>
      useFreehand(
        asCanvas(mock),
        setTool,
        baseTool(ToolType.pencil),
        spec,
        null,
        "record",
        null,
      ),
    );

    act(() => result.current.onChoice());
    expect(setTool).toHaveBeenCalledWith(
      expect.objectContaining({ type: ToolType.arrow }),
    );
  });

  it("does not crash with a null canvas", () => {
    const spec: FreehandSpec = { toolType: ToolType.pencil };
    expect(() =>
      renderHook(() =>
        useFreehand(
          null,
          () => {},
          baseTool(ToolType.pencil),
          spec,
          null,
          "record",
          null,
        ),
      ),
    ).not.toThrow();
  });
});
