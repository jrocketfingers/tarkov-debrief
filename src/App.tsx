import React, { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { TwitterPicker } from "react-color";
import { Link, useParams } from "react-router-dom";
import "fabric-history";
import "./App.css";
import "./Sidebar.css";

import { maps } from "./MapSelector";

import githubLogo from "./icons/github.png";
import selectIcon from "./icons/select.svg";
import pencilIcon from "./icons/pencil.svg";
import eraserIcon from "./icons/eraser.svg";
import undoIcon from "./icons/undo.svg";
import addMarkerIcon from "./icons/marker.svg";
import saveIcon from "./icons/save.svg";

import { useUndo } from "./tools/undo";

import thickPMCMarker from "./icons/pmc-thick.svg";
import mediumPMCMarker from "./icons/pmc-med.svg";
import lightPMCMarker from "./icons/pmc-light.svg";
import scavMarker from "./icons/scav.svg";
import { Tool, ToolType } from "./tools/tool";
import { useSelect } from "./tools/select";
import { usePencil } from "./tools/pencil";
import { useEraser } from "./tools/eraser";
import { useStamp } from "./tools/stamp";
import { useZoom } from "./tools/zoom";

const githubUrl = "https://github.com/jrocketfingers/tarkov-debrief";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };
let backgroundImage: fabric.Image;
let unerasable = new Set<string>();

function startDownload(url: string, name: string): void {
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const brushWidth = 5;
const PENCIL_COLOR: string = "#f00";

function initializeCanvas() {
  const canvas = new fabric.Canvas("canvas", {
    height: defaultSize.height,
    width: defaultSize.width,
    isDrawingMode: true,
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
  const appRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>({
    type: ToolType.pencil,
    active: false,
    cursor: null,
  });

  console.log("rerender");

  const [color, setColor] = useState<string>(PENCIL_COLOR);
  const [maybeCanvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(false);

  const save = () => {
    if (maybeCanvas) {
      const url = maybeCanvas.toDataURL({ multiplier: 3 });
      startDownload(url, "startegy.png");
    }
  };

  const { onChoice: setSelect } = useSelect(maybeCanvas, setTool, tool);

  const { onChoice: setPencil, onColorChoice } = usePencil(
    maybeCanvas,
    setTool,
    tool,
    setColor
  );

  const { onChoice: setEraser } = useEraser(
    maybeCanvas,
    setTool,
    tool,
    unerasable
  );

  const { onUse: undo } = useUndo(maybeCanvas, appRef);

  const { onChoice: selectMarker } = useStamp(
    maybeCanvas,
    setSidebar,
    tool,
    setTool
  );

  // FIXME: untie zoom tool from brush
  useZoom(maybeCanvas, brushWidth);

  const showSidebar = () => {
    setSidebar(true);
  };

  const hideSidebar = () => {
    setSidebar(false);
  };

  // Run-once
  useEffect(() => {
    setCanvas(initializeCanvas());
  }, []);

  // Load map and ensure it's fullscreen
  useEffect(() => {
    let image: fabric.Image;

    if (!maybeCanvas) return;
    const canvas = maybeCanvas!;

    fabric.Image.fromURL(maps[map], (imageInstance) => {
      image = imageInstance;
      image.canvas = canvas;
      image.selectable = false;
      backgroundImage = image;
      unerasable.add(backgroundImage.getSrc());
      canvas.add(image);
      canvas.clearHistory();
    });

    function resizeListener() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        maybeCanvas?.setDimensions({ width, height });
      } else {
        maybeCanvas?.setDimensions(defaultSize);
      }
    }

    resizeListener();

    window.addEventListener("resize", resizeListener);
    return () => {
      window.removeEventListener("resize", resizeListener);
    };
  }, [map, maybeCanvas]);

  return (
    <div className="App" ref={appRef}>
      <header className="App-header">
        <section className="App-header-left">
          <Link className="App-header-title" to="/">
            Tarkov Debrief
          </Link>
          <a href={githubUrl}>
            <img src={githubLogo} alt="github logo" className="App-header-github-logo"/>
          </a>
          <a href={githubUrl} className="App-header-github">Read more on github</a>
        </section>
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
              onChangeComplete={onColorChoice}
            ></TwitterPicker>
          </SidebarSection>
        </section>
      </aside>
      <div className="Canvas" ref={containerRef} tabIndex={0}>
        <canvas id="canvas"></canvas>
      </div>
    </div>
  );
}

export default App;
