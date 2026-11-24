import { describe, expect, it } from 'vitest';
import {
  alignWritingWindowCenter,
  appendPointToBounds,
  buildStrokePath2D,
  computeBounds,
  computeFitCamera,
  computeWritingWindow,
  hitTestStroke,
  normDeltaToWorld,
  screenToWorld,
  smoothPoint,
  stepCursorPosition,
  windowNormToWorld,
  worldToScreen,
} from './geometry';

describe('screenToWorld / worldToScreen round-trip', () => {
  it('inverts correctly at arbitrary camera state', () => {
    const cam = { x: 120, y: -40, zoom: 1.5 };
    const world = screenToWorld(300, 180, cam);
    const screen = worldToScreen(world.x, world.y, cam);
    expect(screen.x).toBeCloseTo(300, 6);
    expect(screen.y).toBeCloseTo(180, 6);
  });
});

describe('normDeltaToWorld', () => {
  it('full phone-width swipe covers full viewport width at zoom=1 for square pad', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const { dx } = normDeltaToWorld(1, 0, 1, cam, 1440);
    expect(dx).toBeCloseTo(1440);
  });

  it('full phone-width swipe covers half viewport width at zoom=2 (world units halved)', () => {
    const cam = { x: 0, y: 0, zoom: 2 };
    const { dx } = normDeltaToWorld(1, 0, 1, cam, 1440);
    // viewport / zoom = 720 world units visible → full swipe = 720 world units
    expect(dx).toBeCloseTo(720);
  });

  it('isotropic: physical square gesture produces equal world displacement in portrait', () => {
    const aspect = 9 / 19.5;
    const cam = { x: 0, y: 0, zoom: 1 };
    const dyNorm = 0.1;
    const dxNorm = dyNorm / aspect;
    const { dx, dy } = normDeltaToWorld(dxNorm, dyNorm, aspect, cam, 1000);
    expect(dx).toBeCloseTo(dy, 1);
  });

  it('isotropic: physical square gesture in landscape with consistent long-edge speed', () => {
    const aspect = 19.5 / 9; // landscape
    const cam = { x: 0, y: 0, zoom: 1 };
    const dxNorm = 0.1;
    const dyNorm = dxNorm * aspect;
    const { dx, dy } = normDeltaToWorld(dxNorm, dyNorm, aspect, cam, 1000);
    expect(dx).toBeCloseTo(dy, 1);
    // Full horizontal swipe across landscape phone covers 1x viewport width (not 2.16x)
    const fullHoriz = normDeltaToWorld(1, 0, aspect, cam, 1000);
    expect(fullHoriz.dx).toBeCloseTo(1000, 1);
  });

  it('sensitivity multiplier scales output linearly', () => {
    const cam = { x: 0, y: 0, zoom: 1 };
    const base = normDeltaToWorld(0.1, 0.1, 1, cam, 1000, 1.0);
    const fast = normDeltaToWorld(0.1, 0.1, 1, cam, 1000, 2.0);
    expect(fast.dx).toBeCloseTo(base.dx * 2, 6);
    expect(fast.dy).toBeCloseTo(base.dy * 2, 6);
  });

  it('zero delta produces zero displacement', () => {
    const cam = { x: 100, y: 200, zoom: 1.5 };
    const { dx, dy } = normDeltaToWorld(0, 0, 0.56, cam, 1440);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });
});

