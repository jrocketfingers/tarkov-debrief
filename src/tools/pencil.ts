import * as paper from "paper";
import { ColorResult } from "react-color";


export const usePencil = () => {
    let path: paper.Path;
    let color = new paper.Color('red');
    const tool = new paper.Tool();
    tool.minDistance = 2;

    tool.onMouseDown = function (event: paper.ToolEvent) {
        if((event as any).event.button !== 0) return;

        path = new paper.Path();
        path.add(event.point);
        path.strokeColor = color;
        path.strokeWidth = 3;
    };

    tool.onMouseDrag = function (event: paper.ToolEvent) {
        if((event as any).event.button !== 0) return;

        path.add(event.point);
    }

    const stopWriting = () => {
        path.smooth({ type: 'continuous' });
        path.simplify();
    }

    tool.onMouseUp = function (event: paper.ToolEvent) {
        if((event as any).event.button !== 0) return;

        stopWriting();
    };

    (tool as any).onDeactivate = function() {
        stopWriting();
    }

    const onChoice = () => {
        tool.activate();
    };

    const onColorChoice = (colorSelection: ColorResult) => {
    color = new paper.Color(colorSelection.hex);
    };

    return { onChoice, onColorChoice };
};
