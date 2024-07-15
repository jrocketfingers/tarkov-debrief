import { Canvas, Point, TEvent, Path, PencilBrush } from 'fabric';

class ContinuingPencilBrush extends PencilBrush {
  public continuationThreshold = 50; // Adjust this threshold as needed
  public computedContinuationThreshold = this.continuationThreshold;

  private endpoints: Point[] = [];

  onMouseDown(pointer: Point, { e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {  // short circuit endpoint search if the event wouldn't trigger at all
      return;
    }

    const closestEndPoint = this.findClosestEndPoint(pointer);
    if (closestEndPoint && this.distance(pointer, closestEndPoint) < this.computedContinuationThreshold) {
      super.onMouseDown(closestEndPoint, { e });
    } else {
      super.onMouseDown(pointer, { e });
    }
  }

  findClosestEndPoint(pointer: Point): Point | null {
    let closestPoint: Point | null = null;
    let minDistance = Infinity;

    this.canvas.getObjects().forEach(obj => {
      if (obj instanceof Path) {
        const path = obj as Path;
        const pathEndPoint = this.getPathEndPoint(path);

        if (!pathEndPoint) {
          return;
        }

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
  getPathEndPoint(path: Path): Point | null {

    const pathData = path.path;
    const lastCommand = pathData[pathData.length - 1];

    if (lastCommand[0] === 'Z') {
      return null;
    }

    return new Point(lastCommand[1], lastCommand[2]); // [0] is the command type -- we just care about coords
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

export default ContinuingPencilBrush;
