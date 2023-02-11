import * as paper from "paper";


export const useSelect = () => {
    let selectionStart: paper.Point;
    let selectionEnd: paper.Point;
    let selectionRect: paper.Path | null = null;
    let tool: any = new paper.Tool();
    const SELECTION_COLOR = new paper.Color(0, 0, 0, 0.2);

    const onChoice = () => {
        tool.activate();
    }

    tool.onMouseDown = function (event: paper.ToolEvent) {
        if((event as any).event.button !== 0) return;

        selectionStart = event.point;
        selectionRect = new paper.Path.Rectangle(selectionStart, selectionStart);
        selectionRect.fillColor = SELECTION_COLOR;
    }

    tool.onMouseDrag = function (event: paper.ToolEvent) {
        if (!selectionRect) return;

        selectionEnd = event.point;
        selectionRect.remove();
        selectionRect = new paper.Path.Rectangle(selectionStart, selectionEnd);
        selectionRect.fillColor = SELECTION_COLOR;
    }

    tool.onMouseUp = function (event: paper.ToolEvent) {
        if((event as any).event.button !== 0) return;

        paper.project.deselectAll();

        selectionEnd = event.point;

        const itemsInSelection = paper.project.getItems({
            overlapping: selectionRect
        });

        for (let i = 0; i < itemsInSelection.length; i++) {
            itemsInSelection[i].selected = true;
        }

        selectionRect?.remove();
        selectionRect = null;
    }

    tool.onDeactivate = function() {
        selectionRect?.remove();
        selectionRect = null;

        paper.project.deselectAll();
    }

    return { onChoice };
};