'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, CheckCheck, ShieldAlert, CheckCircle2, Lock, ArrowLeft } from 'lucide-react';
import { DirectMessage, MemberProfile } from '@/lib/types';

interface MessagesViewProps {
  currentUser: MemberProfile;
  initialRecipientId?: string;
}

/** A chat row from GET /api/messages: an existing conversation, or an accepted connection with no messages yet (isNew). */
interface ChatEntry {
  id: string;
  isNew: boolean;
  canMessage: boolean;
  participantIds: string[];
  otherMember: { id: string; fullName: string; avatarUrl?: string; isVerified?: boolean };
  lastMessage: { content: string; timestamp: string } | null;
  unreadCount: number;
}

const peerOf = (c: ChatEntry, me: string) => c.participantIds.find((id) => id !== me) ?? '';

export const MessagesView: React.FC<MessagesViewProps> = ({ currentUser, initialRecipientId }) => {
  const [conversations, setConversations] = useState<ChatEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // The open chat is tracked by the other member's id, so it survives a "new" chat becoming a real conversation.
  const [activePeerId, setActivePeerId] = useState<string | null>(initialRecipientId ?? null);
  // Phones show one pane at a time: the list, or the thread the member opened (CSS, ≤640px only).
  const [threadOpen, setThreadOpen] = useState(Boolean(initialRecipientId));
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<string | null>(null);

  const activeConv = conversations.find((c) => peerOf(c, currentUser.id) === activePeerId) ?? null;

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'Could not load chats');
      const list: ChatEntry[] = data.conversations ?? [];
      setConversations(list);
      setListError(null);
      setActivePeerId((cur) => {
        if (cur && list.some((c) => peerOf(c, currentUser.id) === cur)) return cur;
        return list[0] ? peerOf(list[0], currentUser.id) : null;
      });
    } catch (err: any) {
      setListError(err?.message || 'Could not load chats');
    } finally {
      setLoaded(true);
    }
  }, [currentUser.id]);

  const fetchMessages = useCallback(async (conv: ChatEntry) => {
    // A new chat has no conversation yet: nothing to load.
    if (conv.isNew) {
      setMessages([]);
      return;
    }
    try {
      const res = await fetch(`/api/messages?conversationId=${encodeURIComponent(conv.id)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      /* the next poll retries */
    }
  }, []);

  // Chat list: loaded now, refreshed every 5 s (new chats, previews, unread counts).
  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Open thread: loaded on open, refreshed every 4 s.
  const activeKey = activeConv ? activeConv.id : null;
  useEffect(() => {
    if (!activeConv) {
      setMessages([]);
      return;
    }
    fetchMessages(activeConv);
    const interval = setInterval(() => fetchMessages(activeConv), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, fetchMessages]);

  // Read receipts: opening a thread with unread messages marks it read once per new arrival.
  useEffect(() => {
    if (!activeConv || activeConv.isNew || activeConv.unreadCount === 0) return;
    const marker = `${activeConv.id}:${activeConv.lastMessage?.timestamp ?? ''}`;
    if (lastReadRef.current === marker) return;
    lastReadRef.current = marker;
    fetch('/api/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeConv.id }),
    })
      .then(() => fetchConversations())
      .catch(() => undefined);
  }, [activeConv, fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const openChat = (c: ChatEntry) => {
    setActivePeerId(peerOf(c, currentUser.id));
    setThreadOpen(true);
    setSendError(null);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || !activeConv || !activeConv.canMessage || sending) return;

    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: peerOf(activeConv, currentUser.id), content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.message) throw new Error(data?.message || data?.error || 'Message not sent. Please try again.');
      setInputText('');
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      await fetchConversations(); // a first message turns the "new" chat into a real conversation
    } catch (err: any) {
      // The text stays in the box so nothing typed is lost.
      setSendError(err?.message || 'Message not sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleBlock = async () => {
    if (!activeConv) return;
    const name = activeConv.otherMember.fullName;
    if (!window.confirm(`Block ${name}? They won't be able to message or connect with you, and this chat will be hidden.`)) return;
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'block', targetMemberId: peerOf(activeConv, currentUser.id) }),
      });
      if (!res.ok) throw new Error();
      setActivePeerId(null);
      setThreadOpen(false);
      await fetchConversations();
    } catch {
      setSendError(`Could not block ${name}. Please try again.`);
    }
  };

  const filteredConversations = conversations.filter((c) =>
    (c.otherMember?.fullName ?? '').toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className={`messaging-workspace ${threadOpen && activeConv ? 'thread-open' : ''}`}>
      {/* Left Conversations Sidebar */}
      <div className="conversations-sidebar">
        <div className="conversations-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Chats</h3>
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search your connections"
              aria-label="Search chats"
              className="conv-search-input"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="conversation-list">
          {listError && conversations.length === 0 ? (
            <div role="alert" style={{ padding: 24, textAlign: 'center', color: '#B91C1C', fontSize: '0.84rem' }}>
              {listError}. Retrying…
            </div>
          ) : !loaded ? (
            <div role="status" style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: '0.84rem' }}>
              Loading chats…
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: '0.84rem' }}>
              {searchFilter ? 'No chats match your search.' : 'No chats yet. Once someone accepts your connection request, they appear here and you can message them.'}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = activeConv?.id === c.id;
              return (
                <div
                  key={c.id}
                  className={`conv-item ${isActive ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => openChat(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openChat(c);
                    }
                  }}
                >
                  {c.otherMember.avatarUrl ? (
                    <img src={c.otherMember.avatarUrl} alt="" className="conv-item-avatar" />
                  ) : (
                    <span className="conv-item-avatar" aria-hidden />
                  )}
                  <div className="conv-item-content">
                    <div className="conv-item-top">
                      <span className="conv-item-name">{c.otherMember.fullName}</span>
                      <span className="conv-item-time">
                        {c.lastMessage ? new Date(c.lastMessage.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}
                      </span>
                    </div>
                    <div className="conv-item-preview">
                      {c.lastMessage?.content || (c.isNew ? 'New connection: say hello' : '')}
                    </div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="nav-counter-pill" aria-label={`${c.unreadCount} unread`}>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Active Chat Panel */}
      {activeConv ? (
        <div className="chat-panel">
          <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <button type="button" className="nav-icon-btn chat-back-btn" aria-label="Back to chats" onClick={() => setThreadOpen(false)}>
                <ArrowLeft size={18} />
              </button>
              {activeConv.otherMember.avatarUrl && (
                <img
                  src={activeConv.otherMember.avatarUrl}
                  alt=""
                  style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <span>{activeConv.otherMember.fullName}</span>
                  {activeConv.otherMember.isVerified && <CheckCircle2 size={15} fill="#0284C7" color="#fff" aria-label="Verified" />}
                </div>
                <div style={{ fontSize: '0.74rem', color: activeConv.canMessage ? '#047857' : '#64748B', fontWeight: 600 }}>
                  {activeConv.canMessage ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </div>

            <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 12px' }} onClick={handleBlock}>
              <ShieldAlert size={14} color="#EF4444" />
              <span>Block</span>
            </button>
          </div>

          <div className="chat-messages-area" aria-live="polite">
            <div
              style={{
                alignSelf: 'center',
                background: '#F1F5F9',
                padding: '4px 14px',
                borderRadius: '9999px',
                fontSize: '0.72rem',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                margin: '8px 0',
              }}
            >
              <Lock size={12} />
              <span>Direct messages are open only between accepted connections.</span>
            </div>

            {activeConv.isNew && messages.length === 0 && (
              <div style={{ alignSelf: 'center', color: '#64748B', fontSize: '0.84rem', margin: '16px 0' }}>
                You&apos;re connected with {activeConv.otherMember.fullName}. Send the first message.
              </div>
            )}

            {messages.map((m) => {
              const isOutgoing = m.senderId === currentUser.id;
              return (
                <div key={m.id} className={`chat-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</div>
                  <div className="bubble-meta">
                    <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {isOutgoing && (
                      <span aria-label={m.status === 'read' ? 'Read' : 'Delivered'}>
                        <CheckCheck size={14} color={m.status === 'read' ? '#6EE7B7' : '#CBD5E1'} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {sendError && (
            <div role="alert" style={{ padding: '6px 16px', color: '#B91C1C', fontSize: '0.8rem' }}>
              {sendError}
            </div>
          )}

          {activeConv.canMessage ? (
            <form className="chat-composer" onSubmit={handleSendMessage}>
              <input
                type="text"
                className="composer-input"
                placeholder="Type a message…"
                aria-label={`Message ${activeConv.otherMember.fullName}`}
                maxLength={4000}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <button
                type="submit"
                className="btn-primary"
                aria-label="Send"
                disabled={sending || !inputText.trim()}
                style={{ width: 42, height: 42, padding: 0, justifyContent: 'center' }}
              >
                <Send size={18} />
              </button>
            </form>
          ) : (
            <div className="chat-composer" style={{ color: '#64748B', fontSize: '0.82rem', justifyContent: 'center' }}>
              You&apos;re no longer connected, so new messages can&apos;t be sent. Your earlier messages stay here.
            </div>
          )}
        </div>
      ) : (
        <div
          className="chat-empty-panel"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748B', gap: 12 }}
        >
          <h3 style={{ color: '#1E293B' }}>Messages</h3>
          <p style={{ fontSize: '0.86rem' }}>Select a connection to start messaging</p>
        </div>
      )}
    </div>
  );
};
