'use client';

/**
 * People discovery: recommendations from the matching engine first, then every other eligible
 * member exactly once. Ordering, eligibility (discoverability, visibility, blocks, safeguarding)
 * and the recommendation reasons all come from GET /api/discover; this view never re-ranks,
 * never invents a score and never lists a recommended person a second time.
 *
 * Connection actions are applied optimistically and then reconciled with the server
 * (onRefresh re-reads /api/discover). The server rejects duplicates and self-connections.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Sparkles, MapPin, CheckCircle2, UserPlus, Check, Eye, X, Clock, Users } from 'lucide-react';
import { RecommendationMatch } from '@/lib/types';

type ConnStatus = 'not_connected' | 'request_sent' | 'accepted' | string;
type Direction = 'incoming' | 'outgoing' | null;

interface ConnState {
  status: ConnStatus;
  connectionId: string | null;
  direction: Direction;
}

type RecWithConn = RecommendationMatch & { connectionStatus?: ConnStatus; connectionId?: string | null; pendingDirection?: Direction };

interface PeopleDiscoverViewProps {
  recommendations: RecWithConn[];
  searchResults: any[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onViewProfile: (memberId: string) => void;
  /** Kept for callers that still pass it; connection actions are handled here. */
  onConnect?: (memberId: string) => void;
  onRefresh?: () => void;
  quotaRemaining: number;
  userPlan: string;
  onOpenUpgradeModal: () => void;
}

const initials = (name: string) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

