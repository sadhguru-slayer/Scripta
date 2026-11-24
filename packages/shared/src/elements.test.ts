import { describe, expect, it } from 'vitest';
import {
  buildOrthogonalPath,
  computeShapeBounds,
  findSnapAnchor,
  getConnectorMidpoint,
  hitTestElement,
  intersectShapeBoundary,
  normalizeRect,
  resolveConnectorEndpoints,
  snapLineEnd,
  syncBoundConnectors,
  translateElement,
} from './elements';
import type { BoardElement, ConnectorElement, ShapeElement } from './model';

function makeRect(id: string, x: number, y: number, w: number, h: number): ShapeElement {
  return {
    id,
    kind: 'shape',
    shape: 'rect',
    x,
    y,
    w,
    h,
    color: '#38bdf8',
    strokeWidth: 2,
    bounds: computeShapeBounds({ x, y, w, h }),
    createdAt: 0,
  };
}

describe('normalizeRect & snapLineEnd', () => {
  it('normalizes negative drag directions and square constraint', () => {
    const r = normalizeRect({ x: 100, y: 100 }, { x: 40, y: 60 }, false);
    expect(r).toEqual({ x: 40, y: 60, w: 60, h: 40 });

    const sq = normalizeRect({ x: 100, y: 100 }, { x: 40, y: 60 }, true);
    expect(sq).toEqual({ x: 40, y: 40, w: 60, h: 60 });
  });

  it('snaps lines to 15-degree increments when enabled', () => {
    const end = snapLineEnd({ x: 0, y: 0 }, { x: 100, y: 4 }, true);
    expect(end.x).toBeCloseTo(100.08, 1);
    expect(end.y).toBeCloseTo(0, 4);
  });
});

describe('intersectShapeBoundary', () => {
  it('clips exactly onto rect, ellipse, and diamond perimeters', () => {
    const rect = makeRect('r1', 0, 0, 100, 60); // center (50, 30)
    expect(intersectShapeBoundary(rect, { x: 250, y: 30 })).toEqual({ x: 100, y: 30 });
    expect(intersectShapeBoundary(rect, { x: 50, y: -50 })).toEqual({ x: 50, y: 0 });

    const ell: ShapeElement = { ...rect, id: 'e1', shape: 'ellipse' };
    const ePt = intersectShapeBoundary(ell, { x: 50 + 50, y: 30 + 30 });
    const normEllipse = ((ePt.x - 50) / 50) ** 2 + ((ePt.y - 30) / 30) ** 2;
    expect(normEllipse).toBeCloseTo(1, 5);

    const dia: ShapeElement = { ...rect, id: 'd1', shape: 'diamond' };
    const dPt = intersectShapeBoundary(dia, { x: 50 + 80, y: 30 + 40 });
    const normDiamond = Math.abs(dPt.x - 50) / 50 + Math.abs(dPt.y - 30) / 30;
    expect(normDiamond).toBeCloseTo(1, 5);
  });
});

describe('smart connector snapping & live binding', () => {
  it('snaps to nearest cardinal port or shape interior and follows shape translation', () => {
    const a = makeRect('a', 0, 0, 100, 60);     // right port at (100, 30)
    const b = makeRect('b', 200, 0, 100, 60);   // left port at (200, 30)
    const elements: BoardElement[] = [a, b];

    const snapStart = findSnapAnchor({ x: 98, y: 31 }, elements, 16);
    expect(snapStart?.binding).toEqual({ elementId: 'a', anchor: 'right' });

    const snapInside = findSnapAnchor({ x: 250, y: 30 }, elements, 4);
    expect(snapInside?.binding).toEqual({ elementId: 'b', anchor: 'center' });

    const conn: ConnectorElement = {
      id: 'c1',
      kind: 'connector',
      variant: 'arrow',
      routing: 'straight',
      start: snapStart!.pt,
      end: snapInside!.pt,
      startBinding: snapStart!.binding,
      endBinding: snapInside!.binding,
      color: '#f8fafc',
      strokeWidth: 2,
      bounds: { minX: 100, minY: 20, maxX: 200, maxY: 40 },
      createdAt: 0,
    };

    // Move shape b down by 100px
    elements[1] = translateElement(b, 0, 100) as ShapeElement;
    elements.push(conn);
    const updated = syncBoundConnectors(elements);
    const synced = updated.get('c1')!;
    expect(synced.start).toEqual({ x: 100, y: 30 });
    // 'center' binding trims neatly onto b's perimeter rather than poking to its center
    expect(synced.end.x).toBeGreaterThanOrEqual(200);
    expect(synced.end.y).toBeGreaterThanOrEqual(100);

    const byId = new Map(elements.map((e) => [e.id, e]));
    const resolved = resolveConnectorEndpoints(synced, byId);
    expect(resolved.end).toEqual(synced.end);
  });

  it('routes orthogonal workflow connectors cleanly based on port sides', () => {
    const path = buildOrthogonalPath({ x: 50, y: 60 }, { x: 150, y: 200 }, 'bottom', 'top');
    expect(path).toEqual([
      { x: 50, y: 60 },
      { x: 50, y: 130 },
      { x: 150, y: 130 },
      { x: 150, y: 200 },
    ]);
  });

  it('hitTests shapes and connectors accurately', () => {
    const r = makeRect('r', 10, 10, 80, 40);
    expect(hitTestElement(r, { x: 50, y: 30 }, 4)).toBe(true);
    expect(hitTestElement(r, { x: 120, y: 30 }, 4)).toBe(false);

    const conn: ConnectorElement = {
      id: 'c2',
      kind: 'connector',
      variant: 'line',
      routing: 'orthogonal',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      startBinding: { elementId: 'x', anchor: 'right' },
      endBinding: { elementId: 'y', anchor: 'right' },
      color: '#fff',
      strokeWidth: 2,
      bounds: { minX: -10, minY: -10, maxX: 110, maxY: 110 },
      createdAt: 0,
    };
    expect(hitTestElement(conn, { x: 50, y: 48 }, 6)).toBe(true);
    expect(hitTestElement(conn, { x: 10, y: 80 }, 6)).toBe(false);
  });

  it('computes midpoint accurately for straight and orthogonal connectors', () => {
    const straight: ConnectorElement = {
      id: 'cs',
      kind: 'connector',
      variant: 'arrow',
      routing: 'straight',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 60 },
      color: '#fff',
      strokeWidth: 2,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
      createdAt: 0,
    };
    expect(getConnectorMidpoint(straight)).toEqual({ x: 50, y: 30 });

    const elbow: ConnectorElement = {
      ...straight,
      id: 'ce',
      routing: 'orthogonal',
      startBinding: { elementId: 'a', anchor: 'bottom' },
      endBinding: { elementId: 'b', anchor: 'top' },
    };
    expect(getConnectorMidpoint(elbow)).toEqual({ x: 50, y: 30 });
  });
});
