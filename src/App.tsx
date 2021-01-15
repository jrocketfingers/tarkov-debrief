import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Image } from 'react-konva';
import useImage from 'use-image';
import woodsMapUrl from './woods.png';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [mapImage] = useImage(woodsMapUrl);

  useEffect(() => {
    matchCanvasSize();
    if(containerRef?.current) {
      containerRef.current.addEventListener('resize', () => {
        matchCanvasSize();
      });
    }
  }, [containerRef]);

  const matchCanvasSize = () => {
    if(containerRef?.current) {
      const {offsetWidth: width, offsetHeight: height} = containerRef.current;
      setWidth(width);
      setHeight(height);
    }
  }

  return (
    <div className="App">
      <header className="App-header">
        Tarkov Debrief
      </header>
      <div className="Canvas" ref={containerRef}>
        <Stage width={width} height={height}>
          <Layer>
            <Image
              image={mapImage}
              x={20}
              y={20}
            />
            <Rect
              x={20}
              y={20}
              width={250}
              height={250}
              fill={"green"}
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

export default App;
