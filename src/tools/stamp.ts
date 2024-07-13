/* Stamp tool places a marker -- scav icon, pmc icon, etc */

import { fabric } from "fabric";
import { IEvent } from "fabric/fabric-impl";
import { useEffect } from "react";
import { SetToolFn, Tool, ToolType } from "./tool";

let setTool: SetToolFn;
let tool: Tool;
let setSidebar: (visible: boolean) => void;
let markerUrl: string;
let maybeCanvas: fabric.Canvas | null;
const markerCache: Record<string, fabric.Image> = {};

export const onChoice = (
  evt: React.MouseEvent<HTMLButtonElement, MouseEvent>
) => {
  const target = evt.target as HTMLImageElement;
  markerUrl = target.src;
  const cursorString = `url(${markerUrl}), auto`;

  if (maybeCanvas) {
    maybeCanvas.defaultCursor = cursorString;
    maybeCanvas.hoverCursor = cursorString;
  }

  setTool({ ...tool, type: ToolType.marker })

  setSidebar(false);
};

const placeMarker = async (evt: IEvent) => {
  if (!maybeCanvas) return;
  const canvas = maybeCanvas!;

  if ((evt.e as MouseEvent).altKey) return;

  let cachedImage = markerCache[markerUrl];
  if (!cachedImage) {
    const newImage: fabric.Image = await new Promise((resolve) =>
      fabric.Image.fromURL(markerUrl, resolve)
    );
    markerCache[markerUrl] = newImage;
    cachedImage = newImage;
  }

  const image: fabric.Image = await new Promise((resolve) =>
    cachedImage.clone(resolve)
  );

  const pointer = canvas.getPointer(evt.e);
  image.left = pointer.x;
  image.top = pointer.y;

  const zoom = canvas.getZoom();
  image.scale(1 / zoom);

  canvas.add(image);
};


export const useStamp = (
  canvas: fabric.Canvas | null,
  setSidebarOuter: (visible: boolean) => void,
  toolOuter: Tool,
  setToolOuter: SetToolFn,
) => {
  tool = toolOuter;
  setTool = setToolOuter;
  setSidebar = setSidebarOuter;
  maybeCanvas = canvas;

  useEffect(() => {
    if (canvas && toolOuter.type === ToolType.marker) {
      canvas.on('mouse:down', placeMarker);

      return () => {
        if (canvas && toolOuter.type !== ToolType.marker) {
          canvas.off('mouse:down', placeMarker);
          canvas.defaultCursor = 'auto';
          canvas.hoverCursor = 'auto';
        }
      }
    }
  }, [toolOuter, canvas]);

  return { onChoice };
};