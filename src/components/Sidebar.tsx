'use client';

import React from 'react';
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
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  currentUser: MemberProfile;
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
        >
          <div className="left-grp">
            <Users size={18} />
            <span>Connections</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Communities feature is curated by verified institutions.')}
        >
          <div className="left-grp">
            <Users size={18} />
            <span>Communities</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Project Teams: Collaborate with peers on approved repositories.')}
        >
          <div className="left-grp">
            <FolderGit2 size={18} />
            <span>Project Teams</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Opportunities: Academic and open research tracks.')}
        >
          <div className="left-grp">
            <Briefcase size={18} />
            <span>Opportunities</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Upcoming Tathastu Tech Webinars and AI Hackathons.')}
        >
          <div className="left-grp">
            <Calendar size={18} />
            <span>Events</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Mentors: Verified industry experts available for code review.')}
        >
          <div className="left-grp">
            <GraduationCap size={18} />
            <span>Mentors</span>
          </div>
        </button>

        <button
          className={`nav-link-btn ${currentTab === 'saved' ? 'active' : ''}`}
          onClick={() => onNavigate('saved')}
        >
          <div className="left-grp">
            <Bookmark size={18} />
            <span>Saved</span>
          </div>
        </button>

        <button
          className="nav-link-btn"
          onClick={() => alert('Profile Analytics: 124 searches appeared in, 48 profile clicks.')}
        >
          <div className="left-grp">
            <BarChart2 size={18} />
            <span>Analytics</span>
          </div>
        </button>
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
    </aside>
  );
};
