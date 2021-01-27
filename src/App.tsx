import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import "fabric-history";
import woodsMapUrl from "./interchange.png";
import "./App.css";

import selectIcon from "./icons/select.svg";
import pencilIcon from "./icons/pencil.svg";
import eraserIcon from "./icons/eraser.svg";
import undoIcon from "./icons/undo.svg";
import addMarkerIcon from "./icons/marker.svg";
import saveIcon from "./icons/save.svg";

import thickPMCMarker from "./icons/pmc-thick.svg";
import mediumPMCMarker from "./icons/pmc-med.svg";
import lightPMCMarker from "./icons/pmc-light.svg";
import scavMarker from "./icons/scav.svg";
import { IEvent } from "fabric/fabric-impl";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };
let backgroundImage: fabric.Image;
let unerasable = new Set<string>();

type Tool = {
  active: boolean,
  type: 'select' | 'pencil' | 'eraser' | 'marker',
  onClick: null | ((evt: IEvent) => void),
  cursor: null | string,
};

function startDownload(url: string, name: string) : void {
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const brushWidth = 5;
const markerCache: Record<string, fabric.Image> = {};

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

  canvas.setCursor(`url(${pencilIcon})`);

  return canvas;
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, _setTool] = useState<Tool>({
    type: 'pencil',
    active: true,
    onClick: null,
    cursor: null,
  });
  const toolRef = useRef<Tool>({
    type: 'pencil',
    active: true,
    onClick: null,
    cursor: null,
  });
  const [, _setMarker] = useState<string | null>(null);
  const markerRef = useRef<string | null>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(false);

  /**
   * Sets the current tool and resets canvas listeners.
   * 
   * @param value: Tool
   */
  const setTool = (value: Tool) => {
    // switch listeners (tool is old state, value is new)
    if (canvas) {
      if (tool.onClick) canvas.off('mouse:up', tool.onClick);
      if (value.onClick) canvas.on('mouse:up', value.onClick);

      if (value.cursor === null) {
        canvas.defaultCursor = 'auto';
        canvas.hoverCursor = 'auto';
      } else {
        canvas.defaultCursor = value.cursor;
        canvas.hoverCursor = canvas.defaultCursor;
      }

      if (value.type === 'pencil') {
        canvas.isDrawingMode = true;
      } else {
        canvas.isDrawingMode = false;
      }
    }
    setSidebar(false);

    _setTool(value);
    toolRef.current = value;
  }

  const setMarker = (value: string) => {
    _setMarker(value);
    markerRef.current = value;
  }

  const save = () => {
    if (canvas) {
      const url = canvas.toDataURL({ multiplier: 3 });
      startDownload(url, "startegy.png");
    }
  }

  const select = () => {
    setTool({...tool, type: 'select', cursor: null, onClick: null});
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = true;
    }
  }

  const pencil = () => {
    setTool({...tool, type: 'pencil', cursor: null, onClick: null});
    if (canvas) {
      canvas.isDrawingMode = true;
    }
  }

  const eraser = () => {
    setTool({...tool, type: 'eraser', cursor: null, onClick: null});
    if (canvas) {
      canvas.isDrawingMode = false;
      canvas.selection = false;
    }
  }

  const undo = () => {
    if (canvas) {
      canvas.undo();
    }
  }

  const showSidebar = () => {
    setSidebar(true);
  }

  const hideSidebar = () => {
    setSidebar(false);
  }

  const selectMarker = (evt: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    const target = evt.target as HTMLImageElement;
    setMarker(target.src);

    const cursor = `url(${target.src}), auto`;
    setTool({...tool, type: 'marker', onClick: placeMarker, cursor});
  }

  const placeMarker = async (evt: IEvent) => {
    if (markerRef && markerRef.current) {
      let cachedImage = markerCache[markerRef.current];
      if (!cachedImage) {
        const newImage: fabric.Image = await new Promise(resolve => fabric.Image.fromURL(markerRef.current!, resolve));
        markerCache[markerRef.current!] = newImage;
        cachedImage = newImage;
      }

      const image: fabric.Image = await new Promise(resolve => cachedImage.clone(resolve));
      const pointer = canvas!.getPointer(evt.e);
      image.left = pointer.x;
      image.top = pointer.y;

      const zoom = canvas!.getZoom();
      image.scale(1 / zoom);

      canvas!.add(image);
    }
  }

  // TODO consider useLayoutEffect
  useEffect(() => {
    if (!canvas) {
      const canvas = initializeCanvas();
      setCanvas(canvas);

      fabric.Image.fromURL(woodsMapUrl, (image) => {
        image.canvas = canvas;
        image.selectable = false;
        backgroundImage = image;
        unerasable.add(backgroundImage.getSrc());
        canvas.add(image);
        canvas!.clearHistory();
      });

      canvas.on('mouse:down', (opt) => {
        setTool({...toolRef.current, active: true});
      });

      canvas.on('mouse:up', (opt) => {
        setTool({...toolRef.current, active: false});
      });

      canvas.on('mouse:move', (opt) => {
        if (opt.target === null) return;
        if (opt.target instanceof fabric.Image && unerasable.has(opt.target.getSrc())) return;
        if (toolRef.current.type === 'eraser'
            && toolRef.current.active) {
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
      } else {
        canvas?.setDimensions(defaultSize);
      }
    }

    resizeListener();

    function undoListener({ key, ctrlKey }: KeyboardEvent) {
      if(ctrlKey && key === "z") {
        if (canvas) canvas.undo();
      }
    }

    window.addEventListener("resize", resizeListener);
    document.addEventListener("keyup", undoListener);
    return () => {
      window.removeEventListener("resize", resizeListener);
    }
  }, [containerRef, canvas]);

  return (
    <div className="App">
      <header className="App-header">
        <p className="title">Tarkov Debrief</p>
        <section className="App-header-buttons">
          <button onClick={select}><img src={selectIcon} alt="select" /></button>
          <button onClick={pencil}><img src={pencilIcon} alt="pencil" /></button>
          <button onClick={eraser}><img src={eraserIcon} alt="eraser" /></button>
          <button onClick={undo}><img src={undoIcon} alt="undo" /></button>
          <button onClick={showSidebar}><img src={addMarkerIcon} alt="undo" /></button>
          <button onClick={save}><img className="App-header-buttons-save" src={saveIcon} alt="save" /></button>
        </section>
      </header>
      <aside className={sidebar ? "enter" : ""}>
        <section onClick={hideSidebar} id="closeArea"></section>
        <section id="sidebar">
          <button onClick={selectMarker}><img src={thickPMCMarker} alt="thick PMC" /></button>
          <button onClick={selectMarker}><img src={mediumPMCMarker} alt="medium PMC" /></button>
          <button onClick={selectMarker}><img src={lightPMCMarker} alt="light PMC" /></button>
          <button onClick={selectMarker}><img src={scavMarker} alt="light PMC" /></button>
        </section>
      </aside>
      <div className="Canvas" ref={containerRef}>
        <canvas id="canvas">
        </canvas>
      </div>
    </div>
  );
}

export default App;
