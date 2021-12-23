import { IEvent } from "fabric/fabric-impl";
import { useEffect } from "react";
import { SetToolFn, Tool, ToolType } from "./tool";

let maybeCanvas: fabric.Canvas | null;
let tool: Tool;
let prevTool: Tool;
let setTool: SetToolFn;
let lastPos: { x: number, y: number } = { x: 0, y: 0 };
let active: boolean = false;

export const onDrag = (opt: IEvent) => {
  if (!maybeCanvas) return;
  const canvas = maybeCanvas!;
  const e = opt.e as MouseEvent;

  var vpt = canvas.viewportTransform;
  vpt![4] += e.clientX - lastPos.x;
  vpt![5] += e.clientY - lastPos.y;
  canvas.requestRenderAll();
  lastPos = { x: e.clientX, y: e.clientY };
};

export const onStartDrag = (opt: IEvent) => {
  const e = opt.e as MouseEvent;
  if (e.button === 1) { // middle click
    e.preventDefault();
    prevTool = tool;
    setTool({
      ...tool,
      type: ToolType.pan,
    });
    active = true;
    lastPos = { x: e.clientX, y: e.clientY };
    maybeCanvas?.on("mouse:move", onDrag);
    if (maybeCanvas) maybeCanvas.isDrawingMode = false;
  }
}

export const onStopDrag = (opt: IEvent) => {
  if (active) {
    active = false;
    maybeCanvas?.off("mouse:move", onDrag);
    setTool({
      ...prevTool,
    });
  }
}

export const usePan = (canvasInstance: fabric.Canvas | null, setToolOuter: SetToolFn, toolOuter: Tool) => {
  maybeCanvas = canvasInstance;
  setTool = setToolOuter;
  tool = toolOuter;

  useEffect(() => {
    canvasInstance?.on("mouse:down", onStartDrag);
    canvasInstance?.on("mouse:up", onStopDrag);

    return () => {
      canvasInstance?.off("mouse:down", onStartDrag)
      canvasInstance?.off("mouse:up", onStopDrag)
    }
  }, [canvasInstance]);
}