import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beautifyStrokePoints,
  createOneEuroState,
  DEFAULT_PHONE_SMOOTHNESS,
  filterOneEuroPoint,
  renderSmoothStroke,
  type OneEuroState,
  type ScriptaWsMessage,
  type StrokePoint,
  type ToolType,
} from '@scripta/shared';

type ConnStatus = 'unpaired' | 'connecting' | 'waiting_approval' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

const DEVICE_ID_KEY   = 'scripta:mobile:deviceId';
const DEVICE_NAME_KEY = 'scripta:mobile:deviceName';

function getOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `dev_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getDefaultDeviceName(): string {
  try {
    const saved = window.localStorage.getItem(DEVICE_NAME_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android Phone';
  return 'Phone';
}

const PREVIEW_HOLD_MS    = 750;
const PREVIEW_FADE_MS    = 1000;
const PREVIEW_BASE_ALPHA = 0.45;
const COLORS             = ['#f8fafc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];
const WIDTHS             = [2, 4, 7];

interface MobilePreviewStroke {
  points: StrokePoint[];
  tool: ToolType;
  color: string;
  baseWidth: number;
  endedAt: number | null;
}

/**
 * Software 90° CW UI + coordinate rotation activates when the user selects
 * Horizontal Mode while the phone browser itself is still portrait-locked.
 * (Corresponds to holding the phone horizontally 90° CCW, camera on the left.)
 */
function isSoftwareRotated(horizontal: boolean, w: number, h: number): boolean {
  return horizontal && w < h;
}

function getTabletAspect(w: number, h: number, rotated: boolean): number {
  return rotated ? h / w : w / h;
}

function clientToTabletNorm(
  clientX: number,
  clientY: number,
  w: number,
  h: number,
  rotated: boolean,
): { x: number; y: number } {
  if (!rotated) {
    return { x: clientX / w, y: clientY / h };
  }
  return {
    x: clientY / h,
    y: 1 - clientX / w,
  };
}

function clamp(val: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(min, val), max);
}

export default function App() {
  const wsRef  = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);

  const [codeInput, setCodeInput] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get('code') || '').toUpperCase();
  });
  const [deviceName, setDeviceName] = useState<string>(() => getDefaultDeviceName());
  const deviceIdRef   = useRef<string>(getOrCreateDeviceId());
  const deviceNameRef = useRef<string>(deviceName);
  deviceNameRef.current = deviceName;
  const manualDisconnectRef = useRef(false);
  const [status,         setStatus]         = useState<ConnStatus>('unpaired');
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [horizontalMode, setHorizontalMode] = useState(false);
  const [vpSize,         setVpSize]         = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth  : 390,
    h: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));
  /** Reflects the cursor mode reported by the desktop via desktop.cursor. */
  const [cursorMode, setCursorMode] = useState<'draw' | 'move'>('draw');
  const [undoFlash,  setUndoFlash]  = useState(false);
  const [toolState,  setToolState]  = useState<{
    tool: ToolType;
    color: string;
    width: number;
    smoothness?: number;
  }>({
    tool: 'pen', color: '#38bdf8', width: 4, smoothness: DEFAULT_PHONE_SMOOTHNESS,
  });

  // Draggable FAB
  const [fabPos, setFabPos] = useState(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth  - 68 : 280,
    y: typeof window !== 'undefined' ? window.innerHeight - 84 : 580,
  }));
  const fabDragRef = useRef<{
    pointerId: number; startX: number; startY: number;
    origX: number; origY: number; moved: boolean;
  } | null>(null);

  // Pointer tracking — tablet surface + fading ink preview + multi-touch gestures
  const previewCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const padPointersRef     = useRef<Map<number, {
    startX: number; startY: number; curX: number; curY: number; downAt: number;
  }>>(new Map());
  const twoFingerRef       = useRef<{
    mode: 'pending' | 'move';
    moverId: number | null;
    startedAt: number;
    maxMoveSq: number;
    tempMove: boolean;
  } | null>(null);
  const undoFlashTimerRef  = useRef<number | null>(null);
  const lastPixelRef       = useRef<{ x: number; y: number } | null>(null);
  const previewSmoothRef   = useRef<OneEuroState | null>(null);
  const strokeStartTsRef   = useRef<number>(0);
  const pendingPointsRef   = useRef<StrokePoint[]>([]);
  const activeStrokeIdRef  = useRef<string | null>(null);
  const rafIdRef           = useRef<number | null>(null);
  const activePreviewRef   = useRef<MobilePreviewStroke | null>(null);
  const fadingPreviewsRef  = useRef<MobilePreviewStroke[]>([]);
  const previewRafIdRef    = useRef<number | null>(null);
  const vpSizeRef          = useRef<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth  : 390,
    h: typeof window !== 'undefined' ? window.innerHeight : 844,
  });
  const dprRef             = useRef<number>(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );
  const cursorModeRef      = useRef(cursorMode);
  const toolStateRef       = useRef(toolState);
  const horizontalModeRef  = useRef(horizontalMode);
  cursorModeRef.current     = cursorMode;
  toolStateRef.current      = toolState;
  horizontalModeRef.current = horizontalMode;

  const credsRef     = useRef<{ sessionId: string; mobileToken: string } | null>(null);
  const reconnectRef = useRef(0);

  // ── Send helper ───────────────────────────────────────────────────────────
  const sendMsg = useCallback((type: string, payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    seqRef.current += 1;
    ws.send(JSON.stringify({ v: 1, type, seq: seqRef.current, ts: Date.now(), payload }));
  }, []);

  // ── Local fading ink preview renderer ─────────────────────────────────────
  const renderPreviewFrame = useCallback((now: number) => {
    previewRafIdRef.current = null;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const { w, h } = vpSizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const alive: MobilePreviewStroke[] = [];
    for (const s of fadingPreviewsRef.current) {
      const endedAt = s.endedAt ?? now;
      const age = now - endedAt;
      if (age >= PREVIEW_HOLD_MS + PREVIEW_FADE_MS) continue;
      const alpha = age <= PREVIEW_HOLD_MS
        ? 1
        : Math.max(0, 1 - (age - PREVIEW_HOLD_MS) / PREVIEW_FADE_MS);
      renderSmoothStroke(ctx, s, null, PREVIEW_BASE_ALPHA * alpha);
      alive.push(s);
    }
    fadingPreviewsRef.current = alive;

    if (activePreviewRef.current) {
      renderSmoothStroke(ctx, activePreviewRef.current, null, PREVIEW_BASE_ALPHA);
    }

    if (activePreviewRef.current !== null || fadingPreviewsRef.current.length > 0) {
      previewRafIdRef.current = requestAnimationFrame(renderPreviewFrame);
    }
  }, []);

  const schedulePreviewRender = useCallback(() => {
    if (previewRafIdRef.current !== null) return;
    previewRafIdRef.current = requestAnimationFrame(renderPreviewFrame);
  }, [renderPreviewFrame]);

  const clearPreviews = useCallback(() => {
    activePreviewRef.current  = null;
    fadingPreviewsRef.current = [];
    previewSmoothRef.current  = null;
    if (previewRafIdRef.current !== null) {
      cancelAnimationFrame(previewRafIdRef.current);
      previewRafIdRef.current = null;
    }
    const canvas = previewCanvasRef.current;
    const ctx    = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    canvas.width = Math.round(vpSize.w * dpr);
    canvas.height = Math.round(vpSize.h * dpr);
    if (activePreviewRef.current !== null || fadingPreviewsRef.current.length > 0) {
      schedulePreviewRender();
    }
  }, [vpSize, status, schedulePreviewRender]);

  useEffect(() => {
    return () => {
      if (previewRafIdRef.current !== null) {
        cancelAnimationFrame(previewRafIdRef.current);
        previewRafIdRef.current = null;
      }
      if (undoFlashTimerRef.current !== null) {
        window.clearTimeout(undoFlashTimerRef.current);
      }
    };
  }, []);

  const triggerUndoFeedback = useCallback(() => {
    setUndoFlash(true);
    if (undoFlashTimerRef.current !== null) {
      window.clearTimeout(undoFlashTimerRef.current);
    }
    undoFlashTimerRef.current = window.setTimeout(() => {
      setUndoFlash(false);
      undoFlashTimerRef.current = null;
    }, 700);
  }, []);

  // ── WebSocket connect / reconnect ─────────────────────────────────────────
  const connectWS = useCallback((sessionId: string, mobileToken: string) => {
    manualDisconnectRef.current = false;
    setStatus(reconnectRef.current > 0 ? 'reconnecting' : 'connecting');
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      sessionId,
      role: 'mobile',
      token: mobileToken,
      deviceId: deviceIdRef.current,
      deviceName: deviceNameRef.current || 'Phone',
    });
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectRef.current = 0;
      setStatus('connected');
      setErrorMsg(null);
      const { w, h } = vpSizeRef.current;
      const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
      sendMsg('pad.resize', { aspectRatio: getTabletAspect(w, h, rotated) });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ScriptaWsMessage;
      if (msg.type === 'desktop.state')  setToolState(msg.payload);
      if (msg.type === 'desktop.cursor') {
        cursorModeRef.current = msg.payload.mode;
        setCursorMode(msg.payload.mode);
        if (msg.payload.mode === 'move' && activePreviewRef.current) {
          activePreviewRef.current = null;
          previewSmoothRef.current = null;
          schedulePreviewRender();
        }
      }
      if (msg.type === 'session.pending') {
        setStatus('waiting_approval');
      }
      if (msg.type === 'session.approved') {
        setStatus('connected');
        const { w, h } = vpSizeRef.current;
        const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
        sendMsg('pad.resize', { aspectRatio: getTabletAspect(w, h, rotated) });
      }
      if (msg.type === 'session.denied') {
        manualDisconnectRef.current = true;
        credsRef.current = null;
        setErrorMsg(msg.payload.reason || 'Connection denied by desktop');
        setStatus('unpaired');
      }
      if (msg.type === 'session.kicked') {
        manualDisconnectRef.current = true;
        credsRef.current = null;
        setErrorMsg(msg.payload.reason || 'Disconnected by desktop');
        setStatus('unpaired');
      }
    };

    ws.onclose = () => {
      if (manualDisconnectRef.current || !credsRef.current) return;
      setStatus('reconnecting');
      const delay = Math.min(10_000, 500 * 2 ** reconnectRef.current);
      reconnectRef.current += 1;
      window.setTimeout(() => {
        if (!manualDisconnectRef.current && credsRef.current) {
          connectWS(credsRef.current.sessionId, credsRef.current.mobileToken);
        }
      }, delay);
    };
  }, [sendMsg, schedulePreviewRender]);

  const disconnectPhone = useCallback(() => {
    manualDisconnectRef.current = true;
    setMenuOpen(false);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'user_disconnect');
    }
    setStatus('disconnected');
  }, []);

  const reconnectPhone = useCallback(() => {
    if (!credsRef.current) {
      setStatus('unpaired');
      return;
    }
    reconnectRef.current = 0;
    connectWS(credsRef.current.sessionId, credsRef.current.mobileToken);
  }, [connectWS]);

  // ── Pair via code ─────────────────────────────────────────────────────────
  const joinWithCode = useCallback(async (rawCode: string) => {
    const clean = rawCode.trim().toUpperCase();
    if (clean.length < 4) return;
    setErrorMsg(null);
    setStatus('connecting');
    try {
      const { w, h } = vpSizeRef.current;
      const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
      const qrSecret = new URLSearchParams(window.location.search).get('qr') || '';
      const res  = await fetch('/api/pair/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairCode:    clean,
          aspectRatio: getTabletAspect(w, h, rotated),
          qrSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to pair');
      credsRef.current = { sessionId: data.sessionId, mobileToken: data.mobileToken };
      connectWS(data.sessionId, data.mobileToken);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Pairing failed');
    }
  }, [connectWS]);

  // Auto-join from QR URL
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) joinWithCode(code);
  }, [joinWithCode]);

  // ── RAF-batched point flush ───────────────────────────────────────────────
  const flushBatch = useCallback(() => {
    rafIdRef.current = null;
    if (pendingPointsRef.current.length === 0 || !activeStrokeIdRef.current) return;
    sendMsg('stroke.points', {
      strokeId: activeStrokeIdRef.current,
      points:   pendingPointsRef.current,
    });
    pendingPointsRef.current = [];
  }, [sendMsg]);

  const finishPadPointer = useCallback((cancelled: boolean) => {
    if (activePointerIdRef.current === null) return;
    const lastPixel = lastPixelRef.current;
    const previewFilter = previewSmoothRef.current;
    activePointerIdRef.current = null;
    lastPixelRef.current       = null;
    previewSmoothRef.current   = null;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (activePreviewRef.current) {
      if (!cancelled) {
        if (lastPixel) {
          const dt = Date.now() - strokeStartTsRef.current;
          const smoothness = toolStateRef.current.smoothness ?? DEFAULT_PHONE_SMOOTHNESS;
          const { w, h } = vpSizeRef.current;
          const endPt = previewFilter
            ? filterOneEuroPoint(previewFilter, lastPixel, dt, smoothness, Math.max(w, h))
            : lastPixel;
          activePreviewRef.current.points.push({
            x: endPt.x,
            y: endPt.y,
            p: 0.5,
            dt,
          });
        }
        activePreviewRef.current.points = beautifyStrokePoints(activePreviewRef.current.points, {
          smoothness: toolStateRef.current.smoothness ?? DEFAULT_PHONE_SMOOTHNESS,
          baseWidth: activePreviewRef.current.baseWidth,
        });
        activePreviewRef.current.endedAt = performance.now();
        fadingPreviewsRef.current.push(activePreviewRef.current);
      }
      activePreviewRef.current = null;
      schedulePreviewRender();
    }

    const strokeId = activeStrokeIdRef.current;
    if (!cancelled && pendingPointsRef.current.length > 0 && strokeId) {
      sendMsg('stroke.points', { strokeId, points: pendingPointsRef.current });
    }
    pendingPointsRef.current  = [];
    activeStrokeIdRef.current = null;

    if (strokeId) {
      sendMsg(cancelled ? 'stroke.cancel' : 'stroke.end', { strokeId });
    }
  }, [sendMsg, schedulePreviewRender]);

  // Orientation / viewport resize → cancel active stroke, update cached size, report aspect
  useEffect(() => {
    const handleResize = () => {
      finishPadPointer(true);
      clearPreviews();
      const w = window.innerWidth;
      const h = window.innerHeight;
      vpSizeRef.current = { w, h };
      dprRef.current = window.devicePixelRatio || 1;
      setVpSize({ w, h });
      setFabPos((prev) => ({
        x: Math.min(Math.max(12, prev.x), w - 60),
        y: Math.min(Math.max(12, prev.y), h - 60),
      }));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
        sendMsg('pad.resize', { aspectRatio: getTabletAspect(w, h, rotated) });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sendMsg, finishPadPointer, clearPreviews]);

  // ── Pad pointer events (single-finger draw + 2-finger tap undo + 2nd-finger cursor move) ──
  const startStrokeForPointer = (pointerId: number, clientX: number, clientY: number, pressure: number, forceMove = false) => {
    activePointerIdRef.current = pointerId;
    const { w, h } = vpSizeRef.current;
    const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
    const norm    = clientToTabletNorm(clientX, clientY, w, h, rotated);
    lastPixelRef.current = { x: clientX, y: clientY };
    previewSmoothRef.current = createOneEuroState({ x: clientX, y: clientY }, 0);

    const now = Date.now();
    strokeStartTsRef.current = now;
    const strokeId = `m_${now}_${Math.random().toString(36).slice(2, 6)}`;
    activeStrokeIdRef.current = strokeId;

    const p = pressure > 0 ? pressure : 0.5;
    const noPreview = forceMove || cursorModeRef.current === 'move' || toolStateRef.current.tool === 'select';
    if (!noPreview) {
      const isEraser = toolStateRef.current.tool === 'eraser';
      activePreviewRef.current = {
        points: [{ x: clientX, y: clientY, p, dt: 0 }],
        tool: isEraser ? 'pen' : toolStateRef.current.tool,
        color: isEraser ? '#fb7185' : toolStateRef.current.color,
        baseWidth: isEraser ? 2.5 : toolStateRef.current.width,
        endedAt: null,
      };
      schedulePreviewRender();
    }

    sendMsg('stroke.start', {
      strokeId,
      deviceId: deviceIdRef.current,
      tool:  toolStateRef.current.tool,
      color: toolStateRef.current.color,
      width: toolStateRef.current.width,
      point: { x: norm.x, y: norm.y, p, dt: 0 },
    });
  };

  const onPadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (status !== 'connected') return;
    if (menuOpen) { setMenuOpen(false); return; }

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    padPointersRef.current.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      downAt: Date.now(),
    });

    if (padPointersRef.current.size === 1 && !twoFingerRef.current) {
      startStrokeForPointer(e.pointerId, e.clientX, e.clientY, e.pressure);
      return;
    }

    if (padPointersRef.current.size === 2 && !twoFingerRef.current) {
      // Cancel any single-finger draw stroke so 2-finger tap / 2nd-finger move never leaves ink
      finishPadPointer(true);
      twoFingerRef.current = {
        mode: 'pending',
        moverId: null,
        startedAt: Date.now(),
        maxMoveSq: 0,
        tempMove: false,
      };
    }
  };

  const onPadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const tracked = padPointersRef.current.get(e.pointerId);
    if (tracked) {
      tracked.curX = e.clientX;
      tracked.curY = e.clientY;
    }

    const tf = twoFingerRef.current;
    if (tf && tracked) {
      const dx = e.clientX - tracked.startX;
      const dy = e.clientY - tracked.startY;
      const distSq = dx * dx + dy * dy;
      if (distSq > tf.maxMoveSq) tf.maxMoveSq = distSq;

      if (tf.mode === 'pending' && distSq > 64) {
        // 1 finger held + 2nd finger moved -> cursor move mode (same as Ctrl + phone)
        tf.mode = 'move';
        tf.moverId = e.pointerId;
        if (cursorModeRef.current !== 'move') {
          tf.tempMove = true;
          cursorModeRef.current = 'move';
          setCursorMode('move');
          sendMsg('command.trigger', { action: 'enter_move' });
        }
        startStrokeForPointer(e.pointerId, e.clientX, e.clientY, e.pressure, true);
        return;
      }

      if (tf.mode === 'move' && e.pointerId !== tf.moverId) {
        return;
      }
    }

    if (e.pointerId !== activePointerIdRef.current) return;

    const { w, h } = vpSizeRef.current;
    const rotated = isSoftwareRotated(horizontalModeRef.current, w, h);
    const batch   = e.nativeEvent.getCoalescedEvents
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent];

    const noPreview = cursorModeRef.current === 'move' || toolStateRef.current.tool === 'select';
    const previewStroke = !noPreview ? activePreviewRef.current : null;
    const smoothness = toolStateRef.current.smoothness ?? DEFAULT_PHONE_SMOOTHNESS;
    let addedPreview = false;

    for (const pt of batch) {
      const prev = lastPixelRef.current;
      if (prev) {
        const dx = pt.clientX - prev.x;
        const dy = pt.clientY - prev.y;
        if (dx * dx + dy * dy < 2.25) continue; // micro-jitter filter
      }
      lastPixelRef.current = { x: pt.clientX, y: pt.clientY };
      const norm = clientToTabletNorm(pt.clientX, pt.clientY, w, h, rotated);
      const p    = pt.pressure > 0 ? pt.pressure : 0.5;
      const dt   = Date.now() - strokeStartTsRef.current;
      pendingPointsRef.current.push({ x: norm.x, y: norm.y, p, dt });
      if (previewStroke) {
        const rawPx = { x: pt.clientX, y: pt.clientY };
        if (!previewSmoothRef.current) {
          previewSmoothRef.current = createOneEuroState(rawPx, dt);
        }
        const smoothed = filterOneEuroPoint(
          previewSmoothRef.current,
          rawPx,
          dt,
          smoothness,
          Math.max(w, h),
        );
        previewStroke.points.push({ x: smoothed.x, y: smoothed.y, p, dt });
        addedPreview = true;
      }
    }

    if (addedPreview) {
      schedulePreviewRender();
    }
    if (pendingPointsRef.current.length > 0 && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushBatch);
    }
  };

  const onPadPointerEnd = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    padPointersRef.current.delete(e.pointerId);
    const tf = twoFingerRef.current;
    if (tf) {
      if (tf.mode === 'move') {
        if (e.pointerId === tf.moverId) {
          finishPadPointer(cancelled);
          tf.moverId = null;
        }
        if (padPointersRef.current.size === 0) {
          if (tf.tempMove) {
            cursorModeRef.current = 'draw';
            setCursorMode('draw');
            sendMsg('command.trigger', { action: 'exit_move' });
          }
          twoFingerRef.current = null;
        }
        return;
      }

      if (padPointersRef.current.size === 0) {
        if (!cancelled && tf.maxMoveSq < 144 && (Date.now() - tf.startedAt) < 400) {
          sendMsg('command.trigger', { action: 'undo' });
          triggerUndoFeedback();
        }
        twoFingerRef.current = null;
      }
      return;
    }

    if (e.pointerId === activePointerIdRef.current) {
      finishPadPointer(cancelled);
    }
  };

  // ── Draggable FAB handlers ────────────────────────────────────────────────
  const onFabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    fabDragRef.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      origX: fabPos.x, origY: fabPos.y, moved: false,
    };
  };

  const onFabMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && dx * dx + dy * dy > 36) {
      d.moved = true;
      setMenuOpen(false);
    }
    if (d.moved) {
      setFabPos({
        x: Math.min(Math.max(12, d.origX + dx), vpSize.w - 60),
        y: Math.min(Math.max(12, d.origY + dy), vpSize.h - 60),
      });
    }
  };

  const onFabUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = fabDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const wasTap = !d.moved;
    fabDragRef.current = null;
    if (wasTap) setMenuOpen((prev) => !prev);
  };

  const toggleHorizontalMode = () => {
    finishPadPointer(true);
    clearPreviews();
    const next = !horizontalModeRef.current;
    horizontalModeRef.current = next;
    setHorizontalMode(next);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rotated = isSoftwareRotated(next, w, h);
    sendMsg('pad.resize', { aspectRatio: getTabletAspect(w, h, rotated) });
    setMenuOpen(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* iOS Safari may refuse */ }
    setMenuOpen(false);
  };

  // ── Waiting for PC approval screen ───────────────────────────────────────
  if (status === 'waiting_approval') {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12,
      }}>
        <div style={{
          width: 12, height: 12, borderRadius: '50%', background: '#38bdf8',
          boxShadow: '0 0 12px rgba(56,189,248,0.8)',
        }} />
        <h2 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>Waiting for PC Approval</h2>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, textAlign: 'center', maxWidth: 260 }}>
          Click <strong>Allow</strong> on your desktop to connect <strong>{deviceName}</strong>.
        </p>
        <button
          onClick={() => {
            manualDisconnectRef.current = true;
            credsRef.current = null;
            wsRef.current?.close();
            setStatus('unpaired');
          }}
          style={{
            marginTop: 8, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155',
            borderRadius: 10, padding: '9px 18px', fontSize: 13, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Disconnected screen (1-tap reconnect) ─────────────────────────────────
  if (status === 'disconnected') {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14,
      }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>Disconnected</h2>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
          Paused connection for {deviceName}.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={reconnectPhone}
            style={{
              background: '#0284c7', color: '#fff', border: 'none',
              borderRadius: 10, padding: '11px 22px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Reconnect
          </button>
          <button
            onClick={() => { credsRef.current = null; setStatus('unpaired'); }}
            style={{
              background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155',
              borderRadius: 10, padding: '11px 16px', fontSize: 14, cursor: 'pointer',
            }}
          >
            Pair New
          </button>
        </div>
      </div>
    );
  }

  // ── Pairing screen ────────────────────────────────────────────────────────
  if (status === 'unpaired' || status === 'error') {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14,
      }}>
        <img
          src={`${import.meta.env.BASE_URL}logo_with_text.png`}
          alt="Scripta"
          style={{ width: 'min(260px, 76vw)', height: 'auto', display: 'block' }}
        />
        <h2 style={{ margin: 0, fontSize: 16, color: '#94a3b8', fontWeight: 500 }}>Phone Tablet</h2>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 14, textAlign: 'center' }}>
          Enter the 6-character code shown on your desktop, or scan the QR code.
        </p>
        <input
          value={deviceName}
          onChange={(e) => {
            setDeviceName(e.target.value);
            try { window.localStorage.setItem(DEVICE_NAME_KEY, e.target.value); } catch { /* ignore */ }
          }}
          placeholder="Device name"
          maxLength={24}
          style={{
            background: '#0f172a', color: '#cbd5e1', border: '1px solid #334155',
            borderRadius: 8, padding: '8px 12px', fontSize: 13, textAlign: 'center', width: 200,
          }}
        />
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          placeholder="7K9M2P"
          maxLength={6}
          style={{
            background: '#0f172a', color: '#f8fafc', border: '1px solid #334155',
            borderRadius: 10, padding: '12px 16px', fontSize: 20,
            letterSpacing: 4, textAlign: 'center', width: 200,
          }}
        />
        {errorMsg && <p style={{ color: '#fb7185', fontSize: 13, margin: 0 }}>{errorMsg}</p>}
        <button
          onClick={() => joinWithCode(codeInput)}
          style={{
            background: '#0284c7', color: '#fff', border: 'none',
            borderRadius: 10, padding: '12px 28px', fontSize: 16, fontWeight: 600,
          }}
        >
          Connect
        </button>
      </div>
    );
  }

  const osLandscape         = vpSize.w > vpSize.h;
  const rotated             = isSoftwareRotated(horizontalMode, vpSize.w, vpSize.h);
  const effectiveHorizontal = horizontalMode || osLandscape;
  const isMove              = cursorMode === 'move';

  // Compute menu box coordinates safely inside the viewport whether rotated or not.
  const menuW = 192;
  const estMenuH = rotated ? Math.min(204, vpSize.w - 24) : 204;
  let menuLeft: number;
  let menuTop: number;
  if (rotated) {
    // Rotated 90deg CW around center: visual X span = estMenuH, visual Y span = menuW
    const fabCenterX = fabPos.x + 24;
    const fabCenterY = fabPos.y + 24;
    const preferCy   = fabCenterY < vpSize.h / 2
      ? fabCenterY + menuW / 2 + 34
      : fabCenterY - menuW / 2 - 34;
    const cx = clamp(fabCenterX, estMenuH / 2 + 12, vpSize.w - estMenuH / 2 - 12);
    const cy = clamp(preferCy,   menuW / 2 + 12,    vpSize.h - menuW / 2 - 12);
    menuLeft = cx - menuW / 2;
    menuTop  = cy - estMenuH / 2;
  } else {
    const openUpward   = fabPos.y > vpSize.h / 2;
    const openLeftward = fabPos.x > vpSize.w / 2;
    menuLeft = clamp(openLeftward ? fabPos.x - menuW + 48 : fabPos.x, 12, vpSize.w - menuW - 12);
    menuTop  = clamp(openUpward ? fabPos.y - estMenuH - 8 : fabPos.y + 56, 12, vpSize.h - estMenuH - 12);
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* ── Drawing tablet surface + local fading ink preview canvas ── */}
      <div
        onPointerDown={onPadPointerDown}
        onPointerMove={onPadPointerMove}
        onPointerUp={(e) => onPadPointerEnd(e, false)}
        onPointerCancel={(e) => onPadPointerEnd(e, true)}
        style={{
          position: 'relative',
          width: '100%', height: '100%', touchAction: 'none',
          backgroundColor: '#06090f',
          backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <canvas
          ref={previewCanvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Subtle top-left orientation/mode guide (rotates with mode) ── */}
      <div
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          left: rotated ? vpSize.w - 14 : 14,
          top: 14,
          transformOrigin: 'top left',
          transform: rotated ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 9px',
          borderRadius: 999,
          background: 'rgba(15,23,42,0.55)',
          border: `1px solid ${isMove ? 'rgba(56,189,248,0.45)' : 'rgba(51,65,85,0.55)'}`,
          color: isMove ? '#38bdf8' : '#64748b',
          fontSize: 11,
          letterSpacing: 0.4,
          userSelect: 'none',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: status === 'connected' ? (isMove ? '#38bdf8' : '#10b981') : '#fbbf24',
        }} />
        <span>
          {effectiveHorizontal ? 'HORIZONTAL' : 'VERTICAL'} · {isMove ? 'MOVE' : toolState.tool.toUpperCase()}
        </span>
      </div>

      {undoFlash && (
        <div
          style={{
            position: 'fixed',
            top: 14,
            left: '50%',
            transform: rotated ? 'translateX(-50%) rotate(90deg)' : 'translateX(-50%)',
            padding: '4px 12px',
            borderRadius: 999,
            background: 'rgba(15,23,42,0.9)',
            border: '1px solid #38bdf8',
            color: '#f8fafc',
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        >
          Undo
        </div>
      )}

      {/* ── Compact Floating Options Menu ── */}
      {menuOpen && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menuLeft,
            top:  menuTop,
            width: menuW,
            maxHeight: rotated ? Math.max(180, vpSize.w - 24) : Math.max(180, vpSize.h - 24),
            overflowY: 'auto',
            transform: rotated ? 'rotate(90deg)' : 'none',
            transformOrigin: 'center center',
            background: 'rgba(15,23,42,0.96)', border: '1px solid #334155',
            borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column',
            gap: 8, backdropFilter: 'blur(12px)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)', zIndex: 20,
          }}
        >
          {/* Color swatches */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setToolState((prev) => ({ ...prev, color: c }));
                  sendMsg('mobile.style', { color: c });
                }}
                aria-label={`Color ${c}`}
                style={{
                  width: 22, height: 22, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
                  border: toolState.color === c ? '2px solid #fff' : '2px solid transparent',
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>

          {/* Brush widths + Pen / Eraser */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingBottom: 6, borderBottom: '1px solid #1e293b', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {WIDTHS.map((w, idx) => {
                const active = toolState.width === w;
                return (
                  <button
                    key={w}
                    onClick={() => {
                      setToolState((prev) => ({ ...prev, width: w }));
                      sendMsg('mobile.style', { width: w });
                    }}
                    aria-label={`Width ${w}`}
                    style={compactToggleBtn(active)}
                  >
                    <span style={{
                      width: 4 + idx * 3,
                      height: 4 + idx * 3,
                      borderRadius: '50%',
                      background: '#f8fafc',
                      display: 'block',
                    }} />
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => {
                  setToolState((prev) => ({ ...prev, tool: 'pen' }));
                  sendMsg('mobile.style', { tool: 'pen' });
                }}
                aria-label="Pen"
                style={compactToggleBtn(toolState.tool === 'pen')}
              >
                <PenIcon size={13} />
              </button>
              <button
                onClick={() => {
                  setToolState((prev) => ({ ...prev, tool: 'eraser' }));
                  sendMsg('mobile.style', { tool: 'eraser' });
                }}
                aria-label="Eraser"
                style={compactToggleBtn(toolState.tool === 'eraser')}
              >
                <EraserIcon size={13} />
              </button>
            </div>
          </div>

          {/* 3x2 compact action grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
            <button
              onClick={() => {
                sendMsg('command.trigger', { action: isMove ? 'exit_move' : 'enter_move' });
                setMenuOpen(false);
              }}
              style={compactGridBtn(isMove)}
            >
              <MoveIcon size={14} />
              <span>Move</span>
            </button>

            <button
              onClick={toggleHorizontalMode}
              disabled={osLandscape}
              style={{ ...compactGridBtn(effectiveHorizontal), opacity: osLandscape ? 0.65 : 1 }}
            >
              <RotateIcon size={14} />
              <span>{effectiveHorizontal ? 'Horiz' : 'Vert'}</span>
            </button>

            <button
              onClick={() => { sendMsg('command.trigger', { action: 'recenter_cursor' }); setMenuOpen(false); }}
              style={compactGridBtn(false)}
            >
              <CenterIcon size={14} />
              <span>Center</span>
            </button>

            <button
              onClick={() => { sendMsg('command.trigger', { action: 'undo' }); setMenuOpen(false); }}
              style={compactGridBtn(false)}
            >
              <UndoIcon size={14} />
              <span>Undo</span>
            </button>

            <button
              onClick={() => {
                activePreviewRef.current = null;
                fadingPreviewsRef.current = [];
                schedulePreviewRender();
                sendMsg('command.trigger', { action: 'clear' });
                setMenuOpen(false);
              }}
              style={compactGridBtn(false)}
            >
              <ClearIcon size={14} />
              <span>Clear</span>
            </button>

            <button onClick={toggleFullscreen} style={compactGridBtn(false)}>
              <FullscreenIcon size={14} />
              <span>Full</span>
            </button>
          </div>

          <button
            onClick={disconnectPhone}
            style={{
              background: 'rgba(251,113,133,0.14)',
              color: '#fda4af',
              border: '1px solid rgba(251,113,133,0.35)',
              borderRadius: 8,
              padding: '6px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {/* ── Draggable FAB (rotates smoothly with orientation mode) ── */}
      <button
        onPointerDown={onFabDown}
        onPointerMove={onFabMove}
        onPointerUp={onFabUp}
        aria-label="Tablet Options"
        style={{
          position: 'fixed', left: fabPos.x, top: fabPos.y,
          width: 48, height: 48, borderRadius: '50%',
          background: isMove ? '#0284c7' : 'rgba(15,23,42,0.9)',
          border: `2px solid ${status === 'connected' ? (isMove ? '#38bdf8' : toolState.color) : '#fbbf24'}`,
          color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: rotated ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s ease',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          touchAction: 'none', zIndex: 30,
        }}
      >
        {isMove ? <MoveIcon size={20} /> : <PenIcon size={20} />}
      </button>
    </div>
  );
}

function compactToggleBtn(active: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: active ? '#0369a1' : '#1e293b',
    border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
    color: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    cursor: 'pointer',
  };
}

function compactGridBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? '#0369a1' : '#1e293b',
    color: '#f8fafc',
    border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
    borderRadius: 8,
    padding: '7px 4px',
    fontSize: 10,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  };
}

function EraserIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function PenIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function MoveIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

function RotateIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="10" height="16" rx="2" />
      <path d="M18 14v5a2 2 0 0 1-2 2h-6" />
      <path d="M17 6l3 3-3 3" />
      <path d="M20 9h-3" />
    </svg>
  );
}

function CenterIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

function UndoIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function ClearIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function FullscreenIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
