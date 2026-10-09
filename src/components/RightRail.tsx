'use client';

import React, { useState } from 'react';
import { Sparkles, Send, CheckCircle2, UserPlus, Check } from 'lucide-react';
import { RecommendationMatch, MemberProfile } from '@/lib/types';

interface RightRailProps {
  recommendations: RecommendationMatch[];
  currentUser: MemberProfile;
  onConnect: (memberId: string) => void;
  onViewProfile: (memberId: string) => void;
  onViewAllPeople: () => void;
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
        currentUser.fullName.split(' ')[0]
      }! 👋 Want help improving your profile, finding collaborators, or exploring opportunities today?`,
      isUser: false,
      timestamp: 'just now',
    },
  ]);
  const [loadingEora, setLoadingEora] = useState(false);

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
        body: JSON.stringify({ prompt: userMsg, userId: currentUser.id }),
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
          {recommendations.slice(0, 3).map((rec) => (
            <div key={rec.member.id} className="person-item">
              <img
                src={rec.member.avatarUrl}
                alt={rec.member.fullName}
                className="person-avatar"
                style={{ cursor: 'pointer' }}
                onClick={() => onViewProfile(rec.member.id)}
              />
              <div className="person-info">
                <div
                  className="person-name"
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => onViewProfile(rec.member.id)}
                >
                  <span>{rec.member.fullName}</span>
                  {rec.member.isVerified && (
                    <CheckCircle2 size={13} fill="#0284C7" color="#fff" />
                  )}
                </div>
                <div className="person-headline">{rec.member.headline}</div>
                <div className="person-mutuals">
                  {rec.mutualCount > 0 ? `${rec.mutualCount} mutual connections` : 'Verified Peer'}
                </div>
              </div>
              <button
                className="btn-connect-sm"
                onClick={() => onConnect(rec.member.id)}
                title="Send Connection Request"
              >
                Connect
              </button>
            </div>
          ))}
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
