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
import { MemberProfile, RecommendationMatch } from '@/lib/types';
import { Sparkles, ShieldCheck, ArrowLeft, Bookmark } from 'lucide-react';

export default function CollaborateApp() {
  const [currentUser, setCurrentUser] = useState<MemberProfile | null>(null);
  const [viewingTargetUser, setViewingTargetUser] = useState<MemberProfile | null>(null);
  const [targetConnectionStatus, setTargetConnectionStatus] = useState<string>('not_connected');
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [quotaRemaining, setQuotaRemaining] = useState<number>(3);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(3);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [recommendations, setRecommendations] = useState<RecommendationMatch[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Modals state
  const [isFederationOpen, setIsFederationOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  // Active message recipient for direct link
  const [activeChatRecipientId, setActiveChatRecipientId] = useState<string | undefined>(undefined);

  // 1. Initial Load: Fetch current user profile & recommendations
  const fetchCurrentUserData = async () => {
    try {
      const res = await fetch('/api/profiles?id=usr_rahul&viewerId=usr_rahul');
      const data = await res.json();
      if (data.member) {
        setCurrentUser(data.member);
      }
    } catch (err) {
      console.error('Failed to load current user', err);
    }
  };

  const fetchDiscoverData = async () => {
    try {
      const res = await fetch(
        `/api/discover?viewerId=usr_rahul&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();
      if (data.recommendations) setRecommendations(data.recommendations);
      if (data.results) setSearchResults(data.results);
    } catch (err) {
      console.error('Failed to load discover data', err);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await fetch('/api/messages?userId=usr_rahul');
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

  useEffect(() => {
    fetchCurrentUserData();
    fetchDiscoverData();
    fetchUnreadCount();
  }, []);

  useEffect(() => {
    fetchDiscoverData();
  }, [searchQuery]);

  // Handle viewing another member's full profile (enforcing daily 3-view quota)
  const handleViewProfile = async (targetId: string) => {
    if (targetId === 'usr_rahul') {
      setViewingTargetUser(null);
      setCurrentTab('profile');
      return;
    }

    try {
      const res = await fetch(`/api/profiles?id=${targetId}&viewerId=usr_rahul`);
      const data = await res.json();

      if (res.status === 402 || data.error === 'QUOTA_EXCEEDED') {
        // Daily quota exceeded! Open paywall modal
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
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_request',
          fromId: 'usr_rahul',
          toId,
          introMessage: 'Hi, I would love to connect and explore collaboration on AI projects!',
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Connection request sent with professional introduction note!');
        setTargetConnectionStatus('request_sent');
        fetchDiscoverData();
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Handle clicking chat with a user
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
                      if (d.success) alert('Verification request submitted for admin review!');
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
    </div>
  );
}
