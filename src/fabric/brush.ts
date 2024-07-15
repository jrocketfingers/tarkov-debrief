import { Canvas, Point, TEvent, Path, PencilBrush } from 'fabric';

class CustomFreeDrawingBrush extends PencilBrush {
  private thresholdDistance = 10; // Adjust this threshold as needed

  constructor(canvas: Canvas) {
    super(canvas);
  }

  /**
   * Override onMouseDown to check for closest end point
   * @param {Point} pointer
   * @param {TEvent} event
   */
  onMouseDown(pointer: Point, { e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    this.drawStraightLine = !!this.straightLineKey && e[this.straightLineKey];

    const closestEndPoint = this.findClosestEndPoint(pointer);
    if (closestEndPoint && this.distance(pointer, closestEndPoint) < this.thresholdDistance) {
      this._prepareForDrawing(closestEndPoint);
    } else {
      this._prepareForDrawing(pointer);
    }

    this._addPoint(pointer);
    this._render();
  }

  /**
   * Find the closest end point to the given pointer
   * @param {Point} pointer
   * @returns {Point | null} closest end point or null if none found
   */
  findClosestEndPoint(pointer: Point): Point | null {
    let closestPoint: Point | null = null;
    let minDistance = Infinity;

    this.canvas.getObjects().forEach(obj => {
      if (obj instanceof Path) {
        const path = obj as Path;
        const pathEndPoint = this.getPathEndPoint(path);
        const distance = this.distance(pointer, pathEndPoint);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = pathEndPoint;
        }
      }
    });

    return closestPoint;
  }

  /**
   * Get the end point of a path
   * @param {Path} path
   * @returns {Point} end point of the path
   */
  getPathEndPoint(path: Path): Point {
    const pathData = path.path;
    const lastCommand = pathData[pathData.length - 1];
    const lastCoords = lastCommand.slice(-2);

    return new Point(lastCoords[0], lastCoords[1]);
  }

  /**
   * Calculate the distance between two points
   * @param {Point} p1
   * @param {Point} p2
   * @returns {number} distance between points
   */
  distance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

export default CustomFreeDrawingBrush;
