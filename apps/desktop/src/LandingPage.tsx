import { useEffect, useRef, useState } from 'react';
import { ArrowSvg, BgSvg, PenSvg, UndoSvg } from './icons';
import { assetUrl } from './assets';

interface LandingPageProps {
  onStart: () => void;
  onTour: () => void;
  onConnect: () => void;
  onSkip: () => void;
}

const STEPS = [
  { n: '1', title: 'Open on your laptop', body: 'Scripta runs in the browser — no install.' },
  { n: '2', title: 'Scan the QR code', body: 'Connect your phone over Wi-Fi in seconds.' },
  { n: '3', title: 'Draw anywhere', body: 'Your phone is the tablet; the laptop is the canvas.' },
];

const FEATURES = [
  {
    icon: <PenSvg />,
    title: 'Wireless tablet',
    body: 'Your phone becomes a pressure-aware pen for your laptop.',
  },
  {
    icon: <BgSvg bg="dots" />,
    title: 'Infinite canvas',
    body: 'Pan, zoom, and keep every idea on one endless board.',
  },
  {
    icon: <ArrowSvg />,
    title: 'Shapes & connectors',
    body: 'Snap arrows to shapes and build clean DSA diagrams.',
  },
  {
    icon: <UndoSvg />,
    title: 'Auto-save',
    body: 'Your board is saved locally and ready when you return.',
  },
];

export function LandingPage({ onStart, onTour, onConnect, onSkip }: LandingPageProps) {
  return (
    <div style={overlay}>
      <div style={dotLayer} />
      <div style={glowTop} />
      <div style={glowBottom} />

      <div style={content}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onSkip} style={ghostBtn}>Skip to board →</button>
        </div>

        <header style={hero}>
          <div style={logoWrap}>
            <img
              src={assetUrl('logo_with_text.png')}
              alt="Scripta"
              style={logoImg}
            />
          </div>
          <span style={badge}>No app install · Works with any phone</span>
          <h1 style={title}>
            Your phone is the pen.<br />Your laptop is the canvas.
          </h1>
          <p style={subtitle}>
            Scripta turns your smartphone into a wireless drawing tablet for an infinite
            whiteboard — perfect for DSA diagrams, handwritten notes, and quick sketches.
          </p>
          <div style={ctaRow}>
            <button onClick={onStart} style={primaryBtn}>Start drawing</button>
            <button onClick={onTour} style={secondaryBtn}>Take the tour</button>
            <button onClick={onConnect} style={ghostBtn}>Connect phone</button>
          </div>
        </header>

        <MiniSketchPad />

        <section style={grid}>
          {STEPS.map((s) => (
            <div key={s.n} style={card}>
              <span style={stepBadge}>{s.n}</span>
              <strong style={cardTitle}>{s.title}</strong>
              <span style={cardBody}>{s.body}</span>
            </div>
          ))}
        </section>

        <section style={grid}>
          {FEATURES.map((f) => (
            <div key={f.title} style={card}>
              <span style={iconWrap}>{f.icon}</span>
              <strong style={cardTitle}>{f.title}</strong>
              <span style={cardBody}>{f.body}</span>
            </div>
          ))}
        </section>

        <footer style={footer}>
          Auto-saves locally · Works offline after load · Replay this page anytime from the logo or Help
        </footer>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 80,
  overflowY: 'auto',
  background: '#06090f',
  color: '#f8fafc',
};

const dotLayer: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
  backgroundSize: '24px 24px',
  opacity: 0.55,
};

const glowTop: React.CSSProperties = {
  position: 'absolute',
  top: -180,
  left: '50%',
  width: 640,
  height: 640,
  transform: 'translateX(-50%)',
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(56,189,248,0.18), transparent 65%)',
  pointerEvents: 'none',
};

const glowBottom: React.CSSProperties = {
  position: 'absolute',
  bottom: -220,
  right: -120,
  width: 520,
  height: 520,
  borderRadius: '50%',
  background: 'radial-gradient(circle, rgba(52,211,153,0.12), transparent 65%)',
  pointerEvents: 'none',
};

