'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Search,
  Check,
  CheckCheck,
  ShieldAlert,
  MoreVertical,
  Paperclip,
  Smile,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { DirectMessage, Conversation, MemberProfile } from '@/lib/types';

interface MessagesViewProps {
  currentUser: MemberProfile;
  initialRecipientId?: string;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  currentUser,
  initialRecipientId,
}) => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConv, setActiveConv] = useState<any | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = async () => {
    try {
      const res = await fetch(`/api/messages?userId=${currentUser.id}`);
      const data = await res.json();
      if (data.conversations) {
        setConversations(data.conversations);
        if (!activeConv && data.conversations.length > 0) {
          if (initialRecipientId) {
            const found = data.conversations.find((c: any) =>
              c.participantIds.includes(initialRecipientId)
            );
            if (found) setActiveConv(found);
            else setActiveConv(data.conversations[0]);
          } else {
            setActiveConv(data.conversations[0]);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMessages = async (convId: string) => {
    try {
      const res = await fetch(
        `/api/messages?conversationId=${convId}&userId=${currentUser.id}`
      );
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [currentUser.id]);

  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv.id);
      const interval = setInterval(() => fetchMessages(activeConv.id), 3000);
      return () => clearInterval(interval);
    }
  }, [activeConv?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !activeConv) return;

    const recipientId = activeConv.participantIds.find((id: string) => id !== currentUser.id);
    const content = inputText.trim();
    setInputText('');

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUser.id,
          recipientId,
          content,
        }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        fetchConversations();
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredConversations = conversations.filter((c) =>
    c.otherMember?.fullName.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="messaging-workspace">
      {/* Left Conversations Sidebar */}
      <div className="conversations-sidebar">
        <div className="conversations-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Chats</h3>
            <span style={{ fontSize: '0.74rem', color: '#6366F1', fontWeight: 700 }}>
              Encrypted Persistence
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search or start new chat"
              className="conv-search-input"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="conversation-list">
          {filteredConversations.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: '0.84rem' }}>
              No chats yet. Connect with members on Discover to start collaborating!
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = activeConv?.id === c.id;
              return (
                <div
                  key={c.id}
                  className={`conv-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveConv(c)}
                >
                  <img
                    src={c.otherMember.avatarUrl}
                    alt={c.otherMember.fullName}
                    className="conv-item-avatar"
                  />
                  <div className="conv-item-content">
                    <div className="conv-item-top">
                      <span className="conv-item-name">{c.otherMember.fullName}</span>
                      <span className="conv-item-time">
                        {c.lastMessage ? 'Active' : ''}
                      </span>
                    </div>
                    <div className="conv-item-preview">
                      {c.lastMessage?.content || 'Say hello! 👋'}
                    </div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="nav-counter-pill">{c.unreadCount}</span>
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
          {/* Chat Header */}
          <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src={activeConv.otherMember.avatarUrl}
                alt={activeConv.otherMember.fullName}
                style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <span>{activeConv.otherMember.fullName}</span>
                  {activeConv.otherMember.isVerified && (
                    <CheckCircle2 size={15} fill="#0284C7" color="#fff" />
                  )}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#10B981', fontWeight: 600 }}>
                  ● Active now • Connected Member
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                onClick={() =>
                  alert('Safety Boundary: Reporting and blocking options are active.')
                }
              >
                <ShieldAlert size={14} color="#EF4444" />
                <span>Safety</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="chat-messages-area">
            <div
              style={{
                alignSelf: 'center',
                background: '#F1F5F9',
                padding: '4px 14px',
                borderRadius: '9999px',
                fontSize: '0.72rem',
                color: '#64748B',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                margin: '8px 0',
              }}
            >
              <Lock size={12} />
              <span>Direct messages are restricted to accepted professional connections.</span>
            </div>

            {messages.map((m) => {
              const isOutgoing = m.senderId === currentUser.id;
              return (
                <div
                  key={m.id}
                  className={`chat-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`}
                >
                  <div>{m.content}</div>
                  <div className="bubble-meta">
                    <span>
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {isOutgoing && (
                      <span>
                        {m.status === 'read' ? (
                          <CheckCheck size={14} color="#6EE7B7" />
                        ) : (
                          <CheckCheck size={14} color="#CBD5E1" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer Input Bar */}
          <form className="chat-composer" onSubmit={handleSendMessage}>
            <button
              type="button"
              className="nav-icon-btn"
              style={{ width: 34, height: 34 }}
              onClick={() => alert('Attachments: PDF and GitHub gist sharing coming soon.')}
            >
              <Paperclip size={18} />
            </button>
            <input
              type="text"
              className="composer-input"
              placeholder="Type a message..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ width: 42, height: 42, padding: 0, justifyContent: 'center' }}
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94A3B8',
            gap: 12,
          }}
        >
          <div style={{ fontSize: '3rem' }}>💬</div>
          <h3 style={{ color: '#1E293B' }}>Collaborate Real-time Messages</h3>
          <p style={{ fontSize: '0.86rem' }}>Select a conversation to start messaging</p>
        </div>
      )}
    </div>
  );
};
