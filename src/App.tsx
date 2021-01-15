import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Image } from "react-konva";
import useImage from "use-image";
import woodsMapUrl from "./woods.png";
import "./App.css";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState<Size>(defaultSize);
  const [mapImage] = useImage(woodsMapUrl);

  // TODO consider useLayoutEffect
  useEffect(() => {
    function resizeListener() {
      if (containerRef.current) {
        setSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      } else {
        setSize(defaultSize);
      }
    }

    resizeListener();

    window.addEventListener("resize", resizeListener);
    return () => window.removeEventListener("resize", resizeListener);
  }, []);

  return (
    <div className="App">
      <header className="App-header">Tarkov Debrief</header>
      <div className="Canvas" ref={containerRef}>
        <Stage width={width} height={height}>
          <Layer>
            <Image image={mapImage} x={20} y={20} />
            <Rect x={20} y={20} width={250} height={250} fill={"green"} />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

export default App;
