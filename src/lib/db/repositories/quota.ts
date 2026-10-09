import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import crypto from 'crypto';

export interface QuotaDecision {
  allowed: boolean;
  viewsToday: number;
  limit: number;
  isUnlimited: boolean;
}

export class QuotaRepository {
  public static async recordViewIfEligible(
    viewerId: string,
    targetId: string,
    dateKey: string,
    isPremium: boolean
  ): Promise<QuotaDecision> {
    if (viewerId === targetId) {
      return { allowed: true, viewsToday: 0, limit: 3, isUnlimited: isPremium };
    }

    if (isPremium) {
      return { allowed: true, viewsToday: 0, limit: Infinity, isUnlimited: true };
    }

    if (isNeonConfigured()) {
      return await withNeonTransaction(async (client) => {
        // 1. Check if viewer already viewed this target today
        const existingRes = await client.query(
          `SELECT id FROM profile_view_ledger 
           WHERE viewer_id = $1 AND target_id = $2 AND date_key = $3`,
          [viewerId, targetId, dateKey]
        );

        if (existingRes.rows.length > 0) {
          // Already counted today, free re-view
          const countRes = await client.query(
            `SELECT COUNT(DISTINCT target_id) as cnt FROM profile_view_ledger 
             WHERE viewer_id = $1 AND date_key = $2`,
            [viewerId, dateKey]
          );
          const viewsToday = parseInt(countRes.rows[0].cnt || '0', 10);
          return { allowed: true, viewsToday, limit: 3, isUnlimited: false };
        }

        // 2. Count distinct profiles viewed today
        const countRes = await client.query(
          `SELECT COUNT(DISTINCT target_id) as cnt FROM profile_view_ledger 
           WHERE viewer_id = $1 AND date_key = $2`,
          [viewerId, dateKey]
        );
        const viewsToday = parseInt(countRes.rows[0].cnt || '0', 10);

        if (viewsToday >= 3) {
          return { allowed: false, viewsToday, limit: 3, isUnlimited: false };
        }

        // 3. Atomically record view
        const ledgerId = `vw_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query(
          `INSERT INTO profile_view_ledger (id, viewer_id, target_id, date_key, viewed_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (viewer_id, target_id, date_key) DO NOTHING`,
          [ledgerId, viewerId, targetId, dateKey]
        );

        return { allowed: true, viewsToday: viewsToday + 1, limit: 3, isUnlimited: false };
      });
    }

    assertDatabaseAvailable();
    return { allowed: true, viewsToday: 0, limit: 3, isUnlimited: isPremium };
  }
}
