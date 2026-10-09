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
import {
  Sparkles,
  ShieldCheck,
  ArrowLeft,
  Bookmark,
  Bell,
  Check,
  LogIn,
  Lock,
  Mail,
  User,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

export type AuthState = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'TEMPORARY_ERROR';

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

  // Authentication State Machine
  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [authErrorMessage, setAuthErrorMessage] = useState<string>('');
  const [authPortalMode, setAuthPortalMode] = useState<'login' | 'register'>('login');
  const [portalEmail, setPortalEmail] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [portalFullName, setPortalFullName] = useState('');
  const [portalHeadline, setPortalHeadline] = useState('');
  const [portalIsUnder18, setPortalIsUnder18] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');

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

  // 1. Initial Load: Fetch current user profile & notifications with Auth State Machine
  const fetchCurrentUserData = async () => {
    setAuthState('INITIALIZING');
    setAuthErrorMessage('');
    setPortalError('');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s network timeout

      const res = await fetch('/api/auth/me', { signal: controller.signal });
      clearTimeout(timeoutId);

      // Explicit unauthenticated HTTP responses
      if (res.status === 401 || res.status === 403) {
        setCurrentUser(null);
        setAuthState('UNAUTHENTICATED');
        return;
      }

      // Transient server/database failure
      if (!res.ok) {
        setCurrentUser(null);
        setAuthErrorMessage(`Authentication service temporarily unavailable (HTTP ${res.status}).`);
        setAuthState('TEMPORARY_ERROR');
        return;
      }

      const data = await res.json();
      if (data.authenticated && data.member) {
        setCurrentUser(data.member);
        setAuthState('AUTHENTICATED');
      } else {
        setCurrentUser(null);
        setAuthState('UNAUTHENTICATED');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAuthErrorMessage('Authentication request timed out. Please check your connection.');
      } else {
        setAuthErrorMessage(err.message || 'Unable to connect to authentication service.');
      }
      setAuthState('TEMPORARY_ERROR');
    }
  };

  // Watchdog timer: ensure INITIALIZING never hangs indefinitely
  useEffect(() => {
    const watchdog = setTimeout(() => {
      setAuthState((current) => (current === 'INITIALIZING' ? 'UNAUTHENTICATED' : current));
    }, 7000);
    return () => clearTimeout(watchdog);
  }, []);

  const handlePortalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPortalLoading(true);
    setPortalError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: portalEmail.trim(), password: portalPassword }),
      });
      const data = await res.json();
      if (res.ok && data.member) {
        setCurrentUser(data.member);
        setAuthState('AUTHENTICATED');
        setPortalPassword('');
      } else {
        setPortalError(data.error || 'Invalid credentials. Please verify your email and password.');
      }
    } catch (err: any) {
      setPortalError(err.message || 'Network error during login.');
    } finally {
      setPortalLoading(false);
    }
  };

  const handlePortalRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setPortalLoading(true);
    setPortalError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: portalEmail.trim(),
          password: portalPassword,
          fullName: portalFullName.trim(),
          headline: portalHeadline.trim() || 'Collaborate Member',
          isUnder18: portalIsUnder18,
        }),
      });
      const data = await res.json();
      if (res.ok && data.member) {
        setCurrentUser(data.member);
        setAuthState('AUTHENTICATED');
        setPortalPassword('');
      } else {
        setPortalError(data.error || 'Registration failed. Please verify your details.');
      }
    } catch (err: any) {
      setPortalError(err.message || 'Network error during registration.');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleQuickDemoFill = (email: string, pass: string) => {
    setPortalEmail(email);
    setPortalPassword(pass);
    setPortalError('');
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

  // --------------------------------------------------------------------------
  // STATE 1: INITIALIZING (Indicates active session bootstrap)
  // --------------------------------------------------------------------------
  if (authState === 'INITIALIZING') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          fontFamily: 'var(--font-sans, sans-serif)',
          padding: 20,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4F46E5', marginBottom: 6 }}>
            Collaborate<span style={{ color: '#0F172A' }}>.</span>
          </div>
          <div style={{ color: '#64748B', fontSize: '0.9rem', marginBottom: 20 }}>
            Initializing secure identity session...
          </div>
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid #E2E8F0',
              borderTopColor: '#4F46E5',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 20px',
            }}
          />
          <button
            onClick={() => setAuthState('UNAUTHENTICATED')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6366F1',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Taking too long? Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STATE 2: TEMPORARY_ERROR (Network timeout, 5xx server outage, or database issue)
  // --------------------------------------------------------------------------
  if (authState === 'TEMPORARY_ERROR') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          fontFamily: 'var(--font-sans, sans-serif)',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 16,
            padding: 32,
            maxWidth: 440,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#FEE2E2',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <AlertCircle size={26} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
            Connection Notice
          </h2>
          <p style={{ color: '#64748B', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 24 }}>
            {authErrorMessage || 'The backend service could not be reached. Please check server status.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => fetchCurrentUserData()}
              style={{
                background: '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                padding: '11px 18px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <RefreshCw size={16} />
              Retry Connection
            </button>
            <button
              onClick={() => setAuthState('UNAUTHENTICATED')}
              style={{
                background: '#F1F5F9',
                color: '#334155',
                border: 'none',
                borderRadius: 8,
                padding: '11px 18px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STATE 3: UNAUTHENTICATED (Dedicated Collaborate Login & Registration Portal)
  // --------------------------------------------------------------------------
  if (authState === 'UNAUTHENTICATED' || !currentUser) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #F8FAFC 0%, #EEF2F6 100%)',
          fontFamily: 'var(--font-sans, sans-serif)',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 20,
            padding: 36,
            maxWidth: 480,
            width: '100%',
            boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08)',
          }}
        >
          {/* Brand Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(99, 102, 241, 0.08)',
                color: '#4F46E5',
                padding: '4px 12px',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              <Sparkles size={13} />
              AI Tathastu Network
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#4F46E5', margin: '0 0 6px' }}>
              Collaborate<span style={{ color: '#0F172A' }}>.</span>
            </h1>
            <p style={{ color: '#64748B', fontSize: '0.88rem', margin: 0 }}>
              Great work begins with the right people. Independent professional networking for AI builders.
            </p>
          </div>

          {/* Tab Selector: Sign In vs Create Account */}
          <div
            style={{
              display: 'flex',
              background: '#F1F5F9',
              borderRadius: 10,
              padding: 4,
              marginBottom: 24,
            }}
          >
            <button
              onClick={() => {
                setAuthPortalMode('login');
                setPortalError('');
              }}
              style={{
                flex: 1,
                padding: '9px 0',
                border: 'none',
                borderRadius: 7,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: authPortalMode === 'login' ? '#FFFFFF' : 'transparent',
                color: authPortalMode === 'login' ? '#0F172A' : '#64748B',
                boxShadow: authPortalMode === 'login' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setAuthPortalMode('register');
                setPortalError('');
              }}
              style={{
                flex: 1,
                padding: '9px 0',
                border: 'none',
                borderRadius: 7,
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: authPortalMode === 'register' ? '#FFFFFF' : 'transparent',
                color: authPortalMode === 'register' ? '#0F172A' : '#64748B',
                boxShadow: authPortalMode === 'register' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Create Account
            </button>
          </div>

          {/* Error Banner */}
          {portalError && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: '0.84rem',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={16} />
              <span>{portalError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={authPortalMode === 'login' ? handlePortalLogin : handlePortalRegister}>
            {authPortalMode === 'register' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Full Name
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={16} color="#94A3B8" style={{ position: 'absolute', left: 12, top: 12 }} />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Priya Sharma"
                    value={portalFullName}
                    onChange={(e) => setPortalFullName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px 10px 38px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: '0.9rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="#94A3B8" style={{ position: 'absolute', left: 12, top: 12 }} />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={portalEmail}
                  onChange={(e) => setPortalEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 38px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {authPortalMode === 'register' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Professional Headline (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. GenAI Systems Engineer | IIT Delhi"
                  value={portalHeadline}
                  onChange={(e) => setPortalHeadline(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} color="#94A3B8" style={{ position: 'absolute', left: 12, top: 12 }} />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={portalPassword}
                  onChange={(e) => setPortalPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 38px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {authPortalMode === 'register' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  marginBottom: 20,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <input
                  type="checkbox"
                  id="under18Check"
                  checked={portalIsUnder18}
                  onChange={(e) => setPortalIsUnder18(e.target.checked)}
                  style={{ marginTop: 2, cursor: 'pointer' }}
                />
                <label htmlFor="under18Check" style={{ fontSize: '0.78rem', color: '#475569', cursor: 'pointer', lineHeight: 1.4 }}>
                  <strong>Student Account (Under 18):</strong> Enables automatic privacy-by-default and safeguarding protection against unsolicited adult contact.
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={portalLoading}
              style={{
                width: '100%',
                background: portalLoading ? '#94A3B8' : '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                padding: '12px',
                fontSize: '0.94rem',
                fontWeight: 600,
                cursor: portalLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                transition: 'background 0.15s ease',
              }}
            >
              {portalLoading ? (
                <span>Authenticating...</span>
              ) : authPortalMode === 'login' ? (
                <>
                  <span>Sign In to Collaborate</span>
                  <ArrowRight size={16} />
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Credentials Helper */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 18,
              borderTop: '1px dashed #E2E8F0',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748B', marginBottom: 8 }}>
              BETA REVIEW QUICK-LOGIN
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleQuickDemoFill('rahulsharma@gmail.com', 'password123')}
                style={{
                  background: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: '0.76rem',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Rahul Sharma (LPU)
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemoFill('devika@test.collaborate.internal', 'SecureBeta123!')}
                style={{
                  background: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: '0.76rem',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Devika Sen
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemoFill('amanverma@gmail.com', 'password123')}
                style={{
                  background: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: '0.76rem',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Aman Verma
              </button>
            </div>
          </div>

          {/* Footer Security Badges */}
          <div
            style={{
              marginTop: 20,
              fontSize: '0.72rem',
              color: '#94A3B8',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ShieldCheck size={14} color="#10B981" />
            <span>End-to-end encrypted session signing & scrypt credential hashing</span>
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
