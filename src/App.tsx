import React, { useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import './App.css';

function App() {
	const appRef = useRef(null);
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);

	useEffect(() => {
		setWidth(appRef.current.width);
		setHeight(appRef.current.height);
	});

  return (
    <div className="App" ref={appRef} >
      <header className="App-header">
		  Tarkov Debrief
      </header>
	  <Stage className="Canvas" width={width} height={height} >
		  <Layer>
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
  );
}

export default App;
