import { HelpSvg, SettingsSvg } from './icons';

interface HelpModalProps {
  onClose: () => void;
  onStartTour: () => void;
  onConnect: () => void;
  onOpenWelcome: () => void;
  onOpenSettings: () => void;
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'V', action: 'Select / move / resize' },
  { keys: 'P', action: 'Pen' },
  { keys: 'H', action: 'Highlighter' },
  { keys: 'E', action: 'Eraser' },
  { keys: 'R / O / D', action: 'Rectangle / ellipse / diamond' },
  { keys: 'L / A', action: 'Line / arrow connector' },
  { keys: 'Ctrl + Z', action: 'Undo' },
  { keys: 'Ctrl + Shift + Z', action: 'Redo' },
  { keys: 'Space + drag', action: 'Pan canvas' },
  { keys: 'Ctrl + wheel', action: 'Zoom' },
  { keys: 'Enter', action: 'Edit selected label' },
  { keys: 'Delete', action: 'Remove selected element' },
  { keys: '? / F1', action: 'Open this help panel' },
  { keys: 'Ctrl + ,', action: 'Open settings' },
  { keys: 'Esc', action: 'Close dialogs' },
];

export function HelpModal({
  onClose,
  onStartTour,
  onConnect,
  onOpenWelcome,
  onOpenSettings,
}: HelpModalProps) {
  return (
    <div
      onClick={onClose}
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scripta-help-title"
    >
      <div onClick={(e) => e.stopPropagation()} style={card}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={iconBadge}><HelpSvg /></span>
            <h3 id="scripta-help-title" style={{ margin: 0, fontSize: 17 }}>Help & Shortcuts</h3>
          </div>
          <button onClick={onClose} aria-label="Close help" style={closeBtn}>×</button>
        </div>

        <div style={actionGrid}>
          <button onClick={onStartTour} style={actionBtn}>Take the tour</button>
          <button onClick={onConnect} style={actionBtn}>Connect phone</button>
          <button onClick={onOpenWelcome} style={actionBtn}>Welcome page</button>
          <button onClick={onOpenSettings} style={actionBtn}>
            <SettingsSvg />
            <span>Settings</span>
          </button>
        </div>

        <section style={section}>
          <div style={sectionTitle}>Keyboard shortcuts</div>
          <div style={shortcutGrid}>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} style={shortcutRow}>
                <kbd style={kbd}>{s.keys}</kbd>
                <span style={shortcutAction}>{s.action}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={section}>
          <div style={sectionTitle}>Phone tips</div>
          <ul style={list}>
            <li>
              Hold <strong>Ctrl / Cmd</strong> on the desktop (or tap <strong>Move</strong> on your
              phone) to slide the cursor without drawing.
            </li>
            <li>
              If handwriting feels jittery, open <strong>Settings</strong> and raise{' '}
              <strong>Phone input smoothing</strong>.
            </li>
            <li>Use <strong>Horizontal Mode</strong> on the phone for landscape writing.</li>
            <li>Arrows snap to shape ports and stay attached when you move or resize shapes.</li>
          </ul>
        </section>

        <div style={footer}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Scripta v0.1.0 · Your phone is the pen.
          </span>
          <button onClick={onClose} style={primaryBtn}>Got it</button>
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
  width: 520,
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

const actionGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 8,
};

const actionBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '9px 10px',
  fontSize: 12.5,
  cursor: 'pointer',
};

const section: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: 12,
  borderRadius: 12,
  background: 'rgba(2,6,23,0.45)',
  border: '1px solid #1e293b',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: '#7dd3fc',
  textTransform: 'uppercase',
};

const shortcutGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 6,
};

const shortcutRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const kbd: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 74,
  textAlign: 'center',
  padding: '2px 6px',
  borderRadius: 5,
  background: '#0b1220',
  border: '1px solid #334155',
  color: '#e2e8f0',
  fontSize: 10.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const shortcutAction: React.CSSProperties = {
  fontSize: 11.5,
  color: '#94a3b8',
  lineHeight: 1.35,
};

const list: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  lineHeight: 1.5,
  color: '#94a3b8',
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