describe('computeWritingWindow / windowNormToWorld', () => {
  it('preserves portrait phone aspect ratio and centres on target point', () => {
    const aspect = 9 / 19.5;
    const win = computeWritingWindow({ x: 500, y: 400 }, aspect, { x: 0, y: 0, zoom: 1 }, 1440, 900);
    expect(win.w / win.h).toBeCloseTo(aspect, 5);
    expect(win.x + win.w / 2).toBeCloseTo(500, 5);
    expect(win.y + win.h / 2).toBeCloseTo(400, 5);
  });

  it('preserves landscape phone aspect ratio and fits within viewport', () => {
    const aspect = 19.5 / 9;
    const win = computeWritingWindow({ x: 720, y: 450 }, aspect, { x: 0, y: 0, zoom: 1 }, 1440, 900, 0.78);
    expect(win.w / win.h).toBeCloseTo(aspect, 5);
    expect(win.w).toBeLessThanOrEqual(1440 * 0.78 + 0.01);
    expect(win.h).toBeLessThanOrEqual(900 * 0.78 + 0.01);
  });

  it('scales world size inversely with camera zoom', () => {
    const aspect = 9 / 16;
    const w1 = computeWritingWindow({ x: 0, y: 0 }, aspect, { x: 0, y: 0, zoom: 1 }, 1200, 800);
    const w2 = computeWritingWindow({ x: 0, y: 0 }, aspect, { x: 0, y: 0, zoom: 2 }, 1200, 800);
    expect(w2.w).toBeCloseTo(w1.w / 2, 5);
    expect(w2.h).toBeCloseTo(w1.h / 2, 5);
  });

  it('maps separate T and E gestures into their distinct window locations isotropically', () => {
    const aspect = 16 / 9; // horizontal mode
    const win = computeWritingWindow({ x: 0, y: 0 }, aspect, { x: 0, y: 0, zoom: 1 }, 1280, 720);
    const topLeft = windowNormToWorld(0.15, 0.2, win);
    const center = windowNormToWorld(0.5, 0.5, win);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(topLeft.x).toBeLessThan(center.x);
    expect(topLeft.y).toBeLessThan(center.y);

    // A physically square swipe on horizontal phone (du = d/W, dv = d/H = du * aspect)
    // must produce equal world displacement in X and Y.
    const du = 0.1;
    const dv = du * aspect;
    const p1 = windowNormToWorld(0.2, 0.2, win);
    const p2 = windowNormToWorld(0.2 + du, 0.2 + dv, win);
    expect(p2.x - p1.x).toBeCloseTo(p2.y - p1.y, 4);
  });
});

describe('alignWritingWindowCenter', () => {
  it('aligns arbitrary phone touch (u, v) directly to targetWorld after cursor reposition', () => {
    const cam = { x: -120, y: 80, zoom: 1.4 };
    const aspect = 9 / 19.5;
    const targetWorld = { x: 420, y: 275 };
    const normTouch = { x: 0.23, y: 0.71 };

    const alignedCenter = alignWritingWindowCenter(normTouch, targetWorld, aspect, cam, 1440, 900);
    const win = computeWritingWindow(alignedCenter, aspect, cam, 1440, 900);
    const mapped = windowNormToWorld(normTouch.x, normTouch.y, win);

    expect(mapped.x).toBeCloseTo(targetWorld.x, 6);
    expect(mapped.y).toBeCloseTo(targetWorld.y, 6);
    expect(win.w / win.h).toBeCloseTo(aspect, 6);
  });

  it('preserves isotropic proportions and spacing for subsequent strokes (V then A) in the aligned window', () => {
    const cam = { x: 50, y: 20, zoom: 1.2 };
    const aspect = 16 / 9;
    const cursorPos = { x: 300, y: 200 };
    const vStartNorm = { x: 0.2, y: 0.4 };

    const alignedCenter = alignWritingWindowCenter(vStartNorm, cursorPos, aspect, cam, 1280, 720);
    const win = computeWritingWindow(alignedCenter, aspect, cam, 1280, 720);

    // First stroke ('V') anchors exactly at cursorPos
    const vStartWorld = windowNormToWorld(vStartNorm.x, vStartNorm.y, win);
    expect(vStartWorld.x).toBeCloseTo(cursorPos.x, 6);
    expect(vStartWorld.y).toBeCloseTo(cursorPos.y, 6);

    // Second stroke ('A') starts to the right and slightly down on the phone pad
    const du = 0.25;
    const dv = du * aspect;
    const aStartWorld = windowNormToWorld(vStartNorm.x + du, vStartNorm.y + dv, win);

    expect(aStartWorld.x - vStartWorld.x).toBeCloseTo(aStartWorld.y - vStartWorld.y, 5);
    expect(aStartWorld.x).toBeGreaterThan(vStartWorld.x);
    expect(aStartWorld.y).toBeGreaterThan(vStartWorld.y);
  });

  it('re-aligns cleanly across camera zoom changes and preserves zoomed 1/zoom world scale', () => {
    const aspect = 9 / 19.5;
    const viewportW = 1280;
    const viewportH = 720;
    const targetWorld = { x: 899.5, y: 199.5 };
    const touchNorm = { x: 0.2, y: 0.2 };

    // Initial alignment at zoom = 1
    const cam1 = { x: 0, y: 0, zoom: 1 };
    const center1 = alignWritingWindowCenter(touchNorm, targetWorld, aspect, cam1, viewportW, viewportH);
    const win1 = computeWritingWindow(center1, aspect, cam1, viewportW, viewportH);
    const start1 = windowNormToWorld(touchNorm.x, touchNorm.y, win1);
    expect(start1.x).toBeCloseTo(targetWorld.x, 6);
    expect(start1.y).toBeCloseTo(targetWorld.y, 6);

    // Zoom in to zoom = 1.6 anchored around screen point (900, 200)
    const cam2 = {
      x: 900 - 900 / 1.6,
      y: 200 - 200 / 1.6,
      zoom: 1.6,
    };
    const center2 = alignWritingWindowCenter(touchNorm, targetWorld, aspect, cam2, viewportW, viewportH);
    const win2 = computeWritingWindow(center2, aspect, cam2, viewportW, viewportH);

    // Without re-aligning (using stale center1 at zoom=1.6), touchNorm drifts away from targetWorld
    const staleWin = computeWritingWindow(center1, aspect, cam2, viewportW, viewportH);
    const staleMapped = windowNormToWorld(touchNorm.x, touchNorm.y, staleWin);
    expect(Math.hypot(staleMapped.x - targetWorld.x, staleMapped.y - targetWorld.y)).toBeGreaterThan(50);

    // After re-aligning, touchNorm lands exactly at targetWorld
    const start2 = windowNormToWorld(touchNorm.x, touchNorm.y, win2);
    expect(start2.x).toBeCloseTo(targetWorld.x, 6);
    expect(start2.y).toBeCloseTo(targetWorld.y, 6);

    // Subsequent stroke offset preserves the zoomed 1 / 1.6 world scale & isotropic proportions
    const nextNorm = { x: 0.5, y: 0.5 };
    const end1 = windowNormToWorld(nextNorm.x, nextNorm.y, win1);
    const end2 = windowNormToWorld(nextNorm.x, nextNorm.y, win2);
    expect(end2.x - start2.x).toBeCloseTo((end1.x - start1.x) / 1.6, 6);
    expect(end2.y - start2.y).toBeCloseTo((end1.y - start1.y) / 1.6, 6);
  });
});

