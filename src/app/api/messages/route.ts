import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const currentUserId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');
  const conversationId = searchParams.get('conversationId');

  // If specific conversation requested
  if (conversationId) {
    const conv = durableDb.getConversationById(conversationId);
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Authorization: User must be a participant in the conversation
    if (!conv.participantIds.includes(currentUserId) && session?.role !== 'admin') {
      return NextResponse.json({ error: 'Access denied to this conversation' }, { status: 403 });
    }

    durableDb.markMessagesRead(conversationId, currentUserId);
    const msgs = durableDb.getMessagesForConversation(conversationId);
    return NextResponse.json({ messages: msgs });
  }

  // Otherwise return conversation list for authenticated user
  const convList: any[] = [];
  for (const conv of durableDb.getAllConversations()) {
    if (conv.participantIds.includes(currentUserId)) {
      const otherId = conv.participantIds.find((id) => id !== currentUserId) || '';
      const otherMember = durableDb.getMemberById(otherId);
      if (otherMember) {
        convList.push({
          ...conv,
          otherMember,
          unreadCount: conv.unreadCounts[currentUserId] || 0,
        });
      }
    }
  }

  convList.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return NextResponse.json({ conversations: convList });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const senderId = session ? session.userId : (body.senderId || 'usr_rahul');
    const { recipientId, content } = body;

    if (!recipientId) {
      return NextResponse.json({ error: 'Recipient ID required' }, { status: 400 });
    }

    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
    }

    if (content.length > 4000) {
      return NextResponse.json({ error: 'Message exceeds maximum length of 4000 characters' }, { status: 400 });
    }

    const message = durableDb.sendMessage(senderId, recipientId, content);

    // Notify recipient
    const sender = durableDb.getMemberById(senderId);
    durableDb.addNotification(
      recipientId,
      'message',
      `New message from ${sender?.fullName || 'a connection'}`,
      content.length > 60 ? `${content.substring(0, 60)}...` : content,
      senderId
    );

    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Send message failed' }, { status: 400 });
  }
}
