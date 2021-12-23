import { fabric } from "fabric";
import { IEvent } from "fabric/fabric-impl";
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

export const onUse = (opt: IEvent) => {
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
    if(tool.type === ToolType.eraser && maybeCanvas) {
      maybeCanvas.on("mouse:move", onUse);
      maybeCanvas.on("mouse:down", onClick);
      maybeCanvas.on("mouse:up", onRelease);
      maybeCanvas.selection = false;

      return () => {
        if(maybeCanvas) {
          maybeCanvas.off("mouse:move", onUse);
          maybeCanvas.off("mouse:move", onClick);
          maybeCanvas.off("mouse:move", onRelease);
          active = false;
        }
      };
    }
  }, [toolOuter, canvas]);

  return { onChoice, onUse };
};