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
import { SettingsView } from '@/components/SettingsView';
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
  const [savedMembersList, setSavedMembersList] = useState<MemberProfile[]>([]);

  // Modals state
  const [isFederationOpen, setIsFederationOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  // Active message recipient for direct link
  const [activeChatRecipientId, setActiveChatRecipientId] = useState<string | undefined>(undefined);

  const fetchSavedMembers = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/saved?userId=${currentUser.id}`);
      const data = await res.json();
      if (data.savedMembers) {
        setSavedMembersList(data.savedMembers);
      }
    } catch (err) {
      console.error(err);
    }
  };

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
      fetchSavedMembers();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser && currentTab === 'saved') {
      fetchSavedMembers();
    }
  }, [currentTab, currentUser]);

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
            {currentUser ? (
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
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#94A3B8' }} />
                <span style={{ fontSize: '0.82rem', color: '#64748B' }}>
                  Guest Explorer • Please sign in or register to connect & collaborate
                </span>
              </div>
            )}

            <button
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '5px 12px' }}
              onClick={() => setIsAuthOpen(true)}
            >
              <LogIn size={13} />
              <span>{currentUser ? 'Switch Account / SSO' : 'Sign In / Register'}</span>
            </button>
          </div>

          {/* View Tab: Home or My Profile */}
          {(currentTab === 'home' || currentTab === 'profile') && (
            currentUser ? (
              <ProfileView
                member={currentUser}
                isSelf={true}
                onEditProfile={() => setIsEditProfileOpen(true)}
                onOpenFederationSync={() => setIsFederationOpen(true)}
              />
            ) : (
              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: 16,
                  padding: 40,
                  textAlign: 'center',
                  border: '1px solid #E2E8F0',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'rgba(99, 102, 241, 0.1)',
                    color: '#6366F1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                  }}
                >
                  <Sparkles size={32} />
                </div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8, color: '#0F172A' }}>
                  Welcome to Collaborate.
                </h2>
                <p style={{ color: '#64748B', maxWidth: 460, margin: '0 auto 24px', fontSize: '0.92rem' }}>
                  Independent Professional Networking by AI Tathastu. Connect with verified builders, researchers, and engineers.
                </p>
                <button
                  className="btn-primary"
                  style={{ padding: '10px 24px', fontSize: '0.9rem' }}
                  onClick={() => setIsAuthOpen(true)}
                >
                  Sign In with AI Tathastu Single Sign-On
                </button>
              </div>
            )
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: '#EEF2FF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#4F46E5',
                    }}
                  >
                    <Bookmark size={20} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                      Saved Profiles & Peers ({savedMembersList.length})
                    </h2>
                    <p style={{ color: '#64748B', fontSize: '0.82rem', margin: '3px 0 0' }}>
                      Persistent bookmarks of verified builders, researchers, and potential collaborators.
                    </p>
                  </div>
                </div>
              </div>

              {savedMembersList.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    background: '#F8FAFC',
                    borderRadius: 14,
                    border: '1px dashed #CBD5E1',
                    color: '#64748B',
                  }}
                >
                  <Bookmark size={36} color="#94A3B8" style={{ margin: '0 auto 12px', display: 'block' }} />
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#334155', marginBottom: 6 }}>
                    No Saved Profiles Yet
                  </div>
                  <p style={{ maxWidth: 440, margin: '0 auto 18px', fontSize: '0.86rem', lineHeight: 1.5 }}>
                    When you find peers with relevant skills or complementary research interests in Discover People, bookmark them to quickly revisit their profiles here.
                  </p>
                  <button className="btn-primary" onClick={() => setCurrentTab('discover')}>
                    Browse People Directory
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {savedMembersList.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        padding: '16px 20px',
                        background: '#FFFFFF',
                        borderRadius: 14,
                        border: '1px solid #E2E8F0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                        <img
                          src={m.avatarUrl}
                          alt={m.fullName}
                          style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0F172A' }}>
                              {m.fullName}
                            </span>
                            {m.isVerified && (
                              <span style={{ fontSize: '0.72rem', color: '#0284C7', fontWeight: 700 }}>
                                ✓ Verified
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              color: '#64748B',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: 2,
                            }}
                          >
                            {m.headline}
                          </div>
                          {m.skills && m.skills.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              {m.skills.slice(0, 3).map((sk, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '0.7rem',
                                    background: '#F1F5F9',
                                    color: '#475569',
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                  }}
                                >
                                  {sk}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                          onClick={() => handleViewProfile(m.id)}
                        >
                          View Profile
                        </button>
                        <button
                          className="btn-secondary"
                          style={{
                            fontSize: '0.78rem',
                            padding: '6px 12px',
                            color: '#DC2626',
                            borderColor: '#FECACA',
                          }}
                          onClick={async () => {
                            await fetch('/api/saved', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'remove', targetId: m.id }),
                            });
                            fetchSavedMembers();
                          }}
                          title="Remove from saved"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View Tab: Settings */}
          {currentTab === 'settings' && currentUser && (
            <SettingsView
              currentUser={currentUser}
              onProfileUpdated={(updated) => {
                setCurrentUser(updated);
              }}
              onOpenUpgradeModal={() => setIsUpgradeOpen(true)}
              onOpenFederationModal={() => setIsFederationOpen(true)}
            />
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
