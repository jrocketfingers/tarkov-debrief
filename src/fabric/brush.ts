import { Point, TEvent, Path, PencilBrush, Group } from 'fabric';
import type { util } from 'fabric';

class ContinuingPencilBrush extends PencilBrush {
  public continuationThreshold = 50; // Adjust this threshold as needed
  public computedContinuationThreshold = this.continuationThreshold;

  public minTrailLength = 2;
  public maxTrailLength = 10;
  public arrowLength = 20;
  public arrowAngle = 45 * Math.PI / 180;

  private _arrow: Path | undefined;

  _prepareArrow() {
    this._arrow = new Path([
      ["M", 0, 0],
      ["L", 0, this.arrowLength],
      ["M", 0, 0],
      ["L", this.arrowLength, 0],
    ], {
      fill: null,
      stroke: this.color,
      strokeWidth: this.width,
      strokeLineCap: this.strokeLineCap,
      strokeMiterLimit: this.strokeMiterLimit,
      strokeLineJoin: this.strokeLineJoin,
      strokeDashArray: this.strokeDashArray,
    });
  }

  onMouseDown(pointer: Point, { e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {  // short circuit endpoint search if the event wouldn't trigger at all
      return;
    }

    this._prepareArrow();

    const closestEndPoint = this.findClosestEndPoint(pointer); // are we continuing a path?
    if (closestEndPoint && this._distance(pointer, closestEndPoint) < this.computedContinuationThreshold) {
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

        const distance = this._distance(pointer, pathEndPoint);

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
  _distance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  createPath(pathData: util.TSimplePathData): Group {
    let pathWithArrow = this._placeArrow(pathData);

    const strokePath = super.createPath(pathWithArrow);
    const strokeWithArrow = new Group([strokePath, this._arrow]);

    return strokeWithArrow;
  }

  _getPoints(): Point[] {
    return (this as any)._points;
  }

  _addPoint(point: Point): boolean {
    const result = super._addPoint(point);

    const points = this._getPoints();

    return result
  }

  _placeArrow(points: Point[]) {
    if (points.length < 2) return points;

    const trailLength = Math.min(Math.max(points.length, this.minTrailLength), this.maxTrailLength);
    let arrowVector = new Point(0, 0);

    for (let i = points.length - trailLength; i < points.length - 1; i++) {
      const p1 = new Point(points[i].x, points[i].y);
      const p2 = new Point(points[i + 1].x, points[i + 1].y);
      arrowVector = arrowVector.add(p2.subtract(p1));
    }
    arrowVector = arrowVector.scalarDivide(trailLength);

    const arrowHead = arrowVector.setXY(
      (arrowVector.x * this.arrowLength) / arrowVector.distanceFrom({ x: 0, y: 0 }),
      (arrowVector.y * this.arrowLength) / arrowVector.distanceFrom({ x: 0, y: 0 })
    );

    const arrowLeft = arrowHead.rotate(this.arrowAngle + Math.PI);
    const arrowRight = arrowHead.rotate(-this.arrowAngle + Math.PI);

    const pointer = points[points.length - 1];

    this._arrow.translateTo(pointer.x, pointer.y);
    this._arrow.rotate(arrowHead.angleFrom({ x: 0, y: 0 }));

    return points;
  }
}

export default ContinuingPencilBrush;
