import type {
  Bounds,
  Camera,
  CursorSlideOptions,
  CursorSlideResult,
  Point2D,
  Rect,
  Stroke,
  StrokePoint,
} from './model';

/**
 * Converts screen (CSS pixel) coordinates to world coordinates.
 */
export function screenToWorld(sx: number, sy: number, camera: Camera): { x: number; y: number } {
  return {
    x: camera.x + sx / camera.zoom,
    y: camera.y + sy / camera.zoom,
  };
}

/**
 * Converts world coordinates to screen (CSS pixel) coordinates.
 */
export function worldToScreen(wx: number, wy: number, camera: Camera): { x: number; y: number } {
  return {
    x: (wx - camera.x) * camera.zoom,
    y: (wy - camera.y) * camera.zoom,
  };
}

/**
 * Converts a normalised phone pointer delta into world-unit displacement.
 *
 * Design rationale (relative/delta mapping for Move Window / Move Cursor mode):
 *   - dxNorm = Δu, dyNorm = Δv in tablet-aligned [0, 1] coordinates.
 *   - A full swipe along the phone's longest physical edge moves the cursor/window
 *     by `viewportW / camera.zoom * sensitivity` world units.
 *   - Using the longest edge as the reference keeps physical mm-to-world sensitivity
 *     identical between portrait (aspect < 1) and landscape (aspect > 1) while
 *     preserving isotropic 1:1 movement so square gestures stay square.
 */
export function normDeltaToWorld(
  dxNorm: number,
  dyNorm: number,
  phoneAspect: number,
  camera: Camera,
  viewportW: number,
  sensitivity = 1.0,
): { dx: number; dy: number } {
  const safeAspect = phoneAspect > 0 ? phoneAspect : 1;
  const unitsPerSwipe = (viewportW / camera.zoom) * sensitivity;
  if (safeAspect <= 1) {
    return {
      dx: dxNorm * safeAspect * unitsPerSwipe,
      dy: dyNorm * unitsPerSwipe,
    };
  }
  return {
    dx: dxNorm * unitsPerSwipe,
    dy: (dyNorm / safeAspect) * unitsPerSwipe,
  };
}

/**
 * Computes the Writing Window rectangle in world coordinates, centred at `center`.
 *
 * The window fits inside `fillRatio` of the visible desktop viewport while strictly
 * preserving `phoneAspect` (= tabletW / tabletH), guaranteeing isotropic 1:1 drawing
 * in both vertical and horizontal phone modes across any zoom level.
 */
export function computeWritingWindow(
  center: { x: number; y: number },
  phoneAspect: number,
  camera: Camera,
  viewportW: number,
  viewportH: number,
  fillRatio = 0.78,
): Rect {
  const safeAspect = phoneAspect > 0 ? phoneAspect : 9 / 16;
  const maxW = (viewportW / camera.zoom) * fillRatio;
  const maxH = (viewportH / camera.zoom) * fillRatio;

  let w: number;
  let h: number;
  if (maxW / maxH > safeAspect) {
    h = maxH;
    w = h * safeAspect;
  } else {
    w = maxW;
    h = w / safeAspect;
  }

  return {
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
  };
}

/**
 * Maps normalized tablet coordinates (u, v) in [0, 1]² directly into world
 * coordinates inside the given Writing Window.
 */
export function windowNormToWorld(u: number, v: number, win: Rect): { x: number; y: number } {
  return {
    x: win.x + u * win.w,
    y: win.y + v * win.h,
  };
}

/**
 * Computes the Writing Window centre in world coordinates so that the given
 * normalised tablet contact `normPoint` maps directly to `targetWorld` while
 * preserving the window's isotropic aspect-locked dimensions.
 */
export function alignWritingWindowCenter(
  normPoint: Point2D,
  targetWorld: Point2D,
  phoneAspect: number,
  camera: Camera,
  viewportW: number,
  viewportH: number,
  fillRatio = 0.78,
): Point2D {
  const win = computeWritingWindow(
    targetWorld,
    phoneAspect,
    camera,
    viewportW,
    viewportH,
    fillRatio,
  );
  return {
    x: targetWorld.x - (normPoint.x - 0.5) * win.w,
    y: targetWorld.y - (normPoint.y - 0.5) * win.h,
  };
}

/**
 * Advances a rendered cursor position toward `target` using frame-rate-independent
 * exponential smoothing (`1 - exp(-dtMs / tauMs)`), snapping cleanly within `epsilon`.
 */
