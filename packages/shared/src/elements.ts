import {
  boundsIntersect,
  computeBounds,
  hitTestStroke,
  pointToSegmentDistSq,
  renderSmoothStroke,
} from './geometry';
import type {
  AnchorSide,
  BoardElement,
  Bounds,
  ConnectorElement,
  ElementBinding,
  Point2D,
  Rect,
  ShapeElement,
  Stroke,
  StrokeStyle,
} from './model';

export function isShapeElement(el: BoardElement): el is ShapeElement {
  return el.kind === 'shape';
}

export function isConnectorElement(el: BoardElement): el is ConnectorElement {
  return el.kind === 'connector';
}

export function isStrokeElement(el: BoardElement): el is Stroke {
  return !el.kind || el.kind === 'stroke';
}

/**
 * Normalises drag start/end coordinates into a positive-size rectangle.
 * When `lockSquare` is true (Shift held), constrains width and height to match.
 */
export function normalizeRect(start: Point2D, end: Point2D, lockSquare = false): Rect {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (lockSquare) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  return {
    x: dx < 0 ? start.x + dx : start.x,
    y: dy < 0 ? start.y + dy : start.y,
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

/**
 * Snaps `end` around `start` to 15-degree angle increments when `snapAngle` is true.
 */
export function snapLineEnd(start: Point2D, end: Point2D, snapAngle = false): Point2D {
  if (!snapAngle) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return end;
  const step = Math.PI / 12; // 15°
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: start.x + Math.cos(angle) * len,
    y: start.y + Math.sin(angle) * len,
  };
}

export function computeShapeBounds(shape: Pick<ShapeElement, 'x' | 'y' | 'w' | 'h'>): Bounds {
  return {
    minX: shape.x,
    minY: shape.y,
    maxX: shape.x + shape.w,
    maxY: shape.y + shape.h,
  };
}

export function getShapeAnchorPoint(shape: ShapeElement, side: AnchorSide): Point2D {
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  switch (side) {
    case 'top':    return { x: cx, y: shape.y };
    case 'right':  return { x: shape.x + shape.w, y: cy };
    case 'bottom': return { x: cx, y: shape.y + shape.h };
    case 'left':   return { x: shape.x, y: cy };
    case 'center': return { x: cx, y: cy };
  }
}

export function getShapeAnchors(shape: ShapeElement): { side: AnchorSide; pt: Point2D }[] {
  return [
    { side: 'top',    pt: getShapeAnchorPoint(shape, 'top') },
    { side: 'right',  pt: getShapeAnchorPoint(shape, 'right') },
    { side: 'bottom', pt: getShapeAnchorPoint(shape, 'bottom') },
    { side: 'left',   pt: getShapeAnchorPoint(shape, 'left') },
    { side: 'center', pt: getShapeAnchorPoint(shape, 'center') },
  ];
}

/**
 * Exact ray-to-perimeter intersection from a shape's centre toward `toward`.
 */
export function intersectShapeBoundary(shape: ShapeElement, toward: Point2D): Point2D {
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const rx = shape.w / 2;
  const ry = shape.h / 2;
  if (rx <= 0 || ry <= 0) return { x: cx, y: cy };

  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  let t: number;
  if (shape.shape === 'ellipse') {
    t = 1 / Math.hypot(dx / rx, dy / ry);
  } else if (shape.shape === 'diamond') {
    t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  } else {
    t = 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  }

  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Finds the nearest magnetic anchor port across all shapes within `snapRadius`.
 * Also snaps to `'center'` if `pt` falls inside a shape and no edge port is closer.
 */
export function findSnapAnchor(
  pt: Point2D,
  elements: BoardElement[],
  snapRadius: number,
  excludeId?: string,
): { binding: ElementBinding; pt: Point2D; shape: ShapeElement } | null {
  let bestDistSq = snapRadius * snapRadius;
  let best: { binding: ElementBinding; pt: Point2D; shape: ShapeElement } | null = null;

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isShapeElement(el) || el.id === excludeId) continue;

    if (
      pt.x < el.bounds.minX - snapRadius ||
      pt.x > el.bounds.maxX + snapRadius ||
      pt.y < el.bounds.minY - snapRadius ||
      pt.y > el.bounds.maxY + snapRadius
    ) {
      continue;
    }

    for (const anchor of getShapeAnchors(el)) {
      const dx = pt.x - anchor.pt.x;
      const dy = pt.y - anchor.pt.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        best = {
          binding: { elementId: el.id, anchor: anchor.side },
          pt: anchor.pt,
          shape: el,
        };
      }
    }

    // Interior fallback → bind to center so arrows trim cleanly at the boundary
    if (
      !best &&
      pt.x >= el.bounds.minX &&
      pt.x <= el.bounds.maxX &&
      pt.y >= el.bounds.minY &&
      pt.y <= el.bounds.maxY
    ) {
      best = {
        binding: { elementId: el.id, anchor: 'center' },
        pt: getShapeAnchorPoint(el, 'center'),
        shape: el,
      };
    }
  }

  return best;
}

