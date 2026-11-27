import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  alignWritingWindowCenter,
  appendPointToBounds,
  beautifyStrokePoints,
  buildStrokePath2D,
  computeBoardBounds,
  computeBounds,
  computeConnectorBounds,
  computeFitCamera,
  computeShapeBounds,
  computeWritingWindow,
  createOneEuroState,
  elementIntersectsBounds,
  filterOneEuroPoint,
  findSnapAnchor,
  getConnectorMidpoint,
  getShapeAnchors,
  hitTestElement,
  isConnectorElement,
  isShapeElement,
  isStrokeElement,
  normDeltaToWorld,
  normalizeRect,
  renderBoardElement,
  resolveConnectorEndpoints,
  screenToWorld,
  snapLineEnd,
  stepCursorPosition,
  syncBoundConnectors,
  translateElement,
  windowNormToWorld,
  type BackgroundType,
  type BoardElement,
  type Camera,
  type ConnectedDevice,
  type ConnectorElement,
  type ConnectorRouting,
  type ElementBinding,
  type OneEuroState,
  type Point2D,
  type ScriptaWsMessage,
  type ShapeElement,
  type ShapeKind,
  type Stroke,
  type StrokePoint,
  type StrokeStyle,
  type ToolType,
} from '@scripta/shared';
import { CommandHistory, type ElementPatch, type ErasedEntry } from './history';
import {
  ArrowSvg,
  BgSvg,
  ClearSvg,
  DiamondSvg,
  DownloadSvg,
  EllipseSvg,
  EraserSvg,
  HelpSvg,
  HighlighterSvg,
  LineSvg,
  PenSvg,
  RectSvg,
  RedoSvg,
  SelectSvg,
  SettingsSvg,
  UndoSvg,
} from './icons';
import { TutorialModal } from './TutorialModal';
import { LandingPage } from './LandingPage';
import { NotesView } from './NotesView';
import { SettingsModal } from './SettingsModal';
import { HelpModal } from './HelpModal';
import { assetUrl } from './assets';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from './settings';

const COLORS = ['#f8fafc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];
const WIDTHS = [2, 4, 7];
const SHAPE_FILLS: { label: string; value: string | undefined; swatch: string }[] = [
  { label: 'None',  value: undefined,                  swatch: 'transparent' },
  { label: 'Dark',  value: 'rgba(15, 23, 42, 0.78)',   swatch: '#0f172a' },
  { label: 'Blue',  value: 'rgba(56, 189, 248, 0.18)', swatch: '#0284c7' },
  { label: 'Green', value: 'rgba(52, 211, 153, 0.18)', swatch: '#059669' },
  { label: 'Amber', value: 'rgba(251, 191, 36, 0.18)', swatch: '#d97706' },
  { label: 'Rose',  value: 'rgba(251, 113, 133, 0.18)', swatch: '#e11d48' },
];
const STORAGE_KEY = 'scripta:board:v1';
const LANDING_KEY = 'scripta:landing:v1';
const TUTORIAL_KEY = 'scripta:tutorial:v1';

const drawKey = (id: string) => id + '__draw';

function shouldShowLanding(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') === '1') return false;
    if (params.get('welcome') === '1') return true;
    return window.localStorage.getItem(LANDING_KEY) !== 'seen';
  } catch {
    return true;
  }
}

function hasSeenTutorial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === 'seen';
  } catch {
    return false;
  }
}

function shouldShowTutorialFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('tour') === '1';
  } catch {
    return false;
  }
}

