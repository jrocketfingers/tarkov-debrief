import { fabric } from 'fabric';
import { RefObject, useEffect } from 'react';

let canvas: fabric.Canvas | null;

const keyboardListener = (event: KeyboardEvent) => {
  if (event.ctrlKey && event.key === "z") {
    canvas?.undo();
  }
}

export const onUse = () => {
  canvas?.undo();
}

export const onChoice = () => {
  onUse();
}

export const useUndo = (canvasInstance: fabric.Canvas | null, appRef: RefObject<HTMLDivElement>) => {
  canvas = canvasInstance;

  useEffect(() => {
    const appEl = appRef.current;
    appEl?.addEventListener("keydown", keyboardListener);

    return () => {
      appEl?.removeEventListener("keydown", keyboardListener);
    }
  }, [appRef]);
  return { onUse, onChoice };
}
