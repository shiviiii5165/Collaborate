import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'usr_rahul';
  const conversationId = searchParams.get('conversationId');

  // If specific conversation requested, return its messages
  if (conversationId) {
    db.markMessagesRead(conversationId, userId);
    const msgs = db.messages.filter((m) => m.conversationId === conversationId);
    return NextResponse.json({ messages: msgs });
  }

  // Otherwise return conversation list for user
  const convList: any[] = [];
  for (const conv of db.conversations.values()) {
    if (conv.participantIds.includes(userId)) {
      const otherId = conv.participantIds.find((id) => id !== userId) || '';
      const otherMember = db.members.get(otherId);
      if (otherMember) {
        convList.push({
          ...conv,
          otherMember,
          unreadCount: conv.unreadCounts[userId] || 0,
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
    const body = await req.json();
    const { senderId, recipientId, content } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    const message = db.sendMessage(senderId || 'usr_rahul', recipientId, content);
    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Send message failed' }, { status: 400 });
  }
}