function Avatar({ src, name, size = 50 }: { src?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken || src.endsWith('default_avatar.svg')) {
    return (
      <span className="dv-avatar dv-avatar-initials" style={{ width: size, height: size }} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return <img src={src} alt="" className="dv-avatar" style={{ width: size, height: size }} onError={() => setBroken(true)} />;
}

/** Subtitle from authorised public fields only: current role / institution, never a placeholder. */
function contextLine(m: any): string | null {
  const parts: string[] = [];
  if (m.location) parts.push(m.location);
  const edu = m.education?.[0]?.institution;
  const exp = m.experience?.[0]?.company;
  if (exp) parts.push(exp);
  else if (edu) parts.push(edu);
  return parts.length ? parts.join(' · ') : null;
}

export const PeopleDiscoverView: React.FC<PeopleDiscoverViewProps> = ({
  recommendations,
  searchResults,
  searchQuery,
  onSearchChange,
  onViewProfile,
  onRefresh,
  quotaRemaining,
  userPlan,
  onOpenUpgradeModal,
}) => {
  const [selectedSkill, setSelectedSkill] = useState<string>('all');
  const [overrides, setOverrides] = useState<Record<string, ConnState>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const recIds = useMemo(() => new Set(recommendations.map((r) => r.member.id)), [recommendations]);

  // Server state wins once it arrives: optimistic overrides only bridge the round trip.
  useEffect(() => {
    setOverrides((o) => {
      const pending = Object.keys(o).filter((id) => busy[id]);
      return pending.length ? Object.fromEntries(pending.map((id) => [id, o[id]!])) : {};
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendations, searchResults]);

  const stateOf = (id: string, fallback: { connectionStatus?: ConnStatus; connectionId?: string | null; pendingDirection?: Direction }): ConnState =>
    overrides[id] ?? { status: fallback.connectionStatus || 'not_connected', connectionId: fallback.connectionId ?? null, direction: fallback.pendingDirection ?? null };

  async function act(memberId: string, current: ConnState, action: 'send_request' | 'withdraw' | 'accept' | 'reject', name: string) {
    if (busy[memberId]) return;
    setBusy((b) => ({ ...b, [memberId]: true }));
    setNotice(null);
    const optimistic: ConnState =
      action === 'send_request'
        ? { status: 'request_sent', connectionId: null, direction: 'outgoing' }
        : action === 'accept'
          ? { status: 'accepted', connectionId: current.connectionId, direction: null }
          : { status: 'not_connected', connectionId: null, direction: null };
    setOverrides((o) => ({ ...o, [memberId]: optimistic }));
    try {
      const body = action === 'send_request' ? { action, toId: memberId } : { action, connectionId: current.connectionId };
      const res = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const friendly: Record<number, string> = {
          401: 'Your session has expired. Sign in again.',
          403: 'This connection is not allowed.',
          404: 'This member is no longer available.',
          409: 'A request between you already exists.',
        };
        throw new Error(data.message || friendly[res.status] || 'The request could not be completed. Please try again.');
      }
      if (data.connection?.id) setOverrides((o) => ({ ...o, [memberId]: { ...optimistic, connectionId: data.connection.id } }));
      setNotice({
        kind: 'ok',
        text:
          action === 'send_request'
            ? `Connection request sent to ${name}.`
            : action === 'withdraw'
              ? `Request to ${name} cancelled.`
              : action === 'accept'
                ? `You are now connected with ${name}.`
                : `Request from ${name} declined.`,
      });
    } catch (err) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[memberId];
        return next;
      });
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy((b) => ({ ...b, [memberId]: false }));
      onRefresh?.();
    }
  }

  function Actions({ id, name, conn }: { id: string; name: string; conn: ConnState }) {
    const disabled = Boolean(busy[id]);
    if (conn.status === 'accepted') {
      return (
        <span className="dv-status dv-status-connected">
          <Check size={14} aria-hidden="true" /> Connected
        </span>
      );
    }
    if (conn.status === 'request_sent' && conn.direction === 'incoming') {
      return (
        <div className="dv-action-group">
          <button className="btn-primary dv-btn" disabled={disabled || !conn.connectionId} onClick={() => act(id, conn, 'accept', name)}>
            <Check size={14} aria-hidden="true" /> Accept
          </button>
          <button className="btn-secondary dv-btn" disabled={disabled || !conn.connectionId} onClick={() => act(id, conn, 'reject', name)} aria-label={`Decline request from ${name}`}>
            <X size={14} aria-hidden="true" /> Decline
          </button>
        </div>
      );
    }
    if (conn.status === 'request_sent') {
      return (
        <div className="dv-action-group">
          <span className="dv-status">
            <Clock size={14} aria-hidden="true" /> Pending
          </span>
          {conn.connectionId && (
            <button className="dv-link-btn" disabled={disabled} onClick={() => act(id, conn, 'withdraw', name)}>
              Cancel
            </button>
          )}
        </div>
      );
    }
    return (
      <button className="btn-primary dv-btn" disabled={disabled} onClick={() => act(id, conn, 'send_request', name)}>
        <UserPlus size={14} aria-hidden="true" /> Connect
      </button>
    );
  }

  // Everyone else, once: recommended people are not repeated in the directory.
  const others = searchResults.filter((m) => !recIds.has(m.id));
  const skillCounts = new Map<string, number>();
  for (const m of [...recommendations.map((r) => r.member), ...others]) for (const s of m.skills || []) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
  const topSkills = [...skillCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([s]) => s);
  const skillMatch = (m: any) => selectedSkill === 'all' || (m.skills || []).some((s: string) => s.toLowerCase() === selectedSkill.toLowerCase());

  const visibleRecs = recommendations.filter((r) => skillMatch(r.member));
  const filteredOthers = others.filter(skillMatch);
  const incoming = filteredOthers.filter((m) => stateOf(m.id, m).status === 'request_sent' && stateOf(m.id, m).direction === 'incoming');
  const connected = filteredOthers.filter((m) => stateOf(m.id, m).status === 'accepted' && !incoming.includes(m));
  const rest = filteredOthers.filter((m) => !incoming.includes(m) && !connected.includes(m));

  const renderRow = (m: any) => {
    const conn = stateOf(m.id, m);
    const sub = contextLine(m);
    return (
      <li key={m.id} className="info-card directory-row dv-row">
        <button type="button" className="dv-person" onClick={() => onViewProfile(m.id)}>
          <Avatar src={m.avatarUrl} name={m.fullName} />
          <span className="dv-person-text">
            <span className="dv-name">
              {m.fullName}
              {m.isVerified && <CheckCircle2 size={15} fill="#0284C7" color="#fff" aria-label="Verified" />}
            </span>
            {m.headline && <span className="dv-headline">{m.headline}</span>}
            {sub && (
              <span className="dv-sub">
                <MapPin size={11} aria-hidden="true" /> {sub}
              </span>
            )}
          </span>
        </button>
        <div className="directory-row-actions dv-row-actions">
          <button className="btn-secondary dv-btn" onClick={() => onViewProfile(m.id)}>
            <Eye size={14} aria-hidden="true" /> View
          </button>
          <Actions id={m.id} name={m.fullName} conn={conn} />
        </div>
      </li>
    );
  };

  return (
    <div className="dv-root">
      <div className="info-card">
        <div className="discover-head dv-head">
          <div>
            <h2 className="dv-title">Discover people</h2>
            <p className="dv-intro">People are ordered by how well their skills, projects and goals fit yours. Only members who chose to be discoverable are shown.</p>
          </div>
          {userPlan === 'free' ? (
            <div className="dv-quota">
              <div className="dv-quota-main">Full-profile views today: {quotaRemaining}/3</div>
              <button type="button" className="dv-link-btn" onClick={onOpenUpgradeModal}>
                Upgrade for unlimited views
              </button>
            </div>
          ) : (
            <div className="premium-badge-tag" style={{ padding: '6px 14px' }}>
              Unlimited full-profile views
            </div>
          )}
        </div>

        {searchQuery && (
          <div className="dv-searching">
            <Search size={14} aria-hidden="true" /> Showing results for “{searchQuery}”
            <button type="button" className="dv-link-btn" onClick={() => onSearchChange('')}>
              Clear
            </button>
          </div>
        )}

        {topSkills.length > 0 && (
          <div className="dv-filters" role="group" aria-label="Filter by skill">
            <span className="dv-filter-label">Skills:</span>
            {['all', ...topSkills].map((s) => (
              <button key={s} type="button" className={`dv-chip ${selectedSkill === s ? 'is-active' : ''}`} aria-pressed={selectedSkill === s} onClick={() => setSelectedSkill(s)}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && (
        <div className={`dv-notice ${notice.kind === 'error' ? 'is-error' : ''}`} role="status">
          {notice.text}
        </div>
      )}

      <section aria-labelledby="dv-rec-title">
        <div className="dv-section-head">
          <Sparkles size={17} color="#6D28D9" aria-hidden="true" />
          <h3 id="dv-rec-title">Recommended for you</h3>
          {visibleRecs.length > 0 && <span className="ps-count">{visibleRecs.length}</span>}
        </div>
        {visibleRecs.length === 0 ? (
          <p className="empty-note dv-empty-recs">
            {recommendations.length === 0
              ? 'No strong matches yet. Recommendations use your skills, projects and career goals, so adding them (or syncing from AI Tathastu) gives the matcher real evidence. Everyone who is discoverable is still listed below.'
              : 'No recommended people match this filter.'}
          </p>
        ) : (
          <div className="discover-rec-grid">
            {visibleRecs.map((rec) => {
              const m = rec.member;
              const conn = stateOf(m.id, rec);
              const sub = contextLine(m);
              const helps = rec.explanation?.helpsWith ?? [];
              const shared = rec.explanation?.sharedSkills ?? [];
              const complementary = rec.explanation?.complementarySkills ?? [];
              const relevant = [...new Set([...helps.map((h) => h.skill), ...complementary, ...shared])].slice(0, 5);
              return (
                <article key={m.id} className="info-card dv-rec">
                  <button type="button" className="dv-person" onClick={() => onViewProfile(m.id)}>
                    <Avatar src={m.avatarUrl} name={m.fullName} size={52} />
                    <span className="dv-person-text">
                      <span className="dv-name">
                        {m.fullName}
                        {m.isVerified && <CheckCircle2 size={15} fill="#0284C7" color="#fff" aria-label="Verified" />}
                      </span>
                      {m.headline && <span className="dv-headline dv-clamp">{m.headline}</span>}
                      {sub && <span className="dv-sub">{sub}</span>}
                    </span>
                  </button>

                  <div className="dv-reason">
                    <span className="dv-reason-label">Why recommended</span>
                    <p>{rec.reason}</p>
                    {rec.explanation?.possibleCollaboration && <p className="dv-reason-extra">{rec.explanation.possibleCollaboration}</p>}
                    {rec.mutualCount > 0 && (
                      <p className="dv-reason-extra">
                        <Users size={12} aria-hidden="true" /> {rec.mutualCount} mutual connection{rec.mutualCount > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>

                  {relevant.length > 0 && (
                    <div className="dv-skills" aria-label="Relevant skills">
                      {relevant.map((s) => (
                        <span key={s} className={`dv-skill ${shared.includes(s) ? 'is-shared' : 'is-complementary'}`} title={shared.includes(s) ? 'You both list this skill' : 'A skill that complements yours'}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="dv-card-actions">
                    <button className="btn-secondary dv-btn" onClick={() => onViewProfile(m.id)}>
                      <Eye size={14} aria-hidden="true" /> View profile
                    </button>
                    <Actions id={m.id} name={m.fullName} conn={conn} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {incoming.length > 0 && (
        <section aria-labelledby="dv-incoming-title">
          <div className="dv-section-head">
            <h3 id="dv-incoming-title">Requests waiting for you</h3>
            <span className="ps-count">{incoming.length}</span>
          </div>
          <ul className="dv-list">{incoming.map(renderRow)}</ul>
        </section>
      )}

      <section aria-labelledby="dv-more-title">
        <div className="dv-section-head">
          <h3 id="dv-more-title">More people on Collaborate</h3>
          <span className="ps-count">{rest.length}</span>
        </div>
        {rest.length === 0 ? (
          <div className="dv-empty">
            <div className="dv-empty-title">{searchQuery || selectedSkill !== 'all' ? 'No one matches this search' : 'No other discoverable members yet'}</div>
            <div>{searchQuery || selectedSkill !== 'all' ? 'Try a different name or skill, or clear the filter.' : 'Members appear here once they turn on discoverability.'}</div>
          </div>
        ) : (
          <ul className="dv-list">{rest.map(renderRow)}</ul>
        )}
      </section>

      {connected.length > 0 && (
        <section aria-labelledby="dv-connected-title">
          <div className="dv-section-head">
            <h3 id="dv-connected-title">Already in your network</h3>
            <span className="ps-count">{connected.length}</span>
          </div>
          <ul className="dv-list">{connected.map(renderRow)}</ul>
        </section>
      )}
    </div>
  );
};