describe('stepCursorPosition', () => {
  it('advances monotonically across intermediate 16ms frames without overshooting or hiding', () => {
    const start = { x: 100, y: 120 }; // e.g., end of 'V'
    const target = { x: 420, y: 280 }; // e.g., start of 'A'

    let pos = { ...start };
    let prevDist = Math.hypot(target.x - pos.x, target.y - pos.y);
    const seenX: number[] = [];

    for (let i = 0; i < 30; i++) {
      const next = stepCursorPosition(pos, target, 16, { tauMs: 38, epsilon: 0.25 });
      seenX.push(next.x);
      expect(next.x).toBeGreaterThanOrEqual(pos.x);
      expect(next.x).toBeLessThanOrEqual(target.x);
      expect(next.y).toBeGreaterThanOrEqual(pos.y);
      expect(next.y).toBeLessThanOrEqual(target.y);

      const dist = Math.hypot(target.x - next.x, target.y - next.y);
      expect(dist).toBeLessThanOrEqual(prevDist + 1e-9);
      prevDist = dist;
      pos = { x: next.x, y: next.y };
      if (next.settled) break;
    }

    // Must take multiple intermediate frames rather than snapping in 1 frame
    expect(seenX.length).toBeGreaterThan(3);
    expect(seenX[0]).toBeLessThan(target.x);

    // Eventually converges cleanly within threshold
    let finalRes = stepCursorPosition(pos, target, 16, { tauMs: 38, epsilon: 0.25 });
    for (let i = 0; i < 30 && !finalRes.settled; i++) {
      finalRes = stepCursorPosition(finalRes, target, 16, { tauMs: 38, epsilon: 0.25 });
    }
    expect(finalRes.settled).toBe(true);
    expect(finalRes.x).toBe(target.x);
    expect(finalRes.y).toBe(target.y);
  });

  it('is frame-rate independent (two 16ms steps equal one 32ms step)', () => {
    const start = { x: 0, y: 0 };
    const target = { x: 500, y: 300 };
    const opts = { tauMs: 40, epsilon: 0.1 };

    const s1 = stepCursorPosition(start, target, 16, opts);
    const s2 = stepCursorPosition(s1, target, 16, opts);
    const single32 = stepCursorPosition(start, target, 32, opts);

    expect(s2.x).toBeCloseTo(single32.x, 6);
    expect(s2.y).toBeCloseTo(single32.y, 6);
  });

  it('handles zero, negative, or non-finite dtMs safely without moving or NaN', () => {
    const start = { x: 10, y: 20 };
    const target = { x: 100, y: 200 };

    for (const badDt of [0, -16, Number.NaN]) {
      const res = stepCursorPosition(start, target, badDt);
      expect(res.settled).toBe(false);
      expect(res.x).toBe(start.x);
      expect(res.y).toBe(start.y);
    }
  });
});