const content: React.CSSProperties = {
  position: 'relative',
  maxWidth: 860,
  margin: '0 auto',
  padding: '28px 24px 48px',
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
};

const logoWrap: React.CSSProperties = {
  width: 'min(300px, 76vw)',
  aspectRatio: '3.2 / 1',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const logoImg: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  display: 'block',
  filter: 'invert(1)',
  mixBlendMode: 'screen',
};

const hero: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 16,
};

const badge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid rgba(56,189,248,0.35)',
  background: 'rgba(56,189,248,0.08)',
  color: '#7dd3fc',
  fontSize: 11.5,
  letterSpacing: 0.3,
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(28px, 5vw, 44px)',
  lineHeight: 1.1,
  letterSpacing: -0.8,
};

const subtitle: React.CSSProperties = {
  margin: 0,
  maxWidth: 560,
  fontSize: 15,
  lineHeight: 1.6,
  color: '#94a3b8',
};

const ctaRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 10,
  marginTop: 4,
};

const primaryBtn: React.CSSProperties = {
  background: '#0284c7',
  color: '#fff',
  border: '1px solid #38bdf8',
  borderRadius: 10,
  padding: '11px 22px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 10,
  padding: '11px 20px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#94a3b8',
  border: '1px solid transparent',
  borderRadius: 10,
  padding: '11px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 10,
};

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 14,
  borderRadius: 12,
  background: 'rgba(15,23,42,0.72)',
  border: '1px solid #1e293b',
};

const stepBadge: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(56,189,248,0.14)',
  border: '1px solid rgba(56,189,248,0.4)',
  color: '#7dd3fc',
  fontSize: 12,
  fontWeight: 700,
};

const iconWrap: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(56,189,248,0.1)',
  border: '1px solid rgba(56,189,248,0.25)',
  color: '#7dd3fc',
};

const cardTitle: React.CSSProperties = {
  fontSize: 13.5,
  color: '#f8fafc',
};

const cardBody: React.CSSProperties = {
  fontSize: 12.5,
  color: '#94a3b8',
  lineHeight: 1.5,
};

const footer: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 11.5,
  color: '#64748b',
};

const PAD_COLORS = ['#f8fafc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];

function MiniSketchPad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const [inkColor, setInkColor] = useState(PAD_COLORS[1]);
  const [hasDrawn, setHasDrawn] = useState(false);

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const getLocalPt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = getLocalPt(e);
    lastPtRef.current = pt;
    setHasDrawn(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = inkColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPtRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getLocalPt(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
  };

  const onUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setHasDrawn(false);
  };

  return (
    <section style={sketchCard}>
      <div style={sketchHeader}>
        <span style={sketchLabel}>Try drawing right here</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {PAD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setInkColor(c)}
              aria-label={`Color ${c}`}
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: c,
                padding: 0,
                cursor: 'pointer',
                border: inkColor === c ? '2px solid #fff' : '2px solid transparent',
              }}
            />
          ))}
          <button type="button" onClick={clearPad} style={sketchClearBtn}>Clear</button>
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 150 }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        />
        {!hasDrawn && (
          <div style={sketchHint}>
            Sketch a quick note or diagram with your mouse or touch
          </div>
        )}
      </div>
    </section>
  );
}

const sketchCard: React.CSSProperties = {
  borderRadius: 14,
  background: 'rgba(15,23,42,0.82)',
  border: '1px solid #1e293b',
  overflow: 'hidden',
  boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
};

const sketchHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid #1e293b',
  background: 'rgba(15,23,42,0.6)',
};

const sketchLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#cbd5e1',
};

const sketchClearBtn: React.CSSProperties = {
  marginLeft: 6,
  padding: '3px 9px',
  borderRadius: 6,
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#cbd5e1',
  fontSize: 11,
  cursor: 'pointer',
};

const sketchHint: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  fontSize: 12.5,
  color: '#475569',
};
