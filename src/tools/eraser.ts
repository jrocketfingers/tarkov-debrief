import * as fabric from "fabric";
import { useEffect } from "react";
import { SetToolFn, Tool, ToolType } from "./tool";

let maybeCanvas: fabric.Canvas | null;
let tool: Tool;
let setTool: SetToolFn;
let unerasable: Set<string>;
let active = false;

export const onChoice = () => {
  setTool({
    ...tool,
    type: ToolType.eraser,
    cursor: null,
  });
}

export const onUse = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
  if (tool.type === ToolType.eraser && opt.target !== undefined && active) {
    if (
      opt.target instanceof fabric.Image &&
      unerasable.has(opt.target.getSrc())
    ) {
      return;
    }
    maybeCanvas?.remove(opt.target!);
  }
}

const onClick = () => {
  active = true;
}

const onRelease = () => {
  active = false;
}

export const useEraser = (canvas: fabric.Canvas | null, setToolOuter: SetToolFn, toolOuter: Tool, unerasableOuter: Set<string>) => {
  maybeCanvas = canvas;
  setTool = setToolOuter;
  tool = toolOuter;
  unerasable = unerasableOuter;

  useEffect(() => {
    if (toolOuter.type === ToolType.eraser && canvas) {
      canvas.on("mouse:move", onUse);
      canvas.on("mouse:down", onClick);
      canvas.on("mouse:up", onRelease);
      canvas.selection = false;

      return () => {
        if (canvas) {
          canvas.off("mouse:move", onUse);
          canvas.off("mouse:move", onClick);
          canvas.off("mouse:move", onRelease);
          active = false;
        }
      };
    }
  }, [toolOuter, canvas]);

  return { onChoice, onUse };
};
