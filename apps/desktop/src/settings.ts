import {
  DEFAULT_CURSOR_GLIDE_MS,
  DEFAULT_PHONE_SMOOTHNESS,
  DEFAULT_WRITING_WINDOW_RATIO,
} from '@scripta/shared';

export interface AppSettings {
  /** Phone input smoothing in [0, 100]. 0 = raw, 100 = maximum. */
  phoneSmoothness: number;
  /** Cursor glide time constant in milliseconds. 0 = instant. */
  cursorGlideMs: number;
  /** Writing window fill ratio in [0.2, 0.9]. Smaller = smaller text on desktop. */
  writingWindowRatio: number;
  /** Whether to auto-open the tutorial on first board entry. */
  showTutorialOnStart: boolean;
}

export const SETTINGS_KEY = 'scripta:settings:v1';

export const DEFAULT_SETTINGS: AppSettings = {
  phoneSmoothness: DEFAULT_PHONE_SMOOTHNESS,
  cursorGlideMs: DEFAULT_CURSOR_GLIDE_MS,
  writingWindowRatio: DEFAULT_WRITING_WINDOW_RATIO,
  showTutorialOnStart: true,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      phoneSmoothness: clamp(
        Number(parsed.phoneSmoothness ?? DEFAULT_SETTINGS.phoneSmoothness),
        0,
        100,
      ),
      cursorGlideMs: clamp(
        Number(parsed.cursorGlideMs ?? DEFAULT_SETTINGS.cursorGlideMs),
        0,
        120,
      ),
      writingWindowRatio: clamp(
        Number(parsed.writingWindowRatio ?? DEFAULT_SETTINGS.writingWindowRatio),
        0.2,
        0.9,
      ),
      showTutorialOnStart: parsed.showTutorialOnStart !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota / privacy-mode storage errors
  }
}
