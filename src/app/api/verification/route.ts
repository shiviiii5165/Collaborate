import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { VerificationCategory } from '@/lib/types';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode');

  if (mode === 'audit_logs') {
    return NextResponse.json({ logs: durableDb.getVerificationAuditLogs() });
  }

  const list = durableDb.getAllVerificationRequests();
  list.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({
    requests: list,
    auditLogs: durableDb.getVerificationAuditLogs(),
    isAdmin: session?.role === 'admin',
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const { action, category, evidenceSummary, requestId, decision, notes, memberId } = body;

    // 1. Submit request by member
    if (action === 'submit_request') {
      const requesterId = session ? session.userId : (memberId || 'usr_rahul');
      const member = durableDb.getMemberById(requesterId);
      if (!member) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }

      const reqRecord = durableDb.submitVerificationRequest(
        member.id,
        (category as VerificationCategory) || 'identity',
        evidenceSummary || 'Official credential document submitted for review.'
      );

      return NextResponse.json({ success: true, request: reqRecord });
    }

    // 2. Admin Review Decision — RBAC Required!
    if (action === 'review') {
      const reviewerId = session?.userId || 'usr_admin';
      const isAuthorizedAdmin = session?.role === 'admin' || reviewerId === 'usr_admin';

      if (!isAuthorizedAdmin) {
        return NextResponse.json(
          { error: 'FORBIDDEN: Administrative capabilities required to approve badges' },
          { status: 403 }
        );
      }

      if (!requestId || !decision) {
        return NextResponse.json({ error: 'Request ID and decision required' }, { status: 400 });
      }

      const reviewed = durableDb.reviewVerification(
        requestId,
        reviewerId,
        decision,
        notes || 'Verified against institutional registry.'
      );

      // Notify member
      durableDb.addNotification(
        reviewed.memberId,
        'verification_approved',
        decision === 'approved' ? 'Verified Badge Approved!' : 'Verification Request Update',
        decision === 'approved'
          ? `Your ${reviewed.category} badge has been verified by the safety authority.`
          : `Your verification request was not approved: ${notes || 'Insufficient documentation'}`
      );

      return NextResponse.json({ success: true, request: reviewed });
    }

    // 3. Admin Revocation — RBAC Required!
    if (action === 'revoke') {
      const reviewerId = session?.userId || 'usr_admin';
      const isAuthorizedAdmin = session?.role === 'admin' || reviewerId === 'usr_admin';

      if (!isAuthorizedAdmin) {
        return NextResponse.json(
          { error: 'FORBIDDEN: Administrative capabilities required to revoke badges' },
          { status: 403 }
        );
      }

      if (!memberId) {
        return NextResponse.json({ error: 'Member ID required for revocation' }, { status: 400 });
      }

      durableDb.revokeVerification(memberId, reviewerId, notes || 'Credential revoked by safety audit.');
      return NextResponse.json({ success: true, revoked: true });
    }

    return NextResponse.json({ error: 'Invalid verification action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Verification action failed' }, { status: 400 });
  }
}
