import React, { useCallback, useEffect, useRef, useMemo, useState, KeyboardEvent } from "react";
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

enum ToolType {
  select = "select",
  pencil = "pencil",
  eraser = "eraser",
  marker = "marker",
  pan = "pan",
}

type Tool = {
  active: boolean;
  type: ToolType;
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
  const [tool, setTool] = useState<Tool>({
    type: ToolType.pencil,
    active: false,
    cursor: null,
  });

  const [prevTool, setPrevTool] = useState<Tool>({
    type: ToolType.pencil,
    active: false,
    cursor: null,
  });

  const lastPosRef = useRef({ x: 0, y: 0 });
  const [color, setColor] = useState<string>(PENCIL_COLOR);
  const [, _setMarker] = useState<string | null>(null);
  const markerRef = useRef<string | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(false);

  const appKeyDownHandler = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.ctrlKey && event.key === "z") {
        if (canvasRef.current) canvasRef.current.undo();
        return;
      }

      if (event.key === "Alt") {
        setPrevTool(tool);
        setTool({ ...tool, type: ToolType.pan });
      }
    }
  , [setTool, tool]);

  const appKeyUpHandler = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Alt") {
        setTool(prevTool);
      }
    }
  , [setTool, prevTool]);

  const erase = useCallback(
    (opt: IEvent) => {
      if (opt.target !== undefined && tool.active) {
        if (
          opt.target instanceof fabric.Image &&
          unerasable.has(opt.target.getSrc())
        )
          return;
        canvasRef.current!.remove(opt.target!);
      }
    },
    [tool.active]
  );

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
        if (canvas && tool.type === ToolType.pencil) {
          canvas!.isDrawingMode = true;
        }
      }
    },
    [tool]
  );

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

  const handlers: Record<ToolType, Record<string, (event: IEvent) => void>> = useMemo(() => ({
    [ToolType.select]: {},
    [ToolType.pencil]: {},
    [ToolType.eraser]: {
      "mouse:move": erase,
    },
    [ToolType.marker]: {
      "mouse:down": placeMarker,
    },
    [ToolType.pan]: {
      "mouse:move": pan,
    },
  }), [erase, pan]);

  // sets the canvas cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.defaultCursor = tool?.cursor || "auto";
      canvas.hoverCursor = tool?.cursor || "auto";
    }
  }, [tool.cursor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      if (tool.type === ToolType.pencil) {
        canvas.isDrawingMode = true;
      } else {
        canvas.isDrawingMode = false;
      }

      if (tool.type === ToolType.eraser) {
        canvas.selection = false;
      }

      if (tool.type === ToolType.select) {
        canvas.selection = true;
      }
    }
  }, [tool.type])

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
      type: ToolType.select,
      cursor: null,
    });
  };

  const setPencil = () => {
    setTool({
      ...tool,
      type: ToolType.pencil,
      cursor: null,
    });
    if (canvasRef.current) {
    }
  };

  const setEraser = () => {
    setTool({
      ...tool,
      type: ToolType.eraser,
      cursor: null,
    });
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
    setTool({ ...tool, type: ToolType.marker, cursor });
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
        const e = opt.e as MouseEvent;
        if (e.altKey && !tool.active) {
          lastPosRef.current = { x: e.clientX, y: e.clientY };
          return;
        } else {
          handlers?.[tool.type]?.["mouse:down"]?.(opt);
        }
      });

      /* return to the previous tool */
      canvas.on("mouse:up", (opt) => {
        setTool({ ...tool, active: false });
      });

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

    window.addEventListener("resize", resizeListener);
    return () => {
      window.removeEventListener("resize", resizeListener);
    };
  }, [handlers, tool, pan, map]);

  return (
    <div className="App" onKeyDown={appKeyDownHandler} onKeyUp={appKeyUpHandler}>
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
