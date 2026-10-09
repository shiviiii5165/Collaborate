import { ConnectionRecord, ConnectionStatus } from '@/lib/types';
import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import crypto from 'crypto';

export class ConnectionsRepository {
  public static async getConnectionEdge(userA: string, userB: string): Promise<ConnectionRecord | null> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT * FROM connection_records 
         WHERE (requester_id = $1 AND recipient_id = $2) 
            OR (requester_id = $2 AND recipient_id = $1)`,
        [userA, userB]
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        requesterId: r.requester_id,
        recipientId: r.recipient_id,
        status: r.status as ConnectionStatus,
        introMessage: r.intro_message || undefined,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    }
    assertDatabaseAvailable();
    return null;
  }

  public static async areConnected(userA: string, userB: string): Promise<boolean> {
    const edge = await this.getConnectionEdge(userA, userB);
    return edge?.status === 'accepted';
  }

  public static async isBlocked(userA: string, userB: string): Promise<boolean> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT id FROM user_blocks 
         WHERE (blocker_id = $1 AND blocked_id = $2) 
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [userA, userB]
      );
      return rows.length > 0;
    }
    assertDatabaseAvailable();
    return false;
  }

  public static async setStatus(
    requesterId: string,
    recipientId: string,
    status: ConnectionStatus,
    introMessage?: string
  ): Promise<ConnectionRecord> {
    if (isNeonConfigured()) {
      return await withNeonTransaction(async (client) => {
        const id = `conn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const res = await client.query(
          `INSERT INTO connection_records (id, requester_id, recipient_id, status, intro_message, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (requester_id, recipient_id) DO UPDATE SET
             status = EXCLUDED.status,
             intro_message = COALESCE(EXCLUDED.intro_message, connection_records.intro_message),
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [id, requesterId, recipientId, status, introMessage || null]
        );
        const r = res.rows[0];
        return {
          id: r.id,
          requesterId: r.requester_id,
          recipientId: r.recipient_id,
          status: r.status as ConnectionStatus,
          introMessage: r.intro_message || undefined,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        };
      });
    }
    assertDatabaseAvailable();
    throw new Error('Database unavailable');
  }

  public static async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (isNeonConfigured()) {
      await withNeonTransaction(async (client) => {
        const blockId = `blk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query(
          `INSERT INTO user_blocks (id, blocker_id, blocked_id, created_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
          [blockId, blockerId, blockedId]
        );
        // Sever connection
        await client.query(
          `UPDATE connection_records SET status = 'blocked', updated_at = CURRENT_TIMESTAMP
           WHERE (requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)`,
          [blockerId, blockedId]
        );
      });
      return;
    }
    assertDatabaseAvailable();
  }
}
