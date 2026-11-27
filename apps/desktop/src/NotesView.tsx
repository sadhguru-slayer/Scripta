import { useCallback, useEffect, useMemo, useState } from 'react';
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

function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotesView({ onOpenPage, onOpenLanding }: NotesViewProps) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNbTitle, setNewNbTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<{ kind: 'notebook' | 'page'; id: string; value: string } | null>(null);

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

  const commitRename = async () => {
    if (!editing) return;
    const trimmed = editing.value.trim();
    const { kind, id } = editing;
    setEditing(null);
    if (!trimmed) return;
    try {
      const endpoint = kind === 'notebook' ? `/api/notebooks/${id}` : `/api/pages/${id}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`Failed to rename ${kind}`);
      await loadNotebooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
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

  const totalPages = useMemo(
    () => notebooks.reduce((sum, nb) => sum + nb.pages.length, 0),
    [notebooks],
  );

  const filteredNotebooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks
      .map((nb) => {
        const nbMatch = nb.title.toLowerCase().includes(q);
        const matchingPages = nb.pages.filter((p) => p.title.toLowerCase().includes(q));
        if (nbMatch) return nb;
        if (matchingPages.length > 0) return { ...nb, pages: matchingPages };
        return null;
      })
      .filter((nb): nb is NotebookSummary => nb !== null);
  }, [notebooks, searchQuery]);

  return (
    <div style={wrap}>
      <header style={header}>
        <div style={headerInner}>
          <button onClick={onOpenLanding} style={brandBtn} title="Welcome page">
            <img src={assetUrl('logo.png')} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>Scripta</span>
            <span style={workspaceTag}>Notes</span>
          </button>

          <div style={headerControls}>
            <div style={searchWrap}>
              <SearchIcon />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notebooks & pages..."
                style={searchInput}
                aria-label="Search notebooks and pages"
              />
            </div>

            <form onSubmit={createNotebook} style={{ display: 'flex', gap: 8 }}>
              <input
                value={newNbTitle}
                onChange={(e) => setNewNbTitle(e.target.value)}
                placeholder="New notebook..."
                style={inputStyle}
              />
              <button type="submit" style={primaryBtn}>+ Notebook</button>
            </form>
          </div>
        </div>
      </header>

      <main style={main}>
        <div style={heroRow}>
          <div>
            <h1 style={heroTitle}>Workspace</h1>
            <p style={heroSub}>
              {notebooks.length} {notebooks.length === 1 ? 'notebook' : 'notebooks'} · {totalPages}{' '}
              {totalPages === 1 ? 'page' : 'pages'}
            </p>
          </div>
        </div>

        {error && <div style={errBox}>{error}</div>}
        {loading ? (
          <div style={emptyState}>Loading your workspace...</div>
        ) : filteredNotebooks.length === 0 ? (
          <div style={emptyState}>
            {searchQuery.trim()
              ? 'No notebooks or pages match your search.'
              : 'No notebooks yet. Create one above to get started.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {filteredNotebooks.map((nb) => {
              const isEditingNb = editing?.kind === 'notebook' && editing.id === nb.id;
              return (
                <section key={nb.id} style={nbSection}>
                  <div style={nbHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={nbIconBadge}>
                        <NotebookIcon />
                      </span>
                      {isEditingNb ? (
                        <input
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={() => void commitRename()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRename();
                            } else if (e.key === 'Escape') {
                              setEditing(null);
                            }
                          }}
                          style={inlineRenameInput}
                        />
                      ) : (
                        <h2
                          style={nbTitle}
                          onDoubleClick={() => setEditing({ kind: 'notebook', id: nb.id, value: nb.title })}
                          title="Double-click to rename"
                        >
                          {nb.title}
                        </h2>
                      )}
                      <span style={countPill}>{nb.pages.length}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => setEditing({ kind: 'notebook', id: nb.id, value: nb.title })}
                        style={iconActionBtn}
                        title="Rename notebook"
                        aria-label={`Rename ${nb.title}`}
                      >
                        <PencilIcon />
                      </button>
                      <button onClick={() => void createPage(nb.id)} style={secondaryBtn}>
                        + Page
                      </button>
                      <button
                        onClick={() => void deleteNotebook(nb.id)}
                        style={dangerIconBtn}
                        title="Delete notebook"
                        aria-label={`Delete ${nb.title}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  {nb.pages.length === 0 ? (
                    <div style={emptyPagesRow}>
                      <span>No pages in this notebook yet.</span>
                      <button onClick={() => void createPage(nb.id)} style={linkBtn}>
                        Create first page
                      </button>
                    </div>
                  ) : (
                    <div style={pageGrid}>
                      {nb.pages.map((pg) => {
                        const isEditingPg = editing?.kind === 'page' && editing.id === pg.id;
                        return (
                          <div key={pg.id} style={pageCard}>
                            <div
                              onClick={() => {
                                if (!isEditingPg) onOpenPage(pg.id);
                              }}
                              style={pagePreview}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !isEditingPg) onOpenPage(pg.id);
                              }}
                            >
                              <div style={pagePreviewPattern(pg.bgType)} />
                              <span style={bgBadge}>{pg.bgType || 'dots'}</span>
                            </div>

                            <div style={pageFooter}>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                {isEditingPg ? (
                                  <input
                                    autoFocus
                                    value={editing.value}
                                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                    onBlur={() => void commitRename()}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void commitRename();
                                      } else if (e.key === 'Escape') {
                                        setEditing(null);
                                      }
                                    }}
                                    style={inlineRenameInput}
                                  />
                                ) : (
                                  <div
                                    style={pageTitle}
                                    onClick={() => onOpenPage(pg.id)}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setEditing({ kind: 'page', id: pg.id, value: pg.title });
                                    }}
                                    title={`${pg.title} (double-click to rename)`}
                                  >
                                    {pg.title}
                                  </div>
                                )}
                                <div style={pageMeta}>Updated {formatRelativeTime(pg.updatedAt)}</div>
                              </div>

                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  onClick={() => setEditing({ kind: 'page', id: pg.id, value: pg.title })}
                                  style={iconActionBtn}
                                  title="Rename page"
                                  aria-label={`Rename ${pg.title}`}
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  onClick={() => void deletePage(pg.id)}
                                  style={dangerIconBtn}
                                  title="Delete page"
                                  aria-label={`Delete ${pg.title}`}
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function NotebookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at 20% 0%, #0f172a 0%, #020617 60%)',
  color: '#f8fafc',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const header: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  background: 'rgba(2, 6, 23, 0.78)',
  backdropFilter: 'blur(14px)',
  borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
};

