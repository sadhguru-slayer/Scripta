import { useCallback, useEffect, useState } from 'react';
import { assetUrl } from './assets';

export interface PageSummary {
  id: string;
  notebookId: string;
  title: string;
  sortOrder: number;
  bgType: string;
  updatedAt: number;
}

export interface NotebookSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pages: PageSummary[];
}

interface NotesViewProps {
  onOpenPage: (pageId: string) => void;
  onOpenLanding: () => void;
}

export function NotesView({ onOpenPage, onOpenLanding }: NotesViewProps) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNbTitle, setNewNbTitle] = useState('');

  const loadNotebooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notebooks');
      if (!res.ok) throw new Error('Failed to load notebooks');
      const data = await res.json();
      setNotebooks(data.notebooks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notebooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  const createNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newNbTitle.trim() || 'Untitled Notebook';
    try {
      const res = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to create notebook');
      setNewNbTitle('');
      await loadNotebooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const createPage = async (notebookId: string) => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to create page');
      const pg = (await res.json()) as PageSummary;
      onOpenPage(pg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create page failed');
    }
  };

  const deleteNotebook = async (id: string) => {
    try {
      await fetch(`/api/notebooks/${id}`, { method: 'DELETE' });
      await loadNotebooks();
    } catch { /* ignore */ }
  };

  const deletePage = async (id: string) => {
    try {
      await fetch(`/api/pages/${id}`, { method: 'DELETE' });
      await loadNotebooks();
    } catch { /* ignore */ }
  };

  return (
    <div style={wrap}>
      <header style={header}>
        <button onClick={onOpenLanding} style={brandBtn} title="Welcome page">
          <img src={assetUrl('logo.png')} alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Scripta Notes</span>
        </button>

        <form onSubmit={createNotebook} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newNbTitle}
            onChange={(e) => setNewNbTitle(e.target.value)}
            placeholder="New notebook title..."
            style={inputStyle}
          />
          <button type="submit" style={primaryBtn}>+ Notebook</button>
        </form>
      </header>

      <main style={main}>
        {error && <div style={errBox}>{error}</div>}
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading notebooks...</p>
        ) : (
          <div style={nbGrid}>
            {notebooks.map((nb) => (
              <section key={nb.id} style={nbCard}>
                <div style={nbHead}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>{nb.title}</h2>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>
                      {nb.pages.length} {nb.pages.length === 1 ? 'page' : 'pages'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => createPage(nb.id)} style={smallBtn}>+ Page</button>
                    {notebooks.length > 1 && (
                      <button
                        onClick={() => deleteNotebook(nb.id)}
                        style={{ ...smallBtn, color: '#fda4af', borderColor: 'rgba(251,113,133,0.35)' }}
                        title="Delete notebook"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                <div style={pageList}>
                  {nb.pages.map((pg) => (
                    <div key={pg.id} style={pageRow}>
                      <button onClick={() => onOpenPage(pg.id)} style={pageOpenBtn}>
                        <span style={{ fontWeight: 500, color: '#f8fafc' }}>{pg.title}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(pg.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      {nb.pages.length > 1 && (
                        <button
                          onClick={() => deletePage(pg.id)}
                          aria-label={`Delete ${pg.title}`}
                          style={delPageBtn}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#06090f',
  color: '#f8fafc',
  display: 'flex',
  flexDirection: 'column',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '16px 24px',
  borderBottom: '1px solid #1e293b',
  background: 'rgba(15,23,42,0.75)',
};

const brandBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'transparent',
  border: 'none',
  color: '#f8fafc',
  cursor: 'pointer',
  padding: 0,
};

const main: React.CSSProperties = {
  maxWidth: 960,
  width: '100%',
  margin: '0 auto',
  padding: '28px 24px',
  boxSizing: 'border-box',
};

const nbGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
};

const nbCard: React.CSSProperties = {
  background: 'rgba(15,23,42,0.85)',
  border: '1px solid #1e293b',
  borderRadius: 14,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const nbHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
};

const pageList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const pageRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const pageOpenBtn: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '9px 12px',
  borderRadius: 9,
  background: '#0f172a',
  border: '1px solid #334155',
  cursor: 'pointer',
  fontSize: 13,
};

const delPageBtn: React.CSSProperties = {
  width: 28,
  height: 34,
  borderRadius: 8,
  background: 'transparent',
  border: '1px solid #334155',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: 16,
};

const inputStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '7px 12px',
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  background: '#0284c7',
  color: '#fff',
  border: '1px solid #38bdf8',
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const smallBtn: React.CSSProperties = {
  background: '#1e293b',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 7,
  padding: '4px 9px',
  fontSize: 11.5,
  cursor: 'pointer',
};

const errBox: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  background: 'rgba(251,113,133,0.12)',
  border: '1px solid rgba(251,113,133,0.35)',
  color: '#fda4af',
  fontSize: 13,
  marginBottom: 16,
};
