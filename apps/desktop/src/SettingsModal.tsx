import {
  DEFAULT_CURSOR_GLIDE_MS,
  DEFAULT_PHONE_SMOOTHNESS,
  DEFAULT_WRITING_WINDOW_RATIO,
} from '@scripta/shared';
import type { AppSettings } from './settings';
import { SettingsSvg } from './icons';

interface SettingsModalProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onReset: () => void;
  onClose: () => void;
}

const ASSIST_PRESETS = [
  { label: 'Off', value: 0 },
  { label: 'Light', value: 20 },
  { label: 'Balanced', value: 35 },
  { label: 'Strong', value: 65 },
  { label: 'Max', value: 100 },
];

const GLIDE_PRESETS = [
  { label: 'Off', value: 0 },
  { label: 'Snappy', value: 20 },
  { label: 'Balanced', value: 38 },
  { label: 'Smooth', value: 70 },
];

const RATIO_PRESETS = [
  { label: 'Small', value: 0.25 },
  { label: 'Compact', value: 0.35 },
  { label: 'Medium', value: 0.45 },
  { label: 'Large', value: 0.65 },
  { label: 'Wide', value: 0.85 },
];

export function SettingsModal({ settings, onChange, onReset, onClose }: SettingsModalProps) {
  const setSmoothness = (value: number) => onChange({ ...settings, phoneSmoothness: value });
  const setGlide = (value: number) => onChange({ ...settings, cursorGlideMs: value });
  const setRatio = (value: number) => onChange({ ...settings, writingWindowRatio: value });

  return (
    <div
      onClick={onClose}
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scripta-settings-title"
    >
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={iconBadge}><SettingsSvg /></span>
            <h3 id="scripta-settings-title" style={{ margin: 0, fontSize: 17 }}>Settings</h3>
          </div>
          <button onClick={onClose} aria-label="Close settings" style={closeBtn}>×</button>
        </div>

        <section style={section}>
          <div style={rowBetween}>
            <div>
              <div style={labelStyle}>Handwriting assistance</div>
              <div style={hintStyle}>
                Gently stabilizes touch jitter and neatens completed strokes while keeping sharp letter corners crisp.
              </div>
            </div>
            <span style={valueBadge}>{settings.phoneSmoothness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.phoneSmoothness}
            onChange={(e) => setSmoothness(Number(e.target.value))}
            style={slider}
            aria-label="Handwriting assistance"
          />
          <div style={presetRow}>
            {ASSIST_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setSmoothness(p.value)}
                style={pill(settings.phoneSmoothness === p.value)}
              >
                {p.label}
              </button>
            ))}
            <span style={defaultHint}>Default {DEFAULT_PHONE_SMOOTHNESS}%</span>
          </div>
        </section>

        <section style={section}>
          <div style={rowBetween}>
            <div>
              <div style={labelStyle}>Cursor glide</div>
              <div style={hintStyle}>
                How quickly the on-screen cursor follows your phone. 0 ms = instant.
              </div>
            </div>
            <span style={valueBadge}>{settings.cursorGlideMs} ms</span>
          </div>
          <input
            type="range"
            min={0}
            max={120}
            step={2}
            value={settings.cursorGlideMs}
            onChange={(e) => setGlide(Number(e.target.value))}
            style={slider}
            aria-label="Cursor glide"
          />
          <div style={presetRow}>
            {GLIDE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setGlide(p.value)}
                style={pill(settings.cursorGlideMs === p.value)}
              >
                {p.label}
              </button>
            ))}
            <span style={defaultHint}>Default {DEFAULT_CURSOR_GLIDE_MS} ms</span>
          </div>
        </section>

        <section style={section}>
          <div style={rowBetween}>
            <div>
              <div style={labelStyle}>Writing window ratio</div>
              <div style={hintStyle}>
                How much of the desktop screen your phone maps to. Smaller ratios let you write small text comfortably.
              </div>
            </div>
            <span style={valueBadge}>{Math.round(settings.writingWindowRatio * 100)}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={90}
            step={5}
            value={Math.round(settings.writingWindowRatio * 100)}
            onChange={(e) => setRatio(Number(e.target.value) / 100)}
            style={slider}
            aria-label="Writing window ratio"
          />
          <div style={presetRow}>
            {RATIO_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setRatio(p.value)}
                style={pill(Math.abs(settings.writingWindowRatio - p.value) < 0.01)}
              >
                {p.label}
              </button>
            ))}
            <span style={defaultHint}>Default {Math.round(DEFAULT_WRITING_WINDOW_RATIO * 100)}%</span>
          </div>
        </section>

        <section style={{ ...section, gap: 8 }}>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={settings.showTutorialOnStart}
              onChange={(e) => onChange({ ...settings, showTutorialOnStart: e.target.checked })}
              style={{ accentColor: '#38bdf8', marginTop: 2 }}
            />
            <span>
              <span style={labelStyle}>Show tutorial on startup</span>
              <span style={hintStyle}>You can always replay it from the Help button.</span>
            </span>
          </label>
        </section>

        <div style={footer}>
          <button onClick={onReset} style={secondaryBtn}>Reset to defaults</button>
          <button onClick={onClose} style={primaryBtn}>Done</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 70,
  background: 'rgba(2,6,23,0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const card: React.CSSProperties = {
  width: 460,
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 16,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  boxShadow: '0 20px 48px rgba(0,0,0,0.55)',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const iconBadge: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(56,189,248,0.12)',
  border: '1px solid rgba(56,189,248,0.3)',
  color: '#7dd3fc',
};

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#94a3b8',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '2px 6px',
};

const section: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  background: 'rgba(2,6,23,0.45)',
  border: '1px solid #1e293b',
};

const rowBetween: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#f8fafc',
};

const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 3,
  fontSize: 11.5,
  lineHeight: 1.45,
  color: '#94a3b8',
};

const valueBadge: React.CSSProperties = {
  flexShrink: 0,
  padding: '3px 8px',
  borderRadius: 6,
  background: 'rgba(56,189,248,0.12)',
  border: '1px solid rgba(56,189,248,0.3)',
  color: '#7dd3fc',
  fontSize: 11.5,
  fontWeight: 600,
};

const slider: React.CSSProperties = {
  width: '100%',
  accentColor: '#38bdf8',
  cursor: 'pointer',
};

const presetRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 5,
};

const defaultHint: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10.5,
  color: '#64748b',
};

function pill(active: boolean): React.CSSProperties {
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

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  cursor: 'pointer',
};

const footer: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
};

const primaryBtn: React.CSSProperties = {
  background: '#0284c7',
  color: '#fff',
  border: '1px solid #38bdf8',
  borderRadius: 8,
  padding: '8px 18px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12.5,
  cursor: 'pointer',
};
