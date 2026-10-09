'use client';

import React, { useState } from 'react';
import { Sparkles, Check, X, ShieldCheck, Zap } from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface QuotaPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: MemberProfile;
  onUpgradeSuccess: () => void;
}

export const QuotaPaywallModal: React.FC<QuotaPaywallModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpgradeSuccess,
}) => {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upgrade_premium',
          userId: currentUser.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('🎉 Congratulations! Collaborate Premium activated with unlimited profile access.');
        onUpgradeSuccess();
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDowngrade = async () => {
    try {
      const res = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'downgrade_free',
          userId: currentUser.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('Reset to Free tier to test 3-profile daily quota limit.');
        onUpgradeSuccess();
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
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="modal-title">Collaborate Premium</h3>
              <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                Server-Authoritative Quota Enforcement
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {currentUser.plan === 'free' ? (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 18,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#991B1B' }}>
                Daily Free View Quota Limit Reached (3 Distinct Profiles)
              </div>
              <div style={{ fontSize: '0.78rem', color: '#B91C1C', marginTop: 4 }}>
                Free accounts can explore 3 distinct peer profiles per day (resetting at midnight IST).
                Upgrade to Premium for unlimited full-profile views!
              </div>
            </div>
          ) : (
            <div
              style={{
                background: '#ECFDF5',
                border: '1px solid #A7F3D0',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 18,
                color: '#065F46',
                fontWeight: 700,
                fontSize: '0.88rem',
              }}
            >
              ✅ You currently have Collaborate Premium active!
            </div>
          )}

          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0F172A' }}>
              ₹799 <span style={{ fontSize: '0.9rem', color: '#64748B', fontWeight: 500 }}>/ month</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
              Cancel anytime • Instant entitlement activation
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#EEF2FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#4F46E5',
                }}
              >
                <Check size={13} />
              </div>
              <span><strong>Unlimited eligible full-profile views</strong> (no 3/day quota)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#EEF2FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#4F46E5',
                }}
              >
                <Check size={13} />
              </div>
              <span>Advanced search filters (GPU stacks, LLM frameworks, research labs)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#EEF2FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#4F46E5',
                }}
              >
                <Check size={13} />
              </div>
              <span>Deeper AI matching explanations & career roadmap correlation</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#EEF2FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#4F46E5',
                }}
              >
                <Check size={13} />
              </div>
              <span>Safety protections & privacy boundaries strictly preserved</span>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          {currentUser.plan === 'premium' ? (
            <button
              className="btn-secondary"
              style={{ fontSize: '0.8rem', color: '#EF4444' }}
              onClick={handleDowngrade}
            >
              Downgrade to Free (Test Quota)
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
            {currentUser.plan === 'free' && (
              <button
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                }}
                onClick={handleUpgrade}
                disabled={loading}
              >
                <Zap size={16} />
                <span>{loading ? 'Activating...' : 'Upgrade with Verified Webhook'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
