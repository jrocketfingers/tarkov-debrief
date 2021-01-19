import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import woodsMapUrl from "./woods.png";
import "./App.css";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };

const freeDrawCanvas = document.createElement('canvas');
const freeDrawCtx = freeDrawCanvas.getContext('2d');
freeDrawCtx!.strokeStyle = '#df4b26';
freeDrawCtx!.lineJoin = 'round';
freeDrawCtx!.lineWidth = 5;

function startDownload(url: string, name: string) : void {
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function initializeCanvas() { 
  const canvas = new fabric.Canvas('canvas', {
    height: defaultSize.height,
    width: defaultSize.width,
    isDrawingMode: true,
  });

  canvas.freeDrawingBrush.color = 'red';
  canvas.freeDrawingBrush.width = 5;

  return canvas;
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [backgroundImage, setBackgroundImage] = useState<fabric.Image | null>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);

  const save = () => {
    if (canvas) {
      const url = canvas.toDataURL({ multiplier: 3});
      startDownload(url, "startegy.png");
    }
  }

  // TODO consider useLayoutEffect
  useEffect(() => {
    if (!canvas) {
      const canvas = initializeCanvas();
      setCanvas(canvas);

      fabric.Image.fromURL(woodsMapUrl, (image) => {
        canvas!.add(image);
        setBackgroundImage(image);
      });
    }

    function resizeListener() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        canvas?.setDimensions({ width, height });

        if (backgroundImage) {
          backgroundImage?.scaleToWidth(width)
        }
      } else {
        canvas?.setDimensions(defaultSize);
      }
    }

    resizeListener();

    window.addEventListener("resize", resizeListener);
    return () => window.removeEventListener("resize", resizeListener);
  }, [containerRef, backgroundImage, canvas]);

  return (
    <div className="App">
      <header className="App-header">
        <p className="title">Tarkov Debrief</p>
        <section className="App-header-buttons">
          <button onClick={save}>SAVE</button>
        </section>
      </header>
      <div className="Canvas" ref={containerRef}>
        <canvas id="canvas">
        </canvas>
      </div>
    </div>
  );
}

export default App;
