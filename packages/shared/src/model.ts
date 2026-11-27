export type ToolType =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow';

export type ShapeKind = 'rect' | 'ellipse' | 'diamond';

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left' | 'center';

export type ConnectorRouting = 'straight' | 'orthogonal';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export type BackgroundType = 'dots' | 'grid' | 'lined' | 'plain';

export type PaperTheme = 'dark' | 'light';

export interface StrokePoint {
  x: number;
  y: number;
  /** Normalized pressure in [0, 1]. */
  p: number;
  /** Milliseconds elapsed since stroke start. */
  dt: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Stroke {
  id: string;
  kind?: 'stroke';
  tool: 'pen' | 'highlighter' | ToolType;
  color: string;
  baseWidth: number;
  points: StrokePoint[];
  bounds: Bounds;
  createdAt: number;
  deviceId?: string;
}

export interface ShapeElement {
  id: string;
  kind: 'shape';
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  strokeStyle?: StrokeStyle;
  fill?: string;
  label?: string;
  bounds: Bounds;
  createdAt: number;
  deviceId?: string;
}

export interface ElementBinding {
  elementId: string;
  anchor: AnchorSide;
}

export interface ConnectorElement {
  id: string;
  kind: 'connector';
  variant: 'line' | 'arrow';
  routing: ConnectorRouting;
  start: Point2D;
  end: Point2D;
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  color: string;
  strokeWidth: number;
  strokeStyle?: StrokeStyle;
  label?: string;
  bounds: Bounds;
  createdAt: number;
  deviceId?: string;
}

export type BoardElement = Stroke | ShapeElement | ConnectorElement;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CursorSlideOptions {
  /** Exponential smoothing time constant in milliseconds (default 38ms). */
  tauMs?: number;
  /** Snap-to-target distance threshold in world units (default 0.25). */
  epsilon?: number;
}

export interface CursorSlideResult {
  x: number;
  y: number;
  settled: boolean;
}

/** Default handwriting assistance / smoothing (0 = raw, 100 = maximum). */
export const DEFAULT_PHONE_SMOOTHNESS = 35;

/** Default cursor glide time constant in milliseconds. */
export const DEFAULT_CURSOR_GLIDE_MS = 38;

/** Default writing window fill ratio (fraction of desktop viewport). */
export const DEFAULT_WRITING_WINDOW_RATIO = 0.45;
