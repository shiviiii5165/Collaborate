'use client';

import React, { useState } from 'react';
import {
  Home,
  User,
  Compass,
  MessageSquare,
  Users,
  FolderGit2,
  Briefcase,
  Calendar,
  GraduationCap,
  Bookmark,
  BarChart2,
  Settings,
  ExternalLink,
  ShieldCheck,
  Video,
  X,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  currentUser: MemberProfile | null;
  unreadMessagesCount: number;
  onOpenAdmin: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  unreadMessagesCount,
  onOpenAdmin,
}) => {
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string; icon: any } | null>(null);

  return (
    <aside className="left-sidebar">
      {/* Primary Navigation Menu */}
      <div className="nav-menu-card">
        <button
          className={`nav-link-btn ${currentTab === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate('home')}
        >
          <div className="left-grp">
            <Home size={18} />
            <span>Home</span>
          </div>
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'profile' ? 'active' : ''}`}
          onClick={() => onNavigate('profile')}
        >
          <div className="left-grp">
            <User size={18} />
            <span>My Profile</span>
          </div>
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'discover' ? 'active' : ''}`}
          onClick={() => onNavigate('discover')}
        >
          <div className="left-grp">
            <Compass size={18} />
            <span>Discover People</span>
          </div>
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'messages' ? 'active' : ''}`}
          onClick={() => onNavigate('messages')}
        >
          <div className="left-grp">
            <MessageSquare size={18} />
            <span>Messages</span>
          </div>
          {unreadMessagesCount > 0 && (
            <span className="nav-counter-pill">{unreadMessagesCount}</span>
          )}
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'connections' ? 'active' : ''}`}
          onClick={() => onNavigate('connections')}
          aria-label="Connections"
        >
          <div className="left-grp">
            <Users size={18} />
            <span>Connections</span>
          </div>
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'saved' ? 'active' : ''}`}
          onClick={() => onNavigate('saved')}
          aria-label="Saved items"
        >
          <div className="left-grp">
            <Bookmark size={18} />
            <span>Saved</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          aria-label="View authentic profile analytics"
          onClick={() =>
            setInfoModal({
              title: 'Authentic Profile Analytics',
              desc: `Network Verified Metrics: ${currentUser?.metrics?.projects || 0} projects published, ${currentUser?.metrics?.skills || 0} skills listed, ${currentUser?.statusBadges?.length || 0} status badges. Account tier: ${currentUser?.plan === 'premium' ? 'Premium Unlimited' : 'Free Tier (3 daily profile views)'}. Verification status: ${currentUser?.isVerified ? 'Admin Verified' : 'Standard Member'}.`,
              icon: BarChart2,
            })
          }
        >
          <div className="left-grp">
            <BarChart2 size={18} />
            <span>Profile Stats</span>
          </div>
        </button>
      </div>

      {/* Beta Scope Notice */}
      <div
        style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 14,
          fontSize: '0.78rem',
          color: '#64748B',
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 700, color: '#334155' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
          Independent Beta Scope
        </div>
        Active modules: Profiles, People Discovery, Mutual Connections, Direct Messaging & Settings. Communities & Teams activate upon Core federation.
      </div>

      {/* Switch to Ecosystem Card */}
      <div className="ecosystem-card">
        <div className="ecosystem-header">Switch to</div>
        <a
          href="https://www.aitathastu.com"
          target="_blank"
          rel="noopener noreferrer"
          className="eco-switch-btn"
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '6px',
              background: '#4F46E5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 800,
            }}
          >
            T
          </div>
          <span style={{ flex: 1 }}>AI Tathastu</span>
          <ExternalLink size={14} color="#94A3B8" />
        </a>

        <a
          href="https://connect.aitathastu.com"
          target="_blank"
          rel="noopener noreferrer"
          className="eco-switch-btn"
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '6px',
              background: '#0284C7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Video size={12} />
          </div>
          <span style={{ flex: 1 }}>Tathastu Connect</span>
          <ExternalLink size={14} color="#94A3B8" />
        </a>

        {/* Admin Console Switch */}
        <button
          className="eco-switch-btn"
          style={{
            marginTop: '4px',
            background: currentTab === 'admin' ? '#EEF2FF' : '#F8FAFC',
            borderColor: currentTab === 'admin' ? '#C7D2FE' : '#E2E8F0',
            color: '#4F46E5',
          }}
          onClick={onOpenAdmin}
        >
          <ShieldCheck size={16} />
          <span style={{ flex: 1 }}>Admin Console</span>
        </button>

        <button
          className={`eco-switch-btn ${currentTab === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>

      {infoModal && (
        <div className="modal-overlay" onClick={() => setInfoModal(null)}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 440, padding: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {infoModal.icon && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: '#EEF2FF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#4F46E5',
                    }}
                  >
                    <infoModal.icon size={18} />
                  </div>
                )}
                <h3 className="modal-title" style={{ fontSize: '1rem', fontWeight: 800 }}>
                  {infoModal.title}
                </h3>
              </div>
              <button
                onClick={() => setInfoModal(null)}
                style={{ color: '#94A3B8', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px', color: '#475569', fontSize: '0.86rem', lineHeight: 1.5 }}>
              {infoModal.desc}
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={() => setInfoModal(null)}>
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
