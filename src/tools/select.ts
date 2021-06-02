import { fabric } from "fabric";
import { useEffect } from "react";
import { Tool, ToolType, SetToolFn } from './tool';

let canvas: fabric.Canvas | null;
let tool: Tool;
let setTool: SetToolFn;

export const onChoice = () => {
  setTool({
    ...tool,
    type: ToolType.select,
    cursor: null,
  });
}

export const useSelect = (canvasInstance: fabric.Canvas | null, setToolOuter: SetToolFn, toolOuter: Tool) => {
  canvas = canvasInstance;
  setTool = setToolOuter;
  tool = toolOuter;

  useEffect(() => {
    if(tool.type === ToolType.select && canvas) {
      canvas.selection = true;

      return () => {
        if(canvas) canvas.selection = false;
      };
    }
  }, [tool, setToolOuter, canvasInstance]);

  return { onChoice };
};