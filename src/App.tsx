import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Image } from "react-konva";
import Konva from "konva";
import useImage from "use-image";
import woodsMapUrl from "./woods.png";
import "./App.css";
import { KonvaEventObject } from "konva/types/Node";
import { Vector2d } from "konva/types/types";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };

const freeDrawCanvas = document.createElement('canvas');
const freeDrawCtx = freeDrawCanvas.getContext('2d');
freeDrawCtx!.strokeStyle = '#df4b26';
freeDrawCtx!.lineJoin = 'round';
freeDrawCtx!.lineWidth = 5;

let isPaint = false;
let lastPointerPosition: Vector2d | null;

function startDownload(url: string, name: string) : void {
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const freeDrawImageRef = useRef<Konva.Image>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const freeDrawLayerRef = useRef<Konva.Layer>(null);
  const [{ width, height }, setSize] = useState<Size>(defaultSize);
  const [mapImage] = useImage(woodsMapUrl);

  const mouseDownHandler = (ev: KonvaEventObject<MouseEvent|TouchEvent>) => {
    const stage = ev.currentTarget as Konva.Stage;
    lastPointerPosition = stage.getPointerPosition();
    isPaint = true;
  }

  const mouseUpHandler = (ev: KonvaEventObject<MouseEvent|TouchEvent>) => {
    isPaint = false;
  }

  const mouseMoveHandler = (ev: KonvaEventObject<MouseEvent|TouchEvent>) => {
    if (!isPaint) {
      return;
    }

    const stage = ev.currentTarget as Konva.Stage;

    freeDrawCtx!.globalCompositeOperation = 'source-over';
    freeDrawCtx?.beginPath();
    const image = freeDrawImageRef.current;
    const layer = freeDrawLayerRef.current;

    var localPos = {
      x: lastPointerPosition!.x - image!.x(),
      y: lastPointerPosition!.y - image!.y()
    };
    freeDrawCtx!.moveTo(localPos.x, localPos.y);
    var pos = stage.getPointerPosition();
    localPos = {
      x: pos!.x - image!.x(),
      y: pos!.y - image!.y()
    };
    freeDrawCtx!.lineTo(localPos.x, localPos.y);
    freeDrawCtx!.closePath();
    freeDrawCtx!.stroke();

    lastPointerPosition = pos;
    layer!.batchDraw();
  }

  const save = () => {
    if (stageRef.current === null) {
      return;
    }

    const stage = stageRef.current;
    const url = stage.toDataURL();
    startDownload(url, "startegy.png");
  }

  // TODO consider useLayoutEffect
  useEffect(() => {
    function resizeListener() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        setSize({
          width,
          height
        });
        freeDrawCanvas.width = width;
        freeDrawCanvas.height = height;
      } else {
        setSize(defaultSize);
        freeDrawCanvas.width = defaultSize.width;
        freeDrawCanvas.height = defaultSize.height;
      }
    }

    resizeListener();

    window.addEventListener("resize", resizeListener);
    return () => window.removeEventListener("resize", resizeListener);
  }, [containerRef]);

  return (
    <div className="App">
      <header className="App-header">
        <p className="title">Tarkov Debrief</p>
        <section className="App-header-buttons">
          <button onClick={save}>SAVE</button>
        </section>
      </header>
      <div className="Canvas" ref={containerRef}>
        <Stage
            ref={stageRef}
            width={width}
            height={height}
            onMouseDown={mouseDownHandler}
            onTouchStart={mouseDownHandler}
            onMouseUp={mouseUpHandler}
            onTouchEnd={mouseUpHandler}
            onMouseMove={mouseMoveHandler}
            onTouchMove={mouseMoveHandler}
          >
          <Layer ref={freeDrawLayerRef}>
            <Image image={mapImage} x={20} y={20} width={1000} height={500} />
            <Image image={freeDrawCanvas} ref={freeDrawImageRef} />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

export default App;
