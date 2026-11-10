'use client';

import React, { useState } from 'react';
import { Sparkles, Send, CheckCircle2, UserPlus, Check } from 'lucide-react';
import { RecommendationMatch, MemberProfile } from '@/lib/types';

interface RightRailProps {
  recommendations: RecommendationMatch[];
  currentUser: MemberProfile | null;
  onConnect: (memberId: string) => void;
  onViewProfile: (memberId: string) => void;
  onViewAllPeople: () => void;
}

/** One factual line from the engine's evidence: what this person can help with, or why they match. */
function shortReason(rec: RecommendationMatch): string {
  const help = rec.explanation?.helpsWith?.slice(0, 2).map((h) => h.skill) ?? [];
  if (help.length) return `Can help with ${help.join(' and ')}`;
  if (rec.mutualCount > 0) return `${rec.mutualCount} mutual connection${rec.mutualCount > 1 ? 's' : ''}`;
  const shared = rec.explanation?.sharedSkills?.slice(0, 2) ?? [];
  if (shared.length) return `Also works with ${shared.join(', ')}`;
  const comp = rec.explanation?.complementarySkills?.slice(0, 2) ?? [];
  if (comp.length) return `Adds ${comp.join(', ')} to your work`;
  return rec.reason || '';
}

export const RightRail: React.FC<RightRailProps> = ({
  recommendations,
  currentUser,
  onConnect,
  onViewProfile,
  onViewAllPeople,
}) => {
  const [eoraInput, setEoraInput] = useState('');
  const [eoraMessages, setEoraMessages] = useState<
    Array<{ text: string; isUser: boolean; timestamp: string }>
  >([
    {
      text: `Hi ${
        currentUser ? currentUser.fullName.split(' ')[0] : 'there'
      }! 👋 Want help improving your profile, finding collaborators, or exploring opportunities today?`,
      isUser: false,
      timestamp: 'just now',
    },
  ]);
  const [loadingEora, setLoadingEora] = useState(false);
  // The server already dedupes; this guards against a stale client list repeating a member id.
  const uniqueRecs = recommendations.filter((r, i, all) => all.findIndex((x) => x.member.id === r.member.id) === i);

  const handleSendPrompt = async (promptText: string) => {
    if (!promptText.trim()) return;

    const userMsg = promptText.trim();
    setEoraMessages((prev) => [
      ...prev,
      { text: userMsg, isUser: true, timestamp: 'just now' },
    ]);
    setEoraInput('');
    setLoadingEora(true);

    try {
      const res = await fetch('/api/eora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMsg, userId: currentUser ? currentUser.id : 'usr_guest' }),
      });
      const data = await res.json();
      if (data.reply) {
        setEoraMessages((prev) => [
          ...prev,
          { text: data.reply, isUser: false, timestamp: 'just now' },
        ]);
      }
    } catch {
      setEoraMessages((prev) => [
        ...prev,
        {
          text: 'I can help analyze your collaborators or career milestone! Please ask again in a moment.',
          isUser: false,
          timestamp: 'just now',
        },
      ]);
    } finally {
      setLoadingEora(false);
    }
  };

  return (
    <aside className="right-rail">
      {/* People You May Know */}
      <div className="people-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <h2 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
            People You May Know
          </h2>
          <button
            style={{ fontSize: '0.78rem', color: '#4F46E5', fontWeight: 700 }}
            onClick={onViewAllPeople}
          >
            View all
          </button>
        </div>

        <div>
          {uniqueRecs.length === 0 && (
            <p className="people-empty">
              {currentUser && currentUser.skills.length === 0
                ? 'Add skills or a career goal to your profile to see people who can help you.'
                : 'No relevant profiles found yet.'}
            </p>
          )}
          {uniqueRecs.slice(0, 3).map((rec) => {
            const why = shortReason(rec);
            const org = rec.member.experience?.[0]?.company || rec.member.education?.[0]?.institution || '';
            return (
              <div key={rec.member.id} className="person-item">
                <img
                  src={rec.member.avatarUrl}
                  alt=""
                  className="person-avatar"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onViewProfile(rec.member.id)}
                />
                <div className="person-info">
                  <button
                    className="person-name"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, textAlign: 'left' }}
                    onClick={() => onViewProfile(rec.member.id)}
                    title={`View ${rec.member.fullName}'s profile`}
                  >
                    <span>{rec.member.fullName}</span>
                    {rec.member.isVerified && <CheckCircle2 size={13} fill="#0284C7" color="#fff" />}
                  </button>
                  {rec.member.headline && <div className="person-headline">{rec.member.headline}</div>}
                  {org && <div className="person-org">{org}</div>}
                  {why && <div className="person-reason">{why}</div>}
                </div>
                <button
                  className="btn-connect-sm"
                  onClick={() => onConnect(rec.member.id)}
                  title={`Send a connection request to ${rec.member.fullName}`}
                >
                  Connect
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* EORA — Your AI Guide */}
      <div className="eora-card">
        <div className="eora-header">
          <div className="eora-title">
            <Sparkles size={16} />
            <span>EORA — Your AI Guide</span>
          </div>
          <div className="eora-online-pill">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#15803D',
              }}
            />
            <span>Online</span>
          </div>
        </div>

        {/* Chat Stream Bubble */}
        <div className="eora-body-chat">
          <img
            src="/images/eora_avatar.jpg"
            alt="EORA Avatar"
            className="eora-avatar-img"
          />
          <div className="eora-chat-bubble">
            {eoraMessages[eoraMessages.length - 1]?.text}
          </div>
        </div>

        {/* Suggestion Chips */}
        <div className="eora-chips-column">
          <button
            className="eora-chip-btn"
            onClick={() => handleSendPrompt('Find collaborators for my project')}
          >
            Find collaborators for my project
          </button>
          <button
            className="eora-chip-btn"
            onClick={() => handleSendPrompt('Improve my GitHub profile')}
          >
            Improve my GitHub profile
          </button>
          <button
            className="eora-chip-btn"
            onClick={() => handleSendPrompt('Show me relevant internships')}
          >
            Show me relevant internships
          </button>
          <button
            className="eora-chip-btn"
            onClick={() => handleSendPrompt('Explain my roadmap')}
          >
            Explain my roadmap
          </button>
        </div>

        {/* Interactive Input Bar */}
        <div className="eora-input-bar">
          <input
            type="text"
            placeholder="Ask EORA anything..."
            value={eoraInput}
            onChange={(e) => setEoraInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendPrompt(eoraInput);
            }}
            disabled={loadingEora}
          />
          <button
            className="eora-send-btn"
            onClick={() => handleSendPrompt(eoraInput)}
            disabled={loadingEora}
            title="Ask EORA"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};