/**
 * Resolves live world-space endpoints of a connector, projecting `'center'`
 * bindings onto the bound shape's geometric perimeter.
 */
export function resolveConnectorEndpoints(
  conn: ConnectorElement,
  elementsById: Map<string, BoardElement>,
): { start: Point2D; end: Point2D } {
  const startEl = conn.startBinding ? elementsById.get(conn.startBinding.elementId) : undefined;
  const endEl   = conn.endBinding   ? elementsById.get(conn.endBinding.elementId)   : undefined;

  const startShape = startEl && isShapeElement(startEl) ? startEl : null;
  const endShape   = endEl   && isShapeElement(endEl)   ? endEl   : null;

  let rawStart = startShape && conn.startBinding
    ? getShapeAnchorPoint(startShape, conn.startBinding.anchor)
    : conn.start;
  let rawEnd = endShape && conn.endBinding
    ? getShapeAnchorPoint(endShape, conn.endBinding.anchor)
    : conn.end;

  if (startShape && conn.startBinding?.anchor === 'center') {
    rawStart = intersectShapeBoundary(startShape, rawEnd);
  }
  if (endShape && conn.endBinding?.anchor === 'center') {
    rawEnd = intersectShapeBoundary(endShape, rawStart);
  }

  return { start: rawStart, end: rawEnd };
}

/**
 * Builds an orthogonal elbow polyline between `start` and `end`,
 * respecting cardinal port exit/entry directions.
 */
export function buildOrthogonalPath(
  start: Point2D,
  end: Point2D,
  startSide?: AnchorSide,
  endSide?: AnchorSide,
): Point2D[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) {
    return [start, end];
  }

  const startAxis =
    startSide === 'left' || startSide === 'right' ? 'h'
    : startSide === 'top' || startSide === 'bottom' ? 'v'
    : Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';

  const endAxis =
    endSide === 'left' || endSide === 'right' ? 'h'
    : endSide === 'top' || endSide === 'bottom' ? 'v'
    : startAxis;

  if (startAxis === 'h' && endAxis === 'h') {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (startAxis === 'v' && endAxis === 'v') {
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  if (startAxis === 'h' && endAxis === 'v') {
    return [start, { x: end.x, y: start.y }, end];
  }
  return [start, { x: start.x, y: end.y }, end];
}

export function getConnectorPathPoints(
  conn: ConnectorElement,
  start: Point2D,
  end: Point2D,
): Point2D[] {
  if (conn.routing === 'orthogonal') {
    return buildOrthogonalPath(
      start,
      end,
      conn.startBinding?.anchor,
      conn.endBinding?.anchor,
    );
  }
  return [start, end];
}

export function computeConnectorBounds(
  conn: ConnectorElement,
  start: Point2D = conn.start,
  end: Point2D = conn.end,
): Bounds {
  const pts = getConnectorPathPoints(conn, start, end);
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  const pad = Math.max(8, conn.strokeWidth * 3);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

export function hitTestShape(shape: ShapeElement, pt: Point2D, radius: number): boolean {
  const r = Math.max(0, radius) + shape.strokeWidth / 2;
  if (
    pt.x < shape.bounds.minX - r ||
    pt.x > shape.bounds.maxX + r ||
    pt.y < shape.bounds.minY - r ||
    pt.y > shape.bounds.maxY + r
  ) {
    return false;
  }

  // Filled interior or labelled shape can be selected/erased cleanly inside too
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const rx = Math.max(1, shape.w / 2);
  const ry = Math.max(1, shape.h / 2);
  const nx = (pt.x - cx) / (rx + r);
  const ny = (pt.y - cy) / (ry + r);

  if (shape.shape === 'ellipse') {
    return nx * nx + ny * ny <= 1;
  }
  if (shape.shape === 'diamond') {
    return Math.abs(nx) + Math.abs(ny) <= 1;
  }
  return true;
}

export function hitTestConnector(
  conn: ConnectorElement,
  pt: Point2D,
  radius: number,
  elementsById?: Map<string, BoardElement>,
): boolean {
  const { start, end } = elementsById
    ? resolveConnectorEndpoints(conn, elementsById)
    : { start: conn.start, end: conn.end };
  const pts = getConnectorPathPoints(conn, start, end);
  const r = Math.max(0, radius) + conn.strokeWidth / 2;
  const rSq = r * r;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegmentDistSq(pt, pts[i], pts[i + 1]) <= rSq) {
      return true;
    }
  }
  return false;
}

