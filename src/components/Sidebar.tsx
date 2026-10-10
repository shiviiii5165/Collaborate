'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Home,
  User,
  Compass,
  Users,
  MessageSquare,
  UsersRound,
  GitFork,
  Briefcase,
  Calendar,
  GraduationCap,
  Bookmark,
  BarChart2,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  currentUser: MemberProfile | null;
  unreadMessagesCount: number;
  onOpenAdmin: () => void;
}

interface NavItemConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  isComingSoon?: boolean;
  isAnalytics?: boolean;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'profile', label: 'My Profile', icon: User },
  { id: 'discover', label: 'Discover People', icon: Compass },
  { id: 'connections', label: 'Connections', icon: Users },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'communities', label: 'Communities', icon: UsersRound, isComingSoon: true },
  { id: 'teams', label: 'Project Teams', icon: GitFork, isComingSoon: true },
  { id: 'opportunities', label: 'Opportunities', icon: Briefcase, isComingSoon: true },
  { id: 'events', label: 'Events', icon: Calendar, isComingSoon: true },
  { id: 'mentors', label: 'Mentors', icon: GraduationCap, isComingSoon: true },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'analytics', label: 'Analytics', icon: BarChart2, isAnalytics: true },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onNavigate,
  currentUser,
  unreadMessagesCount,
  onOpenAdmin,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const [tooltipState, setTooltipState] = useState<{ label: string; top: number } | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string; icon: React.ComponentType<{ size?: number }> } | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Load persisted collapse preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('collaborate_sidebar_collapsed');
      if (saved === 'true') {
        setIsCollapsed(true);
      }
    } catch {}
  }, []);

  // Listen for Escape key on mobile drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMobileOpen) setIsMobileOpen(false);
        if (infoModal) setInfoModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, infoModal]);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('collaborate_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
    setTooltipState(null);
  };

  const handleTooltipShow = (e: React.MouseEvent | React.FocusEvent, label: string) => {
    if (!isCollapsed || isMobileOpen) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipState({
      label,
      top: rect.top + rect.height / 2,
    });
  };

  const handleTooltipHide = () => {
    setTooltipState(null);
  };

  const handleItemClick = async (item: NavItemConfig) => {
    if (item.isComingSoon) {
      setInfoModal({
        title: item.label,
        desc: `${item.label} will be activated in an upcoming release upon Core federation. Active beta modules currently include Home, My Profile, Discover People, Connections, Messages, Saved, and Analytics.`,
        icon: item.icon,
      });
      return;
    }

    if (item.isAnalytics) {
      if (!currentUser) {
        setInfoModal({
          title: 'Authentic Network Metrics',
          desc: 'Please sign in to view your authentic profile and network metrics.',
          icon: BarChart2,
        });
        return;
      }
      try {
        const res = await fetch(`/api/stats?userId=${currentUser.id}`);
        const data = await res.json();
        if (data.stats) {
          const s = data.stats;
          setInfoModal({
            title: 'Authentic Network Metrics',
            desc: `Measured Profile Metrics:
• Published Projects: ${s.publishedProjects}
• Listed Skills: ${s.listedSkills}
• Accepted Connections: ${s.connectionsCount}
• Daily Profile Views: ${s.dailyViewsUsed} used (${s.dailyViewsRemaining} remaining)
• Inbound Profile Views: ${s.totalReceivedViews} legitimate peer views recorded
• Membership Tier: ${s.plan === 'premium' ? 'Premium Unlimited' : 'Free Tier'}
• Verification Status: ${s.isVerified ? `Admin Verified (${s.verifiedCategory || 'Identity'})` : 'Standard Member'}

Privacy Safeguard: In accordance with student & member privacy protections, individual viewer identities are kept strictly anonymous.`,
            icon: BarChart2,
          });
          return;
        }
      } catch {}
      setInfoModal({
        title: 'Authentic Profile Analytics',
        desc: `Network Verified Metrics: ${currentUser.projects?.length || 0} projects published, ${currentUser.skills?.length || 0} skills listed. Tier: ${currentUser.plan === 'premium' ? 'Premium' : 'Free'}.`,
        icon: BarChart2,
      });
      return;
    }

    onNavigate(item.id);
    if (isMobileOpen) {
      setIsMobileOpen(false);
    }
  };

  const isItemActive = (item: NavItemConfig) => {
    if (item.isComingSoon || item.isAnalytics) return false;
    return currentTab === item.id;
  };

  return (
    <>
      {/* Mobile drawer trigger button (visible only on mobile screen widths) */}
      <button
        className="sidebar-mobile-trigger"
        onClick={() => setIsMobileOpen(true)}
        aria-label="Open navigation menu"
        title="Open navigation menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile drawer backdrop */}
      {isMobileOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Main Container */}
      <aside
        ref={sidebarRef}
        className={`left-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
        aria-label="Sidebar Navigation"
        aria-expanded={!isCollapsed}
      >
        {/* Brand Header */}
        <div className="sidebar-brand-header">
          <div
            className="sidebar-brand-interactive"
            onClick={() => onNavigate('home')}
            role="button"
            tabIndex={0}
            aria-label="Collaborate Home"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('home');
              }
            }}
          >
            {/* Outline diamond logo with inner diamond hole as in reference */}
            <div className="sidebar-brand-icon-wrap" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" />
                <path d="M12 7.5 L16.5 12 L12 16.5 L7.5 12 Z" />
              </svg>
            </div>
            {!isCollapsed && (
              <div className="sidebar-brand-text">
                <span className="sidebar-brand-title">Collaborate.</span>
                <span className="sidebar-brand-sub">by AI Tathastu</span>
              </div>
            )}
          </div>
          {isMobileOpen && (
            <button
              className="sidebar-mobile-close"
              onClick={() => setIsMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Divider below brand */}
        <div className="sidebar-divider" />

        {/* Main 12-Item Navigation List */}
        <nav className="sidebar-nav-list" aria-label="Main Navigation">
          {NAV_ITEMS.map((item) => {
            const IconComponent = item.icon;
            const active = isItemActive(item);
            const tooltipText = item.isComingSoon ? `${item.label} (Coming Soon)` : item.label;

            return (
              <button
                key={item.id}
                className={`sidebar-nav-btn ${active ? 'active' : ''} ${item.isComingSoon ? 'coming-soon' : ''}`}
                onClick={() => handleItemClick(item)}
                onMouseEnter={(e) => handleTooltipShow(e, tooltipText)}
                onMouseLeave={handleTooltipHide}
                onFocus={(e) => handleTooltipShow(e, tooltipText)}
                onBlur={handleTooltipHide}
                aria-label={tooltipText}
                aria-current={active ? 'page' : undefined}
              >
                <div className="sidebar-nav-icon-box">
                  <IconComponent size={18} />
                  {item.id === 'messages' && unreadMessagesCount > 0 && isCollapsed && (
                    <span className="sidebar-collapsed-dot" />
                  )}
                </div>

                {!isCollapsed && (
                  <span className="sidebar-nav-label">{item.label}</span>
                )}

                {!isCollapsed && item.id === 'messages' && unreadMessagesCount > 0 && (
                  <span className="sidebar-pill-badge">{unreadMessagesCount}</span>
                )}

                {!isCollapsed && item.isComingSoon && (
                  <span className="sidebar-soon-badge">Soon</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Divider above Switch To */}
        <div className="sidebar-divider" />

        {/* Ecosystem "Switch to" Section */}
        <div className="sidebar-ecosystem-section">
          {!isCollapsed && (
            <div className="sidebar-switch-label">Switch to</div>
          )}
          <a
            href="https://www.aitathastu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-eco-link"
            onMouseEnter={(e) => handleTooltipShow(e, 'Switch to AI Tathastu')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'Switch to AI Tathastu')}
            onBlur={handleTooltipHide}
            aria-label="Switch to AI Tathastu"
          >
            {isCollapsed ? (
              <span className="sidebar-eco-compact-initial">AT</span>
            ) : (
              <span className="sidebar-eco-text">AI Tathastu</span>
            )}
          </a>

          <a
            href="https://connect.aitathastu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-eco-link"
            onMouseEnter={(e) => handleTooltipShow(e, 'Switch to Tathastu Connect')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'Switch to Tathastu Connect')}
            onBlur={handleTooltipHide}
            aria-label="Switch to Tathastu Connect"
          >
            {isCollapsed ? (
              <span className="sidebar-eco-compact-initial">TC</span>
            ) : (
              <span className="sidebar-eco-text">Tathastu Connect</span>
            )}
          </a>
        </div>

        {/* Divider above Settings */}
        <div className="sidebar-divider" />

        {/* Bottom Section: Settings & Protected Admin Console */}
        <div className="sidebar-bottom-section">
          <button
            className={`sidebar-nav-btn ${currentTab === 'settings' ? 'active' : ''}`}
            onClick={() => {
              onNavigate('settings');
              if (isMobileOpen) setIsMobileOpen(false);
            }}
            onMouseEnter={(e) => handleTooltipShow(e, 'Settings')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, 'Settings')}
            onBlur={handleTooltipHide}
            aria-label="Settings"
          >
            <div className="sidebar-nav-icon-box">
              <Settings size={18} />
            </div>
            {!isCollapsed && <span className="sidebar-nav-label">Settings</span>}
          </button>

          {/* Admin Console: Rendered exclusively for authorized administrators */}
          {currentUser?.role === 'admin' && (
            <button
              className={`sidebar-nav-btn admin-btn ${currentTab === 'admin' ? 'active' : ''}`}
              onClick={() => {
                onOpenAdmin();
                if (isMobileOpen) setIsMobileOpen(false);
              }}
              onMouseEnter={(e) => handleTooltipShow(e, 'Admin Console')}
              onMouseLeave={handleTooltipHide}
              onFocus={(e) => handleTooltipShow(e, 'Admin Console')}
              onBlur={handleTooltipHide}
              aria-label="Admin Console"
            >
              <div className="sidebar-nav-icon-box">
                <ShieldCheck size={18} />
              </div>
              {!isCollapsed && (
                <span className="sidebar-nav-label">Admin Console</span>
              )}
            </button>
          )}

          {/* Expand/Collapse Toggle Button */}
          <button
            className="sidebar-toggle-btn"
            onClick={toggleCollapse}
            onMouseEnter={(e) => handleTooltipShow(e, isCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}
            onMouseLeave={handleTooltipHide}
            onFocus={(e) => handleTooltipShow(e, isCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}
            onBlur={handleTooltipHide}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <div className="sidebar-nav-icon-box">
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </div>
            {!isCollapsed && <span className="sidebar-toggle-text">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* High-Contrast Floating Tooltip in Collapsed Mode */}
      {isCollapsed && tooltipState && (
        <div
          className="sidebar-floating-tooltip"
          style={{
            position: 'fixed',
            left: 78,
            top: tooltipState.top,
            transform: 'translateY(-50%)',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
          role="tooltip"
        >
          {tooltipState.label}
        </div>
      )}

      {/* Info Modal for Coming Soon or Analytics */}
      {infoModal && (
        <div className="modal-overlay" onClick={() => setInfoModal(null)}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 440, padding: 0 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {infoModal.icon && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: '#E6F4F1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#053A3E',
                    }}
                  >
                    <infoModal.icon size={18} />
                  </div>
                )}
                <h3 className="modal-title" style={{ fontSize: '1rem', fontWeight: 800, color: '#032A2E' }}>
                  {infoModal.title}
                </h3>
              </div>
              <button
                onClick={() => setInfoModal(null)}
                style={{ color: '#94A3B8', border: 'none', background: 'transparent', cursor: 'pointer' }}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px', color: '#475569', fontSize: '0.86rem', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {infoModal.desc}
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                style={{ background: '#053A3E', borderColor: '#032A2E' }}
                onClick={() => setInfoModal(null)}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
