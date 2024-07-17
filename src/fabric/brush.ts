import { Point, TEvent, Path, PencilBrush } from 'fabric';
import type { util } from 'fabric';

type TNotCloseCommand =
  | util.TParsedAbsoluteMoveToCommand
  | util.TParsedAbsoluteLineCommand
  | util.TParsedAbsoluteCubicCurveCommand
  | util.TParsedAbsoluteQuadraticCurveCommand;

class ContinuingPencilBrush extends PencilBrush {
  public continuationThreshold = 50; // Adjust this threshold as needed
  public computedContinuationThreshold = this.continuationThreshold;

  public minTrailLength = 2;
  public maxTrailLength = 10;
  public arrowLength = 20;
  public arrowAngle = 45 * Math.PI / 180;

  onMouseDown(pointer: Point, { e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {  // short circuit endpoint search if the event wouldn't trigger at all
      return;
    }

    const closestEndPoint = this.findClosestEndPoint(pointer);
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

  createPath(pathData: util.TSimplePathData): Path {
    let pathWithArrow = this._drawArrow(pathData);

    return super.createPath(pathWithArrow);
  }

  _drawArrow(pathData: util.TSimplePathData) {
    let segments = pathData; // as (util.TParsedAbsoluteLineCommand | util.TParsedAbsoluteQuadraticCurveCommand | util.TParsedMoveToCommand)[];
    if (segments.length < 2) return segments;

    const trailLength = Math.min(Math.max(segments.length, this.minTrailLength), this.maxTrailLength);
    let arrowVector = new Point(0, 0);

    for (let i = segments.length - trailLength; i < segments.length - 1; i++) {
      if (segments[i][0] === 'Z') continue; // skip the Z command (close path)
      if (segments[i + 1][0] === 'Z') continue; // skip the Z command (close path)

      const segment1 = segments[i] as TNotCloseCommand;
      const segment2 = segments[i + 1] as TNotCloseCommand;
      const p1 = new Point(segment1[1], segment1[2]);
      const p2 = new Point(segment2[1], segment2[2]);
      arrowVector = arrowVector.add(p2.subtract(p1));
    }
    arrowVector = arrowVector.scalarDivide(trailLength);

    const arrowHead = arrowVector.setXY(
      (arrowVector.x * this.arrowLength) / arrowVector.distanceFrom({ x: 0, y: 0 }),
      (arrowVector.y * this.arrowLength) / arrowVector.distanceFrom({ x: 0, y: 0 })
    );

    const arrowLeft = arrowHead.rotate(this.arrowAngle + Math.PI);
    const arrowRight = arrowHead.rotate(-this.arrowAngle + Math.PI);

    // region: find the last segment that isn't a close path
    let i = 1;
    while (segments[segments.length - i][0] === 'Z' && i <= segments.length) i--; // go back to a segment that isn't close path
    if (i > segments.length) {
      return segments; // no path to draw arrow on
    }
    const endPoint = segments[segments.length - i] as TNotCloseCommand;
    // endregion: find the last segment that isn't a close path

    const pointer = new Point(endPoint[1], endPoint[2]);

    segments = segments.concat([
      ['M', pointer.x + arrowLeft.x, pointer.y + arrowLeft.y],
      ['L', pointer.x, pointer.y],
      ['L', pointer.x + arrowRight.x, pointer.y + arrowRight.y]
    ]);


    return segments;
  }
}

export default ContinuingPencilBrush;