describe('appendPointToBounds / buildStrokePath2D', () => {
  it('incrementally updates bounds matching computeBounds', () => {
    const pts = [
      { x: 10, y: 20, p: 0.5, dt: 0 },
      { x: -5, y: 40, p: 0.5, dt: 10 },
      { x: 35, y: 12, p: 0.5, dt: 20 },
    ];
    let b = computeBounds([pts[0]]);
    b = appendPointToBounds(b, pts[1]);
    b = appendPointToBounds(b, pts[2]);
    expect(b).toEqual(computeBounds(pts));
  });

  it('returns null from buildStrokePath2D safely when Path2D is unavailable or <2 points', () => {
    expect(buildStrokePath2D([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe('hitTestStroke / computeFitCamera', () => {
  const mkStroke = (pts: { x: number; y: number }[], baseWidth = 4) => {
    const full = pts.map((p, idx) => ({ ...p, p: 0.5, dt: idx * 10 }));
    return {
      tool: 'pen' as const,
      baseWidth,
      points: full,
      bounds: computeBounds(full),
    };
  };

  it('hits segments within radius + half-width and misses outside', () => {
    const stroke = mkStroke([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ], 4);
    expect(hitTestStroke(stroke, { x: 50, y: 5 }, 6)).toBe(true);
    expect(hitTestStroke(stroke, { x: 50, y: 15 }, 6)).toBe(false);
    expect(hitTestStroke(stroke, { x: -12, y: 0 }, 6)).toBe(false);
  });

  it('hits single-point dot strokes', () => {
    const dot = mkStroke([{ x: 40, y: 60 }], 4);
    expect(hitTestStroke(dot, { x: 43, y: 62 }, 6)).toBe(true);
    expect(hitTestStroke(dot, { x: 60, y: 60 }, 6)).toBe(false);
  });

  it('computeFitCamera returns null on empty board and centres strokes with padding', () => {
    expect(computeFitCamera([], 1200, 800)).toBeNull();
    const s1 = mkStroke([{ x: 100, y: 100 }, { x: 500, y: 300 }]);
    const cam = computeFitCamera([s1], 1200, 800, 60);
    expect(cam).not.toBeNull();
    // Centre of [100..500, 100..300] is (300, 200) -> maps to screen centre (600, 400)
    const screenCenter = worldToScreen(300, 200, cam!);
    expect(screenCenter.x).toBeCloseTo(600, 4);
    expect(screenCenter.y).toBeCloseTo(400, 4);
  });

  it('smoothPoint returns raw point at 0 and damps jitter at higher smoothness', () => {
    const prev = { x: 0, y: 0 };
    const next = { x: 100, y: 100 };
    expect(smoothPoint(prev, next, 0)).toEqual(next);
    const mid = smoothPoint(prev, next, 50);
    expect(mid.x).toBeCloseTo(64, 4);
    const high = smoothPoint(prev, next, 100);
    expect(high.x).toBeCloseTo(28, 4);
  });

  it('smoothPoint damps alternating jitter while tracking the trend', () => {
    let prev = { x: 0, y: 0 };
    const raw = [
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 20, y: 0 },
      { x: 20, y: 8 },
      { x: 30, y: 0 },
    ];
    const smoothed: { x: number; y: number }[] = [];
    for (const p of raw) {
      prev = smoothPoint(prev, p, 70);
      smoothed.push(prev);
    }
    const rawJitter = raw.reduce((sum, p) => sum + Math.abs(p.y), 0);
    const smoothJitter = smoothed.reduce((sum, p) => sum + Math.abs(p.y), 0);
    expect(smoothJitter).toBeLessThan(rawJitter);
    expect(smoothed[smoothed.length - 1].x).toBeGreaterThan(0);
  });

  it('smoothPoint treats non-finite smoothness as raw input', () => {
    const prev = { x: 0, y: 0 };
    const next = { x: 42, y: 24 };
    expect(smoothPoint(prev, next, Number.NaN)).toEqual(next);
    expect(smoothPoint(prev, next, Number.POSITIVE_INFINITY)).toEqual(next);
  });
});
