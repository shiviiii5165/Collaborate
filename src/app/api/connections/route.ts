import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const userId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

  const userConnections: any[] = [];
  const pendingReceived: any[] = [];
  const pendingSent: any[] = [];

  for (const conn of durableDb.getAllConnections()) {
    if (conn.status === 'accepted') {
      const otherId = conn.requesterId === userId ? conn.recipientId : conn.requesterId;
      const otherMember = durableDb.getMemberById(otherId);
      if (otherMember) {
        userConnections.push({
          connectionId: conn.id,
          member: otherMember,
          connectedSince: conn.updatedAt,
        });
      }
    } else if (conn.status === 'request_sent') {
      if (conn.recipientId === userId) {
        const sender = durableDb.getMemberById(conn.requesterId);
        if (sender) {
          pendingReceived.push({
            connectionId: conn.id,
            member: sender,
            introMessage: conn.introMessage,
            requestedAt: conn.createdAt,
          });
        }
      } else if (conn.requesterId === userId) {
        const recipient = durableDb.getMemberById(conn.recipientId);
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
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required to manage connections' }, { status: 401 });
    }
    const body = await req.json();
    const currentUserId = session.userId;
    const { action, toId, connectionId, introMessage } = body;

    if (action === 'send_request') {
      if (!toId) return NextResponse.json({ error: 'Target member ID required' }, { status: 400 });
      if (toId === currentUserId) return NextResponse.json({ error: 'Cannot connect with self' }, { status: 400 });

      const targetMember = durableDb.getMemberById(toId);
      if (!targetMember) {
        return NextResponse.json({ error: 'Target member not found' }, { status: 404 });
      }

      const senderMember = durableDb.getMemberById(currentUserId);

      // Student Safety: Restrict unsolicited adult-to-minor requests
      if (targetMember.isUnder18 && senderMember && !senderMember.isUnder18 && senderMember.role !== 'admin') {
        // A verified institutional credential alone must NOT authorize unsolicited adult-minor contact.
        // Direct contact requires an explicitly permitted institutional pairing and safeguarding clearance.
        const hasSafeguardingClearance = Boolean(senderMember.safeguardingApproved);
        const hasInstitutionalRelationship = Boolean(
          senderMember.verifiedCategory === 'institution' &&
          senderMember.institutionDomain &&
          targetMember.institutionDomain &&
          senderMember.institutionDomain.toLowerCase() === targetMember.institutionDomain.toLowerCase()
        );

        if (!hasSafeguardingClearance || !hasInstitutionalRelationship) {
          return NextResponse.json(
            {
              error: 'SAFETY_RESTRICTION: Unsolicited contact with student accounts under 18 is prohibited. Direct contact requires verified institutional pairing and explicit safeguarding authorization.',
            },
            { status: 403 }
          );
        }
      }

      const conn = durableDb.sendConnectionRequest(currentUserId, toId, introMessage);
      
      const sender = durableDb.getMemberById(currentUserId);
      durableDb.addNotification(
        toId,
        'connection_request',
        `New connection request from ${sender?.fullName || 'a member'}`,
        introMessage || 'wants to connect on Collaborate.',
        currentUserId
      );

      return NextResponse.json({ success: true, connection: conn });
    }

    if (action === 'respond') {
      if (!connectionId) return NextResponse.json({ error: 'Connection ID required' }, { status: 400 });
      const conn = durableDb.respondToConnection(connectionId, currentUserId, body.decision);

      if (body.decision === 'accept') {
        const accepter = durableDb.getMemberById(currentUserId);
        durableDb.addNotification(
          conn.requesterId,
          'connection_accepted',
          `Connection Accepted!`,
          `${accepter?.fullName || 'A member'} accepted your connection request. You can now chat!`,
          currentUserId
        );
      }

      return NextResponse.json({ success: true, connection: conn });
    }

    if (action === 'remove') {
      if (!toId) return NextResponse.json({ error: 'Target user ID required' }, { status: 400 });
      const removed = durableDb.removeConnection(currentUserId, toId);
      return NextResponse.json({ success: true, removed });
    }

    if (action === 'block') {
      if (!toId) return NextResponse.json({ error: 'Target user ID required' }, { status: 400 });
      durableDb.blockMember(currentUserId, toId);
      return NextResponse.json({ success: true, blocked: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Action failed' }, { status: 400 });
  }
}