export function stepCursorPosition(
  display: Point2D,
  target: Point2D,
  dtMs: number,
  options?: CursorSlideOptions,
): CursorSlideResult {
  const tauMs = options?.tauMs ?? 38;
  const epsilon = Math.max(0, options?.epsilon ?? 0.25);
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;

  const dx = target.x - display.x;
  const dy = target.y - display.y;
  const epsSq = epsilon * epsilon;
  if (dx * dx + dy * dy <= epsSq) {
    return { x: target.x, y: target.y, settled: true };
  }
  if (dt === 0) {
    return { x: display.x, y: display.y, settled: false };
  }
  if (tauMs <= 0) {
    return { x: target.x, y: target.y, settled: true };
  }

  const alpha = 1 - Math.exp(-dt / tauMs);
  const nx = display.x + dx * alpha;
  const ny = display.y + dy * alpha;
  const rx = target.x - nx;
  const ry = target.y - ny;
  if (rx * rx + ry * ry <= epsSq) {
    return { x: target.x, y: target.y, settled: true };
  }
  return { x: nx, y: ny, settled: false };
}

export function appendPointToBounds(bounds: Bounds, pt: Point2D): Bounds {
  return {
    minX: pt.x < bounds.minX ? pt.x : bounds.minX,
    minY: pt.y < bounds.minY ? pt.y : bounds.minY,
    maxX: pt.x > bounds.maxX ? pt.x : bounds.maxX,
    maxY: pt.y > bounds.maxY ? pt.y : bounds.maxY,
  };
}

export function computeBounds(points: StrokePoint[]): Bounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Squared distance from point `p` to line segment `ab`. */
export function pointToSegmentDistSq(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/**
 * Returns true if `pt` is within `radius` (plus half stroke width) of any
 * segment of `stroke`. Uses bounding-box rejection first for speed.
 */
export function hitTestStroke(
  stroke: Pick<Stroke, 'bounds' | 'points' | 'baseWidth' | 'tool'>,
  pt: Point2D,
  radius: number,
): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;
  const halfW = (stroke.tool === 'highlighter' ? stroke.baseWidth * 4 : stroke.baseWidth) / 2;
  const r = Math.max(0, radius) + halfW;

  if (
    pt.x < stroke.bounds.minX - r ||
    pt.x > stroke.bounds.maxX + r ||
    pt.y < stroke.bounds.minY - r ||
    pt.y > stroke.bounds.maxY + r
  ) {
    return false;
  }

  const rSq = r * r;
  if (pts.length === 1) {
    const dx = pt.x - pts[0].x;
    const dy = pt.y - pts[0].y;
    return dx * dx + dy * dy <= rSq;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegmentDistSq(pt, pts[i], pts[i + 1]) <= rSq) {
      return true;
    }
  }
  return false;
}

/** Computes the combined world-space bounds of all strokes, or null if empty. */
export function computeBoardBounds(strokes: Pick<Stroke, 'bounds'>[]): Bounds | null {
  if (strokes.length === 0) return null;
  let minX = strokes[0].bounds.minX;
  let minY = strokes[0].bounds.minY;
  let maxX = strokes[0].bounds.maxX;
  let maxY = strokes[0].bounds.maxY;
  for (let i = 1; i < strokes.length; i++) {
    const b = strokes[i].bounds;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Computes a Camera that fits all `strokes` comfortably inside the viewport,
 * clamped to `[0.2, 4]`. Returns null if there are no strokes.
 */
export function computeFitCamera(
  strokes: Pick<Stroke, 'bounds'>[],
  viewportW: number,
  viewportH: number,
  padding = 64,
): Camera | null {
  const b = computeBoardBounds(strokes);
  if (!b) return null;
  const contentW = Math.max(1, b.maxX - b.minX);
  const contentH = Math.max(1, b.maxY - b.minY);
  const availW = Math.max(40, viewportW - padding * 2);
  const availH = Math.max(40, viewportH - padding * 2);
  const zoom = Math.min(4, Math.max(0.2, Math.min(availW / contentW, availH / contentH)));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    x: cx - viewportW / (2 * zoom),
    y: cy - viewportH / (2 * zoom),
    zoom,
  };
}

/**
 * Builds a reusable Path2D for strokes with 2+ points using Quadratic Bezier
 * midpoint smoothing. Returns null in non-DOM environments or for <2 points.
 */
export function buildStrokePath2D(points: Pick<StrokePoint, 'x' | 'y'>[]): Path2D | null {
  if (typeof Path2D === 'undefined' || points.length < 2) return null;
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    path.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      path.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    path.lineTo(last.x, last.y);
  }
  return path;
}

/**
 * Renders a stroke using Quadratic Bezier midpoint smoothing.
 * The ctx must already be transformed into world (or target) space.
 */
export function renderSmoothStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'tool' | 'color' | 'baseWidth' | 'points'>,
  cachedPath: Path2D | null = null,
  alpha = 1,
): void {
  const pts = stroke.points;
  if (pts.length === 0 || alpha <= 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = (stroke.tool === 'highlighter' ? 0.35 : 1) * alpha;
  ctx.lineWidth = stroke.tool === 'highlighter' ? stroke.baseWidth * 4 : stroke.baseWidth;

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (cachedPath) {
    ctx.stroke(cachedPath);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  ctx.stroke();
  ctx.restore();
}
