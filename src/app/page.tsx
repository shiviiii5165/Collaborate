'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { RightRail } from '@/components/RightRail';
import { ProfileView } from '@/components/ProfileView';
import { PeopleDiscoverView } from '@/components/PeopleDiscoverView';
import { ConnectionsView } from '@/components/ConnectionsView';
import { MessagesView } from '@/components/MessagesView';
import { AdminConsoleView } from '@/components/AdminConsoleView';
import { TathastuFederationModal } from '@/components/TathastuFederationModal';
import { QuotaPaywallModal } from '@/components/QuotaPaywallModal';
import { ProfileEditModal } from '@/components/ProfileEditModal';
import { AuthModal } from '@/components/AuthModal';
import { MemberProfile, RecommendationMatch } from '@/lib/types';
import { Sparkles, ShieldCheck, ArrowLeft, Bookmark, Bell, Check, LogIn } from 'lucide-react';

export default function CollaborateApp() {
  const [currentUser, setCurrentUser] = useState<MemberProfile | null>(null);
  const [viewingTargetUser, setViewingTargetUser] = useState<MemberProfile | null>(null);
  const [targetConnectionStatus, setTargetConnectionStatus] = useState<string>('not_connected');
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [quotaRemaining, setQuotaRemaining] = useState<number>(3);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [recommendations, setRecommendations] = useState<RecommendationMatch[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Modals state
  const [isFederationOpen, setIsFederationOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  // Active message recipient for direct link
  const [activeChatRecipientId, setActiveChatRecipientId] = useState<string | undefined>(undefined);

  // 1. Initial Load: Fetch current user profile & notifications
  const fetchCurrentUserData = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.member) {
        setCurrentUser(data.member);
      }
    } catch (err) {
      console.error('Failed to load current user', err);
    }
  };

  const fetchDiscoverData = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(
        `/api/discover?viewerId=${currentUser.id}&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();
      if (data.recommendations) setRecommendations(data.recommendations);
      if (data.results) setSearchResults(data.results);
    } catch (err) {
      console.error('Failed to load discover data', err);
    }
  };

  const fetchUnreadCount = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/messages?userId=${currentUser.id}`);
      const data = await res.json();
      if (data.conversations) {
        const totalUnread = data.conversations.reduce(
          (acc: number, c: any) => acc + (c.unreadCount || 0),
          0
        );
        setUnreadMessagesCount(totalUnread);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchNotifications = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/notifications?userId=${currentUser.id}`);
      const data = await res.json();
      if (data.notifications) {
        setNotificationsList(data.notifications);
        setUnreadNotificationsCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCurrentUserData();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchDiscoverData();
      fetchUnreadCount();
      fetchNotifications();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser) {
      fetchDiscoverData();
    }
  }, [searchQuery]);

  // Handle viewing another member's full profile (enforcing daily 3-view quota)
  const handleViewProfile = async (targetId: string) => {
    if (!currentUser) return;
    if (targetId === currentUser.id) {
      setViewingTargetUser(null);
      setCurrentTab('profile');
      return;
    }

    try {
      const res = await fetch(`/api/profiles?id=${targetId}&viewerId=${currentUser.id}`);
      const data = await res.json();

      if (res.status === 402 || data.error === 'QUOTA_EXCEEDED') {
        setQuotaRemaining(0);
        setIsUpgradeOpen(true);
        return;
      }

      if (data.member) {
        setViewingTargetUser(data.member);
        setTargetConnectionStatus(data.connectionStatus || 'not_connected');
        if (data.quota) {
          setQuotaRemaining(data.quota.remaining);
        }
        setCurrentTab('view_member');
      }
    } catch (err) {
      console.error('Error fetching member profile', err);
    }
  };

  // Handle sending connection request
  const handleSendConnection = async (toId: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_request',
          fromId: currentUser.id,
          toId,
          introMessage: 'Hi, I would love to connect and explore collaboration on AI projects!',
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Connection request sent with professional introduction note!');
        setTargetConnectionStatus('request_sent');
        fetchDiscoverData();
        fetchNotifications();
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenChatWith = (recipientId: string) => {
    setActiveChatRecipientId(recipientId);
    setCurrentTab('messages');
  };

  if (!currentUser) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#4F46E5', marginBottom: 8 }}>
            Collaborate<span style={{ color: '#0F172A' }}>.</span>
          </div>
          <div style={{ color: '#64748B', fontSize: '0.88rem' }}>
            Initializing secure identity session...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <Header
        currentTab={currentTab}
        onNavigate={(tab) => {
          setViewingTargetUser(null);
          setCurrentTab(tab);
        }}
        currentUser={currentUser}
        quotaRemaining={quotaRemaining}
        unreadMessagesCount={unreadMessagesCount}
        unreadNotificationsCount={unreadNotificationsCount}
        onOpenUpgradeModal={() => setIsUpgradeOpen(true)}
        onOpenFederationModal={() => setIsFederationOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main 3-Column Layout Grid */}
      <div className="main-layout">
        {/* Left Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onNavigate={(tab) => {
            setViewingTargetUser(null);
            setCurrentTab(tab);
          }}
          currentUser={currentUser}
          unreadMessagesCount={unreadMessagesCount}
          onOpenAdmin={() => setCurrentTab('admin')}
        />

        {/* Center Content Area */}
        <main className="center-content">
          {/* Identity & Session Banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '10px 18px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: currentUser.role === 'admin' ? '#F59E0B' : '#10B981',
                }}
              />
              <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                Active Identity: <strong>{currentUser.fullName}</strong> ({currentUser.email})
                {currentUser.role === 'admin' && ' • [ADMIN]'}
              </span>
            </div>

            <button
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '5px 12px' }}
              onClick={() => setIsAuthOpen(true)}
            >
              <LogIn size={13} />
              <span>Switch Account / SSO</span>
            </button>
          </div>

          {/* View Tab: Home or My Profile */}
          {(currentTab === 'home' || currentTab === 'profile') && (
            <ProfileView
              member={currentUser}
              isSelf={true}
              onEditProfile={() => setIsEditProfileOpen(true)}
              onOpenFederationSync={() => setIsFederationOpen(true)}
            />
          )}

          {/* View Tab: Another Member's Profile */}
          {currentTab === 'view_member' && viewingTargetUser && (
            <div>
              <button
                className="btn-secondary"
                style={{ marginBottom: 14, fontSize: '0.8rem' }}
                onClick={() => setCurrentTab('discover')}
              >
                <ArrowLeft size={14} /> Back to Discover
              </button>

              <ProfileView
                member={viewingTargetUser}
                isSelf={false}
                connectionStatus={targetConnectionStatus}
                onConnect={() => handleSendConnection(viewingTargetUser.id)}
                onMessage={() => {
                  if (targetConnectionStatus === 'accepted') {
                    handleOpenChatWith(viewingTargetUser.id);
                  } else {
                    alert('Direct messages are permitted only between accepted connections.');
                  }
                }}
              />
            </div>
          )}

          {/* View Tab: Discover People */}
          {currentTab === 'discover' && (
            <PeopleDiscoverView
              recommendations={recommendations}
              searchResults={searchResults}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onViewProfile={handleViewProfile}
              onConnect={handleSendConnection}
              quotaRemaining={quotaRemaining}
              userPlan={currentUser.plan}
              onOpenUpgradeModal={() => setIsUpgradeOpen(true)}
            />
          )}

          {/* View Tab: Connections */}
          {currentTab === 'connections' && (
            <ConnectionsView
              currentUser={currentUser}
              onOpenChatWith={handleOpenChatWith}
              onViewProfile={handleViewProfile}
            />
          )}

          {/* View Tab: Messages */}
          {currentTab === 'messages' && (
            <MessagesView
              currentUser={currentUser}
              initialRecipientId={activeChatRecipientId}
            />
          )}

          {/* View Tab: Admin Console */}
          {currentTab === 'admin' && <AdminConsoleView />}

          {/* View Tab: Notifications */}
          {currentTab === 'notifications' && (
            <div className="info-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Bell size={20} color="#4F46E5" />
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Notifications</h2>
              </div>
              {notificationsList.length === 0 ? (
                <div style={{ color: '#94A3B8', fontSize: '0.86rem' }}>No notifications right now.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {notificationsList.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        padding: '12px 16px',
                        background: n.isRead ? '#F8FAFC' : '#EEF2FF',
                        borderRadius: 10,
                        border: '1px solid',
                        borderColor: n.isRead ? '#E2E8F0' : '#C7D2FE',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: 2 }}>
                          {n.body}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 4 }}>
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {!n.isRead && (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '0.74rem', padding: '4px 10px' }}
                          onClick={async () => {
                            await fetch('/api/notifications', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ notifId: n.id }),
                            });
                            fetchNotifications();
                          }}
                        >
                          <Check size={12} /> Mark Read
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View Tab: Saved */}
          {currentTab === 'saved' && (
            <div className="info-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Bookmark size={20} color="#4F46E5" />
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Saved Profiles & Projects</h2>
              </div>
              <p style={{ color: '#64748B', fontSize: '0.86rem' }}>
                You have bookmarked 2 projects: <strong>MedVision-ViT</strong> (by Priya Mehta) and{' '}
                <strong>TorchDist-Optimizer</strong> (by Aman Verma).
              </p>
            </div>
          )}

          {/* View Tab: Settings */}
          {currentTab === 'settings' && (
            <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Account & Privacy Settings</h2>
              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 12 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                  Profile Discoverability
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: 12 }}>
                  Control whether your profile is discoverable in the Collaborate directory.
                </div>
                <button className="btn-secondary" onClick={() => setIsEditProfileOpen(true)}>
                  Configure Privacy & Visibility
                </button>
              </div>

              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 12 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                  AI Tathastu Federation
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: 12 }}>
                  Status: {currentUser.isLinkedWithTathastu ? 'Linked & Synced' : 'Unlinked'}
                </div>
                <button className="btn-primary" onClick={() => setIsFederationOpen(true)}>
                  Manage Tathastu Federation Link
                </button>
              </div>

              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 12 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                  Request Verified Badge
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: 12 }}>
                  Verified badges are non-paid and issued upon administrative review of credentials.
                </div>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const evidence = prompt(
                      'Enter evidence summary for verification review (e.g. Student ID number or Institutional email):',
                      'LPU Registration ID: 12109923'
                    );
                    if (evidence) {
                      const res = await fetch('/api/verification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'submit_request',
                          memberId: currentUser.id,
                          category: 'institution',
                          evidenceSummary: evidence,
                        }),
                      });
                      const d = await res.json();
                      if (d.success) {
                        alert('Verification request submitted for admin review!');
                        fetchNotifications();
                      }
                    }
                  }}
                >
                  <ShieldCheck size={16} />
                  <span>Submit Verification Request</span>
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Right Rail: People You May Know & EORA AI Guide */}
        <RightRail
          recommendations={recommendations}
          currentUser={currentUser}
          onConnect={handleSendConnection}
          onViewProfile={handleViewProfile}
          onViewAllPeople={() => {
            setViewingTargetUser(null);
            setCurrentTab('discover');
          }}
        />
      </div>

      {/* Modals */}
      <TathastuFederationModal
        isOpen={isFederationOpen}
        onClose={() => setIsFederationOpen(false)}
        currentUser={currentUser}
        onSyncComplete={fetchCurrentUserData}
      />

      <QuotaPaywallModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        currentUser={currentUser}
        onUpgradeSuccess={fetchCurrentUserData}
      />

      <ProfileEditModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        currentUser={currentUser}
        onSaveSuccess={(updated) => setCurrentUser(updated)}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(newMember) => {
          setCurrentUser(newMember);
          setViewingTargetUser(null);
          setCurrentTab('home');
        }}
      />
    </div>
  );
}
