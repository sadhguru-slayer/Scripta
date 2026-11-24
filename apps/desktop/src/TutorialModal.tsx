import { useEffect, useState } from 'react';

interface TutorialStep {
  title: string;
  body: string;
  tips: string[];
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to Scripta',
    body: 'A fast, infinite digital whiteboard where your smartphone acts as a wireless drawing tablet for your laptop.',
    tips: [
      'Draw DSA diagrams (trees, graphs, linked lists) or take handwritten notes.',
      'Your board auto-saves locally in your browser.',
    ],
  },
  {
    title: '1. Connect Your Phone',
    body: 'Click the blue Connect button in the top bar and scan the QR code with your phone camera (no app install required).',
    tips: [
      'Both devices only need internet (or same Wi-Fi locally).',
      'Toggle Horizontal Mode from the floating button on your phone for landscape writing.',
    ],
  },
  {
    title: '2. Write & Move Like a Tablet',
    body: 'Draw anywhere on your phone — strokes appear at the desktop cursor. Multi-stroke letters stay aligned automatically.',
    tips: [
      'Hold Ctrl / Cmd (or tap Move on phone) to slide the cursor to a new spot without drawing.',
      'Adjust Phone input smoothing in Settings (gear icon, bottom-right) if handwriting feels jittery.',
    ],
  },
  {
    title: '3. Shapes, Arrows & Labels',
    body: 'Use Rectangles (R), Circles (O), Diamonds (D), Lines (L), and Arrows (A) to build clean diagrams.',
    tips: [
      'Arrows snap magnetically to shape ports and stay attached when you move or resize shapes.',
      'Double-click any shape or arrow (or press Enter) to add text labels; use the sub-bar for Solid/Dashed/Dotted borders and fills.',
    ],
  },
  {
    title: '4. Essential Shortcuts',
    body: 'Navigate and edit quickly with keyboard shortcuts:',
    tips: [
      'Ctrl+Z / Ctrl+Shift+Z: Undo & Redo',
      'Space + Drag: Pan canvas  |  Ctrl + Wheel: Zoom',
      'V: Select  |  P: Pen  |  E: Eraser  |  Delete: Remove selected',
      '? or F1: Help & shortcuts  |  Ctrl+,: Settings  |  Esc: Close dialogs',
    ],
  },
];

interface TutorialModalProps {
  onClose: () => void;
}

export function TutorialModal({ onClose }: TutorialModalProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isLast) onClose();
        else setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLast, onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scripta-tutorial-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: 24,
          width: 420,
          maxWidth: '100%',
          color: '#f8fafc',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600, letterSpacing: 0.6 }}>
            STEP {stepIdx + 1} OF {STEPS.length}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            Skip tour
          </button>
        </div>

        <h3 id="scripta-tutorial-title" style={{ margin: 0, fontSize: 18 }}>{step.title}</h3>
        <p style={{ margin: 0, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.5 }}>{step.body}</p>

        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {step.tips.map((t) => (
            <li key={t} style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>
              {t}
            </li>
          ))}
        </ul>

        <p style={{ margin: 0, fontSize: 11, color: '#64748b', textAlign: 'center' }}>
          You can replay this tour anytime from the Help button.
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 4 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === stepIdx ? 18 : 6,
                height: 6,
                borderRadius: 999,
                background: i === stepIdx ? '#38bdf8' : '#334155',
                transition: 'width 0.15s ease',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            disabled={stepIdx === 0}
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12.5,
              cursor: stepIdx === 0 ? 'default' : 'pointer',
              opacity: stepIdx === 0 ? 0.4 : 1,
            }}
          >
            Back
          </button>

          <button
            onClick={() => (isLast ? onClose() : setStepIdx((i) => i + 1))}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: '1px solid #38bdf8',
              borderRadius: 8,
              padding: '7px 18px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
