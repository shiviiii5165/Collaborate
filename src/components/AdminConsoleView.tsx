'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
  FileCheck,
  RefreshCw,
} from 'lucide-react';
import { VerificationRequest, VerificationAuditLog } from '@/lib/types';

export const AdminConsoleView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'requests' | 'audit' | 'plans'>('requests');
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<VerificationAuditLog[]>([]);
  const [reviewerNotes, setReviewerNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/verification');
      const data = await res.json();
      if (data.requests) setRequests(data.requests);
      if (data.auditLogs) setAuditLogs(data.auditLogs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleReview = async (requestId: string, decision: 'approved' | 'rejected') => {
    const notes = reviewerNotes[requestId] || 'Reviewed against registry verification database.';
    try {
      const res = await fetch('/api/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review',
          requestId,
          decision,
          notes,
          reviewerId: 'admin_security_ops',
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Verification request ${decision}! Immutable audit log recorded.`);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Admin Title Card */}
      <div className="info-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: '#EEF2FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4F46E5',
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                Collaborate Admin & Trust Authority
              </h2>
              <p style={{ fontSize: '0.84rem', color: '#64748B' }}>
                Capability-based reviewer workspace for identity badges, audit compliance, and safety.
              </p>
            </div>
          </div>

          <button className="btn-secondary" onClick={fetchData}>
            <RefreshCw size={14} />
            <span>Refresh Queue</span>
          </button>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            className={`btn-secondary ${activeTab === 'requests' ? 'active' : ''}`}
            style={{
              background: activeTab === 'requests' ? '#4F46E5' : '#FFF',
              color: activeTab === 'requests' ? '#FFF' : '#334155',
            }}
            onClick={() => setActiveTab('requests')}
          >
            <FileCheck size={16} />
            <span>Verification Queue ({requests.filter((r) => r.status === 'pending').length})</span>
          </button>

          <button
            className={`btn-secondary ${activeTab === 'audit' ? 'active' : ''}`}
            style={{
              background: activeTab === 'audit' ? '#4F46E5' : '#FFF',
              color: activeTab === 'audit' ? '#FFF' : '#334155',
            }}
            onClick={() => setActiveTab('audit')}
          >
            <History size={16} />
            <span>Immutable Audit Log ({auditLogs.length})</span>
          </button>
        </div>
      </div>

      {/* Review Queue Tab */}
      {activeTab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {requests.length === 0 ? (
            <div className="info-card" style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
              No verification requests in queue.
            </div>
          ) : (
            requests.map((req) => (
              <div
                key={req.id}
                className="info-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  borderLeft:
                    req.status === 'pending'
                      ? '4px solid #F59E0B'
                      : req.status === 'approved'
                      ? '4px solid #10B981'
                      : '4px solid #EF4444',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 800, fontSize: '1rem' }}>{req.memberName}</span>
                    <span style={{ fontSize: '0.8rem', color: '#64748B', marginLeft: 8 }}>
                      ({req.memberEmail})
                    </span>
                    <span
                      style={{
                        marginLeft: 12,
                        background: '#EEF2FF',
                        color: '#4F46E5',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 6,
                        textTransform: 'uppercase',
                      }}
                    >
                      Category: {req.category}
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color:
                        req.status === 'approved'
                          ? '#10B981'
                          : req.status === 'rejected'
                          ? '#EF4444'
                          : '#F59E0B',
                    }}
                  >
                    STATUS: {req.status.toUpperCase()}
                  </span>
                </div>

                <div
                  style={{
                    background: '#F8FAFC',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: '0.82rem',
                    color: '#334155',
                  }}
                >
                  <strong>Submitted Evidence:</strong> {req.evidenceSummary}
                </div>

                {req.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                    <input
                      type="text"
                      placeholder="Add reviewer audit note..."
                      style={{
                        flex: 1,
                        background: '#FFF',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        padding: '7px 12px',
                        fontSize: '0.82rem',
                      }}
                      value={reviewerNotes[req.id] || ''}
                      onChange={(e) =>
                        setReviewerNotes({ ...reviewerNotes, [req.id]: e.target.value })
                      }
                    />
                    <button
                      className="btn-primary"
                      style={{ background: '#10B981', fontSize: '0.8rem', padding: '7px 16px' }}
                      onClick={() => handleReview(req.id, 'approved')}
                    >
                      <CheckCircle2 size={15} />
                      <span>Approve Badge</span>
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ color: '#EF4444', borderColor: '#FECACA', fontSize: '0.8rem', padding: '7px 14px' }}
                      onClick={() => handleReview(req.id, 'rejected')}
                    >
                      <XCircle size={15} />
                      <span>Reject</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Immutable Audit Log Tab */}
      {activeTab === 'audit' && (
        <div className="info-card">
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 14 }}>
            Immutable Verification Decisions
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {auditLogs.length === 0 ? (
              <div style={{ color: '#94A3B8', fontSize: '0.84rem' }}>No audit actions recorded yet.</div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#F8FAFC',
                    borderRadius: 8,
                    fontSize: '0.8rem',
                  }}
                >
                  <div>
                    <strong style={{ color: '#0F172A' }}>{log.action.toUpperCase()}</strong> for member{' '}
                    <code>{log.memberId}</code> by reviewer <code>{log.reviewer}</code>
                    <div style={{ color: '#64748B', marginTop: 2 }}>Note: {log.notes}</div>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: '0.74rem' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
