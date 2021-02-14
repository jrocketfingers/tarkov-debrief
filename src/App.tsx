import React, { useCallback, useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { ColorResult, TwitterPicker } from "react-color";
import "fabric-history";
import "./App.css";
import "./Sidebar.css";

import { maps } from "./MapSelector";

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
import { Link, useParams } from "react-router-dom";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };
let backgroundImage: fabric.Image;
let unerasable = new Set<string>();

type Tool = {
  active: boolean;
  type: "select" | "pencil" | "eraser" | "marker" | "pan";
  onClick: null | ((evt: IEvent) => void);
  onMouseMove: null | ((evt: IEvent) => void);
  cursor: null | string;
};

function startDownload(url: string, name: string): void {
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const modifierTools = ["pan"];
const brushWidth = 5;
const markerCache: Record<string, fabric.Image> = {};
const PENCIL_COLOR: string = "#f00";

function initializeCanvas() {
  const canvas = new fabric.Canvas("canvas", {
    height: defaultSize.height,
    width: defaultSize.width,
    //isDrawingMode: true,
    perPixelTargetFind: true,
    selection: false,
  });

  canvas.freeDrawingBrush.color = PENCIL_COLOR;
  canvas.freeDrawingBrush.width = brushWidth;

  canvas.setCursor(`url(${pencilIcon})`);

  return canvas;
}

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <div className="sidebar-section">
      <h1 className="sidebar-section-title">{title}</h1>
      <div className="sidebar-section-content">{children}</div>
    </div>
  );
}

interface Params {
  map: string;
}

