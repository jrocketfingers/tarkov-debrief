import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import woodsMapUrl from "./interchange.png";
import "./App.css";
import selectIcon from "./icons/select.svg";
import pencilIcon from "./icons/pencil.svg";
import eraserIcon from "./icons/eraser.svg";
import undoIcon from "./icons/undo.svg";
import zoomIcon from "./icons/zoom.svg";
import saveIcon from "./icons/save.svg";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };

type Tool = { active: boolean, type: 'select' | 'pencil' | 'eraser' };

function startDownload(url: string, name: string) : void {
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const brushWidth = 5;

function initializeCanvas() { 
  const canvas = new fabric.Canvas('canvas', {
    height: defaultSize.height,
    width: defaultSize.width,
    //isDrawingMode: true,
    perPixelTargetFind: true,
    selection: false,
  });

  canvas.freeDrawingBrush.color = 'red';
  canvas.freeDrawingBrush.width = brushWidth;

  return canvas;
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, _setTool] = useState<Tool>({ type: 'pencil', active: true });
  const toolRef = useRef<Tool>({ type: 'pencil', active: true });
  const [backgroundImage, setBackgroundImage] = useState<fabric.Image | null>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);

  const setTool = (value: Tool) => {
    _setTool(value);
    toolRef.current = value;
  }

  const save = () => {
    if (canvas) {
      const url = canvas.toDataURL({ multiplier: 3 });
      startDownload(url, "startegy.png");
    }
  }

  const select = () => {
    setTool({...tool, type: 'select'});
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = true;
    }
  }

  const pencil = () => {
    setTool({...tool, type: 'pencil'});
    if (canvas) {
      canvas.isDrawingMode = true;
    }
  }

  const eraser = () => {
    setTool({...tool, type: 'eraser'});
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = false;
    }
  }

  // TODO consider useLayoutEffect
  useEffect(() => {
    if (!canvas) {
      const canvas = initializeCanvas();
      setCanvas(canvas);

      fabric.Image.fromURL(woodsMapUrl, (image) => {
        canvas!.backgroundImage = image;
        setBackgroundImage(image);
      });

      canvas.on('mouse:down', (opt) => {
        setTool({...toolRef.current, active: true});
      });

      canvas.on('mouse:up', (opt) => {
        setTool({...toolRef.current, active: false});
      });

      canvas.on('mouse:move', (opt) => {
        if (opt.target === null) return;
        if (toolRef.current.type === 'eraser' && toolRef.current.active) {
          canvas.remove(opt.target!);
        }
      });

      canvas.on('mouse:wheel', function(opt) {
        const event = opt.e as WheelEvent;
        const delta = event.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 20) zoom = 20;
        if (zoom < 0.01) zoom = 0.01;
        canvas.zoomToPoint({ x: event.offsetX, y: event.offsetY } as fabric.Point, zoom);
        canvas.freeDrawingBrush.width = brushWidth / zoom;
        opt.e.preventDefault();
        opt.e.stopPropagation();
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
    return () => {
      window.removeEventListener("resize", resizeListener);
    }
  }, [containerRef, backgroundImage, canvas]);

  return (
    <div className="App">
      <header className="App-header">
        <p className="title">Tarkov Debrief</p>
        <section className="App-header-buttons">
          <button onClick={select}><img src={selectIcon} alt="select" /></button>
          <button onClick={pencil}><img src={pencilIcon} alt="pencil" /></button>
          <button onClick={eraser}><img src={eraserIcon} alt="eraser" /></button>
          <button onClick={undo}><img src={undoIcon} alt="undo" /></button>
          <button><img src={zoomIcon} alt="zoom" /></button>
          <button onClick={save}><img className="App-header-buttons-save" src={saveIcon} alt="save" /></button>
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
