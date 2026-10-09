import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'usr_rahul';

  const userConnections: any[] = [];
  const pendingReceived: any[] = [];
  const pendingSent: any[] = [];

  for (const conn of db.connections.values()) {
    if (conn.status === 'accepted') {
      const otherId = conn.requesterId === userId ? conn.recipientId : conn.requesterId;
      const otherMember = db.members.get(otherId);
      if (otherMember) {
        userConnections.push({
          connectionId: conn.id,
          member: otherMember,
          connectedSince: conn.updatedAt,
        });
      }
    } else if (conn.status === 'request_sent') {
      if (conn.recipientId === userId) {
        const sender = db.members.get(conn.requesterId);
        if (sender) {
          pendingReceived.push({
            connectionId: conn.id,
            member: sender,
            introMessage: conn.introMessage,
            requestedAt: conn.createdAt,
          });
        }
      } else if (conn.requesterId === userId) {
        const recipient = db.members.get(conn.recipientId);
        if (recipient) {
          pendingSent.push({
            connectionId: conn.id,
            member: recipient,
            introMessage: conn.introMessage,
            requestedAt: conn.createdAt,
          });
        }
      }
    }
  }

  return NextResponse.json({
    connections: userConnections,
    pendingReceived,
    pendingSent,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, fromId, toId, connectionId, introMessage, reason } = body;

    if (action === 'send_request') {
      const conn = db.sendConnectionRequest(fromId || 'usr_rahul', toId, introMessage);
      return NextResponse.json({ success: true, connection: conn });
    }

    if (action === 'respond') {
      const conn = db.respondToConnection(
        connectionId,
        fromId || 'usr_rahul',
        body.decision // 'accept' | 'reject' | 'withdraw'
      );
      return NextResponse.json({ success: true, connection: conn });
    }

    if (action === 'remove') {
      const removed = db.removeConnection(fromId || 'usr_rahul', toId);
      return NextResponse.json({ success: true, removed });
    }

    if (action === 'block') {
      db.blockMember(fromId || 'usr_rahul', toId);
      return NextResponse.json({ success: true, blocked: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Action failed' }, { status: 400 });
  }
}
