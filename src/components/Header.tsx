'use client';

import React from 'react';
import {
  Search,
  Home,
  Users,
  MessageSquare,
  Bell,
  ShieldCheck,
  Sparkles,
  LogIn,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface HeaderProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  currentUser: MemberProfile | null;
  quotaRemaining: number;
  unreadMessagesCount: number;
  unreadNotificationsCount?: number;
  onOpenUpgradeModal: () => void;
  onOpenFederationModal: () => void;
  /** Opens sign-in / switch account / SSO. */
  onOpenAuth?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  quotaRemaining,
  unreadMessagesCount,
  unreadNotificationsCount,
  onOpenUpgradeModal,
  onOpenFederationModal,
  onOpenAuth,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <header className="top-navbar">
      {/* Brand logo & tagline */}
      <div className="nav-left">
        <div
          className="brand-badge"
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          aria-label="Collaborate home"
          onClick={() => onNavigate('home')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onNavigate('home');
            }
          }}
        >
          <div className="brand-title">
            Collaborate<span className="dot">.</span>
          </div>
          <div className="brand-sub">by AI Tathastu</div>
        </div>
      </div>

      {/* Center Search Bar */}
      <div className="nav-center">
        <div className="search-bar-wrapper">
          <Search size={18} color="#94A3B8" />
          <input
            type="text"
            className="search-input"
            placeholder="Search people, skills, projects, research, opportunities..."
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              if (currentTab !== 'discover') {
                onNavigate('discover');
              }
            }}
          />
        </div>
      </div>

      {/* Right Actions */}
      <div className="nav-right">
        {currentUser ? (
          <>
            {/* Free Plan Quota Pill */}
            {currentUser.plan === 'free' ? (
              <button
                className="quota-banner-btn"
                style={{
                  background: '#EEF2FF',
                  border: '1px solid #C7D2FE',
                  color: '#4F46E5',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={onOpenUpgradeModal}
                title="Free tier daily full-profile views quota"
              >
                <Sparkles size={14} />
                <span className="quota-text-long">{quotaRemaining}/3 views left today</span>
                <span className="quota-text-short">{quotaRemaining}/3</span>
              </button>
            ) : (
              <span className="premium-badge-tag">PREMIUM UNLIMITED</span>
            )}

            {/* Quick Tathastu Sync Indicator */}
            <button
              className="nav-icon-btn"
              onClick={onOpenFederationModal}
              title={
                currentUser.isLinkedWithTathastu
                  ? `AI Tathastu profile data shared • Sign-in ${currentUser.tathastu_user_id ? 'linked' : 'not linked'}`
                  : 'Share profile data from AI Tathastu'
              }
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: currentUser.isLinkedWithTathastu ? '#10B981' : '#F59E0B',
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                }}
              />
              <Sparkles size={20} />
            </button>
          </>
        ) : (
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '20px',
              background: '#F1F5F9',
              color: '#64748B',
            }}
          >
            Guest Preview
          </span>
        )}

        {/* Home */}
        <button
          className={`nav-icon-btn nav-home-btn ${currentTab === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate('home')}
          title="Home"
        >
          <Home size={20} />
        </button>

        {/* Connections */}
        <button
          className={`nav-icon-btn ${currentTab === 'connections' ? 'active' : ''}`}
          onClick={() => onNavigate('connections')}
          title="Connections"
        >
          <Users size={20} />
        </button>

        {/* Messages */}
        <button
          className={`nav-icon-btn ${currentTab === 'messages' ? 'active' : ''}`}
          onClick={() => onNavigate('messages')}
          title="Messages"
        >
          {unreadMessagesCount > 0 && (
            <span className="nav-badge-pill">{unreadMessagesCount}</span>
          )}
          <MessageSquare size={20} />
        </button>

        {/* Notifications */}
        <button className="nav-icon-btn" title="Notifications" onClick={() => onNavigate('notifications')}>
          {unreadNotificationsCount !== undefined && unreadNotificationsCount > 0 && (
            <span className="nav-badge-pill">{unreadNotificationsCount}</span>
          )}
          <Bell size={20} />
        </button>

        {/* Switch account / SSO (moved here from the removed identity banner) */}
        {currentUser && onOpenAuth && (
          <button className="nav-icon-btn" title="Switch account / SSO" aria-label="Switch account or sign in with SSO" onClick={onOpenAuth}>
            <LogIn size={20} />
          </button>
        )}

        {/* User Avatar */}
        {currentUser ? (
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.fullName}
            className="user-nav-avatar"
            onClick={() => onNavigate('profile')}
            title={`Signed in as ${currentUser.fullName}`}
          />
        ) : (
          <div
            className="user-nav-avatar"
            style={{
              background: '#E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748B',
            }}
            onClick={() => onNavigate('profile')}
            title="Sign In"
          >
            <Users size={18} />
          </div>
        )}
      </div>
    </header>
  );
};