const headerInner: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 14,
  padding: '14px 24px',
};

const brandBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  background: 'transparent',
  border: 'none',
  color: '#f8fafc',
  cursor: 'pointer',
  padding: 0,
};

const workspaceTag: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#7dd3fc',
  background: 'rgba(56, 189, 248, 0.12)',
  border: '1px solid rgba(56, 189, 248, 0.28)',
  padding: '2px 7px',
  borderRadius: 999,
};

const headerControls: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
};

const searchWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(15, 23, 42, 0.8)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 10,
  padding: '0 10px',
  height: 36,
};

const searchInput: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#f8fafc',
  fontSize: 13,
  outline: 'none',
  width: 185,
};

const main: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '28px 24px 64px',
};

const heroRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  marginBottom: 22,
};

const heroTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  fontWeight: 700,
  letterSpacing: -0.4,
};

const heroSub: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  color: '#94a3b8',
};

const emptyState: React.CSSProperties = {
  padding: 40,
  textAlign: 'center',
  color: '#94a3b8',
  fontSize: 14,
  borderRadius: 16,
  background: 'rgba(15, 23, 42, 0.45)',
  border: '1px dashed rgba(148, 163, 184, 0.2)',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.85)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 10,
  padding: '0 12px',
  height: 36,
  color: '#f8fafc',
  fontSize: 13,
  width: 170,
  outline: 'none',
};

const inlineRenameInput: React.CSSProperties = {
  background: '#020617',
  border: '1px solid #38bdf8',
  borderRadius: 7,
  padding: '4px 8px',
  color: '#f8fafc',
  fontSize: 14,
  fontWeight: 600,
  outline: 'none',
  width: '100%',
  maxWidth: 260,
};

const primaryBtn: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0284c7, #0369a1)',
  color: '#fff',
  border: '1px solid rgba(56, 189, 248, 0.5)',
  borderRadius: 10,
  padding: '0 14px',
  height: 36,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.85)',
  color: '#e2e8f0',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: 8,
  padding: '6px 11px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const iconActionBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(30, 41, 59, 0.65)',
  color: '#94a3b8',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: 8,
  cursor: 'pointer',
  padding: 0,
};

const dangerIconBtn: React.CSSProperties = {
  ...iconActionBtn,
  color: '#fda4af',
  border: '1px solid rgba(251, 113, 133, 0.22)',
};

const errBox: React.CSSProperties = {
  background: 'rgba(225, 29, 72, 0.14)',
  border: '1px solid rgba(251, 113, 133, 0.45)',
  color: '#fecdd3',
  padding: '10px 14px',
  borderRadius: 10,
  marginBottom: 18,
  fontSize: 13,
};

const nbSection: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.62)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  borderRadius: 16,
  padding: 18,
  boxShadow: '0 12px 32px rgba(2, 6, 23, 0.35)',
};

const nbHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 10,
  marginBottom: 14,
};

const nbIconBadge: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(56, 189, 248, 0.12)',
  border: '1px solid rgba(56, 189, 248, 0.25)',
  color: '#7dd3fc',
  flexShrink: 0,
};

const nbTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: '#f8fafc',
  cursor: 'text',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const countPill: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#94a3b8',
  background: 'rgba(30, 41, 59, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: 999,
  padding: '1px 8px',
};

const emptyPagesRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: '#64748b',
  fontSize: 13,
  padding: '8px 2px',
};

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#38bdf8',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
};

const pageGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 14,
};

const pageCard: React.CSSProperties = {
  background: 'rgba(2, 6, 23, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  borderRadius: 12,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.15s ease',
};

const pagePreview: React.CSSProperties = {
  position: 'relative',
  height: 92,
  background: '#060c1a',
  borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
  cursor: 'pointer',
  overflow: 'hidden',
};

function pagePreviewPattern(bgType: string): React.CSSProperties {
  if (bgType === 'grid') {
    return {
      position: 'absolute',
      inset: 0,
      backgroundImage:
        'linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)',
      backgroundSize: '16px 16px',
    };
  }
  if (bgType === 'lined') {
    return {
      position: 'absolute',
      inset: 0,
      backgroundImage: 'linear-gradient(to bottom, rgba(56,189,248,0.14) 1px, transparent 1px)',
      backgroundSize: '100% 16px',
    };
  }
  if (bgType === 'plain') {
    return { position: 'absolute', inset: 0 };
  }
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.22) 1px, transparent 1px)',
    backgroundSize: '14px 14px',
  };
}

const bgBadge: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#94a3b8',
  background: 'rgba(15, 23, 42, 0.85)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 6,
  padding: '2px 6px',
};

const pageFooter: React.CSSProperties = {
  padding: '10px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const pageTitle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: '#f1f5f9',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pageMeta: React.CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  marginTop: 2,
};
