'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  X,
  Lock,
  RefreshCw,
  AlertCircle,
  Unlink,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface TathastuFederationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: MemberProfile;
  onSyncComplete: () => void;
}

export const TathastuFederationModal: React.FC<TathastuFederationModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSyncComplete,
}) => {
  const [projection, setProjection] = useState<any>(null);
  const [autoSyncProjects, setAutoSyncProjects] = useState(
    currentUser.tathastuSyncSettings?.autoSyncProjects ?? true
  );
  const [autoSyncSkills, setAutoSyncSkills] = useState(
    currentUser.tathastuSyncSettings?.autoSyncSkills ?? true
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/federation?action=get_projection')
        .then((r) => r.json())
        .then((data) => setProjection(data));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleImportDraft = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/federation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'one_click_import',
          userId: currentUser.id,
          syncSettings: {
            autoSyncProjects,
            autoSyncSkills,
            autoSyncAchievements: true,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Tathastu Core profile projection synchronized successfully!');
        onSyncComplete();
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeLink = async () => {
    if (
      !confirm(
        'Disconnect AI Tathastu Core? Your Collaborate profile, connections, and messages will remain active independently.'
      )
    )
      return;

    try {
      const res = await fetch('/api/federation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke_link',
          userId: currentUser.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        onSyncComplete();
        onClose();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={20} color="#6366F1" />
            <h3 className="modal-title">AI Tathastu Identity Federation</h3>
          </div>
          <button onClick={onClose} style={{ color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              background: '#EEF2FF',
              border: '1px solid #C7D2FE',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <ShieldCheck size={24} color="#4F46E5" />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#3730A3' }}>
                Threads-Style 1-Click Profile Draft
              </div>
              <div style={{ fontSize: '0.78rem', color: '#4F46E5' }}>
                Collaborate projection imports only user-approved professional credentials.
              </div>
            </div>
          </div>

          {/* Approved Data Preview */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: 8 }}>
              Approved Data Categories from Core (Person 360):
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                fontSize: '0.78rem',
                color: '#475569',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} color="#10B981" /> Full Name & Avatar
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} color="#10B981" /> Verified Education (LPU)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} color="#10B981" /> Confirmed Projects (2)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} color="#10B981" /> Verified Skills (28)
              </div>
            </div>
          </div>

          {/* Strictly Protected Private Data */}
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.78rem',
                fontWeight: 700,
                color: '#991B1B',
                marginBottom: 4,
              }}
            >
              <Lock size={13} /> Strictly NOT Transferred (Privacy Boundary):
            </div>
            <div style={{ fontSize: '0.74rem', color: '#B91C1C' }}>
              Resumes (PDF), internal course grades, passwords, raw EORA private conversations, and
              internal institutional rankings.
            </div>
          </div>

          {/* Sync Preferences */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={autoSyncProjects}
                onChange={(e) => setAutoSyncProjects(e.target.checked)}
              />
              <span>Auto-sync new approved projects from AI Tathastu</span>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={autoSyncSkills}
                onChange={(e) => setAutoSyncSkills(e.target.checked)}
              />
              <span>Auto-sync newly certified technical skills</span>
            </label>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          {currentUser.isLinkedWithTathastu ? (
            <button
              className="btn-secondary"
              style={{ color: '#EF4444', borderColor: '#FECACA', fontSize: '0.8rem' }}
              onClick={handleRevokeLink}
            >
              <Unlink size={14} />
              <span>Unlink Core Account</span>
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleImportDraft} disabled={loading}>
              <RefreshCw size={14} />
              <span>{loading ? 'Syncing...' : 'Sync & Save Profile Draft'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
