import { VerificationRequest, VerificationAuditLog } from '@/lib/types';
import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import crypto from 'crypto';

export class VerificationRepository {
  public static async recordDecision(
    requestId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    notes: string
  ): Promise<{ request: VerificationRequest; auditLog: VerificationAuditLog }> {
    if (isNeonConfigured()) {
      return await withNeonTransaction(async (client) => {
        // Fetch request
        const reqRes = await client.query(
          `SELECT * FROM verification_requests WHERE id = $1`,
          [requestId]
        );
        if (reqRes.rows.length === 0) {
          throw new Error('Verification request not found');
        }
        const reqRow = reqRes.rows[0];

        // Anti-self-approval rule
        if (reqRow.member_id === reviewerId) {
          throw new Error('Self-approval forbidden. Reviewers cannot approve their own verification requests.');
        }

        // Update request
        await client.query(
          `UPDATE verification_requests 
           SET status = $1, reviewer_notes = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP 
           WHERE id = $4`,
          [decision, notes, reviewerId, requestId]
        );

        // If approved, update member badge
        if (decision === 'approved') {
          await client.query(
            `UPDATE members 
             SET is_verified = TRUE, verified_category = $1, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [reqRow.category, reqRow.member_id]
          );
        }

        // Append immutable audit log
        const auditId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const auditRes = await client.query(
          `INSERT INTO verification_audit_logs (id, request_id, member_id, action, reviewer, category, notes, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           RETURNING *`,
          [auditId, requestId, reqRow.member_id, decision, reviewerId, reqRow.category, notes]
        );

        const a = auditRes.rows[0];
        const auditLog: VerificationAuditLog = {
          id: a.id,
          requestId: a.request_id,
          memberId: a.member_id,
          action: a.action as any,
          reviewer: a.reviewer,
          category: a.category,
          notes: a.notes,
          timestamp: new Date(a.timestamp).toISOString(),
        };

        const updatedReq: VerificationRequest = {
          id: reqRow.id,
          memberId: reqRow.member_id,
          memberName: reqRow.member_name,
          memberEmail: reqRow.member_email,
          category: reqRow.category as any,
          evidenceSummary: reqRow.evidence_summary,
          status: decision,
          reviewerNotes: notes,
          reviewedBy: reviewerId,
          reviewedAt: new Date().toISOString(),
          createdAt: new Date(reqRow.created_at).toISOString(),
        };

        return { request: updatedReq, auditLog };
      });
    }

    assertDatabaseAvailable();
    throw new Error('Database unavailable');
  }
}
