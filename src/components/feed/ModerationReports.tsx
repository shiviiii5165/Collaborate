'use client';

/**
 * Admin console "Content Reports" tab: reported posts, comments and members grouped by target,
 * with the full (including hidden / removed) content, every report, the audit history, and the
 * dismiss / remove / restore decisions. Data: GET/POST /api/admin/reports (admin only).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, EyeOff, History, RotateCcw, Trash2 } from 'lucide-react';

type Card = { id: string; fullName: string; headline?: string } | null;
interface ReportItem {
  targetType: 'post' | 'comment' | 'member';
  targetId: string;
  reportedMember: Card;
  state: 'visible' | 'hidden_pending_review' | 'removed' | 'deleted_by_author' | 'missing' | 'member_report';
  content: null | { text: string; author: Card; createdAt: string; kind?: string; attachments?: { type: string; url: string; title?: string }[]; postId: string };
  openReports: number;
  distinctReporters: number;
  reports: { id: string; reporter: Card; reason: string; details: string; status: string; createdAt: string; reviewedBy: Card; reviewedAt: string | null; decision: string | null; reviewNote: string | null }[];
  audit: { id: string; decision: string; note: string | null; reviewer: Card; at: string; previousState: string; newState: string }[];
}

const STATE_LABEL: Record<ReportItem['state'], { label: string; color: string; bg: string }> = {
  visible: { label: 'Visible', color: '#047857', bg: '#ECFDF5' },
  hidden_pending_review: { label: 'Hidden pending review', color: '#B45309', bg: '#FFFBEB' },
  removed: { label: 'Removed by moderator', color: '#B91C1C', bg: '#FEF2F2' },
  deleted_by_author: { label: 'Deleted by author', color: '#475569', bg: '#F1F5F9' },
  missing: { label: 'Content missing', color: '#475569', bg: '#F1F5F9' },
  member_report: { label: 'Member report', color: '#4F46E5', bg: '#EEF2FF' },
};

export function ModerationReports() {
  const [status, setStatus] = useState<'pending' | 'reviewed' | 'all'>('pending');
  const [items, setItems] = useState<ReportItem[] | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems([]);
        setError(res.status === 403 ? 'Admin role required.' : data.message || 'Reports could not be loaded.');
        return;
      }
      setItems(data.items);
    } catch {
      setError('Network error while loading reports.');
    }
  }, [status]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const decide = async (item: ReportItem, decision: 'dismiss' | 'remove' | 'restore') => {
    const key = `${item.targetType}:${item.targetId}`;
    if (decision === 'remove' && !confirm('Remove this content? Only its author will still see it, and you can restore it later.')) return;
    setBusy(key);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(item.reports[0].id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[key] || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(data.message || 'The decision could not be saved. Please retry.');
      else {
        setMessage(`Saved: ${decision}. The decision is recorded in the audit history.`);
        setNotes((n) => ({ ...n, [key]: '' }));
        await load();
      }
    } catch {
      setMessage('Network error. The decision was not saved.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="feed-filter-bar">
        {(['pending', 'reviewed', 'all'] as const).map((s) => (
          <button key={s} type="button" className={`feed-filter ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s === 'pending' ? 'Open' : s === 'reviewed' ? 'Reviewed' : 'All'}
          </button>
        ))}
      </div>
      {message && <div className="feed-notice" role="status">{message}</div>}
      {error && <div className="feed-error" role="alert">{error}</div>}
      {items === null && !error && <div className="info-card" style={{ color: '#64748B' }}>Loading reports…</div>}
      {items?.length === 0 && !error && (
        <div className="info-card" style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
          {status === 'pending' ? 'No open reports.' : 'Nothing here.'}
        </div>
      )}
      {items?.map((item) => {
        const key = `${item.targetType}:${item.targetId}`;
        const st = STATE_LABEL[item.state];
        const isContent = item.targetType !== 'member';
        const canAct = isContent && item.state !== 'deleted_by_author' && item.state !== 'missing';
        return (
          <div key={key} className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: `4px solid ${st.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: '0.86rem' }}>
                <strong style={{ textTransform: 'capitalize' }}>{item.targetType}</strong> by <strong>{item.reportedMember?.fullName ?? 'Unknown member'}</strong>
                <span className="feed-muted"> · {item.openReports} open report{item.openReports === 1 ? '' : 's'} from {item.distinctReporters} member{item.distinctReporters === 1 ? '' : 's'}</span>
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: st.color, background: st.bg, padding: '3px 10px', borderRadius: 999, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                {item.state === 'hidden_pending_review' && <EyeOff size={12} />}
                {st.label}
              </span>
            </div>

            {item.content && (
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', fontSize: '0.84rem', color: '#334155' }}>
                <div className="feed-text" style={{ marginTop: 0 }}>{item.content.text || <em>(no text)</em>}</div>
                {(item.content.attachments || []).map((a) => (
                  <div key={a.url} className="feed-muted" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>
                    {a.type}: {a.url}
                  </div>
                ))}
                <div className="feed-muted" style={{ marginTop: 6 }}>Posted {new Date(item.content.createdAt).toLocaleString()}</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {item.reports.map((r) => (
                <div key={r.id} style={{ fontSize: '0.8rem', color: '#475569', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{r.reason}</strong>
                    {r.details ? ` — ${r.details}` : ''} <span className="feed-muted">by {r.reporter?.fullName ?? 'member'}</span>
                  </span>
                  <span className="feed-muted">
                    {r.status}
                    {r.decision ? ` (${r.decision})` : ''} · {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>

            {(isContent ? true : item.openReports > 0) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="feed-input"
                  style={{ flex: '1 1 220px' }}
                  placeholder="Moderator note (internal, kept in the audit record)"
                  maxLength={1000}
                  value={notes[key] || ''}
                  onChange={(e) => setNotes({ ...notes, [key]: e.target.value })}
                />
                {item.openReports > 0 && (
                  <button type="button" className="btn-secondary feed-btn-sm" disabled={busy === key} onClick={() => decide(item, 'dismiss')}>
                    <CheckCircle2 size={14} /> Dismiss
                  </button>
                )}
                {canAct && item.state !== 'removed' && (
                  <button type="button" className="btn-secondary feed-btn-sm" style={{ color: '#B91C1C', borderColor: '#FECACA' }} disabled={busy === key} onClick={() => decide(item, 'remove')}>
                    <Trash2 size={14} /> Remove
                  </button>
                )}
                {canAct && (item.state === 'removed' || item.state === 'hidden_pending_review') && (
                  <button type="button" className="btn-secondary feed-btn-sm" disabled={busy === key} onClick={() => decide(item, 'restore')}>
                    <RotateCcw size={14} /> Restore
                  </button>
                )}
              </div>
            )}

            {item.audit.length > 0 && (
              <details className="feed-definitions">
                <summary>
                  <History size={12} style={{ verticalAlign: '-1px' }} /> Audit history ({item.audit.length})
                </summary>
                <ul>
                  {item.audit.map((a) => (
                    <li key={a.id}>
                      <strong>{a.decision}</strong> by {a.reviewer?.fullName ?? 'moderator'} · {new Date(a.at).toLocaleString()} · {a.previousState} → {a.newState}
                      {a.note ? ` · “${a.note}”` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