export function hitTestElement(
  el: BoardElement,
  pt: Point2D,
  radius: number,
  elementsById?: Map<string, BoardElement>,
): boolean {
  if (isShapeElement(el)) return hitTestShape(el, pt, radius);
  if (isConnectorElement(el)) return hitTestConnector(el, pt, radius, elementsById);
  return hitTestStroke(el, pt, radius);
}

export function translateElement(el: BoardElement, dx: number, dy: number): BoardElement {
  if (isShapeElement(el)) {
    const x = el.x + dx;
    const y = el.y + dy;
    return {
      ...el,
      x,
      y,
      bounds: computeShapeBounds({ x, y, w: el.w, h: el.h }),
    };
  }
  if (isConnectorElement(el)) {
    const start = { x: el.start.x + dx, y: el.start.y + dy };
    const end   = { x: el.end.x + dx, y: el.end.y + dy };
    return {
      ...el,
      start,
      end,
      bounds: computeConnectorBounds(el, start, end),
    };
  }
  const points = el.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  return {
    ...el,
    points,
    bounds: computeBounds(points),
  };
}

/**
 * Recomputes bounds & endpoints of any connectors attached to moved/resized shapes.
 */
export function syncBoundConnectors(elements: BoardElement[]): Map<string, ConnectorElement> {
  const byId = new Map<string, BoardElement>();
  for (const el of elements) byId.set(el.id, el);

  const updated = new Map<string, ConnectorElement>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!isConnectorElement(el) || (!el.startBinding && !el.endBinding)) continue;
    const { start, end } = resolveConnectorEndpoints(el, byId);
    const next: ConnectorElement = {
      ...el,
      start,
      end,
      bounds: computeConnectorBounds(el, start, end),
    };
    elements[i] = next;
    updated.set(el.id, next);
  }
  return updated;
}

// ── Canvas 2D Element Rendering ──────────────────────────────────────────────

function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  style: StrokeStyle | undefined,
  strokeWidth: number,
): void {
  if (style === 'dashed') {
    ctx.setLineDash([Math.max(6, strokeWidth * 3.5), Math.max(4, strokeWidth * 2.2)]);
  } else if (style === 'dotted') {
    ctx.setLineDash([0.5, Math.max(4, strokeWidth * 2.4)]);
  } else {
    ctx.setLineDash([]);
  }
}

export function getConnectorMidpoint(
  conn: ConnectorElement,
  elementsById?: Map<string, BoardElement>,
): Point2D {
  const { start, end } = elementsById
    ? resolveConnectorEndpoints(conn, elementsById)
    : { start: conn.start, end: conn.end };
  const pts = getConnectorPathPoints(conn, start, end);
  if (pts.length === 2) {
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  const midIdx = Math.floor(pts.length / 2);
  return {
    x: (pts[midIdx - 1].x + pts[midIdx].x) / 2,
    y: (pts[midIdx - 1].y + pts[midIdx].y) / 2,
  };
}

export function renderShapeElement(ctx: CanvasRenderingContext2D, shape: ShapeElement): void {
  const { x, y, w, h, color, strokeWidth, strokeStyle, fill, label } = shape;
  if (w < 0.5 && h < 0.5) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = strokeWidth;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  ctx.beginPath();
  if (shape.shape === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
  } else if (shape.shape === 'diamond') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(x, cy);
    ctx.closePath();
  } else {
    const r = Math.min(8, w * 0.2, h * 0.2);
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  applyStrokeStyle(ctx, strokeStyle, strokeWidth);
  ctx.stroke();
  ctx.setLineDash([]);

  if (label && label.trim().length > 0) {
    const fontSize = Math.max(12, Math.min(20, Math.round(Math.min(w, h) * 0.24)));
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = label.split('\n');
    const lineHeight = fontSize * 1.25;
    const totalH = lines.length * lineHeight;
    const startY = y + h / 2 - totalH / 2 + lineHeight / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + w / 2, startY + i * lineHeight, Math.max(20, w - 16));
    }
  }

  ctx.restore();
}

