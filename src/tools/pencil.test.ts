import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { usePencil } from "./pencil";
import { readOperator, readPhase } from "./metadata";
import { ToolType, type Tool } from "./tool";
import { asCanvas, createMockCanvas, fire } from "../test/mockCanvas";
import type * as fabric from "fabric";

const baseTool = (type: ToolType): Tool => ({
  active: false,
  type,
  cursor: null,
});

describe("usePencil", () => {
  it("does not crash with null canvas", () => {
    expect(() =>
      renderHook(() =>
        usePencil(null, vi.fn(), baseTool(ToolType.select), vi.fn())
      )
    ).not.toThrow();
  });

  it("enables drawing mode while pencil is active and disables on cleanup", () => {
    const mock = createMockCanvas();
    mock.isDrawingMode = false;
    const { unmount } = renderHook(() =>
      usePencil(asCanvas(mock), vi.fn(), baseTool(ToolType.pencil), vi.fn())
    );
    expect(mock.isDrawingMode).toBe(true);

    unmount();
    expect(mock.isDrawingMode).toBe(false);
  });

  it("onChoice flips the tool to pencil", () => {
    const setTool = vi.fn();
    const tool = baseTool(ToolType.select);
    const { result } = renderHook(() =>
      usePencil(null, setTool, tool, vi.fn())
    );

    act(() => result.current.onChoice());

    expect(setTool).toHaveBeenCalledWith({
      ...tool,
      type: ToolType.pencil,
      cursor: null,
    });
  });

  it("onColorChoice updates brush color and reports back", () => {
    const setColor = vi.fn();
    const mock = createMockCanvas();
    const { result } = renderHook(() =>
      usePencil(asCanvas(mock), vi.fn(), baseTool(ToolType.pencil), setColor)
    );

    act(() => {
      result.current.onColorChoice({
        hex: "#abcdef",
      } as Parameters<typeof result.current.onColorChoice>[0]);
    });

    expect(setColor).toHaveBeenCalledWith("#abcdef");
    expect(mock.freeDrawingBrush.color).toBe("#abcdef");
  });

  describe("metadata tagging (Phase 4)", () => {
    // Note: strokeDashArray is no longer pencil's responsibility —
    // it lives on the brush itself, set by an effect in App.tsx
    // and propagated to the finalized Path automatically by
    // fabric's PencilBrush.createPath. The tests below only cover
    // operator+phase tagging, which usePencil DOES still own.

    it("tags new paths with the active operator and phase", () => {
      const mock = createMockCanvas();
      renderHook(() =>
        usePencil(
          asCanvas(mock),
          vi.fn(),
          baseTool(ToolType.pencil),
          vi.fn(),
          "op-alpha",
          "record",
        ),
      );
      const path = { set: vi.fn() } as unknown as fabric.FabricObject;
      fire(mock, "before:path:created", { path });
      fire(mock, "path:created", { path });
      expect(readOperator(path)).toBe("op-alpha");
      expect(readPhase(path)).toBe("record");
    });

    it("tags plan-phase strokes with phase='plan'", () => {
      const mock = createMockCanvas();
      renderHook(() =>
        usePencil(
          asCanvas(mock),
          vi.fn(),
          baseTool(ToolType.pencil),
          vi.fn(),
          "op-alpha",
          "plan",
        ),
      );
      const path = { set: vi.fn() } as unknown as fabric.FabricObject;
      fire(mock, "before:path:created", { path });
      fire(mock, "path:created", { path });
      expect(readPhase(path)).toBe("plan");
    });

    it("does not touch path.set on path:created (brush owns visual props)", () => {
      // Regression for the brush-owns-strokeDashArray refactor.
      // pencil.ts used to call path.set({strokeDashArray: ...}) here;
      // it shouldn't anymore — the brush's createPath already wrote
      // strokeDashArray onto the finalized Path before we see it.
      const mock = createMockCanvas();
      renderHook(() =>
        usePencil(
          asCanvas(mock),
          vi.fn(),
          baseTool(ToolType.pencil),
          vi.fn(),
          "op-alpha",
          "plan",
        ),
      );
      const setSpy = vi.fn();
      const path = { set: setSpy } as unknown as fabric.FabricObject;
      fire(mock, "path:created", { path });
      expect(setSpy).not.toHaveBeenCalled();
    });

    it("reads LIVE operator/phase via ref-mirror, not stale closure", () => {
      // Regression for the ref-mirror pattern. If we captured the
      // operator in closure, switching operators between strokes
      // would tag the new stroke with the OLD operator.
      const mock = createMockCanvas();
      const { rerender } = renderHook(
        ({ op, ph }: { op: string | null; ph: "plan" | "record" }) =>
          usePencil(
            asCanvas(mock),
            vi.fn(),
            baseTool(ToolType.pencil),
            vi.fn(),
            op,
            ph,
          ),
        {
          initialProps: {
            op: "op-alpha" as string | null,
            ph: "record" as "plan" | "record",
          },
        },
      );

      // Switch operator + phase mid-life
      rerender({ op: "op-bravo", ph: "plan" });

      const path = { set: vi.fn() } as unknown as fabric.FabricObject;
      fire(mock, "before:path:created", { path });
      fire(mock, "path:created", { path });
      expect(readOperator(path)).toBe("op-bravo");
      expect(readPhase(path)).toBe("plan");
    });
  });
});
