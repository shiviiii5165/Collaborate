'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Bell,
  Link as LinkIcon,
  CreditCard,
  Key,
  Download,
  AlertOctagon,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  Lock,
  UserCheck,
  Zap,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface SettingsViewProps {
  currentUser: MemberProfile;
  onProfileUpdated: (updated: MemberProfile) => void;
  onOpenUpgradeModal: () => void;
  onOpenFederationModal: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser,
  onProfileUpdated,
  onOpenUpgradeModal,
  onOpenFederationModal,
}) => {
  const [subTab, setSubTab] = useState<
    'privacy' | 'notifications' | 'federation' | 'membership' | 'security' | 'verification' | 'danger'
  >('privacy');

  // Privacy states
  const [discoverable, setDiscoverable] = useState(currentUser.discoverable);
  const [profileVisibility, setProfileVisibility] = useState(currentUser.profileVisibility || 'public');
  const [contactVisibility, setContactVisibility] = useState(currentUser.contactVisibility || 'connections_only');

  // Notification states
  const [notifPrefs, setNotifPrefs] = useState(
    currentUser.notificationPreferences || {
      connections: true,
      messages: true,
      verifications: true,
      recommendations: true,
      securityAlerts: true,
    }
  );

  // Federation Sync states
  const [syncSettings, setSyncSettings] = useState(
    currentUser.tathastuSyncSettings || {
      autoSyncProjects: true,
      autoSyncSkills: true,
      autoSyncAchievements: true,
    }
  );

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Verification request states
  const [verificationEvidence, setVerificationEvidence] = useState('');
  const [verificationCategory, setVerificationCategory] = useState<'identity' | 'institution' | 'organization'>('institution');
  const [verificationMsg, setVerificationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Account restriction & deletion
  const [isRestricted, setIsRestricted] = useState(Boolean(currentUser.isRestricted));
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  // Feedback states
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const showSaveSuccess = (msg: string) => {
    setSaveSuccessMsg(msg);
    setTimeout(() => setSaveSuccessMsg(null), 3500);
  };

  const handleSavePrivacy = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_privacy',
          privacy: {
            discoverable,
            profileVisibility,
            contactVisibility,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSaveSuccess('Privacy settings saved.');
        onProfileUpdated({
          ...currentUser,
          discoverable,
          profileVisibility,
          contactVisibility,
        });
      } else {
        alert(data.error || 'Failed to update privacy');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_notifications',
          notificationPreferences: notifPrefs,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSaveSuccess('Notification preferences saved.');
        onProfileUpdated({
          ...currentUser,
          notificationPreferences: notifPrefs,
        });
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFederationSync = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_federation_sync',
          tathastuSyncSettings: syncSettings,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSaveSuccess('Tathastu auto-sync preferences updated.');
        onProfileUpdated({
          ...currentUser,
          tathastuSyncSettings: syncSettings,
        });
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 8) {
      setPasswordMsg({ type: 'error', text: 'New password must be at least 8 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_password',
          passwordChange: { currentPassword, newPassword },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPasswordMsg({ type: 'success', text: 'Password successfully updated.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordMsg({ type: 'error', text: data.error || 'Failed to change password.' });
      }
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message });
    }
  };

  const handleRequestVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerificationMsg(null);
    if (!verificationEvidence.trim()) {
      setVerificationMsg({ type: 'error', text: 'Please provide evidence details or institutional identifier.' });
      return;
    }

    try {
      const res = await fetch('/api/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: currentUser.id,
          category: verificationCategory,
          evidenceSummary: verificationEvidence.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setVerificationMsg({
          type: 'success',
          text: 'Verification application submitted! A Tathastu administrator will review your credentials.',
        });
        setVerificationEvidence('');
      } else {
        setVerificationMsg({ type: 'error', text: data.error || 'Submission failed.' });
      }
    } catch (err: any) {
      setVerificationMsg({ type: 'error', text: err.message });
    }
  };

  const handleToggleRestriction = async () => {
    const nextState = !isRestricted;
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restrict_account',
          isRestricted: nextState,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsRestricted(nextState);
        showSaveSuccess(data.message);
        onProfileUpdated({
          ...currentUser,
          isRestricted: nextState,
        });
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExportData = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export_data' }),
      });
      const data = await res.json();
      if (data.success && data.export) {
        const jsonStr = JSON.stringify(data.export, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `collaborate_data_export_${currentUser.id}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSaveSuccess('Your Collaborate data export has been downloaded.');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setDeleteMsg("Type 'DELETE MY ACCOUNT' to confirm.");
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: deleteConfirmation,
          password: deletePassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Your Collaborate account has been deactivated. Logging out.');
        window.location.href = '/api/auth/logout';
      } else {
        setDeleteMsg(data.error || 'Account deletion failed.');
      }
    } catch (err: any) {
      setDeleteMsg(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Banner */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 16,
          padding: '24px 28px',
          border: '1px solid #E2E8F0',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={22} color="#4F46E5" />
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Account & Privacy Settings
            </h1>
          </div>
          <p style={{ color: '#64748B', fontSize: '0.86rem', marginTop: 4, margin: '4px 0 0' }}>
            Manage your professional privacy, Tathastu federation, security, and notification preferences.
          </p>
        </div>
        {saveSuccessMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: 8,
              color: '#065F46',
              fontSize: '0.84rem',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={16} color="#059669" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* Settings Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          background: '#FFFFFF',
          padding: '8px 12px',
          borderRadius: 12,
          border: '1px solid #E2E8F0',
        }}
      >
        <button
          className={`tab-btn ${subTab === 'privacy' ? 'active' : ''}`}
          onClick={() => setSubTab('privacy')}
        >
          <Shield size={16} />
          <span>Privacy & Discoverability</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'notifications' ? 'active' : ''}`}
          onClick={() => setSubTab('notifications')}
        >
          <Bell size={16} />
          <span>Notifications</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'federation' ? 'active' : ''}`}
          onClick={() => setSubTab('federation')}
        >
          <LinkIcon size={16} />
          <span>Tathastu Federation</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'membership' ? 'active' : ''}`}
          onClick={() => setSubTab('membership')}
        >
          <CreditCard size={16} />
          <span>Plan & Quota</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'verification' ? 'active' : ''}`}
          onClick={() => setSubTab('verification')}
        >
          <UserCheck size={16} />
          <span>Verification</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'security' ? 'active' : ''}`}
          onClick={() => setSubTab('security')}
        >
          <Key size={16} />
          <span>Account Security</span>
        </button>
        <button
          className={`tab-btn ${subTab === 'danger' ? 'active' : ''}`}
          onClick={() => setSubTab('danger')}
        >
          <AlertOctagon size={16} />
          <span>Data & Deletion</span>
        </button>
      </div>

      {/* Tab 1: Privacy & Discoverability */}
      {subTab === 'privacy' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Directory Discoverability & Visibility
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Control who can find your profile in people search and recommendation rails.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Discoverable Switch */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px',
                background: '#F8FAFC',
                borderRadius: 10,
                border: '1px solid #E2E8F0',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                  Directory Discoverability
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  When enabled, your profile card appears in people discovery search and peer recommendations.
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={discoverable}
                  onChange={(e) => setDiscoverable(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#4F46E5' }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: discoverable ? '#4F46E5' : '#94A3B8' }}>
                  {discoverable ? 'Discoverable' : 'Hidden from Directory'}
                </span>
              </label>
            </div>

            {/* Profile Visibility */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px',
                background: '#F8FAFC',
                borderRadius: 10,
                border: '1px solid #E2E8F0',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                  Profile Visibility Level
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Controls how much information is shown to users who do not have an accepted connection.
                </div>
              </div>
              <select
                value={profileVisibility}
                onChange={(e: any) => setProfileVisibility(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#1E293B',
                }}
              >
                <option value="public">Public (All verified Collaborate users)</option>
                <option value="connections_only">Connections Only (Accepted peers only)</option>
                <option value="private">Private (Restricted)</option>
              </select>
            </div>

            {/* Contact Visibility */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px',
                background: '#F8FAFC',
                borderRadius: 10,
                border: '1px solid #E2E8F0',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                  Contact Detail Visibility
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Controls visibility of email and external personal portfolio links.
                </div>
              </div>
              <select
                value={contactVisibility}
                onChange={(e: any) => setContactVisibility(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#1E293B',
                }}
              >
                <option value="connections_only">Connections Only</option>
                <option value="hidden">Hidden from Everyone</option>
              </select>
            </div>

            {/* Minor Safeguards */}
            {currentUser.isUnder18 && (
              <div
                style={{
                  padding: '16px',
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <Shield size={20} color="#D97706" style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#92400E' }}>
                    Student Safety & Minor Privacy Safeguard Active
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#B45309', marginTop: 2 }}>
                    This account is registered with student safety safeguards. Direct messaging and discovery
                    are private-by-default to protect minors from unrestricted adult contact.
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn-primary"
            style={{ alignSelf: 'flex-start', padding: '10px 20px' }}
            onClick={handleSavePrivacy}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Privacy Settings'}
          </button>
        </div>
      )}

      {/* Tab 2: Notification Preferences */}
      {subTab === 'notifications' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Notification Preferences
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Choose which events trigger real-time notifications in your Collaborate feed.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                key: 'connections',
                title: 'Connection Requests & Decisions',
                desc: 'Alert when a peer requests to connect or accepts your connection invitation.',
              },
              {
                key: 'messages',
                title: 'Direct Messages',
                desc: 'Notifications when accepted connections send you messages.',
              },
              {
                key: 'verifications',
                title: 'Verification Badge Status',
                desc: 'Updates on your administrative identity and student badge reviews.',
              },
              {
                key: 'recommendations',
                title: 'Intelligent Peer Recommendations',
                desc: 'Notifies you when high-synergy builders or researchers join your research tracks.',
              },
              {
                key: 'securityAlerts',
                title: 'Security & Session Notices',
                desc: 'Important notices regarding password updates, SSO links, or quota warnings.',
              },
            ].map((item) => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 18px',
                  background: '#F8FAFC',
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                    {item.desc}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean((notifPrefs as any)[item.key])}
                  onChange={(e) =>
                    setNotifPrefs({
                      ...notifPrefs,
                      [item.key]: e.target.checked,
                    })
                  }
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#4F46E5' }}
                />
              </div>
            ))}
          </div>

          <button
            className="btn-primary"
            style={{ alignSelf: 'flex-start', padding: '10px 20px' }}
            onClick={handleSaveNotifications}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Notification Preferences'}
          </button>
        </div>
      )}

      {/* Tab 3: AI Tathastu Federation Link */}
      {subTab === 'federation' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              AI Tathastu Core Federation & Sync
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Connect your verified AI Tathastu academic projects, approved skills, and hackathon achievements.
            </p>
          </div>

          {/* Link Status Box */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 12,
              background: currentUser.isLinkedWithTathastu ? '#EEF2FF' : '#F8FAFC',
              border: '1px solid',
              borderColor: currentUser.isLinkedWithTathastu ? '#C7D2FE' : '#E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: currentUser.isLinkedWithTathastu ? '#10B981' : '#94A3B8',
                  }}
                />
                <span style={{ fontWeight: 800, fontSize: '0.94rem', color: '#0F172A' }}>
                  {currentUser.isLinkedWithTathastu ? 'Linked & Synchronized' : 'Not Linked to AI Tathastu'}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: 4 }}>
                Status: <strong>{currentUser.tathastuSyncStatus}</strong> • Mode:{' '}
                <strong>{process.env.TATHASTU_INTEGRATION_MODE || 'Mock Core (Contract-Ready)'}</strong>
              </div>
            </div>

            <button className="btn-secondary" onClick={onOpenFederationModal}>
              <RefreshCw size={14} />
              <span>{currentUser.isLinkedWithTathastu ? 'Manage Federation' : 'Link Tathastu Account'}</span>
            </button>
          </div>

          {/* Auto-Sync Preferences */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0F172A' }}>
              Auto-Sync Preferences (Future Core Releases)
            </h3>
            {[
              {
                key: 'autoSyncProjects',
                title: 'Auto-Sync Verified Projects',
                desc: 'Automatically incorporate newly completed and verified projects from AI Tathastu tracks into your portfolio.',
              },
              {
                key: 'autoSyncSkills',
                title: 'Auto-Sync Skill Assessments',
                desc: 'Add newly verified technical endorsements and competency assessments to your profile.',
              },
              {
                key: 'autoSyncAchievements',
                title: 'Auto-Sync Credentials & Hackathons',
                desc: 'Display Tathastu certifications and hackathon trophies automatically.',
              },
            ].map((pref) => (
              <div
                key={pref.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: '#F8FAFC',
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0F172A' }}>
                    {pref.title}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{pref.desc}</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean((syncSettings as any)[pref.key])}
                  onChange={(e) =>
                    setSyncSettings({
                      ...syncSettings,
                      [pref.key]: e.target.checked,
                    })
                  }
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#4F46E5' }}
                />
              </div>
            ))}
          </div>

          <button
            className="btn-primary"
            style={{ alignSelf: 'flex-start', padding: '10px 20px' }}
            onClick={handleSaveFederationSync}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Federation Preferences'}
          </button>
        </div>
      )}

      {/* Tab 4: Membership & View Quota */}
      {subTab === 'membership' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Membership Plan & View Quota
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Free members receive 3 distinct eligible full-profile views per day. Premium members enjoy unlimited views.
            </p>
          </div>

          {/* Current Tier Card */}
          <div
            style={{
              padding: '20px',
              borderRadius: 12,
              background: currentUser.plan === 'premium' ? 'linear-gradient(135deg, #4338CA 0%, #6366F1 100%)' : '#F8FAFC',
              color: currentUser.plan === 'premium' ? '#FFFFFF' : '#0F172A',
              border: '1px solid',
              borderColor: currentUser.plan === 'premium' ? '#4338CA' : '#E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>
                Current Subscription Tier
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, marginTop: 4 }}>
                {currentUser.plan === 'premium' ? 'Collaborate Premium' : 'Free Tier'}
              </div>
              <div style={{ fontSize: '0.84rem', marginTop: 4, opacity: 0.9 }}>
                {currentUser.plan === 'premium'
                  ? 'Unlimited eligible full-profile views, advanced filter stacks, and priority recommendation matching.'
                  : 'Daily quota: 3 distinct eligible full-profile views every 24-hour cycle.'}
              </div>
            </div>

            <button
              className={currentUser.plan === 'premium' ? 'btn-secondary' : 'btn-primary'}
              style={{ padding: '10px 20px', fontWeight: 700 }}
              onClick={onOpenUpgradeModal}
            >
              {currentUser.plan === 'premium' ? 'Manage Plan' : 'Upgrade to Premium'}
            </button>
          </div>

          {/* Quota Meter */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 10,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                Today's Distinct Profile View Allocation
              </span>
              <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#4F46E5' }}>
                {currentUser.plan === 'premium' ? 'Unlimited' : '3 Views Per Day'}
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                background: '#E2E8F0',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: currentUser.plan === 'premium' ? '100%' : '66%',
                  height: '100%',
                  background: '#4F46E5',
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: 8 }}>
              Re-viewing profiles you have already accessed today does not consume additional quota.
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Identity Verification Request */}
      {subTab === 'verification' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Identity & Institutional Verification
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Verified badges are strictly non-paid and require administrative review of verified institutional credentials.
            </p>
          </div>

          {currentUser.isVerified ? (
            <div
              style={{
                padding: '20px',
                borderRadius: 12,
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <CheckCircle2 size={32} color="#16A34A" />
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#166534' }}>
                  Badge Verified ({currentUser.verifiedCategory || 'Identity'})
                </div>
                <div style={{ fontSize: '0.84rem', color: '#15803D', marginTop: 2 }}>
                  Your identity was officially verified by Collaborate Security Ops.
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleRequestVerification} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {verificationMsg && (
                <div
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    background: verificationMsg.type === 'success' ? '#ECFDF5' : '#FEF2F2',
                    border: '1px solid',
                    borderColor: verificationMsg.type === 'success' ? '#A7F3D0' : '#FECACA',
                    color: verificationMsg.type === 'success' ? '#065F46' : '#991B1B',
                  }}
                >
                  {verificationMsg.text}
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Verification Category
                </label>
                <select
                  value={verificationCategory}
                  onChange={(e: any) => setVerificationCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.88rem',
                  }}
                >
                  <option value="institution">Academic Institution (Student / Researcher ID)</option>
                  <option value="organization">Organization / Engineering Entity</option>
                  <option value="identity">Professional Identity Review</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Evidence Summary / Institutional ID
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide verifiable evidence (e.g. 'Student Registration ID: 12109923 @ Lovely Professional University, official institutional email: rahul.sharma@lpu.in')"
                  value={verificationEvidence}
                  onChange={(e) => setVerificationEvidence(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.88rem',
                    resize: 'vertical',
                  }}
                />
              </div>

              <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start', padding: '10px 20px' }}>
                Submit Verification Request
              </button>
            </form>
          )}
        </div>
      )}

      {/* Tab 6: Account Security & Passwords */}
      {subTab === 'security' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Account Security & Credentials
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Update your account password. Password hashes are protected with scrypt cryptographic derivation.
            </p>
          </div>

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {passwordMsg && (
              <div
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  background: passwordMsg.type === 'success' ? '#ECFDF5' : '#FEF2F2',
                  border: '1px solid',
                  borderColor: passwordMsg.type === 'success' ? '#A7F3D0' : '#FECACA',
                  color: passwordMsg.type === 'success' ? '#065F46' : '#991B1B',
                }}
              >
                {passwordMsg.text}
              </div>
            )}

            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                Current Password
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  fontSize: '0.88rem',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New strong password"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.88rem',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: '0.88rem',
                  }}
                />
              </div>
            </div>

            <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start', padding: '10px 20px' }}>
              Update Password
            </button>
          </form>

          {/* Active Session Info */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 10,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A', marginBottom: 4 }}>
              Active Session Details
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748B' }}>
              Authenticated Session: <strong>{currentUser.email}</strong> • Host-Only Cookie: <strong>Enabled</strong> • SameSite: <strong>Lax</strong> • HTTPS Secure Flag: <strong>Enforced</strong>
            </div>
          </div>
        </div>
      )}

      {/* Tab 7: Data Export & Account Deletion */}
      {subTab === 'danger' && (
        <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              Compliance, Data Export & Deletion
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.84rem' }}>
              Export your full data archive or restrict/delete your Collaborate account.
            </p>
          </div>

          {/* Export Data */}
          <div
            style={{
              padding: '18px 20px',
              background: '#F8FAFC',
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                Download Complete Data Archive (GDPR / Compliance)
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                Download an export JSON containing your profile, connections, and message metadata.
              </div>
            </div>
            <button className="btn-secondary" onClick={handleExportData}>
              <Download size={14} />
              <span>Export JSON</span>
            </button>
          </div>

          {/* Restrict Account */}
          <div
            style={{
              padding: '18px 20px',
              background: '#F8FAFC',
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                Temporary Account Restriction
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                {isRestricted
                  ? 'Your account is currently restricted. Your profile is hidden from people search.'
                  : 'Temporarily hide your profile and pause new connection requests without deleting your data.'}
              </div>
            </div>
            <button
              className="btn-secondary"
              style={{ color: isRestricted ? '#059669' : '#D97706' }}
              onClick={handleToggleRestriction}
            >
              {isRestricted ? 'Lift Restriction' : 'Restrict Account'}
            </button>
          </div>

          {/* Delete Account */}
          <div
            style={{
              padding: '20px',
              background: '#FEF2F2',
              borderRadius: 12,
              border: '1px solid #FECACA',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={20} color="#DC2626" />
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#991B1B' }}>
                Permanently Delete Account
              </div>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#B91C1C', margin: 0 }}>
              This action deactivates your Collaborate profile, unlinks any Tathastu Core bindings, and
              clears active login sessions. This action is irreversible.
            </p>

            {deleteMsg && (
              <div style={{ color: '#DC2626', fontSize: '0.82rem', fontWeight: 700 }}>{deleteMsg}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                placeholder="Type 'DELETE MY ACCOUNT' to confirm"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #FCA5A5',
                  fontSize: '0.84rem',
                  maxWidth: 320,
                }}
              />
              <button
                className="btn-primary"
                style={{
                  background: '#DC2626',
                  borderColor: '#DC2626',
                  maxWidth: 220,
                  padding: '9px 18px',
                }}
                onClick={handleDeleteAccount}
              >
                Confirm Account Deletion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
