import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { VerificationCategory } from '@/lib/types';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode'); // 'pending' | 'audit_logs'

  if (mode === 'audit_logs') {
    return NextResponse.json({ logs: db.verificationAuditLogs });
  }

  // Returns all requests for the admin console
  const list = Array.from(db.verificationRequests.values());
  list.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({ requests: list, auditLogs: db.verificationAuditLogs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, memberId, category, evidenceSummary, requestId, decision, notes, reviewerId } =
      body;

    // 1. Submit request by member
    if (action === 'submit_request') {
      const member = db.members.get(memberId || 'usr_rahul');
      if (!member) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }

      const newReq = {
        id: `vreq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        memberId: member.id,
        memberName: member.fullName,
        memberEmail: member.email,
        category: (category as VerificationCategory) || 'identity',
        evidenceSummary: evidenceSummary || 'Government issued identity credential verification',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      db.verificationRequests.set(newReq.id, newReq);
      return NextResponse.json({ success: true, request: newReq });
    }

    // 2. Admin Review Decision
    if (action === 'review') {
      const reviewed = db.reviewVerification(
        requestId,
        reviewerId || 'usr_admin',
        decision, // 'approved' | 'rejected'
        notes || 'Verified against institutional registry.'
      );
      return NextResponse.json({ success: true, request: reviewed });
    }

    // 3. Admin Revocation
    if (action === 'revoke') {
      db.revokeVerification(memberId, reviewerId || 'usr_admin', notes || 'Credentials expired');
      return NextResponse.json({ success: true, revoked: true });
    }

    return NextResponse.json({ error: 'Invalid verification action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Verification action failed' }, { status: 400 });
  }
}