interface PairingState {
  sessionId: string;
  pairCode: string;
  hostToken: string;
  qrDataUrl: string;
  mobileUrl: string;
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

type SelectDragState =
  | {
      mode: 'move';
      elementId: string;
      startWorld: Point2D;
      snapshots: Map<string, BoardElement>;
    }
  | {
      mode: 'resize';
      elementId: string;
      corner: ResizeCorner;
      origShape: ShapeElement;
      snapshots: Map<string, BoardElement>;
    }
  | {
      mode: 'endpoint';
      elementId: string;
      which: 'start' | 'end';
      origConn: ConnectorElement;
    };

interface PreviewShapeDraft {
  kind: 'shape';
  shape: ShapeKind;
  start: Point2D;
  current: Point2D;
  color: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fill?: string;
}

interface PreviewConnectorDraft {
  kind: 'connector';
  variant: 'line' | 'arrow';
  routing: ConnectorRouting;
  start: Point2D;
  end: Point2D;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  color: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
}

type ActiveDraft = PreviewShapeDraft | PreviewConnectorDraft;

function isShapeTool(t: ToolType): t is ShapeKind {
  return t === 'rect' || t === 'ellipse' || t === 'diamond';
}

function isConnectorTool(t: ToolType): t is 'line' | 'arrow' {
  return t === 'line' || t === 'arrow';
}

export default function App() {
  // ── Canvas refs ──────────────────────────────────────────────────────────
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Board state refs ─────────────────────────────────────────────────────
  const elementsRef        = useRef<BoardElement[]>([]);
  const historyRef         = useRef<CommandHistory>(new CommandHistory());
  const activeLocalRef     = useRef<Stroke | null>(null);
  const activeLocalDraftRef = useRef<ActiveDraft | null>(null);
  const activeRemoteRef    = useRef<Map<string, Stroke>>(new Map());
  const activeRemoteDraftRef = useRef<Map<string, ActiveDraft>>(new Map());
  const erasingLocalRef    = useRef<ErasedEntry[] | null>(null);
  const erasingRemoteRef   = useRef<Map<string, ErasedEntry[]>>(new Map());
  const remotePrevNormRef  = useRef<Map<string, Point2D>>(new Map());
  const remoteMoveMetaRef  = useRef<Map<string, { startNorm: Point2D; maxDistSq: number; startedAt: number }>>(new Map());

  // Selection / editing refs
  const selectedIdRef      = useRef<string | null>(null);
  const selectDragRef      = useRef<SelectDragState | null>(null);
  const snapPreviewRef     = useRef<{
    shape: ShapeElement;
    activeAnchor?: ElementBinding;
  } | null>(null);

  const localPointerIdRef = useRef<number | null>(null);
  const cameraRef         = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const phoneAspectRef    = useRef<number>(9 / 16);
  const vpWidthRef        = useRef<number>(typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vpHeightRef       = useRef<number>(typeof window !== 'undefined' ? window.innerHeight : 720);
  const dprRef            = useRef<number>(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  /** True target cursor, smoothly rendered display cursor, and invisible writing-window centre. */
  const cursorTargetWorldRef  = useRef<Point2D>({ x: 0, y: 0 });
  const cursorDisplayWorldRef = useRef<Point2D>({ x: 0, y: 0 });
  const windowCenterRef       = useRef<Point2D>({ x: 0, y: 0 });
  const needsWindowAlignRef   = useRef<boolean>(false);

  // Rendering caches & rAF coalescing scheduler
  const strokePathCacheRef = useRef<WeakMap<Stroke, Path2D>>(new WeakMap());
  const dotPatternCacheRef = useRef<{
    stepKey: number;
    dpr: number;
    pattern: CanvasPattern;
    tileSize: number;
  } | null>(null);
  const gridPatternCacheRef = useRef<{
    stepKey: number;
    dpr: number;
    pattern: CanvasPattern;
    tileSize: number;
  } | null>(null);
  const saveTimerRef            = useRef<number | null>(null);
  const dirtyStaticRef          = useRef<boolean>(false);
  const dirtyActiveRef          = useRef<boolean>(false);
  const pendingAppendElsRef     = useRef<BoardElement[]>([]);
  const rafIdRef                = useRef<number | null>(null);
  const lastFrameTsRef          = useRef<number | null>(null);
  const lastZoomPctRef          = useRef<number>(100);

  // Modifier / panning
  const modHeldRef         = useRef(false);
  const shiftHeldRef       = useRef(false);
  const spaceHeldRef       = useRef(false);
  const panningRef         = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
  const lastMouseClientRef = useRef<Point2D | null>(null);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // ── React state (UI only) ────────────────────────────────────────────────
  const [tool,           setTool]           = useState<ToolType>('pen');
  const [color,          setColor]          = useState<string>(COLORS[1]);
  const [width,          setWidth]          = useState<number>(WIDTHS[1]);
  const [strokeStyle,    setStrokeStyle]    = useState<StrokeStyle>('solid');
  const [shapeFill,      setShapeFill]      = useState<string | undefined>(SHAPE_FILLS[1].value);
  const [connRouting,    setConnRouting]    = useState<ConnectorRouting>('straight');
  const [bgType,         setBgType]         = useState<BackgroundType>('dots');
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [editingElId,    setEditingElId]    = useState<string | null>(null);
  const [labelInput,     setLabelInput]     = useState<string>('');
  const [canUndo,        setCanUndo]        = useState(false);
  const [canRedo,        setCanRedo]        = useState(false);
  const [zoomPct,        setZoomPct]        = useState(100);
  const [modHeld,        setModHeld]        = useState(false);
  const [spaceHeld,      setSpaceHeld]      = useState(false);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [pendingDevice, setPendingDevice] = useState<{ deviceId: string; deviceName: string } | null>(null);
  const [showDevicesMenu,  setShowDevicesMenu]  = useState(false);
  const [route, setRoute] = useState<'/' | '/notes' | '/draw'>(() => {
    if (typeof window === 'undefined') return '/draw';
    const p = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') === '1' || params.get('welcome') === '1') return '/';
    if (p.startsWith('/draw')) return '/draw';
    if (p.startsWith('/notes')) return '/notes';
    try {
      if (window.localStorage.getItem(LANDING_KEY) === 'seen') return '/notes';
    } catch { /* ignore */ }
    return '/';
  });
  const [activePageId, setActivePageId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('page');
  });
  const activePageIdRef = useRef<string | null>(activePageId);
  activePageIdRef.current = activePageId;
  const [showQrModal,    setShowQrModal]    = useState(false);
  const [pairing,        setPairing]        = useState<PairingState | null>(null);
  const [pairError,      setPairError]      = useState<string | null>(null);
  const [settings,       setSettings]       = useState<AppSettings>(() => loadSettings());
  const [showLanding,    setShowLanding]    = useState<boolean>(() => shouldShowLanding());
  const [showTutorial,   setShowTutorial]   = useState<boolean>(() => shouldShowTutorialFromUrl());
  const [showSettings,   setShowSettings]   = useState(false);
  const [showHelp,       setShowHelp]       = useState(false);

  // Ref mirrors for event handlers
  const toolRef            = useRef(tool);
  const colorRef           = useRef(color);
  const widthRef           = useRef(width);
  const strokeStyleRef     = useRef<StrokeStyle>(strokeStyle);
  const shapeFillRef       = useRef<string | undefined>(shapeFill);
  const connRoutingRef     = useRef(connRouting);
  const bgTypeRef          = useRef<BackgroundType>(bgType);
  const editingElIdRef     = useRef(editingElId);
  const phoneConnectedRef  = useRef(false);
  const settingsRef            = useRef<AppSettings>(settings);
  const remoteSmoothNormRef    = useRef<Map<string, OneEuroState>>(new Map());
  const remoteLastRawPointRef  = useRef<Map<string, StrokePoint>>(new Map());
  const suppressTutorialRef    = useRef(false);
  const modalOpenRef           = useRef(false);
  toolRef.current           = tool;
  colorRef.current          = color;
  widthRef.current          = width;
  strokeStyleRef.current    = strokeStyle;
  shapeFillRef.current      = shapeFill;
  connRoutingRef.current    = connRouting;
  bgTypeRef.current         = bgType;
  editingElIdRef.current    = editingElId;
  settingsRef.current       = settings;
  modalOpenRef.current      = showLanding || showTutorial || showSettings || showHelp || showQrModal;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const sendToMobile = useCallback((type: string, payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ v: 1, type, seq: 0, ts: Date.now(), payload }));
  }, []);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    setSettings(next);
    saveSettings(next);
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pageId = activePageIdRef.current;
      if (pageId) {
        void fetch(`/api/pages/${pageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bgType: bgTypeRef.current,
            camera: cameraRef.current,
            elements: elementsRef.current,
          }),
        }).catch(() => { /* fallback to localStorage below */ });
      }
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 2,
            elements: elementsRef.current,
            camera: cameraRef.current,
            bgType: bgTypeRef.current,
          }),
        );
      } catch {
        // Ignore quota / privacy-mode storage errors
      }
    }, 1500);
  }, []);

  const navigateTo = useCallback((nextRoute: '/' | '/notes' | '/draw', pageId?: string | null) => {
    const url = nextRoute === '/draw' && pageId
      ? `/draw?page=${encodeURIComponent(pageId)}`
      : nextRoute;
    try {
      window.history.pushState({}, '', url);
    } catch { /* ignore */ }
    setRoute(nextRoute);
    if (nextRoute === '/draw' && pageId !== undefined) {
      setActivePageId(pageId);
      activePageIdRef.current = pageId;
    }
    setShowLanding(nextRoute === '/');
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname;
      const pg = new URLSearchParams(window.location.search).get('page');
      if (p.startsWith('/draw')) {
        setRoute('/draw');
        setActivePageId(pg);
        setShowLanding(false);
      } else if (p.startsWith('/notes')) {
        setRoute('/notes');
        setShowLanding(false);
      } else {
        setRoute('/');
        setShowLanding(true);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const getWritingWindow = useCallback(
    () =>
      computeWritingWindow(
        windowCenterRef.current,
        phoneAspectRef.current,
        cameraRef.current,
        vpWidthRef.current,
        vpHeightRef.current,
        settingsRef.current.writingWindowRatio,
      ),
    [],
  );

  const getCachedStrokePath = useCallback((stroke: Stroke): Path2D | null => {
    if (stroke.points.length < 2) return null;
    let cached = strokePathCacheRef.current.get(stroke);
    if (!cached) {
      const built = buildStrokePath2D(stroke.points);
      if (built) {
        strokePathCacheRef.current.set(stroke, built);
        cached = built;
      }
    }
    return cached ?? null;
  }, []);

  const buildElementMap = useCallback(() => {
    const map = new Map<string, BoardElement>();
    for (const el of elementsRef.current) map.set(el.id, el);
    return map;
  }, []);

  const buildDraftConnector = useCallback(
    (d: PreviewConnectorDraft): ConnectorElement => {
      const stub: ConnectorElement = {
        id: '__draft__',
        kind: 'connector',
        variant: d.variant,
        routing: d.routing,
        start: d.start,
        end: d.end,
        startBinding: d.startBinding,
        endBinding: d.endBinding,
        color: d.color,
        strokeWidth: d.strokeWidth,
        strokeStyle: d.strokeStyle,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        createdAt: 0,
      };
      const byId = buildElementMap();
      const { start, end } = resolveConnectorEndpoints(stub, byId);
      return {
        ...stub,
        start,
        end,
        bounds: computeConnectorBounds(stub, start, end),
      };
    },
    [buildElementMap],
  );

  // ── Render layers ────────────────────────────────────────────────────────

  const renderStaticLayer = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const w   = vpWidthRef.current;
    const h   = vpHeightRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cam  = cameraRef.current;
    const step = 32 * cam.zoom;
    const bg   = bgTypeRef.current;
    if (bg !== 'plain' && step >= 10) {
      const offX = ((-cam.x * cam.zoom) % step + step) % step;
      const offY = ((-cam.y * cam.zoom) % step + step) % step;
      const stepKey = Math.round(step * 100);

      if (bg === 'dots') {
        let cached = dotPatternCacheRef.current;
        if (!cached || cached.stepKey !== stepKey || cached.dpr !== dpr) {
          const tileSize = 64;
          const tileCanvas = document.createElement('canvas');
          tileCanvas.width = tileSize;
          tileCanvas.height = tileSize;
          const tCtx = tileCanvas.getContext('2d');
          if (tCtx) {
            tCtx.fillStyle = '#1e293b';
            const dotSize = (1.5 * tileSize) / step;
            tCtx.fillRect(0, 0, dotSize, dotSize);
            const pattern = ctx.createPattern(tileCanvas, 'repeat');
            if (pattern && typeof pattern.setTransform === 'function') {
              cached = { stepKey, dpr, pattern, tileSize };
              dotPatternCacheRef.current = cached;
            }
          }
        }
        if (cached && typeof cached.pattern.setTransform === 'function') {
          const scale = step / cached.tileSize;
          cached.pattern.setTransform({ a: scale, b: 0, c: 0, d: scale, e: offX, f: offY });
          ctx.fillStyle = cached.pattern;
          ctx.fillRect(0, 0, w, h);
        }
      } else if (bg === 'grid') {
        let cached = gridPatternCacheRef.current;
        if (!cached || cached.stepKey !== stepKey || cached.dpr !== dpr) {
          const tileSize = 64;
          const tileCanvas = document.createElement('canvas');
          tileCanvas.width = tileSize;
          tileCanvas.height = tileSize;
          const tCtx = tileCanvas.getContext('2d');
          if (tCtx) {
            tCtx.fillStyle = 'rgba(30, 41, 59, 0.75)';
            const lineW = Math.max(0.75, tileSize / step);
            tCtx.fillRect(0, 0, tileSize, lineW);
            tCtx.fillRect(0, 0, lineW, tileSize);
            const pattern = ctx.createPattern(tileCanvas, 'repeat');
            if (pattern && typeof pattern.setTransform === 'function') {
              cached = { stepKey, dpr, pattern, tileSize };
              gridPatternCacheRef.current = cached;
            }
          }
        }
        if (cached && typeof cached.pattern.setTransform === 'function') {
          const scale = step / cached.tileSize;
          cached.pattern.setTransform({ a: scale, b: 0, c: 0, d: scale, e: offX, f: offY });
          ctx.fillStyle = cached.pattern;
          ctx.fillRect(0, 0, w, h);
        }
      }
    }

    const viewBounds = {
      minX: cam.x - 50,
      minY: cam.y - 50,
      maxX: cam.x + w / cam.zoom + 50,
      maxY: cam.y + h / cam.zoom + 50,
    };

    const byId = buildElementMap();
    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    for (const el of elementsRef.current) {
      if (elementIntersectsBounds(el, viewBounds)) {
        renderBoardElement(ctx, el, byId, strokePathCacheRef.current);
      }
    }
    ctx.restore();
  }, [buildElementMap]);

  const appendElementToStaticLayer = useCallback((el: BoardElement) => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const cam = cameraRef.current;
    const byId = buildElementMap();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    renderBoardElement(ctx, el, byId, strokePathCacheRef.current);
    ctx.restore();
  }, [buildElementMap]);

  const renderDraft = useCallback(
    (ctx: CanvasRenderingContext2D, draft: ActiveDraft, byId: Map<string, BoardElement>) => {
      if (draft.kind === 'shape') {
        const r = normalizeRect(draft.start, draft.current, shiftHeldRef.current);
        const shapeEl: ShapeElement = {
          id: '__draft__',
          kind: 'shape',
          shape: draft.shape,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          color: draft.color,
          strokeWidth: draft.strokeWidth,
          strokeStyle: draft.strokeStyle,
          fill: draft.fill,
          bounds: computeShapeBounds(r),
          createdAt: 0,
        };
        renderBoardElement(ctx, shapeEl, byId);
        return;
      }
      const conn = buildDraftConnector(draft);
      renderBoardElement(ctx, conn, byId);
    },
    [buildDraftConnector],
  );

  const renderActiveLayer = useCallback(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const w   = vpWidthRef.current;
    const h   = vpHeightRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cam  = cameraRef.current;
    const byId = buildElementMap();
    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);

    // Active strokes & shape/connector drafts
    if (activeLocalRef.current) renderBoardElement(ctx, activeLocalRef.current, byId);
    if (activeLocalDraftRef.current) renderDraft(ctx, activeLocalDraftRef.current, byId);
    for (const s of activeRemoteRef.current.values()) renderBoardElement(ctx, s, byId);
    for (const d of activeRemoteDraftRef.current.values()) renderDraft(ctx, d, byId);

    // ── Magnetic anchor port preview (when drawing/rebinding connectors) ──
    const snapPreview = snapPreviewRef.current;
    if (snapPreview) {
      const anchors = getShapeAnchors(snapPreview.shape);
      const portR = 4.5 / cam.zoom;
      ctx.save();
      for (const a of anchors) {
        const isHot = snapPreview.activeAnchor?.anchor === a.side;
        ctx.beginPath();
        ctx.arc(a.pt.x, a.pt.y, isHot ? portR * 1.45 : portR, 0, Math.PI * 2);
        ctx.fillStyle = isHot ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)';
        ctx.fill();
        ctx.strokeStyle = isHot ? '#f8fafc' : '#38bdf8';
        ctx.lineWidth = 1.5 / cam.zoom;
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── Selection bounding box + resize / endpoint handles ────────────────
    const selId = selectedIdRef.current;
    if (selId) {
      const sel = byId.get(selId);
      if (sel) {
        const lw = 1.5 / cam.zoom;
        const handleSize = 8 / cam.zoom;
        ctx.save();
        if (isConnectorElement(sel)) {
          const { start, end } = resolveConnectorEndpoints(sel, byId);
          for (const [pt, bound] of [
            [start, Boolean(sel.startBinding)],
            [end, Boolean(sel.endBinding)],
          ] as const) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, handleSize * 0.65, 0, Math.PI * 2);
            ctx.fillStyle = bound ? '#38bdf8' : '#f8fafc';
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = lw;
            ctx.stroke();
          }
        } else {
          const b = sel.bounds;
          const pad = 6 / cam.zoom;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = lw;
          ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
          ctx.strokeRect(
            b.minX - pad,
            b.minY - pad,
            b.maxX - b.minX + pad * 2,
            b.maxY - b.minY + pad * 2,
          );
          ctx.setLineDash([]);

          if (isShapeElement(sel)) {
            const corners = [
              { x: b.minX - pad, y: b.minY - pad },
              { x: b.maxX + pad, y: b.minY - pad },
              { x: b.minX - pad, y: b.maxY + pad },
              { x: b.maxX + pad, y: b.maxY + pad },
            ];
            for (const c of corners) {
              ctx.fillStyle = '#0f172a';
              ctx.strokeStyle = '#38bdf8';
              ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
              ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
            }
          }
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }, [buildElementMap, renderDraft]);

  const renderCursorLayer = useCallback(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const w   = vpWidthRef.current;
    const h   = vpHeightRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!phoneConnectedRef.current) return;

    const cam      = cameraRef.current;
    const isMove   = modHeldRef.current || toolRef.current === 'select';
    const isEraser = !isMove && toolRef.current === 'eraser';
    const { x, y } = cursorDisplayWorldRef.current;

    const penR  = isEraser ? Math.max(widthRef.current * 1.5, 8 / cam.zoom) : widthRef.current / 2;
    const minR  = 4 / cam.zoom;
    const ringR = Math.max(penR, minR);
    const ringColor = isMove ? '#38bdf8' : isEraser ? '#fb7185' : colorRef.current;

    const armStart = ringR * 1.25;
    const armEnd   = ringR * 2.5;
    const lw       = 1.5 / cam.zoom;

    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);

    ctx.lineWidth   = lw;
    ctx.strokeStyle = isMove ? '#38bdf8' : isEraser ? 'rgba(251,113,133,0.85)' : 'rgba(248,250,252,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - armEnd, y); ctx.lineTo(x - armStart, y);
    ctx.moveTo(x + armStart, y); ctx.lineTo(x + armEnd, y);
    ctx.moveTo(x, y - armEnd); ctx.lineTo(x, y - armStart);
    ctx.moveTo(x, y + armStart); ctx.lineTo(x, y + armEnd);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth   = lw;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, lw * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    ctx.fill();
    ctx.restore();
  }, []);

  // ── rAF-coalesced render scheduler & smooth cursor slide loop ────────────
  const runRenderFrame = useCallback((now: number) => {
    rafIdRef.current = null;
    const prevTs = lastFrameTsRef.current ?? now;
    const dtMs   = Math.min(100, Math.max(0.5, now - prevTs));
    lastFrameTsRef.current = now;

    let cursorAnimating = false;
    let edgeScrolling = false;

    const hasActiveRemoteDraw =
      activeRemoteRef.current.size > 0 ||
      activeRemoteDraftRef.current.size > 0 ||
      erasingRemoteRef.current.size > 0;
    const hasActiveRemoteMove =
      remotePrevNormRef.current.size > 0 && (modHeldRef.current || toolRef.current === 'select');
    const hasActiveLocalDraw =
      activeLocalRef.current !== null || activeLocalDraftRef.current !== null;

    if (hasActiveRemoteDraw || hasActiveRemoteMove || hasActiveLocalDraw) {
      const cam = cameraRef.current;
      const vw = vpWidthRef.current;
      const vh = vpHeightRef.current;
      const cur = cursorTargetWorldRef.current;
      const sx = (cur.x - cam.x) * cam.zoom;
      const sy = (cur.y - cam.y) * cam.zoom;
      const edgeMargin = 48;
      const maxSpeedPx = 520;

      let vx = 0;
      let vy = 0;
      if (sx < edgeMargin) {
        vx = -Math.min(1, Math.max(0, (edgeMargin - sx) / edgeMargin)) * maxSpeedPx;
      } else if (sx > vw - edgeMargin) {
        vx = Math.min(1, Math.max(0, (sx - (vw - edgeMargin)) / edgeMargin)) * maxSpeedPx;
      }
      if (sy < edgeMargin) {
        vy = -Math.min(1, Math.max(0, (edgeMargin - sy) / edgeMargin)) * maxSpeedPx;
      } else if (sy > vh - edgeMargin) {
        vy = Math.min(1, Math.max(0, (sy - (vh - edgeMargin)) / edgeMargin)) * maxSpeedPx;
      }

      // Also scroll & extend line when stylus/finger is held near the phone pad's own edges
      if (hasActiveRemoteDraw) {
        const phoneEdge = 0.06;
        for (const strokeId of activeRemoteRef.current.keys()) {
          const raw = remoteLastRawPointRef.current.get(strokeId);
          if (!raw) continue;
          if (raw.x < phoneEdge) {
            const pvx = -Math.min(1, Math.max(0, (phoneEdge - raw.x) / phoneEdge)) * maxSpeedPx;
            if (Math.abs(pvx) > Math.abs(vx)) vx = pvx;
          } else if (raw.x > 1 - phoneEdge) {
            const pvx = Math.min(1, Math.max(0, (raw.x - (1 - phoneEdge)) / phoneEdge)) * maxSpeedPx;
            if (Math.abs(pvx) > Math.abs(vx)) vx = pvx;
          }
          if (raw.y < phoneEdge) {
            const pvy = -Math.min(1, Math.max(0, (phoneEdge - raw.y) / phoneEdge)) * maxSpeedPx;
            if (Math.abs(pvy) > Math.abs(vy)) vy = pvy;
          } else if (raw.y > 1 - phoneEdge) {
            const pvy = Math.min(1, Math.max(0, (raw.y - (1 - phoneEdge)) / phoneEdge)) * maxSpeedPx;
            if (Math.abs(pvy) > Math.abs(vy)) vy = pvy;
          }
        }
      }

      if (vx !== 0 || vy !== 0) {
        const dtSec = dtMs / 1000;
        const panDx = (vx * dtSec) / cam.zoom;
        const panDy = (vy * dtSec) / cam.zoom;
        cam.x += panDx;
        cam.y += panDy;
        cursorTargetWorldRef.current.x += panDx;
        cursorTargetWorldRef.current.y += panDy;
        cursorDisplayWorldRef.current.x += panDx;
        cursorDisplayWorldRef.current.y += panDy;
        windowCenterRef.current.x += panDx;
        windowCenterRef.current.y += panDy;

        const nextWp = cursorTargetWorldRef.current;
        for (const s of activeRemoteRef.current.values()) {
          const last = s.points[s.points.length - 1];
          if (!last || Math.hypot(nextWp.x - last.x, nextWp.y - last.y) >= 0.5) {
            const pt: StrokePoint = {
              x: nextWp.x,
              y: nextWp.y,
              p: last?.p ?? 0.5,
              dt: (last?.dt ?? 0) + dtMs,
            };
            s.points.push(pt);
            s.bounds = appendPointToBounds(s.bounds, pt);
          }
        }
        if (activeLocalRef.current) {
          const s = activeLocalRef.current;
          const last = s.points[s.points.length - 1];
          if (!last || Math.hypot(nextWp.x - last.x, nextWp.y - last.y) >= 0.5) {
            const pt: StrokePoint = {
              x: nextWp.x,
              y: nextWp.y,
              p: last?.p ?? 0.5,
              dt: Date.now() - s.createdAt,
            };
            s.points.push(pt);
            s.bounds = appendPointToBounds(s.bounds, pt);
          }
        }
        for (const d of activeRemoteDraftRef.current.values()) {
          if (d.kind === 'shape') d.current = { ...nextWp };
          else d.end = snapLineEnd(d.start, nextWp, shiftHeldRef.current);
        }
        if (activeLocalDraftRef.current) {
          const d = activeLocalDraftRef.current;
          if (d.kind === 'shape') d.current = { ...nextWp };
          else d.end = snapLineEnd(d.start, nextWp, shiftHeldRef.current);
        }

        dirtyStaticRef.current = true;
        dirtyActiveRef.current = true;
        edgeScrolling = true;
      }
    }

    if (phoneConnectedRef.current) {
      const step = stepCursorPosition(
        cursorDisplayWorldRef.current,
        cursorTargetWorldRef.current,
        dtMs,
        {
          tauMs: settingsRef.current.cursorGlideMs,
          epsilon: 0.35 / Math.max(0.2, cameraRef.current.zoom),
        },
      );
      cursorDisplayWorldRef.current.x = step.x;
      cursorDisplayWorldRef.current.y = step.y;
      cursorAnimating = !step.settled;
    }

    if (dirtyStaticRef.current) {
      dirtyStaticRef.current = false;
      pendingAppendElsRef.current.length = 0;
      renderStaticLayer();
    } else if (pendingAppendElsRef.current.length > 0) {
      const pending = pendingAppendElsRef.current.splice(0);
      for (const el of pending) {
        appendElementToStaticLayer(el);
      }
    }

    if (dirtyActiveRef.current || cursorAnimating) {
      dirtyActiveRef.current = false;
      renderActiveLayer();
      renderCursorLayer();
    }

    if (
      cursorAnimating ||
      edgeScrolling ||
      dirtyStaticRef.current ||
      dirtyActiveRef.current ||
      pendingAppendElsRef.current.length > 0
    ) {
      rafIdRef.current = requestAnimationFrame(runRenderFrame);
    } else {
      lastFrameTsRef.current = null;
    }
  }, [renderStaticLayer, appendElementToStaticLayer, renderActiveLayer, renderCursorLayer]);

  const scheduleRender = useCallback((opts?: { static?: boolean; active?: boolean }) => {
    if (opts?.static) dirtyStaticRef.current = true;
    if (opts?.active) dirtyActiveRef.current = true;
    if (rafIdRef.current !== null) return;
    if (lastFrameTsRef.current === null) {
      lastFrameTsRef.current = performance.now();
    }
    rafIdRef.current = requestAnimationFrame(runRenderFrame);
  }, [runRenderFrame]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w   = window.innerWidth;
      const h   = window.innerHeight;
      dprRef.current      = dpr;
      vpWidthRef.current  = w;
      vpHeightRef.current = h;

      for (const c of [staticCanvasRef.current, activeCanvasRef.current, cursorCanvasRef.current]) {
        if (!c) continue;
        c.width        = w * dpr;
        c.height       = h * dpr;
        c.style.width  = `${w}px`;
        c.style.height = `${h}px`;
      }
      if (!phoneConnectedRef.current) {
        const center = screenToWorld(w / 2, h / 2, cameraRef.current);
        cursorTargetWorldRef.current  = { ...center };
        cursorDisplayWorldRef.current = { ...center };
        windowCenterRef.current       = { ...center };
        needsWindowAlignRef.current   = false;
      }
      renderStaticLayer();
      renderActiveLayer();
      renderCursorLayer();
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderStaticLayer, renderActiveLayer, renderCursorLayer]);

  // ── Restore saved board from localStorage on startup ──────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        elements?: BoardElement[];
        strokes?: Stroke[];
        camera?: Camera;
        bgType?: BackgroundType;
      };
      if (Array.isArray(parsed.elements)) {
        elementsRef.current = parsed.elements;
      } else if (Array.isArray(parsed.strokes)) {
        elementsRef.current = parsed.strokes;
      }
      if (
        parsed.camera &&
        typeof parsed.camera.x === 'number' &&
        typeof parsed.camera.y === 'number' &&
        typeof parsed.camera.zoom === 'number'
      ) {
        cameraRef.current = parsed.camera;
        const pct = Math.round(parsed.camera.zoom * 100);
        lastZoomPctRef.current = pct;
        setZoomPct(pct);
      }
      if (parsed.bgType === 'dots' || parsed.bgType === 'grid' || parsed.bgType === 'plain') {
        bgTypeRef.current = parsed.bgType;
        setBgType(parsed.bgType);
      }
      renderStaticLayer();
      renderActiveLayer();
    } catch {
      // Ignore malformed stored board data
    }
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [renderStaticLayer, renderActiveLayer]);

  // ── Actions: Undo / Redo / Delete / Clear / Export / Bg / Label ───────────
  const selectElement = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    scheduleRender({ active: true });
  }, [scheduleRender]);

  // Load page from SQLite when entering /draw
  useEffect(() => {
    if (route !== '/draw') return;
    let cancelled = false;
    const load = async () => {
      let targetPageId = activePageIdRef.current;
      if (!targetPageId) {
        try {
          const res = await fetch('/api/notebooks');
          if (res.ok) {
            const data = await res.json();
            const firstPage = data.notebooks?.[0]?.pages?.[0];
            if (firstPage?.id) {
              targetPageId = firstPage.id;
              if (!cancelled) {
                setActivePageId(firstPage.id);
                activePageIdRef.current = firstPage.id;
                try {
                  window.history.replaceState({}, '', `/draw?page=${encodeURIComponent(firstPage.id)}`);
                } catch { /* ignore */ }
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (!targetPageId || cancelled) return;
      try {
        const res = await fetch(`/api/pages/${targetPageId}`);
        if (!res.ok || cancelled) return;
        const pg = await res.json();
        elementsRef.current = Array.isArray(pg.elements) ? pg.elements : [];
        if (pg.camera && typeof pg.camera.x === 'number') {
          cameraRef.current = pg.camera;
          const pct = Math.round(pg.camera.zoom * 100);
          lastZoomPctRef.current = pct;
          setZoomPct(pct);
        } else {
          cameraRef.current = { x: 0, y: 0, zoom: 1 };
          lastZoomPctRef.current = 100;
          setZoomPct(100);
        }
        if (pg.bgType === 'dots' || pg.bgType === 'grid' || pg.bgType === 'plain') {
          bgTypeRef.current = pg.bgType;
          setBgType(pg.bgType);
        }
        historyRef.current = new CommandHistory();
        syncHistoryFlags();
        selectElement(null);
        scheduleRender({ static: true, active: true });
      } catch { /* ignore */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [route, activePageId, scheduleRender, syncHistoryFlags, selectElement]);

  const undo = useCallback(() => {
    if (!historyRef.current.undo(elementsRef.current)) return;
    if (selectedIdRef.current && !elementsRef.current.some((e) => e.id === selectedIdRef.current)) {
      selectedIdRef.current = null;
      setSelectedId(null);
    }
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const redo = useCallback(() => {
    if (!historyRef.current.redo(elementsRef.current)) return;
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const deleteSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const [removed] = elementsRef.current.splice(idx, 1);
    historyRef.current.push({ type: 'erase', removed: [{ index: idx, element: removed }] });
    selectedIdRef.current = null;
    setSelectedId(null);
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const clearBoard = useCallback(() => {
    if (elementsRef.current.length > 0) {
      historyRef.current.push({ type: 'clear', previous: [...elementsRef.current] });
      syncHistoryFlags();
    }
    elementsRef.current = [];
    pendingAppendElsRef.current.length = 0;
    activeLocalRef.current = null;
    activeLocalDraftRef.current = null;
    activeRemoteRef.current.clear();
    activeRemoteDraftRef.current.clear();
    erasingLocalRef.current = null;
    erasingRemoteRef.current.clear();
    remotePrevNormRef.current.clear();
    remoteSmoothNormRef.current.clear();
    remoteLastRawPointRef.current.clear();
    selectedIdRef.current = null;
    setSelectedId(null);
    setEditingElId(null);
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const cycleBg = useCallback(() => {
    const order: BackgroundType[] = ['dots', 'grid', 'plain'];
    const next = order[(order.indexOf(bgTypeRef.current) + 1) % order.length];
    bgTypeRef.current = next;
    setBgType(next);
    scheduleRender({ static: true });
    scheduleSave();
  }, [scheduleRender, scheduleSave]);

  const eraseAtPoint = useCallback((wp: Point2D, buffer: ErasedEntry[]) => {
    const radius = Math.max(widthRef.current * 1.5, 8 / cameraRef.current.zoom);
    const byId   = buildElementMap();
    let erased   = false;
    for (let i = elementsRef.current.length - 1; i >= 0; i--) {
      const el = elementsRef.current[i];
      if (hitTestElement(el, wp, radius, byId)) {
        elementsRef.current.splice(i, 1);
        buffer.push({ index: i, element: el });
        if (selectedIdRef.current === el.id) {
          selectedIdRef.current = null;
          setSelectedId(null);
        }
        erased = true;
      }
    }
    if (erased) {
      scheduleRender({ static: true, active: true });
    }
  }, [buildElementMap, scheduleRender]);

  const commitElementLabel = useCallback((elId: string, nextLabel: string) => {
    setEditingElId(null);
    const idx = elementsRef.current.findIndex((e) => e.id === elId);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isShapeElement(prev) && !isConnectorElement(prev)) return;
    const clean = nextLabel.trim();
    if ((prev.label ?? '') === clean) return;
    const updated: BoardElement = { ...prev, label: clean || undefined };
    elementsRef.current[idx] = updated;
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after: updated }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const setElementStrokeStyle = useCallback((nextStyle: StrokeStyle) => {
    strokeStyleRef.current = nextStyle;
    setStrokeStyle(nextStyle);

    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isShapeElement(prev) && !isConnectorElement(prev)) return;
    const next: BoardElement = { ...prev, strokeStyle: nextStyle };
    elementsRef.current[idx] = next;
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after: next }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const setElementShapeFill = useCallback((nextFill: string | undefined) => {
    shapeFillRef.current = nextFill;
    setShapeFill(nextFill);

    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isShapeElement(prev)) return;
    const next: ShapeElement = { ...prev, fill: nextFill };
    elementsRef.current[idx] = next;
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after: next }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const toggleSelectedConnectorVariant = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isConnectorElement(prev)) return;
    const next: ConnectorElement = {
      ...prev,
      variant: prev.variant === 'arrow' ? 'line' : 'arrow',
    };
    elementsRef.current[idx] = next;
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after: next }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const flipSelectedConnector = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isConnectorElement(prev)) return;
    const swapped: ConnectorElement = {
      ...prev,
      start: prev.end,
      end: prev.start,
      startBinding: prev.endBinding ?? null,
      endBinding: prev.startBinding ?? null,
    };
    swapped.bounds = computeConnectorBounds(swapped);
    elementsRef.current[idx] = swapped;
    syncBoundConnectors(elementsRef.current);
    const after = elementsRef.current[idx];
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const toggleSelectedConnectorRouting = useCallback(() => {
    const nextRouting: ConnectorRouting = connRoutingRef.current === 'straight' ? 'orthogonal' : 'straight';
    connRoutingRef.current = nextRouting;
    setConnRouting(nextRouting);

    const id = selectedIdRef.current;
    if (!id) return;
    const idx = elementsRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const prev = elementsRef.current[idx];
    if (!isConnectorElement(prev)) return;
    const next: ConnectorElement = {
      ...prev,
      routing: nextRouting,
      bounds: computeConnectorBounds({ ...prev, routing: nextRouting }),
    };
    elementsRef.current[idx] = next;
    historyRef.current.push({ type: 'patch', patches: [{ before: prev, after: next }] });
    syncHistoryFlags();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [syncHistoryFlags, scheduleRender, scheduleSave]);

  const exportPng = useCallback(() => {
    const elements = elementsRef.current;
    const bounds   = computeBoardBounds(elements);
    const pad      = 48;
    const worldX   = bounds ? bounds.minX - pad : cameraRef.current.x;
    const worldY   = bounds ? bounds.minY - pad : cameraRef.current.y;
    const worldW   = bounds ? bounds.maxX - bounds.minX + pad * 2 : vpWidthRef.current / cameraRef.current.zoom;
    const worldH   = bounds ? bounds.maxY - bounds.minY + pad * 2 : vpHeightRef.current / cameraRef.current.zoom;

    const maxDim = 4096;
    const scale  = Math.min(2, maxDim / Math.max(1, worldW, worldH));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(worldW * scale));
    canvas.height = Math.max(1, Math.round(worldH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#06090f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const byId = buildElementMap();
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-worldX, -worldY);
    for (const el of elements) {
      renderBoardElement(ctx, el, byId, strokePathCacheRef.current);
    }
    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `scripta-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [buildElementMap]);

  const resetView = useCallback(() => {
    cameraRef.current = { x: 0, y: 0, zoom: 1 };
    const center = screenToWorld(
      vpWidthRef.current / 2, vpHeightRef.current / 2, cameraRef.current
    );
    cursorTargetWorldRef.current  = { ...center };
    cursorDisplayWorldRef.current = { ...center };
    windowCenterRef.current       = { ...center };
    needsWindowAlignRef.current   = false;
    lastZoomPctRef.current = 100;
    setZoomPct(100);
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [scheduleRender, scheduleSave]);

  const autoPanToWorldPoint = useCallback((pt: Point2D, margin = 8): boolean => {
    const cam    = cameraRef.current;
    const w      = vpWidthRef.current;
    const h      = vpHeightRef.current;
    const sx     = (pt.x - cam.x) * cam.zoom;
    const sy     = (pt.y - cam.y) * cam.zoom;
    let panned   = false;

    if (sx < margin)           { cam.x -= (margin - sx) / cam.zoom; panned = true; }
    else if (sx > w - margin)  { cam.x += (sx - (w - margin)) / cam.zoom; panned = true; }
    if (sy < margin)           { cam.y -= (margin - sy) / cam.zoom; panned = true; }
    else if (sy > h - margin)  { cam.y += (sy - (h - margin)) / cam.zoom; panned = true; }
    return panned;
  }, []);

  const clampCursorIntoViewportOnPan = useCallback(() => {
    if (!phoneConnectedRef.current) return;
    const cam    = cameraRef.current;
    const w      = vpWidthRef.current;
    const h      = vpHeightRef.current;
    const pad    = Math.min(48, Math.min(w, h) * 0.1) / cam.zoom;
    const minX   = cam.x + pad;
    const maxX   = cam.x + w / cam.zoom - pad;
    const minY   = cam.y + pad;
    const maxY   = cam.y + h / cam.zoom - pad;
    const cur    = cursorTargetWorldRef.current;
    const clampedX = Math.min(Math.max(cur.x, minX), maxX);
    const clampedY = Math.min(Math.max(cur.y, minY), maxY);
    if (clampedX !== cur.x || clampedY !== cur.y) {
      cursorTargetWorldRef.current  = { x: clampedX, y: clampedY };
      cursorDisplayWorldRef.current = { x: clampedX, y: clampedY };
      windowCenterRef.current       = { x: clampedX, y: clampedY };
      needsWindowAlignRef.current   = true;
    }
  }, []);

  const zoomToFit = useCallback(() => {
    const fitted = computeFitCamera(elementsRef.current, vpWidthRef.current, vpHeightRef.current);
    if (!fitted) {
      resetView();
      return;
    }
    cameraRef.current = fitted;
    const pct = Math.round(fitted.zoom * 100);
    lastZoomPctRef.current = pct;
    setZoomPct(pct);
    clampCursorIntoViewportOnPan();
    scheduleRender({ static: true, active: true });
    scheduleSave();
  }, [resetView, clampCursorIntoViewportOnPan, scheduleRender, scheduleSave]);

  const moveCursorBy = useCallback((dx: number, dy: number) => {
    cursorTargetWorldRef.current.x += dx;
    cursorTargetWorldRef.current.y += dy;
    windowCenterRef.current.x      += dx;
    windowCenterRef.current.y      += dy;
    needsWindowAlignRef.current     = true;

    // Hard-clamp only if a large jump goes past the edge; smooth continuous edge-scroll runs in rAF.
    const margin = 6;
    const panned = autoPanToWorldPoint(cursorTargetWorldRef.current, margin);
    scheduleRender({ static: panned, active: true });
  }, [autoPanToWorldPoint, scheduleRender]);

  const cancelRemoteDrawStrokes = useCallback((convertToMove: boolean) => {
    for (const strokeId of [...activeRemoteRef.current.keys()]) {
      const drawNorm = remotePrevNormRef.current.get(drawKey(strokeId));
      activeRemoteRef.current.delete(strokeId);
      remotePrevNormRef.current.delete(drawKey(strokeId));
      remoteSmoothNormRef.current.delete(strokeId);
      remoteLastRawPointRef.current.delete(strokeId);
      if (convertToMove && drawNorm) {
        remotePrevNormRef.current.set(strokeId, drawNorm);
      }
    }
    for (const strokeId of [...activeRemoteDraftRef.current.keys()]) {
      const drawNorm = remotePrevNormRef.current.get(drawKey(strokeId));
      activeRemoteDraftRef.current.delete(strokeId);
      remotePrevNormRef.current.delete(drawKey(strokeId));
      remoteSmoothNormRef.current.delete(strokeId);
      remoteLastRawPointRef.current.delete(strokeId);
      if (convertToMove && drawNorm) {
        remotePrevNormRef.current.set(strokeId, drawNorm);
      }
    }
    for (const [strokeId, erased] of erasingRemoteRef.current.entries()) {
      const drawNorm = remotePrevNormRef.current.get(drawKey(strokeId));
      remotePrevNormRef.current.delete(drawKey(strokeId));
      remoteSmoothNormRef.current.delete(strokeId);
      remoteLastRawPointRef.current.delete(strokeId);
      if (erased.length > 0) {
        historyRef.current.push({ type: 'erase', removed: erased });
        syncHistoryFlags();
        scheduleSave();
      }
      if (convertToMove && drawNorm) {
        remotePrevNormRef.current.set(strokeId, drawNorm);
      }
    }
    erasingRemoteRef.current.clear();
    snapPreviewRef.current = null;
    scheduleRender({ active: true });
  }, [syncHistoryFlags, scheduleSave, scheduleRender]);

  const enterMoveMode = useCallback(() => {
    if (modHeldRef.current) return;
    modHeldRef.current = true;
    setModHeld(true);
    cancelRemoteDrawStrokes(true);
    sendToMobile('desktop.cursor', { mode: 'move' });
    scheduleRender({ active: true });
  }, [cancelRemoteDrawStrokes, sendToMobile, scheduleRender]);

  const exitMoveMode = useCallback(() => {
    if (!modHeldRef.current) return;
    modHeldRef.current = false;
    setModHeld(false);
    remotePrevNormRef.current.clear();
    remoteSmoothNormRef.current.clear();
    remoteLastRawPointRef.current.clear();
    sendToMobile('desktop.cursor', { mode: 'draw' });
    scheduleRender({ active: true });
  }, [sendToMobile, scheduleRender]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingElIdRef.current) return;
      if (modalOpenRef.current) return;

      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === 'Enter' && selectedIdRef.current) {
        const el = elementsRef.current.find((x) => x.id === selectedIdRef.current);
        if (el && (isShapeElement(el) || isConnectorElement(el))) {
          e.preventDefault();
          setEditingElId(el.id);
          setLabelInput(el.label ?? '');
          return;
        }
      }
      if (e.key === 'Shift') {
        shiftHeldRef.current = true;
      }
      if ((e.key === 'Control' || e.key === 'Meta') && !modHeldRef.current) {
        enterMoveMode();
      }
      if (e.code === 'Space' && !spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const toolMap: Record<string, ToolType> = {
          v: 'select',
          p: 'pen',
          h: 'highlighter',
          e: 'eraser',
          r: 'rect',
          o: 'ellipse',
          d: 'diamond',
          l: 'line',
          a: 'arrow',
        };
        if (toolMap[k]) {
          setTool(toolMap[k]);
          if (toolMap[k] !== 'select') selectElement(null);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = false;
      if (e.key === 'Control' || e.key === 'Meta') exitMoveMode();
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    const onBlur = () => {
      shiftHeldRef.current = false;
      exitMoveMode();
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    window.addEventListener('blur',    onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      window.removeEventListener('blur',    onBlur);
    };
  }, [undo, redo, deleteSelected, selectElement, enterMoveMode, exitMoveMode]);

  // ── Sync tool/color to phone ──────────────────────────────────────────────
  useEffect(() => {
    if (!phoneConnected) return;
    sendToMobile('desktop.state', {
      tool,
      color,
      width,
      smoothness: settings.phoneSmoothness,
    });
  }, [tool, color, width, phoneConnected, sendToMobile, settings.phoneSmoothness]);

  // ── First-run tutorial ───────────────────────────────────────────────────
  useEffect(() => {
    if (showLanding) return;
    if (suppressTutorialRef.current) {
      suppressTutorialRef.current = false;
      return;
    }
    if (!settings.showTutorialOnStart) return;
    if (hasSeenTutorial()) return;
    const timer = window.setTimeout(() => setShowTutorial(true), 700);
    return () => window.clearTimeout(timer);
  }, [showLanding, settings.showTutorialOnStart]);

  // Helper to commit a finished shape or connector draft
  const commitDraftElement = useCallback((draft: ActiveDraft) => {
    if (draft.kind === 'shape') {
      const r = normalizeRect(draft.start, draft.current, shiftHeldRef.current);
      if (r.w < 6 && r.h < 6) return;
      const shape: ShapeElement = {
        id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'shape',
        shape: draft.shape,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        color: draft.color,
        strokeWidth: draft.strokeWidth,
        strokeStyle: draft.strokeStyle,
        fill: draft.fill,
        bounds: computeShapeBounds(r),
        createdAt: Date.now(),
      };
      elementsRef.current.push(shape);
      historyRef.current.push({ type: 'add', element: shape });
      syncHistoryFlags();
      pendingAppendElsRef.current.push(shape);
      scheduleSave();
      return;
    }

    const connDraft = buildDraftConnector(draft);
    if (Math.hypot(connDraft.end.x - connDraft.start.x, connDraft.end.y - connDraft.start.y) < 4) {
      return;
    }
    const conn: ConnectorElement = {
      ...connDraft,
      id: `cn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    elementsRef.current.push(conn);
    historyRef.current.push({ type: 'add', element: conn });
    syncHistoryFlags();
    pendingAppendElsRef.current.push(conn);
    scheduleSave();
  }, [buildDraftConnector, syncHistoryFlags, scheduleSave]);

  // ── WebSocket message handler ─────────────────────────────────────────────
  const handleWsMessage = useCallback((msg: ScriptaWsMessage) => {
    switch (msg.type) {
      case 'session.pending':
        setPendingDevice(msg.payload);
        break;

      case 'session.devices':
        setConnectedDevices(msg.payload.devices || []);
        break;

      case 'peer.connected':
        if (msg.payload.role === 'mobile') {
          setPendingDevice(null);
          if (msg.payload.aspectRatio) phoneAspectRef.current = msg.payload.aspectRatio;
          phoneConnectedRef.current = true;
          setPhoneConnected(true);
          setShowQrModal(false);
          const center = screenToWorld(
            vpWidthRef.current / 2, vpHeightRef.current / 2, cameraRef.current
          );
          cursorTargetWorldRef.current  = { ...center };
          cursorDisplayWorldRef.current = { ...center };
          windowCenterRef.current       = { ...center };
          needsWindowAlignRef.current   = true;
          sendToMobile('desktop.cursor', { mode: modHeldRef.current ? 'move' : 'draw' });
          scheduleRender({ active: true });
        }
        break;

      case 'peer.disconnected':
        if (msg.payload.role === 'mobile') {
          phoneConnectedRef.current = false;
          setPhoneConnected(false);
          activeRemoteRef.current.clear();
          activeRemoteDraftRef.current.clear();
          remotePrevNormRef.current.clear();
          remoteSmoothNormRef.current.clear();
          remoteLastRawPointRef.current.clear();
          snapPreviewRef.current = null;
          scheduleRender({ active: true });
        }
        break;

      case 'pad.resize':
        cancelRemoteDrawStrokes(false);
        phoneAspectRef.current = msg.payload.aspectRatio;
        needsWindowAlignRef.current = true;
        scheduleRender({ active: true });
        break;

      case 'stroke.start': {
        const { strokeId, deviceId, tool: rawTool, color: c, width: bw, point } = msg.payload;

        if (modHeldRef.current || toolRef.current === 'select') {
          remotePrevNormRef.current.set(strokeId, { x: point.x, y: point.y });
          remoteMoveMetaRef.current.set(strokeId, {
            startNorm: { x: point.x, y: point.y },
            maxDistSq: 0,
            startedAt: Date.now(),
          });
          break;
        }

        const activeTool = toolRef.current || rawTool;

        if (needsWindowAlignRef.current) {
          windowCenterRef.current = alignWritingWindowCenter(
            { x: point.x, y: point.y },
            cursorTargetWorldRef.current,
            phoneAspectRef.current,
            cameraRef.current,
            vpWidthRef.current,
            vpHeightRef.current,
            settingsRef.current.writingWindowRatio,
          );
          needsWindowAlignRef.current = false;
        }

        const win = getWritingWindow();
        const wp  = windowNormToWorld(point.x, point.y, win);
        cursorTargetWorldRef.current = wp;
        remotePrevNormRef.current.set(drawKey(strokeId), { x: point.x, y: point.y });
        remoteSmoothNormRef.current.set(strokeId, createOneEuroState({ x: point.x, y: point.y }, point.dt));
        remoteLastRawPointRef.current.set(strokeId, point);

        if (activeTool === 'eraser') {
          const buf: ErasedEntry[] = [];
          erasingRemoteRef.current.set(strokeId, buf);
          eraseAtPoint(wp, buf);
          const panned = autoPanToWorldPoint(wp);
          scheduleRender({ static: panned, active: true });
          break;
        }

        if (isShapeTool(activeTool)) {
          activeRemoteDraftRef.current.set(strokeId, {
            kind: 'shape',
            shape: activeTool,
            start: wp,
            current: wp,
            color: c,
            strokeWidth: Math.max(2, bw * 0.6),
            strokeStyle: strokeStyleRef.current,
            fill: shapeFillRef.current,
          });
          scheduleRender({ active: true });
          break;
        }

        if (isConnectorTool(activeTool)) {
          const snap = findSnapAnchor(wp, elementsRef.current, 18 / cameraRef.current.zoom);
          snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
          activeRemoteDraftRef.current.set(strokeId, {
            kind: 'connector',
            variant: activeTool,
            routing: connRoutingRef.current,
            start: snap ? snap.pt : wp,
            end: snap ? snap.pt : wp,
            startBinding: snap ? snap.binding : null,
            endBinding: null,
            color: c,
            strokeWidth: Math.max(2, bw * 0.6),
            strokeStyle: strokeStyleRef.current,
          });
          scheduleRender({ active: true });
          break;
        }

        const pt: StrokePoint = { x: wp.x, y: wp.y, p: point.p, dt: 0 };
        activeRemoteRef.current.set(strokeId, {
          id: strokeId,
          kind: 'stroke',
          tool: activeTool,
          color: c,
          baseWidth: bw,
          points: [pt],
          bounds: computeBounds([pt]),
          createdAt: msg.ts,
          deviceId,
        });
        const panned = autoPanToWorldPoint(wp);
        scheduleRender({ static: panned, active: true });
        break;
      }

      case 'stroke.points': {
        const { strokeId, points } = msg.payload;
        if (points.length === 0) break;

        if (remotePrevNormRef.current.has(strokeId)) {
          const prevNorm = remotePrevNormRef.current.get(strokeId)!;
          const newest   = points[points.length - 1];
          const meta     = remoteMoveMetaRef.current.get(strokeId);
          if (meta) {
            for (const p of points) {
              const dSq = (p.x - meta.startNorm.x) ** 2 + (p.y - meta.startNorm.y) ** 2;
              if (dSq > meta.maxDistSq) meta.maxDistSq = dSq;
            }
          }
          const { dx, dy } = normDeltaToWorld(
            newest.x - prevNorm.x,
            newest.y - prevNorm.y,
            phoneAspectRef.current,
            cameraRef.current,
            vpWidthRef.current,
          );
          moveCursorBy(dx, dy);
          remotePrevNormRef.current.set(strokeId, { x: newest.x, y: newest.y });
          break;
        }

        if (!remotePrevNormRef.current.has(drawKey(strokeId))) break;

        const eraseBuf = erasingRemoteRef.current.get(strokeId);
        if (eraseBuf) {
          const win = getWritingWindow();
          let filterState = remoteSmoothNormRef.current.get(strokeId);
          let lastWp: Point2D | null = null;
          for (const raw of points) {
            if (!filterState) {
              filterState = createOneEuroState({ x: raw.x, y: raw.y }, raw.dt);
              remoteSmoothNormRef.current.set(strokeId, filterState);
            }
            const smoothed = filterOneEuroPoint(
              filterState,
              { x: raw.x, y: raw.y },
              raw.dt,
              settingsRef.current.phoneSmoothness,
              1,
            );
            remoteLastRawPointRef.current.set(strokeId, raw);
            const wp = windowNormToWorld(smoothed.x, smoothed.y, win);
            eraseAtPoint(wp, eraseBuf);
            lastWp = wp;
          }
          const newest = points[points.length - 1];
          remotePrevNormRef.current.set(drawKey(strokeId), { x: newest.x, y: newest.y });
          if (lastWp) {
            cursorTargetWorldRef.current = lastWp;
            const panned = autoPanToWorldPoint(lastWp);
            scheduleRender({ static: panned, active: true });
          }
          break;
        }

        const draft = activeRemoteDraftRef.current.get(strokeId);
        if (draft) {
          const win = getWritingWindow();
          const newest = points[points.length - 1];
          let filterState = remoteSmoothNormRef.current.get(strokeId);
          if (!filterState) {
            filterState = createOneEuroState({ x: newest.x, y: newest.y }, newest.dt);
            remoteSmoothNormRef.current.set(strokeId, filterState);
          }
          const smoothed = filterOneEuroPoint(
            filterState,
            { x: newest.x, y: newest.y },
            newest.dt,
            settingsRef.current.phoneSmoothness,
            1,
          );
          remoteLastRawPointRef.current.set(strokeId, newest);
          const wp = windowNormToWorld(smoothed.x, smoothed.y, win);
          remotePrevNormRef.current.set(drawKey(strokeId), { x: newest.x, y: newest.y });
          cursorTargetWorldRef.current = wp;
          if (draft.kind === 'shape') {
            draft.current = wp;
          } else {
            const snap = findSnapAnchor(wp, elementsRef.current, 18 / cameraRef.current.zoom);
            snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
            draft.end = snap ? snap.pt : snapLineEnd(draft.start, wp, shiftHeldRef.current);
            draft.endBinding = snap ? snap.binding : null;
          }
          scheduleRender({ active: true });
          break;
        }

        const s = activeRemoteRef.current.get(strokeId);
        if (!s) break;
        const win = getWritingWindow();
        let filterState = remoteSmoothNormRef.current.get(strokeId);
        let lastWp: Point2D | null = null;
        for (const raw of points) {
          if (!filterState) {
            filterState = createOneEuroState({ x: raw.x, y: raw.y }, raw.dt);
            remoteSmoothNormRef.current.set(strokeId, filterState);
          }
          const smoothed = filterOneEuroPoint(
            filterState,
            { x: raw.x, y: raw.y },
            raw.dt,
            settingsRef.current.phoneSmoothness,
            1,
          );
          remoteLastRawPointRef.current.set(strokeId, raw);
          const wp = windowNormToWorld(smoothed.x, smoothed.y, win);
          const pt: StrokePoint = { x: wp.x, y: wp.y, p: raw.p, dt: raw.dt };
          s.points.push(pt);
          s.bounds = appendPointToBounds(s.bounds, pt);
          lastWp = wp;
        }
        const newest = points[points.length - 1];
        remotePrevNormRef.current.set(drawKey(strokeId), { x: newest.x, y: newest.y });
        if (lastWp) {
          cursorTargetWorldRef.current = lastWp;
          const panned = autoPanToWorldPoint(lastWp);
          scheduleRender({ static: panned, active: true });
        } else {
          scheduleRender({ active: true });
        }
        break;
      }

      case 'stroke.end': {
        const { strokeId } = msg.payload;
        const moveMeta = remoteMoveMetaRef.current.get(strokeId);
        remoteMoveMetaRef.current.delete(strokeId);
        const wasMoveGesture = remotePrevNormRef.current.has(strokeId);
        remotePrevNormRef.current.delete(strokeId);
        remotePrevNormRef.current.delete(drawKey(strokeId));
        const lastRaw = remoteLastRawPointRef.current.get(strokeId);
        const filterState = remoteSmoothNormRef.current.get(strokeId);
        remoteSmoothNormRef.current.delete(strokeId);
        remoteLastRawPointRef.current.delete(strokeId);

        if (wasMoveGesture) {
          if (moveMeta && moveMeta.maxDistSq < 0.0004 && Date.now() - moveMeta.startedAt < 320) {
            const cam = cameraRef.current;
            const wp  = cursorTargetWorldRef.current;
            const sx  = (wp.x - cam.x) * cam.zoom;
            const sy  = (wp.y - cam.y) * cam.zoom;
            const hitDom = document.elementFromPoint(sx, sy);
            if (
              hitDom &&
              hitDom !== activeCanvasRef.current &&
              hitDom !== staticCanvasRef.current &&
              hitDom !== cursorCanvasRef.current
            ) {
              const clickable = hitDom.closest('button, [role="button"], a, input, select') as HTMLElement | null;
              if (clickable) {
                clickable.click();
                if (clickable.tagName === 'INPUT') clickable.focus();
                break;
              }
            }
            if (toolRef.current === 'select') {
              const byId = buildElementMap();
              const hitR = 8 / cam.zoom;
              let hitEl: BoardElement | null = null;
              for (let i = elementsRef.current.length - 1; i >= 0; i--) {
                if (hitTestElement(elementsRef.current[i], wp, hitR, byId)) {
                  hitEl = elementsRef.current[i];
                  break;
                }
              }
              selectElement(hitEl ? hitEl.id : null);
              scheduleRender({ active: true });
            }
          }
          break;
        }

        const eraseBuf = erasingRemoteRef.current.get(strokeId);
        if (eraseBuf) {
          erasingRemoteRef.current.delete(strokeId);
          if (lastRaw) {
            const win = getWritingWindow();
            const wp = windowNormToWorld(lastRaw.x, lastRaw.y, win);
            eraseAtPoint(wp, eraseBuf);
          }
          if (eraseBuf.length > 0) {
            historyRef.current.push({ type: 'erase', removed: eraseBuf });
            syncHistoryFlags();
            scheduleSave();
          }
          break;
        }

        const draft = activeRemoteDraftRef.current.get(strokeId);
        if (draft) {
          activeRemoteDraftRef.current.delete(strokeId);
          snapPreviewRef.current = null;
          if (lastRaw) {
            const win = getWritingWindow();
            const wp = windowNormToWorld(lastRaw.x, lastRaw.y, win);
            if (draft.kind === 'shape') {
              draft.current = wp;
            } else {
              const snap = findSnapAnchor(wp, elementsRef.current, 18 / cameraRef.current.zoom);
              snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
              draft.end = snap ? snap.pt : snapLineEnd(draft.start, wp, shiftHeldRef.current);
              draft.endBinding = snap ? snap.binding : null;
            }
          }
          commitDraftElement(draft);
          scheduleRender({ active: true });
          break;
        }

        const s = activeRemoteRef.current.get(strokeId);
        if (!s) break;

        if (lastRaw) {
          const win = getWritingWindow();
          const endNorm = filterState
            ? filterOneEuroPoint(
                filterState,
                { x: lastRaw.x, y: lastRaw.y },
                lastRaw.dt,
                settingsRef.current.phoneSmoothness,
                1,
              )
            : { x: lastRaw.x, y: lastRaw.y };
          const wp = windowNormToWorld(endNorm.x, endNorm.y, win);
          const last = s.points[s.points.length - 1];
          if (!last || Math.hypot(wp.x - last.x, wp.y - last.y) > 0.01) {
            const pt: StrokePoint = { x: wp.x, y: wp.y, p: lastRaw.p, dt: lastRaw.dt };
            s.points.push(pt);
          }
        }

        s.points = beautifyStrokePoints(s.points, {
          smoothness: settingsRef.current.phoneSmoothness,
          baseWidth: s.baseWidth / Math.max(0.2, cameraRef.current.zoom),
        });
        s.bounds = computeBounds(s.points);

        if (s.points.length >= 1) {
          elementsRef.current.push(s);
          historyRef.current.push({ type: 'add', element: s });
          syncHistoryFlags();
          getCachedStrokePath(s);
          pendingAppendElsRef.current.push(s);
          scheduleSave();
        }
        activeRemoteRef.current.delete(strokeId);
        scheduleRender({ active: true });
        break;
      }

      case 'stroke.cancel': {
        const { strokeId } = msg.payload;
        remoteMoveMetaRef.current.delete(strokeId);
        remotePrevNormRef.current.delete(strokeId);
        remotePrevNormRef.current.delete(drawKey(strokeId));
        remoteSmoothNormRef.current.delete(strokeId);
        remoteLastRawPointRef.current.delete(strokeId);
        const erased = erasingRemoteRef.current.get(strokeId);
        if (erased && erased.length > 0) {
          for (let i = erased.length - 1; i >= 0; i--) {
            const { index, element } = erased[i];
            elementsRef.current.splice(Math.min(index, elementsRef.current.length), 0, element);
          }
          scheduleRender({ static: true, active: true });
        }
        erasingRemoteRef.current.delete(strokeId);
        activeRemoteDraftRef.current.delete(strokeId);
        activeRemoteRef.current.delete(strokeId);
        snapPreviewRef.current = null;
        scheduleRender({ active: true });
        break;
      }

      case 'mobile.style': {
        if (msg.payload.color) setColor(msg.payload.color);
        if (typeof msg.payload.width === 'number') setWidth(msg.payload.width);
        if (msg.payload.tool) {
          setTool(msg.payload.tool);
          if (msg.payload.tool !== 'select') selectElement(null);
        }
        break;
      }

      case 'command.trigger':
        switch (msg.payload.action) {
          case 'undo':            undo();        break;
          case 'clear':           clearBoard();  break;
          case 'enter_move':      enterMoveMode(); break;
          case 'exit_move':       exitMoveMode(); break;
          case 'recenter_cursor': {
            const center = screenToWorld(
              vpWidthRef.current / 2, vpHeightRef.current / 2, cameraRef.current
            );
            cursorTargetWorldRef.current = { ...center };
            windowCenterRef.current      = { ...center };
            needsWindowAlignRef.current  = true;
            scheduleRender({ active: true });
            break;
          }
        }
        break;
    }
  }, [
    undo, clearBoard, moveCursorBy, cancelRemoteDrawStrokes,
    enterMoveMode, exitMoveMode, getWritingWindow, getCachedStrokePath,
    autoPanToWorldPoint, eraseAtPoint, commitDraftElement, syncHistoryFlags,
    scheduleSave, sendToMobile, scheduleRender, buildElementMap, selectElement,
  ]);

  // ── Pairing ──────────────────────────────────────────────────────────────
  const startPairing = useCallback(async () => {
    setPairError(null);
    setShowQrModal(true);

    try {
      const [pairRes, netRes] = await Promise.all([
        fetch('/api/pair/create', { method: 'POST' }),
        fetch('/api/network-info'),
      ]);
      if (!pairRes.ok) throw new Error('Failed to create pairing session');

      const pairData = await pairRes.json();
      const netData  = netRes.ok ? await netRes.json() : { lanIp: window.location.hostname };
      const mobileOrigin =
        import.meta.env.VITE_MOBILE_ORIGIN ||
        (import.meta.env.PROD
          ? `${window.location.origin}/m`
          : `${window.location.protocol}//${netData.lanIp}:5174`);
      const mobileUrl = `${mobileOrigin}/?code=${pairData.pairCode}&qr=${encodeURIComponent(pairData.qrSecret || '')}`;
      const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
        width: 240, margin: 2,
        color: { dark: '#0f172a', light: '#f8fafc' },
      });

      setPairing({ sessionId: pairData.sessionId, pairCode: pairData.pairCode,
                   hostToken: pairData.hostToken, qrDataUrl, mobileUrl });

      if (wsRef.current) wsRef.current.close();
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${wsProto}//${window.location.host}/ws?sessionId=${pairData.sessionId}&role=desktop&token=${pairData.hostToken}`
      );
      wsRef.current = ws;
      ws.onmessage = (event) => handleWsMessage(JSON.parse(event.data) as ScriptaWsMessage);
      ws.onclose   = () => {
        phoneConnectedRef.current = false;
        setPhoneConnected(false);
        scheduleRender({ active: true });
      };
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Pairing failed');
    }
  }, [handleWsMessage, scheduleRender]);

  // ── Landing / tutorial / help dialogs ────────────────────────────────────
  const dismissLanding = useCallback((action: 'start' | 'tour' | 'connect' | 'skip') => {
    try {
      window.localStorage.setItem(LANDING_KEY, 'seen');
    } catch {
      // Ignore storage errors
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('welcome')) {
        url.searchParams.delete('welcome');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignore URL/history errors
    }

    if (action === 'tour') {
      suppressTutorialRef.current = true;
      setShowLanding(false);
      navigateTo('/draw');
      setShowTutorial(true);
      return;
    }
    if (action === 'connect') {
      suppressTutorialRef.current = true;
      setShowLanding(false);
      navigateTo('/draw');
      void startPairing();
      return;
    }
    if (action === 'skip') {
      setShowLanding(false);
      navigateTo('/notes');
      return;
    }
    setShowLanding(false);
    navigateTo('/draw');
  }, [startPairing, navigateTo]);

  const kickDevice = useCallback(async (deviceId: string) => {
    if (!pairing?.sessionId) return;
    try {
      await fetch(`/api/sessions/${pairing.sessionId}/devices/${encodeURIComponent(deviceId)}/kick`, {
        method: 'POST',
      });
    } catch { /* ignore */ }
  }, [pairing?.sessionId]);

  const respondApproval = useCallback(async (allow: boolean) => {
    if (!pairing?.sessionId || !pendingDevice) return;
    const devId = pendingDevice.deviceId;
    setPendingDevice(null);
    try {
      await fetch(`/api/sessions/${pairing.sessionId}/devices/${encodeURIComponent(devId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow }),
      });
    } catch { /* ignore */ }
  }, [pairing?.sessionId, pendingDevice]);

  const handleTutorialClose = useCallback(() => {
    setShowTutorial(false);
    try {
      window.localStorage.setItem(TUTORIAL_KEY, 'seen');
    } catch {
      // Ignore storage errors
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('tour')) {
        url.searchParams.delete('tour');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignore URL/history errors
    }
  }, []);

  const openTutorial = useCallback(() => {
    setShowHelp(false);
    setShowSettings(false);
    setShowLanding(false);
    setShowTutorial(true);
  }, []);

  const openSettings = useCallback(() => {
    setShowHelp(false);
    setShowTutorial(false);
    setShowLanding(false);
    setShowSettings(true);
  }, []);

  const openHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const openWelcome = useCallback(() => {
    setShowHelp(false);
    setShowSettings(false);
    setShowTutorial(false);
    setShowLanding(true);
  }, []);

  const openConnect = useCallback(() => {
    setShowHelp(false);
    setShowSettings(false);
    setShowTutorial(false);
    setShowLanding(false);
    void startPairing();
  }, [startPairing]);

  // ── Escape closes the top-most dialog ────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showTutorial) return; // TutorialModal handles its own Escape
      if (showSettings) { setShowSettings(false); return; }
      if (showHelp) { setShowHelp(false); return; }
      if (showQrModal) { setShowQrModal(false); return; }
      if (showLanding) { dismissLanding('skip'); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTutorial, showSettings, showHelp, showQrModal, showLanding, dismissLanding]);

  // ── Wheel (pan + zoom) ───────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = cameraRef.current;
    if (e.ctrlKey || e.metaKey) {
      const factor   = e.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = Math.min(4, Math.max(0.2, cam.zoom * factor));
      const wb       = screenToWorld(e.clientX, e.clientY, cam);
      cam.zoom       = nextZoom;
      cam.x          = wb.x - e.clientX / nextZoom;
      cam.y          = wb.y - e.clientY / nextZoom;
      const nextPct  = Math.round(nextZoom * 100);
      if (nextPct !== lastZoomPctRef.current) {
        lastZoomPctRef.current = nextPct;
        setZoomPct(nextPct);
      }
    } else {
      cam.x += e.deltaX / cam.zoom;
      cam.y += e.deltaY / cam.zoom;
      clampCursorIntoViewportOnPan();
    }
    scheduleRender({ static: true, active: true });
    scheduleSave();
  };

  // ── Selection handle hit-testing ─────────────────────────────────────────
  const hitResizeCorner = (shape: ShapeElement, wp: Point2D, camZoom: number): ResizeCorner | null => {
    const pad = 6 / camZoom;
    const hitR = 10 / camZoom;
    const b = shape.bounds;
    const corners: { corner: ResizeCorner; x: number; y: number }[] = [
      { corner: 'nw', x: b.minX - pad, y: b.minY - pad },
      { corner: 'ne', x: b.maxX + pad, y: b.minY - pad },
      { corner: 'sw', x: b.minX - pad, y: b.maxY + pad },
      { corner: 'se', x: b.maxX + pad, y: b.maxY + pad },
    ];
    for (const c of corners) {
      if (Math.hypot(wp.x - c.x, wp.y - c.y) <= hitR) return c.corner;
    }
    return null;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wp = screenToWorld(e.clientX, e.clientY, cameraRef.current);
    const byId = buildElementMap();
    const hitR = 8 / cameraRef.current.zoom;
    for (let i = elementsRef.current.length - 1; i >= 0; i--) {
      const el = elementsRef.current[i];
      if ((isShapeElement(el) || isConnectorElement(el)) && hitTestElement(el, wp, hitR, byId)) {
        selectElement(el.id);
        setEditingElId(el.id);
        setLabelInput(el.label ?? '');
        return;
      }
    }
  };

  // ── Local pointer (mouse / trackpad / local stylus) ──────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (editingElIdRef.current) {
      commitElementLabel(editingElIdRef.current, labelInput);
    }

    if (spaceHeldRef.current || e.button === 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
      panningRef.current = {
        startX: e.clientX, startY: e.clientY,
        camX: cameraRef.current.x, camY: cameraRef.current.y,
      };
      return;
    }
    const wp = screenToWorld(e.clientX, e.clientY, cameraRef.current);
    if (modHeldRef.current && phoneConnectedRef.current) {
      windowCenterRef.current       = { ...wp };
      cursorTargetWorldRef.current  = { ...wp };
      cursorDisplayWorldRef.current = { ...wp };
      needsWindowAlignRef.current   = true;
      scheduleRender({ active: true });
      return;
    }

    if (localPointerIdRef.current !== null) return;
    localPointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    const cam = cameraRef.current;
    const t = toolRef.current;

    if (t === 'select') {
      const byId = buildElementMap();
      const sel = selectedIdRef.current ? byId.get(selectedIdRef.current) : undefined;

      // 1. Check resize/endpoint handles on currently selected element
      if (sel && isShapeElement(sel)) {
        const corner = hitResizeCorner(sel, wp, cam.zoom);
        if (corner) {
          const snaps = new Map<string, BoardElement>([[sel.id, sel]]);
          for (const el of elementsRef.current) {
            if (isConnectorElement(el) && (el.startBinding?.elementId === sel.id || el.endBinding?.elementId === sel.id)) {
              snaps.set(el.id, el);
            }
          }
          selectDragRef.current = {
            mode: 'resize',
            elementId: sel.id,
            corner,
            origShape: sel,
            snapshots: snaps,
          };
          return;
        }
      }
      if (sel && isConnectorElement(sel)) {
        const { start, end } = resolveConnectorEndpoints(sel, byId);
        const endHitR = 11 / cam.zoom;
        if (Math.hypot(wp.x - start.x, wp.y - start.y) <= endHitR) {
          selectDragRef.current = { mode: 'endpoint', elementId: sel.id, which: 'start', origConn: sel };
          return;
        }
        if (Math.hypot(wp.x - end.x, wp.y - end.y) <= endHitR) {
          selectDragRef.current = { mode: 'endpoint', elementId: sel.id, which: 'end', origConn: sel };
          return;
        }
      }

      // 2. Hit test top-most element to select & begin move drag
      const hitR = 8 / cam.zoom;
      let hitEl: BoardElement | null = null;
      for (let i = elementsRef.current.length - 1; i >= 0; i--) {
        if (hitTestElement(elementsRef.current[i], wp, hitR, byId)) {
          hitEl = elementsRef.current[i];
          break;
        }
      }

      if (!hitEl) {
        selectElement(null);
        localPointerIdRef.current = null;
        return;
      }

      selectElement(hitEl.id);
      if (isConnectorElement(hitEl)) {
        setConnRouting(hitEl.routing);
        setStrokeStyle(hitEl.strokeStyle ?? 'solid');
      }
      if (isShapeElement(hitEl)) {
        setShapeFill(hitEl.fill);
        setStrokeStyle(hitEl.strokeStyle ?? 'solid');
      }

      const snaps = new Map<string, BoardElement>([[hitEl.id, hitEl]]);
      if (isShapeElement(hitEl)) {
        for (const el of elementsRef.current) {
          if (isConnectorElement(el) && (el.startBinding?.elementId === hitEl.id || el.endBinding?.elementId === hitEl.id)) {
            snaps.set(el.id, el);
          }
        }
      }
      selectDragRef.current = {
        mode: 'move',
        elementId: hitEl.id,
        startWorld: wp,
        snapshots: snaps,
      };
      return;
    }

    cursorTargetWorldRef.current  = { ...wp };
    cursorDisplayWorldRef.current = { ...wp };
    windowCenterRef.current       = { ...wp };
    needsWindowAlignRef.current   = true;

    if (t === 'eraser') {
      const buf: ErasedEntry[] = [];
      erasingLocalRef.current = buf;
      eraseAtPoint(wp, buf);
      scheduleRender({ active: true });
      return;
    }

    if (isShapeTool(t)) {
      activeLocalDraftRef.current = {
        kind: 'shape',
        shape: t,
        start: wp,
        current: wp,
        color: colorRef.current,
        strokeWidth: Math.max(2, widthRef.current * 0.6),
        strokeStyle: strokeStyleRef.current,
        fill: shapeFillRef.current,
      };
      scheduleRender({ active: true });
      return;
    }

    if (isConnectorTool(t)) {
      const snap = findSnapAnchor(wp, elementsRef.current, 18 / cam.zoom);
      snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
      activeLocalDraftRef.current = {
        kind: 'connector',
        variant: t,
        routing: connRoutingRef.current,
        start: snap ? snap.pt : wp,
        end: snap ? snap.pt : wp,
        startBinding: snap ? snap.binding : null,
        endBinding: null,
        color: colorRef.current,
        strokeWidth: Math.max(2, widthRef.current * 0.6),
        strokeStyle: strokeStyleRef.current,
      };
      scheduleRender({ active: true });
      return;
    }

    const pt: StrokePoint = { x: wp.x, y: wp.y, p: e.pressure || 0.5, dt: 0 };
    activeLocalRef.current = {
      id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'stroke',
      tool: t,
      color: colorRef.current,
      baseWidth: widthRef.current,
      points: [pt],
      bounds: computeBounds([pt]),
      createdAt: Date.now(),
    };
    scheduleRender({ active: true });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current) {
      const dx = (e.clientX - panningRef.current.startX) / cameraRef.current.zoom;
      const dy = (e.clientY - panningRef.current.startY) / cameraRef.current.zoom;
      cameraRef.current.x = panningRef.current.camX - dx;
      cameraRef.current.y = panningRef.current.camY - dy;
      clampCursorIntoViewportOnPan();
      scheduleRender({ static: true, active: true });
      return;
    }

    const wp  = screenToWorld(e.clientX, e.clientY, cameraRef.current);
    const cam = cameraRef.current;

    // Hovering (no local drag)
    if (localPointerIdRef.current === null) {
      const prevMouse = lastMouseClientRef.current;
      const movedEnough = !prevMouse ||
        (e.clientX - prevMouse.x) ** 2 + (e.clientY - prevMouse.y) ** 2 >= 16;
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };

      cursorTargetWorldRef.current  = { ...wp };
      cursorDisplayWorldRef.current = { ...wp };
      windowCenterRef.current       = { ...wp };
      if (movedEnough) needsWindowAlignRef.current = true;

      // Show magnetic ports when hovering with Line or Arrow tool
      if (isConnectorTool(toolRef.current)) {
        const snap = findSnapAnchor(wp, elementsRef.current, 18 / cam.zoom);
        const nextPreview = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
        if (Boolean(snapPreviewRef.current) !== Boolean(nextPreview) ||
            snapPreviewRef.current?.shape.id !== nextPreview?.shape.id ||
            snapPreviewRef.current?.activeAnchor?.anchor !== nextPreview?.activeAnchor?.anchor) {
          snapPreviewRef.current = nextPreview;
          scheduleRender({ active: true });
          return;
        }
      } else if (snapPreviewRef.current) {
        snapPreviewRef.current = null;
        scheduleRender({ active: true });
        return;
      }

      if (phoneConnectedRef.current) scheduleRender({ active: true });
      return;
    }

    if (e.pointerId !== localPointerIdRef.current) return;

    // ── Active Select drag (move / resize / endpoint rebind) ──────────────
    const drag = selectDragRef.current;
    if (drag) {
      if (drag.mode === 'move') {
        const dx = wp.x - drag.startWorld.x;
        const dy = wp.y - drag.startWorld.y;
        const orig = drag.snapshots.get(drag.elementId);
        if (orig) {
          const idx = elementsRef.current.findIndex((el) => el.id === drag.elementId);
          if (idx !== -1) {
            let moved = translateElement(orig, dx, dy);
            if (isConnectorElement(moved)) {
              moved = { ...moved, startBinding: null, endBinding: null };
            }
            elementsRef.current[idx] = moved;
            syncBoundConnectors(elementsRef.current);
            scheduleRender({ static: true, active: true });
          }
        }
      } else if (drag.mode === 'resize') {
        const o = drag.origShape;
        const right = o.x + o.w;
        const bottom = o.y + o.h;
        let nx = o.x;
        let ny = o.y;
        let nw = o.w;
        let nh = o.h;
        const minSize = 18;
        if (drag.corner === 'nw' || drag.corner === 'sw') {
          nx = Math.min(wp.x, right - minSize);
          nw = right - nx;
        } else {
          nw = Math.max(minSize, wp.x - o.x);
        }
        if (drag.corner === 'nw' || drag.corner === 'ne') {
          ny = Math.min(wp.y, bottom - minSize);
          nh = bottom - ny;
        } else {
          nh = Math.max(minSize, wp.y - o.y);
        }
        const idx = elementsRef.current.findIndex((el) => el.id === drag.elementId);
        if (idx !== -1) {
          const nextShape: ShapeElement = {
            ...o,
            x: nx,
            y: ny,
            w: nw,
            h: nh,
            bounds: computeShapeBounds({ x: nx, y: ny, w: nw, h: nh }),
          };
          elementsRef.current[idx] = nextShape;
          syncBoundConnectors(elementsRef.current);
          scheduleRender({ static: true, active: true });
        }
      } else if (drag.mode === 'endpoint') {
        const idx = elementsRef.current.findIndex((el) => el.id === drag.elementId);
        if (idx !== -1) {
          const snap = findSnapAnchor(wp, elementsRef.current, 18 / cam.zoom);
          snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
          const cur = elementsRef.current[idx];
          if (isConnectorElement(cur)) {
            const nextConn: ConnectorElement = drag.which === 'start'
              ? {
                  ...cur,
                  start: snap ? snap.pt : wp,
                  startBinding: snap ? snap.binding : null,
                }
              : {
                  ...cur,
                  end: snap ? snap.pt : snapLineEnd(cur.start, wp, shiftHeldRef.current),
                  endBinding: snap ? snap.binding : null,
                };
            nextConn.bounds = computeConnectorBounds(nextConn);
            elementsRef.current[idx] = nextConn;
            syncBoundConnectors(elementsRef.current);
            scheduleRender({ static: true, active: true });
          }
        }
      }
      return;
    }

    if (erasingLocalRef.current) {
      eraseAtPoint(wp, erasingLocalRef.current);
      cursorTargetWorldRef.current  = { ...wp };
      cursorDisplayWorldRef.current = { ...wp };
      windowCenterRef.current       = { ...wp };
      needsWindowAlignRef.current   = true;
      scheduleRender({ active: true });
      return;
    }

    if (activeLocalDraftRef.current) {
      const d = activeLocalDraftRef.current;
      if (d.kind === 'shape') {
        d.current = wp;
      } else {
        const snap = findSnapAnchor(wp, elementsRef.current, 18 / cam.zoom);
        snapPreviewRef.current = snap ? { shape: snap.shape, activeAnchor: snap.binding } : null;
        d.end = snap ? snap.pt : snapLineEnd(d.start, wp, shiftHeldRef.current);
        d.endBinding = snap ? snap.binding : null;
      }
      scheduleRender({ active: true });
      return;
    }

    if (!activeLocalRef.current) return;
    const pts  = activeLocalRef.current.points;
    const prev = pts[pts.length - 1];
    if ((wp.x - prev.x) ** 2 + (wp.y - prev.y) ** 2 < 2) return;
    const pt: StrokePoint = {
      x: wp.x,
      y: wp.y,
      p: e.pressure || 0.5,
      dt: Date.now() - activeLocalRef.current.createdAt,
    };
    pts.push(pt);
    activeLocalRef.current.bounds = appendPointToBounds(activeLocalRef.current.bounds, pt);
    cursorTargetWorldRef.current  = { ...wp };
    cursorDisplayWorldRef.current = { ...wp };
    windowCenterRef.current       = { ...wp };
    needsWindowAlignRef.current   = true;
    scheduleRender({ active: true });
  };

  const finishLocalStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current) {
      panningRef.current = null;
      clampCursorIntoViewportOnPan();
      scheduleRender({ active: true });
      scheduleSave();
      return;
    }
    if (e.pointerId !== localPointerIdRef.current) return;
    localPointerIdRef.current = null;

    const drag = selectDragRef.current;
    if (drag) {
      selectDragRef.current = null;
      snapPreviewRef.current = null;
      const patches: ElementPatch[] = [];
      if (drag.mode === 'endpoint') {
        const after = elementsRef.current.find((el) => el.id === drag.elementId);
        if (after && after !== drag.origConn) {
          patches.push({ before: drag.origConn, after });
        }
      } else {
        for (const [id, before] of drag.snapshots.entries()) {
          const after = elementsRef.current.find((el) => el.id === id);
          if (after && after !== before) {
            patches.push({ before, after });
          }
        }
      }
      if (patches.length > 0) {
        historyRef.current.push({ type: 'patch', patches });
        syncHistoryFlags();
        scheduleSave();
      }
      scheduleRender({ static: true, active: true });
      return;
    }

    if (erasingLocalRef.current) {
      const removed = erasingLocalRef.current;
      erasingLocalRef.current = null;
      if (removed.length > 0) {
        historyRef.current.push({ type: 'erase', removed });
        syncHistoryFlags();
        scheduleSave();
      }
      return;
    }

    if (activeLocalDraftRef.current) {
      const draft = activeLocalDraftRef.current;
      activeLocalDraftRef.current = null;
      snapPreviewRef.current = null;
      commitDraftElement(draft);
      scheduleRender({ active: true });
      return;
    }

    if (activeLocalRef.current) {
      const finalized = activeLocalRef.current;
      finalized.points = beautifyStrokePoints(finalized.points, {
        smoothness: settingsRef.current.phoneSmoothness,
        baseWidth: finalized.baseWidth / Math.max(0.2, cameraRef.current.zoom),
      });
      finalized.bounds = computeBounds(finalized.points);
      elementsRef.current.push(finalized);
      historyRef.current.push({ type: 'add', element: finalized });
      syncHistoryFlags();
      getCachedStrokePath(finalized);
      pendingAppendElsRef.current.push(finalized);
      activeLocalRef.current = null;
      scheduleRender({ active: true });
      scheduleSave();
    }
  };

  // Compute contextual toolbar visibility & inline label overlay position
  const selectedEl = selectedId
    ? elementsRef.current.find((e) => e.id === selectedId) ?? null
    : null;
  const showConnectorOptions = isConnectorTool(tool) || (selectedEl !== null && isConnectorElement(selectedEl));
  const showShapeOptions = isShapeTool(tool) || (selectedEl !== null && isShapeElement(selectedEl));

  const editingEl = editingElId
    ? elementsRef.current.find((e) => e.id === editingElId && (isShapeElement(e) || isConnectorElement(e))) ?? null
    : null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={staticCanvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={activeCanvasRef}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishLocalStroke}
        onPointerCancel={finishLocalStroke}
        style={{
          position: 'absolute', inset: 0, touchAction: 'none',
          cursor: spaceHeld
            ? 'grab'
            : phoneConnected
              ? 'none'
              : tool === 'select'
                ? 'default'
                : 'crosshair',
        }}
      />
      <canvas
        ref={cursorCanvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 55 }}
      />

      {/* ── Inline Shape / Connector Label Editor ── */}
      {editingEl && (isShapeElement(editingEl) || isConnectorElement(editingEl)) && (() => {
        const cam = cameraRef.current;
        const worldPt = isShapeElement(editingEl)
          ? { x: editingEl.x + editingEl.w / 2, y: editingEl.y + editingEl.h / 2 }
          : getConnectorMidpoint(editingEl, buildElementMap());
        const cx = (worldPt.x - cam.x) * cam.zoom;
        const cy = (worldPt.y - cam.y) * cam.zoom;
        const boxW = isShapeElement(editingEl)
          ? Math.max(120, Math.min(260, editingEl.w * cam.zoom - 12))
          : 150;
        return (
          <input
            autoFocus
            value={labelInput}
            placeholder="Label..."
            onChange={(e) => setLabelInput(e.target.value)}
            onBlur={() => commitElementLabel(editingEl.id, labelInput)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitElementLabel(editingEl.id, labelInput);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditingElId(null);
              }
            }}
            style={{
              position: 'fixed',
              left: cx - boxW / 2,
              top: cy - 16,
              width: boxW,
              height: 32,
              textAlign: 'center',
              background: 'rgba(15, 23, 42, 0.96)',
              color: '#f8fafc',
              border: '1.5px solid #38bdf8',
              borderRadius: 8,
              fontSize: 14,
              outline: 'none',
              zIndex: 40,
            }}
          />
        );
      })()}

      {/* ── Primary Header Toolbar ── */}
      <div style={{
        position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px',
        background: 'rgba(15,23,42,0.92)', border: '1px solid #334155',
        borderRadius: 12, backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        userSelect: 'none',
        maxWidth: 'calc(100vw - 24px)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        <button
          onClick={() => navigateTo('/notes')}
          title="Back to Notebooks & Pages"
          style={{
            height: 28,
            padding: '0 8px',
            borderRadius: 7,
            background: '#1e293b',
            border: '1px solid #334155',
            color: '#cbd5e1',
            fontSize: 11.5,
            fontWeight: 500,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ← Notes
        </button>

        <button
          onClick={openWelcome}
          title="Home / Welcome"
          aria-label="Open welcome page"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '0 6px 0 2px',
            background: 'transparent',
            border: 'none',
            color: '#f8fafc',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <img
            src={assetUrl('logo.png')}
            alt=""
            width={22}
            height={22}
            style={{ borderRadius: 6, objectFit: 'contain', display: 'block' }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4 }}>Scripta</span>
        </button>

        <Divider />

        <button onClick={() => setTool('select')} title="Select / Move / Resize (V)" aria-label="Select" style={iconBtnStyle(tool === 'select')}>
          <SelectSvg />
        </button>
        <button onClick={() => { setTool('pen'); selectElement(null); }} title="Pen (P)" aria-label="Pen" style={iconBtnStyle(tool === 'pen')}>
          <PenSvg />
        </button>
        <button onClick={() => { setTool('highlighter'); selectElement(null); }} title="Highlighter (H)" aria-label="Highlighter" style={iconBtnStyle(tool === 'highlighter')}>
          <HighlighterSvg />
        </button>
        <button onClick={() => { setTool('eraser'); selectElement(null); }} title="Eraser (E)" aria-label="Eraser" style={iconBtnStyle(tool === 'eraser')}>
          <EraserSvg />
        </button>

        <Divider />

        <button onClick={() => { setTool('rect'); selectElement(null); }} title="Rectangle (R · Shift for square)" aria-label="Rectangle" style={iconBtnStyle(tool === 'rect')}>
          <RectSvg />
        </button>
        <button onClick={() => { setTool('ellipse'); selectElement(null); }} title="Circle / Ellipse (O · Shift for circle)" aria-label="Ellipse" style={iconBtnStyle(tool === 'ellipse')}>
          <EllipseSvg />
        </button>
        <button onClick={() => { setTool('diamond'); selectElement(null); }} title="Diamond / Decision (D)" aria-label="Diamond" style={iconBtnStyle(tool === 'diamond')}>
          <DiamondSvg />
        </button>
        <button onClick={() => { setTool('line'); selectElement(null); }} title="Line (L · Shift snaps angle)" aria-label="Line" style={iconBtnStyle(tool === 'line')}>
          <LineSvg />
        </button>
        <button onClick={() => { setTool('arrow'); selectElement(null); }} title="Arrow Connector (A · snaps to shape ports)" aria-label="Arrow" style={iconBtnStyle(tool === 'arrow')}>
          <ArrowSvg />
        </button>

        <Divider />

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 2px' }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} title={`Color ${c}`} aria-label={`Color ${c}`} style={{
              width: 18, height: 18, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
              border: color === c ? '2px solid #fff' : '2px solid transparent',
              boxSizing: 'border-box',
            }} />
          ))}
        </div>

        <Divider />

        {WIDTHS.map((w, idx) => (
          <button
            key={w}
            onClick={() => setWidth(w)}
            title={`Stroke width ${w}px`}
            aria-label={`Stroke width ${w}px`}
            style={iconBtnStyle(width === w)}
          >
            <span style={{
              width: 4 + idx * 3,
              height: 4 + idx * 3,
              borderRadius: '50%',
              background: '#f8fafc',
              display: 'block',
            }} />
          </button>
        ))}

        <Divider />

        <button
          onClick={cycleBg}
          title={`Background: ${bgType} (click to switch)`}
          aria-label={`Background: ${bgType}`}
          style={iconBtnStyle(false)}
        >
          <BgSvg bg={bgType} />
        </button>

        <Divider />

        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" style={iconBtnStyle(false, !canUndo)}>
          <UndoSvg />
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" style={iconBtnStyle(false, !canRedo)}>
          <RedoSvg />
        </button>
        <button onClick={clearBoard} title="Clear Board" aria-label="Clear Board" style={iconBtnStyle(false)}>
          <ClearSvg />
        </button>
        <button onClick={exportPng} title="Export PNG" aria-label="Export PNG" style={iconBtnStyle(false)}>
          <DownloadSvg />
        </button>

        <Divider />

        <button
          onClick={() => {
            if (phoneConnected) setShowDevicesMenu((v) => !v);
            else void startPairing();
          }}
          title={phoneConnected ? 'Connected devices & pairing' : 'Connect phone as wireless tablet'}
          style={{
            height: 32,
            width: 112,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            color: '#f8fafc',
            background: phoneConnected
              ? (modHeld ? '#0369a1' : '#065f46')
              : '#0284c7',
            border: `1px solid ${phoneConnected ? (modHeld ? '#38bdf8' : '#10b981') : '#38bdf8'}`,
          }}
        >
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            background: phoneConnected ? (modHeld ? '#38bdf8' : '#34d399') : '#e0f2fe',
          }} />
          <span>{phoneConnected ? (modHeld ? 'Moving' : 'Connected') : 'Connect'}</span>
        </button>
      </div>

      {/* ── Connected Devices Popover ── */}
      {showDevicesMenu && (
        <div
          style={{
            position: 'fixed',
            top: 62,
            right: 20,
            width: 240,
            background: 'rgba(15,23,42,0.96)',
            border: '1px solid #334155',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            zIndex: 50,
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Connected Devices</span>
            <button
              onClick={() => setShowDevicesMenu(false)}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}
            >
              ×
            </button>
          </div>
          {connectedDevices.length === 0 ? (
            <span style={{ fontSize: 12, color: '#64748b' }}>No phones connected</span>
          ) : (
            connectedDevices.map((dev) => (
              <div
                key={dev.deviceId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: '#1e293b',
                  fontSize: 12,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399' }} />
                  {dev.name}
                </span>
                <button
                  onClick={() => kickDevice(dev.deviceId)}
                  style={{
                    background: 'rgba(251,113,133,0.14)',
                    color: '#fda4af',
                    border: '1px solid rgba(251,113,133,0.35)',
                    borderRadius: 6,
                    padding: '2px 7px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
            ))
          )}
          <button
            onClick={() => { setShowDevicesMenu(false); void startPairing(); }}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Show QR / Pair Code
          </button>
        </div>
      )}

      {/* ── Contextual Properties Sub-bar (Shapes / Connectors / Selection) ── */}
      {(showConnectorOptions || showShapeOptions || selectedEl) && (
        <div style={{
          position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          background: 'rgba(15,23,42,0.9)', border: '1px solid #334155',
          borderRadius: 10, backdropFilter: 'blur(8px)', fontSize: 11, color: '#cbd5e1',
          userSelect: 'none', whiteSpace: 'nowrap',
        }}>
          {(showShapeOptions || showConnectorOptions) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setElementStrokeStyle(st)}
                    title={`Border/Line: ${st}`}
                    style={pillBtnStyle(strokeStyle === st)}
                  >
                    {st === 'solid' ? 'Solid' : st === 'dashed' ? 'Dashed' : 'Dotted'}
                  </button>
                ))}
              </div>
              <Divider />
            </>
          )}

          {showShapeOptions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#94a3b8', marginRight: 2 }}>Fill</span>
              {SHAPE_FILLS.map((f) => {
                const active = shapeFill === f.value;
                return (
                  <button
                    key={f.label}
                    onClick={() => setElementShapeFill(f.value)}
                    title={`Background: ${f.label}`}
                    aria-label={`Background: ${f.label}`}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      padding: 0,
                      cursor: 'pointer',
                      background: f.swatch === 'transparent' ? '#06090f' : f.swatch,
                      border: active ? '2px solid #fff' : '1px solid #475569',
                      boxSizing: 'border-box',
                    }}
                  />
                );
              })}
            </div>
          )}

          {showConnectorOptions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {selectedEl && isConnectorElement(selectedEl) && (
                <>
                  <button onClick={toggleSelectedConnectorVariant} style={pillBtnStyle(selectedEl.variant === 'arrow')}>
                    {selectedEl.variant === 'arrow' ? 'Arrow' : 'Line'}
                  </button>
                  <button onClick={flipSelectedConnector} title="Flip arrow direction" style={pillBtnStyle(false)}>
                    Flip ⇄
                  </button>
                </>
              )}
              <button onClick={toggleSelectedConnectorRouting} style={pillBtnStyle(connRouting === 'orthogonal')}>
                {connRouting === 'orthogonal' ? 'Elbow' : 'Straight'}
              </button>
            </div>
          )}

          {selectedEl && (isShapeElement(selectedEl) || isConnectorElement(selectedEl)) && (
            <>
              <Divider />
              <button
                onClick={() => {
                  setEditingElId(selectedEl.id);
                  setLabelInput(selectedEl.label ?? '');
                }}
                style={pillBtnStyle(false)}
              >
                Text (Enter)
              </button>
            </>
          )}

          {selectedEl && (
            <button onClick={deleteSelected} style={{ ...pillBtnStyle(false), color: '#fb7185', borderColor: 'rgba(251,113,133,0.4)' }}>
              Delete
            </button>
          )}
        </div>
      )}

      {/* ── Zoom / Fit / Reset / Settings / Help ── */}
      <div style={{
        position: 'fixed', bottom: 14, right: 14, display: 'flex', gap: 6,
        alignItems: 'center',
      }}>
        <button onClick={zoomToFit} title="Zoom to fit all elements" style={{
          background: 'rgba(15,23,42,0.85)', color: '#94a3b8',
          border: '1px solid #334155', borderRadius: 8,
          padding: '6px 10px', fontSize: 12, cursor: 'pointer',
        }}>
          Fit
        </button>
        <button onClick={resetView} title="Reset zoom and re-centre cursor" style={{
          background: 'rgba(15,23,42,0.85)', color: '#94a3b8',
          border: '1px solid #334155', borderRadius: 8,
          padding: '6px 10px', fontSize: 12, cursor: 'pointer',
        }}>
          {zoomPct}% · Reset View
        </button>
        <button
          onClick={openSettings}
          title="Settings (Ctrl+,)"
          aria-label="Settings"
          style={floatingIconBtnStyle()}
        >
          <SettingsSvg />
        </button>
        <button
          onClick={openHelp}
          title="Help & Shortcuts (?)"
          aria-label="Help"
          style={floatingIconBtnStyle()}
        >
          <HelpSvg />
        </button>
      </div>

      {/* ── QR Modal ── */}
      {showQrModal && (
        <div onClick={() => setShowQrModal(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 60,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 16,
            padding: 24, width: 340, textAlign: 'center',
            display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center',
          }}>
            <img
              src={assetUrl('logo.png')}
              alt="Scripta"
              width={44}
              height={44}
              style={{ borderRadius: 10, objectFit: 'contain' }}
            />
            <h3 style={{ margin: 0, fontSize: 18 }}>Connect Your Phone</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
              Scan the QR code on the same Wi-Fi. No app install needed.
            </p>
            {pairError && <p style={{ color: '#fb7185', fontSize: 13 }}>{pairError}</p>}
            {pairing && (<>
              <img src={pairing.qrDataUrl} alt="Scripta QR" style={{ borderRadius: 12, width: 220, height: 220 }} />
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                Code: <strong style={{ color: '#f8fafc', letterSpacing: 2, fontSize: 16 }}>{pairing.pairCode}</strong>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>{pairing.mobileUrl}</div>
            </>)}
            <button onClick={() => setShowQrModal(false)} style={pillBtnStyle(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ── Pending Device Approval Prompt ── */}
      {pendingDevice && (
        <div style={{
          position: 'fixed', top: 68, right: 20, zIndex: 65,
          background: 'rgba(15,23,42,0.98)', border: '1px solid #38bdf8',
          borderRadius: 12, padding: '12px 14px', width: 270,
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)', color: '#f8fafc',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>{pendingDevice.deviceName}</strong> wants to connect to this board.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => void respondApproval(false)}
              style={{
                background: '#1e293b', color: '#fda4af', border: '1px solid rgba(251,113,133,0.4)',
                borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
              }}
            >
              Deny
            </button>
            <button
              onClick={() => void respondApproval(true)}
              style={{
                background: '#0284c7', color: '#fff', border: '1px solid #38bdf8',
                borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Allow
            </button>
          </div>
        </div>
      )}

      {/* ── Notes Browser Route (/notes) ── */}
      {route === '/notes' && !showLanding && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, overflowY: 'auto' }}>
          <NotesView
            onOpenPage={(pageId) => navigateTo('/draw', pageId)}
            onOpenLanding={() => navigateTo('/')}
          />
        </div>
      )}

      {/* ── Landing / Tutorial / Settings / Help ── */}
      {showLanding && (
        <LandingPage
          onStart={() => dismissLanding('start')}
          onTour={() => dismissLanding('tour')}
          onConnect={() => dismissLanding('connect')}
          onSkip={() => dismissLanding('skip')}
        />
      )}

      {showTutorial && <TutorialModal onClose={handleTutorialClose} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onReset={resetSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showHelp && (
        <HelpModal
          onClose={() => setShowHelp(false)}
          onStartTour={openTutorial}
          onConnect={openConnect}
          onOpenWelcome={openWelcome}
          onOpenSettings={openSettings}
        />
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: '#334155', flexShrink: 0 }} />;
}

function iconBtnStyle(active: boolean, disabled = false): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? '#1e293b' : 'transparent',
    color: '#f8fafc',
    border: `1px solid ${active ? '#38bdf8' : 'transparent'}`,
    borderRadius: 8,
    padding: 0,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    flexShrink: 0,
  };
}

function pillBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#0369a1' : '#1e293b',
    color: '#f8fafc',
    border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 11,
    cursor: 'pointer',
  };
}

function floatingIconBtnStyle(): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15,23,42,0.85)',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: 0,
    cursor: 'pointer',
  };
}
