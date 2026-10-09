'use client';

import React, { useState } from 'react';
import {
  Search,
  Sparkles,
  MapPin,
  CheckCircle2,
  UserPlus,
  Check,
  Filter,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { MemberProfile, RecommendationMatch } from '@/lib/types';

interface PeopleDiscoverViewProps {
  recommendations: RecommendationMatch[];
  searchResults: any[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onViewProfile: (memberId: string) => void;
  onConnect: (memberId: string) => void;
  quotaRemaining: number;
  userPlan: string;
  onOpenUpgradeModal: () => void;
}

export const PeopleDiscoverView: React.FC<PeopleDiscoverViewProps> = ({
  recommendations,
  searchResults,
  searchQuery,
  onSearchChange,
  onViewProfile,
  onConnect,
  quotaRemaining,
  userPlan,
  onOpenUpgradeModal,
}) => {
  const [selectedSpecialization, setSelectedSpecialization] = useState<string>('all');
  const [selectedSkill, setSelectedSkill] = useState<string>('all');

  const specializations = [
    'all',
    'Generative AI',
    'Computer Vision',
    'Distributed ML Systems',
    'Retrieval-Augmented Generation',
  ];

  const filteredResults = searchResults.filter((m) => {
    if (
      selectedSpecialization !== 'all' &&
      !m.aiSpecializations.some((s: string) =>
        s.toLowerCase().includes(selectedSpecialization.toLowerCase())
      )
    ) {
      return false;
    }
    if (
      selectedSkill !== 'all' &&
      !m.skills.some((s: string) => s.toLowerCase() === selectedSkill.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Search Header Banner */}
      <div className="info-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0F172A' }}>
              Discover People & Potential Collaborators
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#64748B', marginTop: 4 }}>
              Find peers by verified skills, research focus, AI specializations, and shared project goals.
            </p>
          </div>

          {userPlan === 'free' ? (
            <div
              style={{
                background: '#EEF2FF',
                border: '1px solid #C7D2FE',
                borderRadius: '12px',
                padding: '8px 16px',
                textAlign: 'right',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: '#4F46E5', fontWeight: 700 }}>
                Daily Quota: {quotaRemaining}/3 Profiles
              </div>
              <div
                style={{ fontSize: '0.7rem', color: '#6D28D9', cursor: 'pointer', marginTop: 2 }}
                onClick={onOpenUpgradeModal}
              >
                Upgrade to Premium for Unlimited →
              </div>
            </div>
          ) : (
            <div className="premium-badge-tag" style={{ padding: '6px 14px' }}>
              Unlimited Full-Profile Access Active
            </div>
          )}
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#475569',
              marginRight: 6,
            }}
          >
            <SlidersHorizontal size={14} /> Filter Specialization:
          </span>
          {specializations.map((spec) => (
            <button
              key={spec}
              onClick={() => setSelectedSpecialization(spec)}
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                padding: '5px 14px',
                borderRadius: '9999px',
                background: selectedSpecialization === spec ? '#4F46E5' : '#F1F5F9',
                color: selectedSpecialization === spec ? '#FFFFFF' : '#475569',
                border: '1px solid',
                borderColor: selectedSpecialization === spec ? '#4F46E5' : '#E2E8F0',
              }}
            >
              {spec === 'all' ? 'All Domains' : spec}
            </button>
          ))}
        </div>
      </div>

      {/* AI Recommendations with Explainability Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="#7C3AED" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1E1B4B' }}>
            Recommended For You (Transparent AI Matching)
          </h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {recommendations.map((rec) => (
            <div
              key={rec.member.id}
              className="info-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid #E0E7FF',
              }}
            >
              <div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <img
                    src={rec.member.avatarUrl}
                    alt={rec.member.fullName}
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 14,
                      objectFit: 'cover',
                      cursor: 'pointer',
                    }}
                    onClick={() => onViewProfile(rec.member.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 800,
                        fontSize: '0.96rem',
                        cursor: 'pointer',
                      }}
                      onClick={() => onViewProfile(rec.member.id)}
                    >
                      <span>{rec.member.fullName}</span>
                      {rec.member.isVerified && (
                        <CheckCircle2 size={16} fill="#0284C7" color="#fff" />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: '#64748B',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {rec.member.headline}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>
                      <MapPin size={11} style={{ display: 'inline', marginRight: 2 }} />
                      {rec.member.location}
                    </div>
                  </div>
                </div>

                {/* Real explainability note */}
                <div
                  style={{
                    background: '#F5F3FF',
                    borderLeft: '3px solid #7C3AED',
                    padding: '8px 12px',
                    borderRadius: '0 8px 8px 0',
                    fontSize: '0.78rem',
                    color: '#4C1D95',
                    marginTop: 12,
                    lineHeight: 1.4,
                  }}
                >
                  💡 <strong>Why recommended:</strong> {rec.reason}
                </div>

                {/* Skills tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {rec.member.skills.slice(0, 4).map((s, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: '0.72rem',
                        background: '#EEF2FF',
                        color: '#3730A3',
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontWeight: 600,
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 16,
                  borderTop: '1px solid #F1F5F9',
                  paddingTop: 12,
                }}
              >
                <button
                  className="btn-secondary"
                  style={{ flex: 1, padding: '7px 12px', fontSize: '0.8rem', justifyContent: 'center' }}
                  onClick={() => onViewProfile(rec.member.id)}
                >
                  <Eye size={14} />
                  <span>View Full Profile</span>
                </button>
                <button
                  className="btn-primary"
                  style={{ padding: '7px 16px', fontSize: '0.8rem' }}
                  onClick={() => onConnect(rec.member.id)}
                >
                  <UserPlus size={14} />
                  <span>Connect</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Directory Search Results */}
      <div>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1E1B4B', marginBottom: 12 }}>
          All Members Directory ({filteredResults.length})
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredResults.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                background: '#FFFFFF',
                borderRadius: '16px',
                border: '1px solid #E2E8F0',
                color: '#64748B',
              }}
            >
              <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>🔍</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1E293B', marginBottom: '4px' }}>
                No Registered Members Found
              </div>
              <div style={{ fontSize: '0.86rem' }}>
                No members matched your search or domain criteria. Clear filters or invite collaborators to join.
              </div>
            </div>
          ) : (
            filteredResults.map((m) => (
              <div
                key={m.id}
                className="info-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                  onClick={() => onViewProfile(m.id)}
                >
                  <img
                    src={m.avatarUrl}
                    alt={m.fullName}
                    style={{ width: 50, height: 50, borderRadius: 14, objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.98rem', fontWeight: 800 }}>{m.fullName}</span>
                      {m.isVerified && (
                        <CheckCircle2 size={16} fill="#0284C7" color="#fff" />
                      )}
                      {m.plan === 'premium' && (
                        <span className="premium-badge-tag">Premium</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748B' }}>{m.headline}</div>
                    <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginTop: 2 }}>
                      📍 {m.location} • {m.education[0]?.institution || 'AI Tathastu Network'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '7px 14px' }}
                    onClick={() => onViewProfile(m.id)}
                  >
                    <Eye size={14} />
                    <span>View Profile</span>
                  </button>
                  {m.connectionStatus === 'accepted' ? (
                    <button className="btn-secondary" disabled style={{ color: '#10B981' }}>
                      <Check size={14} /> Connected
                    </button>
                  ) : m.connectionStatus === 'request_sent' ? (
                    <button className="btn-secondary" disabled style={{ opacity: 0.6 }}>
                      Pending
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      style={{ fontSize: '0.8rem', padding: '7px 16px' }}
                      onClick={() => onConnect(m.id)}
                    >
                      <UserPlus size={14} />
                      <span>Connect</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
