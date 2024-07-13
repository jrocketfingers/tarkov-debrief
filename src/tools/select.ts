import { fabric } from "fabric";
import { useEffect } from "react";
import { Tool, ToolType, SetToolFn } from './tool';

let tool: Tool;
let setTool: SetToolFn;

export const onChoice = () => {
  setTool({
    ...tool,
    type: ToolType.select,
    cursor: null,
  });
}

export const useSelect = (canvasOuter: fabric.Canvas | null, setToolOuter: SetToolFn, toolOuter: Tool) => {
  setTool = setToolOuter;
  tool = toolOuter;

  useEffect(() => {
    if (toolOuter.type === ToolType.select && canvasOuter) {
      canvasOuter.selection = true;
      canvasOuter.perPixelTargetFind = false;

      return () => {
        if (canvasOuter) {
          canvasOuter.selection = false;
          canvasOuter.perPixelTargetFind = true;
        }
      };
    }
  }, [canvasOuter, toolOuter]);

  return { onChoice };
};
