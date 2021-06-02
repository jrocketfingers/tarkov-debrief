import { fabric } from "fabric";
import { useEffect } from "react";
import { ColorResult } from "react-color";
import { Tool, ToolType, SetToolFn } from "./tool";

let maybeCanvas: fabric.Canvas | null;
let tool: Tool;
let setTool: SetToolFn;
let setColor: (color: string) => void;

export const onChoice = () => {
  setTool({
    ...tool,
    type: ToolType.pencil,
    cursor: null,
  });
};

const onColorChoice = (color: ColorResult) => {
  if (!maybeCanvas) return;
  const canvas = maybeCanvas!;

  setColor(color.hex);
  if (canvas) {
    canvas.freeDrawingBrush.color = color.hex;
  }
};

export const usePencil = (
  canvas: fabric.Canvas | null,
  setToolOuter: SetToolFn,
  toolOuter: Tool,
  setColorOuter: (color: string) => void
) => {
  maybeCanvas = canvas;
  setTool = setToolOuter;
  tool = toolOuter;
  setColor = setColorOuter;

  useEffect(() => {
    if (toolOuter.type === ToolType.pencil && maybeCanvas) {
      maybeCanvas.isDrawingMode = true;

      return () => {
        if (maybeCanvas) maybeCanvas.isDrawingMode = false;
      };
    }
  }, [toolOuter, canvas]);

  return { onChoice, onColorChoice };
};