function App() {
  const { map } = useParams<Params>();
  const containerRef = useRef<HTMLDivElement>(null);
  const altKeyRef = useRef<boolean>(false);
  const [tool, _setTool] = useState<Tool>({
    type: "pencil",
    active: true,
    onClick: null,
    onMouseMove: null,
    cursor: null,
  });
  const toolRef = useRef<Tool>({
    type: "pencil",
    active: true,
    onClick: null,
    onMouseMove: null,
    cursor: null,
  });

  const prevTool = useRef<Tool>({
    type: "pencil",
    active: true,
    onClick: null,
    onMouseMove: null,
    cursor: null,
  });

  const lastPosRef = useRef({ x: 0, y: 0 });
  const [color, setColor] = useState<string>(PENCIL_COLOR);
  const [, _setMarker] = useState<string | null>(null);
  const markerRef = useRef<string | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(false);

  const erase = useCallback((opt: IEvent) => {
    if (opt.target !== undefined && toolRef.current.active) {
      if (
        opt.target instanceof fabric.Image &&
        unerasable.has(opt.target.getSrc())
      )
        return;
      canvasRef.current!.remove(opt.target!);
    }
  }, []);

  const pan = useCallback(function (opt) {
    const canvas = canvasRef.current;
    var vpt = canvas!.viewportTransform;
    vpt![4] += opt.e.clientX - lastPosRef.current.x;
    vpt![5] += opt.e.clientY - lastPosRef.current.y;
    canvas!.requestRenderAll();
    lastPosRef.current = { x: opt.e.clientX, y: opt.e.clientY };
  }, []);

  const disableDrawing = useCallback(
    function (opt) {
      const canvas = canvasRef.current;
      if (opt.key === "Alt") {
        altKeyRef.current = true;
        if (canvas && tool.active === false) {
          canvas!.isDrawingMode = false;
        }
      }
    },
    [tool]
  );

  const enableDrawing = useCallback(
    function (opt) {
      const canvas = canvasRef.current;
      if (opt.key === "Alt") {
        altKeyRef.current = false;
        if (canvas && tool.type === "pencil") {
          canvas!.isDrawingMode = true;
        }
      }
    },
    [tool]
  );

  /**
   * Sets the current tool and resets canvas listeners.
   *
   * @param value: Tool
   */
  const setTool = useCallback((value: Tool) => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      // switch listeners (tool is old state, value is new)
      if (toolRef.current.onClick)
        canvas.off("mouse:up", toolRef.current.onClick);
      if (toolRef.current.onMouseMove)
        canvas.off("mouse:move", toolRef.current.onMouseMove);

      if (value.onClick) canvas.on("mouse:up", value.onClick);
      if (value.onMouseMove) canvas.on("mouse:move", value.onMouseMove);

      // set the cursor according to the tool
      if (value.cursor === null) {
        canvas.defaultCursor = "auto";
        canvas.hoverCursor = "auto";
      } else {
        canvas.defaultCursor = value.cursor;
        canvas.hoverCursor = canvas.defaultCursor;
      }

      if (value.type === "pencil" && altKeyRef.current === false) {
        canvas.isDrawingMode = true;
      } else {
        canvas.isDrawingMode = false;
      }
    }
    setSidebar(false);

    _setTool(value);
    toolRef.current = value;
  }, []);

  const setMarker = (value: string) => {
    _setMarker(value);
    markerRef.current = value;
  };

  const changeColor = (color: ColorResult) => {
    setColor(color.hex);
    if (canvasRef.current) {
      canvasRef.current.freeDrawingBrush.color = color.hex;
    }
  };

  const save = () => {
    if (canvasRef.current) {
      const url = canvasRef.current.toDataURL({ multiplier: 3 });
      startDownload(url, "startegy.png");
    }
  };

  const setSelect = () => {
    setTool({
      ...tool,
      type: "select",
      cursor: null,
      onClick: null,
      onMouseMove: null,
    });
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.selection = true;
    }
  };

  const setPencil = () => {
    setTool({
      ...tool,
      type: "pencil",
      cursor: null,
      onClick: null,
      onMouseMove: null,
    });
    if (canvasRef.current) {
    }
  };

  const setEraser = () => {
    setTool({
      ...tool,
      type: "eraser",
      cursor: null,
      onClick: null,
      onMouseMove: erase,
    });
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.selection = false;
    }
  };

  const undo = () => {
    if (canvasRef.current) {
      canvasRef.current.undo();
    }
  };

  const showSidebar = () => {
    setSidebar(true);
  };

  const hideSidebar = () => {
    setSidebar(false);
  };

  const selectMarker = (
    evt: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    const target = evt.target as HTMLImageElement;
    setMarker(target.src);

    const cursor = `url(${target.src}), auto`;
    setTool({ ...tool, type: "marker", onClick: placeMarker, cursor });
  };

  const placeMarker = async (evt: IEvent) => {
    if (markerRef && markerRef.current) {
      let cachedImage = markerCache[markerRef.current];
      if (!cachedImage) {
        const newImage: fabric.Image = await new Promise((resolve) =>
          fabric.Image.fromURL(markerRef.current!, resolve)
        );
        markerCache[markerRef.current!] = newImage;
        cachedImage = newImage;
      }

      const image: fabric.Image = await new Promise((resolve) =>
        cachedImage.clone(resolve)
      );

      const canvas = canvasRef.current;
      const pointer = canvas!.getPointer(evt.e);
      image.left = pointer.x;
      image.top = pointer.y;

      const zoom = canvas!.getZoom();
      image.scale(1 / zoom);

      canvas!.add(image);
    }
  };

  // TODO consider useLayoutEffect
  useEffect(() => {
    if (!canvasRef.current) {
      const canvas = initializeCanvas();
      canvasRef.current = canvas;

      fabric.Image.fromURL(maps[map], (image) => {
        image.canvas = canvas;
        image.selectable = false;
        backgroundImage = image;
        unerasable.add(backgroundImage.getSrc());
        canvas.add(image);
        canvas!.clearHistory();
      });

      canvas.on("mouse:down", (opt: IEvent) => {
        const newTool = { ...toolRef.current, active: true };
        const e = opt.e as MouseEvent;
        if (e.altKey && !toolRef.current.active) {
          newTool.type = "pan";
          newTool.onMouseMove = pan;
          canvas.selection = false;
          lastPosRef.current = { x: e.clientX, y: e.clientY };
          prevTool.current = { ...toolRef.current };
        }
        setTool(newTool);
      });

      canvas.on("mouse:up", (opt) => {
        let tool = { ...toolRef.current };

        // Tools like Pan are under a modifier. Once you let go off the
        // modifier they should return to the previous tool.
        if (modifierTools.includes(toolRef.current.type)) {
          tool = { ...prevTool.current };
        }

        setTool({ ...tool, active: false });
      });

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
        canvas.freeDrawingBrush.width = brushWidth / zoom;
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });
    }

    function resizeListener() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        canvasRef.current?.setDimensions({ width, height });
      } else {
        canvasRef.current?.setDimensions(defaultSize);
      }
    }

    resizeListener();

    function undoListener({ key, ctrlKey }: KeyboardEvent) {
      if (ctrlKey && key === "z") {
        if (canvasRef.current) canvasRef.current.undo();
      }
    }

    window.addEventListener("resize", resizeListener);
    document.addEventListener("keyup", undoListener);
    return () => {
      window.removeEventListener("resize", resizeListener);
    };
  }, [containerRef, setTool, map, pan]);

  return (
    <div className="App">
      <header className="App-header">
        <Link className="App-header-title" to="/">
          Tarkov Debrief
        </Link>
        <section className="App-header-buttons">
          <button onClick={setSelect}>
            <img src={selectIcon} alt="select" />
          </button>
          <button onClick={setPencil}>
            <img src={pencilIcon} alt="pencil" />
          </button>
          <button onClick={setEraser}>
            <img src={eraserIcon} alt="eraser" />
          </button>
          <button onClick={undo}>
            <img src={undoIcon} alt="undo" />
          </button>
          <button onClick={showSidebar}>
            <img src={addMarkerIcon} alt="undo" />
          </button>
          <button onClick={save}>
            <img
              className="App-header-buttons-save"
              src={saveIcon}
              alt="save"
            />
          </button>
        </section>
      </header>
      <aside className={sidebar ? "enter" : ""}>
        <section onClick={hideSidebar} id="closeArea"></section>
        <section id="sidebar">
          <SidebarSection title="Markers">
            <button onClick={selectMarker}>
              <img src={thickPMCMarker} alt="thick PMC" />
            </button>
            <button onClick={selectMarker}>
              <img src={mediumPMCMarker} alt="medium PMC" />
            </button>
            <button onClick={selectMarker}>
              <img src={lightPMCMarker} alt="light PMC" />
            </button>
            <button onClick={selectMarker}>
              <img src={scavMarker} alt="light PMC" />
            </button>
          </SidebarSection>
          <SidebarSection title="">
            <TwitterPicker
              color={color}
              triangle="hide"
              onChangeComplete={changeColor}
            ></TwitterPicker>
          </SidebarSection>
        </section>
      </aside>
      <div
        className="Canvas"
        ref={containerRef}
        onKeyDown={disableDrawing}
        onKeyUp={enableDrawing}
        tabIndex={0}
      >
        <canvas id="canvas"></canvas>
      </div>
    </div>
  );
}

export default App;
