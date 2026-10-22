'use client';

import React, { useState } from 'react';
import { X, Sparkles, Mail, Lock, User, ShieldCheck, ArrowRight } from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (member: MemberProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'switch'>(
    process.env.NEXT_PUBLIC_ENABLE_FIXTURES === 'true' ? 'switch' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName }),
      });
      const data = await res.json();
      if (data.success && data.member) {
        onAuthSuccess(data.member);
        onClose();
      } else {
        setErrorMsg(data.error || 'Registration failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success && data.member) {
        onAuthSuccess(data.member);
        onClose();
      } else {
        setErrorMsg(data.error || 'Invalid credentials');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSwitch = async (targetEmail: string, pass: string) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, password: pass }),
      });
      const data = await res.json();
      if (data.success && data.member) {
        onAuthSuccess(data.member);
        onClose();
      } else {
        setErrorMsg(data.error || 'Switch failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleTathastuSso = () => {
    setLoading(true);
    setErrorMsg('');
    // Direct browser to server-side Tathastu OAuth authorization start endpoint
    window.location.href = '/api/auth/tathastu/start';
  };


  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="#4F46E5" />
            <h3 className="modal-title">
              {mode === 'switch'
                ? 'Account & Identity Authority'
                : mode === 'login'
                ? 'Sign In to Collaborate'
                : 'Create Standalone Account'}
            </h3>
          </div>
          <button onClick={onClose} style={{ color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {errorMsg && (
            <div
              style={{
                background: '#FEF2F2',
                color: '#DC2626',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.82rem',
                marginBottom: 16,
              }}
            >
              {errorMsg}
            </div>
          )}

          {mode === 'switch' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 1-Click Tathastu SSO */}
              <button
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                  justifyContent: 'center',
                  padding: '12px 20px',
                }}
                onClick={handleTathastuSso}
                disabled={loading}
              >
                <Sparkles size={18} />
                <span>One-Click Sign In with AI Tathastu (OIDC)</span>
              </button>

              {process.env.NEXT_PUBLIC_ENABLE_FIXTURES === 'true' && (
                <>
                  <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>
                    — OR SWITCH TEST PERSONAS —
                  </div>

                  {/* Persona Cards */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#F8FAFC',
                      borderRadius: 10,
                      cursor: 'pointer',
                      border: '1px solid #E2E8F0',
                    }}
                    onClick={() => handleQuickSwitch('rahulsharma@gmail.com', 'rahul1234')}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>Rahul Sharma (Student / Free)</div>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                        rahulsharma@gmail.com • 3 daily profile views quota
                      </div>
                    </div>
                    <ArrowRight size={16} color="#4F46E5" />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: '#F8FAFC',
                      borderRadius: 10,
                      cursor: 'pointer',
                      border: '1px solid #E2E8F0',
                    }}
                    onClick={() => handleQuickSwitch('admin@aitathastu.com', 'admin1234')}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#B45309' }}>
                        Tathastu Safety Admin (Authority)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                        admin@aitathastu.com • Verification review & audit rights
                      </div>
                    </div>
                    <ShieldCheck size={18} color="#B45309" />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  className="btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setMode('login')}
                >
                  Password Login
                </button>
                <button
                  className="btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setMode('register')}
                >
                  Direct Register
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #0d9488, #0f766e)',
                  justifyContent: 'center',
                  padding: '12px 20px',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(13, 148, 136, 0.25)',
                }}
                onClick={handleTathastuSso}
                disabled={loading}
              >
                <Sparkles size={18} />
                <span>Sign up with AI Tathastu (Recommended)</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0', color: '#94A3B8', fontSize: '0.76rem' }}>
                <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
                <span>OR CREATE STANDALONE ACCOUNT</span>
                <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
              </div>

              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Siddharth Rao"
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px' }}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px' }}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Password (min 8 characters)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="••••••••"
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px' }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn-primary" style={{ marginTop: 10, justifyContent: 'center' }} disabled={loading}>
                  {loading ? 'Creating...' : 'Create Standalone Account'}
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ justifyContent: 'center' }}
                  onClick={() => setMode('switch')}
                >
                  Back to Switcher
                </button>
              </form>
            </div>
          )}

          {mode === 'login' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #0d9488, #0f766e)',
                  justifyContent: 'center',
                  padding: '12px 20px',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(13, 148, 136, 0.25)',
                }}
                onClick={handleTathastuSso}
                disabled={loading}
              >
                <Sparkles size={18} />
                <span>Sign in with AI Tathastu</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0', color: '#94A3B8', fontSize: '0.76rem' }}>
                <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
                <span>OR SIGN IN WITH PASSWORD</span>
                <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
              </div>

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px' }}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px' }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn-primary" style={{ marginTop: 10, justifyContent: 'center' }} disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ justifyContent: 'center' }}
                  onClick={() => setMode('switch')}
                >
                  Back to Switcher
                </button>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
