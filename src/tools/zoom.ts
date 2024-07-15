import * as fabric from "fabric";
import ContinuingPencilBrush from "../fabric/brush";
import { useEffect } from "react";

export const useZoom = (canvasInstance: fabric.Canvas | null, brushWidth: number) => {
  useEffect(() => {
    if (!canvasInstance) return;
    const canvas = canvasInstance!;

    /* zoom */
    canvas.on("mouse:wheel", function (opt) {
      const event = opt.e as WheelEvent;
      const delta = event.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.01) zoom = 0.01;

      canvas.zoomToPoint(
        { x: event.offsetX, y: event.offsetY } as fabric.Point,
        zoom
      );

      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = brushWidth / zoom;
      }

      if (canvas.freeDrawingBrush instanceof ContinuingPencilBrush) {
        canvas.freeDrawingBrush.computedContinuationThreshold = canvas.freeDrawingBrush.continuationThreshold / zoom;
      }

      opt.e.preventDefault();
      opt.e.stopPropagation();
    });
  }, [brushWidth, canvasInstance]);
};
