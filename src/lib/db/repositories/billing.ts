import { withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import crypto from 'crypto';

export class BillingRepository {
  public static async processWebhookEvent(
    provider: string,
    eventId: string,
    eventType: string,
    memberId: string,
    tier: 'free' | 'premium',
    payload: any
  ): Promise<{ success: boolean; alreadyProcessed: boolean }> {
    if (isNeonConfigured()) {
      return await withNeonTransaction(async (client) => {
        // 1. Check idempotency
        const existingRes = await client.query(
          `SELECT id FROM webhook_events WHERE provider = $1 AND event_id = $2`,
          [provider, eventId]
        );
        if (existingRes.rows.length > 0) {
          return { success: true, alreadyProcessed: true };
        }

        // 2. Record webhook event
        const hookId = `wh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query(
          `INSERT INTO webhook_events (id, provider, event_id, event_type, payload, processed_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [hookId, provider, eventId, eventType, JSON.stringify(payload)]
        );

        // 3. Update member plan
        await client.query(
          `UPDATE members SET plan = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [tier, memberId]
        );

        // 4. Upsert subscription
        const subId = `sub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query(
          `INSERT INTO subscriptions (
             id, member_id, tier, status, payment_provider, 
             provider_subscription_id, current_period_end, created_at, updated_at
           ) VALUES ($1, $2, $3, 'active', $4, $5, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (member_id) DO UPDATE SET
             tier = EXCLUDED.tier,
             status = 'active',
             payment_provider = EXCLUDED.payment_provider,
             current_period_end = CURRENT_TIMESTAMP + INTERVAL '30 days',
             updated_at = CURRENT_TIMESTAMP`,
          [subId, memberId, tier, provider, eventId]
        );

        return { success: true, alreadyProcessed: false };
      });
    }

    assertDatabaseAvailable();
    return { success: true, alreadyProcessed: false };
  }
}
