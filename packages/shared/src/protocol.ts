import type { StrokePoint, ToolType } from './model';

export type ClientRole = 'desktop' | 'mobile';

export interface WsEnvelope<T extends string = string, P = unknown> {
  v: 1;
  type: T;
  seq: number;
  ts: number;
  payload: P;
}

export type ServerMessage =
  | WsEnvelope<'session.ready', { role: ClientRole }>
  | WsEnvelope<'peer.connected', { role: ClientRole; aspectRatio?: number }>
  | WsEnvelope<'peer.disconnected', { role: ClientRole }>
  | WsEnvelope<'error', { code: string; message: string }>;

export type MobileToDesktopMessage =
  | WsEnvelope<
      'stroke.start',
      {
        strokeId: string;
        tool: ToolType;
        color: string;
        width: number;
        /** First point in normalised phone coordinates [0..1]. */
        point: StrokePoint;
      }
    >
  | WsEnvelope<
      'stroke.points',
      {
        strokeId: string;
        /** Points in normalised phone coordinates. Desktop computes world-unit deltas. */
        points: StrokePoint[];
      }
    >
  | WsEnvelope<'stroke.end', { strokeId: string }>
  | WsEnvelope<'stroke.cancel', { strokeId: string }>
  | WsEnvelope<'pad.resize', { aspectRatio: number }>
  | WsEnvelope<
      'command.trigger',
      { action: 'undo' | 'clear' | 'enter_move' | 'exit_move' | 'recenter_cursor' }
    >;

export type DesktopToMobileMessage =
  | WsEnvelope<
      'desktop.state',
      {
        tool: ToolType;
        color: string;
        width: number;
      }
    >
  /** Tells mobile the current cursor interaction mode so FAB icon can update. */
  | WsEnvelope<'desktop.cursor', { mode: 'draw' | 'move' }>;

export type ScriptaWsMessage =
  | ServerMessage
  | MobileToDesktopMessage
  | DesktopToMobileMessage;
