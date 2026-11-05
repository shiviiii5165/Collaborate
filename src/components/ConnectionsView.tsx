'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  MessageSquare,
  ShieldAlert,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { MemberProfile } from '@/lib/types';

interface ConnectionsViewProps {
  currentUser: MemberProfile;
  onOpenChatWith: (memberId: string) => void;
  onViewProfile: (memberId: string) => void;
}

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({
  currentUser,
  onOpenChatWith,
  onViewProfile,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'connected' | 'received' | 'sent'>('connected');
  const [connections, setConnections] = useState<any[]>([]);
  const [pendingReceived, setPendingReceived] = useState<any[]>([]);
  const [pendingSent, setPendingSent] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchConnectionsData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/connections');
      const data = await res.json();
      // `accepted` carries the other member; raw `connections` also holds pending/rejected records.
      if (data.accepted) setConnections(data.accepted);
      if (data.pendingReceived) setPendingReceived(data.pendingReceived);
      if (data.pendingSent) setPendingSent(data.pendingSent);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectionsData();
  }, [currentUser.id]);

  const handleRespond = async (connectionId: string, decision: 'accept' | 'reject' | 'withdraw') => {
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API's actions are accept / reject / withdraw ('respond' was rejected as invalid).
        body: JSON.stringify({ action: decision, connectionId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchConnectionsData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveConnection = async (toId: string) => {
    if (!confirm('Are you sure you want to remove this connection?')) return;
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          fromId: currentUser.id,
          toId,
        }),
      });
      fetchConnectionsData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBlock = async (toId: string) => {
    if (!confirm('Block this member? All connection and messaging access will be permanently revoked.'))
      return;
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'block',
          fromId: currentUser.id,
          toId,
        }),
      });
      fetchConnectionsData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Subtab selection */}
      <div className="info-card" style={{ padding: '12px 20px' }}>
        <div className="subtab-scroller" style={{ display: 'flex', gap: 12 }}>
          <button
            className={`btn-secondary ${activeSubTab === 'connected' ? 'active' : ''}`}
            style={{
              background: activeSubTab === 'connected' ? '#4F46E5' : '#FFF',
              color: activeSubTab === 'connected' ? '#FFF' : '#334155',
            }}
            onClick={() => setActiveSubTab('connected')}
          >
            <UserCheck size={16} />
            <span>Active Connections ({connections.length})</span>
          </button>

          <button
            className={`btn-secondary ${activeSubTab === 'received' ? 'active' : ''}`}
            style={{
              background: activeSubTab === 'received' ? '#4F46E5' : '#FFF',
              color: activeSubTab === 'received' ? '#FFF' : '#334155',
            }}
            onClick={() => setActiveSubTab('received')}
          >
            <Clock size={16} />
            <span>Invitations Received ({pendingReceived.length})</span>
          </button>

          <button
            className={`btn-secondary ${activeSubTab === 'sent' ? 'active' : ''}`}
            style={{
              background: activeSubTab === 'sent' ? '#4F46E5' : '#FFF',
              color: activeSubTab === 'sent' ? '#FFF' : '#334155',
            }}
            onClick={() => setActiveSubTab('sent')}
          >
            <Users size={16} />
            <span>Sent Requests ({pendingSent.length})</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {activeSubTab === 'connected' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {connections.length === 0 ? (
            <div className="info-card" style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
              No active connections yet. Explore Discover to find verified peers.
            </div>
          ) : (
            connections.map((c) => (
              <div
                key={c.connectionId}
                className="info-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                  onClick={() => onViewProfile(c.member.id)}
                >
                  <img
                    src={c.member.avatarUrl}
                    alt={c.member.fullName}
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      <span>{c.member.fullName}</span>
                      {c.member.isVerified && (
                        <CheckCircle2 size={16} fill="#0284C7" color="#fff" />
                      )}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748B' }}>{c.member.headline}</div>
                    <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                      {/* Records carry updatedAt (when the request was accepted); never show "Invalid Date". */}
                      {(() => {
                        const at = new Date(c.connectedSince ?? c.updatedAt ?? c.createdAt);
                        return Number.isNaN(at.getTime()) ? 'Connected' : `Connected since ${at.toLocaleDateString()}`;
                      })()}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="btn-primary"
                    style={{ fontSize: '0.8rem', padding: '7px 14px' }}
                    onClick={() => onOpenChatWith(c.member.id)}
                  >
                    <MessageSquare size={14} />
                    <span>Chat</span>
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '7px 12px' }}
                    onClick={() => handleRemoveConnection(c.member.id)}
                    title="Remove connection"
                  >
                    <Trash2 size={14} color="#EF4444" />
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '7px 12px' }}
                    onClick={() => handleBlock(c.member.id)}
                    title="Block member"
                  >
                    <ShieldAlert size={14} color="#64748B" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Invitations Received */}
      {activeSubTab === 'received' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pendingReceived.length === 0 ? (
            <div className="info-card" style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
              No incoming connection requests right now.
            </div>
          ) : (
            pendingReceived.map((req) => (
              <div
                key={req.connectionId}
                className="info-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <img
                    src={req.member.avatarUrl}
                    alt={req.member.fullName}
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700 }}>{req.member.fullName}</div>
                    <div style={{ fontSize: '0.82rem', color: '#64748B' }}>{req.member.headline}</div>
                    {req.introMessage && (
                      <div
                        style={{
                          background: '#F8FAFC',
                          padding: '6px 10px',
                          borderRadius: 8,
                          fontSize: '0.78rem',
                          color: '#334155',
                          marginTop: 6,
                        }}
                      >
                        &ldquo;{req.introMessage}&rdquo;
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn-primary"
                    style={{ fontSize: '0.8rem', padding: '7px 16px' }}
                    onClick={() => handleRespond(req.connectionId, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '7px 14px' }}
                    onClick={() => handleRespond(req.connectionId, 'reject')}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Sent Requests */}
      {activeSubTab === 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pendingSent.length === 0 ? (
            <div className="info-card" style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
              No pending sent requests.
            </div>
          ) : (
            pendingSent.map((req) => (
              <div
                key={req.connectionId}
                className="info-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <img
                    src={req.member.avatarUrl}
                    alt={req.member.fullName}
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700 }}>{req.member.fullName}</div>
                    <div style={{ fontSize: '0.82rem', color: '#64748B' }}>{req.member.headline}</div>
                    <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                      Sent on {new Date(req.requestedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                  onClick={() => handleRespond(req.connectionId, 'withdraw')}
                >
                  Withdraw Request
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