export function renderConnectorElement(
  ctx: CanvasRenderingContext2D,
  conn: ConnectorElement,
  elementsById?: Map<string, BoardElement>,
): void {
  const { start, end } = elementsById
    ? resolveConnectorEndpoints(conn, elementsById)
    : { start: conn.start, end: conn.end };
  const pts = getConnectorPathPoints(conn, start, end);
  if (pts.length < 2) return;

  ctx.save();
  ctx.strokeStyle = conn.color;
  ctx.fillStyle   = conn.color;
  ctx.lineWidth   = conn.strokeWidth;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  // Trim end slightly for arrowhead so tip sits cleanly on endpoint
  const prev = pts[pts.length - 2];
  const tip  = pts[pts.length - 1];
  const adx  = tip.x - prev.x;
  const ady  = tip.y - prev.y;
  const segLen = Math.hypot(adx, ady);

  const headLen = Math.max(10, conn.strokeWidth * 3.5);
  const headAngle = Math.PI / 6.5;

  const drawPts = pts.map((p) => ({ ...p }));
  if (conn.variant === 'arrow' && segLen > 4) {
    const trim = Math.min(segLen * 0.4, headLen * 0.65);
    drawPts[drawPts.length - 1] = {
      x: tip.x - (adx / segLen) * trim,
      y: tip.y - (ady / segLen) * trim,
    };
  }

  ctx.beginPath();
  ctx.moveTo(drawPts[0].x, drawPts[0].y);
  if (drawPts.length === 2) {
    ctx.lineTo(drawPts[1].x, drawPts[1].y);
  } else {
    // Smooth rounded elbow corners on orthogonal workflow connectors
    for (let i = 1; i < drawPts.length - 1; i++) {
      const p0 = drawPts[i - 1];
      const p1 = drawPts[i];
      const p2 = drawPts[i + 1];
      const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const cornerR = Math.min(10, d1 * 0.45, d2 * 0.45);
      ctx.arcTo(p1.x, p1.y, p2.x, p2.y, cornerR);
    }
    const last = drawPts[drawPts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  applyStrokeStyle(ctx, conn.strokeStyle, conn.strokeWidth);
  ctx.stroke();
  ctx.setLineDash([]);

  if (conn.variant === 'arrow' && segLen > 1) {
    const angle = Math.atan2(ady, adx);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle - headAngle),
      tip.y - headLen * Math.sin(angle - headAngle),
    );
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle + headAngle),
      tip.y - headLen * Math.sin(angle + headAngle),
    );
    ctx.closePath();
    ctx.fill();
  }

  if (conn.label && conn.label.trim().length > 0) {
    const mid = getConnectorMidpoint(conn, elementsById);
    const text = conn.label.trim();
    ctx.font = '500 13px system-ui, -apple-system, sans-serif';
    const metrics = ctx.measureText(text);
    const padX = 7;
    const boxW = metrics.width + padX * 2;
    const boxH = 22;
    ctx.fillStyle = 'rgba(6, 9, 15, 0.9)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(mid.x - boxW / 2, mid.y - boxH / 2, boxW, boxH, 6);
      ctx.fill();
    } else {
      ctx.fillRect(mid.x - boxW / 2, mid.y - boxH / 2, boxW, boxH);
    }
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, mid.x, mid.y);
  }

  ctx.restore();
}

export function renderBoardElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  elementsById?: Map<string, BoardElement>,
  strokePathCache?: WeakMap<Stroke, Path2D>,
): void {
  if (isShapeElement(el)) {
    renderShapeElement(ctx, el);
    return;
  }
  if (isConnectorElement(el)) {
    renderConnectorElement(ctx, el, elementsById);
    return;
  }
  const cachedPath = strokePathCache ? (strokePathCache.get(el) ?? null) : null;
  renderSmoothStroke(ctx, el, cachedPath);
}

export function elementIntersectsBounds(el: BoardElement, viewBounds: Bounds): boolean {
  return boundsIntersect(el.bounds, viewBounds);
}
